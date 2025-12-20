import db from '../db/client';
import { ScoreRecord } from '../db/types';

export interface ScoreInsert {
  title: string;
  composer?: string;
  description?: string;
  configJson?: string;
  imageFilename?: string;
}

export interface ScoreUpdate {
  title?: string | undefined;
  composer?: string | undefined;
  description?: string | undefined;
  configJson?: string | undefined;
  imageFilename?: string | undefined;
}

const toRecord = (row: any): ScoreRecord => ({
  id: row.id,
  userId: row.user_id,
  title: row.title,
  composer: row.composer ?? '',
  description: row.description ?? '',
  configJson: row.config_json ?? '{}',
  imageFilename: row.image_filename ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const insertStmt = db.prepare(
  `INSERT INTO scores (user_id, title, composer, description, config_json, image_filename)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const selectByUserStmt = db.prepare('SELECT * FROM scores WHERE user_id = ? ORDER BY created_at DESC');
const selectSingleStmt = db.prepare('SELECT * FROM scores WHERE id = ? AND user_id = ?');
const selectByIdStmt = db.prepare('SELECT * FROM scores WHERE id = ?');
const updateStmt = db.prepare(
  `UPDATE scores
   SET title = ?, composer = ?, description = ?, config_json = ?, image_filename = ?, updated_at = datetime('now')
   WHERE id = ? AND user_id = ?`
);
const deleteStmt = db.prepare('DELETE FROM scores WHERE id = ? AND user_id = ?');

export const listScoresForUser = (userId: number): ScoreRecord[] => {
  const rows = selectByUserStmt.all(userId);
  return rows.map(toRecord);
};

export const getScoreForUser = (userId: number, scoreId: number): ScoreRecord | undefined => {
  const row = selectSingleStmt.get(scoreId, userId);
  return row ? toRecord(row) : undefined;
};

export const getScoreById = (scoreId: number): ScoreRecord | undefined => {
  const row = selectByIdStmt.get(scoreId);
  return row ? toRecord(row) : undefined;
};

export const createScoreForUser = (userId: number, data: ScoreInsert): ScoreRecord => {
  const composer = data.composer ?? '';
  const description = data.description ?? '';
  const configJson = data.configJson ?? '{}';
  const imageFilename = data.imageFilename ?? '';

  const result = insertStmt.run(userId, data.title, composer, description, configJson, imageFilename);
  const insertedId = Number(result.lastInsertRowid);
  const row = selectSingleStmt.get(insertedId, userId);
  if (!row) {
    throw new Error('Failed to insert score');
  }
  return toRecord(row);
};

export const updateScoreForUser = (
  userId: number,
  scoreId: number,
  data: ScoreUpdate
): ScoreRecord | undefined => {
  const existing = getScoreForUser(userId, scoreId);
  if (!existing) {
    return undefined;
  }
  const next = {
    title: data.title ?? existing.title,
    composer: data.composer ?? existing.composer,
    description: data.description ?? existing.description,
    configJson: data.configJson ?? existing.configJson,
    imageFilename: data.imageFilename ?? existing.imageFilename,
  };
  updateStmt.run(
    next.title,
    next.composer,
    next.description,
    next.configJson,
    next.imageFilename,
    scoreId,
    userId
  );
  const row = selectSingleStmt.get(scoreId, userId);
  return row ? toRecord(row) : undefined;
};

export const deleteScoreForUser = (userId: number, scoreId: number) => {
  deleteStmt.run(scoreId, userId);
};
