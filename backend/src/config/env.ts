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
  const hasIndex = fs.existsSync(path.join(targetDir, 'index.html'));
  if (hasIndex) {
    return targetDir;
  }

  const defaultDir = resolvePath(undefined, '.');
  const defaultHasIndex = fs.existsSync(path.join(defaultDir, 'index.html'));

  if (defaultHasIndex) {
    console.warn(`PUBLIC_DIR=${targetDir} missing index.html, falling back to ${defaultDir}`);
    return defaultDir;
  }

  throw new Error(`Static directory not found. Checked: ${targetDir}${targetDir !== defaultDir ? `, ${defaultDir}` : ''}`);
};

const requireEnv = (key: string) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT) || 8000,
  publicDir: resolvePublicDir(),
  databasePath: resolvePath(process.env.DATABASE_PATH, 'data/db.sqlite'),
  sessionDurationHours: Number(process.env.SESSION_DURATION_HOURS) || 24 * 7,
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '50mb',
  sessionSecret: requireEnv('SESSION_SECRET'),
};
