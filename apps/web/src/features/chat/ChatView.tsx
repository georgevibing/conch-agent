import type { EngineStatus } from '@conch/protocol';
import {
  Button,
  Callout,
  CommandMenu,
  Composer,
  Heading,
  Pearl,
  Stack,
  Text,
  Tooltip,
} from '@conch/nacre';
import { Folder } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { useUi } from '../../app/ui';
import { greeting } from '../../lib/time';
import { useLive } from '../../live/LiveProvider';
import { emptyView, lastUserText } from '../../live/reducer';
import { NEW, useLiveStore } from '../../live/store';
import { useSlashCommands } from '../commands/useSlashCommands';
import { ComposerControls } from '../models/ComposerControls';
import { useTurnOptions } from '../models/useTurnOptions';
import styles from './ChatView.module.css';
import { Transcript } from './Transcript';

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

function EngineIssue({ status, issue }: { status?: EngineStatus; issue?: string }) {
  const openSettings = useUi((s) => s.openSettings);
  if (!status || status.state === 'ready') return null;
  const title =
    status.state === 'not-installed'
      ? 'Claude Code isn’t installed'
      : status.state === 'signed-out'
        ? 'Claude Code needs you to sign in'
        : status.state === 'checking'
          ? 'Checking Claude Code…'
          : 'Claude Code isn’t responding';
  return (
    <Callout
      tone="warning"
      title={title}
      className={styles.issue}
      action={
        <Button size="sm" onClick={() => openSettings('engine')}>
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
  const [draft, setDraft] = useState('');
  const [sentId, setSentId] = useState<string>();
  const composerRef = useRef<HTMLTextAreaElement>(null);

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
    composerRef.current?.focus();
  }, [conversationId]);

  const turn = useTurnOptions(conversationId);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setEngineIssue(undefined);
    const id = live.send(trimmed, conversationId, turn.takeDraft());
    if (!conversationId) setSentId(id);
    setDraft('');
  };

  const slash = useSlashCommands({ draft, setDraft, send, turn });

  const workspaceName = useMemo(
    () => app?.workspace.split('/').filter(Boolean).at(-1) ?? 'workspace',
    [app?.workspace],
  );

  const composer = (
    <div className={styles.composerWrap}>
      <EngineIssue status={engine} issue={engineIssue} />
      {view.notice && running && (
        <Callout tone="info" title="Still trying…" className={styles.issue}>
          {view.notice}
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
            {engine?.state === 'ready' && <ComposerControls turn={turn} />}
            <Tooltip content={app?.workspace ?? ''}>
              <Button
                variant="ghost"
                size="sm"
                leadingIcon={<Folder />}
                onClick={() => openSettings('engine')}
                aria-label={`Working folder: ${workspaceName}`}
              >
                {workspaceName}
              </Button>
            </Tooltip>
          </>
        }
      />
      <Text size="2xs" tone="subtle" align="center" className={styles.hint}>
        {name} can make mistakes and always asks before changing anything on your computer.
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
      </div>
    );
  }

  return (
    <div className={styles.chat}>
      <Transcript
        view={view}
        pending={pending}
        name={name}
        onRespond={(permissionId, decision) =>
          conversationId && live.respond(conversationId, permissionId, decision)
        }
        onRetry={() => {
          const text = lastUserText(view);
          if (text) send(text);
        }}
      />
      <div className={styles.dock}>{composer}</div>
    </div>
  );
}
