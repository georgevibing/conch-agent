/**
 * Apps you made or added, as apps like any other (ADR 0061 §2): each is an
 * `Integration` — a card, a switch, a policy and Allow · Ask · Off per tool,
 * health — listed, switched, checked and removed through
 * `IntegrationService` like Google's and Slack's.
 *
 * Their tools are Conch's own host tools, `app_<id>__<tool>`, so every
 * provider gets them and what the person chose holds on every engine: a tool
 * that's off isn't offered, one set to Ask asks before it runs (and a change
 * asks once the chat has read something from outside), and an app that
 * reaches the web taints the chat when it answers.
 */
import {
  appToolName,
  type Integration,
  type IntegrationHealth,
  type IntegrationTool,
  POLICY_LABELS,
  toolDecision,
  type ToolPolicy,
  type UpdateIntegrationBody,
} from '@conch/protocol';
import { z } from 'zod';

import type { ToolContext } from '../conversations/manager';
import type { HostTool, HostToolResult } from '../engines/types';
import { IntegrationError, type HostedApps } from '../integrations/service';
import type { AppRecord } from './store';
import type { AppCallOutcome } from './types';

/** Conch's host tools may arrive as `mcp__conch__app_…` (Claude Code) or bare (API engines). */
const bare = (toolName: string) => toolName.replace(/^mcp__conch__/, '');

export const INTEGRATION_PREFIX = 'capp_';

/** What `ConchApps` needs from the service that keeps the apps. */
export interface ConchAppsHost {
  /** Every app, as last read (a turn's tools are made at once). */
  records(): readonly AppRecord[];
  /** Settings an app needs that have no value yet, as last read. */
  missing(id: string): readonly string[];
  /** Why its tools couldn't start, when they couldn't. */
  failure(id: string): string | undefined;
  patch(id: string, fn: (app: AppRecord) => void): Promise<AppRecord | undefined>;
  setSettings(id: string, values: Record<string, string>): Promise<unknown>;
  remove(id: string, options: { keepData: boolean }): Promise<void>;
  /** Start its tools again and list them. */
  checkRuntime(id: string): Promise<void>;
  call(
    id: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<AppCallOutcome>;
  used(id: string): Promise<void>;
  changed(id: string): Promise<void>;
}

/** A record without the keys set to nothing. */
export const without = <T>(values: Record<string, T | undefined>): Record<string, T> =>
  Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, T] => entry[1] !== undefined),
  );

/** The app's integration id: `capp_<id>`. */
export const integrationIdOf = (id: string) => `${INTEGRATION_PREFIX}${id}`;

/** Made in this Conch: Ask before changes. Anyone else's: Ask every time (ADR 0061 §6). */
export const defaultPolicy = (app: Pick<AppRecord, 'source'>) =>
  app.source.kind === 'made' ? ('ask-writes' as const) : ('ask' as const);

/** "API key" → "API key"; "City" → "city": a label inside a sentence. */
export const inSentence = (label: string) =>
  /^[A-Z][a-z]/.test(label) ? `${label.charAt(0).toLowerCase()}${label.slice(1)}` : label;

/** The first few words a call sends, for its card: "fern". */
function gist(input: Record<string, unknown>): string {
  const words = Object.values(input)
    .flatMap((v) => (typeof v === 'string' ? [v] : typeof v === 'number' ? [String(v)] : []))
    .join(', ')
    .replace(/\s+/g, ' ')
    .trim();
  return words.length > 80 ? `${words.slice(0, 79)}…` : words;
}

/**
 * A JSON Schema object as the Zod raw shape a `HostTool` takes. Zod reads
 * the schema itself; a schema it can't read still gives each declared
 * argument, as anything, so no argument is ever dropped on the way in.
 */
export function shapeOf(schema: Record<string, unknown> | undefined): z.ZodRawShape {
  if (!schema || schema['type'] !== 'object') return {};
  try {
    const parsed = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
    if (parsed instanceof z.ZodObject) return parsed.shape as z.ZodRawShape;
  } catch {
    // Read below, one argument at a time.
  }
  const properties = schema['properties'];
  const required = new Set(Array.isArray(schema['required']) ? schema['required'] : []);
  if (!properties || typeof properties !== 'object') return {};
  return Object.fromEntries(
    Object.entries(properties as Record<string, unknown>).map(([key, value]) => {
      const description =
        value &&
        typeof value === 'object' &&
        typeof (value as { description?: unknown }).description === 'string'
          ? String((value as { description: string }).description)
          : undefined;
      const field = description ? z.unknown().describe(description) : z.unknown();
      return [key, required.has(key) ? field : field.optional()];
    }),
  );
}

