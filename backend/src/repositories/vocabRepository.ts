import db from '../db/client';
import { VocabEntry } from '../db/types';

const toEntry = (row: any): VocabEntry => ({
  id: row.id,
  userId: row.user_id,
  term: row.term,
  definition: row.definition,
  notes: row.notes ?? '',
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const insertStmt = db.prepare('INSERT INTO vocab (user_id, term, definition, notes) VALUES (?, ?, ?, ?)');
const selectByUserStmt = db.prepare('SELECT * FROM vocab WHERE user_id = ? ORDER BY created_at DESC');
const updateStmt = db.prepare(`UPDATE vocab
   SET term = ?, definition = ?, notes = ?, updated_at = datetime('now')
   WHERE user_id = ? AND id = ?`);
const deleteStmt = db.prepare('DELETE FROM vocab WHERE user_id = ? AND id = ?');
const selectSingleStmt = db.prepare('SELECT * FROM vocab WHERE user_id = ? AND id = ?');

export const listEntriesForUser = (userId: number): VocabEntry[] => {
  const rows = selectByUserStmt.all(userId);
  return rows.map(toEntry);
};

export const createEntry = (userId: number, term: string, definition: string, notes = ''): VocabEntry => {
  const result = insertStmt.run(userId, term, definition, notes);
  const row = selectSingleStmt.get(userId, Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to insert vocab entry');
  }
  return toEntry(row);
};

export const updateEntry = (
  userId: number,
  entryId: number,
  data: { term: string; definition: string; notes: string }
): VocabEntry | undefined => {
  updateStmt.run(data.term, data.definition, data.notes, userId, entryId);
  const row = selectSingleStmt.get(userId, entryId);
  return row ? toEntry(row) : undefined;
};

export const deleteEntry = (userId: number, entryId: number) => {
  deleteStmt.run(userId, entryId);
};
