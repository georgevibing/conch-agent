import { answerText, type QuestionAnswer } from '@conch/protocol';
import { QuestionCard } from '@conch/nacre';
import { useState } from 'react';

import { ApiError } from '../../api/client';
import type { TranscriptItem } from '../../live/reducer';
import styles from '../chat/Transcript.module.css';
import { questionsApi } from './api';

/** What went wrong sending an answer, and the one thing to do about it. */
function trouble(error: unknown): string | undefined {
  // Answered from another device a moment before: the chat folds it as that arrives.
  if (error instanceof ApiError && error.code === 'answered') return undefined;
  if (error instanceof ApiError && (error.code === 'invalid' || error.code === 'not-found'))
    return error.message;
  return 'Your answer didn’t reach Conch. Try again, or type it in the message box.';
}

/**
 * A question the assistant asked (ADR 0055 §4), answered with a tap. The
 * card folds as soon as you answer; the answer goes to Conch, which checks
 * it and words it for the chat. If it doesn't arrive, the card opens again
 * and says what to do.
 */
export function QuestionItem({
  item,
  conversationId,
  name,
  waiting,
}: {
  item: Extract<TranscriptItem, { kind: 'question' }>;
  conversationId?: string;
  name: string;
  /** The reply is still waiting for it: it can be answered here. */
  waiting: boolean;
}) {
  /** Sent from here and not confirmed yet: what the folded card shows meanwhile. */
  const [sent, setSent] = useState<QuestionAnswer | null>();
  const [error, setError] = useState<string>();

  const send = (answer: QuestionAnswer | null) => {
    if (!conversationId) return;
    setError(undefined);
    setSent(answer);
    questionsApi.answer(conversationId, item.id, answer).catch((e: unknown) => {
      const message = trouble(e);
      if (message === undefined) return;
      setSent(undefined);
      setError(message);
    });
  };

  const answer = item.answer !== undefined ? item.answer : sent;
  const state = answer === undefined ? 'open' : answer === null ? 'skipped' : 'answered';
  return (
    <div className={styles.aside}>
      <QuestionCard
        question={item.question}
        state={state}
        answer={answer?.text}
        // Typed in the message box instead: the message itself says the answer.
        answeredInMessage={Boolean(answer && Object.keys(answer.values).length === 0)}
        onAnswer={(values) =>
          // Nothing filled in (every field was optional): the same as Skip.
          send(
            Object.keys(values).length ? { values, text: answerText(item.question, values) } : null,
          )
        }
        onSkip={() => send(null)}
        disabled={!waiting || !conversationId}
        error={error}
        assistant={name}
      />
    </div>
  );
}
