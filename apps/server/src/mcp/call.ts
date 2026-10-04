/**
 * One tool call from another app, run as one turn of that app's own chat in
 * Conch (ADR 0073).
 *
 * There's no model here: the other app already chose the tool. Running the
 * call as a turn is what holds it to everything a chat is held to — the
 * person's choices in Apps, the guard after reading (the chat remembers what
 * it read across calls), the skill it loaded, Activity and Undo, and asking
 * the person (the question waits in that chat, and their devices are told).
 * The engine takes the one tool the turn was scoped to and calls it exactly as
 * a model API engine would: arguments checked against its schema, the guard,
 * then permission.
 */
import { randomBytes } from 'node:crypto';

import type { Capabilities, EngineId, EngineStatus, ToolView } from '@conch/protocol';
import { z } from 'zod';

import { authorizeTool, HOST_NAMES } from '../engines/host';
import { hostToolText, type Engine, type EngineEvent, type TurnInput } from '../engines/types';

export interface CallResult {
  text: string;
  isError: boolean;
  images?: { data: string; mimeType: 'image/jpeg' | 'image/png' }[];
}

/** How much of a result the app's chat shows (the app gets all of it). */
const SHOWN = 1_200;

/** The first thing wrong with the arguments, in words a model can act on. */
export function argumentProblem(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'The tool arguments don’t match its schema.';
  const where = issue.path.length ? `\`${issue.path.join('.')}\`` : 'The arguments';
  return issue.code === 'unrecognized_keys'
    ? `This tool doesn’t take ${issue.keys.map((k) => `\`${k}\``).join(', ')}.`
    : `${where}: ${issue.message}`;
}

export class CallEngine implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly hostTools = true;
  #result?: CallResult;

  constructor(
    /** The chat's record names a provider; this borrows the default one's, and never runs it. */
    readonly id: EngineId,
    /** The app, by name: "Claude Desktop". */
    readonly label: string,
    private readonly call: { name: string; args: Record<string, unknown> },
  ) {}

  /** What the call came to; undefined when the turn ended before it ran. */
  get result(): CallResult | undefined {
    return this.#result;
  }

  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }

  async capabilities(): Promise<Capabilities> {
    // Asks before changes, always: another app never gets a mode that asks less.
    return {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }

  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    const toolUseId = `call_${randomBytes(6).toString('hex')}`;
    const { name, args } = this.call;
    const host = input.tools.find((tool) => tool.name === name);
    const bridged = host ? undefined : input.bridgedTools?.find((tool) => tool.name === name);
    const display = host
      ? HOST_NAMES.has(host.name)
        ? host.name
        : `mcp__conch__${host.name}`
      : name;
    if (!host && !bridged) {
      this.#result = {
        text: 'That tool isn’t available right now. Its app may be off or signed out in Conch.',
        isError: true,
      };
      yield { type: 'text', messageId: toolUseId, delta: this.#result.text };
      yield { type: 'message-done', messageId: toolUseId };
      yield { type: 'done', outcome: 'success' };
      return;
    }
    yield { type: 'tool-start', toolUseId, name: display, input: args };
    let result: CallResult;
    let view: ToolView | undefined;
    try {
      if (host) {
        const parsed = z.object(host.input).strict().safeParse(args);
        if (!parsed.success) result = { text: argumentProblem(parsed.error), isError: true };
        else {
          const denied = await authorizeTool(input, display, parsed.data, toolUseId);
          if (denied) result = { text: denied, isError: true };
          else {
            const out = await host.run(parsed.data as never, { operationId: toolUseId });
            view = typeof out === 'string' ? undefined : out.view;
            result = {
              text: hostToolText(out),
              isError: false,
              ...(typeof out !== 'string' && out.images?.length && { images: out.images }),
            };
          }
        }
      } else if (bridged) {
        input.signal.throwIfAborted();
        const decision = await input.guard?.({ toolName: bridged.name, toolUseId, input: args });
        // The bridge asks again, by the app's own policy, right before it runs.
        result =
          decision?.decision === 'deny'
            ? { text: decision.message, isError: true }
            : await bridged.run(args, toolUseId);
      } else result = { text: 'That tool isn’t available right now.', isError: true };
    } catch {
      result = {
        text: input.signal.aborted
          ? 'Stopped before it finished.'
          : 'The tool couldn’t finish. Check what you asked for and try again.',
        isError: true,
      };
    }
    this.#result = result;
    yield {
      type: 'tool-end',
      toolUseId,
      status: result.isError ? 'error' : 'success',
      output: result.text.length > SHOWN ? `${result.text.slice(0, SHOWN - 1)}…` : result.text,
      ...(view && !result.isError && { view }),
    };
    // Conch's own tools show a row only for what they found: a refusal is said in words.
    if (result.isError && host) {
      yield { type: 'text', messageId: toolUseId, delta: result.text };
      yield { type: 'message-done', messageId: toolUseId };
    }
    yield { type: 'done', outcome: input.signal.aborted ? 'interrupted' : 'success' };
  }
}
