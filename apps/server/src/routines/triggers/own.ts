/**
 * Conch's own writes (ADR 0056): files an assistant's tools just wrote, in any
 * chat, so a watched folder doesn't start a routine because Conch itself
 * changed something there.
 */
import { resolve } from 'node:path';

import type { ServerEvent } from '@conch/protocol';

/** A write counts as Conch's own for this long after the tool started. */
const WINDOW_MS = 2 * 60_000;
const MAX = 500;

const WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The files a tool call writes, as far as its input says. */
export function writesOf(name: string, input: unknown): string[] {
  const bare = name.replace(/^mcp__conch__/, '');
  if (!WRITERS.has(bare)) return [];
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const path = args.file_path ?? args.notebook_path ?? args.path;
  return typeof path === 'string' && path ? [path] : [];
}

export class OwnWrites {
  #recent = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  note(path: string) {
    const key = resolve(path).toLowerCase();
    this.#recent.delete(key);
    this.#recent.set(key, this.now());
    if (this.#recent.size > MAX) this.#recent.delete(this.#recent.keys().next().value ?? '');
  }

  has(path: string): boolean {
    const at = this.#recent.get(resolve(path).toLowerCase());
    return at !== undefined && this.now() - at < WINDOW_MS;
  }

  /** Follow the assistant's tool calls on the live stream. */
  onEvent(event: ServerEvent) {
    if (event.type !== 'conversation.event' || event.event.type !== 'tool.started') return;
    for (const path of writesOf(event.event.name, event.event.input)) this.note(path);
  }
}
