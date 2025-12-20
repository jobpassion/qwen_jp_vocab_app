import db from '../db/client';
import { ScoreShareRecord } from '../db/types';

export interface ScoreShareInsert {
  userId: number;
  scoreId: number;
  token: string;
  expiresAt?: string | null;
}

const toRecord = (row: any): ScoreShareRecord => ({
  id: row.id,
  userId: row.user_id,
  scoreId: row.score_id,
  token: row.token,
  expiresAt: row.expires_at ?? null,
  createdAt: row.created_at,
});

const insertStmt = db.prepare(
  `INSERT INTO score_shares (user_id, score_id, token, expires_at)
   VALUES (?, ?, ?, ?)`
);
const selectByTokenStmt = db.prepare('SELECT * FROM score_shares WHERE token = ?');
const selectByScoreStmt = db.prepare(
  'SELECT * FROM score_shares WHERE user_id = ? AND score_id = ? ORDER BY created_at DESC LIMIT 1'
);
const deleteByScoreStmt = db.prepare('DELETE FROM score_shares WHERE user_id = ? AND score_id = ?');

export const replaceShareForScore = (data: ScoreShareInsert): ScoreShareRecord => {
  deleteByScoreStmt.run(data.userId, data.scoreId);
  insertStmt.run(data.userId, data.scoreId, data.token, data.expiresAt ?? null);
  const row = selectByTokenStmt.get(data.token);
  if (!row) {
    throw new Error('Failed to create score share');
  }
  return toRecord(row);
};

export const getShareByToken = (token: string): ScoreShareRecord | undefined => {
  const row = selectByTokenStmt.get(token);
  return row ? toRecord(row) : undefined;
};

export const getShareForScore = (userId: number, scoreId: number): ScoreShareRecord | undefined => {
  const row = selectByScoreStmt.get(userId, scoreId);
  return row ? toRecord(row) : undefined;
};

export const deleteShareForScore = (userId: number, scoreId: number): boolean => {
  const result = deleteByScoreStmt.run(userId, scoreId);
  return result.changes > 0;
};
