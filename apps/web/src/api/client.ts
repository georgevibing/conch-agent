import {
  AppState,
  ConversationSummary,
  EngineStatus,
  Memory,
  type MemoryKind,
  type UpdateSettingsBody,
} from '@conch/protocol';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T extends z.ZodType>(
  schema: T,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', "Can't reach Conch. Is the gateway running?");
  }
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const body = (json ?? {}) as { error?: string; message?: string };
    throw new ApiError(response.status, body.error ?? 'error', body.message ?? response.statusText);
  }
  return schema.parse(json);
}

const Ok = z.object({ ok: z.boolean() });

/** Typed REST client. Every response is validated against the shared protocol. */
export const api = {
  state: () => request(AppState, '/api/state'),
  updateSettings: (body: UpdateSettingsBody) =>
    request(AppState, '/api/settings', { method: 'PATCH', body }),

  engine: (refresh = false) => request(EngineStatus, `/api/engine${refresh ? '?refresh=1' : ''}`),
  startLogin: (method: 'subscription' | 'console') =>
    request(Ok, '/api/engine/login', { method: 'POST', body: { method } }),
  submitLoginCode: (code: string) =>
    request(Ok, '/api/engine/login/code', { method: 'POST', body: { code } }),
  cancelLogin: () => request(Ok, '/api/engine/login/cancel', { method: 'POST', body: {} }),
  setApiKey: (apiKey: string) =>
    request(EngineStatus, '/api/engine/api-key', { method: 'PUT', body: { apiKey } }),
  clearApiKey: () => request(EngineStatus, '/api/engine/api-key', { method: 'DELETE' }),

  memories: () => request(z.array(Memory), '/api/memories'),
  addMemory: (content: string, kind: MemoryKind = 'fact') =>
    request(Memory, '/api/memories', { method: 'POST', body: { content, kind } }),
  updateMemory: (id: string, patch: { content?: string; kind?: MemoryKind }) =>
    request(Memory, `/api/memories/${id}`, { method: 'PATCH', body: patch }),
  deleteMemory: (id: string) => request(Ok, `/api/memories/${id}`, { method: 'DELETE' }),

  conversations: () => request(z.array(ConversationSummary), '/api/conversations'),
  renameConversation: (id: string, title: string) =>
    request(Ok, `/api/conversations/${id}`, { method: 'PATCH', body: { title } }),
  deleteConversation: (id: string) => request(Ok, `/api/conversations/${id}`, { method: 'DELETE' }),
};
