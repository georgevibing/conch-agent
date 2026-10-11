/**
 * What a chat's log says about switching models when asked (ADR 0132): the
 * model it had before, the chip the person just tapped, and the words the
 * next model carries on with. Pure; the manager does the switching.
 */
import type { ConversationEvent, EngineId, ModelRef, SwitchChoice } from '@conch/protocol';

const same = (a: ModelRef, b: ModelRef | undefined) =>
  Boolean(b && a.engine === b.engine && (a.model ?? '') === (b.model ?? ''));

/**
 * The model the chat had before the one it has now, for "go back": the last
 * switch's `from`, or the last choice in the picker that was another one.
 */
export function previousModel(
  events: readonly ConversationEvent[],
  current: ModelRef | undefined,
): ModelRef | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === 'model.switched') {
      const from = { engine: event.from, ...(event.fromModel && { model: event.fromModel }) };
      if (!same(from, current)) return from;
    }
    if (event?.type === 'options' && event.options.engine) {
      const then = {
        engine: event.options.engine,
        ...(event.options.model && { model: event.options.model }),
      };
      if (!same(then, current)) return then;
    }
  }
  return undefined;
}

/**
 * The chip just tapped, when `text` is one (ADR 0132): offered under the
 * latest reply, with nothing the person said since, word for word as it
 * reads. With the request to carry on with, if one was waiting.
 */
export function chipTapped(
  events: readonly ConversationEvent[],
  text: string,
): { choice: SwitchChoice; request?: string } | undefined {
  const said = text.trim();
  if (!said) return undefined;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event || event.type === 'user.message' || event.type === 'model.switched')
      return undefined;
    if (event.type !== 'model.choices') continue;
    const choice = event.choices.find((c) => c.text === said);
    return choice ? { choice, ...(event.request && { request: event.request }) } : undefined;
  }
  return undefined;
}

/** What the model switched to is told, with the person's request as they typed it. */
export function carryPrompt(label: string, request: string): string {
  return `I asked to switch this chat to you (${label}), and it's done: don't switch again. Carry on with what I asked, from where the conversation is:\n\n${request}`;
}

/** The engine and model a chat answers with, read the way the picker does. */
export function refOf(engine: EngineId, model: string | undefined): ModelRef {
  return { engine, ...(model && { model }) };
}
