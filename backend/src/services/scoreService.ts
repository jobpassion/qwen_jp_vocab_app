import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import { config } from '../config/env';
import { ScoreRecord } from '../db/types';
import {
  createScoreForUser,
  deleteScoreForUser,
  getScoreForUser,
  listScoresForUser,
  updateScoreForUser,
} from '../repositories/scoreRepository';

export interface ScorePagePayload {
  filename: string;
  imageUrl: string;
  order?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface ScorePayload {
  id: number;
  title: string;
  composer: string;
  description: string;
  config: unknown;
  pages: ScorePagePayload[];
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScoreInput {
  title: string;
  composer?: string | undefined;
  description?: string | undefined;
  config?: unknown;
  imageFilename?: string | undefined;
}

export interface ScoreUpdateInput {
  title?: string | undefined;
  composer?: string | undefined;
  description?: string | undefined;
  config?: unknown;
  imageFilename?: string | undefined;
}

export interface PagesMetaItem {
  [key: string]: unknown;
}

export interface ScoreWriteOptions {
  uploadedFiles?: UploadedFile[];
  pagesMeta?: PagesMetaItem[];
  appendPages?: boolean;
  coverIndex?: number;
}

const uploadsRoute = config.scoreUploadRoute;

fs.mkdirSync(config.scoreUploadDir, { recursive: true });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const safeParseJson = (configJson: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(configJson);
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const toPlainConfig = (configInput: unknown): Record<string, unknown> => {
  if (configInput === undefined || configInput === '') {
    return {};
  }
  if (typeof configInput === 'string') {
    const trimmed = configInput.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      throw new Error('config 必须是合法的 JSON 字符串');
    }
  }
  if (isPlainObject(configInput)) {
    return { ...configInput };
  }
  throw new Error('config 必须是对象或合法的 JSON 字符串');
};

const parsePagesMeta = (meta: PagesMetaItem[] | unknown): PagesMetaItem[] => {
  if (meta === undefined) return [];
  const source = typeof meta === 'string' ? (() => {
    try {
      return JSON.parse(meta);
    } catch {
      return [];
    }
  })() : meta;

  if (!Array.isArray(source)) {
    return [];
  }
  return source.map((item) => (isPlainObject(item) ? { ...item } : {}));
};

const buildImageUrl = (filename: string): string => `${uploadsRoute}/${encodeURIComponent(filename)}`;

const extractPagesFromConfig = (config: Record<string, unknown>): PagesMetaItem[] => {
  const rawPages = isPlainObject(config) ? (config as any).pages : undefined;
  if (!Array.isArray(rawPages)) {
    return [];
  }
  return rawPages
    .filter(isPlainObject)
    .map((page) => ({ ...page }))
    .filter((page) => typeof page.filename === 'string' && page.filename.trim().length > 0);
};

const pagesWithUrl = (pages: PagesMetaItem[]): ScorePagePayload[] =>
  pages
    .map((page, idx) => {
      if (typeof page.filename !== 'string' || page.filename.trim().length === 0) {
        return null;
      }
      const payload: ScorePagePayload = {
        ...page,
        filename: page.filename,
        imageUrl: buildImageUrl(page.filename),
      };
      if (typeof payload.order !== 'number') {
        payload.order = idx;
      }
      return payload;
    })
    .filter((page): page is ScorePagePayload => page !== null);

export const scoreRecordToPayload = (record: ScoreRecord): ScorePayload => {
  const configObject = safeParseJson(record.configJson);
  const pages = pagesWithUrl(extractPagesFromConfig(configObject));
  return {
    id: record.id,
    title: record.title,
    composer: record.composer,
    description: record.description,
    config: configObject,
    pages,
    imageUrl: record.imageFilename ? buildImageUrl(record.imageFilename) : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
};

const mergeConfigWithPages = (
  baseConfig: Record<string, unknown>,
  pages: PagesMetaItem[],
  append: boolean
): Record<string, unknown> => {
  const existingPages = extractPagesFromConfig(baseConfig);
  const nextPages = pages.length > 0 ? (append ? [...existingPages, ...pages] : pages) : existingPages;
  return {
    ...baseConfig,
    pages: nextPages,
  };
};

export interface UploadedFile {
  filename: string;
  path?: string;
}

const buildPagesFromFiles = (
  files: UploadedFile[],
  pagesMeta: PagesMetaItem[],
  startOrder = 0
): PagesMetaItem[] =>
  files.map((file, idx) => {
    const meta = pagesMeta[idx] ?? {};
    const page = isPlainObject(meta) ? { ...meta } : {};
    page.filename = file.filename;
    const order = Number(page.order);
    page.order = Number.isFinite(order) ? order : startOrder + idx;
    const width = Number((page as any).width);
    const height = Number((page as any).height);
    if (!Number.isFinite(width)) {
      delete (page as any).width;
    } else {
      (page as any).width = width;
    }
    if (!Number.isFinite(height)) {
      delete (page as any).height;
    } else {
      (page as any).height = height;
    }
    return page;
  });

const serializeConfig = (configInput: Record<string, unknown>): string => JSON.stringify(configInput);

const removeImageIfExists = (filename: string) => {
  if (!filename) return;
  const filePath = path.join(config.scoreUploadDir, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

const removeImages = (filenames: string[]) => {
  filenames.forEach((name) => removeImageIfExists(name));
};

export const listScores = (userId: number): ScorePayload[] => {
  const records = listScoresForUser(userId);
  return records.map(scoreRecordToPayload);
};

export const createScore = (
  userId: number,
  data: ScoreInput,
  options?: ScoreWriteOptions
): ScorePayload => {
  const files = options?.uploadedFiles ?? [];
  const pagesMeta = parsePagesMeta(options?.pagesMeta);
  const appendPages = options?.appendPages ?? false;

  const baseConfig = toPlainConfig(data.config);
  const pages = buildPagesFromFiles(files, pagesMeta, 0);
  const mergedConfig = mergeConfigWithPages(baseConfig, pages, appendPages);
  const configJson = serializeConfig(mergedConfig);

  const coverIndex = options?.coverIndex ?? 0;
  const cover = pages[coverIndex] ?? pages[0];

  const record = createScoreForUser(userId, {
    title: data.title,
    composer: data.composer ?? '',
    description: data.description ?? '',
    configJson,
    imageFilename: (cover?.filename as string) ?? data.imageFilename ?? '',
  });
  return scoreRecordToPayload(record);
};

export const getScore = (userId: number, scoreId: number): ScorePayload | undefined => {
  const record = getScoreForUser(userId, scoreId);
  return record ? scoreRecordToPayload(record) : undefined;
};

export const updateScore = (
  userId: number,
  scoreId: number,
  data: ScoreUpdateInput,
  options?: ScoreWriteOptions
): ScorePayload | undefined => {
  const existing = getScoreForUser(userId, scoreId);
  if (!existing) {
    return undefined;
  }

  const existingConfig = safeParseJson(existing.configJson);
  const files = options?.uploadedFiles ?? [];
  const pagesMeta = parsePagesMeta(options?.pagesMeta);
  const appendPages = options?.appendPages ?? false;
  const replacePages = files.length > 0 && !appendPages;
  const existingPages = extractPagesFromConfig(existingConfig);

  const baseConfig =
    data.config !== undefined ? toPlainConfig(data.config) : { ...existingConfig };

  const startOrder = appendPages ? existingPages.length : 0;
  const pages = buildPagesFromFiles(files, pagesMeta, startOrder);
  const mergedConfig = mergeConfigWithPages(baseConfig, pages, appendPages);
  const configJson = serializeConfig(mergedConfig);

  const coverIndex = options?.coverIndex ?? 0;
  const cover = pages[coverIndex] ?? pages[0];
  const nextImageFilename =
    data.imageFilename ??
    (cover?.filename as string | undefined) ??
    existing.imageFilename ??
    '';

  const updated = updateScoreForUser(userId, scoreId, {
    title: data.title,
    composer: data.composer,
    description: data.description,
    configJson,
    imageFilename: nextImageFilename,
  });

  if (!updated) {
    return undefined;
  }

  if (replacePages) {
    const oldPageFiles = existingPages.map((page) => page.filename as string);
    removeImages(oldPageFiles);
  }

  if (data.imageFilename && data.imageFilename !== existing.imageFilename) {
    removeImageIfExists(existing.imageFilename);
  }

  return scoreRecordToPayload(updated);
};

export const removeScore = (userId: number, scoreId: number): boolean => {
  const existing = getScoreForUser(userId, scoreId);
  if (!existing) {
    return false;
  }
  const existingConfig = safeParseJson(existing.configJson);
  const existingPages = extractPagesFromConfig(existingConfig);
  deleteScoreForUser(userId, scoreId);
  removeImageIfExists(existing.imageFilename);
  removeImages(existingPages.map((page) => page.filename as string));
  return true;
};
