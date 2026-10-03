/**
 * Gmail, Google Calendar and Google Drive as ordinary apps (ADR 0048). Each is
 * an `Integration` like any other — a card, an on/off switch, a policy and
 * Allow · Ask · Off per tool, health — but it's made from the sealed Google
 * store rather than kept in `integrations.json`: the accounts (and their
 * credentials) stay where ADR 0037 put them, and one Google account can serve
 * all three apps.
 *
 * Its tools are Conch's own host tools, so what a person chose is held here,
 * on every engine: a tool that's off isn't offered at all, and one set to Ask
 * asks before it runs. Saving a Gmail draft asks every time whatever the
 * policy says (ADR 0037's approval binding), so it can be Ask or Off only.
 */
import {
  type GoogleAccount,
  type GoogleAppId,
  GOOGLE_APP_CAPABILITIES,
  GoogleAppId as AppId,
  type GoogleToolName,
  type GoogleCapability,
  type Integration,
  type IntegrationHealth,
  type IntegrationTool,
  POLICY_LABELS,
  type ServerEvent,
  toolDecision,
  type UpdateIntegrationBody,
} from '@conch/protocol';

import type { ToolContext } from '../conversations/manager';
import type { HostTool } from '../engines/types';
import { CATALOG } from '../integrations/catalog';
import { IntegrationError } from '../integrations/service';
import type { GoogleService } from './service';
import type { AppSettings, GoogleData } from './store';

const DRAFT = 'google_mail_create_draft';
const ACCOUNTS = 'google_accounts';

interface AppTool extends IntegrationTool {
  /** One of the names the chat has words for (`@conch/protocol` `APP_TOOL_WORDS`). */
  name: GoogleToolName;
  /** What an account needs for this tool to work. */
  needs: GoogleCapability;
}

/** Each app's tools, in a person's words. The names are the tools' own (ADR 0037). */
const TOOLS: Record<GoogleAppId, AppTool[]> = {
  gmail: [
    {
      name: 'google_mail_search',
      title: 'Search your mail',
      description:
        'Finds emails with Gmail’s own search. It says which emails match, not what they say.',
      access: 'read',
      destructive: false,
      needs: 'mail-read',
    },
    {
      name: 'google_mail_read',
      title: 'Read an email',
      description: 'Reads one email as plain text, with who sent it and a link to it in Gmail.',
      access: 'read',
      destructive: false,
      needs: 'mail-read',
    },
    {
      name: DRAFT,
      title: 'Save a draft',
      description:
        'Saves a new email or a reply in your Drafts, for you to send yourself. It never sends, and asks you every time.',
      access: 'write',
      destructive: false,
      alwaysAsks: true,
      needs: 'mail-draft',
    },
  ],
  'google-calendar': [
    {
      name: 'google_calendar_briefing',
      title: 'Read your calendar',
      description:
        'Reads the events in a window of up to a month. It never creates or changes events.',
      access: 'read',
      destructive: false,
      needs: 'calendar-read',
    },
  ],
  'google-drive': [
    {
      name: 'google_drive_search',
      title: 'Find files',
      description: 'Searches the names of the files in your Drive. It never changes them.',
      access: 'read',
      destructive: false,
      needs: 'drive-read',
    },
    {
      name: 'google_drive_read',
      title: 'Read a file’s details',
      description: 'Reads a file’s name, type, date and description — not what’s in it.',
      access: 'read',
      destructive: false,
      needs: 'drive-read',
    },
  ],
};

const APP_OF = new Map<string, GoogleAppId>(
  Object.entries(TOOLS).flatMap(([app, tools]) => tools.map((t) => [t.name, app as GoogleAppId])),
);

/** Conch's host tools may arrive as `mcp__conch__google_…` (Claude Code) or bare (API engines). */
const bare = (toolName: string) => toolName.replace(/^mcp__conch__/, '');

/** A check that failed for a reason that passes (offline) is tried again after these. */
const RETRY_AFTER_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const CHECK_EVERY_MS = 30 * 60_000;
const STALE_MS = 25 * 60_000;

export interface GoogleAppsDeps {
  emit: (event: ServerEvent) => void;
  /** A quiet “fixed on its own” note. */
  onHeal?: (message: string) => void;
  /** Tests: no timers. */
  manualChecks?: boolean;
  retryAfterMs?: number[];
}

