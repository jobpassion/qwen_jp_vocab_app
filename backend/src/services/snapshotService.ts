import type { Express } from 'express';
import { getSnapshotByUserId, saveSnapshotForUser } from '../repositories/snapshotRepository';
import { syncScoresFromSnapshot } from './scoreSyncService';

export const SNAPSHOT_FORMAT = 'jp_vocab_app_backup';

export interface WordItem {
  id: number;
  jp: string;
  reading: string;
  pos: string;
  cn: string;
  tag: string;
  accent: string[];
}

export interface PageSnapshot {
  page: number;
  items: WordItem[];
}

export interface ApiConfig {
  apiBase?: string;
  model?: string;
  apiKey?: string;
}

export type ExamHistory = Record<string, unknown>;

export interface PdfSection {
  encoding: 'base64';
  data: string;
}

export interface EncodedImageSection {
  encoding: 'base64';
  data: string;
  mimeType?: string;
  filename?: string;
  fileKey?: string;
}

export interface ScorePageSnapshot {
  order?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  cover?: boolean | undefined;
  image: EncodedImageSection;
  // 保留额外的元数据字段，便于向下兼容
  meta?: Record<string, unknown> | undefined;
}

export interface ScoreSnapshot {
  id?: number | undefined;
  title: string;
  composer?: string | undefined;
  description?: string | undefined;
  config?: Record<string, unknown> | undefined;
  pages: ScorePageSnapshot[];
  coverIndex?: number | undefined;
}

export interface SnapshotPayload {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  exportedAt: string;
  pages: PageSnapshot[];
  apiConfig: ApiConfig;
  examHistory: ExamHistory;
  pdf: PdfSection | null;
  scores?: ScoreSnapshot[] | undefined;
}

export interface SnapshotRecord {
  snapshot: SnapshotPayload;
  savedAt: string;
  exportedAt: string;
}

const toStringOrEmpty = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeAccent = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，\/\s]+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (typeof value === 'number') {
    return [String(value)];
  }
  return [];
};

const sanitizeWordItem = (value: unknown, index: number): WordItem | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const jp = toStringOrEmpty(raw.jp);
  const pos = toStringOrEmpty(raw.pos);
  const cn = toStringOrEmpty(raw.cn);
  if (!jp || !pos || !cn) {
    return null;
  }
  const reading = toStringOrEmpty(raw.reading);
  const tag = toStringOrEmpty(raw.tag) || '普通';
  const accent = normalizeAccent(raw.accent);
  const idRaw = raw.id;
  const defaultId = index + 1;
  const id =
    typeof idRaw === 'number'
      ? idRaw
      : typeof idRaw === 'string' && idRaw.trim()
        ? Number(idRaw)
        : defaultId;

  return {
    id: Number.isFinite(id) ? id : defaultId,
    jp,
    reading,
    pos,
    cn,
    tag,
    accent,
  };
};

const sanitizePages = (value: unknown): PageSnapshot[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const raw = entry as Record<string, unknown>;
      const page = Number(raw.page);
      if (!Number.isFinite(page) || page <= 0) {
        return null;
      }
      const items = Array.isArray(raw.items) ? raw.items : [];
      const sanitizedItems = items
        .map((item, index) => sanitizeWordItem(item, index))
        .filter((item): item is WordItem => Boolean(item));
      return {
        page,
        items: sanitizedItems,
      };
    })
    .filter((entry): entry is PageSnapshot => Boolean(entry));
};

const sanitizeApiConfig = (value: unknown): ApiConfig => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const raw = value as Record<string, unknown>;
  const apiConfig: ApiConfig = {};
  if (typeof raw.apiBase === 'string') {
    apiConfig.apiBase = raw.apiBase;
  }
  if (typeof raw.model === 'string') {
    apiConfig.model = raw.model;
  }
  if (typeof raw.apiKey === 'string') {
    apiConfig.apiKey = raw.apiKey;
  }
  return apiConfig;
};

const sanitizeExamHistory = (value: unknown): ExamHistory => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
};

const sanitizePdfSection = (value: unknown): PdfSection | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw.encoding !== 'base64' || typeof raw.data !== 'string') {
    return null;
  }
  return {
    encoding: 'base64',
    data: raw.data,
  };
};

const sanitizeImageSection = (value: unknown): EncodedImageSection | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;

  if (typeof raw.fileKey === 'string' && raw.fileKey.trim()) {
    const section: EncodedImageSection = {
      encoding: 'base64',
      data: '',
      fileKey: raw.fileKey.trim(),
    };
    if (typeof raw.mimeType === 'string' && raw.mimeType.trim()) {
      section.mimeType = raw.mimeType.trim();
    }
    if (typeof raw.filename === 'string' && raw.filename.trim()) {
      section.filename = raw.filename.trim();
    }
    return section;
  }

  if (raw.encoding !== 'base64' || typeof raw.data !== 'string' || !raw.data.trim()) {
    return null;
  }
  const section: EncodedImageSection = {
    encoding: 'base64',
    data: raw.data.trim(),
  };
  if (typeof raw.mimeType === 'string' && raw.mimeType.trim()) {
    section.mimeType = raw.mimeType.trim();
  }
  if (typeof raw.filename === 'string' && raw.filename.trim()) {
    section.filename = raw.filename.trim();
  }
  return section;
};

