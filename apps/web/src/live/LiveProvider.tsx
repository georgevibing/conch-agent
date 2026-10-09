import type {
  AgentId,
  AppState,
  Attachment,
  ConversationEvent,
  ConversationSummary,
  HealLog,
  MailEdit,
  TurnOptions,
} from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { keys, refreshCapabilities, setEngineStatus } from '../api/queries';
import { useUi } from '../app/ui';
import { applyAgentsEvent } from '../features/agents/api';
import { DEVICES_FOCUS } from '../features/auth/focus';
import { browserKeys } from '../features/browser/queries';
import { terminalKeys } from '../features/terminal/queries';
import { applyChannelEvent } from '../features/channels/queries';
import { applyIntegrationEvent } from '../features/integrations/queries';
import { healthKeys } from '../features/health/api';
import { backupKeys } from '../features/health/backups';
import { useImportProgress } from '../features/import/api';
import { learningKeys } from '../features/learning/api';
import { applyArtifactEvent } from '../features/artifacts/queries';
import { applyConchAppsEvent } from '../features/conchapps/queries';
import { applyRoutineEvent } from '../features/routines/queries';
import { applyTaskEvent, taskKeys } from '../features/tasks/queries';
import { skillKeys } from '../features/skills/queries';
import { vaultKeys } from '../features/passwords/queries';
import { setVoicePrefs } from '../features/voice/prefs';
import { updateKeys } from '../features/updates/api';
import { followRestart } from '../features/updates/queries';
import { LiveSocket, socketUrl } from './socket';
import { NEW, useLiveStore } from './store';

interface LiveApi {
  /** Send a message; returns the clientMessageId. Omit conversationId for a new chat. */
  send(
    text: string,
    conversationId?: string,
    options?: TurnOptions,
    attachments?: Attachment[],
    /**
     * `steer`: stop the running reply first, then send this, as one step.
     * `folder`: a new chat starts in this folder of the chat list.
     * `goal`: the chat's goal (`/goal` before its first message).
     * `agentId`: a new chat is with this agent (ADR 0101); unset, the default.
     */
    how?: { steer?: boolean; folder?: string; goal?: string; agentId?: AgentId },
  ): string;
  /** Change a conversation's model/effort/mode. */
  configure(conversationId: string, options: TurnOptions): void;
  /** Stop the running reply. A new chat's (no id yet) stops as soon as it has one. */
  interrupt(conversationId: string | undefined): void;
  /** Answer a question; `edit` is the email as the person changed it on an `editable` card. */
  respond(
    conversationId: string,
    permissionId: string,
    decision: 'allow' | 'allow-always' | 'deny',
    edit?: MailEdit,
  ): void;
  watch(conversationId: string): () => void;
}

const LiveContext = createContext<LiveApi | null>(null);

/** Allows on their way, by question: sent again once you confirm it's you (ADR 0108). */
const allowsSent = new Map<string, { decision: 'allow' | 'allow-always'; edit?: MailEdit }>();

