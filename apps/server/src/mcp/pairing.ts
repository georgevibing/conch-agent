/**
 * Pairing other apps with Conch (ADR 0073), from Settings → Access → Other apps.
 *
 * Pairing is always a person's press, after they confirmed it's them (the
 * routes check), never a tool: an app can't pair itself, and neither can the
 * assistant. One press makes the app's key, writes Conch's entry into its
 * settings (Claude Desktop, Cursor, VS Code), and shows what it may use;
 * removing it takes both away, and ends what it had open.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  McpClient,
  McpOverview,
  McpScope,
  McpTarget,
  PairedMcpClient,
  PairMcpClientBody,
  UpdateMcpClientBody,
} from '@conch/protocol';

import { writeFileAtomic } from '../lib/fs';
import type { McpSessions } from './endpoint';
import type { McpService } from './service';
import { McpError } from './store';
import {
  clientOf,
  connect,
  disconnect,
  ENTRY,
  entryFor,
  isOurs,
  type Launch,
  launchFor,
  look,
  type Place,
  placeOf,
  TARGET_NAMES,
  type TargetApp,
  TargetError,
} from './targets';

const TARGETS = Object.keys(TARGET_NAMES) as TargetApp[];

/** The launcher as this Conch ships it. */
const LAUNCHER_SOURCE = new URL('./launcher.mjs', import.meta.url);

export interface PairingDeps {
  mcp: McpService;
  sessions: McpSessions;
  /** Conch's own port, for the door's address. */
  port: number;
  /** Your own address, when there is one. */
  address?: () => string | undefined;
  /** Where each app keeps its settings (tests point elsewhere). */
  place?: (app: TargetApp) => Place;
  /** The Node an app starts the launcher with: the one Conch runs on. */
  node?: string;
  onHeal?: (message: string) => void;
}

export class McpPairing {
  constructor(private readonly deps: PairingDeps) {}

