import type {
  AppState,
  Attachment,
  ConversationSummary,
  HealLog,
  TurnOptions,
} from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

import { keys, setEngineStatus } from '../api/queries';
import { useUi } from '../app/ui';
import { DEVICES_FOCUS } from '../features/auth/focus';
import { browserKeys } from '../features/browser/queries';
import { terminalKeys } from '../features/terminal/queries';
import { applyChannelEvent } from '../features/channels/queries';
import { applyIntegrationEvent } from '../features/integrations/queries';
import { slackKeys } from '../features/integrations/slackApi';
import { healthKeys } from '../features/health/api';
import { backupKeys } from '../features/health/backups';
import { useImportProgress } from '../features/import/api';
import { applyArtifactEvent } from '../features/artifacts/queries';
import { applyRoutineEvent } from '../features/routines/queries';
import { applyTaskEvent, taskKeys } from '../features/tasks/queries';
import { skillKeys } from '../features/skills/queries';
import { vaultKeys } from '../features/passwords/queries';
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
  ): string;
  /** Change a conversation's model/effort/mode. */
  configure(conversationId: string, options: TurnOptions): void;
  /** Stop the running reply. A new chat's (no id yet) stops as soon as it has one. */
  interrupt(conversationId: string | undefined): void;
  respond(
    conversationId: string,
    permissionId: string,
    decision: 'allow' | 'allow-always' | 'deny',
  ): void;
  watch(conversationId: string): () => void;
}

const LiveContext = createContext<LiveApi | null>(null);

function upsertSummary(list: ConversationSummary[] | undefined, next: ConversationSummary) {
  const rest = (list ?? []).filter((c) => c.id !== next.id);
  return [next, ...rest].sort((a, b) => b.updatedAt - a.updatedAt);
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

  useEffect(() => {
    const store = useLiveStore.getState();
    const socket = new LiveSocket(url ?? socketUrl(), {
      onState: (state) => store.setConnection(state),
      onOpen: () => {
        // Whether this page is in front of someone: notifications wait while one is (ADR 0027).
        socket.send({ type: 'presence', visible: visibleNow() });
        // Resume every watched conversation from the last event we saw.
        for (const id of watching.current.keys()) {
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
        case 'conversation.event':
          live.apply(event.event);
          break;
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
          break;
        }
        case 'conversation.updated':
          client.setQueryData<ConversationSummary[]>(keys.conversations, (list) =>
            upsertSummary(list, event.conversation),
          );
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
          void client.invalidateQueries({ queryKey: keys.capabilities });
          if (event.status.state === 'ready') live.setEngineIssue(undefined);
          break;
        case 'engine.login':
          live.setLogin(event.login);
          break;
        case 'memory.changed':
          void client.invalidateQueries({ queryKey: keys.memories });
          break;
        case 'usage.changed':
          client.setQueryData(keys.usage, event.usage);
          break;
        case 'error': {
          const key = event.conversationId ?? NEW;
          if (event.clientMessageId) live.returnPending(key, event.clientMessageId);
          if (event.code === 'engine-unavailable') {
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
                onClick: () => useUi.getState().openSettings('security', DEVICES_FOCUS),
              },
            });
          waitingDevices.current = event.waiting;
          break;
        }
        case 'backups.changed':
          void client.invalidateQueries({ queryKey: backupKeys.status });
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
        case 'slack.changed':
          void client.invalidateQueries({ queryKey: slackKeys.status });
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
      send(text, conversationId, options, attachments) {
        const clientMessageId = `u_${crypto.randomUUID().slice(0, 12)}`;
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
      respond(conversationId, permissionId, decision) {
        socketRef.current?.send({
          type: 'permission.respond',
          conversationId,
          permissionId,
          decision,
        });
      },
      watch(conversationId) {
        const count = watching.current.get(conversationId) ?? 0;
        watching.current.set(conversationId, count + 1);
        if (count === 0) {
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
