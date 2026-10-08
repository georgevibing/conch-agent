import {
  ATTACHMENT_LIMITS,
  shouldFoldPaste,
  type Attachment,
  type EngineId,
  type EngineStatus,
  type MailEdit,
  type TurnOptions,
} from '@conch/protocol';
import {
  AttachmentCard,
  Button,
  Callout,
  ChatGoal,
  CommandMenu,
  Composer,
  ComposerChip,
  ComposerQueue,
  DropOverlay,
  Heading,
  IconButton,
  Kbd,
  Stack,
  Text,
  Tooltip,
  toast,
  useFileDrop,
} from '@conch/nacre';
import { ArrowRight, Folder, ListPlus } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';

import { useAppState, useConversations, useUpdateSettings } from '../../api/queries';
import { chooseOnComputer } from '../folders/FolderChooser';
import { useStable } from '../../lib/useStable';
import { useUi } from '../../app/ui';
import { greeting } from '../../lib/time';
import { useLive } from '../../live/LiveProvider';
import {
  emptyView,
  lastUserMessage,
  pendingQuestion,
  stoppedView,
  type ConversationView,
} from '../../live/reducer';
import { NEW, useLiveStore } from '../../live/store';
import { setChatGoal } from '../commands/context';
import { useSlashCommands } from '../commands/useSlashCommands';
import { ArchivedBanner } from '../archive/ArchivedBanner';
import { ChannelBanner } from '../channels/ChannelBanner';
import { useChannels } from '../channels/queries';
import { RunBanner } from '../routines/RunBanner';
import { tasksApi } from '../tasks/api';
import { TaskBanner } from '../tasks/TaskBanner';
import { TaskSheet } from '../tasks/TaskSheet';
import { ClientBanner } from '../otherapps/ClientBanner';
import { taskPath, useTaskSheet } from '../tasks/open';
import { useStartTask } from '../tasks/queries';
import { useSeenTasks } from '../tasks/seen';
import { ComposerControls } from '../models/ComposerControls';
import { modeInfo, modelLabel } from '../models/catalog';
import { ChatFind } from '../search/ChatFind';
import { modelKey, useTurnOptions } from '../models/useTurnOptions';
import { providersApi } from '../providers/api';
import { providerKeys, putProvider, useProviders } from '../providers/queries';
import { useNeed } from '../setup/useNeed';
import { UsageComposerNotice } from '../usage/UsageComposerNotice';
import { ChatSpend } from '../spend/Spend';
import { useAgents, useChatAgent } from '../agents/api';
import { NewChatAgent } from '../agents/ChatAgent';
import styles from './ChatView.module.css';
import { ChatContext } from './ChatContext';
import { attachmentUrl } from './uploads';
import { composerHistory, loadDraft, rememberSent, saveDraft } from './composer';

