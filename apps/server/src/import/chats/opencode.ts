/**
 * OpenCode's past sessions (ADR 0111). Now a database,
 * `~/.local/share/opencode/opencode.db` (`XDG_DATA_HOME` moves the folder,
 * `OPENCODE_DB` the file; other release channels write `opencode-<channel>.db`):
 *
 * - `session`: `id, parent_id, directory, title, time_created, time_updated`;
 * - `message`: `id, session_id, time_created, data` (`{role, modelID}`);
 * - `part`: `id, message_id, session_id, data` (`{type: 'text', text, synthetic?}`,
 *   or a step: `tool`, `reasoning`, `patch`…, left out).
 *
 * Before the database, the same shapes as files under `storage/`:
 * `session/<project>/<id>.json`, `message/<session>/<id>.json`,
 * `part/<message>/<id>.json`. Both are read. A session started by another
 * (`parent_id`, a helper's subtask) isn't a chat of yours.
 */
import { join } from 'node:path';

import { look, parseJson, pick, columns } from './sqlite';
import {
  type ChatFinder,
  entries,
  fileStat,
  jsonFile,
  obj,
  type PastSession,
  personWords,
  projectOf,
  type SessionFile,
  str,
  tidy,
  time,
} from './read';

const dataDir = (home: string, env: NodeJS.ProcessEnv) =>
  join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'opencode');

/** Every database OpenCode may have written, the one named by `OPENCODE_DB` first. */
async function databases(dir: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const named = env.OPENCODE_DB;
  const out = named ? [named.includes('/') || named.includes('\\') ? named : join(dir, named)] : [];
  for (const e of await entries(dir))
    if (e.isFile() && /^opencode(-[a-z0-9-]+)?\.db$/i.test(e.name)) out.push(join(dir, e.name));
  return [...new Set(out)];
}

/** The words of a message's parts, steps and Conch-like notes left out. */
function partsText(parts: unknown[]): string {
  return parts
    .map((p) => obj(p))
    .filter((p) => p && str(p.type) === 'text' && !p.synthetic && !p.ignored)
    .map((p) => str(p?.text) ?? '')
    .filter(Boolean)
    .join('\n\n');
}

function message(
  data: Record<string, unknown> | undefined,
  parts: unknown[],
  at: number,
): PastSession['messages'][number] | undefined {
  const role = str(data?.role);
  if (role !== 'user' && role !== 'assistant') return undefined;
  const raw = partsText(parts).trim();
  const text = role === 'user' ? personWords(raw) : raw;
  return text ? { role, text, at } : undefined;
}

