import db from '../db/client';
import { SnapshotRow } from '../db/types';

const toRow = (row: any): SnapshotRow => ({
  id: row.id,
  userId: row.user_id,
  snapshot: row.snapshot,
  exportedAt: row.exported_at,
  savedAt: row.saved_at,
});

const selectByUserStmt = db.prepare('SELECT * FROM snapshots WHERE user_id = ?');
const upsertStmt = db.prepare(`
INSERT INTO snapshots (user_id, snapshot, exported_at, saved_at)
VALUES (?, ?, ?, ?)
ON CONFLICT(user_id) DO UPDATE SET
  snapshot = excluded.snapshot,
  exported_at = excluded.exported_at,
  saved_at = excluded.saved_at
`);

export const getSnapshotByUserId = (userId: number): SnapshotRow | undefined => {
  const row = selectByUserStmt.get(userId);
  return row ? toRow(row) : undefined;
};

export const saveSnapshotForUser = (
  userId: number,
  snapshotJson: string,
  exportedAt: string,
  savedAt: string
): SnapshotRow => {
  upsertStmt.run(userId, snapshotJson, exportedAt, savedAt);
  const row = selectByUserStmt.get(userId);
  if (!row) {
    throw new Error('Failed to persist snapshot');
  }
  return toRow(row);
};
