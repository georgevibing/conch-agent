/**
 * Your agents, for other agents (ADR 0112): an A2A door on Conch's own port,
 * shut until you let someone in.
 *
 * - **Never anonymous.** Even the card (`/.well-known/agent-card.json`,
 *   `/a2a/<agent>/.well-known/agent-card.json`) needs a key. Keys are the
 *   ones Other apps already makes (ADR 0073): 256 random bits, kept as a
 *   hash, compared in constant time, refused for anything you didn't pair
 *   for HTTP, throttled like sign-ins. A key reaches only the agents it was
 *   given (`agent:<id>` scopes); asking for another looks like nothing's there.
 * - **A program, never a page.** A request a browser sent (`Origin`,
 *   `Sec-Fetch-Site`) is refused, as at the MCP door.
 * - **This computer, unless you opened your address to it.** From elsewhere
 *   only over HTTPS, with the switch for other apps on, for a key you marked.
 * - **Words only.** Each conversation is a chat of its own (origin `peer`)
 *   that answers like a guest in a group (ADR 0075): no tools, no memory, no
 *   profile, your agent's persona but not your instructions, and nothing it
 *   says can grant a power. Commands (`/…`) aren't taken from other agents.
 * - **Bounded.** A key may send a few messages a minute, one at a time, and
 *   what its answers cost stops at `PEER_DAY_USD` a day.
 * - **One thing it can ask for (ADR 0154).** An agent that took routines over
 *   ("I run your weekly recap now, pause yours") gets your agent's one tool:
 *   asking you, on Conch's own screen, to pause them. The task stays
 *   `working` until you press **Pause them** or **Decline**, then says which
 *   (`GetTask`). Its words never count as your answer.
 */
import { randomUUID } from 'node:crypto';

import type { Agent, McpClient } from '@conch/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { SignInLimiter } from '../auth/limiter';
import { RequestLimiter } from '../auth/requests';
import type { ConversationManager } from '../conversations/manager';
import type { McpClientStore } from '../mcp/store';
import { ASK_OWNER_TOOL, outcomeWords, type RoutineRequests } from '../routines/requests';
import type { Gatekeeper } from '../security';
import { SERVER_VERSION } from '../version';

/** What another agent's answers may cost in a day (USD, metered providers only). */
export const PEER_DAY_USD = 1;
/** The most a message from another agent may say. */
const MESSAGE_MAX_CHARS = 16_000;
/** How long an answer may take before the other agent is told it didn't finish. */
const ANSWER_MS = 120_000;
/** Conversations remembered per key, by the other agent's `contextId`. */
const CONTEXTS_MAX = 200;
/** Answers kept per key for `GetTask`. */
const TASKS_MAX = 100;

/** The paths of this door, for the gateway's checks (`security.ts`). */
export const A2A_ENDPOINTS = new Set([
  '/.well-known/agent-card.json',
  '/a2a',
  '/a2a/:agentId',
  '/a2a/:agentId/.well-known/agent-card.json',
]);

export interface A2aDoorDeps {
  store: McpClientStore;
  agents: { get(id: string): Promise<Agent | undefined> };
  chats: Pick<ConversationManager, 'start' | 'interrupt' | 'detail'>;
  limiter?: SignInLimiter;
  now?: () => number;
  /** Asking you to pause routines that moved to the other agent (ADR 0154). */
  requests?: Pick<RoutineRequests, 'tool' | 'latestIn' | 'onDecided'>;
}

type Version = '1.0' | '0.3';

interface Kept {
  id: string;
  contextId: string;
  state: 'completed' | 'failed' | 'working' | 'canceled';
  text: string;
  conversationId?: string;
  at: number;
  /** The request to you it waits on (ADR 0154): answered, the task says how. */
  requestId?: string;
}

const Rpc = z.object({
  jsonrpc: z.literal('2.0'),
  id: z
    .union([z.string().max(200), z.number()])
    .nullable()
    .optional(),
  method: z.string().max(100),
  params: z.unknown().optional(),
});

