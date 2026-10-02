import {
  ATTACHMENT_LIMITS,
  shouldFoldPaste,
  type Attachment,
  type EngineId,
  type EngineStatus,
} from '@conch/protocol';
import {
  AttachmentCard,
  Button,
  Callout,
  CommandMenu,
  Composer,
  ComposerChip,
  DropOverlay,
  Heading,
  IconButton,
  Pearl,
  Stack,
  Text,
  Tooltip,
  toast,
  useFileDrop,
} from '@conch/nacre';
import { ArrowRight, AudioLines, Folder, ListPlus } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';

import { useAppState, useConversations, useUpdateSettings } from '../../api/queries';
import { canPickHere, pickPath } from '../../lib/pick';
import { useUi } from '../../app/ui';
import { greeting } from '../../lib/time';
import { useLive } from '../../live/LiveProvider';
import { emptyView, lastUserMessage, type ConversationView } from '../../live/reducer';
import { NEW, useLiveStore } from '../../live/store';
import { useSlashCommands } from '../commands/useSlashCommands';
import { ChannelBanner } from '../channels/ChannelBanner';
import { useChannels } from '../channels/queries';
import { RunBanner } from '../routines/RunBanner';
import { tasksApi } from '../tasks/api';
import { TaskBanner } from '../tasks/TaskBanner';
import { useStartTask } from '../tasks/queries';
import { ComposerControls } from '../models/ComposerControls';
import { modeInfo } from '../models/catalog';
import { ChatFind } from '../search/ChatFind';
import { modelKey, useTurnOptions } from '../models/useTurnOptions';
import { providersApi } from '../providers/api';
import { providerKeys, putProvider, useProviders } from '../providers/queries';
import { useNeed } from '../setup/useNeed';
import { UsageComposerNotice } from '../usage/UsageComposerNotice';
import styles from './ChatView.module.css';
import { attachmentUrl } from './uploads';

const attachmentSrc = (attachment: Attachment) => attachmentUrl(attachment.id);
import { AttachmentViewer, type Viewable } from './AttachmentViewer';
import { ComposerOffline } from './OfflineBits';
import { ChatHolds } from '../skills/ChatHolds';
import { Transcript } from './Transcript';
import type { TurnRecovery } from './TranscriptItems';
import { type Draft, useDraftAttachments } from './useDraftAttachments';
import { useIntegrations } from '../integrations/queries';
import { ArtifactDock } from '../artifacts/ArtifactDock';
import { BrowserDock } from '../browser/BrowserDock';
import { Dictate } from '../voice/Dictate';
import { canSpeak } from '../voice/speak';
import { Talk } from '../voice/Talk';

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

