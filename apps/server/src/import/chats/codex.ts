/**
 * Codex's past sessions (ADR 0111): `~/.codex/sessions/YYYY/MM/DD/rollout-…-<thread>.jsonl`
 * (and `archived_sessions/`; `CODEX_HOME` moves `~/.codex`). Older ones may be
 * squeezed with zstd (`.jsonl.zst`). Each line is `{timestamp, type, payload}`:
 *
 * - `session_meta`: `{id, cwd, …}`; `turn_context`: `{model, cwd, …}`.
 * - `response_item`: `{type: 'message', role, content: [{type: 'input_text'|'output_text', text}]}`,
 *   or a step (`function_call`, `reasoning`, `local_shell_call`…), left out.
 * - `event_msg`: `{type: 'user_message', message}` / `{type: 'agent_message', message}`,
 *   the words as the person saw them, used when a session has them.
 *
 * Titles are in `session_index.jsonl` (`{id, thread_name}`). Before the
 * wrapper, a line was the item itself; before JSONL, one `.json` file of
 * `{session, items}`. All three are read.
 */
import { basename, join } from 'node:path';

import {
  arr,
  type ChatFinder,
  fileStat,
  head,
  jsonFile,
  jsonLines,
  obj,
  type PastSession,
  personWords,
  projectOf,
  type SessionFile,
  str,
  textOf,
  tidy,
  time,
  unquote,
  walk,
} from './read';

const root = (home: string, env: NodeJS.ProcessEnv) => env.CODEX_HOME || join(home, '.codex');

const ROLLOUT = /^rollout-.*\.(jsonl(\.zst)?|json)$/;
/** The thread's id at the end of a rollout's name. */
const THREAD =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:_[^.]*)?\.(?:jsonl(?:\.zst)?|json)$/i;
const CWD = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;

/** What Codex adds to a turn for the model, not words anyone said. */
const injected = (text: string) =>
  /^#\s*AGENTS\.md instructions/i.test(text) ||
  /^<(environment_context|user_instructions|permissions)/.test(text);

async function titles(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const index = join(dir, 'session_index.jsonl');
  if (!(await fileStat(index))) return out;
  for await (const line of jsonLines(index)) {
    const id = str(line.id);
    const name = str(line.thread_name);
    if (id && name) out.set(id, name);
  }
  return out;
}

export const codex: ChatFinder & { titles?: Map<string, string> } = {
  id: 'codex',

  async find(home, env) {
    const dir = root(home, env);
    const files = [
      ...(await walk(join(dir, 'sessions'), (n) => ROLLOUT.test(n))),
      ...(await walk(join(dir, 'archived_sessions'), (n) => ROLLOUT.test(n), 4)),
    ];
    codex.titles = await titles(dir);
    const out: SessionFile[] = [];
    const seen = new Set<string>();
    for (const path of files) {
      const stat = await fileStat(path);
      if (!stat || stat.size === 0) continue;
      const key = THREAD.exec(basename(path))?.[1] ?? basename(path);
      // The same thread, plain and squeezed: the plain one is newer.
      if (seen.has(key) && path.endsWith('.zst')) continue;
      seen.add(key);
      const project = path.endsWith('.zst')
        ? undefined
        : projectOf(unquote(CWD.exec(await head(path, 16_384))?.[1]));
      out.push({ source: 'codex', key, path, ...stat, ...(project && { project }) });
    }
    return out;
  },

  async read(file) {
    let cwd: string | undefined;
    let model: string | undefined;
    let id: string | undefined;
    const items: PastSession['messages'] = [];
    const said: PastSession['messages'] = [];

    const item = (payload: Record<string, unknown>, at: number) => {
      if (str(payload.type) !== 'message' && payload.type !== undefined) return;
      const role = str(payload.role);
      if (role !== 'user' && role !== 'assistant') return;
      const text = textOf(payload.content).trim();
      if (!text || (role === 'user' && injected(text))) return;
      const words = role === 'user' ? personWords(text) : text;
      if (words) items.push({ role, text: words, at });
    };

    if (file.path.endsWith('.json')) {
      const whole = obj(await jsonFile(file.path));
      const session = obj(whole?.session);
      id = str(session?.id);
      const at = time(session?.timestamp) ?? file.mtimeMs;
      for (const raw of arr(whole?.items)) {
        const payload = obj(raw);
        if (payload) item(payload, at);
      }
    } else {
      for await (const line of jsonLines(file.path)) {
        const at = time(line.timestamp) ?? file.mtimeMs;
        const payload = obj(line.payload);
        const type = str(line.type);
        if (!payload) {
          // Before the wrapper: the first line is the session, the rest are items.
          if (!id && str(line.id) && !line.role) {
            id = str(line.id);
            continue;
          }
          item(line, at);
          continue;
        }
        if (type === 'session_meta') {
          id ??= str(payload.id);
          cwd ??= str(payload.cwd);
        } else if (type === 'turn_context') {
          model = str(payload.model) ?? model;
          cwd ??= str(payload.cwd);
        } else if (type === 'response_item') item(payload, at);
        else if (type === 'event_msg') {
          const kind = str(payload.type);
          const text = str(payload.message)?.trim();
          if (!text) continue;
          if (kind === 'user_message') {
            const words = personWords(text);
            if (words && !injected(words)) said.push({ role: 'user', text: words, at });
          } else if (kind === 'agent_message') said.push({ role: 'assistant', text, at });
        }
      }
    }
    // The words as they were shown, when the session kept them; otherwise the items.
    const chosen = said.some((m) => m.role === 'user') ? said : items;
    const kept = tidy(chosen);
    if (!kept.length) return undefined;
    const title = codex.titles?.get(id ?? file.key) ?? codex.titles?.get(file.key);
    return {
      ...(title && { title }),
      ...(cwd && { cwd }),
      ...(model && { model }),
      messages: kept,
    };
  },
};