function upsertSummary(list: ConversationSummary[] | undefined, next: ConversationSummary) {
  const rest = (list ?? []).filter((c) => c.id !== next.id);
  return [next, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Per chat: the events held until its log is all here, and how many asks are still answering. */
type CatchingUp = Map<string, { events: ConversationEvent[]; asked: number }>;

function askedFor(catchingUp: CatchingUp, id: string) {
  const entry = catchingUp.get(id) ?? { events: [], asked: 0 };
  entry.asked += 1;
  catchingUp.set(id, entry);
}

/** In front of someone: the tab is showing and the window has focus. */
const visibleNow = () =>
  document.visibilityState === 'visible' &&
  (typeof document.hasFocus !== 'function' || document.hasFocus());

/** Owns the single WebSocket and routes server events into the store and query cache. */
export function LiveProvider({ children, url }: { children: ReactNode; url?: string }) {
  const client = useQueryClient();
  const watching = useRef(new Map<string, number>());
  const socketRef = useRef<LiveSocket | null>(null);
  /** Messages whose new chat should stop the moment it exists (Stop pressed right after sending). */
  const stopWhenCreated = useRef(new Set<string>());
  /** New chats started from this tab, newest last, until they've been stopped or answered. */
  const startedNew = useRef<string[]>([]);
  /** Devices waiting for approval, as last heard, to notice a new one asking. */
  const waitingDevices = useRef(0);
  /**
   * Chats whose log is on its way (subscribed, not yet synced): what arrives is
   * held and folded in at once, so the chat is drawn whole, not piling in.
   */
  const catchingUp = useRef<CatchingUp>(new Map());
  const askFor = (id: string) => askedFor(catchingUp.current, id);

  useEffect(() => {
    const store = useLiveStore.getState();
    const socket = new LiveSocket(url ?? socketUrl(), {
      onState: (state) => store.setConnection(state),
      onOpen: () => {
        // Whether this page is in front of someone: notifications wait while one is (ADR 0027).
        socket.send({ type: 'presence', visible: visibleNow() });
        // Resume every watched conversation from the last event we saw. What the
        // last connection was still sending won't come; this one sends it again.
        catchingUp.current.clear();
        for (const id of watching.current.keys()) {
          askFor(id);
          const lastSeq = useLiveStore.getState().views[id]?.lastSeq;
          socket.send({
            type: 'conversation.subscribe',
            conversationId: id,
            ...(lastSeq !== undefined && lastSeq >= 0 && { afterSeq: lastSeq }),
          });
        }
        void client.invalidateQueries({ queryKey: keys.conversations });
        // Tasks carry on while the page is away: catch up on what they did meanwhile.
        void client.invalidateQueries({ queryKey: taskKeys.all });
        // A web app built again meanwhile (or an update waiting): a woken phone hears of it.
        void client.invalidateQueries({ queryKey: updateKeys.status });
      },
    });
    socketRef.current = socket;
    const sayPresence = () => socket.send({ type: 'presence', visible: visibleNow() });
    document.addEventListener('visibilitychange', sayPresence);
    window.addEventListener('focus', sayPresence);
    window.addEventListener('blur', sayPresence);

    const off = socket.on((event) => {
      const live = useLiveStore.getState();
      switch (event.type) {
        case 'conversation.event': {
          const held = catchingUp.current.get(event.event.conversationId);
          if (held) held.events.push(event.event);
          else live.apply(event.event);
          break;
        }
        case 'conversation.synced': {
          const held = catchingUp.current.get(event.conversationId);
          if (!held || --held.asked > 0) break;
          catchingUp.current.delete(event.conversationId);
          live.catchUp(event.conversationId, held.events);
          break;
        }
        case 'conversation.created': {
          // Only the tab that sent the first message is subscribed by the gateway. A chat
          // started elsewhere (another tab, Telegram) is subscribed when someone opens it.
          const ours = (live.pending[NEW] ?? []).some(
            (p) => p.clientMessageId === event.clientMessageId,
          );
          live.markCreated(event.clientMessageId, event.conversation.id);
          // Stop was pressed before the chat existed: it stops now.
          if (stopWhenCreated.current.delete(event.clientMessageId))
            socketRef.current?.send({
              type: 'conversation.interrupt',
              conversationId: event.conversation.id,
            });
          if (ours)
            watching.current.set(
              event.conversation.id,
              (watching.current.get(event.conversation.id) ?? 0) + 1,
            );
          client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
            upsertSummary(list, event.conversation),
          );
          // From here the chat's own options say it: in the list, under its id.
          if (ours) live.setStartedWith(undefined);
          break;
        }
        case 'conversation.updated': {
          const before = client
            .getQueryData<ConversationSummary[]>(keys.conversations)
            ?.find((c) => c.id === event.conversation.id)?.status;
          client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
            upsertSummary(list, event.conversation),
          );
          // Another app asking through Conch (ADR 0073): its chat is out of sight, so say so here.
          const { origin, status, id } = event.conversation;
          if (
            origin?.kind === 'client' &&
            status === 'awaiting-permission' &&
            before !== 'awaiting-permission' &&
            window.location.pathname !== `/c/${id}`
          )
            toast(`${origin.name} needs your OK`, {
              description: 'It’s waiting for your answer before it goes on.',
              duration: 30_000,
              action: {
                label: 'Review',
                onClick: () =>
                  window.dispatchEvent(new CustomEvent('conch:navigate', { detail: `/c/${id}` })),
              },
            });
          break;
        }
        case 'folders.changed':
          client.setQueryData(keys.folders, event.folders);
          break;
        case 'agents.changed':
          applyAgentsEvent(client, event);
          break;
        case 'conversation.reset':
          live.forget(event.conversationId);
          break;
        case 'conversation.deleted':
          live.forget(event.conversationId);
          client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
            (list ?? []).filter((c) => c.id !== event.conversationId),
          );
          break;
        case 'engine.status':
          setEngineStatus(client, event.status);
          // Signing in or switching accounts changes which models (and providers) exist.
          void refreshCapabilities(client);
          if (event.status.state === 'ready') live.setEngineIssue(undefined);
          break;
        case 'engine.login':
          live.setLogin(event.login);
          // Signed in: every place showing providers looks again now, not on its next poll.
          if (event.login.phase === 'done') {
            void client.invalidateQueries({ queryKey: ['providers'] });
            void client.invalidateQueries({ queryKey: ['provider'] });
          }
          break;
        case 'wake.stop':
          // "Stop listening" in the tray (ADR 0078).
          setVoicePrefs({ wake: false });
          break;
        case 'memory.changed':
          void client.invalidateQueries({ queryKey: keys.memories });
          break;
        // Something was learned or answered, or what learning may spend changed (ADR 0088).
        case 'learning.changed':
          void client.invalidateQueries({ queryKey: learningKeys.all });
          void client.invalidateQueries({ queryKey: keys.memories });
          break;
        case 'usage.changed':
          if (event.usage.engine)
            client.setQueryData(keys.usageOf(event.usage.engine), event.usage);
          // Who would carry on at a limit depends on everyone's room (ADR 0126).
          void client.invalidateQueries({ queryKey: ['fallback'] });
          break;
        case 'error': {
          const key = event.conversationId ?? NEW;
          if (event.clientMessageId) live.returnPending(key, event.clientMessageId);
          const sent = event.permissionId ? allowsSent.get(event.permissionId) : undefined;
          if (event.code === 'verify-required' && event.conversationId && event.permissionId) {
            // A step that matters, from this device: the card waits again while you confirm.
            if (sent)
              live.needStepUp({
                conversationId: event.conversationId,
                permissionId: event.permissionId,
                ...sent,
                message: event.message,
              });
          } else if (event.code === 'engine-unavailable') {
            live.setEngineIssue(event.message);
            void client.invalidateQueries({ queryKey: keys.engine });
          } else if (event.code === 'busy') {
            toast('Still replying', {
              description: 'Wait for it to finish, or press Esc to stop.',
            });
          } else {
            toast.error(event.message);
          }
          break;
        }
        case 'terminal.changed':
          void client.invalidateQueries({ queryKey: terminalKeys.status });
          break;
        case 'browser.status':
          client.setQueryData(browserKeys.status, event.status);
          break;
        case 'skills.changed':
          void client.invalidateQueries({ queryKey: skillKeys.all });
          void client.invalidateQueries({ queryKey: skillKeys.publishers });
          break;
        case 'skills.offered':
          void client.invalidateQueries({ queryKey: skillKeys.fromWork });
          break;
        case 'vault.changed':
          void client.invalidateQueries({ queryKey: vaultKeys.all });
          break;
        case 'network.status':
          // Offline and back: the composer and waiting messages say what happens.
          client.setQueryData<AppState>(keys.state, (state) =>
            state ? { ...state, network: event.network } : state,
          );
          break;
        case 'access.changed': {
          void client.invalidateQueries({ queryKey: keys.access });
          // Someone signed in with the right password or key and is waiting: worth a word,
          // since only a person can say whether it's theirs.
          if (event.waiting > waitingDevices.current)
            toast('A new device is asking to sign in', {
              description: 'Approve it only if it’s yours.',
              duration: 20_000,
              action: {
                label: 'Review',
                onClick: () => useUi.getState().openSettings('access', DEVICES_FOCUS),
              },
            });
          waitingDevices.current = event.waiting;
          break;
        }
        case 'backups.changed':
          void client.invalidateQueries({ queryKey: backupKeys.status });
          break;
        case 'address.changed':
          // Your own address (ADR 0064): checking, a certificate, ready, or a problem.
          client.setQueryData(keys.address, event.address);
          // The checkup says what it means for your security.
          void client.invalidateQueries({ queryKey: keys.access });
          break;
        case 'import.progress':
          useImportProgress.setState({
            done: event.done,
            total: event.total,
            current: event.current,
          });
          break;
        case 'doctor.report':
          client.setQueryData(healthKeys.doctor, event.report);
          break;
        case 'updates.changed':
          // Quiet: a dot and a line in Settings, never a toast. Conch's own
          // update ends on the restart screen, then a reload onto the new version.
          client.setQueryData(updateKeys.status, event.status);
          followRestart(event.status);
          break;
        case 'healed':
          // Quiet on purpose: it only updates the list in Settings, never a toast.
          client.setQueryData<HealLog>(keys.healed, (log) =>
            log ? { notes: [event.note, ...log.notes.filter((n) => n.id !== event.note.id)] } : log,
          );
          break;
        case 'channel.changed':
        case 'channel.deleted':
        case 'channel.link':
        case 'channel.door':
          applyChannelEvent(client, event, (to) =>
            window.dispatchEvent(new CustomEvent('conch:navigate', { detail: to })),
          );
          break;
        case 'integration.changed':
        case 'integration.deleted':
          applyIntegrationEvent(client, event);
          break;
        case 'conch-apps.changed':
          applyConchAppsEvent(client);
          break;
        case 'artifact.changed':
        case 'artifact.deleted':
          applyArtifactEvent(client, event);
          break;
        case 'task.changed':
        case 'task.deleted':
          applyTaskEvent(client, event, (to) =>
            window.dispatchEvent(new CustomEvent('conch:navigate', { detail: to })),
          );
          break;
        case 'routine.changed':
        case 'routine.deleted':
        case 'routine.run':
        case 'routines.spending':
          // LiveProvider sits outside the router; the Shell performs navigations.
          applyRoutineEvent(client, event, (to) =>
            window.dispatchEvent(new CustomEvent('conch:navigate', { detail: to })),
          );
          break;
        default:
          break;
      }
    });

    socket.connect();
    return () => {
      document.removeEventListener('visibilitychange', sayPresence);
      window.removeEventListener('focus', sayPresence);
      window.removeEventListener('blur', sayPresence);
      off();
      socket.close();
    };
  }, [client, url]);

  const value = useMemo<LiveApi>(
    () => ({
      send(text, conversationId, options, attachments, how) {
        const clientMessageId = `u_${crypto.randomUUID().slice(0, 12)}`;
        // A new chat keeps what it was started with until the server names it.
        if (!conversationId) useLiveStore.getState().setStartedWith(options);
        useLiveStore.getState().addPending(conversationId ?? NEW, {
          clientMessageId,
          text,
          at: Date.now(),
          ...(attachments?.length && { attachments }),
        });
        socketRef.current?.send({
          type: 'conversation.send',
          conversationId,
          clientMessageId,
          text,
          ...(attachments?.length && { attachments: attachments.map((a) => a.id) }),
          ...(options && { options }),
          ...(how?.steer && { steer: true }),
          ...(!conversationId && how?.folder && { folder: how.folder }),
          ...(how?.goal && { goal: how.goal }),
          ...(!conversationId && how?.agentId && { agentId: how.agentId }),
        });
        if (!conversationId)
          startedNew.current = [...startedNew.current.slice(-9), clientMessageId];
        return clientMessageId;
      },
      configure(conversationId, options) {
        // Optimistic: the picker reflects the change immediately.
        client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
          list?.map((c) =>
            c.id === conversationId ? { ...c, options: { ...c.options, ...options } } : c,
          ),
        );
        socketRef.current?.send({ type: 'conversation.configure', conversationId, options });
      },
      interrupt(conversationId) {
        // Drawn stopped this instant; the gateway's word follows (`stoppedView`).
        useLiveStore.getState().stop(conversationId ?? NEW);
        if (conversationId) {
          socketRef.current?.send({ type: 'conversation.interrupt', conversationId });
          return;
        }
        // A new chat the server already made, while this view hasn't caught up
        // with its address yet (a slow machine): stop that one now.
        const { created, pending } = useLiveStore.getState();
        for (const clientMessageId of startedNew.current) {
          const id = created[clientMessageId];
          if (id) socketRef.current?.send({ type: 'conversation.interrupt', conversationId: id });
          else stopWhenCreated.current.add(clientMessageId);
        }
        for (const message of pending[NEW] ?? [])
          stopWhenCreated.current.add(message.clientMessageId);
        startedNew.current = [];
      },
      respond(conversationId, permissionId, decision, edit) {
        useLiveStore.getState().decide(conversationId, permissionId, decision);
        if (decision === 'deny') allowsSent.delete(permissionId);
        else allowsSent.set(permissionId, { decision, ...(edit && { edit }) });
        if (allowsSent.size > 50) allowsSent.delete(allowsSent.keys().next().value ?? '');
        socketRef.current?.send({
          type: 'permission.respond',
          conversationId,
          permissionId,
          decision,
          ...(edit && { edit }),
        });
      },
      watch(conversationId) {
        const count = watching.current.get(conversationId) ?? 0;
        watching.current.set(conversationId, count + 1);
        if (count === 0) {
          askFor(conversationId);
          const lastSeq = useLiveStore.getState().views[conversationId]?.lastSeq;
          socketRef.current?.send({
            type: 'conversation.subscribe',
            conversationId,
            ...(lastSeq !== undefined && lastSeq >= 0 && { afterSeq: lastSeq }),
          });
        }
        return () => {
          const n = (watching.current.get(conversationId) ?? 1) - 1;
          if (n <= 0) watching.current.delete(conversationId);
          else watching.current.set(conversationId, n);
        };
      },
    }),
    [client],
  );

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveApi {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive must be used inside <LiveProvider>.');
  return ctx;
}
