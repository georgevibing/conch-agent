import type { TerminalInfo, TerminalLiveEvent } from '@conch/protocol';

import type { PtyProcess } from './backend';

/** Someone looking at a terminal through `/api/terminal/live`. */
export interface TerminalWatcher {
  send(event: TerminalLiveEvent): void;
  /** Output bytes (UTF-8). Never dropped: a terminal can't skip bytes. */
  output(data: Buffer): void;
  /** Output is piling up faster than this watcher takes it. */
  congested(): boolean;
}

/** Scrollback kept for a returning viewer, per terminal. */
const SCROLLBACK_BYTES = 2 * 1024 * 1024;
/** Output is gathered this long into one frame. */
const BATCH_MS = 6;
/** Exiting with an error this soon after starting usually means a broken profile. */
const EARLY_MS = 2_500;

/** OSC 0/2 "set window title": what shells and programs call the terminal. */
// eslint-disable-next-line no-control-regex -- terminal escape sequences are control characters
const TITLE = /\x1b\](?:0|2);([^\x07\x1b]{0,400})(?:\x07|\x1b\\)/g;

export interface SessionMeta {
  id: string;
  shell: string;
  cwd: string;
  /** Who opened it: `local`, `session:<id>` or `key:<id>`; signing that out ends it. */
  owner: string;
  openedFrom: TerminalInfo['openedFrom'];
  safeMode: boolean;
}

/**
 * One terminal: a shell on a PTY, the scrollback a returning viewer is shown,
 * and everyone watching. Output is batched into frames; a viewer that falls
 * behind pauses the shell rather than filling memory.
 */
export class TerminalSession {
  readonly createdAt = Date.now();
  title: string;
  status: TerminalInfo['status'] = 'running';
  exitCode?: number;
  endedEarly = false;
  /** Last output or input, for ending forgotten terminals. */
  lastActivity = Date.now();
  #chunks: Buffer[] = [];
  #bytes = 0;
  #pending = '';
  #timer?: NodeJS.Timeout;
  #watchers = new Set<TerminalWatcher>();
  #paused = false;
  #drain?: NodeJS.Timeout;

  constructor(
    readonly meta: SessionMeta,
    private readonly pty: PtyProcess,
    private readonly hooks: { changed: () => void; exited: () => void },
  ) {
    this.title = meta.shell;
    pty.onData((data) => this.#data(data));
    pty.onExit(({ exitCode, signal }) => {
      this.#flush();
      this.status = 'exited';
      this.exitCode = exitCode;
      this.endedEarly = exitCode !== 0 && Date.now() - this.createdAt < EARLY_MS;
      for (const watcher of this.#watchers) watcher.send({ type: 'exit', code: exitCode, signal });
      this.hooks.exited();
      this.hooks.changed();
    });
  }

  get id(): string {
    return this.meta.id;
  }

  get watched(): boolean {
    return this.#watchers.size > 0;
  }

  info(): TerminalInfo {
    return {
      id: this.meta.id,
      title: this.title,
      shell: this.meta.shell,
      cwd: this.meta.cwd,
      createdAt: this.createdAt,
      status: this.status,
      exitCode: this.exitCode,
      safeMode: this.meta.safeMode,
      endedEarly: this.endedEarly || undefined,
      openedFrom: this.meta.openedFrom,
    };
  }

  #data(data: string): void {
    this.lastActivity = Date.now();
    this.#pending += data;
    this.#timer ??= setTimeout(() => this.#flush(), BATCH_MS);
  }

  #flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#pending) return;
    const text = this.#pending;
    this.#pending = '';
    let title: string | undefined;
    for (const match of text.matchAll(TITLE)) title = match[1];
    if (title !== undefined && title !== this.title) {
      this.title = title.trim() || this.meta.shell;
      for (const watcher of this.#watchers) watcher.send({ type: 'title', title: this.title });
      this.hooks.changed();
    }
    const bytes = Buffer.from(text, 'utf8');
    this.#remember(bytes);
    for (const watcher of this.#watchers) watcher.output(bytes);
    this.#throttle();
  }

  /** Keep the most recent scrollback, starting the kept part at a line break. */
  #remember(bytes: Buffer): void {
    this.#chunks.push(bytes);
    this.#bytes += bytes.length;
    while (this.#bytes > SCROLLBACK_BYTES && this.#chunks.length > 1) {
      const dropped = this.#chunks.shift();
      this.#bytes -= dropped?.length ?? 0;
    }
    if (this.#bytes > SCROLLBACK_BYTES && this.#chunks[0]) {
      // One chunk bigger than the whole budget: drop its oldest bytes.
      const first = this.#chunks[0];
      const excess = this.#bytes - SCROLLBACK_BYTES;
      const cut = first.indexOf(0x0a, excess);
      const kept = first.subarray(cut === -1 ? excess : cut + 1);
      this.#bytes -= first.length - kept.length;
      this.#chunks[0] = kept;
    }
  }

  /** A viewer that can't keep up pauses the shell until everyone has caught up. */
  #throttle(): void {
    const behind = [...this.#watchers].some((w) => w.congested());
    if (behind && !this.#paused) {
      this.#paused = true;
      this.pty.pause();
      this.#drain = setInterval(() => {
        if ([...this.#watchers].some((w) => w.congested())) return;
        clearInterval(this.#drain);
        this.#paused = false;
        this.pty.resume();
      }, 40);
    }
  }

  /** Start watching: the scrollback first, then live output. */
  attach(watcher: TerminalWatcher): void {
    this.#flush();
    watcher.send({ type: 'ready', terminal: this.info() });
    if (this.#bytes) watcher.output(Buffer.concat(this.#chunks));
    if (this.status === 'exited') watcher.send({ type: 'exit', code: this.exitCode ?? 0 });
    this.#watchers.add(watcher);
  }

  detach(watcher: TerminalWatcher): void {
    this.#watchers.delete(watcher);
    if (this.#paused && ![...this.#watchers].some((w) => w.congested())) {
      clearInterval(this.#drain);
      this.#paused = false;
      this.pty.resume();
    }
  }

  write(data: string): void {
    if (this.status !== 'running') return;
    this.lastActivity = Date.now();
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.status === 'running') this.pty.resize(cols, rows);
  }

  kill(): void {
    clearTimeout(this.#timer);
    clearInterval(this.#drain);
    if (this.status === 'running') this.pty.kill();
  }
}
