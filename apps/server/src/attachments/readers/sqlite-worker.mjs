/**
 * Disposable SQLite reader (run by `files/worker.ts`): the database's bytes in
 * on stdin, its tables out on stdout. The bytes are loaded into memory
 * (`deserialize`), so no file is opened, locked or written; nothing but
 * Conch's own SELECTs runs: no extensions, defensive mode, an untrusted schema
 * (`trusted_schema = OFF`), and views and virtual tables are listed, never read.
 */
import { DatabaseSync } from 'node:sqlite';

const MAX_INPUT = 43 * 1024 * 1024;
const MAX_TABLES = 200;
const MAX_ROWS = 5;
const MAX_CELL = 200;
const MAX_SQL = 2000;

/** One value as a short line of text: blobs by size, long text cut. */
function cell(value) {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  const text = String(value);
  return text.length > MAX_CELL ? `${text.slice(0, MAX_CELL)}…` : text;
}

/** A name quoted for SQL, so a table called `x"; DROP …` stays one name. */
const quote = (name) => `"${String(name).replaceAll('"', '""')}"`;

function read(bytes) {
  // A database saved in WAL mode says so in its header (bytes 18 and 19); a
  // database in memory can't be one, so this copy says rollback journal instead.
  if (bytes.length >= 20 && bytes[18] === 2 && bytes[19] === 2) {
    bytes[18] = 1;
    bytes[19] = 1;
  }
  const db = new DatabaseSync(':memory:', { allowExtension: false });
  if (typeof db.deserialize !== 'function') throw new Error('old-node');
  db.deserialize(bytes);
  db.enableDefensive?.(true);
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA query_only = ON');
  const objects = db
    .prepare(
      "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    )
    .all();
  const tables = [];
  const others = [];
  for (const o of objects) {
    const sql = typeof o.sql === 'string' ? o.sql.slice(0, MAX_SQL) : '';
    if (o.type === 'table' && !/^\s*create\s+virtual\s/i.test(sql)) {
      if (tables.length >= MAX_TABLES) continue;
      const table = { name: String(o.name), sql, columns: [], rows: [], count: null };
      try {
        table.columns = db
          .prepare(`PRAGMA table_info(${quote(o.name)})`)
          .all()
          .map((c) => ({ name: String(c.name), type: String(c.type ?? '') }));
        table.count = Number(db.prepare(`SELECT count(*) AS n FROM ${quote(o.name)}`).get().n);
        table.rows = db
          .prepare(`SELECT * FROM ${quote(o.name)} LIMIT ${MAX_ROWS}`)
          .all()
          .map((row) => Object.values(row).map(cell));
      } catch (error) {
        table.error = String(error?.message ?? error).slice(0, 200);
      }
      tables.push(table);
    } else {
      others.push({ type: String(o.type), name: String(o.name), table: String(o.tableName ?? '') });
    }
  }
  const total = objects.filter((o) => o.type === 'table').length;
  return { tables, total, others: others.slice(0, 500) };
}

const chunks = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += chunk.length;
  if (size > MAX_INPUT) throw new Error('Database input is too large.');
  chunks.push(chunk);
}
try {
  const { data } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result = read(new Uint8Array(Buffer.from(data, 'base64')));
  process.stdout.write(JSON.stringify({ result }));
} catch (error) {
  const message = error instanceof Error ? error.message : 'unreadable';
  process.stdout.write(JSON.stringify({ error: message.slice(0, 300) }));
}
