/**
 * Slack as an app like Gmail, Google Calendar and Google Drive (ADR 0052):
 * one `Integration`, listed, opened, switched, checked and removed through
 * `IntegrationService` the same way, with the same page and the same card.
 *
 * The token, its health and the person's choices stay where ADR 0049 put
 * them (`slack.secrets.json`, through `SlackService`); this only says what
 * they look like as an app. The tools hold the choices themselves, on every
 * engine: a tool that's off isn't offered, reads honour Ask, and sending
 * always asks.
 */
import {
  type Integration,
  type IntegrationPolicy,
  type ServerEvent,
  SlackToolName,
  type UpdateIntegrationBody,
} from '@conch/protocol';

import { CATALOG } from '../integrations/catalog';
import { IntegrationError, type HostedApps } from '../integrations/service';
import { SlackError, type SlackService, type SlackStatus } from './service';

export const SLACK_APP_ID = 'slack';

/** Conch's host tools may arrive as `mcp__conch__slack_…` (Claude Code) or bare (API engines). */
const bare = (toolName: string) => toolName.replace(/^mcp__conch__/, '');

/** Slack's own errors in the words and kinds every app's routes already speak. */
async function asIntegrationError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof SlackError)) throw error;
    throw new IntegrationError(
      error.kind === 'not-connected' ? 'not-found' : error.kind,
      error.message,
    );
  }
}

export class SlackApps implements HostedApps {
  /** What the app looked like last time the pages were told, so only real changes are sent. */
  #seen?: string;

  constructor(
    private readonly slack: SlackService,
    private readonly deps: { emit: (event: ServerEvent) => void },
  ) {}

  owns(id: string): boolean {
    return id === SLACK_APP_ID;
  }

  async list(): Promise<Integration[]> {
    const status = await this.slack.status();
    return status.connected ? [toIntegration(status)] : [];
  }

  async get(id: string): Promise<Integration> {
    const [item] = this.owns(id) ? await this.list() : [];
    if (!item) throw new IntegrationError('not-found', 'Integration not found.');
    return item;
  }

  async update(id: string, patch: UpdateIntegrationBody): Promise<Integration> {
    await this.get(id);
    if (patch.values && Object.keys(patch.values).length)
      throw new IntegrationError('invalid', 'Connect Slack again to change its sign-in.');
    const tools = patch.tools
      ? Object.fromEntries(
          Object.entries(patch.tools).map(([name, policy]) => {
            if (!SlackToolName.safeParse(name).success)
              throw new IntegrationError('invalid', 'That isn’t one of its tools.');
            return [name, policy];
          }),
        )
      : undefined;
    await asIntegrationError(() =>
      this.slack.update({
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.policy && { policy: patch.policy }),
        ...(tools && { tools }),
      }),
    );
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.slack.disconnect();
  }

  async check(id: string): Promise<Integration> {
    await this.get(id);
    await this.slack.check();
    return this.get(id);
  }

  /** `off` for a Slack tool this turn doesn't get; the tools ask for themselves. */
  decide(toolName: string): 'allow' | 'ask' | 'off' | undefined {
    const name = SlackToolName.safeParse(bare(toolName));
    if (!name.success) return undefined;
    return this.slack.offers(name.data) ? 'allow' : 'off';
  }

  /** Slack has a prompt section of its own (`SlackService.promptSection`). */
  async promptLines() {
    return { working: [], broken: [] };
  }

  /** Something about Slack changed: tell every open page, as for any app. */
  async changed(): Promise<void> {
    const [item] = await this.list();
    const key = item ? JSON.stringify(item) : '';
    if (key === (this.#seen ?? '')) return;
    const had = Boolean(this.#seen);
    this.#seen = key;
    if (item) this.deps.emit({ type: 'integration.changed', integration: item });
    else if (had) this.deps.emit({ type: 'integration.deleted', integrationId: SLACK_APP_ID });
  }
}

/** Who it reads and sends as, in a few words: "Acme · as Ada Lovelace". */
function accountOf(status: SlackStatus): string | undefined {
  const parts = [status.workspace, status.user && `as ${status.user}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

export function toIntegration(status: SlackStatus): Integration {
  const entry = CATALOG.get(SLACK_APP_ID);
  const policy: IntegrationPolicy = status.policy;
  const account = accountOf(status);
  const connectedAt = status.connectedAt ?? 0;
  return {
    id: SLACK_APP_ID,
    catalogId: SLACK_APP_ID,
    name: entry?.name ?? 'Slack',
    server: SLACK_APP_ID,
    transport: { type: 'host', how: 'With your own Slack app, connected to Conch itself' },
    auth: 'token',
    enabled: status.enabled,
    policy,
    health: status.health,
    tools: status.tools.map((tool) => ({
      ...tool,
      // Sending asks every time, whatever the policy says: only Ask or Off.
      ...(tool.access === 'write' && { alwaysAsks: true }),
    })),
    values: {},
    secrets: [],
    ...(account && { account }),
    createdAt: connectedAt,
    updatedAt: Math.max(connectedAt, status.health.checkedAt ?? 0, status.lastUsedAt ?? 0),
    ...(status.lastUsedAt && { lastUsedAt: status.lastUsedAt }),
  };
}
