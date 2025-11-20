import db from '../db/client';
import { UserRecord } from '../db/types';

const toUser = (row: any): UserRecord => ({
  id: row.id,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

const insertUserStmt = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
const selectUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const selectUserByEmailStmt = db.prepare('SELECT * FROM users WHERE email = ?');

export const createUser = (email: string, passwordHash: string): UserRecord => {
  const result = insertUserStmt.run(email, passwordHash);
  const row = selectUserByIdStmt.get(Number(result.lastInsertRowid));
  if (!row) {
    throw new Error('Failed to create user');
  }
  return toUser(row);
};

export const getUserByEmail = (email: string): UserRecord | undefined => {
  const row = selectUserByEmailStmt.get(email);
  return row ? toUser(row) : undefined;
};

export const getUserById = (id: number): UserRecord | undefined => {
  const row = selectUserByIdStmt.get(id);
  return row ? toUser(row) : undefined;
};
