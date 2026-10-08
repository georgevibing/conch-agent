/**
 * Conch as an MCP server for your other apps (ADR 0073): Claude Desktop,
 * Cursor, VS Code, or anything that speaks MCP, reaching Conch's memory,
 * skills, your apps and the browser.
 *
 * Each app is paired by you and holds a scope list. What it's offered is only
 * what its scopes name, and every call is checked against them again. Memory
 * is read and suggested directly (a suggestion always waits for your OK).
 * Everything else — a skill, the browser, one of your apps — runs as one turn
 * of the app's own chat in Conch (`call.ts`), so it's held to everything a
 * chat is: your choices in Apps, the guard after reading, the skill it loaded,
 * asking you, Activity and Undo.
 */
import type {
  EngineId,
  Integration,
  McpChoice,
  McpClient,
  McpScope,
  Memory,
  SkillsList,
} from '@conch/protocol';
import { MCP_BASE_SCOPES, MCP_SCOPE_WORDS } from '@conch/protocol';
import { z } from 'zod';

import type { ConversationManager, ToolContext } from '../conversations/manager';
import { summarizeToolUse } from '../conversations/summarize';
import { toJsonSchema, wireName } from '../engines/api/jsonschema';
import type { EngineMcpServer, HostTool } from '../engines/types';
import { Mutex } from '../lib/fs';
import type { MemoryStore } from '../memory/store';
import { argumentProblem, CallEngine, type CallResult } from './call';
import type { McpClientStore } from './store';

/** The browser's tools another app may use: never handing it to you, never a passkey. */
export const BROWSER_TOOLS: ReadonlySet<string> = new Set([
  'browser_open',
  'browser_read',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_select',
  'browser_scroll',
  'browser_back',
  'browser_screenshot',
  'browser_wait',
]);

/** How long a listing of your apps' own tools (which connects to them) is reused. */
const LISTED_MS = 60_000;

/** A tool as another app sees it, and how Conch runs it. */
export interface ExposedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  run:
    | { kind: 'search-memory' }
    | { kind: 'suggest-memory' }
    | { kind: 'list-skills' }
    /** In the app's chat: a host tool by its name, or an app's `mcp__<server>__<tool>`. */
    | { kind: 'chat'; tool: string; server?: string };
}

export interface McpApps {
  /** Every app you connected, Conch's own included. */
  list(): Promise<Integration[]>;
  /** An app whose tools are Conch's own host tools (Gmail, Slack, the apps you made). */
  hosted(id: string): boolean;
  forTurn(prompt: string): Promise<{
    servers: Record<string, EngineMcpServer>;
    disallowedTools: string[];
  }>;
  bridge(
    servers: Record<string, EngineMcpServer>,
    disallowedTools: string[],
  ): Promise<{
    tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
    close(): Promise<void>;
  }>;
}

export interface McpDeps {
  store: McpClientStore;
  conversations: Pick<ConversationManager, 'start' | 'interrupt' | 'toolsFor'>;
  /** The default provider: an app's chat record borrows its id, and never runs it. */
  engineId: () => EngineId;
  memory: MemoryStore;
  /** Settings → Safety → Check what it remembers (ADR 0087). */
  checkMemories?: () => Promise<boolean>;
  /** Meaning search (ADR 0032); keyword search without it. */
  search?: (query: string) => Promise<{ memory: Memory }[]>;
  skills: { list(): Promise<SkillsList> };
  apps: McpApps;
  /** Your agents, which another agent may be let talk to over A2A (ADR 0112). */
  agents?: () => Promise<{ id: string }[]>;
}

const textOf = (result: string): CallResult => ({ text: result, isError: false });
const refusal = (text: string): CallResult => ({ text, isError: true });

/** `mcp__notion__search` → `notion__search`, kept to the names every app accepts. */
const exposedName = (server: string, tool: string, taken: ReadonlySet<string>) =>
  wireName(`${server}__${tool}`, taken);

export class McpService {
  /** One call at a time per app: its chat runs one turn at a time. */
  readonly #queues = new Map<string, Mutex>();
  readonly #listed = new Map<
    string,
    {
      at: number;
      tools: {
        server: string;
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
      }[];
    }
  >();

  constructor(readonly deps: McpDeps) {}

  get store(): McpClientStore {
    return this.deps.store;
  }

  /** What an app could be allowed to use, now: the base scopes, and each app that's on. */
  async choices(): Promise<McpChoice[]> {
    const apps = await this.deps.apps.list().catch(() => []);
    return [
      ...MCP_BASE_SCOPES.map((scope) => ({ scope, ...MCP_SCOPE_WORDS[scope] })),
      ...apps
        .filter((app) => app.enabled)
        .map((app) => ({
          scope: `app:${app.id}` as McpScope,
          title: app.name,
          detail: 'Its tools, as you set them in Apps.',
          ...(app.catalogId && { catalogId: app.catalogId }),
          ...(app.brand && { brand: app.brand }),
          ...(app.color && { color: app.color }),
        })),
    ];
  }

