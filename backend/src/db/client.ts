import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { config } from '../config/env';

const directory = path.dirname(config.databasePath);
fs.mkdirSync(directory, { recursive: true });

const db = new Database(config.databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export default db;
