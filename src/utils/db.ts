import { DatabaseSync } from 'node:sqlite';

export const db = new DatabaseSync(process.env.DB_PATH || 'db.sqlite');
