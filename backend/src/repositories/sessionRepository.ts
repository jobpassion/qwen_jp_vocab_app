import db from '../db/client';
import { SessionRecord } from '../db/types';

const toSession = (row: any): SessionRecord => ({
  id: row.id,
  userId: row.user_id,
  token: row.token,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

const insertSessionStmt = db.prepare('INSERT INTO sessions (user_id, token, expires_at) VALUES (?, ?, ?)');
const selectSessionByTokenStmt = db.prepare('SELECT * FROM sessions WHERE token = ?');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE token = ?');
const deleteExpiredSessionsStmt = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

export const createSession = (userId: number, token: string, expiresAt: Date): SessionRecord => {
  insertSessionStmt.run(userId, token, expiresAt.toISOString());
  const row = selectSessionByTokenStmt.get(token);
  if (!row) {
    throw new Error('Failed to create session');
  }
  return toSession(row);
};

export const getSessionByToken = (token: string): SessionRecord | undefined => {
  const row = selectSessionByTokenStmt.get(token);
  return row ? toSession(row) : undefined;
};

export const deleteSessionByToken = (token: string) => {
  deleteSessionStmt.run(token);
};

export const purgeExpiredSessions = () => {
  deleteExpiredSessionsStmt.run(new Date().toISOString());
};
