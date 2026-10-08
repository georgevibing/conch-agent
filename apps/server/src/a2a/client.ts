/**
 * Talking to an agent elsewhere over A2A (ADR 0112): its card, and one
 * message at a time. Speaks A2A 1.0 (`SendMessage`, `ROLE_USER`, parts with
 * `text`) and 0.3 (`message/send`, `kind: 'text'`), which most agents still
 * answer, read from the card.
 *
 * Everything that comes back is someone else's: the card and every answer
 * are parsed with limits (size, fields, lengths), never followed anywhere but
 * the host you pasted (the card can't send Conch, or your key, to another
 * one), and every request goes through `guardedFetch` (no cloud metadata or
 * link-local addresses; your own network only for an agent that lives there).
 */
import { randomUUID } from 'node:crypto';

import { OUTSIDE_LIMITS, type OutsidePreview, type OutsideSkill } from '@conch/protocol';
import { z } from 'zod';

import { EndpointError, guardedFetch, reachOf, type Reach } from '../integrations/net';

type Fetch = typeof fetch;

/** A card bigger than this isn't a card. */
const CARD_MAX_BYTES = 256 * 1024;
/** An answer bigger than this is cut where it's read. */
const ANSWER_MAX_BYTES = 1024 * 1024;
const POLL_MS = 1500;

export class A2aError extends Error {
  constructor(
    message: string,
    /** Worth trying again by itself: the network, or a server that's restarting. */
    readonly passing = false,
  ) {
    super(message);
  }
}

/** The card is behind a key, and none came with the paste. */
export class KeyNeeded extends A2aError {}

// ── What was pasted ────────────────────────────────────────────────────────

/** The address and the key in one paste, whatever's around them. */
export function readPaste(paste: string): { url?: URL; key?: string } {
  const found = /https?:\/\/[^\s<>"'`]+/i.exec(paste);
  let url: URL | undefined;
  try {
    url = found ? new URL(found[0].replace(/[),.;]+$/, '')) : undefined;
  } catch {
    url = undefined;
  }
  const rest = found ? paste.replace(found[0], ' ') : paste;
  const key =
    /\bcmcp\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{16,}\b/.exec(rest)?.[0] ??
    /\b(?:key|token|bearer)\b\s*[:=]?\s*([A-Za-z0-9._~+/=-]{16,})/i.exec(rest)?.[1] ??
    rest
      .trim()
      .split(/\s+/)
      .find((t) => /^[A-Za-z0-9._~+/=-]{24,}$/.test(t));
  return { ...(url && { url }), ...(key && { key }) };
}

/** Where its card may be, most likely first: the address itself, then the well-known places. */
export function cardPlaces(url: URL): URL[] {
  if (/\.json$/i.test(url.pathname)) return [url];
  const base = url.href.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return [
    ...new Set([
      `${base}/.well-known/agent-card.json`,
      `${url.origin}/.well-known/agent-card.json`,
      `${url.origin}/.well-known/agent.json`,
    ]),
  ].map((u) => new URL(u));
}

// ── The card ───────────────────────────────────────────────────────────────

const text = (max: number) =>
  z
    .string()
    .transform((s) =>
      s
        .replace(/\p{Cc}/gu, ' ')
        .trim()
        .slice(0, max),
    )
    .catch('');

const Skill = z.object({ name: text(80), description: text(300).optional() }).passthrough();
const Interface = z
  .object({
    url: z.string().max(2000),
    protocolBinding: z.string().max(80).optional(),
    transport: z.string().max(80).optional(),
    protocolVersion: z.string().max(20).optional(),
  })
  .passthrough();

const Card = z
  .object({
    name: text(OUTSIDE_LIMITS.name).pipe(z.string().min(1)),
    description: text(OUTSIDE_LIMITS.description).default(''),
    supportedInterfaces: z.array(Interface).max(20).optional().catch(undefined),
    url: z.string().max(2000).optional(),
    preferredTransport: z.string().max(80).optional(),
    protocolVersion: z.string().max(20).optional(),
    additionalInterfaces: z.array(Interface).max(20).optional().catch(undefined),
    skills: z.array(Skill).max(200).default([]).catch([]),
    provider: z
      .object({ organization: text(80).optional() })
      .passthrough()
      .optional()
      .catch(undefined),
    securitySchemes: z.record(z.string(), z.unknown()).optional().catch(undefined),
    security: z.array(z.unknown()).optional().catch(undefined),
    securityRequirements: z.array(z.unknown()).optional().catch(undefined),
  })
  .passthrough();

/** What Conch keeps of a card: who it is, and where and how to send it messages. */
export interface ReadCard {
  name: string;
  description: string;
  skills: OutsideSkill[];
  by?: string;
  endpoint: URL;
  protocol: '1.0' | '0.3';
  wantsKey: boolean;
}

