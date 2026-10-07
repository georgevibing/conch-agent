import { randomBytes } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  TerminalSettings,
  type CreateTerminalBody,
  type ServerEvent,
  type TerminalInfo,
  type TerminalStatus,
  type TerminalTicket,
  type UpdateTerminalSettingsBody,
} from '@conch/protocol';
import { z } from 'zod';

import { Mutex, readJson, writeJson } from '../lib/fs';
import { newId } from '../lib/ids';
import { readStore, type Heal } from '../lib/recover';
import { agentEnv } from '../lib/proc';
import { SERVER_VERSION } from '../version';
import { loadBackend, type PtyBackend } from './backend';
import { TerminalSession, type TerminalWatcher } from './session';
import { findShells, pickShell, type Shell } from './shells';

/** How many terminals can be open at once. */
const MAX_TERMINALS = 12;
/** A terminal nobody watches that printed nothing for this long is ended. */
const FORGOTTEN_MS = 24 * 60 * 60_000;
/** An exited terminal nobody is looking at is cleared after this long. */
const EXITED_MS = 10 * 60_000;
/** A ticket to attach is good for this long, once. */
const TICKET_MS = 60_000;
const HEALED_KEPT = 8;

/** Who's asking, as the routes see it. */
export interface Asker {
  /** A genuinely local request (loopback socket and host, no proxy). */
  local: boolean;
  /** A password or key in the last 10 minutes (always true on this computer). */
  verified: boolean;
  /** `local`, `session:<id>` or `key:<id>`. */
  owner: string;
}

export class TerminalError extends Error {
  constructor(
    readonly code:
      'off' | 'remote-off' | 'verify-required' | 'not-found' | 'too-many' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

const TerminalFile = z.object({
  version: z.literal(1).default(1),
  settings: TerminalSettings.default(TerminalSettings.parse({})),
});

export interface TerminalServiceDeps {
  home: string;
  workspace: () => Promise<string>;
  emit: (event: ServerEvent) => void;
  /** Note a repair, e.g. damaged terminal settings set aside. */
  heal?: Heal;
}

/**
 * Real shells on the host (ADR 0015). Terminals outlive the panel and the page:
 * they end when closed, when the device that opened them is signed out, or when
 * forgotten for a day.
 */
export class TerminalService {
  #sessions = new Map<string, TerminalSession>();
  #tickets = new Map<string, { terminalId: string; owner: string; expires: number }>();
  #backend?: PtyBackend;
  #shells?: { at: number; list: Shell[] };
  #settings?: TerminalSettings;
  #mutex = new Mutex();
  healed: { at: number; message: string }[] = [];
  #sweeper: NodeJS.Timeout;

  constructor(private readonly deps: TerminalServiceDeps) {
    this.#sweeper = setInterval(() => this.#sweep(), 5 * 60_000);
    this.#sweeper.unref();
  }

  // ── Settings ────────────────────────────────────────────────────────

  get #path() {
    return join(this.deps.home, 'terminal.json');
  }

  async settings(): Promise<TerminalSettings> {
    if (!this.#settings) {
      // Damaged settings go back to the careful defaults (only this computer may open one).
      const read = await readStore(this.#path, TerminalFile, {
        onRepair: (state) =>
          this.deps.heal?.(
            'terminal',
            state === 'salvaged'
              ? 'Reset a damaged part of the terminal settings. A copy is kept.'
              : 'Reset the damaged terminal settings to the defaults. A copy is kept.',
          ),
      }).catch(() => undefined);
      this.#settings ??= (read?.value ?? TerminalFile.parse({})).settings;
    }
    return this.#settings;
  }

