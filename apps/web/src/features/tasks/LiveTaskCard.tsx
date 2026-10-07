import { assessTask, uncertainEffect, type PermissionMode, type Task } from '@conch/protocol';
import { InlineCode, TaskCard } from '@conch/nacre';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useConversations } from '../../api/queries';
import { useLive } from '../../live/LiveProvider';
import { modeWords } from '../models/words';
import { useRemoveTask, useRetryTask, useStopTask } from './queries';

/** "Full trust", "Ask first": the mode a task runs in, in the words the picker uses. */
export function modeLabel(mode: PermissionMode | undefined): string | undefined {
  return mode && modeWords.find((m) => m.value === mode)?.label;
}

/** `code` in a step, as code. */
export function withCode(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/);
  return parts.map((part, i) => (i % 2 ? <InlineCode key={i}>{part}</InlineCode> : part));
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
  const unchecked = task.status === 'unverified' && assessment.verdict === 'unchecked';
  const navigate = useNavigate();
  const live = useLive();
  const { data: chats } = useConversations();
  // The answer is on its way: the buttons wait for it to land (the task's next copy).
  const [answered, setAnswered] = useState<string>();
  const stop = useStopTask();
  const retry = useRetryTask();
  const remove = useRemoveTask();
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
      kind={task.kind}
      title={task.title}
      status={task.status}
      unchecked={unchecked}
      startedAt={task.startedAt}
      finishedAt={task.finishedAt}
      current={task.current && withCode(task.current)}
      steps={task.steps.map((s) => withCode(s.label))}
      summary={
        <>
          {task.summary && <p>{task.summary}</p>}
          {unchecked && (
            <p>No automatic completion criteria were set. Recorded tool results are shown below.</p>
          )}
          {assessment.reasons.some((reason) => reason.code === 'required-evidence-missing') && (
            <ul aria-label="Missing verification">
              {assessment.reasons
                .filter((reason) => reason.code === 'required-evidence-missing')
                .map((reason) => (
                  <li key={reason.tool}>
                    Still needs {reason.minimum} confirmed result(s) from {reason.tool}.
                  </li>
                ))}
            </ul>
          )}
          {task.operations?.some((operation) => operation.receipt) && (
            <ul aria-label="Confirmed results">
              {task.operations
                .filter((operation) => operation.state === 'confirmed' && operation.receipt)
                .map((operation) => (
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
          {assessment.reasons.some((reason) => reason.code === 'receipt-unavailable') && (
            <p>
              Some tools finished without independent outcome checks. Their earlier actions will not
              be replayed.
            </p>
          )}
          {task.operations?.some(uncertainEffect) && (
            <p>Some actions have no confirmed result. They will not be repeated automatically.</p>
          )}
        </>
      }
      error={unchecked ? undefined : task.error}
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
      onOpen={task.conversationId ? () => void navigate(`/c/${task.conversationId}`) : undefined}
      onStop={() => stop.mutate(task.id)}
      // Helpers are the assistant's to start again; a task you sent away is yours.
      onRetry={task.kind === 'background' ? () => retry.mutate(task.id) : undefined}
      onRemove={() => remove.mutate(task.id)}
    />
  );
}