/** One summary per call, so the card in the chat says what's about to happen. */
function summary(name: string, args: Record<string, unknown>): string {
  const q = typeof args.query === 'string' ? `“${args.query.slice(0, 80)}”` : '';
  switch (name) {
    case 'google_mail_search':
      return `search your Gmail for ${q}`;
    case 'google_mail_read':
      return 'read an email in Gmail';
    case 'google_calendar_briefing':
      return 'read your Google Calendar';
    case 'google_drive_search':
      return `search your Google Drive for ${q}`;
    case 'google_drive_read':
      return 'read a file’s details in Google Drive';
    default:
      return 'use Google';
  }
}

export class GoogleApps {
  #data?: GoogleData;
  #loading?: Promise<GoogleData>;
  /** What each app looked like last time it was told, so only real changes are sent. */
  #seen = new Map<GoogleAppId, string>();
  #retries = new Map<string, { attempt: number; timer: NodeJS.Timeout; retryAt: number }>();
  #timer?: NodeJS.Timeout;
  #refreshing: Promise<void> = Promise.resolve();

  constructor(
    private readonly google: GoogleService,
    private readonly deps: GoogleAppsDeps,
  ) {
    google.store.onChange(() => void this.refresh().catch(() => undefined));
    void this.refresh().catch(() => undefined);
  }

  /** Read the store again and tell the web app what changed. One look at a time, in order. */
  refresh(): Promise<void> {
    const next = this.#refreshing.then(() => this.#refresh());
    this.#refreshing = next.catch(() => undefined);
    return next;
  }

  async #refresh(): Promise<void> {
    this.#loading = this.google.store.read();
    const data = await this.#loading;
    const before = this.#data;
    this.#data = data;
    const now = new Map(this.#build(data).map((i) => [i.id as GoogleAppId, i]));
    for (const id of AppId.options) {
      const item = now.get(id);
      const key = item ? JSON.stringify(item) : '';
      if (key === (this.#seen.get(id) ?? '')) continue;
      this.#seen.set(id, key);
      if (item) this.deps.emit({ type: 'integration.changed', integration: item });
      else if (before) this.deps.emit({ type: 'integration.deleted', integrationId: id });
    }
    this.#heal(before, data);
  }

  async #read(): Promise<GoogleData> {
    return this.#data ?? this.#loading ?? this.google.store.read();
  }

  owns(id: string): id is GoogleAppId {
    return AppId.safeParse(id).success;
  }

  async list(): Promise<Integration[]> {
    return this.#build(await this.#read());
  }

  async get(id: string): Promise<Integration> {
    const item = (await this.list()).find((i) => i.id === id);
    if (!item) throw new IntegrationError('not-found', 'Integration not found.');
    return item;
  }

  /** The switch, the policy and the tools. A draft is never saved without asking. */
  async update(id: GoogleAppId, patch: UpdateIntegrationBody): Promise<Integration> {
    await this.get(id);
    for (const [tool, policy] of Object.entries(patch.tools ?? {})) {
      const known = TOOLS[id].find((t) => t.name === tool);
      if (!known) throw new IntegrationError('invalid', 'That isn’t one of its tools.');
      if (known.alwaysAsks && policy === 'allow')
        throw new IntegrationError(
          'invalid',
          'Saving a Gmail draft always asks you first. You can turn it off instead.',
        );
    }
    await this.google.store.update((data) => {
      const app = settingsOf(data, id);
      if (patch.enabled !== undefined) app.enabled = patch.enabled;
      if (patch.policy) app.policy = patch.policy;
      const cleared = new Set(
        Object.entries(patch.tools ?? {}).flatMap(([tool, policy]) => (policy ? [] : [tool])),
      );
      app.tools = Object.fromEntries(
        Object.entries({ ...app.tools, ...patch.tools }).flatMap(([tool, policy]) =>
          policy && !cleared.has(tool) ? [[tool, policy]] : [],
        ),
      );
      data.apps[id] = app;
    });
    await this.refresh();
    return this.get(id);
  }

  /** An account was connected with these: the apps they make work are shown again. */
  async showFor(capabilities: GoogleCapability[]): Promise<void> {
    for (const id of AppId.options)
      if (GOOGLE_APP_CAPABILITIES[id].some((c) => capabilities.includes(c))) await this.show(id);
  }

  /** Connected again from its tile (or a chat's offer): shown and offered once more. */
  async show(id: GoogleAppId): Promise<void> {
    await this.google.store.update((data) => {
      const app = settingsOf(data, id);
      // Coming back after a disconnect starts on; one that's only switched off stays as it was.
      if (app.hidden) app.enabled = true;
      app.hidden = false;
      app.createdAt ??= Date.now();
      data.apps[id] = app;
    });
    await this.refresh();
  }

  /**
   * Disconnect one app. A Google account that no other app still uses is
   * disconnected too (its access revoked at Google first); one that Calendar
   * or Drive still use stays.
   */
  async remove(id: GoogleAppId): Promise<void> {
    const data = await this.google.store.read();
    for (const account of accountsFor(data, id)) {
      const others = AppId.options.filter(
        (other) => other !== id && !settingsOf(data, other).hidden && usable(account, other),
      );
      if (others.length) continue;
      try {
        await this.google.disconnect(account.id);
      } catch (error) {
        throw new IntegrationError(
          'unavailable',
          error instanceof Error ? error.message : 'Google could not be reached. Try again.',
        );
      }
    }
    await this.google.store.update((d) => {
      const app = settingsOf(d, id);
      app.hidden = true;
      d.apps[id] = app;
    });
    await this.refresh();
  }

  /** Look again now at every account the app uses. */
  async check(id: GoogleAppId): Promise<Integration> {
    for (const account of accountsFor(await this.google.store.read(), id))
      await this.#checkAccount(account.id);
    await this.refresh();
    return this.get(id);
  }

  async #checkAccount(accountId: string) {
    const status = await this.google.check(accountId).catch(() => undefined);
    const account = status?.accounts.find((a) => a.id === accountId);
    this.#schedule(accountId, account?.state === 'unavailable');
  }

