import { DatabaseSync } from 'node:sqlite';

/**
 * Another app's database, opened read-only for one look (ADR 0111): nothing
 * is written to it, and a database that won't open (in use and locked, a
 * newer shape, damaged) is simply not read: `undefined`.
 */
export function look<T>(path: string, read: (db: DatabaseSync) => T): T | undefined {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    // Wait a moment for the app writing to it, rather than failing at once.
    db.exec('PRAGMA busy_timeout = 2000');
    return read(db);
  } catch {
    return undefined;
  } finally {
    try {
      db?.close();
    } catch {
      // Already closed.
    }
  }
}

/** The columns a table has, so a query asks only for what's there (apps add and drop them). */
export function columns(db: DatabaseSync, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as {
      name: string;
    }[];
    return new Set(rows.map((r) => r.name));
  } catch {
    return new Set();
  }
}

/** `column` when the table has it, else `fallback` (`NULL`): one query for every version. */
export const pick = (have: Set<string>, column: string, fallback = 'NULL', table?: string) =>
  have.has(column) ? `${table ? `${table}.` : ''}"${column}"` : fallback;

export const parseJson = (text: unknown): unknown => {
  if (typeof text !== 'string') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};