  /**
   * Your agents as scopes (`agent:<id>`): another agent may talk to them over
   * A2A (ADR 0112). Not among an app's `choices`: they're chosen in Settings → Agents.
   */
  async agentScopes(): Promise<McpScope[]> {
    const agents = (await this.deps.agents?.().catch(() => [])) ?? [];
    return agents.map((a) => `agent:${a.id}` as McpScope);
  }

  /** Conch's own tools, as a turn in this app's chat would be offered them. */
  #hostTools(client: McpClient): HostTool[] {
    const ctx: ToolContext = {
      conversationId: client.conversationId ?? `c_${client.id}`,
      append: () => undefined,
      engine: new CallEngine(this.deps.engineId(), client.name, { name: '', args: {} }),
      permissionMode: 'default',
      ask: async () => 'deny',
      signal: new AbortController().signal,
      unattended: true,
    };
    return this.deps.conversations.toolsFor(ctx);
  }

  /** Your apps' own tools (MCP servers), which takes connecting to them: kept a minute. */
  async #appTools(servers: string[]) {
    const key = [...servers].sort().join(',');
    const kept = this.#listed.get(key);
    if (kept && Date.now() - kept.at < LISTED_MS) return kept.tools;
    const loaded = await this.deps.apps.forTurn('');
    const wanted = Object.fromEntries(
      Object.entries(loaded.servers).filter(([name]) => servers.includes(name)),
    );
    if (!Object.keys(wanted).length) return [];
    const bridge = await this.deps.apps.bridge(wanted, loaded.disallowedTools);
    try {
      const tools = bridge.tools.flatMap((tool) => {
        const server = servers.find((name) => tool.name.startsWith(`mcp__${name}__`));
        return server
          ? [
              {
                server,
                name: tool.name.slice(`mcp__${server}__`.length),
                description: tool.description,
                inputSchema: tool.inputSchema,
              },
            ]
          : [];
      });
      this.#listed.set(key, { at: Date.now(), tools });
      return tools;
    } finally {
      await bridge.close().catch(() => undefined);
    }
  }

  /** Every tool this app may use now, and nothing else. */
  async tools(client: McpClient): Promise<ExposedTool[]> {
    const scopes = new Set(client.scopes);
    const out: ExposedTool[] = [];
    if (scopes.has('memory.read'))
      out.push({
        name: 'search_memory',
        description:
          'Search what Conch knows about the user (their memories), by meaning. Returns the closest matches, one per line.',
        inputSchema: toJsonSchema({ query: z.string().min(1).max(200) }),
        annotations: { readOnlyHint: true },
        run: { kind: 'search-memory' },
      });
    if (scopes.has('memory.write'))
      out.push({
        name: 'suggest_memory',
        description:
          'Suggest one durable fact about the user for Conch to remember: one concise, self-contained, third-person statement. It waits for the user’s OK in Conch before it’s remembered.',
        inputSchema: toJsonSchema({ content: z.string().min(1).max(500) }),
        annotations: { readOnlyHint: false, destructiveHint: false },
        run: { kind: 'suggest-memory' },
      });
    if (scopes.has('skills'))
      out.push({
        name: 'list_skills',
        description:
          'List the skills the user saved in Conch: instructions for particular kinds of task. Load one with use_skill.',
        inputSchema: toJsonSchema({}),
        annotations: { readOnlyHint: true },
        run: { kind: 'list-skills' },
      });

    const apps = (await this.deps.apps.list().catch(() => [])).filter(
      (app) => app.enabled && scopes.has(`app:${app.id}`),
    );
    const hostedNames = new Set(
      apps
        .filter((app) => this.deps.apps.hosted(app.id))
        .flatMap((app) => app.tools.filter((t) => t.policy !== 'off').map((t) => t.name)),
    );
    const wantHost = (name: string) =>
      (scopes.has('skills') && name === 'use_skill') ||
      (scopes.has('browser') && BROWSER_TOOLS.has(name)) ||
      hostedNames.has(name);
    const taken = new Set(out.map((t) => t.name));
    for (const tool of this.#hostTools(client)) {
      if (!wantHost(tool.name) || taken.has(tool.name)) continue;
      taken.add(tool.name);
      out.push({
        name: tool.name,
        description: tool.description,
        inputSchema: toJsonSchema(tool.input),
        run: { kind: 'chat', tool: tool.name },
      });
    }

    const servers = apps.filter((app) => !this.deps.apps.hosted(app.id)).map((app) => app.server);
    if (servers.length) {
      const named = new Map(apps.map((app) => [app.server, app.name]));
      for (const tool of await this.#appTools(servers).catch(() => [])) {
        const name = exposedName(tool.server, tool.name, taken);
        taken.add(name);
        out.push({
          name,
          description: `${named.get(tool.server) ?? tool.server}: ${tool.description}`.slice(
            0,
            2_000,
          ),
          inputSchema: tool.inputSchema,
          run: { kind: 'chat', tool: `mcp__${tool.server}__${tool.name}`, server: tool.server },
        });
      }
    }
    return out;
  }

  /** Run one call for this app: only a tool it was offered, checked again here. */
  async call(
    client: McpClient,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallResult> {
    // As it is now: what it may use could have changed since it connected.
    const current = await this.deps.store.get(client.id);
    if (!current) return refusal('This app isn’t paired with Conch any more.');
    client = current;
    const tool = (await this.tools(client)).find((t) => t.name === name);
    if (!tool)
      return refusal(
        `“${name}” isn’t something ${client.name} may use in Conch. The person chooses what it may use in Conch: Settings → Other apps.`,
      );
    void this.deps.store.touch(client.id).catch(() => undefined);
    switch (tool.run.kind) {
      case 'search-memory': {
        const parsed = z
          .object({ query: z.string().min(1).max(200) })
          .strict()
          .safeParse(args);
        if (!parsed.success) return refusal(argumentProblem(parsed.error));
        const found = this.deps.search
          ? (await this.deps.search(parsed.data.query)).map((r) => r.memory)
          : await this.deps.memory.search(parsed.data.query);
        const kept = found.filter((m) => !m.pending);
        return textOf(
          kept.length
            ? kept.map((m) => `- (${m.kind}) ${m.content}`).join('\n')
            : 'Conch doesn’t know anything about that.',
        );
      }
      case 'suggest-memory': {
        const parsed = z
          .object({ content: z.string().min(1).max(500) })
          .strict()
          .safeParse(args);
        if (!parsed.success) return refusal(argumentProblem(parsed.error));
        // It always waits for the person; the memory check says why when it looks planted (ADR 0087).
        const memory = await this.deps.memory.add(
          {
            content: parsed.data.content,
            source: 'agent',
            pending: true,
            untrusted: `Suggested by ${client.name}, through Conch.`,
            provenance: { via: 'app', read: [client.name.slice(0, 120)] },
          },
          {
            via: 'app',
            cameFrom: `${client.name}, an app using Conch`,
            ...(this.deps.checkMemories && {
              on: await this.deps.checkMemories().catch(() => true),
            }),
          },
        );
        return textOf(
          memory.pending
            ? 'Suggested. It waits for the user’s OK in Conch before it’s remembered.'
            : 'Conch already knows that.',
        );
      }
      case 'list-skills': {
        const { skills } = await this.deps.skills.list();
        const usable = skills.filter(
          (s) =>
            s.mode !== 'off' &&
            !s.problem &&
            s.review?.verdict !== 'danger' &&
            s.signature?.state !== 'invalid',
        );
        return textOf(
          usable.length
            ? usable.map((s) => `- ${s.name}: ${s.description}`).join('\n')
            : 'The user hasn’t saved any skills yet.',
        );
      }
      case 'chat':
        return this.#inChat(client, tool.run.tool, tool.run.server, args, signal);
    }
  }

  /** One call as one turn of the app's own chat, after any call before it. */
  #inChat(
    client: McpClient,
    tool: string,
    server: string | undefined,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<CallResult> {
    let queue = this.#queues.get(client.id);
    if (!queue) this.#queues.set(client.id, (queue = new Mutex()));
    return queue.run(async () => {
      if (signal.aborted) return refusal('Stopped before it started.');
      // Fresh: its scopes or its chat may have changed while it waited.
      const current = await this.deps.store.get(client.id);
      if (!current) return refusal('This app isn’t paired with Conch any more.');
      const engine = new CallEngine(this.deps.engineId(), current.name, { name: tool, args });
      const shown = tool.startsWith('mcp__') ? tool : `mcp__conch__${tool}`;
      const allowed = (name: string) => name === tool || name === shown;
      const start = (conversationId?: string) =>
        this.deps.conversations.start({
          ...(conversationId && { conversationId }),
          title: current.name,
          text: `${current.name}: ${summarizeToolUse(shown, args)}`,
          options: { permissionMode: 'default' },
          origin: { kind: 'client', clientId: current.id, name: current.name },
          engine,
          extras: {
            permissionMode: 'default',
            toolAllowed: allowed,
            ...(server && { apps: [server] }),
          },
        });
      let started: Awaited<ReturnType<typeof start>>;
      try {
        started = await start(current.conversationId);
      } catch {
        // Its chat was deleted (or never was): a new one.
        started = await start();
      }
      if (started.conversationId !== current.conversationId)
        await this.deps.store
          .update(current.id, { conversationId: started.conversationId })
          .catch(() => undefined);
      const stop = () => void this.deps.conversations.interrupt(started.conversationId);
      signal.addEventListener('abort', stop, { once: true });
      try {
        const turn = await started.result;
        return (
          engine.result ??
          refusal(
            turn.outcome === 'interrupted'
              ? 'Stopped before it finished.'
              : (turn.error ?? 'It didn’t finish. Try again in a moment.'),
          )
        );
      } finally {
        signal.removeEventListener('abort', stop);
      }
    });
  }
}
