/**
 * A pretend ACP agent for tests: it speaks the protocol over a pair of
 * streams, answers what a script says, and records what Conch sent. Shaped
 * after the real messages Copilot CLI and Gemini CLI send (ADR 0053's
 * research notes).
 */
import { PassThrough } from 'node:stream';

import type { AcpStreams } from './rpc';

export interface AgentScript {
  /** What `initialize` answers. */
  initialize?: Record<string, unknown>;
  /** Answer `session/new`: a result, or an error. */
  session?: (
    params: Record<string, unknown>,
  ) => Record<string, unknown> | { error: { code: number; message: string } };
  /** Play out a prompt: send updates, ask permission, then answer. */
  prompt?: (turn: AgentTurn, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export interface AgentTurn {
  sessionId: string;
  update(update: Record<string, unknown>): void;
  /** Ask Conch something (permission), and wait for the answer. */
  ask(method: string, params: Record<string, unknown>): Promise<unknown>;
  /** Wait for a cancel notification. */
  cancelled(): Promise<void>;
}

export interface FakeAgent {
  streams: AcpStreams;
  /** Every message Conch sent, in order. */
  received: { method?: string; params?: unknown; id?: unknown; result?: unknown }[];
  starts: number;
  closed: boolean;
}

/** A spawn function for `AcpEngine` that starts a pretend agent each time. */
export function fakeSpawn(script: AgentScript) {
  const agents: FakeAgent[] = [];
  const spawn = (_file: string, args: string[]) => {
    const toAgent = new PassThrough();
    const fromAgent = new PassThrough();
    const agent: FakeAgent = {
      streams: {
        input: toAgent,
        output: fromAgent,
        close: () => {
          agent.closed = true;
          fromAgent.end();
        },
      },
      received: [],
      starts: agents.length + 1,
      closed: false,
    };
    agents.push(agent);
    void args;
    let next = 1000;
    const waiting = new Map<number, (value: unknown) => void>();
    const cancels = new Map<string, () => void>();
    const send = (message: Record<string, unknown>) =>
      fromAgent.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    let buffer = '';
    toAgent.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line) as {
          id?: number;
          method?: string;
          params?: Record<string, unknown>;
          result?: unknown;
        };
        agent.received.push(message);
        if (message.method === undefined && typeof message.id === 'number') {
          waiting.get(message.id)?.(message.result);
          continue;
        }
        if (message.method === 'session/cancel') {
          cancels.get(String(message.params?.sessionId))?.();
          continue;
        }
        if (message.id === undefined) continue;
        const id = message.id;
        const params = message.params ?? {};
        void (async () => {
          switch (message.method) {
            case 'initialize':
              return send({
                id,
                result: script.initialize ?? {
                  protocolVersion: 1,
                  agentCapabilities: {
                    mcpCapabilities: { http: true },
                    promptCapabilities: { image: true },
                  },
                  agentInfo: { name: 'pretend', version: '9.9.9' },
                  authMethods: [{ id: 'agent-login' }],
                },
              });
            case 'authenticate':
              return send({ id, result: {} });
            case 'session/new': {
              const answer = script.session?.(params) ?? { sessionId: `sess_${id}` };
              return 'error' in answer
                ? send({ id, error: answer.error })
                : send({ id, result: answer });
            }
            case 'session/prompt': {
              const sessionId = String(params.sessionId);
              const turn: AgentTurn = {
                sessionId,
                update: (update) =>
                  send({ method: 'session/update', params: { sessionId, update } }),
                ask: (method, askParams) =>
                  new Promise((resolve) => {
                    const askId = next++;
                    waiting.set(askId, resolve);
                    send({ id: askId, method, params: askParams });
                  }),
                cancelled: () => new Promise((resolve) => cancels.set(sessionId, resolve)),
              };
              try {
                const result = (await script.prompt?.(turn, params)) ?? { stopReason: 'end_turn' };
                return send({ id, result });
              } catch (error) {
                // A script throws `{ code, message }` to answer with an error.
                const { code = -32603, message = 'failed' } = error as {
                  code?: number;
                  message?: string;
                };
                return send({ id, error: { code, message } });
              }
            }
            default:
              return send({ id, result: {} });
          }
        })();
      }
    });
    return agent.streams;
  };
  return { spawn, agents };
}
