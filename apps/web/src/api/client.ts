import {
  AccessSettings,
  AppState,
  AuthStatus,
  type CheckupAction,
  CheckupFixResult,
  CreatedKey,
  PairingCode,
  type SignInBody,
  Capabilities,
  ConversationSummary,
  CustomCommand,
  EngineStatus,
  HealLog,
  Memory,
  type MemoryKind,
  ModelCatalog,
  type EngineId,
  SearchPreview,
  SearchRepairResult,
  SearchResults,
  type UpdateSettingsBody,
  UsageSnapshot,
} from '@conch/protocol';
import { z } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Seconds to wait, when rate-limited. */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

/** Fired when the gateway says this browser isn't (or is no longer) signed in. */
export const SIGNED_OUT_EVENT = 'conch:signed-out';

export async function request<T extends z.ZodType>(
  schema: T,
  path: string,
  init?: { method?: string; body?: unknown; signal?: AbortSignal },
): Promise<z.infer<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      signal: init?.signal,
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (error) {
    if (init?.signal?.aborted) throw error;
    throw new ApiError(0, 'offline', "Can't reach Conch. Is the gateway running?");
  }
  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const body = (json ?? {}) as { error?: string; message?: string; retryAfter?: number };
    if (response.status === 401 && !path.startsWith('/api/auth'))
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(
      response.status,
      body.error ?? 'error',
      body.message ?? response.statusText,
      body.retryAfter,
    );
  }
  return schema.parse(json);
}

const Ok = z.object({ ok: z.boolean() });

/** Typed REST client. Every response is validated against the shared protocol. */
export const api = {
  // Sign-in & security
  auth: () => request(AuthStatus, '/api/auth'),
  signIn: (body: SignInBody) => request(AuthStatus, '/api/auth/sign-in', { method: 'POST', body }),
  signOut: () => request(Ok, '/api/auth/sign-out', { method: 'POST' }),
  access: () => request(AccessSettings, '/api/access'),
  verify: (secret: string) =>
    request(AccessSettings, '/api/access/verify', { method: 'POST', body: { secret } }),
  setPassword: (username: string, password: string) =>
    request(AccessSettings, '/api/access/password', {
      method: 'PUT',
      body: { username, password },
    }),
  createKey: (name: string) =>
    request(CreatedKey, '/api/access/keys', { method: 'POST', body: { name } }),
  revokeKey: (id: string) =>
    request(AccessSettings, `/api/access/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  disableSignIn: () => request(Ok, '/api/access', { method: 'DELETE' }),
  createPairing: () => request(PairingCode, '/api/access/pairing', { method: 'POST' }),
  revokeSession: (id: string) =>
    request(AccessSettings, `/api/access/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  revokeOtherSessions: () => request(AccessSettings, '/api/access/sessions', { method: 'DELETE' }),
  /** A checkup finding's one-click fix; returns what changed and the checkup without it. */
  fixCheckup: (action: CheckupAction) =>
    request(CheckupFixResult, '/api/access/fix', { method: 'POST', body: { action } }),
  /** Approve new devices: on from any signed-in device, off only on this computer. */
  setApproval: (on: boolean) =>
    request(AccessSettings, '/api/access/approval', { method: 'PUT', body: { on } }),
  /** Only on the computer running Conch. */
  approveDevice: (code: string) =>
    request(AccessSettings, `/api/access/requests/${encodeURIComponent(code)}/approve`, {
      method: 'POST',
    }),
  rejectDevice: (code: string) =>
    request(AccessSettings, `/api/access/requests/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),
  signOutDevice: (id: string) =>
    request(AccessSettings, `/api/access/devices/${encodeURIComponent(id)}/sign-out`, {
      method: 'POST',
    }),
  removeDevice: (id: string) =>
    request(AccessSettings, `/api/access/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  renameDevice: (id: string, name: string) =>
    request(AccessSettings, `/api/access/devices/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { name },
    }),

  state: () => request(AppState, '/api/state'),
  healed: () => request(HealLog, '/api/healed'),
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

  usage: (refresh = false) => request(UsageSnapshot, `/api/usage${refresh ? '?refresh=1' : ''}`),
  setBudget: (budget: number | null) =>
    request(UsageSnapshot, '/api/usage/budget', { method: 'PUT', body: { budget } }),

  capabilities: (refresh = false, engine?: EngineId) => {
    const params = new URLSearchParams();
    if (refresh) params.set('refresh', '1');
    if (engine) params.set('engine', engine);
    const query = params.toString();
    return request(Capabilities, `/api/capabilities${query ? `?${query}` : ''}`);
  },
  /** Every connected provider's models at once, for the picker. */
  models: (refresh = false) => request(ModelCatalog, `/api/models${refresh ? '?refresh=1' : ''}`),

  commands: () => request(z.array(CustomCommand), '/api/commands'),
  saveCommand: (command: { name: string; description: string; prompt: string }) =>
    request(CustomCommand, `/api/commands/${encodeURIComponent(command.name)}`, {
      method: 'PUT',
      body: { description: command.description, prompt: command.prompt },
    }),
  deleteCommand: (name: string) =>
    request(Ok, `/api/commands/${encodeURIComponent(name)}`, { method: 'DELETE' }),

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
  /** A message waiting for the internet goes now — with `engine` (the model on this computer), if given. */
  releaseTurn: (id: string, engine?: EngineId) =>
    request(Ok, `/api/conversations/${id}/release`, {
      method: 'POST',
      body: engine ? { engine } : {},
    }),
  /** Stop holding this conversation to a skill's list (ADR 0047). */
  stopHolding: (id: string, skillId: string) =>
    request(
      Ok,
      `/api/conversations/${encodeURIComponent(id)}/skills/${encodeURIComponent(skillId)}/stop-holding`,
      { method: 'POST', body: {} },
    ),
  /** “Not now” on an offer to connect an app, for the rest of this conversation. */
  dismissSuggestion: (id: string, catalogId: string) =>
    request(
      Ok,
      `/api/conversations/${encodeURIComponent(id)}/suggestions/${encodeURIComponent(catalogId)}/dismiss`,
      { method: 'POST', body: {} },
    ),

  search: (q: string, options: { in?: string; limit?: number; signal?: AbortSignal } = {}) => {
    const params = new URLSearchParams({ q });
    if (options.in) params.set('in', options.in);
    if (options.limit) params.set('limit', String(options.limit));
    return request(SearchResults, `/api/search?${params}`, { signal: options.signal });
  },
  searchPreview: (
    input: { conversationId: string; anchor?: string; q?: string },
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ conversationId: input.conversationId, q: input.q ?? '' });
    if (input.anchor) params.set('anchor', input.anchor);
    return request(SearchPreview, `/api/search/preview?${params}`, { signal });
  },
  /** Rebuild the search index from the chats (after it broke twice). */
  searchRepair: () => request(SearchRepairResult, '/api/search/repair', { method: 'POST' }),
};
