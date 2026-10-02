import type { CatalogEntry } from '@conch/protocol';
import {
  humanizeTool,
  IntegrationIssueCard,
  IntegrationLogo,
  IntegrationSuggestionCard,
  type IntegrationSuggestionState,
} from '@conch/nacre';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '../../api/client';
import { useAppState, useUpdateSettings } from '../../api/queries';
import type { TranscriptItem } from '../../live/reducer';
import styles from './ChatBits.module.css';
import { ConnectDialog } from './ConnectDialog';
import { useAssistantName, useIntegrations } from './queries';
import { useFix } from './useFix';

type Issue = Extract<TranscriptItem, { kind: 'integration-issue' }>;
type Suggestion = Extract<TranscriptItem, { kind: 'integration-suggestion' }>;

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
 * An offer to connect an app the message was about (connect-from-chat).
 * Connect opens the connect dialog right here; the chat stays put. The card
 * follows the app: signing in, connected (with Ask again), or put away.
 */
export function IntegrationSuggestion({
  item,
  conversationId,
  className,
  onAskAgain,
  onGone,
}: {
  item: Suggestion;
  conversationId?: string;
  className?: string;
  /** Send the question again. Absent when that can't happen now. */
  onAskAgain?: () => void;
  /** “Not now” finished folding the card away. */
  onGone?: () => void;
}) {
  const { data } = useIntegrations();
  const { data: app } = useAppState();
  const update = useUpdateSettings();
  const assistant = useAssistantName();
  const card = useRef<HTMLDivElement>(null);
  const [dialog, setDialog] = useState<CatalogEntry>();
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);
  /** Muted or unmuted from this card; otherwise the setting decides. */
  const [mutedHere, setMutedHere] = useState<boolean>();

  const target = data?.catalog.find((c) => c.id === item.catalogId);
  const integration = data?.integrations.find((i) => i.catalogId === target?.id);
  const muted = app?.preferences.mutedSuggestions ?? [];
  const isMuted = mutedHere ?? muted.includes(item.catalogId);

  // Until the list is here there's nothing to connect with: wait, rather than flicker.
  if (!data || gone || (item.dismissed && !leaving) || (isMuted && mutedHere === undefined))
    return null;

  const connected = integration?.health.state === 'ok' || integration?.health.state === 'warning';
  const state: IntegrationSuggestionState = leaving
    ? 'dismissed'
    : isMuted
      ? 'muted'
      : connected
        ? 'connected'
        : integration && ['connecting', 'checking'].includes(integration.health.state)
          ? 'connecting'
          : 'suggested';

  const mute = (on: boolean) => {
    setMutedHere(on);
    const next = on
      ? [...new Set([...muted, item.catalogId])]
      : muted.filter((id) => id !== item.catalogId);
    update.mutate({ preferences: { mutedSuggestions: next } });
  };

  return (
    <>
      <IntegrationSuggestionCard
        ref={card}
        className={className}
        name={item.name}
        brand={item.catalogId}
        color={item.color}
        description={item.description}
        assistant={assistant}
        state={state}
        onConnect={target ? () => setDialog(target) : undefined}
        onNotNow={() => {
          setLeaving(true);
          if (conversationId)
            void api.dismissSuggestion(conversationId, item.catalogId).catch(() => undefined);
        }}
        onMute={() => mute(true)}
        onUnmute={() => mute(false)}
        onAskAgain={onAskAgain}
        onGone={() => {
          setGone(true);
          onGone?.();
        }}
      />
      <ConnectDialog
        entry={dialog}
        existingId={dialog && dialog.id === integration?.catalogId ? integration.id : undefined}
        onOpenChange={(open) => !open && setDialog(undefined)}
        inChat
        onAskAgain={onAskAgain}
        onCloseAutoFocus={(event) => {
          // The button that opened it may have become “Ask again”.
          const next = card.current?.querySelector<HTMLElement>('[data-primary]');
          if (!next) return;
          event.preventDefault();
          next.focus();
        }}
      />
    </>
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