const jsonRpc = (binding: string | undefined) => !binding || /^jsonrpc$/i.test(binding);

/**
 * A card, read: v1.0's `supportedInterfaces` (the first that speaks JSON-RPC)
 * or v0.3's `url` and `additionalInterfaces`. Its endpoint must be on the
 * host the card came from, so a card can't point Conch, or your key,
 * somewhere else.
 */
export function readCard(raw: unknown, from: URL): ReadCard {
  const card = Card.safeParse(raw);
  if (!card.success) throw new A2aError('That address answered, but not with an agent’s card.');
  const c = card.data;
  const v1 = c.supportedInterfaces?.find((i) => jsonRpc(i.protocolBinding));
  const v03 =
    c.url && jsonRpc(c.preferredTransport)
      ? { url: c.url, protocolVersion: c.protocolVersion }
      : c.additionalInterfaces?.find((i) => jsonRpc(i.transport));
  const chosen = v1 ?? v03;
  if (!chosen)
    throw new A2aError(
      `${c.name} speaks a kind of A2A Conch doesn’t yet (only gRPC or REST). Ask whoever runs it for its JSON-RPC address.`,
    );
  let endpoint: URL;
  try {
    endpoint = new URL(chosen.url, from);
  } catch {
    throw new A2aError(`${c.name}’s card doesn’t say where to send it messages.`);
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')
    throw new A2aError(`${c.name}’s card gives an address Conch can’t use.`);
  if (endpoint.hostname !== from.hostname)
    throw new A2aError(
      `${c.name}’s card says to send messages to ${endpoint.hostname}, not where it lives (${from.hostname}), so Conch won’t.`,
    );
  if (endpoint.username || endpoint.password)
    throw new A2aError(
      `${c.name}’s card gives an address with a password in it, so Conch won’t use it.`,
    );
  const version = v1?.protocolVersion ?? (v1 ? '1.0' : (v03?.protocolVersion ?? '0.3'));
  const skills = c.skills
    .filter((s) => s.name)
    .slice(0, 12)
    .map((s) => ({ name: s.name, description: s.description ?? '' }));
  const by = c.provider?.organization;
  return {
    name: c.name,
    description: c.description,
    skills,
    ...(by && { by }),
    endpoint,
    protocol: version.startsWith('1') ? '1.0' : '0.3',
    wantsKey:
      Object.keys(c.securitySchemes ?? {}).length > 0 ||
      (c.security?.length ?? 0) > 0 ||
      (c.securityRequirements?.length ?? 0) > 0,
  };
}

// ── Answers ────────────────────────────────────────────────────────────────

const Part = z
  .object({
    text: z.string().optional(),
    kind: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough();
const Message = z
  .object({ parts: z.array(Part).max(200).default([]), contextId: z.string().max(200).optional() })
  .passthrough();
const Artifact = z.object({ parts: z.array(Part).max(200).default([]) }).passthrough();
const Task = z
  .object({
    id: z.string().max(200),
    contextId: z.string().max(200).optional(),
    status: z
      .object({ state: z.string().max(60), message: Message.optional().catch(undefined) })
      .passthrough(),
    artifacts: z.array(Artifact).max(100).optional().catch(undefined),
  })
  .passthrough();

/** The words in some parts: text as it is, data as JSON, files only named. */
function partsText(parts: readonly z.infer<typeof Part>[]): string {
  return parts
    .map((p) =>
      typeof p.text === 'string'
        ? p.text
        : p.data !== undefined
          ? `\`\`\`json\n${JSON.stringify(p.data).slice(0, 4000)}\n\`\`\``
          : '',
    )
    .filter(Boolean)
    .join('\n\n');
}

/** `TASK_STATE_INPUT_REQUIRED` and `input-required` alike, as 0.3 spells them. */
export function stateOf(state: string): string {
  return state
    .replace(/^TASK_STATE_/i, '')
    .toLowerCase()
    .replace(/_/g, '-');
}

export type Answer =
  | { kind: 'done'; text: string; contextId?: string }
  | { kind: 'working'; taskId: string; contextId?: string; text: string };

/** A JSON-RPC result, as either version gives it: a message, or a task. */
export function readAnswer(result: unknown, name: string): Answer {
  const wrapped = z
    .object({ task: z.unknown().optional(), message: z.unknown().optional() })
    .passthrough()
    .safeParse(result);
  const r = wrapped.success ? wrapped.data : {};
  const asTask = Task.safeParse(r.task ?? result);
  if (
    asTask.success &&
    (r.task !== undefined || (result as { kind?: string })?.kind !== 'message')
  ) {
    const task = asTask.data;
    const state = stateOf(task.status.state);
    const said = [
      ...(task.artifacts ?? []).map((a) => partsText(a.parts)),
      task.status.message ? partsText(task.status.message.parts) : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const contextId = task.contextId ?? task.status.message?.contextId;
    const ctx = contextId ? { contextId } : {};
    if (state === 'completed') return { kind: 'done', text: said || `${name} finished.`, ...ctx };
    if (state === 'input-required')
      return {
        kind: 'done',
        text: `${said || `${name} needs more from you.`}\n\n_${name} is waiting for an answer: mention it again to give one._`,
        ...ctx,
      };
    if (state === 'auth-required')
      throw new A2aError(`${name} wants you to sign in to it first, on its own site.`);
    if (state === 'failed' || state === 'rejected' || state === 'canceled')
      throw new A2aError(
        said
          ? `${name} couldn’t do it: ${said.slice(0, 300)}`
          : `${name} couldn’t do it (${state}).`,
      );
    return { kind: 'working', taskId: task.id, text: said, ...ctx };
  }
  const message = Message.safeParse(r.message ?? result);
  if (message.success && message.data.parts.length)
    return {
      kind: 'done',
      text: partsText(message.data.parts) || `${name} answered with nothing Conch can show.`,
      ...(message.data.contextId && { contextId: message.data.contextId }),
    };
  throw new A2aError(`${name} answered in a way Conch doesn’t understand.`);
}

// ── The client ─────────────────────────────────────────────────────────────

export interface Peer {
  name: string;
  endpoint: string;
  protocol: '1.0' | '0.3';
  key?: string;
  reach: Reach;
}

/** What a status code means, in words, and whether it passes by itself. */
function httpProblem(status: number, name: string): A2aError {
  if (status === 401 || status === 403)
    return new A2aError(
      `${name} didn’t accept Conch’s key. Paste its address and key again in Settings → Agents.`,
    );
  if (status === 404) return new A2aError(`Nothing answers at ${name}’s address any more.`);
  if (status === 429) return new A2aError(`${name} is busy. Try again in a moment.`, true);
  if (status >= 500) return new A2aError(`${name} had a problem on its side.`, true);
  return new A2aError(`${name} refused the message (${status}).`);
}

async function readBounded(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new A2aError('That answer was far too big.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class A2aClient {
  constructor(private readonly base: Fetch = fetch) {}

  #fetch(reach: Reach): Fetch {
    return guardedFetch(reach, this.base);
  }

  /**
   * The card at a pasted address: each likely place in turn, with the key if
   * one came with it. `reach` is where the address lives, decided once here.
   */
  async card(url: URL, key?: string): Promise<{ card: ReadCard; at: URL; reach: Reach }> {
    const reach = await reachOf(url.href);
    const get = this.#fetch(reach);
    let last: A2aError | undefined;
    let keyRefused = false;
    for (const place of cardPlaces(url)) {
      let response: Response;
      try {
        response = await get(place, {
          headers: {
            accept: 'application/json',
            'a2a-version': '1.0',
            ...(key && place.hostname === url.hostname && { authorization: `Bearer ${key}` }),
          },
        });
      } catch (error) {
        throw error instanceof EndpointError
          ? new A2aError(error.message)
          : new A2aError(
              `Couldn’t reach ${url.host}. Check the address, and that it’s running.`,
              true,
            );
      }
      if (response.status === 401 || response.status === 403) {
        keyRefused = true;
        last = new A2aError(
          key
            ? `${url.host} didn’t accept that key.`
            : `${url.host} wants a key. Paste its address with its key.`,
        );
        continue;
      }
      if (!response.ok) {
        last = new A2aError(`No agent card at ${url.host}.`);
        continue;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(await readBounded(response, CARD_MAX_BYTES));
      } catch (error) {
        last = error instanceof A2aError ? error : new A2aError(`No agent card at ${url.host}.`);
        continue;
      }
      return { card: readCard(raw, place), at: place, reach };
    }
    if (keyRefused && !key)
      throw new KeyNeeded(`${url.host} wants a key. Paste its address with its key.`);
    throw last ?? new A2aError(`No agent card at ${url.host}.`);
  }

  /** One JSON-RPC call; a passing failure is tried once more, after a moment. */
  async #call(peer: Peer, method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#once(peer, method, params, signal);
      } catch (error) {
        if (!(error instanceof A2aError) || !error.passing || attempt > 0 || signal.aborted)
          throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 500));
      }
    }
  }

  async #once(peer: Peer, method: string, params: unknown, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(peer.reach)(peer.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(peer.protocol === '1.0' && { 'a2a-version': '1.0' }),
          ...(peer.key && { authorization: `Bearer ${peer.key}` }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(OUTSIDE_LIMITS.answerMs)]),
      });
    } catch (error) {
      if (signal.aborted) throw new A2aError('Stopped.');
      if (error instanceof EndpointError) throw new A2aError(error.message);
      throw new A2aError(`Couldn’t reach ${peer.name}. Is it running?`, true);
    }
    if (!response.ok) throw httpProblem(response.status, peer.name);
    let body: unknown;
    try {
      body = JSON.parse(await readBounded(response, ANSWER_MAX_BYTES));
    } catch (error) {
      throw error instanceof A2aError
        ? error
        : new A2aError(`${peer.name} answered with something that isn’t A2A.`);
    }
    const rpc = z
      .object({
        result: z.unknown().optional(),
        error: z.object({ code: z.number(), message: z.string().max(500).catch('') }).optional(),
      })
      .safeParse(body);
    if (!rpc.success) throw new A2aError(`${peer.name} answered with something that isn’t A2A.`);
    if (rpc.data.error)
      throw Object.assign(
        new A2aError(
          rpc.data.error.code === -32001
            ? `${peer.name} has forgotten that conversation.`
            : `${peer.name} said: ${rpc.data.error.message.slice(0, 200) || `error ${rpc.data.error.code}`}`,
        ),
        { code: rpc.data.error.code },
      );
    return rpc.data.result;
  }

  /**
   * Send words and wait for the answer: a message, or a task followed until
   * it's done, up to `OUTSIDE_LIMITS.answerMs`. A 1.0 agent that doesn't know
   * 1.0's method names is asked again the 0.3 way.
   */
  async send(
    peer: Peer,
    input: { text: string; contextId?: string; signal: AbortSignal },
  ): Promise<{ text: string; contextId?: string }> {
    const until = Date.now() + OUTSIDE_LIMITS.answerMs;
    const v1 = peer.protocol === '1.0';
    const message = v1
      ? {
          messageId: randomUUID(),
          role: 'ROLE_USER',
          parts: [{ text: input.text }],
          ...(input.contextId && { contextId: input.contextId }),
        }
      : {
          kind: 'message',
          messageId: randomUUID(),
          role: 'user',
          parts: [{ kind: 'text', text: input.text }],
          ...(input.contextId && { contextId: input.contextId }),
        };
    let result: unknown;
    let spoken = peer.protocol;
    try {
      result = await this.#call(
        peer,
        v1 ? 'SendMessage' : 'message/send',
        {
          message,
          configuration: {
            acceptedOutputModes: ['text/plain', 'text/markdown'],
            ...(v1 ? {} : { blocking: true }),
          },
        },
        input.signal,
      );
    } catch (error) {
      if (!v1 || (error as { code?: number }).code !== -32601) throw error;
      spoken = '0.3';
      result = await this.#call(
        { ...peer, protocol: '0.3' },
        'message/send',
        {
          message: {
            kind: 'message',
            messageId: randomUUID(),
            role: 'user',
            parts: [{ kind: 'text', text: input.text }],
            ...(input.contextId && { contextId: input.contextId }),
          },
          configuration: { acceptedOutputModes: ['text/plain'], blocking: true },
        },
        input.signal,
      );
    }
    let answer = readAnswer(result, peer.name);
    while (answer.kind === 'working') {
      if (Date.now() > until || input.signal.aborted)
        throw new A2aError(`${peer.name} didn’t finish in time.`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const taskId = answer.taskId;
      const got = await this.#call(
        { ...peer, protocol: spoken },
        spoken === '1.0' ? 'GetTask' : 'tasks/get',
        { id: taskId },
        input.signal,
      );
      answer = readAnswer(got, peer.name);
      if (answer.kind === 'working' && !answer.contextId && input.contextId)
        answer = { ...answer, contextId: input.contextId };
    }
    const cut = answer.text.length > OUTSIDE_LIMITS.answerChars;
    return {
      text: cut
        ? `${answer.text.slice(0, OUTSIDE_LIMITS.answerChars)}\n\n_(${peer.name} said more; this is the start.)_`
        : answer.text,
      ...(answer.contextId && { contextId: answer.contextId }),
    };
  }
}

/** What a person sees of a card before adding it. */
export function previewOf(
  card: ReadCard,
  options: { reach: Reach; keyed: boolean; needsKey: boolean; known?: string },
): OutsidePreview {
  return {
    name: card.name,
    description: card.description,
    skills: card.skills,
    ...(card.by && { by: card.by }),
    host: card.endpoint.host,
    protocol: card.protocol,
    private: options.reach === 'private',
    needsKey: options.needsKey,
    keyed: options.keyed,
    ...(options.known && { known: options.known as OutsidePreview['known'] }),
  };
}
