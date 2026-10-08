/**
 * How I did it (ADR 0113): a chat's timeline, and saving one chat or many as
 * a trajectory file in a folder the person chose. Read from the chats' own
 * logs; written only on this computer, never anywhere else.
 */
import { open, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

import {
  chatAgentId,
  TRAJECTORY_BATCH_LIMIT,
  TRAJECTORY_FORMATS,
  TrajectoryExportBody,
  type AgentList,
  type ConversationEvent,
  type ConversationSummary,
  type RunTimeline,
  type TrajectoryExportResult,
  type TrajectoryFilter,
  type TrajectoryFormat,
  type TrajectoryPreview,
} from '@conch/protocol';

import { expand, isDenied, shown, type FolderRules } from '../pick/folders';
import {
  toATIF,
  toHtml,
  toMarkdown,
  toOpenAI,
  toShareGPT,
  trajectoryOf,
  type Trajectory,
} from './formats';
import { NoRedaction, Redaction } from './redact';
import { timelineOf } from './timeline';

export interface TrajectoryDeps {
  list(): Promise<ConversationSummary[]>;
  detail(id: string): Promise<{ conversation: ConversationSummary; events: ConversationEvent[] }>;
  agents(): Promise<AgentList>;
  /** About you: your name and the people in it, taken out of what's saved. */
  profile(): Promise<{ name?: string; facts?: readonly { kind: string; text: string }[] }>;
  /** Every secret Conch knows, as ••• (the vault's redactor). */
  known(): (text: string) => string;
  rules(): FolderRules | Promise<FolderRules>;
  version: string;
  now?: () => number;
}

export type TrajectoryProblem = 'missing' | 'none' | 'denied' | 'not-folder' | 'unwritable';

export class TrajectoryError extends Error {
  constructor(
    readonly code: TrajectoryProblem,
    message: string,
  ) {
    super(message);
  }
}

/** Chats looked at for a batch at most, before the filter that needs their logs. */
const CANDIDATES = 2_000;
const AUTOMATIC = new Set(['routine', 'task', 'artifact', 'client']);

/** A name a file can have on every computer: letters, digits, spaces and a little punctuation. */
export function fileNameOf(title: string): string {
  const clean = title
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[\\/:*?"<>|#%&{}$!'`@+=~^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 60)
    .trim();
  return clean || 'Chat';
}

const dateOf = (at: number) => new Date(at).toISOString().slice(0, 10);

export class TrajectoryService {
  constructor(private readonly deps: TrajectoryDeps) {}

  async timeline(id: string): Promise<RunTimeline> {
    const { conversation, events } = await this.deps.detail(id).catch(() => {
      throw new TrajectoryError('missing', 'That chat isn’t here any more.');
    });
    return timelineOf(conversation, events);
  }

  /** What would be saved: how many chats, what would be taken out, the name and the folder. */
  async preview(body: TrajectoryExportBody): Promise<TrajectoryPreview> {
    const { preview } = await this.#build(TrajectoryExportBody.parse(body));
    return preview;
  }

  /** Saves it, never over a file that's there: a new name instead. */
  async export(body: TrajectoryExportBody): Promise<TrajectoryExportResult> {
    const { preview, text } = await this.#build(TrajectoryExportBody.parse(body));
    const { path, name } = await writeNew(preview.folder.path, preview.name, text);
    return { ...preview, name, path, bytes: Buffer.byteLength(text) };
  }

  async #build(body: ReturnType<typeof TrajectoryExportBody.parse>) {
    const folder = await this.#folder(body.folder);
    const { chats, capped } = await this.#select(body.filter);
    if (!chats.length)
      throw new TrajectoryError(
        'none',
        body.filter.conversationId
          ? 'That chat has nothing in it yet.'
          : 'No chats match. Try a longer stretch of time, or another agent or provider.',
      );
    const agents = await this.deps.agents();
    const redaction = body.redact ? await this.#redaction() : new NoRedaction();
    const list: Trajectory[] = chats.map(({ conversation, events }) => {
      const agentId = chatAgentId(conversation, agents);
      const agent = agents.agents.find((a) => a.id === agentId)?.name ?? 'Conch';
      return trajectoryOf(
        {
          id: conversation.id,
          title: conversation.title,
          agent,
          timeline: timelineOf(conversation, events),
        },
        events,
        redaction,
      );
    });
    const single = Boolean(body.filter.conversationId) && list.length === 1;
    const text = this.#write(body.format, list, single, body.redact);
    const now = this.deps.now?.() ?? Date.now();
    const words = TRAJECTORY_FORMATS[body.format];
    const extension = !single && words.batchExtension ? words.batchExtension : words.extension;
    const base = single ? `Conch – ${fileNameOf(list[0]?.title ?? 'Chat')}` : 'Conch chats';
    return {
      text,
      preview: {
        chats: list.length,
        steps: list.reduce((n, t) => n + t.timeline.steps.length, 0),
        ...(capped && { capped: true }),
        removed: redaction.removed(),
        name: `${base} – ${dateOf(now)}.${extension}`,
        folder,
      } satisfies TrajectoryPreview,
    };
  }

  #write(format: TrajectoryFormat, list: Trajectory[], single: boolean, redacted: boolean): string {
    const lines = (rows: Record<string, unknown>[]) =>
      `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
    const heading = single ? (list[0]?.title ?? 'How I did it') : 'How I did it';
    const made = `${list.length === 1 ? 'One chat' : `${list.length} chats`}, saved ${new Date(this.deps.now?.() ?? Date.now()).toLocaleDateString('en-GB', { dateStyle: 'long' })}${redacted ? ', with keys and personal details taken out' : ''}.`;
    switch (format) {
      case 'openai':
        return lines(list.map(toOpenAI));
      case 'sharegpt':
        return lines(list.map(toShareGPT));
      case 'atif': {
        const rows = list.map((t) => toATIF(t, this.deps.version));
        return single ? `${JSON.stringify(rows[0], null, 2)}\n` : lines(rows);
      }
      case 'markdown':
        return toMarkdown(list, heading);
      case 'report':
        return toHtml(list, heading, made);
    }
  }

  async #redaction(): Promise<Redaction> {
    const profile = await this.deps
      .profile()
      .catch(() => ({}) as Awaited<ReturnType<TrajectoryDeps['profile']>>);
    const rules = await this.deps.rules();
    return new Redaction({
      home: rules.home,
      names: [
        ...(profile.name ? [profile.name] : []),
        ...(profile.facts ?? []).filter((f) => f.kind === 'person').map((f) => f.text),
      ],
      known: this.deps.known(),
    });
  }

  async #select(filter: TrajectoryFilter) {
    if (filter.conversationId) {
      const detail = await this.deps.detail(filter.conversationId).catch(() => {
        throw new TrajectoryError('missing', 'That chat isn’t here any more.');
      });
      return { chats: detail.events.length ? [detail] : [], capped: false };
    }
    const agents = filter.agentId ? await this.deps.agents() : undefined;
    const candidates = (await this.deps.list())
      .filter((c) => filter.from === undefined || c.updatedAt >= filter.from)
      .filter((c) => filter.to === undefined || c.createdAt <= filter.to)
      .filter((c) => filter.automatic !== false || !AUTOMATIC.has(c.origin?.kind ?? ''))
      .filter((c) => !agents || chatAgentId(c, agents) === filter.agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, CANDIDATES);
    const chats: Awaited<ReturnType<TrajectoryDeps['detail']>>[] = [];
    let capped = false;
    for (const c of candidates) {
      const detail = await this.deps.detail(c.id).catch(() => undefined);
      if (!detail?.events.length) continue;
      if (
        filter.engine &&
        !detail.events.some((e) => e.type === 'turn.completed' && e.engine === filter.engine)
      )
        continue;
      if (chats.length >= TRAJECTORY_BATCH_LIMIT) {
        capped = true;
        break;
      }
      chats.push(detail);
    }
    // Oldest first in the file, as they happened.
    return { chats: chats.reverse(), capped };
  }

  /** The folder chosen, or Downloads, or the home folder; never one Conch keeps to itself. */
  async #folder(asked: string | undefined): Promise<{ path: string; shown: string }> {
    const rules = await this.deps.rules();
    // The places Conch keeps to itself as the disk names them too, so a link can't lead in.
    const real = async (path: string) => realpath(path).catch(() => path);
    const realRules: FolderRules = {
      ...rules,
      home: await real(rules.home),
      conchHome: await real(rules.conchHome),
      workspace: await real(rules.workspace),
      denied: await Promise.all(rules.denied.map(real)),
    };
    const denied = (path: string) => isDenied(path, rules) || isDenied(path, realRules);
    const tries = asked ? [expand(asked, rules)] : [join(rules.home, 'Downloads'), rules.home];
    for (const place of tries) {
      if (denied(place))
        throw new TrajectoryError(
          'denied',
          'Conch keeps that folder to itself: sign-ins and keys live there. Choose another.',
        );
      const resolved = await realpath(place).catch(() => undefined);
      const info = resolved ? await stat(resolved).catch(() => undefined) : undefined;
      if (!resolved || !info) {
        if (asked)
          throw new TrajectoryError('missing', 'That folder isn’t there any more. Choose another.');
        continue;
      }
      if (!info.isDirectory())
        throw new TrajectoryError('not-folder', 'That’s a file, not a folder. Choose a folder.');
      if (denied(resolved))
        throw new TrajectoryError(
          'denied',
          'Conch keeps that folder to itself: sign-ins and keys live there. Choose another.',
        );
      return { path: resolved, shown: shown(resolved, realRules) };
    }
    throw new TrajectoryError('missing', 'There’s no Downloads folder here. Choose a folder.');
  }
}

/** Writes a new file, never over one that's there (nor through a link): "name 2.ext" instead. */
export async function writeNew(
  folder: string,
  name: string,
  text: string,
): Promise<{ path: string; name: string }> {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; n <= 100; n++) {
    const candidate = n === 1 ? name : `${stem} ${n}${ext}`;
    const path = join(folder, candidate);
    let handle;
    try {
      handle = await open(path, 'wx', 0o600);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') continue;
      if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS')
        throw new TrajectoryError('unwritable', 'Conch can’t save in that folder. Choose another.');
      throw error;
    }
    try {
      await handle.writeFile(text, 'utf8');
    } finally {
      await handle.close();
    }
    return { path, name: candidate };
  }
  throw new TrajectoryError(
    'unwritable',
    'That folder has too many files by this name. Choose another.',
  );
}