  /** A blip is tried again lighter and lighter; a sign-in that only a person can fix isn't. */
  #schedule(accountId: string, again: boolean) {
    const retrying = this.#retries.get(accountId);
    if (retrying) clearTimeout(retrying.timer);
    const delays = this.deps.retryAfterMs ?? (this.deps.manualChecks ? undefined : RETRY_AFTER_MS);
    if (!again || !delays?.length) {
      this.#retries.delete(accountId);
      return;
    }
    const attempt = retrying ? retrying.attempt + 1 : 0;
    const delay = delays[Math.min(attempt, delays.length - 1)] ?? CHECK_EVERY_MS;
    const timer = setTimeout(
      () =>
        void this.#checkAccount(accountId)
          .then(() => this.refresh())
          .catch(() => undefined),
      delay,
    );
    timer.unref();
    this.#retries.set(accountId, { attempt, timer, retryAt: Date.now() + delay });
  }

  /** An account that was out of reach and works again leaves a quiet note. */
  #heal(before: GoogleData | undefined, after: GoogleData) {
    if (!before) return;
    const was = new Map(allAccounts(before).map((a) => [a.id, a.state]));
    for (const account of allAccounts(after)) {
      if (was.get(account.id) !== 'unavailable' || account.state !== 'ready') continue;
      const apps = AppId.options
        .filter((app) => !settingsOf(after, app).hidden && usable(account, app))
        .map((app) => CATALOG.get(app)?.name ?? app);
      if (apps.length)
        this.deps.onHeal?.(
          `${apps.join(' and ')} couldn’t reach Google for a while; ${apps.length > 1 ? 'they’re' : 'it’s'} working again.`,
        );
    }
  }

  start() {
    if (this.deps.manualChecks) return;
    const look = async (olderThan: number) => {
      for (const account of allAccounts(await this.google.store.read()))
        if (Date.now() - (account.checkedAt ?? 0) >= olderThan)
          await this.#checkAccount(account.id);
    };
    const startup = setTimeout(() => void look(0).catch(() => undefined), 5_000);
    startup.unref();
    this.#timer = setInterval(() => void look(STALE_MS).catch(() => undefined), CHECK_EVERY_MS);
    this.#timer.unref();
  }

  stop() {
    clearInterval(this.#timer);
    for (const { timer } of this.#retries.values()) clearTimeout(timer);
    this.#retries.clear();
  }

  // ── What the model gets ────────────────────────────────────────────────

  /** Whether a Google tool may be used, and how: `undefined` for tools that aren't Google's. */
  decide(toolName: string): 'allow' | 'ask' | 'off' | undefined {
    const name = bare(toolName);
    const data = this.#data;
    if (name === ACCOUNTS) return data && this.#live(data).length ? 'allow' : 'off';
    const app = APP_OF.get(name);
    if (!app) return undefined;
    if (!data) return 'off';
    const item = this.#build(data).find((i) => i.id === app);
    if (!item?.enabled || !item.tools.some((t) => t.name === name)) return 'off';
    const decision = toolDecision(item, name);
    // The draft tool asks inside itself, with the real account and the whole draft.
    return name === DRAFT && decision !== 'off' ? 'allow' : decision;
  }

  /**
   * Google's tools as this turn may have them: only the apps that are
   * connected and on, without the tools turned off, and asking first where
   * the person said Ask.
   */
  tools(all: HostTool[], ctx: ToolContext): HostTool[] {
    return all
      .filter((tool) => this.decide(tool.name) !== 'off')
      .map((tool) => this.#guarded(tool, ctx));
  }

  #guarded(tool: HostTool, ctx: ToolContext): HostTool {
    const offText = {
      text: 'The user turned this off in Apps. Nothing was done; say so if it matters.',
      effect: 'not-executed' as const,
    };
    const verification = tool.verification && {
      ...tool.verification,
      reconcile: (args: Record<string, unknown>, operationId: string) =>
        this.decide(tool.name) === 'off'
          ? Promise.resolve({ state: 'unknown' as const })
          : (tool.verification?.reconcile(args, operationId) ??
            Promise.resolve({ state: 'unknown' as const })),
    };
    return {
      ...tool,
      ...(verification && { verification }),
      run: async (args, context) => {
        const decision = this.decide(tool.name);
        if (decision === 'off') return offText;
        if (tool.name === ACCOUNTS) return this.#accounts();
        if (decision === 'ask') {
          const answer = await ctx.ask({
            toolName: tool.name,
            input: args,
            summary: summary(tool.name, args),
          });
          if (answer === 'deny')
            return {
              text: 'The user said no, so nothing was read. Ask them what they’d like instead.',
              effect: 'not-executed' as const,
            };
        }
        const result = await tool.run(args, context);
        await this.#used(APP_OF.get(tool.name)).catch(() => undefined);
        return result;
      },
    };
  }

  /** The accounts as the model may see them: only for apps that are on, never a credential. */
  async #accounts(): Promise<string> {
    const data = await this.#read();
    const live = this.#live(data);
    const status = await this.google.status();
    const allowed = new Set<GoogleCapability>(live.flatMap((app) => GOOGLE_APP_CAPABILITIES[app]));
    return JSON.stringify({
      accounts: status.accounts
        .map((a) => ({ ...a, capabilities: a.capabilities.filter((c) => allowed.has(c)) }))
        .filter((a) => a.capabilities.length),
      note: 'An account signed in with an app password reaches Gmail only. Choose the account explicitly; ask if personal or work is unclear.',
    });
  }

  async #used(app: GoogleAppId | undefined) {
    if (!app) return;
    const last = this.#data?.apps[app]?.lastUsedAt;
    // At most once a minute, so a busy turn doesn't rewrite the file for every call.
    if (last && Date.now() - last < 60_000) return;
    await this.google.store.update((data) => {
      const settings = settingsOf(data, app);
      settings.lastUsedAt = Date.now();
      data.apps[app] = settings;
    });
  }

  /** Apps that are connected, shown and on. */
  #live(data: GoogleData): GoogleAppId[] {
    return this.#build(data)
      .filter((i) => i.enabled)
      .map((i) => i.id as GoogleAppId);
  }

  /** The integrations section of the prompt, for Google's apps. */
  async promptLines(): Promise<{ working: string[]; broken: string[] }> {
    const items = (await this.list()).filter((i) => i.enabled);
    const working: string[] = [];
    const broken: string[] = [];
    for (const item of items) {
      if (item.health.state === 'needs-auth' || item.health.state === 'error') {
        broken.push(`- ${item.name}: ${item.health.message ?? 'needs attention'}`);
        continue;
      }
      const tools = item.tools.filter((t) => t.policy !== 'off').map((t) => `\`${t.name}\``);
      const entry = CATALOG.get(item.id);
      working.push(
        `- ${item.name} (Conch’s own tools ${tools.join(', ')}; ${item.account ?? ''})${entry ? `: ${entry.tagline}` : ''} — ${POLICY_LABELS[item.policy].toLowerCase()}${item.id === 'gmail' ? '; saving a draft always asks, and nothing is ever sent' : ''}.`,
      );
    }
    return { working, broken };
  }

  // ── Making the integrations ────────────────────────────────────────────

  #build(data: GoogleData): Integration[] {
    const out: Integration[] = [];
    for (const id of AppId.options) {
      const settings = settingsOf(data, id);
      const accounts = accountsFor(data, id);
      if (settings.hidden || !accounts.length) continue;
      const entry = CATALOG.get(id);
      const tools = TOOLS[id]
        .filter((t) => accounts.some((a) => a.capabilities.includes(t.needs)))
        .map(({ needs: _needs, ...tool }) => {
          const policy = settings.tools[tool.name];
          return policy ? { ...tool, policy } : tool;
        });
      const passwords = accounts.filter((a) => a.via === 'app-password').length;
      const how =
        passwords === accounts.length
          ? 'With an app password (Gmail only, can’t send)'
          : passwords
            ? 'With Google sign-in and an app password'
            : 'With Google sign-in, through your own Google Cloud app';
      const checked = accounts.map((a) => a.checkedAt ?? 0);
      out.push({
        id,
        catalogId: id,
        name: entry?.name ?? id,
        server: id,
        transport: { type: 'host', how },
        auth: passwords === accounts.length ? 'token' : 'oauth',
        enabled: settings.enabled,
        policy: settings.policy,
        health: this.#health(settings, accounts),
        tools,
        values: {},
        secrets: [],
        account: accounts.map((a) => a.email).join(', '),
        createdAt: settings.createdAt ?? (Math.min(...checked) || 0),
        updatedAt: Math.max(...checked, settings.lastUsedAt ?? 0),
        ...(settings.lastUsedAt && { lastUsedAt: settings.lastUsedAt }),
      });
    }
    return out;
  }

  #health(settings: AppSettings, accounts: GoogleAccount[]): IntegrationHealth {
    const checkedAt = Math.max(...accounts.map((a) => a.checkedAt ?? 0)) || undefined;
    const base = { checkedAt, ...(checkedAt && { okAt: checkedAt }) };
    if (!settings.enabled) return { state: 'off', action: 'turn-on', ...base };
    const who = (a: GoogleAccount) => (accounts.length > 1 ? `${a.email}: ` : '');
    const signIn = accounts.find((a) => a.state === 'needs-auth');
    if (signIn)
      return {
        state: 'needs-auth',
        message: `${who(signIn)}${signIn.message ?? 'Sign in again to keep using it.'}`,
        action: 'reconnect',
        checkedAt,
      };
    const away = accounts.find((a) => a.state === 'unavailable');
    if (away) {
      const retry = this.#retries.get(away.id);
      return {
        state: 'error',
        message: `${who(away)}${away.message ?? 'Google could not be reached.'}`,
        action: 'retry',
        checkedAt,
        ...(retry && { retryAt: retry.retryAt }),
      };
    }
    return { state: 'ok', ...base };
  }
}

function settingsOf(data: GoogleData, id: GoogleAppId): AppSettings {
  const saved = data.apps[id];
  return {
    enabled: saved?.enabled ?? true,
    policy: saved?.policy ?? 'ask-writes',
    tools: { ...saved?.tools },
    hidden: saved?.hidden ?? false,
    ...(saved?.createdAt && { createdAt: saved.createdAt }),
    ...(saved?.lastUsedAt && { lastUsedAt: saved.lastUsedAt }),
  };
}

function allAccounts(data: GoogleData): GoogleAccount[] {
  return [
    ...Object.values(data.accounts).map((a) => a.profile),
    ...Object.values(data.passwords).map((p) => p.profile),
  ];
}

const usable = (account: GoogleAccount, app: GoogleAppId) =>
  GOOGLE_APP_CAPABILITIES[app].some((c) => account.capabilities.includes(c));

function accountsFor(data: GoogleData, app: GoogleAppId): GoogleAccount[] {
  return allAccounts(data).filter((a) => usable(a, app));
}
