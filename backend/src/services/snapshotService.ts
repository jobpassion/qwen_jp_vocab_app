import { getSnapshotByUserId, saveSnapshotForUser } from '../repositories/snapshotRepository';

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

export interface SnapshotPayload {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  exportedAt: string;
  pages: PageSnapshot[];
  apiConfig: ApiConfig;
  examHistory: ExamHistory;
  pdf: PdfSection | null;
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
  };
};

export const persistSnapshotForUser = (userId: number, payload: unknown): SnapshotRecord => {
  const snapshot = sanitizeSnapshot(payload);
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
