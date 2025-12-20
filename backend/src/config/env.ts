import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Use repo root as base so relative PUBLIC_DIR works no matter cwd.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const resolvePath = (filepath: string | undefined, fallback: string) => {
  const target = filepath ?? fallback;
  return path.isAbsolute(target) ? target : path.resolve(repoRoot, target);
};

const resolvePublicDir = () => {
  // Default to repo root (where index.html lives) if PUBLIC_DIR not provided.
  const targetDir = resolvePath(process.env.PUBLIC_DIR, '.');
  const fallbackDir = resolvePath(undefined, '.');
  const publicSubDir = resolvePath(undefined, 'public');

  const candidates = [targetDir];
  if (!candidates.includes(fallbackDir)) candidates.push(fallbackDir);
  if (!candidates.includes(publicSubDir)) candidates.push(publicSubDir);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      if (dir !== targetDir) {
        console.warn(`PUBLIC_DIR=${targetDir} missing index.html, falling back to ${dir}`);
      }
      return dir;
    }
  }

  throw new Error(`Static directory not found. Checked: ${candidates.join(', ')}`);
};

const requireEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const normalizeRouteBase = (route: string) => {
  const withLeadingSlash = route.startsWith('/') ? route : `/${route}`;
  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
};

const normalizeBaseUrl = (input?: string) => {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
};

export const config = {
  port: Number(process.env.PORT) || 8000,
  publicDir: resolvePublicDir(),
  databasePath: resolvePath(process.env.DATABASE_PATH, 'data/db.sqlite'),
  sessionDurationHours: Number(process.env.SESSION_DURATION_HOURS) || 24 * 7,
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '50mb',
  sessionSecret: requireEnv('SESSION_SECRET'),
  scoreUploadDir: resolvePath(process.env.SCORE_UPLOAD_DIR, 'data/uploads/scores'),
  scoreUploadRoute: normalizeRouteBase(process.env.SCORE_UPLOAD_ROUTE || '/uploads/scores'),
  scoreMaxUploadBytes: Number(process.env.SCORE_UPLOAD_MAX_BYTES) || 20 * 1024 * 1024,
  shareBaseUrl: normalizeBaseUrl(process.env.SHARE_BASE_URL || process.env.PUBLIC_BASE_URL || ''),
};
