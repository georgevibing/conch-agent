import { AppIcon, humanizeTool, IntegrationIssueCard, IntegrationLogo } from '@conch/nacre';
import { useNavigate } from 'react-router';

import type { TranscriptItem } from '../../live/reducer';
import { useConchApps } from '../conchapps/queries';
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

/**
 * The tool-row label for an integration's tool: its logo and name instead
 * of `mcp__notion__…`. Undefined for anything that isn't a connected integration.
 */
/** The steps of making an app (ADR 0061), as the chat says them. */
const MAKER_STEPS: Record<string, string> = {
  app_new: 'Starting the app',
  app_write: 'Writing',
  app_read: 'Reading',
  app_check: 'Checking the app',
  app_try: 'Trying',
  app_present: 'Showing you the app',
  app_edit: 'Opening the app to change it',
  app_find: 'Looking for an app',
  app_get: 'Looking at an app',
  app_share: 'Getting it ready to share',
};

export function useToolLabel() {
  const { data } = useIntegrations();
  const { data: made } = useConchApps();
  return (toolName: string) => {
    const match = /^mcp__([a-z0-9_-]+?)__(.+)$/.exec(toolName);
    if (!match) return undefined;
    if (match[1] === 'conch') {
      const step = MAKER_STEPS[match[2] ?? ''];
      if (step) return { title: step, leading: undefined };
      // An app you made or added: its icon and name, like any app's call.
      const own = /^app_([a-z0-9_]+?)__([a-z0-9_]+)$/.exec(match[2] ?? '');
      const app = own && made?.find((a) => a.id === own[1]?.replaceAll('_', '-'));
      if (own && app) {
        const tool = app.tools.find((t) => t.name === own[2]);
        return {
          title: tool?.title || humanizeTool(own[2] ?? ''),
          leading: (
            <span className={styles.toolLabel}>
              <AppIcon glyph={app.manifest.icon.glyph} color={app.manifest.icon.color} size="xs" />
              <span className={styles.toolApp}>{app.manifest.name}</span>
            </span>
          ),
        };
      }
    }
    // Conch's own apps (Google, Slack) run as Conch's tools: found by the tool's name.
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
    const prefix = new RegExp(`^${integration.server.replace(/[-_]\d+$/, '')}[-_]`, 'i');
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
