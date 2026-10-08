/**
 * OpenClaw's past sessions (ADR 0111). Now one database per agent,
 * `~/.openclaw/agents/<agent>/agent/openclaw-agent.sqlite` (`OPENCLAW_STATE_DIR`
 * moves `~/.openclaw`; older installs were `~/.clawdbot`, `~/.moltbot`):
 *
 * - `session_windows`: one row per transcript (`session_id, session_key,
 *   session_scope, created_at, updated_at`);
 * - `session_nodes`: the logical session (`session_key, label, display_name, created_via`);
 * - `transcript_events`: `session_id, seq, event_json` (or `event_zstd`, the same squeezed).
 *
 * Before the database, the same transcript as `agents/<agent>/sessions/<id>.jsonl`.
 * A transcript is Pi's format: `{type: 'session', cwd}`, `{type: 'session_info', name}`,
 * and `{type: 'message', timestamp, message: {role: 'user'|'assistant'|'toolResult', content, model}}`.
 *
 * Only your own conversations come in: not a group's or a channel's shared
 * session, a routine's run, or a helper's.
 */
import { join } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';

import { columns, look, parseJson, pick } from './sqlite';
import {
  type ChatFinder,
  entries,
  fileStat,
  jsonLines,
  obj,
  type PastSession,
  personWords,
  type SessionFile,
  str,
  textOf,
  tidy,
  time,
} from './read';

const NAMES = ['.openclaw', '.clawdbot', '.moltbot'];
const AGENT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
/** Sessions that aren't a conversation of yours: shared with others, or started by something else. */
const NOT_YOURS_SCOPE = new Set(['group', 'channel']);
const NOT_YOURS_VIA = new Set(['spawn', 'cron', 'internal', 'plugin']);

async function roots(home: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  if (env.OPENCLAW_STATE_DIR) return [env.OPENCLAW_STATE_DIR];
  const out: string[] = [];
  for (const name of NAMES)
    if ((await entries(join(home, name))).length) out.push(join(home, name));
  return out.slice(0, 1);
}

/** One transcript's words, from its events in order. */
function fromEvents(
  events: Iterable<Record<string, unknown>>,
  fallback: number,
): PastSession | undefined {
  let title: string | undefined;
  let cwd: string | undefined;
  let model: string | undefined;
  const messages: PastSession['messages'] = [];
  for (const e of events) {
    const type = str(e.type);
    if (type === 'session') cwd ??= str(e.cwd);
    else if (type === 'session_info') title = str(e.name) ?? title;
    if (type !== 'message') continue;
    const m = obj(e.message);
    const role = str(m?.role);
    if (!m || (role !== 'user' && role !== 'assistant')) continue;
    const at = time(e.timestamp) ?? time(m.timestamp) ?? fallback;
    const raw = textOf(m.content).trim();
    const text = role === 'user' ? personWords(raw) : raw;
    if (role === 'assistant') model = str(m.model) ?? model;
    if (text) messages.push({ role, text, at });
  }
  const kept = tidy(messages);
  if (!kept.length) return undefined;
  return {
    ...(title && { title }),
    ...(cwd && { cwd }),
    ...(model && { model }),
    messages: kept,
  };
}

export const openclawChats: ChatFinder = {
  id: 'openclaw',

  async find(home, env) {
    const out: SessionFile[] = [];
    for (const root of await roots(home, env)) {
      for (const agent of await entries(join(root, 'agents'))) {
        if (!agent.isDirectory() || !AGENT.test(agent.name)) continue;
        const db = join(root, 'agents', agent.name, 'agent', 'openclaw-agent.sqlite');
        const seen = new Set<string>();
        if (await fileStat(db)) {
          const rows =
            look(db, (d) => {
              const w = columns(d, 'session_windows');
              if (!w.has('session_id')) return [];
              const n = columns(d, 'session_nodes');
              const join_ = n.has('session_key') && w.has('session_key');
              return d
                .prepare(
                  `SELECT w.session_id AS id, ${pick(w, 'session_scope', "'conversation'", 'w')} AS scope,
                     ${pick(w, 'updated_at', 'NULL', 'w')} AS updated,
                     ${join_ ? pick(n, 'created_via', 'NULL', 'n') : 'NULL'} AS via
                   FROM session_windows w
                   ${join_ ? 'LEFT JOIN session_nodes n ON n.session_key = w.session_key' : ''}`,
                )
                .all() as {
                id: string;
                scope: string | null;
                updated: number | null;
                via: string | null;
              }[];
            }) ?? [];
          for (const r of rows) {
            if (NOT_YOURS_SCOPE.has(r.scope ?? '') || NOT_YOURS_VIA.has(r.via ?? '')) continue;
            seen.add(r.id);
            out.push({
              source: 'openclaw',
              key: `${agent.name}/${r.id}`,
              path: db,
              size: 0,
              mtimeMs: time(r.updated) ?? 0,
              ...(agent.name !== 'main' && { project: agent.name }),
            });
          }
        }
        // Before the database: one file per transcript.
        const dir = join(root, 'agents', agent.name, 'sessions');
        for (const file of await entries(dir)) {
          if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
          const id = file.name.slice(0, -'.jsonl'.length);
          if (seen.has(id)) continue;
          const stat = await fileStat(join(dir, file.name));
          if (!stat?.size) continue;
          out.push({
            source: 'openclaw',
            key: `${agent.name}/${id}`,
            path: join(dir, file.name),
            ...stat,
            ...(agent.name !== 'main' && { project: agent.name }),
          });
        }
      }
    }
    return out;
  },

  async read(file) {
    if (file.path.endsWith('.jsonl')) {
      const lines: Record<string, unknown>[] = [];
      for await (const line of jsonLines(file.path)) lines.push(line);
      return fromEvents(lines, file.mtimeMs);
    }
    const id = file.key.slice(file.key.indexOf('/') + 1);
    return look(file.path, (db) => {
      const t = columns(db, 'transcript_events');
      if (!t.has('session_id')) return undefined;
      const rows = db
        .prepare(
          `SELECT ${pick(t, 'event_json')} AS json, ${pick(t, 'event_zstd')} AS zstd
           FROM transcript_events WHERE session_id = ? ORDER BY seq`,
        )
        .iterate(id) as Iterable<{ json: string | null; zstd: Uint8Array | null }>;
      function* events() {
        for (const row of rows) {
          let text = row.json;
          if (!text && row.zstd) {
            try {
              text = zstdDecompressSync(row.zstd).toString('utf8');
            } catch {
              continue;
            }
          }
          const event = obj(parseJson(text));
          if (event) yield event;
        }
      }
      return fromEvents(events(), file.mtimeMs);
    });
  },
};
