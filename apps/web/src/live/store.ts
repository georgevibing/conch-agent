import type { Attachment, ConversationEvent, LoginState } from '@conch/protocol';
import { create } from 'zustand';

import { decided, emptyView, reduce, type ConversationView } from './reducer';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting';

export interface PendingMessage {
  clientMessageId: string;
  text: string;
  at: number;
  attachments?: Attachment[];
  /**
   * Sent another way than the socket (a task's next instruction): the chat's
   * log names it afresh (and may wrap it), so it's matched by its words.
   */
  byText?: boolean;
}

/** Key for a conversation that doesn't exist yet (the first message of a new chat). */
export const NEW = '__new__';

interface LiveState {
  connection: ConnectionState;
  views: Record<string, ConversationView>;
  /** Optimistic user messages not yet echoed by the server, per conversation (or NEW). */
  pending: Record<string, PendingMessage[]>;
  /** clientMessageId → conversation id, once the server created it. */
  created: Record<string, string>;
  login?: LoginState;
  /** Set when a send failed because the engine isn't ready. */
  engineIssue?: string;
  /** Text of a message the server rejected, so the composer can give it back. */
  returned?: { key: string; text: string; attachments?: Attachment[] };
  /**
   * Chats (or NEW) where Stop was pressed and the gateway hasn't closed the
   * turn yet, with when: they're drawn stopped at once (`stoppedView`).
   */
  stopping: Record<string, number>;

  setConnection(state: ConnectionState): void;
  apply(event: ConversationEvent): void;
  /** Stop pressed: the chat shows it stopped now, before the gateway says so. */
  stop(key: string): void;
  /** An approval answered: the card shows the answer now; the gateway's echo says the same. */
  decide(
    conversationId: string,
    permissionId: string,
    decision: 'allow' | 'allow-always' | 'deny',
  ): void;
  addPending(key: string, message: PendingMessage): void;
  dropPending(key: string, clientMessageId: string): void;
  /** Drop a pending message and hand its text back to the composer. */
  returnPending(key: string, clientMessageId: string): void;
  clearReturned(): void;
  markCreated(clientMessageId: string, conversationId: string): void;
  setLogin(login: LoginState | undefined): void;
  setEngineIssue(message: string | undefined): void;
  forget(conversationId: string): void;
}

/** The gateway closed what Stop stopped (or nothing was running to stop). */
const settlesStop = (event: ConversationEvent) =>
  event.type === 'turn.completed' ||
  event.type === 'turn.held' ||
  event.type === 'turn.needs-apps' ||
  (event.type === 'status' && event.status !== 'running' && event.status !== 'awaiting-permission');

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _gone, ...rest } = record;
  return rest;
}

export const useLiveStore = create<LiveState>((set) => ({
  connection: 'connecting',
  views: {},
  pending: {},
  created: {},
  stopping: {},

  setConnection: (connection) => set({ connection }),
  apply: (event) =>
    set((state) => {
      const current = state.views[event.conversationId] ?? emptyView;
      const next = reduce(current, event);
      if (next === current) return state;
      const pending =
        event.type === 'user.message'
          ? (state.pending[event.conversationId] ?? []).filter(
              (p) =>
                p.clientMessageId !== event.messageId &&
                !(p.byText && event.text.includes(p.text.trim())),
            )
          : state.pending[event.conversationId];
      return {
        views: { ...state.views, [event.conversationId]: next },
        pending: pending ? { ...state.pending, [event.conversationId]: pending } : state.pending,
        ...(event.conversationId in state.stopping &&
          settlesStop(event) && { stopping: without(state.stopping, event.conversationId) }),
      };
    }),
  stop: (key) => set((state) => ({ stopping: { ...state.stopping, [key]: Date.now() } })),
  decide: (conversationId, permissionId, decision) =>
    set((state) => {
      const view = state.views[conversationId];
      if (!view) return state;
      const next = decided(view, permissionId, decision);
      return next === view ? state : { views: { ...state.views, [conversationId]: next } };
    }),
  addPending: (key, message) =>
    set((state) => ({
      pending: { ...state.pending, [key]: [...(state.pending[key] ?? []), message] },
    })),
  dropPending: (key, clientMessageId) =>
    set((state) => ({
      pending: {
        ...state.pending,
        [key]: (state.pending[key] ?? []).filter((p) => p.clientMessageId !== clientMessageId),
      },
    })),
  returnPending: (key, clientMessageId) =>
    set((state) => {
      const message = (state.pending[key] ?? []).find((p) => p.clientMessageId === clientMessageId);
      return {
        pending: {
          ...state.pending,
          [key]: (state.pending[key] ?? []).filter((p) => p.clientMessageId !== clientMessageId),
        },
        returned: message
          ? { key, text: message.text, attachments: message.attachments }
          : state.returned,
      };
    }),
  clearReturned: () => set({ returned: undefined }),
  markCreated: (clientMessageId, conversationId) =>
    set((state) => {
      const moving = (state.pending[NEW] ?? []).filter(
        (p) => p.clientMessageId === clientMessageId,
      );
      const stopped = state.stopping[NEW];
      return {
        created: { ...state.created, [clientMessageId]: conversationId },
        // A new chat stopped before it had an id stays stopped under its id.
        ...(stopped !== undefined && {
          stopping: { ...without(state.stopping, NEW), [conversationId]: stopped },
        }),
        pending: {
          ...state.pending,
          [NEW]: (state.pending[NEW] ?? []).filter((p) => p.clientMessageId !== clientMessageId),
          [conversationId]: [...(state.pending[conversationId] ?? []), ...moving],
        },
      };
    }),
  setLogin: (login) => set({ login }),
  setEngineIssue: (engineIssue) => set({ engineIssue }),
  forget: (conversationId) =>
    set((state) => {
      const { [conversationId]: _removed, ...views } = state.views;
      return { views };
    }),
}));