const sanitizeScorePage = (value: unknown, index: number): ScorePageSnapshot | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const image = sanitizeImageSection(raw.image);
  if (!image) {
    return null;
  }
  const orderRaw = raw.order;
  const widthRaw = raw.width;
  const heightRaw = raw.height;
  const coverRaw = raw.cover;

  const order = Number(orderRaw);
  const width = Number(widthRaw);
  const height = Number(heightRaw);
  const page: ScorePageSnapshot = {
    order: Number.isFinite(order) ? order : index,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    cover: typeof coverRaw === 'boolean' ? coverRaw : undefined,
    image,
  };

  const meta: Record<string, unknown> = {};
  Object.entries(raw).forEach(([key, val]) => {
    if (['order', 'width', 'height', 'cover', 'image'].includes(key)) {
      return;
    }
    meta[key] = val;
  });
  if (Object.keys(meta).length > 0) {
    page.meta = meta;
  }

  return page;
};

const sanitizeScores = (value: unknown): ScoreSnapshot[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error('scores 必须是数组');
  }

  return value
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }
      const raw = entry as Record<string, unknown>;
      const title = toStringOrEmpty(raw.title);
      if (!title) {
        return null;
      }
      const composer = toStringOrEmpty(raw.composer);
      const description = typeof raw.description === 'string' ? raw.description : '';
      const config = raw.config && typeof raw.config === 'object' ? { ...(raw.config as Record<string, unknown>) } : {};
      const pagesRaw = Array.isArray(raw.pages) ? raw.pages : [];
      const pages = pagesRaw
        .map((page, pageIdx) => sanitizeScorePage(page, pageIdx))
        .filter((page): page is ScorePageSnapshot => Boolean(page));

      if (pages.length === 0) {
        return null;
      }

      const idRaw = raw.id;
      const id =
        typeof idRaw === 'number'
          ? idRaw
          : typeof idRaw === 'string' && idRaw.trim()
            ? Number(idRaw)
            : undefined;

      const coverIndexRaw = raw.coverIndex;
      const coverIndex =
        typeof coverIndexRaw === 'number'
          ? coverIndexRaw
          : typeof coverIndexRaw === 'string' && coverIndexRaw.trim()
            ? Number(coverIndexRaw)
            : undefined;

      return {
        id: Number.isFinite(id) ? Number(id) : undefined,
        title,
        composer,
        description,
        config,
        pages,
        coverIndex: Number.isFinite(coverIndex) && coverIndex! >= 0 ? Number(coverIndex) : undefined,
      } as ScoreSnapshot;
    })
    .filter((entry): entry is ScoreSnapshot => Boolean(entry));
};

const sanitizeSnapshot = (payload: unknown): SnapshotPayload => {
  if (!payload || typeof payload !== 'object') {
    throw new Error('同步数据必须是对象');
  }
  const raw = payload as Record<string, unknown>;
  if (raw.format !== SNAPSHOT_FORMAT) {
    throw new Error(`format 必须是 ${SNAPSHOT_FORMAT}`);
  }
  const version = Number(raw.version ?? 1);
  if (!Number.isFinite(version)) {
    throw new Error('version 必须是数字');
  }

  const exportedAt =
    typeof raw.exportedAt === 'string' && raw.exportedAt.trim()
      ? raw.exportedAt
      : new Date().toISOString();

  return {
    format: SNAPSHOT_FORMAT,
    version,
    exportedAt,
    pages: sanitizePages(raw.pages),
    apiConfig: sanitizeApiConfig(raw.apiConfig),
    examHistory: sanitizeExamHistory(raw.examHistory),
    pdf: sanitizePdfSection(raw.pdf),
    scores: sanitizeScores(raw.scores),
  };
};

export const persistSnapshotForUser = async (
  userId: number,
  payload: unknown,
  uploadedFiles?: Map<string, Express.Multer.File>
): Promise<SnapshotRecord> => {
  const snapshot = sanitizeSnapshot(payload);

  if (snapshot.scores !== undefined) {
    await syncScoresFromSnapshot(userId, snapshot.scores, uploadedFiles);
  }

  const savedAt = new Date().toISOString();
  const row = saveSnapshotForUser(userId, JSON.stringify(snapshot), snapshot.exportedAt, savedAt);
  return {
    snapshot,
    savedAt: row.savedAt,
    exportedAt: row.exportedAt,
  };
};

export const loadSnapshotForUser = (userId: number): SnapshotRecord | undefined => {
  const row = getSnapshotByUserId(userId);
  if (!row) {
    return undefined;
  }
  const parsed = JSON.parse(row.snapshot);
  const snapshot = sanitizeSnapshot(parsed);
  return {
    snapshot,
    savedAt: row.savedAt,
    exportedAt: row.exportedAt,
  };
};
