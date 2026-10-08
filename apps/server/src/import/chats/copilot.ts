/**
 * Copilot Chat in VS Code (ADR 0111): `<VS Code's user folder>/workspaceStorage/<id>/chatSessions/<session>.json`,
 * and `globalStorage/emptyWindowChatSessions/` for a window with no folder.
 * The folder each workspace is about is in its `workspace.json` (`folder`).
 *
 * A session is `{sessionId, creationDate, lastMessageDate, customTitle?,
 * requests: [{message: {text}, response: [{value} | {kind: 'markdownContent',
 * content: {value}} | a step…], timestamp, result: {metadata: {modelId?}}}]}`.
 * Newer VS Code writes it as `.jsonl`, a log of changes to that same object:
 * `{kind: 0, v}` the whole, `{kind: 1, k, v}` one value set, `{kind: 2, k, v}`
 * items added to a list, `{kind: 3, k}` one taken out. Both are read; a change
 * that doesn't apply is skipped, so a newer log still reads what it can.
 *
 * Cursor keeps its chats in a database of its own shape, and isn't read yet.
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
  tidy,
  time,
} from './read';

/** VS Code's user folders on each system, for each edition people use. */
function userDirs(home: string, env: NodeJS.ProcessEnv): string[] {
  const base =
    process.platform === 'darwin'
      ? join(home, 'Library', 'Application Support')
      : process.platform === 'win32'
        ? env.APPDATA || join(home, 'AppData', 'Roaming')
        : env.XDG_CONFIG_HOME || join(home, '.config');
  return ['Code', 'Code - Insiders', 'VSCodium'].map((name) => join(base, name, 'User'));
}

/** `file:///Users/me/shop` → `shop`. */
function folderName(uri: unknown): string | undefined {
  const text = str(uri);
  if (!text) return undefined;
  try {
    return projectOf(decodeURIComponent(new URL(text).pathname));
  } catch {
    return projectOf(text);
  }
}

const UNSAFE = new Set(['__proto__', 'prototype', 'constructor']);

/** Apply one change of the log to the object it builds. */
function apply(root: { v: unknown }, change: Record<string, unknown>) {
  const kind = change.kind;
  if (kind === 0) {
    root.v = change.v;
    return;
  }
  const path = arr(change.k);
  // A path is someone else's file's words: never one that reaches an object's prototype.
  if (!path.length || path.some((step) => typeof step === 'string' && UNSAFE.has(step))) return;
  let at: unknown = root.v;
  for (const step of path.slice(0, -1)) {
    if (at === null || typeof at !== 'object') return;
    at = (at as Record<string | number, unknown>)[step as string | number];
  }
  if (at === null || typeof at !== 'object') return;
  const last = path.at(-1) as string | number;
  const holder = at as Record<string | number, unknown>;
  if (kind === 1) holder[last] = change.v;
  else if (kind === 2) {
    const list = Array.isArray(holder[last]) ? (holder[last] as unknown[]) : [];
    const index = typeof change.i === 'number' ? change.i : list.length;
    list.splice(index, list.length - index, ...arr(change.v));
    holder[last] = list;
  } else if (kind === 3) {
    if (Array.isArray(holder)) holder.splice(Number(last), 1);
    else Reflect.deleteProperty(holder, last);
  }
}

/** The words of a reply: its markdown, its steps left out. */
function replyText(response: unknown): string {
  return arr(response)
    .map((part) => {
      const p = obj(part);
      if (!p) return '';
      const kind = str(p.kind);
      if (kind && kind !== 'markdownContent') return '';
      return str(p.value) ?? str(obj(p.content)?.value) ?? '';
    })
    .join('')
    .trim();
}

export const copilotChats: ChatFinder = {
  id: 'copilot',

  async find(home, env) {
    const out: SessionFile[] = [];
    for (const user of userDirs(home, env)) {
      const places: { dir: string; project?: string }[] = [];
      for (const ws of await entries(join(user, 'workspaceStorage'))) {
        if (!ws.isDirectory()) continue;
        const dir = join(user, 'workspaceStorage', ws.name);
        const about = obj(await jsonFile(join(dir, 'workspace.json'), 64 * 1024));
        const project = folderName(about?.folder ?? about?.workspace);
        places.push({ dir: join(dir, 'chatSessions'), ...(project && { project }) });
      }
      places.push({ dir: join(user, 'globalStorage', 'emptyWindowChatSessions') });
      for (const place of places) {
        for (const file of await entries(place.dir)) {
          if (!file.isFile() || !/\.jsonl?$/.test(file.name)) continue;
          const path = join(place.dir, file.name);
          const stat = await fileStat(path);
          if (!stat?.size) continue;
          out.push({
            source: 'copilot',
            key: file.name.replace(/\.jsonl?$/, ''),
            path,
            ...stat,
            ...(place.project && { project: place.project }),
          });
        }
      }
    }
    return out;
  },

  async read(file) {
    let session: Record<string, unknown> | undefined;
    if (file.path.endsWith('.json')) session = obj(await jsonFile(file.path));
    else {
      const root: { v: unknown } = { v: undefined };
      for await (const change of jsonLines(file.path)) {
        try {
          apply(root, change);
        } catch {
          // A change this version doesn't know: the rest still reads.
        }
      }
      session = obj(root.v);
    }
    if (!session) return undefined;
    const started = time(session.creationDate) ?? file.mtimeMs;
    let model: string | undefined;
    const messages: PastSession['messages'] = [];
    for (const raw of arr(session.requests)) {
      const r = obj(raw);
      if (!r) continue;
      const at = time(r.timestamp) ?? started;
      const asked = personWords(str(obj(r.message)?.text) ?? '');
      if (asked) messages.push({ role: 'user', text: asked, at });
      model = str(obj(obj(r.result)?.metadata)?.modelId) ?? str(r.modelId) ?? model;
      const said = replyText(r.response);
      if (said) messages.push({ role: 'assistant', text: said, at });
    }
    const kept = tidy(messages);
    if (!kept.length) return undefined;
    const title = str(session.customTitle);
    return { ...(title && { title }), ...(model && { model }), messages: kept };
  },
};
