/**
 * Gemini CLI's past sessions (ADR 0111): `~/.gemini/tmp/<project>/chats/session-….jsonl`
 * (`GEMINI_CLI_HOME` stands in for the home folder). `projects.json` names
 * each project's folder (`{projects: {"/path": "slug"}}`); older installs
 * used a hash of the path instead.
 *
 * A session is a log of changes, read in order:
 *
 * - the first line, the session: `{sessionId, startTime, lastUpdated, kind, summary?}`;
 * - a message, `{id, timestamp, type: 'user'|'gemini'|'info'|…, content, model?}`,
 *   where a later line with the same `id` replaces it;
 * - `{$set: {…}}` (`messages` in it replaces them all), `{$rewindTo: id}`
 *   (that message and everything after go), `{$patch: {id, content?}}`.
 *
 * Before the log, a session was one `session-….json` file (`{messages: […]}`).
 * A helper's own session (`kind: 'subagent'`) isn't a chat of yours.
 */
import { join } from 'node:path';

import {
  arr,
  type ChatFinder,
  entries,
  fileStat,
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
} from './read';

const root = (home: string, env: NodeJS.ProcessEnv) => join(env.GEMINI_CLI_HOME || home, '.gemini');

const SESSION = /^session-.*\.jsonl?$/;

/** Each project's slug → its folder's name, from `projects.json`. */
async function projectNames(dir: string): Promise<Map<string, string>> {
  const raw = obj(await jsonFile(join(dir, 'projects.json'), 4 * 1024 * 1024));
  const out = new Map<string, string>();
  for (const [path, slug] of Object.entries(obj(raw?.projects) ?? {})) {
    const name = projectOf(path);
    if (typeof slug === 'string' && name) out.set(slug, name);
  }
  return out;
}

/** A message's words: a string, a part, or a list of parts, leaving its thinking out. */
function words(content: unknown): string {
  const parts = Array.isArray(content) ? content : [content];
  return textOf(parts.filter((p) => !obj(p)?.thought));
}

export const geminiCli: ChatFinder = {
  id: 'gemini-cli',

  async find(home, env) {
    const dir = root(home, env);
    const names = await projectNames(dir);
    const out: SessionFile[] = [];
    for (const project of await entries(join(dir, 'tmp'))) {
      if (!project.isDirectory()) continue;
      const chats = join(dir, 'tmp', project.name, 'chats');
      const name =
        names.get(project.name) ?? (/^[0-9a-f]{64}$/.test(project.name) ? undefined : project.name);
      for (const file of await entries(chats)) {
        if (!file.isFile() || !SESSION.test(file.name)) continue;
        const path = join(chats, file.name);
        const stat = await fileStat(path);
        if (!stat || stat.size === 0) continue;
        out.push({
          source: 'gemini-cli',
          key: `${project.name}/${file.name.replace(/\.jsonl?$/, '')}`,
          path,
          ...stat,
          ...(name && { project: name.slice(0, 120) }),
        });
      }
    }
    return out;
  },

  async read(file) {
    let meta: Record<string, unknown> = {};
    const order: string[] = [];
    const records = new Map<string, Record<string, unknown>>();
    const put = (record: Record<string, unknown>) => {
      const id = str(record.id) ?? `#${order.length}`;
      if (!records.has(id)) order.push(id);
      records.set(id, { ...record, id });
    };
    const replaceAll = (list: unknown) => {
      order.length = 0;
      records.clear();
      for (const m of arr(list)) {
        const record = obj(m);
        if (record) put(record);
      }
    };

    if (file.path.endsWith('.json')) {
      const whole = obj(await jsonFile(file.path));
      if (!whole) return undefined;
      meta = whole;
      replaceAll(whole.messages);
    } else {
      let first = true;
      for await (const line of jsonLines(file.path)) {
        const set = obj(line.$set);
        const patch = obj(line.$patch);
        if (set) {
          if ('messages' in set) replaceAll(set.messages);
          const { messages: _, ...rest } = set;
          meta = { ...meta, ...rest };
        } else if (typeof line.$rewindTo === 'string') {
          const at = order.indexOf(line.$rewindTo);
          if (at !== -1) for (const id of order.splice(at)) records.delete(id);
        } else if (patch) {
          const id = str(patch.id);
          const record = id ? records.get(id) : undefined;
          if (record && id && 'content' in patch)
            records.set(id, { ...record, content: patch.content });
          for (const gone of arr(patch.removeIds)) {
            if (typeof gone !== 'string') continue;
            records.delete(gone);
            const at = order.indexOf(gone);
            if (at !== -1) order.splice(at, 1);
          }
        } else if (first && (line.sessionId || line.startTime) && !line.type) meta = line;
        else if (str(line.type)) put(line);
        first = false;
      }
    }
    if (str(meta.kind) === 'subagent') return undefined;

    let model: string | undefined;
    const messages: PastSession['messages'] = [];
    const fallback = time(meta.startTime) ?? file.mtimeMs;
    for (const id of order) {
      const m = records.get(id);
      const type = str(m?.type);
      if (!m || (type !== 'user' && type !== 'gemini')) continue;
      const at = time(m.timestamp) ?? fallback;
      if (type === 'user') {
        const text = personWords(words(m.content));
        if (text) messages.push({ role: 'user', text, at });
      } else {
        model = str(m.model) ?? model;
        const text = words(m.content).trim();
        if (text) messages.push({ role: 'assistant', text, at });
      }
    }
    const kept = tidy(messages);
    if (!kept.length) return undefined;
    const title = str(meta.summary);
    return { ...(title && { title }), ...(model && { model }), messages: kept };
  },
};