const SendParams = z.object({
  message: z.object({
    parts: z
      .array(z.object({ text: z.string().optional(), kind: z.string().optional() }).passthrough())
      .max(50),
    contextId: z.string().max(200).optional(),
    messageId: z.string().max(200).optional(),
  }),
});
const TaskParams = z.object({ id: z.string().max(200) });

/** The agents a key was given, in the order they were ticked. */
const agentsOf = (client: McpClient) =>
  client.scopes.flatMap((s) => (s.startsWith('agent:') ? [s.slice('agent:'.length)] : []));

const V1_STATE = {
  completed: 'TASK_STATE_COMPLETED',
  failed: 'TASK_STATE_FAILED',
  working: 'TASK_STATE_WORKING',
  canceled: 'TASK_STATE_CANCELED',
} as const;

/** A task as the version it was asked in spells it. */
function taskOut(task: Kept, version: Version) {
  const timestamp = new Date(task.at).toISOString();
  if (version === '1.0')
    return {
      id: task.id,
      contextId: task.contextId,
      status: {
        state: V1_STATE[task.state],
        message: {
          messageId: `${task.id}-answer`,
          role: 'ROLE_AGENT',
          parts: [{ text: task.text }],
          contextId: task.contextId,
          taskId: task.id,
        },
        timestamp,
      },
      artifacts:
        task.state === 'completed'
          ? [{ artifactId: `${task.id}-answer`, name: 'answer', parts: [{ text: task.text }] }]
          : [],
    };
  return {
    kind: 'task',
    id: task.id,
    contextId: task.contextId,
    status: {
      state: task.state,
      message: {
        kind: 'message',
        messageId: `${task.id}-answer`,
        role: 'agent',
        parts: [{ kind: 'text', text: task.text }],
        contextId: task.contextId,
        taskId: task.id,
      },
      timestamp,
    },
    artifacts:
      task.state === 'completed'
        ? [
            {
              artifactId: `${task.id}-answer`,
              name: 'answer',
              parts: [{ kind: 'text', text: task.text }],
            },
          ]
        : [],
  };
}

