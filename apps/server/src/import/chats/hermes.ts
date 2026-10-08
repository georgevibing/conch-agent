/**
 * Hermes's past sessions (ADR 0111): `~/.hermes/state.db` (`HERMES_HOME`
 * moves it; each profile in `~/.hermes/profiles/<name>/` has its own):
 *
 * - `sessions`: `id, source, model, title, started_at, ended_at, parent_session_id, cwd`
 *   (times in seconds);
 * - `messages`: `session_id, role, content, timestamp`, and for a reply that
 *   came as items, `codex_message_items` (its `output_text`).
 *
 * A routine's run (`cron`), a helper's (`subagent`, or any session started
 * from another) and a board's (`kanban`) aren't chats of yours.
 */
import { join } from 'node:path';

import { columns, look, parseJson, pick } from './sqlite';
import {
  arr,
  type ChatFinder,
  entries,
  fileStat,
  obj,
  type PastSession,
  personWords,
  projectOf,
  type SessionFile,
  str,
  textOf,
  tidy,
  time,
} from './read';

const PROFILE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NOT_YOURS = new Set(['cron', 'subagent', 'kanban', 'batch']);

/** Each Hermes home with a database: the main one, then its profiles. */
async function homes(
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<{ name: string; db: string }[]> {
  const root = env.HERMES_HOME || join(home, '.hermes');
  const out: { name: string; db: string }[] = [];
  if (await fileStat(join(root, 'state.db')))
    out.push({ name: 'default', db: join(root, 'state.db') });
  for (const p of await entries(join(root, 'profiles'))) {
    if (!p.isDirectory() || !PROFILE.test(p.name)) continue;
    const db = join(root, 'profiles', p.name, 'state.db');
    if (await fileStat(db)) out.push({ name: p.name, db });
  }
  return out;
}

/** A reply that came as items: the text of its assistant messages. */
function itemsText(raw: unknown): string {
  return arr(parseJson(raw))
    .map((i) => obj(i))
    .filter((i) => i && (str(i.role) ?? 'assistant') === 'assistant')
    .map((i) => textOf(i?.content))
    .filter(Boolean)
    .join('\n\n');
}

export const hermesChats: ChatFinder = {
  id: 'hermes',

  async find(home, env) {
    const out: SessionFile[] = [];
    for (const h of await homes(home, env)) {
      const rows =
        look(h.db, (db) => {
          const s = columns(db, 'sessions');
          if (!s.has('id')) return [];
          return db
            .prepare(
              `SELECT id, ${pick(s, 'source')} AS source, ${pick(s, 'parent_session_id')} AS parent,
                 ${pick(s, 'started_at')} AS started, ${pick(s, 'ended_at')} AS ended,
                 ${pick(s, 'message_count')} AS count, ${pick(s, 'cwd')} AS cwd FROM sessions`,
            )
            .all() as {
            id: string;
            source: string | null;
            parent: string | null;
            started: number | null;
            ended: number | null;
            count: number | null;
            cwd: string | null;
          }[];
        }) ?? [];
      for (const r of rows) {
        if (r.parent || NOT_YOURS.has(r.source ?? '')) continue;
        const project =
          projectOf(r.cwd ?? undefined) ?? (h.name === 'default' ? undefined : h.name);
        out.push({
          source: 'hermes',
          key: `${h.name}/${r.id}`,
          path: h.db,
          // Grows as it's talked in: the count and the end say when to read it again.
          size: r.count ?? 0,
          mtimeMs: time(r.ended) ?? time(r.started) ?? 0,
          ...(project && { project }),
        });
      }
    }
    return out;
  },

  async read(file) {
    const id = file.key.slice(file.key.indexOf('/') + 1);
    return look(file.path, (db) => {
      const s = columns(db, 'sessions');
      const info = db
        .prepare(
          `SELECT ${pick(s, 'title')} AS title, ${pick(s, 'model')} AS model, ${pick(s, 'cwd')} AS cwd,
             ${pick(s, 'started_at')} AS started FROM sessions WHERE id = ?`,
        )
        .get(id) as
        | { title: string | null; model: string | null; cwd: string | null; started: number | null }
        | undefined;
      if (!info) return undefined;
      const m = columns(db, 'messages');
      if (!m.has('session_id') || !m.has('role')) return undefined;
      const rows = db
        .prepare(
          `SELECT role, ${pick(m, 'content')} AS content, ${pick(m, 'timestamp')} AS at,
             ${pick(m, 'codex_message_items')} AS items FROM messages
           WHERE session_id = ? ${m.has('active') ? 'AND (active IS NULL OR active <> 0)' : ''}
           ORDER BY ${m.has('timestamp') ? 'timestamp, ' : ''}id`,
        )
        .iterate(id) as Iterable<{
        role: string;
        content: string | null;
        at: number | null;
        items: string | null;
      }>;
      const fallback = time(info.started) ?? file.mtimeMs;
      const messages: PastSession['messages'] = [];
      for (const r of rows) {
        if (r.role !== 'user' && r.role !== 'assistant') continue;
        const at = time(r.at) ?? fallback;
        const raw = (r.content ?? '').trim() || (r.role === 'assistant' ? itemsText(r.items) : '');
        const text = r.role === 'user' ? personWords(raw) : raw.trim();
        if (text) messages.push({ role: r.role, text, at });
      }
      const kept = tidy(messages);
      if (!kept.length) return undefined;
      return {
        ...(info.title && { title: info.title }),
        ...(info.cwd && { cwd: info.cwd }),
        ...(info.model && { model: info.model }),
        messages: kept,
      } satisfies PastSession;
    });
  },
};
