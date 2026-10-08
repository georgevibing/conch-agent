/**
 * Claude Code's past sessions (ADR 0111): `~/.claude/projects/<folder>/<session>.jsonl`
 * (`CLAUDE_CONFIG_DIR` moves `~/.claude`). One line per event:
 *
 * - `user` / `assistant`, with `message.content` a string or a list of
 *   blocks (`text`, `thinking`, `tool_use`, `tool_result`, `image`). One
 *   assistant reply can be several lines sharing `message.id`.
 * - `ai-title` (`aiTitle`), `custom-title` (`customTitle`), `summary`: its title.
 * - `isMeta`, `isSidechain` and the `<synthetic>` model are Claude Code's own.
 *
 * A helper's own transcript (`<session>/subagents/…`) isn't a chat of yours,
 * and isn't read.
 */
import { join } from 'node:path';

import {
  type ChatFinder,
  entries,
  fileStat,
  head,
  jsonLines,
  obj,
  type PastSession,
  personWords,
  projectOf,
  type SessionFile,
  str,
  unquote,
  textOf,
  tidy,
  time,
} from './read';

const root = (home: string, env: NodeJS.ProcessEnv) =>
  env.CLAUDE_CONFIG_DIR || join(home, '.claude');

/** Where a session worked, from its first lines (cheap: a peek, not a read). */
const CWD = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;

export const claudeCode: ChatFinder = {
  id: 'claude-code',

  async find(home, env) {
    const projects = join(root(home, env), 'projects');
    const out: SessionFile[] = [];
    for (const dir of await entries(projects)) {
      if (!dir.isDirectory()) continue;
      const folder = join(projects, dir.name);
      for (const file of await entries(folder)) {
        if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
        const path = join(folder, file.name);
        const stat = await fileStat(path);
        if (!stat || stat.size === 0) continue;
        const cwd = CWD.exec(await head(path, 8192))?.[1];
        const project = projectOf(unquote(cwd));
        out.push({
          source: 'claude-code',
          key: file.name.slice(0, -'.jsonl'.length),
          path,
          ...stat,
          ...(project && { project }),
        });
      }
    }
    return out;
  },

  async read(file) {
    let title: string | undefined;
    let fallbackTitle: string | undefined;
    let cwd: string | undefined;
    let model: string | undefined;
    const messages: PastSession['messages'] = [];
    /** The reply being put together from its lines, by its `message.id`. */
    let reply: { id: string; index: number } | undefined;
    for await (const line of jsonLines(file.path)) {
      const type = str(line.type);
      if (type === 'ai-title') title = str(line.aiTitle) ?? title;
      else if (type === 'custom-title') title = str(line.customTitle) ?? title;
      else if (type === 'summary') fallbackTitle ??= str(line.summary);
      if (type !== 'user' && type !== 'assistant') continue;
      if (line.isMeta === true || line.isSidechain === true) continue;
      cwd ??= str(line.cwd);
      const message = obj(line.message);
      if (!message) continue;
      const at = time(line.timestamp) ?? file.mtimeMs;
      if (type === 'user') {
        reply = undefined;
        // A tool's result comes back as a "user" line: a step, not something you said.
        const text = personWords(textOf(message.content));
        if (text) messages.push({ role: 'user', text, at });
        continue;
      }
      const id = str(message.model);
      if (id === '<synthetic>') continue;
      if (id) model = id;
      const text = textOf(message.content).trim();
      if (!text) continue;
      const replyId = str(message.id);
      const open = reply && replyId && reply.id === replyId ? messages[reply.index] : undefined;
      if (open) open.text = `${open.text}\n\n${text}`;
      else {
        messages.push({ role: 'assistant', text, at });
        if (replyId) reply = { id: replyId, index: messages.length - 1 };
      }
    }
    const kept = tidy(messages);
    if (!kept.length) return undefined;
    return {
      ...((title ?? fallbackTitle) && { title: title ?? fallbackTitle }),
      ...(cwd && { cwd }),
      ...(model && { model }),
      messages: kept,
    };
  },
};
