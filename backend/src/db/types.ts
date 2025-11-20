export interface UserRecord {
  id: number;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRecord {
  id: number;
  userId: number;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface VocabEntry {
  id: number;
  userId: number;
  term: string;
  definition: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SnapshotRow {
  id: number;
  userId: number;
  snapshot: string;
  exportedAt: string;
  savedAt: string;
}
