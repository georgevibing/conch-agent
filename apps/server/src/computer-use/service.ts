/**
 * Using your computer's apps (ADR 0110): the switch, the two macOS
 * permissions, which chat is using the computer right now, the glowing edge
 * the desktop app draws while it does, and Stop.
 *
 * One chat at a time holds the computer, for the length of its turn. Its
 * latest look at the screen is kept in memory for the live card and dropped
 * when the turn ends: nothing of the screen is ever written down.
 */
import { randomBytes } from 'node:crypto';

import type {
  AppToGateway,
  ComputerUseAccessKind,
  ComputerUseActive,
  ComputerUseNow,
  ComputerUseStatus,
  GatewayToApp,
} from '@conch/protocol';

import type { Heal } from '../lib/recover';
import { UNSUPPORTED, type ComputerDriver } from './driver';
import { MacDriver } from './mac';
import { KEPT_AWAY_LABELS, MAX_STEPS, STOP_KEYS } from './policy';
import { ComputerUseStore } from './store';

/** The desktop app's side of the IPC channel (`desktop/app.ts`). */
export interface OverlayHost {
  send(message: GatewayToApp): Promise<boolean>;
  listen(handler: (message: AppToGateway) => void): () => void;
}

export interface ComputerUseDeps {
  home: string;
  driver?: ComputerDriver;
  /** The desktop app, which draws the glowing edge and listens for the Stop keys. */
  app?: OverlayHost;
  /** Stop a chat's turn, as its Stop button does. */
  interrupt: (conversationId: string) => Promise<void>;
  heal?: Heal;
  /** The app macOS lists the switches under. */
  grantTo?: string;
  /** After this long with nothing done, the edge fades until the next step. */
  idleMs?: number;
}

/** Another chat is using the computer: one at a time. */
export class ComputerBusy extends Error {}

interface Session {
  conversationId: string;
  steps: number;
  label: string;
  app?: string;
  since: number;
  shot?: { id: string; jpeg: Buffer };
  /** The size of the last picture: coordinates are read against it. */
  picture?: { width: number; height: number; scale: number };
  /** Where the pointer was put last, in the picture's pixels. */
  pointer?: { x: number; y: number };
  idle?: NodeJS.Timeout;
  edge: boolean;
}

/** Chats remembered for which apps they were allowed, before the oldest is forgotten. */
const CHATS_KEPT = 200;

/** The driver for this computer: macOS first; elsewhere it says so. */
export function driverFor(platform: NodeJS.Platform = process.platform): ComputerDriver {
  return platform === 'darwin' ? new MacDriver() : UNSUPPORTED;
}

/**
 * The app the switches are listed under when Conch wasn't started by the
 * desktop app: Conch when its host started it (`background/host.ts`), else
 * the terminal it was started from.
 */
export function startedFrom(env: NodeJS.ProcessEnv = process.env): string {
  if (env.CONCH_HOSTED === '1') return 'Conch';
  const program = env.TERM_PROGRAM?.trim();
  const known: Record<string, string> = {
    Apple_Terminal: 'Terminal',
    'iTerm.app': 'iTerm',
    ghostty: 'Ghostty',
    WarpTerminal: 'Warp',
    vscode: 'Visual Studio Code',
    WezTerm: 'WezTerm',
  };
  if (program) return known[program] ?? program.slice(0, 60);
  return 'node';
}

export class ComputerUseService {
  readonly store: ComputerUseStore;
  readonly driver: ComputerDriver;
  #enabled = false;
  #session?: Session;
  /** What each chat was allowed to use, this time Conch runs. */
  #allowed = new Map<string, Set<string>>();