const attachmentSrc = (attachment: Attachment) => attachmentUrl(attachment.id);
import { AttachmentViewer, type Viewable } from './AttachmentViewer';
import { ComposerOffline } from './OfflineBits';
import { ChatHolds } from '../skills/ChatHolds';
import { SkillOfferInChat } from '../skills/SkillOfferInChat';
import { Transcript } from './Transcript';
import type { TurnRecovery } from './TranscriptItems';
import { biggerWindow } from './bigger';
import { type Draft, useDraftAttachments } from './useDraftAttachments';
import { useIntegrations } from '../integrations/queries';
import { ArtifactDock } from '../artifacts/ArtifactDock';
import { BrowserDock } from '../browser/BrowserDock';
import { Dictate } from '../voice/Dictate';
import { canSpeak } from '../voice/speak';
import { Talk } from '../voice/Talk';
import { NewChatPlace, useNewChatFolder } from '../chatlist/newChat';
import { useSeen } from '../chatlist/useSeen';

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
  const navigate = useNavigate();
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
  const bigger =
    last.problem === 'too-long' ? biggerWindow(turn.catalog, failed, last.model) : undefined;
  return {
    label: name(failed),
    ...(bigger &&
      text !== undefined && {
        bigger: {
          label: modelLabel(bigger.model.label).label,
          use: () => {
            turn.choose(modelKey(bigger.engine, bigger.model.id));
            send(text, attached);
          },
        },
      }),
    ...(last.problem === 'too-long' && {
      newChat: () => void navigate('/', { state: { draft: text ?? '' } }),
    }),
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

/** A message written while the reply runs, waiting its turn. */
interface Queued {
  id: string;
  text: string;
  attachments: Attachment[];
}

export function ChatView({ conversationId: routeId }: { conversationId?: string }) {
  const live = useLive();
  const navigate = useNavigate();
  const { data: app } = useAppState();
  const [sentId, setSentId] = useState<string>();
  const created = useLiveStore((s) => s.created);
  // A new chat is its conversation from the moment the server names it, before
  // the address follows: its first message moves there at that instant, and
  // the splash must not come back for the frame in between.
  const conversationId = routeId ?? (sentId ? created[sentId] : undefined);
  const key = conversationId ?? NEW;
  const heard = useLiveStore((s) => (conversationId ? s.views[conversationId] : undefined));
  const waiting = useLiveStore((s) => s.pending[key]);
  // Stop pressed: drawn stopped at once, not when the provider has wound down.
  // What was sent after Stop is the next turn's, still on its way.
  const stoppedAt = useLiveStore((s) => s.stopping[key]);
  const { view, pending } = useMemo(() => {
    const all = waiting ?? [];
    if (stoppedAt === undefined) return { view: heard ?? emptyView, pending: all };
    return {
      view: stoppedView(
        heard ?? emptyView,
        stoppedAt,
        all.filter((p) => p.at <= stoppedAt),
      ),
      pending: all.filter((p) => p.at > stoppedAt),
    };
  }, [heard, waiting, stoppedAt]);
  const engineIssue = useLiveStore((s) => s.engineIssue);
  const setEngineIssue = useLiveStore((s) => s.setEngineIssue);
  const openSettings = useUi((s) => s.openSettings);
  // "Try asking…" from an integration arrives as a ready-to-send draft.
  const location = useLocation();
  const startIn = useNewChatFolder();
  // Otherwise, what you were writing here before you went elsewhere.
  const [draft, setDraft] = useState(
    () => (location.state as { draft?: string } | null)?.draft ?? loadDraft(key),
  );
  useEffect(() => saveDraft(key, draft), [key, draft]);
  // The words can arrive after the chat is already open (the welcome hands them over as it
  // finishes): take them once per arrival.
  const [arrived, setArrived] = useState(location.key);
  if (arrived !== location.key) {
    setArrived(location.key);
    const handed = (location.state as { draft?: string } | null)?.draft;
    if (handed) setDraft(handed);
  }
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

  const record = useConversations().data?.find((c) => c.id === conversationId);
  // Who answers here (ADR 0101): its name and face over every reply; any agent by id
  // for the replies from before another one took the chat over. A new chat is with
  // the one chosen for it (the picker, `/agent`), from the moment it's chosen until
  // the chat says so itself.
  const agents = useAgents().data?.agents;
  const chatAgent = useChatAgent(record);
  const draftAgent = useUi((s) => s.draftAgent);
  const [startedWith, setStartedWith] = useState<string>();
  const newAgentId = draftAgent ?? (sentId ? startedWith : undefined);
  const agent =
    (!record?.agentId && newAgentId && agents?.find((a) => a.id === newAgentId)) || chatAgent;
  const agentOf = useMemo(() => (id: string) => agents?.find((a) => a.id === id), [agents]);
  const name = agent?.name ?? app?.persona.name ?? 'Conch';
  // Talking needs the microphone and a voice to answer with.
  const canTalk = typeof window !== 'undefined' && window.isSecureContext && canSpeak();
  const engine = app?.engine;
  const running = view.status === 'running' || view.status === 'awaiting-permission';
  // Stop is there the moment you send, not once the reply begins.
  const busy = running || pending.length > 0;
  // A question waits (ADR 0060): what's typed here answers it.
  const asking = running && Boolean(pendingQuestion(view));
  const isEmpty = view.items.length === 0 && pending.length === 0;
  // A chat this tab hasn't seen yet: its log is on its way, and it shows whole when it's here.
  const opening = Boolean(conversationId) && isEmpty && !view.loaded;

  useEffect(() => {
    if (!conversationId) return;
    return live.watch(conversationId);
  }, [conversationId, live]);
  // What lands while you're looking isn't new to you, here or on your phone (ADR 0089).
  useSeen(conversationId);
  // And so is what its tasks did: they tidy away from the list (ADR 0033).
  useSeenTasks(conversationId);

  // A new chat becomes a real conversation once the server confirms it. It's the
  // same chat (`fromNew`): the view stays as it is, only its address changes.
  useEffect(() => {
    if (!routeId && sentId && created[sentId]) {
      void navigate(`/c/${created[sentId]}`, { replace: true, state: { fromNew: true } });
    }
  }, [routeId, sentId, created, navigate]);

  useEffect(() => {
    // Arriving from search, the find field has focus; don't take it away.
    if (conversationId && useUi.getState().find?.conversationId === conversationId) return;
    // Nor from somewhere you're already typing (the terminal opened while the chat loaded).
    if (typingElsewhere(composerRef.current)) return;
    composerRef.current?.focus();
  }, [conversationId]);

  const turn = useTurnOptions(conversationId);
  // The model that answered a reply, by the name the picker gives it, for its speaker line.
  const catalog = turn.catalog;
  const modelName = useMemo(
    () => (engine: string | undefined, model: string | undefined) => {
      if (!model) return undefined;
      const found = catalog?.providers
        .find((p) => p.engine === engine)
        ?.models.find((m) => m.id === model);
      return found ? modelLabel(found.label).label : undefined;
    },
    [catalog],
  );
  const origin = record?.origin;
  const isRoutineRun = origin?.kind === 'routine';
  const continuingTask = useRef(false);

  /**
   * Send words, and whatever is attached (the draft's cards unless given).
   * `keepDraft`: words from elsewhere (a reply chip) leave what you're writing alone.
   */
  const send = (
    text: string,
    attached: Attachment[] = attachments.ready,
    {
      keepDraft = false,
      steer = false,
      options: extra,
    }: { keepDraft?: boolean; steer?: boolean; options?: TurnOptions } = {},
  ) => {
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
      if (continuingTask.current || !conversationId) return;
      continuingTask.current = true;
      // Shown as sent at once, as any message is; given back if the task can't take it.
      const requestKey = crypto.randomUUID();
      const store = useLiveStore.getState();
      store.addPending(conversationId, {
        clientMessageId: requestKey,
        text: trimmed,
        at: Date.now(),
        byText: true,
      });
      if (!keepDraft) setDraft('');
      void tasksApi
        .continue(origin.taskId, trimmed, requestKey)
        .catch((error: unknown) => {
          store.dropPending(conversationId, requestKey);
          if (!keepDraft) setDraft((d) => d || trimmed);
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
    rememberSent(trimmed);
    const drafted = turn.takeDraft();
    // A goal set before the first message (`/goal`) goes with it.
    const goal = conversationId ? undefined : (useUi.getState().draftGoal ?? undefined);
    if (goal) useUi.getState().setDraftGoal(null);
    // So does the agent chosen for it (ADR 0101).
    const agentId = conversationId ? undefined : (useUi.getState().draftAgent ?? undefined);
    if (agentId) useUi.getState().setDraftAgent(null);
    if (!conversationId) setStartedWith(agentId);
    const id = live.send(
      trimmed,
      conversationId,
      extra ? { ...drafted, ...extra } : drafted,
      attached,
      {
        steer,
        // Started from a folder in the chat list: it goes there from the start.
        ...(!conversationId && startIn && { folder: startIn.id }),
        ...(goal && { goal }),
        ...(agentId && { agentId }),
      },
    );
    if (!conversationId) setSentId(id);
    if (!keepDraft) setDraft('');
    if (attached === attachments.ready) attachments.clear();
    return id;
  };

  /**
   * Written while the reply is still coming: each waits its turn above the
   * box, in an order you can change, and goes by itself once the reply before
   * it is over, one at a time. Steer sends one at once: the reply stops where
   * it is (nothing it did is lost) and reads it now. The same with every
   * provider, since it's a stop and a send.
   */
  const [queue, setQueue] = useState<Queued[]>([]);
  /** The reply was stopped (not steered): the queue waits instead of sending by itself. */
  const [paused, setPaused] = useState(false);
  /**
   * The message a steer sent: until its own reply is over, an end you see is
   * the stopped reply's (never a reason to hold the queue), and nothing else goes.
   */
  const steered = useRef<string | undefined>(undefined);
  const enqueue = (text: string) => {
    const attached = attachments.ready;
    setQueue((q) => [...q, { id: crypto.randomUUID(), text, attachments: attached }]);
    setDraft('');
    attachments.clear();
  };
  const take = (id: string) => {
    const item = queue.find((q) => q.id === id);
    setQueue((q) => q.filter((i) => i.id !== id));
    return item;
  };
  /** Take a waiting message back into the box, after whatever is there. */
  const editQueued = (id: string) => {
    const item = take(id);
    if (!item) return;
    setDraft((d) => [d, item.text].filter((t) => t.trim()).join('\n\n'));
    if (item.attachments.length) attachments.restore(item.attachments);
    composerRef.current?.focus();
  };
  /** Send it now: while a reply runs, it stops first, and reads this next. */
  const steerWith = (text: string, attached: Attachment[]) => {
    setPaused(false);
    // One step on the gateway: it stops the reply, waits for it to close, then sends this.
    const steering = busy && Boolean(conversationId);
    const id = send(text, attached, { keepDraft: true, steer: steering });
    if (steering) steered.current = id;
  };
  const steer = (id: string) => {
    const item = take(id);
    if (item) steerWith(item.text, item.attachments);
  };
  /** ⌘↩ while it works: what's in the box steers instead of waiting. */
  const steerDraft = () => {
    const attached = attachments.ready;
    steerWith(draft, attached);
    setDraft('');
    if (attached.length) attachments.clear();
  };
  // A reply is over: the next waiting message goes. Stopped or failed, the queue waits for you.
  const replyOver = useEffectEvent(() => {
    if (steered.current) {
      // Its reply hasn't ended yet (or it hasn't even arrived): it's on its way.
      const at = view.items.findIndex((i) => i.kind === 'user' && i.id === steered.current);
      if (at < 0 || !view.items.slice(at + 1).some((i) => i.kind === 'turn-end')) return;
      steered.current = undefined;
    }
    if (!queue.length) return;
    const end = view.items.findLast((i) => i.kind === 'turn-end');
    if (end?.kind === 'turn-end' && end.outcome !== 'success') {
      setPaused(true);
      return;
    }
    const [next, ...rest] = queue;
    if (!next) return;
    setQueue(rest);
    // Whatever you've started writing since stays in the box.
    send(next.text, next.attachments, { keepDraft: true });
  });
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) replyOver();
    wasBusy.current = busy;
  }, [busy]);
  // Leaving the chat before they went: they stay here as what you were writing.
  const leaving = useEffectEvent(() => {
    if (queue.length)
      saveDraft(key, [draft, ...queue.map((q) => q.text)].filter((t) => t.trim()).join('\n\n'));
  });
  useEffect(() => () => leaving(), []);

  // ↑ in the empty box: this chat's messages, newest first, then what you sent lately elsewhere.
  const ownTexts = [
    ...view.items.flatMap((i) => (i.kind === 'user' && i.text ? [i.text] : [])),
    ...pending.map((p) => p.text),
  ];
  const ownKey = ownTexts.join('\u0000');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `ownKey` stands for `ownTexts`
  const history = useMemo(() => composerHistory(ownTexts), [ownKey]);

  // Typing anywhere in the chat writes in the box, as in other chat apps.
  const chatRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.length !== 1 || event.key === ' ') return;
      const box = composerRef.current;
      if (!box || box.disabled || document.querySelector('[aria-modal="true"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const fromPage = !target || target === document.body;
      if (!fromPage && !(chatRoot.current?.contains(target) && !keepsKeys(target))) return;
      box.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Run the draft as a task (ADR 0033); you keep chatting here. */
  const startTask = useStartTask();
  const sendAway = (words?: string) => {
    const text = (words ?? draft).trim();
    if (!text) {
      toast('Write what you’d like done, then run it as a task.');
      composerRef.current?.focus();
      return;
    }
    if (attachments.ready.length) {
      toast('A task can’t take attachments yet. Send it as a message instead.');
      return;
    }
    // On its way the moment it's pressed: the words come back only if it couldn't start.
    setDraft('');
    startTask.mutate(
      { text, ...(conversationId && { conversationId }), options: turn.options },
      {
        onError: () => setDraft((d) => d || (words === undefined ? text : `/task ${text}`)),
        onSuccess: (task) => {
          // From a chat, its card is right there; from a new one, it opens from here.
          toast(`Working on “${task.title}”`, {
            description: conversationId
              ? 'Its result will come back to this chat.'
              : 'You’ll be told when it’s done.',
            ...(!conversationId && {
              action: { label: 'Open', onClick: () => void navigate(taskPath(task)) },
            }),
          });
        },
      },
    );
  };
  // ⌘K "Run as a task" sends what's written here.
  const onBackground = useEffectEvent(() => sendAway());
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

  const slash = useSlashCommands({
    draft,
    setDraft,
    send: (text, how) => send(text, attachments.ready, how),
    turn,
    ...(conversationId && { conversationId }),
    view,
    busy,
    title: record?.title ?? '',
    name,
    retry: () => {
      const last = lastUserMessage(view);
      if (last) send(last.text, last.attachments);
    },
    background: (text) => sendAway(text),
    chooseFolder: () => chooseFolder(),
  });
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
      return 'This model can’t see pictures, so Conch describes it in words when another of your models can.';
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
  /** The folder chip: the desktop app's Open dialog, or Conch's folder browser from anywhere else. */
  const chooseFolder = () => {
    void chooseOnComputer({
      purpose: 'workspace',
      ...(app?.workspace && { current: app.workspace }),
    }).then(
      async (path) => {
        if (!path) return;
        // The chip shows the new folder at once; it goes back if it can't be used.
        await saveSettings.mutateAsync({ preferences: { workspace: path } }).then(
          () => toast.success(`Working in ${path.split(/[\\/]/).filter(Boolean).at(-1) ?? path}`),
          (error: Error) => toast.error(error.message || 'That folder can’t be used.'),
        );
      },
      () => openSettings('general'),
    );
  };

  const workspaceName = useMemo(
    () => app?.workspace.split(/[\\/]/).filter(Boolean).at(-1) ?? 'workspace',
    [app?.workspace],
  );

  // The transcript draws again only when the chat does, not with every keystroke here.
  const onRespond = useStable(
    (permissionId: string, decision: 'allow' | 'allow-always' | 'deny', edit?: MailEdit) =>
      conversationId && live.respond(conversationId, permissionId, decision, edit),
  );
  const onRetry = useStable(() => {
    const last = lastUserMessage(view);
    if (last) send(last.text, last.attachments);
  });
  const onAskAgain = useStable((messageId: string) => {
    const asked = view.items.find((i) => i.kind === 'user' && i.id === messageId);
    if (asked?.kind === 'user') send(asked.text, asked.attachments ?? []);
  });
  const onSend = useStable((text: string) => send(text, []));
  const focusComposer = useStable(() => composerRef.current?.focus());
  const onReply = useStable((text: string) => send(text, [], { keepDraft: true }));
  const overlay = useMemo(
    () =>
      conversationId && (
        <ChatFind conversationId={conversationId} root={columnRef} onClose={focusComposer} />
      ),
    [conversationId, focusComposer],
  );
  const footer = useMemo(
    // Save how I did this (ADR 0058): under the reply that earned it, once it's over.
    () => <SkillOfferInChat conversationId={conversationId} view={view} running={busy} />,
    [conversationId, view, busy],
  );

  const composer = (
    <div className={styles.composerWrap}>
      {/* Another connected provider can answer while the default one is away. */}
      <EngineIssue status={chosenReady ? undefined : engine} issue={engineIssue} />
      <UsageComposerNotice engine={turn.options.engine} />
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
        <ChatHolds conversationId={conversationId} holds={view.holds ?? []} running={busy} />
      )}
      {/* What this chat is for (`/goal`): quiet, one press to change or clear. */}
      <ChatGoal
        goal={slash.goal}
        onEdit={() => {
          setDraft(`/goal ${slash.goal ?? ''}`);
          composerRef.current?.focus();
        }}
        onClear={() =>
          conversationId
            ? void setChatGoal(conversationId, null, slash.goal)
            : useUi.getState().setDraftGoal(null)
        }
      />
      <Composer
        ref={composerRef}
        value={draft}
        onValueChange={slash.onDraftChange}
        onSubmit={(text) => {
          if (text && slash.submit(text)) return;
          if (busy && !asking) enqueue(text);
          else send(text);
        }}
        history={history}
        queued={
          queue.length > 0 && (
            <ComposerQueue
              items={queue.map((q) => ({
                id: q.id,
                text: q.text || `${q.attachments.length} attached`,
                ...(q.text &&
                  q.attachments.length > 0 && {
                    meta: `${q.attachments.length} ${q.attachments.length === 1 ? 'file' : 'files'}`,
                  }),
              }))}
              name={name}
              running={busy}
              paused={paused && !busy}
              onReorder={(ids) =>
                setQueue((q) => ids.flatMap((id) => q.find((i) => i.id === id) ?? []))
              }
              onSteer={steer}
              onEdit={editQueued}
              onRemove={(id) => {
                take(id);
                composerRef.current?.focus();
              }}
            />
          )
        }
        attachments={cards}
        onFiles={(files) => void attachments.addFiles(files)}
        onLongPaste={attachments.addPaste}
        foldPaste={shouldFoldPaste}
        canSubmitEmpty={attachments.ready.length > 0 && !asking}
        // While it works, what you send waits its turn (or answers its question).
        allowSubmitWhileRunning
        sendLabel={busy && !asking ? `Queue it: sends when ${name} is done` : undefined}
        runningHint={
          asking ? undefined : (
            <>
              <Kbd keys="enter" size="sm" /> to queue · <Kbd keys="mod+enter" size="sm" /> to steer
              · <Kbd keys="esc" size="sm" /> to stop
            </>
          )
        }
        sendBlocked={
          asking && attachments.ready.length
            ? 'Answer the question first, then send your files'
            : attachments.uploading
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
          if (e.defaultPrevented) return;
          // ⌘↩ while it works: send this now, steering the reply, instead of queueing it.
          const steerable =
            busy && !asking && (draft.trim() || attachments.ready.length) && !draft.startsWith('/');
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.shiftKey && steerable) {
            e.preventDefault();
            steerDraft();
          }
        }}
        textareaProps={slash.menu.inputProps}
        overlay={<CommandMenu {...slash.menu.menuProps} />}
        onStop={() => live.interrupt(conversationId)}
        running={busy}
        placeholder={
          asking
            ? 'Answer above, or type it here'
            : busy
              ? `${name} is working… Write what’s next`
              : `Message ${name}, or type / for commands`
        }
        label={`Message ${name}`}
        // An empty box's one button is Talk; typing turns it into Send.
        voice={
          canTalk
            ? { label: `Talk with ${name}`, onClick: () => useUi.setState({ talking: {} }) }
            : undefined
        }
        actions={
          <>
            {draft.trim() && (
              <IconButton
                label="Run as a task"
                shortcut="mod+shift+enter"
                shape="circle"
                loading={startTask.isPending}
                onClick={() => sendAway()}
              >
                <ListPlus />
              </IconButton>
            )}
            <Dictate draft={draft} setDraft={setDraft} />
          </>
        }
        toolbar={
          <>
            {(engine?.state === 'ready' || chosenReady) && (
              <ComposerControls turn={turn} name={name} />
            )}
            <ChatContext
              view={view}
              window={turn.model?.context}
              running={running}
              {...(conversationId && { onCompact: () => slash.compact() })}
            />
            <ChatSpend conversationId={conversationId} />
            <Tooltip content={app?.workspace ?? ''}>
              <ComposerChip
                icon={<Folder />}
                // From any device: the folder browser walks the computer Conch runs on.
                tuck
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
      {/* Said once, where a chat starts: under every reply it would only be noise. */}
      {isEmpty && !opening && (
        <Text size="2xs" tone="subtle" align="center" className={styles.hint}>
          {name} can make mistakes, and {modeInfo(turn.options.permissionMode).hint}.
        </Text>
      )}
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
      <div ref={chatRoot} className={styles.empty} {...drop.props}>
        {dropOverlay}
        <Stack gap={4} align="center" className={styles.hello}>
          <NewChatAgent />
          <Heading level={1} display size="4xl" align="center">
            {greeting()}
            {app?.profile.name ? `, ${app.profile.name}` : ''}.
          </Heading>
          <Text size="lg" tone="muted" align="center">
            What’s on your mind?
          </Text>
          <NewChatPlace />
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
    <div ref={chatRoot} className={styles.chat} {...drop.props}>
      {dropOverlay}
      <RunBanner conversationId={conversationId} />
      <TaskBanner conversationId={conversationId} />
      {origin?.kind !== 'task' && <TaskSheetHere />}
      <ClientBanner conversationId={conversationId} />
      <ChannelBanner conversationId={conversationId} />
      <ArchivedBanner conversationId={conversationId} />
      <Transcript
        view={view}
        opening={opening}
        conversationId={conversationId}
        columnRef={columnRef}
        routineRun={isRoutineRun}
        taskChat={origin?.kind === 'task'}
        overlay={overlay}
        pending={pending}
        name={agent?.name ?? name}
        avatar={agent?.avatar}
        agentOf={agentOf}
        modelName={modelName}
        onRespond={onRespond}
        onRetry={onRetry}
        onAskAgain={onAskAgain}
        onSend={onSend}
        focusComposer={focusComposer}
        onReply={onReply}
        recover={recover}
        footer={footer}
      />
      {/* Another app's chat is its log (ADR 0073): nobody writes in it. */}
      {origin?.kind !== 'client' && <div className={styles.dock}>{composer}</div>}
    </div>
  );
  // Wrapped the same before and after a new chat gets its id, so the transcript
  // and the composer stay where they are and nothing in them plays twice.
  return (
    <BrowserDock conversationId={conversationId} view={view}>
      <ArtifactDock conversationId={conversationId} view={view}>
        {chat}
      </ArtifactDock>
    </BrowserDock>
  );
}

/** A key pressed here is the control's own: a field, or a widget that walks with keys. */
function keepsKeys(target: HTMLElement): boolean {
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable], [role="dialog"], [role="menu"], [role="listbox"], [role="grid"], [role="radiogroup"], [role="tablist"], [role="slider"], [role="spinbutton"]',
    ),
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

/** A task opened over this chat (`?task=`): its sheet. */
function TaskSheetHere() {
  const { taskId, close, show } = useTaskSheet();
  return <TaskSheet taskId={taskId} onClose={close} onShow={show} />;
}
