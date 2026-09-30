import type { EngineId, EngineStatus } from '@conch/protocol';
import {
  Button,
  Callout,
  CommandMenu,
  Composer,
  ComposerChip,
  Heading,
  Pearl,
  Stack,
  Text,
  Tooltip,
  toast,
} from '@conch/nacre';
import { ArrowRight, Folder } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';

import { useAppState, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { greeting } from '../../lib/time';
import { useLive } from '../../live/LiveProvider';
import { emptyView, lastUserText, type ConversationView } from '../../live/reducer';
import { NEW, useLiveStore } from '../../live/store';
import { useSlashCommands } from '../commands/useSlashCommands';
import { RunBanner } from '../routines/RunBanner';
import { ComposerControls } from '../models/ComposerControls';
import { modeInfo } from '../models/catalog';
import { ChatFind } from '../search/ChatFind';
import { modelKey, useTurnOptions } from '../models/useTurnOptions';
import { providersApi } from '../providers/api';
import { providerKeys, putProvider, useProviders } from '../providers/queries';
import { useNeed } from '../setup/useNeed';
import { UsageComposerNotice } from '../usage/UsageComposerNotice';
import styles from './ChatView.module.css';
import { Transcript } from './Transcript';
import type { TurnRecovery } from './TranscriptItems';
import { useIntegrations } from '../integrations/queries';
import { BrowserDock } from '../browser/BrowserDock';

const suggestions = [
  { label: 'Plan my week', prompt: 'Help me plan my week. Ask me a couple of questions first.' },
  {
    label: 'Explain something simply',
    prompt: 'Explain how the internet routes a message, like I’m curious but new to it.',
  },
  {
    label: 'Look around this folder',
    prompt: 'List the files in the working folder and tell me what you see.',
  },
  { label: 'Remember something', prompt: 'Remember that I prefer short, direct answers.' },
];

/** Until something is connected, point at where the assistant gets its reach. */
function ConnectAppsHint() {
  const { data } = useIntegrations();
  const navigate = useNavigate();
  if (!data || data.integrations.length > 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      trailingIcon={<ArrowRight />}
      onClick={() => void navigate('/integrations')}
      className={styles.connectHint}
    >
      Connect Gmail, Notion, GitHub and more
    </Button>
  );
}

function EngineIssue({ status, issue }: { status?: EngineStatus; issue?: string }) {
  const openSettings = useUi((s) => s.openSettings);
  if (!status || status.state === 'ready') return null;
  const title =
    status.state === 'not-installed'
      ? `${status.label} isn’t installed`
      : status.state === 'signed-out'
        ? `${status.label} needs you to sign in`
        : status.state === 'checking'
          ? `Checking ${status.label}…`
          : `${status.label} isn’t responding`;
  return (
    <Callout
      tone="warning"
      title={title}
      className={styles.issue}
      action={
        <Button size="sm" onClick={() => openSettings('providers')}>
          {status.state === 'signed-out' ? 'Sign in' : 'Fix this'}
        </Button>
      }
    >
      {status.state === 'error' && issue
        ? issue
        : 'I can’t reply until it’s ready — your message is safe. It only takes a minute.'}
    </Callout>
  );
}

/**
 * What the chat can do about its last failed turn (AGENTS.md agreement 11):
 * sign in to the provider — and the message goes again by itself once it's
 * back — answer with another provider that's ready, or open 1Password.
 */
function useTurnRecovery(
  view: ConversationView,
  turn: ReturnType<typeof useTurnOptions>,
  send: (text: string) => void,
): TurnRecovery | undefined {
  const openSettings = useUi((s) => s.openSettings);
  const client = useQueryClient();
  const { data: providers } = useProviders();
  const onePassword = useNeed('1password-app');
  const [waitingFor, setWaitingFor] = useState<{ engine: EngineId; text: string }>();
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  // While a sign-in happens in another window: a real check every few seconds,
  // and whenever you come back. Once it's ready, the message goes again.
  useEffect(() => {
    if (!waitingFor) return;
    let done = false;
    const look = async () => {
      const provider = await providersApi.check(waitingFor.engine).catch(() => undefined);
      if (done || !provider) return;
      putProvider(client, provider);
      if (provider.status.state !== 'ready') return;
      done = true;
      setWaitingFor(undefined);
      toast.success(`Signed in to ${provider.name} — sending your message again.`);
      sendRef.current(waitingFor.text);
    };
    const timer = setInterval(() => void look(), 3000);
    const onFocus = () => void look();
    window.addEventListener('focus', onFocus);
    return () => {
      done = true;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [waitingFor, client]);

  const last = [...view.items].reverse().find((i) => i.kind === 'turn-end');
  if (last?.kind !== 'turn-end' || last.outcome !== 'error' || !last.problem) return undefined;
  const failed = last.engine ?? turn.options.engine;
  const name = (id: string | undefined) =>
    providers?.providers.find((p) => p.id === id)?.name ??
    turn.catalog?.providers.find((p) => p.engine === id)?.label ??
    'Your provider';
  const other = turn.catalog?.providers.find(
    (p) => p.engine !== failed && p.models.length > 0 && !p.message,
  );
  const text = lastUserText(view);
  return {
    label: name(failed),
    waiting: Boolean(waitingFor),
    signIn:
      failed && text
        ? () => {
            setWaitingFor({ engine: failed, text });
            // Straight to its page, where the sign-in button is — and fresh, not cached.
            void client.invalidateQueries({ queryKey: providerKeys.list });
            openSettings('providers', failed);
          }
        : undefined,
    alternative:
      other && text
        ? {
            label: other.label,
            use: () => {
              const first = other.models[0];
              if (first) turn.choose(modelKey(other.engine, first.id));
              else turn.set({ engine: other.engine });
              send(text);
            },
          }
        : undefined,
    openOnePassword: onePassword.need?.openable ? () => void onePassword.act('open') : undefined,
  };
}

export function ChatView({ conversationId }: { conversationId?: string }) {
  const live = useLive();
  const navigate = useNavigate();
  const { data: app } = useAppState();
  const key = conversationId ?? NEW;
  const view =
    useLiveStore((s) => (conversationId ? s.views[conversationId] : undefined)) ?? emptyView;
  const pending = useLiveStore((s) => s.pending[key]) ?? [];
  const created = useLiveStore((s) => s.created);
  const engineIssue = useLiveStore((s) => s.engineIssue);
  const setEngineIssue = useLiveStore((s) => s.setEngineIssue);
  const openSettings = useUi((s) => s.openSettings);
  // "Try asking…" from an integration arrives as a ready-to-send draft.
  const location = useLocation();
  const [draft, setDraft] = useState(
    () => (location.state as { draft?: string } | null)?.draft ?? '',
  );
  const [sentId, setSentId] = useState<string>();
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);

  // Words handed over from elsewhere (⌘K's "use this skill") land in the composer.
  useEffect(() => {
    const take = () => {
      const text = useUi.getState().composerText;
      if (text === null) return;
      useUi.getState().setComposerText(null);
      setDraft(text);
      composerRef.current?.focus();
    };
    // Words may be waiting already (the chat opened because of them).
    const timer = setTimeout(take, 0);
    const off = useUi.subscribe(take);
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  // A rejected message comes back to the composer instead of vanishing.
  useEffect(
    () =>
      useLiveStore.subscribe((state) => {
        if (state.returned?.key !== key) return;
        const text = state.returned.text;
        state.clearReturned();
        setDraft((d) => d || text);
      }),
    [key],
  );

  const name = app?.persona.name ?? 'Conch';
  const engine = app?.engine;
  const running = view.status === 'running' || view.status === 'awaiting-permission';
  const isEmpty = view.items.length === 0 && pending.length === 0;

  useEffect(() => {
    if (!conversationId) return;
    return live.watch(conversationId);
  }, [conversationId, live]);

  // A new chat becomes a real conversation once the server confirms it.
  useEffect(() => {
    if (!conversationId && sentId && created[sentId]) {
      void navigate(`/c/${created[sentId]}`, { replace: true });
    }
  }, [conversationId, sentId, created, navigate]);

  useEffect(() => {
    // Arriving from search, the find field has focus; don't take it away.
    if (conversationId && useUi.getState().find?.conversationId === conversationId) return;
    composerRef.current?.focus();
  }, [conversationId]);

  const turn = useTurnOptions(conversationId);
  const isRoutineRun = Boolean(
    useConversations().data?.find((c) => c.id === conversationId)?.origin,
  );

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setEngineIssue(undefined);
    const id = live.send(trimmed, conversationId, turn.takeDraft());
    if (!conversationId) setSentId(id);
    setDraft('');
  };

  const slash = useSlashCommands({ draft, setDraft, send, turn });
  const recover = useTurnRecovery(view, turn, send);
  const chosenReady = Boolean(
    turn.catalog?.providers.some((p) => p.engine === turn.options.engine),
  );

  const workspaceName = useMemo(
    () => app?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace',
    [app?.workspace],
  );

  const composer = (
    <div className={styles.composerWrap}>
      {/* Another connected provider can answer while the default one is away. */}
      <EngineIssue status={chosenReady ? undefined : engine} issue={engineIssue} />
      <UsageComposerNotice />
      {view.notice && running && (
        // Only a retry is "still trying"; anything else is just a note.
        <Callout
          tone="info"
          title={view.notice.code === 'retry' ? 'Still trying…' : undefined}
          className={styles.issue}
        >
          {view.notice.message}
        </Callout>
      )}
      <Composer
        ref={composerRef}
        value={draft}
        onValueChange={slash.onDraftChange}
        onSubmit={(text) => {
          if (!slash.submit(text)) send(text);
        }}
        onTextareaKeyDown={(e) => {
          slash.menu.onKeyDown(e);
        }}
        textareaProps={slash.menu.inputProps}
        overlay={<CommandMenu {...slash.menu.menuProps} />}
        onStop={() => conversationId && live.interrupt(conversationId)}
        running={running}
        placeholder={running ? `${name} is working…` : `Message ${name}, or type / for commands`}
        label={`Message ${name}`}
        toolbar={
          <>
            {(engine?.state === 'ready' || chosenReady) && (
              <ComposerControls turn={turn} name={name} />
            )}
            <Tooltip content={app?.workspace ?? ''}>
              <ComposerChip
                icon={<Folder />}
                onClick={() => openSettings('providers')}
                aria-label={`Working folder: ${workspaceName}`}
              >
                {workspaceName}
              </ComposerChip>
            </Tooltip>
          </>
        }
      />
      <Text size="2xs" tone="subtle" align="center" className={styles.hint}>
        {name} can make mistakes, and {modeInfo(turn.options.permissionMode).hint}.
      </Text>
    </div>
  );

  if (isEmpty && !conversationId) {
    return (
      <div className={styles.empty}>
        <Stack gap={4} align="center" className={styles.hello}>
          <Pearl size="lg" state={running ? 'thinking' : 'idle'} label={null} />
          <Heading level={1} display size="4xl" align="center">
            {greeting()}
            {app?.profile.name ? `, ${app.profile.name}` : ''}.
          </Heading>
          <Text size="lg" tone="muted" align="center">
            What’s on your mind?
          </Text>
        </Stack>
        <div className={styles.emptyComposer}>{composer}</div>
        <div className={styles.suggestions} role="list" aria-label="Suggestions">
          {suggestions.map((s) => (
            <Button
              key={s.label}
              role="listitem"
              variant="surface"
              size="sm"
              onClick={() => send(s.prompt)}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <ConnectAppsHint />
      </div>
    );
  }

  const chat = (
    <div className={styles.chat}>
      <RunBanner conversationId={conversationId} />
      <Transcript
        view={view}
        conversationId={conversationId}
        columnRef={columnRef}
        routineRun={isRoutineRun}
        overlay={
          conversationId && (
            <ChatFind
              conversationId={conversationId}
              root={columnRef}
              onClose={() => composerRef.current?.focus()}
            />
          )
        }
        pending={pending}
        name={name}
        onRespond={(permissionId, decision) =>
          conversationId && live.respond(conversationId, permissionId, decision)
        }
        onRetry={() => {
          const text = lastUserText(view);
          if (text) send(text);
        }}
        recover={recover}
      />
      <div className={styles.dock}>{composer}</div>
    </div>
  );
  return conversationId ? (
    <BrowserDock conversationId={conversationId} view={view}>
      {chat}
    </BrowserDock>
  ) : (
    chat
  );
}