  constructor(private readonly deps: ComputerUseDeps) {
    this.store = new ComputerUseStore(deps.home, deps.heal);
    this.driver = deps.driver ?? driverFor();
    void this.store.enabled().then((on) => (this.#enabled = on));
    // Stop, pressed on the glowing edge or with its keys.
    deps.app?.listen((message) => {
      if (message.type === 'computer.stop') void this.stop();
    });
  }

  /** On, on a computer it can use: the tools are offered only then. */
  get ready(): boolean {
    return this.#enabled && this.driver.platform !== 'unsupported';
  }

  /** The keys that stop it, when the desktop app is there to listen for them. */
  get stopKeys(): string | undefined {
    return this.deps.app && this.driver.platform === 'mac' ? STOP_KEYS.mac : undefined;
  }

  /** Read the switch again (after a restore). */
  async reload(): Promise<void> {
    this.#enabled = await this.store.enabled();
  }

  async status(here: boolean): Promise<ComputerUseStatus> {
    const [enabled, apps, access] = await Promise.all([
      this.store.enabled(),
      this.store.apps(),
      this.driver.access(),
    ]);
    const session = this.#session;
    const overlay = this.deps.app && this.driver.platform === 'mac' ? 'app' : 'none';
    return {
      platform: this.driver.platform,
      enabled,
      access,
      grantTo: this.deps.app ? 'Conch' : (this.deps.grantTo ?? startedFrom()),
      overlay,
      ...(overlay === 'app' && { stopKeys: STOP_KEYS.mac }),
      apps,
      keptAway: [...KEPT_AWAY_LABELS],
      ...(session && { active: this.#active(session) }),
      here,
    };
  }

  /** What's happening right now, without looking at the computer: for the chat's live card. */
  now(): ComputerUseNow {
    const session = this.#session;
    const stopKeys = this.stopKeys;
    return {
      ...(session && { active: this.#active(session) }),
      ...(stopKeys && { stopKeys }),
    };
  }

  #active(session: Session): ComputerUseActive {
    return {
      conversationId: session.conversationId,
      label: session.label,
      ...(session.app && { app: session.app }),
      steps: session.steps,
      maxSteps: MAX_STEPS,
      ...(session.shot && { shot: session.shot.id }),
      since: session.since,
    };
  }

  /** A person turned it on or off (never the assistant). Off stops what's running. */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.store.setEnabled(enabled);
    this.#enabled = enabled;
    if (!enabled) await this.stop();
  }

  async forget(id: string): Promise<void> {
    await this.store.forget(id);
  }

  /** Put Conch on a switch's list and open the System Settings page with it. */
  openAccess(kind: ComputerUseAccessKind): Promise<void> {
    return this.driver.request(kind);
  }

  // ── A chat using the computer ─────────────────────────────────────────

  /**
   * This chat holds the computer until its turn ends (`signal`). Another
   * chat waits its turn: it's told so, and nothing is queued behind its back.
   */
  begin(conversationId: string, signal: AbortSignal): Session {
    const current = this.#session;
    if (current && current.conversationId !== conversationId)
      throw new ComputerBusy(
        'Another chat is using the computer right now. Tell the person, and try again when it’s done.',
      );
    if (current) return current;
    if (signal.aborted) throw new Error('Stopped.');
    const session: Session = {
      conversationId,
      steps: 0,
      label: 'Looking at the screen',
      since: Date.now(),
      edge: false,
    };
    this.#session = session;
    signal.addEventListener('abort', () => this.end(conversationId), { once: true });
    return session;
  }

  /** A step is starting: count it, say it on the edge, and keep the edge lit. */
  step(session: Session, label: string, app?: string): void {
    if (this.#session !== session) return;
    session.steps += 1;
    session.label = label;
    session.app = app;
    this.#edge(session, true);
    clearTimeout(session.idle);
    session.idle = setTimeout(() => this.#edge(session, false), this.deps.idleMs ?? 12_000);
    session.idle.unref?.();
  }

  #edge(session: Session, on: boolean): void {
    if (session.edge === on && !on) return;
    session.edge = on;
    void this.deps.app
      ?.send({ type: 'computer', on, ...(on && { label: session.label.slice(0, 160) }) })
      .catch(() => undefined);
  }

  /** The latest look at the screen, for the live card: in memory, this turn only. */
  keepShot(session: Session, jpeg: Buffer): void {
    if (this.#session !== session) return;
    session.shot = { id: randomBytes(8).toString('hex'), jpeg };
  }

  /** The picture with this id, while its turn is still going. */
  shot(id: string): Buffer | undefined {
    const shot = this.#session?.shot;
    return shot && shot.id === id ? shot.jpeg : undefined;
  }

  /** The chat's turn ended: let go of the computer and forget what was on the screen. */
  end(conversationId: string): void {
    const session = this.#session;
    if (!session || session.conversationId !== conversationId) return;
    clearTimeout(session.idle);
    this.#session = undefined;
    if (session.edge) this.#edge(session, false);
  }

  /** Stop: the chat using the computer stops its turn, now. True when something stopped. */
  async stop(): Promise<boolean> {
    const session = this.#session;
    if (!session) return false;
    this.end(session.conversationId);
    await this.deps.interrupt(session.conversationId).catch(() => undefined);
    return true;
  }

  allowedIn(conversationId: string, appId: string): boolean {
    return this.#allowed.get(conversationId)?.has(appId) ?? false;
  }

  allow(conversationId: string, appId: string): void {
    const apps = this.#allowed.get(conversationId) ?? new Set<string>();
    apps.add(appId);
    this.#allowed.delete(conversationId);
    this.#allowed.set(conversationId, apps);
    while (this.#allowed.size > CHATS_KEPT) {
      const oldest = this.#allowed.keys().next().value;
      if (oldest === undefined) break;
      this.#allowed.delete(oldest);
    }
  }

  /** A chat was deleted: what it was allowed goes with it. */
  forgetChat(conversationId: string): void {
    this.#allowed.delete(conversationId);
    if (this.#session?.conversationId === conversationId) void this.stop();
  }
}

export type { Session as ComputerSession };