  get #store() {
    return this.deps.mcp.store;
  }

  /** `~/.conch/mcp/launcher.mjs` */
  get launcher(): string {
    return join(this.#store.dir, 'launcher.mjs');
  }

  #place(app: TargetApp): Place {
    return this.deps.place?.(app) ?? placeOf(app);
  }

  #launch(client: string): Launch {
    return launchFor(this.launcher, client, this.deps.node);
  }

  get endpoint(): string {
    return `http://127.0.0.1:${this.deps.port}/mcp`;
  }

  /** The launcher on disk is this Conch's: written when missing or different. */
  async installLauncher(): Promise<boolean> {
    const source = await readFile(LAUNCHER_SOURCE, 'utf8');
    const now = await readFile(this.launcher, 'utf8').catch(() => undefined);
    if (now === source) return false;
    await writeFileAtomic(this.launcher, source, 0o700);
    return now !== undefined;
  }

  async targets(): Promise<McpTarget[]> {
    const clients = new Map((await this.#store.list()).map((c) => [c.id, c]));
    return Promise.all(
      TARGETS.map(async (app) => {
        const place = this.#place(app);
        const seen = await look(place);
        const clientId = clientOf(seen.entry);
        const paired = clientId !== undefined && clients.has(clientId);
        return {
          app,
          name: TARGET_NAMES[app],
          found: seen.found,
          connected: paired,
          ...(paired && { clientId }),
          file: place.file,
        };
      }),
    );
  }

  async overview(): Promise<McpOverview> {
    const address = this.deps.address?.();
    return {
      clients: await this.#store.list(),
      targets: await this.targets(),
      remote: await this.#store.remote(),
      ...(address && { address: `${address.replace(/\/$/, '')}/mcp` }),
      choices: await this.deps.mcp.choices(),
      endpoint: this.endpoint,
    };
  }

  /** Only scopes that name something there is now: an app id that isn't yours pairs nothing. */
  async #checkScopes(scopes: readonly McpScope[]): Promise<McpScope[]> {
    const known = new Set([
      ...(await this.deps.mcp.choices()).map((c) => c.scope),
      ...(await this.deps.mcp.agentScopes()),
    ]);
    const unknown = scopes.filter((s) => !known.has(s));
    if (unknown.length)
      throw new McpError('invalid', 'One of those apps isn’t connected in Conch any more.');
    return [...new Set(scopes)];
  }

  async pair(body: PairMcpClientBody): Promise<PairedMcpClient> {
    const scopes = await this.#checkScopes(body.scopes);
    await this.installLauncher();
    if (body.app === 'other') {
      const { client, key } = await this.#store.create({
        name: body.name ?? 'Another app',
        app: 'other',
        scopes,
        http: Boolean(body.http),
        remote: Boolean(body.http && body.remote),
      });
      return { client, setup: this.#setup(client, body.http ? key : undefined) };
    }
    const app = body.app;
    const place = this.#place(app);
    const seen = await look(place);
    if (!seen.found) throw new McpError('invalid', `${TARGET_NAMES[app]} isn’t on this computer.`);
    // Connecting again starts afresh: the pairing its settings named goes.
    const before = clientOf(seen.entry);
    const { client } = await this.#store.create({
      name: body.name ?? TARGET_NAMES[app],
      app,
      scopes,
    });
    try {
      await connect(app, place, this.#launch(client.id));
    } catch (error) {
      // Paired, but its settings are the person's to change: say exactly what to add.
      if (error instanceof TargetError)
        return { client, next: error.message, setup: this.#setup(client) };
      await this.#store.remove(client.id);
      throw error;
    }
    if (before && before !== client.id) await this.#forget(before);
    return {
      client,
      wrote: place.file,
      next: `Quit ${TARGET_NAMES[app]} and open it again to see Conch.`,
    };
  }

  #setup(client: McpClient, key?: string): NonNullable<PairedMcpClient['setup']> {
    const launch = this.#launch(client.id);
    return {
      command: launch.command,
      args: launch.args,
      json: JSON.stringify({ mcpServers: { [ENTRY]: entryFor('cursor', launch) } }, null, 2),
      url: this.endpoint,
      ...(key && { key }),
    };
  }

  async update(id: string, body: UpdateMcpClientBody): Promise<McpClient> {
    const current = await this.#store.get(id);
    if (!current) throw new McpError('not-found', 'That app isn’t paired with Conch any more.');
    return this.#store.update(id, {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.scopes !== undefined && { scopes: await this.#checkScopes(body.scopes) }),
      // Only an app that uses its key over HTTP can come in from elsewhere.
      ...(body.remote !== undefined && { remote: body.remote && current.http }),
    });
  }

  /** Apps marked for it may come in over HTTPS through your own address. */
  setRemote(on: boolean): Promise<void> {
    return this.#store.setRemote(on);
  }

  /** Unpair: its key, its sessions, and its entry in the app's settings, all go. */
  async remove(id: string): Promise<boolean> {
    const client = await this.#store.get(id);
    if (!client) return false;
    if (client.app !== 'other') await disconnect(this.#place(client.app), id).catch(() => false);
    await this.#forget(id);
    return true;
  }

  async #forget(id: string): Promise<void> {
    await this.#store.remove(id);
    this.deps.sessions.forget(id);
  }

  /**
   * Keep every connected app working (Repair everything, and each start): the
   * launcher is this Conch's, each app's entry starts it with the Node Conch
   * runs on, and an entry for a pairing that's gone is taken out. Returns what
   * it fixed, one sentence each.
   */
  async heal(): Promise<string[]> {
    const fixed: string[] = [];
    if (await this.installLauncher().catch(() => false))
      fixed.push('Updated how other apps reach Conch');
    const clients = new Map((await this.#store.list()).map((c) => [c.id, c]));
    for (const app of TARGETS) {
      const place = this.#place(app);
      const seen = await look(place);
      if (!isOurs(seen.entry)) continue;
      const id = clientOf(seen.entry);
      if (!id || !clients.has(id)) {
        if (await disconnect(place, id).catch(() => false))
          fixed.push(`Took Conch out of ${TARGET_NAMES[app]}. It was no longer paired.`);
        continue;
      }
      const want = this.#launch(id);
      const stale =
        seen.entry.command !== want.command ||
        JSON.stringify(seen.entry.args) !== JSON.stringify(want.args) ||
        !existsSync(seen.entry.command);
      if (!stale) continue;
      await connect(app, place, want).then(
        () => fixed.push(`Helped ${TARGET_NAMES[app]} find Conch again`),
        () => undefined,
      );
    }
    for (const message of fixed) this.deps.onHeal?.(message);
    return fixed;
  }
}