/** Until a chat app is connected, point at talking to the assistant from your phone. */
function ChannelsHint() {
  const { data } = useChannels();
  const navigate = useNavigate();
  if (!data || data.channels.length > 0) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      trailingIcon={<ArrowRight />}
      onClick={() => void navigate('/apps?show=talk')}
      className={styles.connectHint}
    >
      Talk to it from your chat apps
    </Button>
  );
}

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
      onClick={() => void navigate('/apps')}
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
  send: (text: string, attached: Attachment[]) => void,
): TurnRecovery | undefined {
  const openSettings = useUi((s) => s.openSettings);
  const client = useQueryClient();
  const { data: providers } = useProviders();
  const { data: app } = useAppState();
  const updateSettings = useUpdateSettings();
  const onePassword = useNeed('1password-app');
  const [waitingFor, setWaitingFor] = useState<{
    engine: EngineId;
    text: string;
    attachments: Attachment[];
  }>();
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
      sendRef.current(waitingFor.text, waitingFor.attachments);
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
  // The message goes again with what was attached to it, not the new draft's cards.
  const lastMessage = lastUserMessage(view);
  const text =
    lastMessage && (lastMessage.text || lastMessage.attachments.length)
      ? lastMessage.text
      : undefined;
  const attached = lastMessage?.attachments ?? [];
  return {
    label: name(failed),
    waiting: Boolean(waitingFor),
    signIn:
      failed && text !== undefined
        ? () => {
            setWaitingFor({ engine: failed, text, attachments: attached });
            // Straight to its page, where the sign-in button is — and fresh, not cached.
            void client.invalidateQueries({ queryKey: providerKeys.list });
            openSettings('providers', failed);
          }
        : undefined,
    alternative:
      other && text !== undefined
        ? {
            label: other.label,
            use: () => {
              const first = other.models[0];
              if (first) turn.choose(modelKey(other.engine, first.id));
              else turn.set({ engine: other.engine });
              send(text, attached);
              // Once is a choice; the second time it should just happen (ADR 0023).
              if (last.problem === 'limit' && !app?.preferences.limitFallback)
                toast(`Answering with ${other.label}`, {
                  description: `Next time ${name(failed)} reaches a limit, carry on with ${other.label} by itself?`,
                  action: {
                    label: 'Always',
                    onClick: () =>
                      updateSettings.mutate(
                        { preferences: { limitFallback: other.engine } },
                        {
                          onSuccess: () =>
                            toast.success(`${other.label} carries on at a limit`, {
                              description: 'Change it in Settings → Models.',
                            }),
                        },
                      ),
                  },
                });
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
  const attachments = useDraftAttachments();
  const [previewing, setPreviewing] = useState<number>();

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
        const { text, attachments: returned } = state.returned;
        state.clearReturned();
        setDraft((d) => d || text);
        if (returned?.length) attachments.restore(returned);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `restore` is stable
    [key],
  );

  const name = app?.persona.name ?? 'Conch';
  // Talking needs the microphone and a voice to answer with.
  const canTalk = typeof window !== 'undefined' && window.isSecureContext && canSpeak();
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
    // Nor from somewhere you're already typing (the terminal opened while the chat loaded).
    if (typingElsewhere(composerRef.current)) return;
    composerRef.current?.focus();
  }, [conversationId]);

  const turn = useTurnOptions(conversationId);
  const origin = useConversations().data?.find((c) => c.id === conversationId)?.origin;
  const isRoutineRun = origin?.kind === 'routine';
  const continuingTask = useRef(false);

  /** Send words, and whatever is attached (the draft's cards unless given). */
  const send = (text: string, attached: Attachment[] = attachments.ready) => {
    const trimmed = text.trim();
    if (!trimmed && !attached.length) return;
    setEngineIssue(undefined);
    if (origin?.kind === 'task') {
      if (attached.length) {
        toast.error(
          'Task follow-ups cannot include attachments yet. Your files are still in the composer.',
        );
        return;
      }
      if (continuingTask.current) return;
      continuingTask.current = true;
      void tasksApi
        .continue(origin.taskId, trimmed, crypto.randomUUID())
        .then(() => {
          setDraft('');
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : 'Couldn’t continue this task. Your instruction is still here.',
          );
        })
        .finally(() => {
          continuingTask.current = false;
        });
      return;
    }
    const id = live.send(trimmed, conversationId, turn.takeDraft(), attached);
    if (!conversationId) setSentId(id);
    setDraft('');
    if (attached === attachments.ready) attachments.clear();
  };

  /** Send the draft off to be done in the background (ADR 0033); you keep chatting here. */
  const startTask = useStartTask();
  const sendAway = () => {
    const text = draft.trim();
    if (!text) {
      toast('Write what you’d like done, then send it to the background.');
      composerRef.current?.focus();
      return;
    }
    if (attachments.ready.length) {
      toast('A background task can’t take attachments yet. Send it as a message instead.');
      return;
    }
    startTask.mutate(
      { text, ...(conversationId && { conversationId }), options: turn.options },
      {
        onSuccess: (task) => {
          setDraft('');
          toast(`Working on “${task.title}” in the background`, {
            description: conversationId
              ? 'Its result will come back to this chat.'
              : 'You’ll be told when it’s done.',
            action: { label: 'Tasks', onClick: () => void navigate('/tasks') },
          });
        },
      },
    );
  };
  // ⌘K "Do it in the background" sends what's written here.
  const onBackground = useEffectEvent(sendAway);
  useEffect(
    () =>
      useUi.subscribe((state, before) => {
        if (state.backgroundRequest !== before.backgroundRequest) onBackground();
      }),
    [],
  );

  // ⌘K "Attach files" opens the picker here (still inside the keypress, so the browser allows it).
  const picker = useRef<HTMLInputElement>(null);
  useEffect(
    () =>
      useUi.subscribe((state, before) => {
        if (state.attachRequest !== before.attachRequest) picker.current?.click();
      }),
    [],
  );

  const drop = useFileDrop({
    onDrop: ({ files, folders }) => void attachments.addFiles(files, folders),
  });

  const slash = useSlashCommands({ draft, setDraft, send, turn });
  const recover = useTurnRecovery(view, turn, send);
  const chosenReady = Boolean(
    turn.catalog?.providers.some((p) => p.engine === turn.options.engine),
  );

  // Say so on a card when the chosen provider can't use it, before it's sent.
  const provider = turn.catalog?.providers.find((p) => p.engine === turn.options.engine);
  const can = provider?.attachments;
  const sees =
    provider?.models.find((m) => m.id === turn.options.model)?.images ?? can?.images ?? false;
  const noteFor = (d: Draft): string | undefined => {
    if (!provider) return undefined;
    if (d.kind === 'image' && !sees && !can?.files)
      return `${provider.label} can’t see pictures with this model. It will only get the name.`;
    if (d.kind === 'file' && !can?.files)
      return `${provider.label} can’t open this kind of file. It will only get the name.`;
    return undefined;
  };

  const viewables: Viewable[] = attachments.drafts.map((d) => ({
    info: d,
    id: d.attachment?.id,
    text: d.text,
    src: d.src,
    ...(d.pasted && {
      onTextChange: (text: string) => attachments.editPaste(d.key, text),
      onInsert: () => {
        const text = d.text ?? '';
        attachments.remove(d.key);
        setPreviewing(undefined);
        setDraft((current) => (current ? `${current}\n\n${text}` : text));
        composerRef.current?.focus();
      },
    }),
  }));

  const cards = attachments.drafts.length
    ? attachments.drafts.map((d, i) => (
        <AttachmentCard
          key={d.key}
          name={d.name}
          kind={d.kind}
          mimeType={d.mimeType}
          size={d.size}
          lines={d.lines}
          pasted={d.pasted}
          width={d.width}
          height={d.height}
          excerpt={d.excerpt}
          src={
            d.src ?? (d.kind === 'image' && d.attachment ? attachmentSrc(d.attachment) : undefined)
          }
          status={d.status}
          progress={d.progress}
          error={d.error}
          note={noteFor(d)}
          onOpen={() => setPreviewing(i)}
          onRemove={() => {
            attachments.remove(d.key);
            if (attachments.drafts.length <= 1) composerRef.current?.focus();
          }}
          onRetry={() => attachments.retry(d.key)}
        />
      ))
    : undefined;

  const saveSettings = useUpdateSettings();
  /** The folder chip: the system's Open dialog right here, or Settings from another device. */
  const chooseFolder = () => {
    if (!canPickHere()) return openSettings('general');
    void pickPath('workspace').then(
      async (path) => {
        if (!path) return;
        await saveSettings.mutateAsync({ preferences: { workspace: path } });
        toast.success(`Working in ${path.split(/[\\/]/).filter(Boolean).at(-1) ?? path}`);
      },
      () => openSettings('general'),
    );
  };

  const workspaceName = useMemo(
    () => app?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace',
    [app?.workspace],
  );

  const composer = (
    <div className={styles.composerWrap}>
      {/* Another connected provider can answer while the default one is away. */}
      <EngineIssue status={chosenReady ? undefined : engine} issue={engineIssue} />
      <UsageComposerNotice />
      <ComposerOffline />
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
      {/* What this chat is held to (ADR 0047): quiet, and one press to stop. */}
      {conversationId && (
        <ChatHolds
          conversationId={conversationId}
          holds={view.holds ?? []}
          running={running || pending.length > 0}
        />
      )}
      <Composer
        ref={composerRef}
        value={draft}
        onValueChange={slash.onDraftChange}
        onSubmit={(text) => {
          if (!text || !slash.submit(text)) send(text);
        }}
        attachments={cards}
        onFiles={(files) => void attachments.addFiles(files)}
        onLongPaste={attachments.addPaste}
        foldPaste={shouldFoldPaste}
        canSubmitEmpty={attachments.ready.length > 0}
        sendBlocked={
          attachments.uploading
            ? 'Waiting for attachments to upload…'
            : attachments.failed
              ? 'Remove or retry the attachment that didn’t upload'
              : undefined
        }
        onTextareaKeyDown={(e) => {
          if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            sendAway();
            return;
          }
          slash.menu.onKeyDown(e);
        }}
        textareaProps={slash.menu.inputProps}
        overlay={<CommandMenu {...slash.menu.menuProps} />}
        // Stop is there the moment you send, not once the reply begins.
        onStop={() => live.interrupt(conversationId)}
        running={running || pending.length > 0}
        placeholder={
          running || pending.length > 0
            ? `${name} is working…`
            : `Message ${name}, or type / for commands`
        }
        label={`Message ${name}`}
        actions={
          <>
            {draft.trim() && (
              <IconButton
                label="Do it in the background"
                shortcut="mod+shift+enter"
                shape="circle"
                loading={startTask.isPending}
                onClick={sendAway}
              >
                <ListPlus />
              </IconButton>
            )}
            <Dictate draft={draft} setDraft={setDraft} />
            {canTalk && (
              <IconButton
                label={`Talk with ${name}`}
                shape="circle"
                onClick={() => useUi.setState({ talking: {} })}
              >
                <AudioLines />
              </IconButton>
            )}
          </>
        }
        toolbar={
          <>
            {(engine?.state === 'ready' || chosenReady) && (
              <ComposerControls turn={turn} name={name} />
            )}
            <Tooltip content={app?.workspace ?? ''}>
              <ComposerChip
                icon={<Folder />}
                onClick={chooseFolder}
                aria-label={`Working folder: ${workspaceName}. Choose another`}
              >
                {workspaceName}
              </ComposerChip>
            </Tooltip>
          </>
        }
      />
      {canTalk && (
        <Talk conversationId={conversationId} send={(text) => send(text, [])} name={name} />
      )}
      <Text size="2xs" tone="subtle" align="center" className={styles.hint}>
        {name} can make mistakes, and {modeInfo(turn.options.permissionMode).hint}.
      </Text>
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void attachments.addFiles(files);
          composerRef.current?.focus();
        }}
      />
      <AttachmentViewer
        items={viewables}
        index={previewing !== undefined && previewing < viewables.length ? previewing : undefined}
        onIndexChange={setPreviewing}
      />
    </div>
  );

  const dropOverlay = (
    <DropOverlay
      active={drop.dragging}
      hint={`Pictures, PDFs, text and more — up to ${ATTACHMENT_LIMITS.maxBytes / 1024 / 1024} MB each`}
    />
  );

  if (isEmpty && !conversationId) {
    return (
      <div className={styles.empty} {...drop.props}>
        {dropOverlay}
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
              onClick={() => send(s.prompt, [])}
            >
              {s.label}
            </Button>
          ))}
        </div>
        <div className={styles.hints}>
          <ConnectAppsHint />
          <ChannelsHint />
        </div>
      </div>
    );
  }

  const chat = (
    <div className={styles.chat} {...drop.props}>
      {dropOverlay}
      <RunBanner conversationId={conversationId} />
      <TaskBanner conversationId={conversationId} />
      <ChannelBanner conversationId={conversationId} />
      <Transcript
        view={view}
        conversationId={conversationId}
        columnRef={columnRef}
        routineRun={isRoutineRun}
        taskChat={origin?.kind === 'task'}
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
          const last = lastUserMessage(view);
          if (last) send(last.text, last.attachments);
        }}
        onAskAgain={(messageId) => {
          const asked = view.items.find((i) => i.kind === 'user' && i.id === messageId);
          if (asked?.kind === 'user') send(asked.text, asked.attachments ?? []);
        }}
        focusComposer={() => composerRef.current?.focus()}
        recover={recover}
      />
      <div className={styles.dock}>{composer}</div>
    </div>
  );
  return conversationId ? (
    <BrowserDock conversationId={conversationId} view={view}>
      <ArtifactDock conversationId={conversationId} view={view}>
        {chat}
      </ArtifactDock>
    </BrowserDock>
  ) : (
    chat
  );
}

/** Focus is in a field other than the composer: someone is typing there. */
function typingElsewhere(composer: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === composer) return false;
  return (
    active.isContentEditable ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && !['button', 'checkbox', 'radio'].includes(active.type))
  );
}
