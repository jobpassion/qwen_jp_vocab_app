import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
import db from '../db/client';
import { config } from '../config/env';
import { listScoresForUser, createScoreForUser, updateScoreForUser, deleteScoreForUser } from '../repositories/scoreRepository';
import type { ScorePayload } from './scoreService';
import { scoreRecordToPayload } from './scoreService';
import type { EncodedImageSection, ScorePageSnapshot, ScoreSnapshot } from './snapshotService';

const MAX_UPLOAD_BYTES = config.scoreMaxUploadBytes;

const ensureUploadDir = async () => {
  await fsPromises.mkdir(config.scoreUploadDir, { recursive: true });
};

const normalizeBase64Data = (input: string): string => {
  const trimmed = input.trim();
  const commaIndex = trimmed.indexOf(',');
  if (commaIndex !== -1 && trimmed.slice(0, commaIndex).includes('base64')) {
    return trimmed.slice(commaIndex + 1);
  }
  return trimmed;
};

const extFromMime = (mime?: string): string => {
  if (!mime) return '.png';
  const normalized = mime.toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  return '.png';
};

const chooseExtension = (image: EncodedImageSection): string => {
  if (image.filename) {
    const ext = path.extname(image.filename);
    if (ext) return ext;
  }
  return extFromMime(image.mimeType);
};