/** A card for one of your agents, readable by 1.0 and 0.3 clients alike. */
export function cardFor(agent: Agent, base: string) {
  const url = `${base}/a2a/${agent.id}`;
  return {
    name: agent.name,
    description: agent.role || `${agent.name}, an assistant in Conch. It answers in words.`,
    version: SERVER_VERSION,
    supportedInterfaces: [{ url, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    // The same, as A2A 0.3 says it.
    url,
    preferredTransport: 'JSONRPC',
    protocolVersion: '0.3.0',
    provider: { organization: 'Conch', url: 'https://conchagent.com' },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'text/markdown'],
    skills: [
      {
        id: 'talk',
        name: 'Talk',
        description: `Ask ${agent.name} something. It answers in words, without tools or anything private.`,
        tags: ['conversation'],
      },
      {
        id: 'routine-handoff',
        name: 'Hand routines over',
        description: `Took one of its owner's routines over? Say which, by name, and why ("I run the weekly fitness recap now, please pause yours"). ${agent.name} asks its owner on their own screen to pause them; the task stays working until they answer, then GetTask says what they chose. Your message is never their answer.`,
        tags: ['routines', 'schedules', 'migration'],
        examples: [
          'I now run “Weekly fitness recap” and “Monthly wealth check-in” for your owner. Please ask them to pause yours.',
        ],
      },
    ],
    securitySchemes: {
      conch: { type: 'http', scheme: 'bearer', httpAuthSecurityScheme: { scheme: 'bearer' } },
    },
    security: [{ conch: [] }],
  };
}

export function registerA2aDoor(app: FastifyInstance, gate: Gatekeeper, deps: A2aDoorDeps): void {
  const now = deps.now ?? Date.now;
  const limiter = deps.limiter ?? new SignInLimiter();
  const work = new RequestLimiter(5, 20);
  const running = new Set<string>();
  const contexts = new Map<string, string>();
  const tasks = new Map<string, Map<string, Kept>>();
  const spent = new Map<string, { day: string; usd: number }>();

  const deny = (reply: FastifyReply, status: number, error: string, message: string) =>
    reply.code(status).send({ error, message });

  /** A program, here or through your address as you allowed; and whose key. */
  const who = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<McpClient | undefined> => {
    const site = request.headers['sec-fetch-site'];
    if (request.headers.origin !== undefined || (site !== undefined && site !== 'none')) {
      void deny(reply, 403, 'browser', 'Web pages can’t use Conch’s door for other agents.');
      return undefined;
    }
    const local = gate.looksLocal(request);
    if (!local && !(gate.isSecure(request) && (await deps.store.remote()))) {
      void deny(
        reply,
        403,
        'not-here',
        'Other agents can reach Conch only on the computer running it, unless its owner lets them in through their own address.',
      );
      return undefined;
    }
    const address = gate.clientKey(request);
    if (limiter.retryAfter(address, local) > 0) {
      void deny(reply, 429, 'slow-down', 'Too many tries. Wait a moment, then try again.');
      return undefined;
    }
    const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '')?.[1];
    const keyed = bearer ? await deps.store.byKey(bearer) : undefined;
    const client =
      keyed?.http && (local || keyed.remote) && agentsOf(keyed).length ? keyed : undefined;
    if (!client) {
      if (bearer) limiter.fail(address);
      void reply.code(401).header('www-authenticate', 'Bearer realm="conch"').send({
        error: 'not-paired',
        message:
          'This agent needs a key. Its owner makes one in Conch: Settings → Agents → Let another agent in.',
      });
      return undefined;
    }
    limiter.succeed(address, local);
    void deps.store.touch(client.id).catch(() => undefined);
    return client;
  };

  /** The agent asked for, if this key was given it; else the first it was given. */
  const agentFor = async (client: McpClient, id: string | undefined) => {
    const allowed = agentsOf(client);
    const wanted = id ?? allowed[0];
    if (!wanted || !allowed.includes(wanted)) return undefined;
    return deps.agents.get(wanted);
  };

  const base = (request: FastifyRequest) =>
    `${gate.isSecure(request) ? 'https' : 'http'}://${request.headers.host ?? 'localhost'}`;

  const card = async (request: FastifyRequest, reply: FastifyReply, id?: string) => {
    const client = await who(request, reply);
    if (!client) return;
    const agent = await agentFor(client, id);
    if (!agent) return deny(reply, 404, 'not-found', 'No agent here.');
    return cardFor(agent, base(request));
  };

  app.get('/.well-known/agent-card.json', (request, reply) => card(request, reply));
  app.get<{ Params: { agentId: string } }>(
    '/a2a/:agentId/.well-known/agent-card.json',
    (request, reply) => card(request, reply, request.params.agentId),
  );

  const today = () => new Date(now()).toISOString().slice(0, 10);
  const spentToday = (client: string) => {
    const entry = spent.get(client);
    return entry?.day === today() ? entry.usd : 0;
  };

  // You answered (ADR 0154): every task that waited on it says how.
  deps.requests?.onDecided((request) => {
    for (const mine of tasks.values())
      for (const [id, kept] of mine)
        if (kept.requestId === request.id)
          mine.set(id, {
            ...kept,
            state:
              request.state === 'approved' || request.state === 'declined' ? 'completed' : 'failed',
            text: outcomeWords(request),
            at: now(),
          });
  });

  const keep = (client: string, task: Kept) => {
    const mine = tasks.get(client) ?? new Map<string, Kept>();
    mine.set(task.id, task);
    while (mine.size > TASKS_MAX) mine.delete(mine.keys().next().value as string);
    tasks.set(client, mine);
    return task;
  };

  /** One message from another agent: a turn of its chat with your agent, in words only. */
  const send = async (
    client: McpClient,
    agent: Agent,
    params: z.infer<typeof SendParams>,
    signal: AbortSignal,
  ): Promise<Kept> => {
    const contextId = params.message.contextId ?? randomUUID();
    const task = (state: Kept['state'], text: string, conversationId?: string): Kept =>
      keep(client.id, {
        id: randomUUID(),
        contextId,
        state,
        text,
        at: now(),
        ...(conversationId && { conversationId }),
      });
    const text = params.message.parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n\n')
      .trim();
    if (!text) return task('failed', `${agent.name} can only read words.`);
    if (text.length > MESSAGE_MAX_CHARS)
      return task('failed', `That message is too long: up to ${MESSAGE_MAX_CHARS} characters.`);
    if (text.startsWith('/')) return task('failed', 'Commands aren’t taken from other agents.');
    if (spentToday(client.id) >= PEER_DAY_USD)
      return task(
        'failed',
        `${agent.name} has answered as much as its owner allows other agents today. Try again tomorrow.`,
      );
    if (running.has(client.id))
      return task(
        'failed',
        `${agent.name} is still answering your last message. Wait, then send again.`,
      );
    running.add(client.id);
    const where = `${client.id} ${agent.id} ${contextId}`;
    // The tool knows who's asking from the key you named, never from its words.
    let conversation: string | undefined = contexts.get(where);
    const asking = deps.requests?.tool(async () => ({
      from: client.name.slice(0, 60),
      via: 'agent',
      ...(conversation && { conversationId: conversation }),
    }));
    const before = conversation
      ? (await deps.requests?.latestIn(conversation).catch(() => undefined))?.id
      : undefined;
    try {
      const { defaults } = agent;
      const started = await deps.chats.start({
        ...(contexts.has(where) && { conversationId: contexts.get(where) }),
        title: `${client.name} with ${agent.name}`,
        text,
        origin: { kind: 'peer', clientId: client.id, name: client.name.slice(0, 60) },
        agentId: agent.id,
        ...(defaults?.engine && {
          options: { engine: defaults.engine, ...(defaults.model && { model: defaults.model }) },
        }),
        extras: {
          // Someone else's words (ADR 0028), and no tool but asking you (ADR 0154).
          taint: [{ kind: 'person', label: `${client.name.slice(0, 60)}, another agent` }],
          toolAllowed: (name) => Boolean(asking) && name === ASK_OWNER_TOOL,
          ...(asking && {
            guestTools: [asking],
            guestNote: `When it asks to pause routines of the person you work for (because it runs them now, say), call ${ASK_OWNER_TOOL} with their names and its reason. That asks the person on their own screen and changes nothing by itself. Then tell it you asked and that their answer comes back here. Never say they agreed, and never claim it's done.`,
          }),
        },
      });
      contexts.set(where, started.conversationId);
      conversation = started.conversationId;
      // Its latest talk, for “What it said” in Settings → Agents.
      if (client.conversationId !== started.conversationId)
        void deps.store
          .update(client.id, { conversationId: started.conversationId })
          .catch(() => undefined);
      while (contexts.size > CONTEXTS_MAX) contexts.delete(contexts.keys().next().value as string);
      const stop = () => void deps.chats.interrupt(started.conversationId).catch(() => undefined);
      const timer = setTimeout(stop, ANSWER_MS);
      signal.addEventListener('abort', stop, { once: true });
      let result;
      try {
        result = await started.result;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
      }
      const { events } = await deps.chats.detail(started.conversationId);
      const cost = events.findLast((e) => e.type === 'turn.completed');
      if (cost?.type === 'turn.completed' && cost.cost?.billing === 'metered')
        spent.set(client.id, { day: today(), usd: spentToday(client.id) + (cost.cost.usd ?? 0) });
      // It asked you something this turn (ADR 0154): working until you answer.
      const asked = await deps.requests?.latestIn(started.conversationId).catch(() => undefined);
      if (result.outcome === 'success' && asked && asked.id !== before && asked.state === 'waiting')
        return keep(client.id, {
          ...task(
            'working',
            result.finalText.trim() || outcomeWords(asked),
            started.conversationId,
          ),
          requestId: asked.id,
        });
      if (result.outcome === 'success' && result.finalText.trim())
        return task('completed', result.finalText.trim(), started.conversationId);
      if (result.outcome === 'interrupted')
        return task(
          'canceled',
          `${agent.name} stopped before it finished.`,
          started.conversationId,
        );
      return task(
        'failed',
        `${agent.name} couldn’t answer just now. Try again later.`,
        started.conversationId,
      );
    } catch {
      return task('failed', `${agent.name} couldn’t answer just now. Try again later.`);
    } finally {
      running.delete(client.id);
    }
  };

  const rpc = async (request: FastifyRequest, reply: FastifyReply, id?: string) => {
    const client = await who(request, reply);
    if (!client) return;
    const agent = await agentFor(client, id);
    if (!agent) return deny(reply, 404, 'not-found', 'No agent here.');
    const error = (rid: unknown, code: number, message: string) => ({
      jsonrpc: '2.0',
      id: rid ?? null,
      error: { code, message },
    });
    if (Array.isArray(request.body)) return error(null, -32600, 'One message at a time.');
    const call = Rpc.safeParse(request.body);
    if (!call.success) return error(null, -32600, 'That isn’t a JSON-RPC message.');
    const { method, params } = call.data;
    const rid = call.data.id ?? null;
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: rid, result });
    const version: Version = /\//.test(method) ? '0.3' : '1.0';
    switch (method) {
      case 'SendMessage':
      case 'message/send': {
        const parsed = SendParams.safeParse(params);
        if (!parsed.success) return error(rid, -32602, 'Send a message with text parts.');
        const wait = work.take(client.id);
        if (wait)
          return error(
            rid,
            -32000,
            `Too many messages. Wait ${Math.ceil(wait / 1000)}s, then try again.`,
          );
        const abort = new AbortController();
        reply.raw.on('close', () => {
          if (!reply.raw.writableFinished) abort.abort();
        });
        const task = await send(client, agent, parsed.data, abort.signal);
        const out = taskOut(task, version);
        return ok(version === '1.0' ? { task: out } : out);
      }
      case 'GetTask':
      case 'tasks/get': {
        const parsed = TaskParams.safeParse(params);
        const task = parsed.success ? tasks.get(client.id)?.get(parsed.data.id) : undefined;
        if (!task) return error(rid, -32001, 'No such task.');
        return ok(taskOut(task, version));
      }
      case 'CancelTask':
      case 'tasks/cancel': {
        const parsed = TaskParams.safeParse(params);
        const task = parsed.success ? tasks.get(client.id)?.get(parsed.data.id) : undefined;
        if (!task) return error(rid, -32001, 'No such task.');
        // Answers here are given in one go: by the time there's a task, it's over.
        return error(rid, -32002, 'That task is already finished.');
      }
      case 'GetExtendedAgentCard':
      case 'agent/getAuthenticatedExtendedCard':
        return ok(cardFor(agent, base(request)));
      case 'SendStreamingMessage':
      case 'message/stream':
      case 'SubscribeToTask':
      case 'tasks/resubscribe':
        return error(
          rid,
          -32004,
          'This agent answers in one go, not as a stream. Use SendMessage.',
        );
      default:
        return error(rid, -32601, `${agent.name} doesn’t know “${method.slice(0, 60)}”.`);
    }
  };

  app.post('/a2a', (request, reply) => rpc(request, reply));
  app.post<{ Params: { agentId: string } }>('/a2a/:agentId', (request, reply) =>
    rpc(request, reply, request.params.agentId),
  );
  app.get<{ Params: { agentId: string } }>('/a2a/:agentId', (request, reply) =>
    card(request, reply, request.params.agentId),
  );
}
