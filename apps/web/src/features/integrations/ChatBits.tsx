import { humanizeTool, IntegrationIssueCard, IntegrationLogo } from '@conch/nacre';
import { useNavigate } from 'react-router';

import type { TranscriptItem } from '../../live/reducer';
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
          : void navigate(integration ? `/integrations/${integration.id}` : '/integrations')
      }
    />
  );
}

/**
 * The tool-row label for an integration's tool: its logo and name instead
 * of `mcp__notion__…`. Undefined for anything that isn't a connected integration.
 */
export function useToolLabel() {
  const { data } = useIntegrations();
  return (toolName: string) => {
    const match = /^mcp__([a-z0-9_-]+?)__(.+)$/.exec(toolName);
    if (!match) return undefined;
    const integration = data?.integrations.find((i) => i.server === match[1]);
    if (!integration) return undefined;
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