export class ConchApps implements HostedApps {
  constructor(private readonly host: ConchAppsHost) {}

  owns(id: string): boolean {
    return id.startsWith(INTEGRATION_PREFIX);
  }

  #record(integrationId: string): AppRecord {
    const id = integrationId.slice(INTEGRATION_PREFIX.length);
    const app = this.owns(integrationId) && this.host.records().find((a) => a.id === id);
    if (!app) throw new IntegrationError('not-found', 'Integration not found.');
    return app;
  }

  async list(): Promise<Integration[]> {
    return this.host.records().map((app) => this.toIntegration(app));
  }

  async get(id: string): Promise<Integration> {
    return this.toIntegration(this.#record(id));
  }

  /** The switch, the policy, the tools, and the settings (`values`). */
  async update(id: string, patch: UpdateIntegrationBody): Promise<Integration> {
    const app = this.#record(id);
    if (patch.name !== undefined && patch.name !== app.manifest.name)
      throw new IntegrationError(
        'invalid',
        'An app’s name comes from the app itself. Change it in the app, then update it.',
      );
    const names = new Map(app.tools.map((t) => [appToolName(app.id, t.name), t.name]));
    for (const tool of Object.keys(patch.tools ?? {}))
      if (!names.has(tool)) throw new IntegrationError('invalid', 'That isn’t one of its tools.');
    if (patch.values && Object.keys(patch.values).length)
      await this.host.setSettings(app.id, patch.values);
    await this.host.patch(app.id, (record) => {
      if (patch.enabled !== undefined) record.enabled = patch.enabled;
      if (patch.policy) record.policy = patch.policy;
      const chosen: Record<string, ToolPolicy | undefined> = { ...record.toolPolicies };
      for (const [tool, policy] of Object.entries(patch.tools ?? {})) {
        const own = names.get(tool);
        if (own) chosen[own] = policy ?? undefined;
      }
      record.toolPolicies = without(chosen);
    });
    await this.host.changed(app.id);
    return this.get(id);
  }

  /** Removed from Apps: its data stays, in case it's added again. */
  async remove(id: string): Promise<void> {
    await this.host.remove(this.#record(id).id, { keepData: true });
  }

  async check(id: string): Promise<Integration> {
    await this.host.checkRuntime(this.#record(id).id);
    return this.get(id);
  }

  // ── What the model gets ────────────────────────────────────────────────

  /** The app and its tool for a host tool name, when it's one of these apps'. */
  #toolOf(toolName: string) {
    const name = bare(toolName);
    if (!name.startsWith('app_') || !name.includes('__')) return undefined;
    for (const app of this.host.records())
      for (const tool of app.tools)
        if (appToolName(app.id, tool.name) === name) return { app, tool, name };
    return undefined;
  }

  /** Whether one of these apps' tools may be used: `undefined` when it isn't one. */
  decide(toolName: string): 'allow' | 'ask' | 'off' | undefined {
    const found = this.#toolOf(toolName);
    if (!found) {
      // An app's tool that isn't there any more (removed, renamed) is never run.
      const name = bare(toolName);
      return /^app_[a-z0-9_]+__[a-z][a-z0-9_]*$/.test(name) ? 'off' : undefined;
    }
    const { app, name } = found;
    if (!app.enabled || this.host.missing(app.id).length) return 'off';
    return toolDecision(this.toIntegration(app), name);
  }

  /**
   * The apps' tools as this turn may have them: only apps that are on and
   * set up, without the tools turned off, asking first where the person said
   * Ask (or where a change follows something read from outside).
   */
  tools(ctx: ToolContext): HostTool[] {
    const out: HostTool[] = [];
    for (const app of this.host.records()) {
      if (!app.enabled || this.host.missing(app.id).length) continue;
      for (const tool of app.tools) {
        const name = appToolName(app.id, tool.name);
        if (this.decide(name) === 'off') continue;
        out.push({
          name,
          description: `${tool.description} (From the “${app.manifest.name}” app${tool.changes ? '; it changes things' : ''}.)`,
          input: shapeOf(tool.input),
          run: (args) => this.#run(app.id, tool.name, args, ctx),
        });
      }
    }
    return out;
  }

  async #run(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<string | HostToolResult> {
    const name = appToolName(id, toolName);
    const decision = this.decide(name);
    const app = this.host.records().find((a) => a.id === id);
    const tool = app?.tools.find((t) => t.name === toolName);
    if (decision === 'off' || !app || !tool)
      return {
        text: 'The user turned this off in Apps (or its app isn’t set up). Nothing was done; say so if it matters.',
        effect: 'not-executed',
      };
    // The guard after reading (ADR 0028): a change asks once the chat has read something from outside.
    const tainted = tool.changes ? ctx.untrusted?.() : undefined;
    const restricted = await ctx.restricted?.('apps', id);
    const why = [tainted, restricted].filter(Boolean).join(' ');
    if (decision === 'ask' || why) {
      const what = gist(args);
      const answer = await ctx.ask({
        toolName: name,
        input: args,
        summary: `${app.manifest.name} wants to ${inSentence(tool.title || tool.name)}${what ? `: ${what}` : ''}`,
        ...(why && { taint: why }),
      });
      if (answer === 'deny')
        return {
          text: `The user said no, so ${app.manifest.name} did nothing. Ask them what they’d like instead.`,
          effect: 'not-executed',
        };
    }
    const outcome = await this.host.call(id, toolName, args, ctx.signal);
    // What it fetched came from outside (ADR 0028): the chat reads on, and acts carefully.
    if (app.manifest.reaches.length)
      ctx.taint?.({ kind: 'app', label: `${app.manifest.name} content` });
    await this.host.used(id).catch(() => undefined);
    if (outcome.ok) return outcome.text;
    return `${app.manifest.name} couldn’t do that: ${outcome.text}`;
  }

  /** The apps for `## Apps`: what each is for, in its maker's words, and its tools. */
  async promptLines(): Promise<{ working: string[]; broken: string[] }> {
    const working: string[] = [];
    const broken: string[] = [];
    for (const app of this.host.records()) {
      if (!app.enabled) continue;
      const item = this.toIntegration(app);
      if (item.health.state === 'needs-auth' || item.health.state === 'error') {
        broken.push(`- ${app.manifest.name}: ${item.health.message ?? 'needs attention'}`);
        continue;
      }
      const tools = item.tools
        .filter((t) => t.policy !== 'off' && this.decide(t.name) !== 'off')
        .map((t) => `\`${t.name}\`${t.access === 'write' ? ' (changes things)' : ''}`);
      const who =
        app.source.kind === 'made' ? 'a Conch app the user made' : 'a Conch app the user added';
      const lines = [
        `- ${app.manifest.name} (${who}; tools ${tools.join(', ') || 'none'}): ${app.manifest.tagline} — ${POLICY_LABELS[item.policy].toLowerCase()}.`,
      ];
      // The maker's words, not the user's: shown as what the app says about itself.
      if (app.manifest.instructions)
        lines.push(
          `  How to use it, in its maker’s words: “${app.manifest.instructions.replace(/\s+/g, ' ')}”`,
        );
      if (app.manifest.examples.length)
        lines.push(
          `  People say things like: ${app.manifest.examples.map((e) => `“${e}”`).join('; ')}`,
        );
      working.push(lines.join('\n'));
    }
    return { working, broken };
  }

  // ── Making the integration ─────────────────────────────────────────────

  toIntegration(app: AppRecord): Integration {
    const tools: IntegrationTool[] = app.tools.map((tool) => {
      const policy = app.toolPolicies[tool.name];
      return {
        name: appToolName(app.id, tool.name),
        title: tool.title,
        description: tool.description,
        access: tool.changes ? 'write' : 'read',
        destructive: false,
        ...(policy && { policy }),
      };
    });
    return {
      id: integrationIdOf(app.id),
      conchApp: app.id,
      name: app.manifest.name,
      server: `app_${app.id.replaceAll('-', '_')}`,
      transport: { type: 'host', how: 'Runs sealed off on this computer' },
      auth: 'none',
      enabled: app.enabled,
      policy: app.policy,
      health: this.#health(app),
      tools,
      values: {},
      secrets: [],
      createdAt: app.addedAt,
      updatedAt: Math.max(app.updatedAt, app.lastUsedAt ?? 0),
      ...(app.lastUsedAt && { lastUsedAt: app.lastUsedAt }),
    };
  }

  #health(app: AppRecord): IntegrationHealth {
    if (!app.enabled) return { state: 'off', action: 'turn-on' };
    const missing = this.host.missing(app.id);
    if (missing.length) {
      const labels = missing.map(
        (key) => app.manifest.settings.find((s) => s.key === key)?.label ?? key,
      );
      return {
        state: 'needs-auth',
        message:
          labels.length === 1
            ? `Needs your ${inSentence(labels[0] ?? 'settings')}.`
            : 'Needs a few settings from you.',
        action: 'edit',
      };
    }
    const failure = this.host.failure(app.id);
    if (failure) return { state: 'error', message: failure, action: 'retry' };
    return { state: 'ok', ...(app.lastUsedAt && { okAt: app.lastUsedAt }) };
  }
}
