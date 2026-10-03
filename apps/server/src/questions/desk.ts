/**
 * Questions answered with a tap (ADR 0055 §4). The assistant asks with the
 * `ask` tool; the chat shows a `Question` card and waits for you. The answer
 * comes from the card (`POST …/questions/:questionId/answer`), or from
 * whatever you type in the message box while it waits. Skipping, stopping
 * the reply and restarting Conch all answer `null`, and the assistant carries
 * on with its best judgement.
 *
 * One question waits per chat at a time. Nobody is asked anything in a chat
 * nobody is watching (a routine, a task, a chat app's conversation).
 */
import {
  answerText,
  checkAnswer,
  type ConversationEvent,
  type ConversationEventInput,
  type Question,
  type QuestionAnswer,
} from '@conch/protocol';

import { newId } from '../lib/ids';
import type { ToolContext } from '../conversations/manager';

export class QuestionError extends Error {
  constructor(
    readonly code: 'not-found' | 'answered' | 'invalid',
    message: string,
  ) {
    super(message);
  }
}

/** What the assistant is told when the person answered. */
export function answeredWords(question: Question, answer: QuestionAnswer): string {
  if (!Object.keys(answer.values).length)
    return `They answered in their own words: “${answer.text}”. Carry on with that.`;
  return [
    `They answered: ${answer.text}`,
    // The exact values, so a date keeps its year and a choice its id.
    `Exactly: ${JSON.stringify(answer.values)}`,
    question.fields.length > 1 ? 'Carry on with these.' : 'Carry on with that.',
  ].join('\n');
}

export const SKIPPED =
  'They skipped the question. Carry on with your best judgement, and say in a few words what you assumed.';
export const NOBODY =
  'Nobody is here to answer questions in this chat. Choose the sensible default, carry on, and say which you chose.';
export const ONE_AT_A_TIME =
  'A question is already waiting for an answer in this chat. Wait for that answer before asking another.';

interface Pending {
  question: Question;
  settle: (answer: QuestionAnswer | null) => void;
}

/** Remembered answers per chat, so a second device pressing late is told it's done. */
const REMEMBER = 20;

export class QuestionDesk {
  #pending = new Map<string, Pending>();
  #answered = new Map<string, string[]>();

  /** A question waits for an answer in this chat. */
  waiting(conversationId: string): Question | undefined {
    return this.#pending.get(conversationId)?.question;
  }

  /**
   * Show `question` in the chat and wait for the person. Resolves with what
   * the assistant is told: the answer, that it was skipped, or that nobody
   * can answer here.
   */
  ask(ctx: ToolContext, asked: Omit<Question, 'questionId'>): Promise<string> {
    if (ctx.unattended) return Promise.resolve(NOBODY);
    if (this.#pending.has(ctx.conversationId)) return Promise.resolve(ONE_AT_A_TIME);
    if (ctx.signal.aborted) return Promise.resolve(SKIPPED);
    const question: Question = {
      questionId: newId('q'),
      ...(asked.title?.trim() && { title: asked.title.trim() }),
      fields: asked.fields,
    };
    return new Promise<string>((resolve) => {
      const settle = (answer: QuestionAnswer | null) => {
        if (this.#pending.get(ctx.conversationId) !== entry) return;
        this.#pending.delete(ctx.conversationId);
        ctx.signal.removeEventListener('abort', stop);
        const seen = this.#answered.get(ctx.conversationId) ?? [];
        this.#answered.set(ctx.conversationId, [...seen, question.questionId].slice(-REMEMBER));
        ctx.append({ type: 'question.answered', questionId: question.questionId, answer });
        // Stopped: the turn is ending, so it isn't "running" again for a moment.
        if (!ctx.signal.aborted) void ctx.waitingForYou?.(false);
        resolve(answer ? answeredWords(question, answer) : SKIPPED);
      };
      const entry: Pending = { question, settle };
      const stop = () => settle(null);
      this.#pending.set(ctx.conversationId, entry);
      ctx.signal.addEventListener('abort', stop, { once: true });
      ctx.append({ type: 'question', question });
      void ctx.waitingForYou?.(true);
    });
  }

  /**
   * The answer from the card, or `null` to skip. Checked against the
   * question's fields, and its words written here, so the chat says what was
   * really chosen.
   */
  answer(conversationId: string, questionId: string, answer: QuestionAnswer | null): void {
    const pending = this.#pending.get(conversationId);
    if (!pending || pending.question.questionId !== questionId) {
      if (this.#answered.get(conversationId)?.includes(questionId))
        throw new QuestionError('answered', 'That question has already been answered.');
      throw new QuestionError('not-found', 'That question isn’t waiting for an answer any more.');
    }
    if (!answer) return pending.settle(null);
    const checked = checkAnswer(pending.question, answer.values);
    if (!checked.ok) throw new QuestionError('invalid', checked.message);
    if (!Object.keys(checked.values).length) return pending.settle(null);
    pending.settle({
      values: checked.values,
      text: answerText(pending.question, checked.values),
    });
  }

  /**
   * Words typed in the message box while a question waits answer it as they
   * are. False when nothing was waiting.
   */
  typed(conversationId: string, text: string): boolean {
    const pending = this.#pending.get(conversationId);
    const words = text.trim().slice(0, 4000);
    if (!pending || !words) return false;
    pending.settle({ values: {}, text: words });
    return true;
  }

  /** The reply ended with a question still waiting: nobody can answer it now. */
  close(conversationId: string): void {
    this.#pending.get(conversationId)?.settle(null);
  }
}

/**
 * A chat read back after Conch restarted with a question still waiting: the
 * answer was lost with the reply, so the log says it was skipped.
 */
export function unansweredOnRestart(
  events: readonly ConversationEvent[],
): Extract<ConversationEventInput, { type: 'question.answered' }>[] {
  const answered = new Set(
    events.flatMap((e) => (e.type === 'question.answered' ? [e.questionId] : [])),
  );
  return events.flatMap((e) =>
    e.type === 'question' && !answered.has(e.question.questionId)
      ? [{ type: 'question.answered' as const, questionId: e.question.questionId, answer: null }]
      : [],
  );
}
