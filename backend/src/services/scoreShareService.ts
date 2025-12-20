import { randomBytes } from 'crypto';
import { config } from '../config/env';
import { getScoreById, getScoreForUser } from '../repositories/scoreRepository';
import {
  deleteShareForScore,
  getShareByToken,
  getShareForScore,
  replaceShareForScore,
} from '../repositories/scoreShareRepository';
import { scoreRecordToPayload, type ScorePayload } from './scoreService';

const SHARE_PAGE_PREFIX = '/share';
const SHARE_API_PREFIX = '/scores/share';

export interface CreateShareOptions {
  expiresInHours?: number;
  reuseExisting?: boolean;
}

export interface ShareLinkPayload {
  token: string;
  sharePath: string; // public page path
  shareUrl: string;
  shareApiPath: string;
  shareApiUrl: string;
  expiresAt: string | null;
  createdAt: string;
  score: ScorePayload;
}

export interface SharedScorePayload {
  token: string;
  sharedByUserId: number;
  sharePath: string;
  shareUrl: string;
  shareApiPath: string;
  shareApiUrl: string;
  expiresAt: string | null;
  createdAt: string;
  score: ScorePayload;
}

const buildSharePagePath = (token: string) => `${SHARE_PAGE_PREFIX}/${encodeURIComponent(token)}`;
const buildShareApiPath = (token: string) => `${SHARE_API_PREFIX}/${encodeURIComponent(token)}`;
const buildShareUrl = (token: string) => {
  const path = buildSharePagePath(token);
  return config.shareBaseUrl ? `${config.shareBaseUrl}${path}` : path;
};
const buildShareApiUrl = (token: string) => {
  const path = buildShareApiPath(token);
  return config.shareBaseUrl ? `${config.shareBaseUrl}${path}` : path;
};

const generateToken = () => randomBytes(16).toString('hex');

const buildExpiresAt = (hours?: number): string | null => {
  if (hours === undefined) return null;
  const numeric = Number(hours);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const expires = new Date(Date.now() + numeric * 60 * 60 * 1000);
  return expires.toISOString();
};

const isExpired = (expiresAt: string | null) => {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) < Date.now();
};

export const createShareLinkForScore = (
  userId: number,
  scoreId: number,
  options?: CreateShareOptions
): ShareLinkPayload => {
  const score = getScoreForUser(userId, scoreId);
  if (!score) {
    throw new Error('乐谱不存在');
  }

  const existing = options?.reuseExisting ? getShareForScore(userId, scoreId) : undefined;
  const token = existing ? existing.token : generateToken();
  const expiresAt = existing?.expiresAt ?? buildExpiresAt(options?.expiresInHours);

  const record = existing ?? replaceShareForScore({
    userId,
    scoreId,
    token,
    expiresAt,
  });

  return {
    token: record.token,
    sharePath: buildSharePagePath(record.token),
    shareUrl: buildShareUrl(record.token),
    shareApiPath: buildShareApiPath(record.token),
    shareApiUrl: buildShareApiUrl(record.token),
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
    score: scoreRecordToPayload(score),
  };
};

export const revokeShareLinkForScore = (userId: number, scoreId: number): boolean => {
  return deleteShareForScore(userId, scoreId);
};

export const getSharedScoreByToken = (token: string): SharedScorePayload | undefined => {
  const share = getShareByToken(token);
  if (!share || isExpired(share.expiresAt)) {
    return undefined;
  }
  const score = getScoreById(share.scoreId);
  if (!score || score.userId !== share.userId) {
    return undefined;
  }
  return {
    token: share.token,
    sharedByUserId: share.userId,
    sharePath: buildSharePagePath(share.token),
    shareUrl: buildShareUrl(share.token),
    shareApiPath: buildShareApiPath(share.token),
    shareApiUrl: buildShareApiUrl(share.token),
    expiresAt: share.expiresAt,
    createdAt: share.createdAt,
    score: scoreRecordToPayload(score),
  };
};
