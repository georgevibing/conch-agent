import { appToolLine, type ToolView } from '@conch/protocol';
import { AppIcon, humanizeTool, IntegrationIssueCard, IntegrationLogo } from '@conch/nacre';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import type { TranscriptItem } from '../../live/reducer';
import { useConchApps } from '../conchapps/queries';
import { appLook } from '../conchapps/words';
import styles from './ChatBits.module.css';
import { useAssistantName, useIntegrations } from './queries';
import { useFix } from './useFix';

type Issue = Extract<TranscriptItem, { kind: 'integration-issue' }>;

/**
 * An integration that broke mid-chat, shown where you noticed. Once it's
 * working again the card says so, instead of nagging.
 */
export function IntegrationIssue({ item }: { item: Issue }) {
  const { data } = useIntegrations();
  const { fix } = useFix();
  const navigate = useNavigate();
  const integration = data?.integrations.find((i) => i.id === item.integrationId);
  const entry = data?.catalog.find((c) => c.id === item.catalogId);
  const assistant = useAssistantName();
  const resolved = integration?.health.state === 'ok';
  const generic = /^sign in again/i.test(item.message);
  return (
    <IntegrationIssueCard
      name={item.name}
      brand={item.catalogId ?? 'custom'}
      color={entry?.color}
      state={item.state}
      message={generic ? `${assistant} couldn’t use it for this reply.` : item.message}
      resolved={resolved}
      onFix={() =>
        integration && integration.health.action === 'reconnect' && integration.auth === 'oauth'
          ? fix(integration)
          : void navigate(integration ? `/apps/${integration.id}` : '/apps')
      }
    />
  );
}

/** The steps of making an app (ADR 0061), as the chat says them. */
const MAKER_STEPS: Record<string, string> = {
  app_new: 'Starting the app',
  app_write: 'Writing',
  app_icon: 'Giving it a picture',
  app_read: 'Reading',
  app_check: 'Checking the app',
  app_try: 'Trying',
  app_present: 'Showing you the app',
  app_edit: 'Opening the app to change it',
  app_find: 'Looking for an app',
  app_get: 'Looking at an app',
  app_share: 'Getting it ready to share',
};

/**
 * The tool-row label for an app's tool: its logo and what it did, instead of
 * `mcp__notion__…`. Conch's own apps (Google, Slack) always say it in a
 * person's words, connected or not (`@conch/protocol` `appToolLine`):
 * "Looked at your calendar", "Read #design". Any other app shows its logo and
 * name while it's connected. Undefined for everything else.
 */
export function useToolLabel() {
  const { data } = useIntegrations();
  const { data: made } = useConchApps();
  return (
    toolName: string,
    call: { running: boolean; input?: unknown; view?: ToolView | undefined } = { running: false },
  ): { title: string; leading: ReactNode; summary?: string } | undefined => {
    const own = appToolLine(toolName, call);
    if (own) {
      const entry = data?.catalog.find((c) => c.id === own.app);
      return {
        title: own.title,
        ...(own.summary && { summary: own.summary }),
        leading: (
          <IntegrationLogo
            brand={own.app}
            name={entry?.name ?? own.app}
            color={entry?.color}
            size="xs"
          />
        ),
      };
    }
    const match = /^mcp__([a-z0-9_-]+?)__(.+)$/.exec(toolName);
    if (!match) return undefined;
    if (match[1] === 'conch') {
      const step = MAKER_STEPS[match[2] ?? ''];
      if (step) return { title: step, leading: undefined };
      // An app you made or added: its icon and name, like any app's call.
      const mine = /^app_([a-z0-9_]+?)__([a-z0-9_]+)$/.exec(match[2] ?? '');
      const app = mine && made?.find((a) => a.id === mine[1]?.replaceAll('_', '-'));
      if (mine && app) {
        const tool = app.tools.find((t) => t.name === mine[2]);
        return {
          title: tool?.title || humanizeTool(mine[2] ?? ''),
          leading: (
            <span className={styles.toolLabel}>
              <AppIcon {...appLook(app)} size="xs" />
              <span className={styles.toolApp}>{app.manifest.name}</span>
            </span>
          ),
        };
      }
    }
    // Conch's other tools of its own (`ask`, `offer`…) are found by the tool's name.
    const integration =
      match[1] === 'conch'
        ? data?.integrations.find((i) => i.tools.some((t) => t.name === match[2]))
        : data?.integrations.find((i) => i.server === match[1]);
    if (!integration)
      return match[1] === 'conch'
        ? { title: humanizeTool(match[2] ?? ''), leading: undefined }
        : undefined;
    const tool = integration.tools.find((t) => t.name === match[2]);
    const entry = data?.catalog.find((c) => c.id === integration.catalogId);
    const prefix = new RegExp(`^${integration.server.replace(/[-_]d+$/, '')}[-_]`, 'i');
    return {
      title: tool?.title ?? humanizeTool((match[2] ?? '').replace(prefix, '')),
      leading: (
        <span className={styles.toolLabel}>
          <IntegrationLogo
            brand={integration.catalogId ?? 'custom'}
            name={integration.name}
            color={entry?.color}
            size="xs"
            decorative
          />
          <span className={styles.toolApp}>{integration.name}</span>
        </span>
      ),
    };
  };
}