export const opencode: ChatFinder = {
  id: 'opencode',

  async find(home, env) {
    const dir = dataDir(home, env);
    const out: SessionFile[] = [];
    const seen = new Set<string>();
    for (const db of await databases(dir, env)) {
      if (!(await fileStat(db))) continue;
      const rows =
        look(db, (d) => {
          const have = columns(d, 'session');
          if (!have.has('id')) return [];
          return d
            .prepare(
              `SELECT id, ${pick(have, 'directory')} AS directory, ${pick(have, 'time_updated')} AS updated,
                ${pick(have, 'time_created')} AS created FROM session
               WHERE ${have.has('parent_id') ? 'parent_id IS NULL' : '1'}`,
            )
            .all() as {
            id: string;
            directory: string | null;
            updated: number | null;
            created: number | null;
          }[];
        }) ?? [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const project = projectOf(r.directory ?? undefined);
        out.push({
          source: 'opencode',
          key: r.id,
          path: db,
          size: 0,
          mtimeMs: time(r.updated) ?? time(r.created) ?? 0,
          ...(project && { project }),
        });
      }
    }
    // Before the database: one file per session.
    const sessions = join(dir, 'storage', 'session');
    for (const project of await entries(sessions)) {
      if (!project.isDirectory()) continue;
      for (const file of await entries(join(sessions, project.name))) {
        if (!file.isFile() || !file.name.endsWith('.json')) continue;
        const path = join(sessions, project.name, file.name);
        const info = obj(await jsonFile(path, 1024 * 1024));
        const id = str(info?.id) ?? file.name.slice(0, -5);
        if (!info || info.parentID || seen.has(id)) continue;
        seen.add(id);
        const stat = await fileStat(path);
        const project_ = projectOf(str(info.directory));
        out.push({
          source: 'opencode',
          key: id,
          path,
          size: stat?.size ?? 0,
          mtimeMs: time(obj(info.time)?.updated) ?? stat?.mtimeMs ?? 0,
          ...(project_ && { project: project_ }),
        });
      }
    }
    return out;
  },

  async read(file) {
    if (file.path.endsWith('.json')) return legacy(file);
    return look(file.path, (db) => {
      const s = columns(db, 'session');
      const info = db
        .prepare(
          `SELECT ${pick(s, 'title')} AS title, ${pick(s, 'directory')} AS directory,
            ${pick(s, 'time_created')} AS created FROM session WHERE id = ?`,
        )
        .get(file.key) as
        { title: string | null; directory: string | null; created: number | null } | undefined;
      if (!info) return undefined;
      const m = columns(db, 'message');
      const rows = db
        .prepare(
          `SELECT id, ${pick(m, 'time_created')} AS at, ${pick(m, 'data')} AS data FROM message
           WHERE session_id = ? ORDER BY ${m.has('time_created') ? 'time_created, ' : ''}id`,
        )
        .all(file.key) as { id: string; at: number | null; data: string | null }[];
      const p = columns(db, 'part');
      const parts = new Map<string, unknown[]>();
      if (p.has('message_id') && p.has('data'))
        for (const row of db
          .prepare(`SELECT message_id, data FROM part WHERE session_id = ? ORDER BY id`)
          .all(file.key) as { message_id: string; data: string }[]) {
          const list = parts.get(row.message_id) ?? [];
          list.push(parseJson(row.data));
          parts.set(row.message_id, list);
        }
      let model: string | undefined;
      const messages: PastSession['messages'] = [];
      for (const row of rows) {
        const data = obj(parseJson(row.data));
        model = str(data?.modelID) ?? model;
        const at = time(row.at) ?? time(obj(data?.time)?.created) ?? time(info.created) ?? 0;
        const one = message(data, parts.get(row.id) ?? [], at);
        if (one) messages.push(one);
      }
      const kept = tidy(messages);
      if (!kept.length) return undefined;
      return {
        ...(info.title && { title: info.title }),
        ...(info.directory && { cwd: info.directory }),
        ...(model && { model }),
        messages: kept,
      } satisfies PastSession;
    });
  },
};

/** A session from before the database: its messages and parts as files. */
async function legacy(file: SessionFile): Promise<PastSession | undefined> {
  const info = obj(await jsonFile(file.path, 1024 * 1024));
  if (!info) return undefined;
  const storage = join(file.path, '..', '..', '..');
  const msgDir = join(storage, 'message', file.key);
  const list: { id: string; data: Record<string, unknown> }[] = [];
  for (const e of await entries(msgDir)) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const data = obj(await jsonFile(join(msgDir, e.name), 8 * 1024 * 1024));
    if (data) list.push({ id: str(data.id) ?? e.name.slice(0, -5), data });
  }
  list.sort(
    (a, b) =>
      (time(obj(a.data.time)?.created) ?? 0) - (time(obj(b.data.time)?.created) ?? 0) ||
      a.id.localeCompare(b.id),
  );
  let model: string | undefined;
  const messages: PastSession['messages'] = [];
  for (const { id, data } of list) {
    const partDir = join(storage, 'part', id);
    const parts: unknown[] = [];
    for (const e of (await entries(partDir)).sort((a, b) => a.name.localeCompare(b.name)))
      if (e.isFile() && e.name.endsWith('.json'))
        parts.push(await jsonFile(join(partDir, e.name), 8 * 1024 * 1024));
    model = str(data.modelID) ?? model;
    const one = message(data, parts, time(obj(data.time)?.created) ?? file.mtimeMs);
    if (one) messages.push(one);
  }
  const kept = tidy(messages);
  if (!kept.length) return undefined;
  const title = str(info.title);
  const cwd = str(info.directory);
  return {
    ...(title && { title }),
    ...(cwd && { cwd }),
    ...(model && { model }),
    messages: kept,
  };
}
