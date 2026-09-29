import type { ConversationEvent, LoginState } from '@conch/protocol';
import { create } from 'zustand';

import { emptyView, reduce, type ConversationView } from './reducer';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting';

export interface PendingMessage {
  clientMessageId: string;
  text: string;
  at: number;
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
  returned?: { key: string; text: string };

  setConnection(state: ConnectionState): void;
  apply(event: ConversationEvent): void;
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

export const useLiveStore = create<LiveState>((set) => ({
  connection: 'connecting',
  views: {},
  pending: {},
  created: {},

  setConnection: (connection) => set({ connection }),
  apply: (event) =>
    set((state) => {
      const current = state.views[event.conversationId] ?? emptyView;
      const next = reduce(current, event);
      if (next === current) return state;
      const pending =
        event.type === 'user.message'
          ? (state.pending[event.conversationId] ?? []).filter(
              (p) => p.clientMessageId !== event.messageId,
            )
          : state.pending[event.conversationId];
      return {
        views: { ...state.views, [event.conversationId]: next },
        pending: pending ? { ...state.pending, [event.conversationId]: pending } : state.pending,
      };
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
        returned: message ? { key, text: message.text } : state.returned,
      };
    }),
  clearReturned: () => set({ returned: undefined }),
  markCreated: (clientMessageId, conversationId) =>
    set((state) => {
      const moving = (state.pending[NEW] ?? []).filter(
        (p) => p.clientMessageId === clientMessageId,
      );
      return {
        created: { ...state.created, [clientMessageId]: conversationId },
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