const writeImageToDisk = async (
  image: EncodedImageSection,
  uploadedFiles?: Map<string, Express.Multer.File>
): Promise<{ filename: string }> => {
  let buffer: Buffer | null = null;
  if (image.fileKey && uploadedFiles?.has(image.fileKey)) {
    const file = uploadedFiles.get(image.fileKey)!;
    buffer = file.buffer;
    if (!image.filename) {
      image.filename = file.originalname;
    }
    if (!image.mimeType) {
      image.mimeType = file.mimetype;
    }
  } else {
    const base64 = normalizeBase64Data(image.data);
    buffer = Buffer.from(base64, 'base64');
  }

  if (!buffer || buffer.length === 0 || Number.isNaN(buffer.length)) {
    throw new Error('乐谱图片数据为空或无效');
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new Error(`乐谱图片过大，单张大小不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }
  const filename = `${randomUUID()}${chooseExtension(image)}`;
  const target = path.join(config.scoreUploadDir, filename);
  await fsPromises.writeFile(target, buffer);
  return { filename };
};

const safeParseJson = (json: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const extractPageFilenames = (configJson: string): string[] => {
  const configObj = safeParseJson(configJson);
  const pages = Array.isArray((configObj as any).pages) ? (configObj as any).pages : [];
  return pages
    .map((page: unknown) => (page && typeof page === 'object' ? (page as any).filename : undefined))
    .filter((name: unknown): name is string => typeof name === 'string' && name.trim().length > 0);
};

const collectExistingFiles = (userId: number): Map<number, string[]> => {
  const rows = listScoresForUser(userId);
  const map = new Map<number, string[]>();
  rows.forEach((row) => {
    const files = new Set<string>();
    if (row.imageFilename) {
      files.add(row.imageFilename);
    }
    extractPageFilenames(row.configJson).forEach((name) => files.add(name));
    map.set(row.id, Array.from(files));
  });
  return map;
};

const removeFiles = async (filenames: Set<string>) => {
  await Promise.all(
    Array.from(filenames).map(async (name) => {
      if (!name) return;
      const target = path.join(config.scoreUploadDir, name);
      try {
        await fsPromises.unlink(target);
      } catch (err: any) {
        if (err && err.code !== 'ENOENT') {
          console.warn('删除旧乐谱图片失败', name, err);
        }
      }
    })
  );
};

const buildPageMeta = (page: ScorePageSnapshot, filename: string, index: number) => {
  const meta: Record<string, unknown> = {};
  const order = Number(page.order);
  const width = Number(page.width);
  const height = Number(page.height);
  meta.order = Number.isFinite(order) ? order : index;
  if (Number.isFinite(width)) {
    meta.width = width;
  }
  if (Number.isFinite(height)) {
    meta.height = height;
  }
  if (page.meta && typeof page.meta === 'object') {
    Object.entries(page.meta).forEach(([key, val]) => {
      if (key === 'filename' || key === 'image') return;
      meta[key] = val;
    });
  }
  meta.filename = filename;
  return meta;
};

export const syncScoresFromSnapshot = async (
  userId: number,
  scores: ScoreSnapshot[] | undefined,
  uploadedFiles?: Map<string, Express.Multer.File>
): Promise<ScorePayload[]> => {
  if (scores === undefined) {
    return [];
  }

  await ensureUploadDir();

  const existingRows = listScoresForUser(userId);
  const existingById = new Map(existingRows.map((row) => [row.id, row]));
  const existingFiles = collectExistingFiles(userId);

  const createdFiles = new Set<string>();
  const filesToDelete = new Set<string>();
  const savedPayloads: ScorePayload[] = [];

  // Prepare new files and configs first; if写文件失败，立即清理。
  const prepared = [];
  try {
    for (const score of scores) {
      const pagesMeta: Record<string, unknown>[] = [];
      for (let i = 0; i < score.pages.length; i += 1) {
        const page = score.pages[i]!;
        const { filename } = await writeImageToDisk(page.image, uploadedFiles);
        createdFiles.add(filename);
        pagesMeta.push(buildPageMeta(page, filename, i));
      }

      const configBase =
        score.config && typeof score.config === 'object' ? { ...score.config } : {};
      const mergedConfig = {
        ...configBase,
        pages: pagesMeta,
      };
      const coverIndex =
        typeof score.coverIndex === 'number' && Number.isFinite(score.coverIndex) && score.coverIndex >= 0
          ? Math.min(score.coverIndex, pagesMeta.length - 1)
          : 0;
      prepared.push({
        score,
        pagesMeta,
        configJson: JSON.stringify(mergedConfig),
        coverFilename: (pagesMeta[coverIndex]?.filename as string) ?? (pagesMeta[0]?.filename as string) ?? '',
      });
    }
  } catch (error) {
    await removeFiles(createdFiles);
    throw error;
  }

  db.exec('BEGIN');
  try {
    const incomingIds = new Set<number>();

    for (const entry of prepared) {
      const existing = entry.score.id ? existingById.get(entry.score.id) : undefined;
      if (existing) {
        const updated = updateScoreForUser(userId, existing.id, {
          title: entry.score.title,
          composer: entry.score.composer ?? '',
          description: entry.score.description ?? '',
          configJson: entry.configJson,
          imageFilename: entry.coverFilename,
        });
        if (!updated) {
          throw new Error('更新乐谱失败');
        }
        const oldFiles = existingFiles.get(existing.id);
        if (oldFiles) {
          oldFiles.forEach((f) => {
            if (!createdFiles.has(f)) {
              filesToDelete.add(f);
            }
          });
        }
        savedPayloads.push(scoreRecordToPayload(updated));
        incomingIds.add(existing.id);
      } else {
        const created = createScoreForUser(userId, {
          title: entry.score.title,
          composer: entry.score.composer ?? '',
          description: entry.score.description ?? '',
          configJson: entry.configJson,
          imageFilename: entry.coverFilename,
        });
        savedPayloads.push(scoreRecordToPayload(created));
        incomingIds.add(created.id);
      }
    }

    // 删除未出现在同步数据里的乐谱
    existingRows.forEach((row) => {
      if (!incomingIds.has(row.id)) {
        deleteScoreForUser(userId, row.id);
        const oldFiles = existingFiles.get(row.id);
        if (oldFiles) {
          oldFiles.forEach((f) => {
            if (!createdFiles.has(f)) {
              filesToDelete.add(f);
            }
          });
        }
      }
    });

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    await removeFiles(createdFiles);
    throw error;
  }

  // 清理替换/删除掉的旧文件
  await removeFiles(filesToDelete);

  return savedPayloads;
};