  updateSettings(patch: UpdateTerminalSettingsBody): Promise<TerminalSettings> {
    return this.#mutex.run(async () => {
      const settings = TerminalSettings.parse({ ...(await this.settings()), ...patch });
      await writeJson(this.#path, { version: 1, settings });
      this.#settings = settings;
      // Other devices lose their terminals the moment they're no longer allowed.
      if (!settings.enabled || !settings.allowRemote) {
        this.endWhere((s) => !settings.enabled || s.meta.openedFrom === 'another-device');
      }
      this.#changed();
      return settings;
    });
  }

  heal(message: string): void {
    this.healed = [{ at: Date.now(), message }, ...this.healed].slice(0, HEALED_KEPT);
  }

  #backendNow(): PtyBackend {
    this.#backend ??= loadBackend((message) => this.heal(message));
    return this.#backend;
  }

  shells(): Shell[] {
    if (!this.#shells || Date.now() - this.#shells.at > 60_000) {
      this.#shells = { at: Date.now(), list: findShells() };
    }
    return this.#shells.list;
  }

  // ── Who may ─────────────────────────────────────────────────────────

  async #allowed(asker: Asker): Promise<TerminalError | undefined> {
    const settings = await this.settings();
    if (!settings.enabled)
      return new TerminalError('off', 'The terminal is turned off in Settings › Terminal.');
    if (asker.local) return undefined;
    if (!settings.allowRemote) {
      return new TerminalError(
        'remote-off',
        'Terminals only open on the computer Conch runs on. To use one here, turn on “From other devices” in Settings › Terminal.',
      );
    }
    if (!asker.verified) {
      return new TerminalError(
        'verify-required',
        'Confirm it’s you to open a terminal from this device.',
      );
    }
    return undefined;
  }

  async status(asker: Asker): Promise<TerminalStatus> {
    const settings = await this.settings();
    const denied = await this.#allowed({ ...asker, verified: true });
    return {
      available: !denied,
      unavailable: denied?.message,
      backend: this.#backend?.kind ?? 'pty',
      settings,
      shells: this.shells().map(({ id, name, path }) => ({ id, name, path })),
      terminals: [...this.#sessions.values()]
        .map((s) => s.info())
        .sort((a, b) => a.createdAt - b.createdAt),
      remote: !asker.local,
      healed: this.healed,
    };
  }

  // ── Terminals ───────────────────────────────────────────────────────

  async create(body: CreateTerminalBody, asker: Asker): Promise<TerminalInfo> {
    const denied = await this.#allowed(asker);
    if (denied) throw denied;
    if (
      [...this.#sessions.values()].filter((s) => s.status === 'running').length >= MAX_TERMINALS
    ) {
      throw new TerminalError(
        'too-many',
        `That’s ${MAX_TERMINALS} terminals already. Close one to open another.`,
      );
    }
    const settings = await this.settings();
    const shells = this.shells();
    const wanted = body.shell ?? settings.shell;
    const shell = pickShell(shells, wanted);
    if (!shell)
      throw new TerminalError('unavailable', 'Conch couldn’t find a shell on this computer.');
    if (wanted !== 'auto' && shell.id !== wanted) {
      this.heal(`Switched the terminal to ${shell.name}. ${wanted} isn’t installed any more.`);
    }
    let cwd = body.cwd ?? (await this.deps.workspace());
    if (!isDirectory(cwd)) {
      if (body.cwd) this.heal(`Opened the terminal in your home folder. ${cwd} is gone.`);
      cwd = isDirectory(await this.deps.workspace()) ? await this.deps.workspace() : homedir();
    }
    const pty = this.#backendNow().spawn(shell.path, body.safeMode ? shell.safeArgs : shell.args, {
      cols: body.cols ?? 100,
      rows: body.rows ?? 30,
      cwd,
      env: agentEnv({
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        TERM_PROGRAM: 'conch',
        TERM_PROGRAM_VERSION: SERVER_VERSION,
      }),
    });
    const id = newId('term');
    const session = new TerminalSession(
      {
        id,
        shell: shell.name,
        cwd,
        owner: asker.owner,
        openedFrom: asker.local ? 'this-computer' : 'another-device',
        safeMode: Boolean(body.safeMode),
      },
      pty,
      { changed: () => this.#changed(), exited: () => undefined },
    );
    this.#sessions.set(id, session);
    this.#changed();
    return session.info();
  }

  /** A one-time ticket to attach, after the same checks as opening one. */
  async ticket(id: string, asker: Asker): Promise<TerminalTicket> {
    const denied = await this.#allowed(asker);
    if (denied) throw denied;
    const session = this.#sessions.get(id);
    if (!session) throw new TerminalError('not-found', 'That terminal has ended.');
    const now = Date.now();
    for (const [key, t] of this.#tickets) if (t.expires < now) this.#tickets.delete(key);
    const ticket = randomBytes(32).toString('base64url');
    this.#tickets.set(ticket, { terminalId: id, owner: asker.owner, expires: now + TICKET_MS });
    return { ticket, terminal: session.info() };
  }

  /** Spend a ticket: the terminal it opens, if it's valid, unexpired and the same asker's. */
  redeem(ticket: string, owner: string): TerminalSession | undefined {
    const entry = this.#tickets.get(ticket);
    this.#tickets.delete(ticket);
    if (!entry || entry.expires < Date.now() || entry.owner !== owner) return undefined;
    return this.#sessions.get(entry.terminalId);
  }

  watch(session: TerminalSession, watcher: TerminalWatcher): () => void {
    session.attach(watcher);
    return () => session.detach(watcher);
  }

  close(id: string): boolean {
    const session = this.#sessions.get(id);
    if (!session) return false;
    session.kill();
    this.#sessions.delete(id);
    this.#changed();
    return true;
  }

  endWhere(match: (session: TerminalSession) => boolean): void {
    let ended = false;
    for (const session of [...this.#sessions.values()]) {
      if (!match(session)) continue;
      session.kill();
      this.#sessions.delete(session.id);
      ended = true;
    }
    if (ended) this.#changed();
  }

  /** A device was signed out (or its key revoked): the terminals it opened end with it. */
  endOwnedBy(owners: string[]): void {
    const set = new Set(owners);
    this.endWhere((s) => set.has(s.meta.owner));
  }

  #sweep(): void {
    const now = Date.now();
    this.endWhere(
      (s) =>
        !s.watched &&
        ((s.status === 'running' && now - s.lastActivity > FORGOTTEN_MS) ||
          (s.status === 'exited' && now - s.lastActivity > EXITED_MS)),
    );
  }

  #changed(): void {
    this.deps.emit({ type: 'terminal.changed' });
  }

  stop(): void {
    clearInterval(this.#sweeper);
    for (const session of this.#sessions.values()) session.kill();
    this.#sessions.clear();
  }
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Whether other devices may open terminals, read straight from disk (for `pnpm conch status`). */
export async function terminalRemote(home: string): Promise<boolean> {
  const parsed = TerminalFile.safeParse(
    (await readJson(join(home, 'terminal.json')).catch(() => undefined)) ?? {},
  );
  return parsed.success ? parsed.data.settings.allowRemote : false;
}
