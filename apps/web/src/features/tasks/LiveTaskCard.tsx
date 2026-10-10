import { assessTask, taskDoubt, taskWorth, type PermissionMode, type Task } from '@conch/protocol';
import { InlineCode, TaskCard, type TaskWaitingInfo } from '@conch/nacre';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';

import { useConversations } from '../../api/queries';
import { useLive } from '../../live/LiveProvider';
import { modeWords } from '../models/words';
import { useOpenTask } from './open';
import { useRemoveTask, useRetryTask, useStartNowTask, useStopTask } from './queries';

/** "Full trust", "Ask first": the mode a task runs in, in the words the picker uses. */
export function modeLabel(mode: PermissionMode | undefined): string | undefined {
  return mode && modeWords.find((m) => m.value === mode)?.label;
}

/** `code` in a step, as code. */
export function withCode(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  return parts.map((part, i) => (i % 2 ? <InlineCode key={i}>{part}</InlineCode> : part));
}

/**
 * Why a waiting task waits, for its card and its line (ADR 0128), with **Start
 * now** when it waits only for room and it hasn't been pressed already.
 */
export function useWaiting(): (task: Task) => TaskWaitingInfo | undefined {
  const start = useStartNowTask();
  return (task) => {
    const waiting = task.status === 'queued' ? task.waiting : undefined;
    if (!waiting) return undefined;
    const starting = start.isPending && start.variables === task.id;
    return {
      words: waiting.words,
      ...(waiting.retryAt !== undefined && { retryAt: waiting.retryAt }),
      ...(waiting.expectedAt !== undefined && { expectedAt: waiting.expectedAt }),
      ...(waiting.canStartNow &&
        !task.startNow && { onStartNow: () => start.mutate(task.id), starting }),
    };
  };
}

/** What a finished task confirmed, and what it couldn't: behind its card's "Details". */
function details(task: Task, assessment: ReturnType<typeof assessTask>): ReactNode {
  const confirmed = (task.operations ?? []).filter(
    (operation) => operation.state === 'confirmed' && operation.receipt,
  );
  const missing = assessment.reasons.flatMap((reason) =>
    reason.code === 'required-evidence-missing' ? [reason] : [],
  );
  // Which of its actions, in words: a call Conch held before it ran isn't one of them.
  const doubt = taskDoubt(task);
  if (!confirmed.length && !missing.length && !doubt) return undefined;
  return (
    <>
      {confirmed.length > 0 && (
        <ul aria-label="Confirmed results">
          {confirmed.map((operation) => (
            <li key={operation.id}>
              {operation.receipt?.url ? (
                <a href={operation.receipt.url} target="_blank" rel="noreferrer">
                  {operation.receipt.label}
                </a>
              ) : (
                operation.receipt?.label
              )}
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <ul aria-label="Missing verification">
          {missing.map((reason) => (
            <li key={reason.tool}>
              Not confirmed yet: {reason.tool}
              {reason.minimum > 1 && ` (${reason.minimum} times)`}.
            </li>
          ))}
        </ul>
      )}
      {doubt && <p>{doubt}</p>}
    </>
  );
}

/** A task as a card, with what you can do about it. */
export function LiveTaskCard({
  task,
  variant = 'full',
  className,
}: {
  task: Task;
  variant?: 'full' | 'compact';
  className?: string;
}) {
  const assessment = assessTask(task);
  const worth = taskWorth(task);
  const openTask = useOpenTask();
  // Already in its chat: nothing to open.
  const inside = useLocation().pathname === `/c/${task.conversationId}`;
  const live = useLive();
  const { data: chats } = useConversations();
  // The answer is on its way: the buttons wait for it to land (the task's next copy).
  const [answered, setAnswered] = useState<string>();
  const stop = useStopTask();
  const retry = useRetryTask();
  const remove = useRemoveTask();
  const waitingOf = useWaiting();
  const asking = task.status === 'needs-you' && task.asking?.here ? task.asking : undefined;
  const answer = (decision: 'allow' | 'deny') => {
    if (!asking || !task.conversationId) return;
    setAnswered(asking.permissionId);
    live.respond(task.conversationId, asking.permissionId, decision);
  };
  // On the Tasks page: the chat it came from, a press away.
  const from =
    variant === 'full' && task.parentConversationId
      ? chats?.find((c) => c.id === task.parentConversationId)
      : undefined;
  return (
    <TaskCard
      className={className}
      variant={variant}
      title={task.title}
      status={task.status}
      worth={worth}
      startedAt={task.startedAt}
      finishedAt={task.finishedAt}
      current={task.current && withCode(task.current)}
      waiting={waitingOf(task)}
      steps={task.steps.map((s) => s.label)}
      renderStep={withCode}
      summary={task.summary}
      // What's behind "Details": what it confirmed, and what it couldn't.
      details={details(task, assessment)}
      error={task.status === 'failed' || task.status === 'interrupted' ? task.error : undefined}
      note={task.note}
      branch={task.worktree?.changed ? task.worktree.branch : undefined}
      by={task.by}
      mode={variant === 'full' ? modeLabel(task.options.permissionMode) : undefined}
      from={from && <Link to={`/c/${from.id}`}>{from.title}</Link>}
      asking={
        asking && task.conversationId
          ? {
              summary: withCode(asking.summary.charAt(0).toLowerCase() + asking.summary.slice(1)),
              command: asking.command,
              why: asking.taint,
              pending: answered === asking.permissionId,
              onAllow: () => answer('allow'),
              onDeny: () => answer('deny'),
            }
          : undefined
      }
      onOpen={task.conversationId && !inside ? () => openTask(task) : undefined}
      onStop={() => stop.mutate(task.id)}
      // A task the assistant split off is its to start again; one you started is yours.
      onRetry={task.kind === 'background' ? () => retry.mutate(task.id) : undefined}
      onRemove={() => remove.mutate(task.id)}
    />
  );
}
