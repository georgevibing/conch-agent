import type { Task } from '@conch/protocol';
import { InlineCode, TaskCard } from '@conch/nacre';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useRemoveTask, useRetryTask, useStopTask } from './queries';

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
  const navigate = useNavigate();
  const stop = useStopTask();
  const retry = useRetryTask();
  const remove = useRemoveTask();
  return (
    <TaskCard
      className={className}
      variant={variant}
      kind={task.kind}
      title={task.title}
      status={task.status}
      startedAt={task.startedAt}
      finishedAt={task.finishedAt}
      current={task.current && withCode(task.current)}
      steps={task.steps.map((s) => withCode(s.label))}
      summary={task.summary}
      error={task.error}
      note={task.note}
      branch={task.worktree?.changed ? task.worktree.branch : undefined}
      onOpen={task.conversationId ? () => void navigate(`/c/${task.conversationId}`) : undefined}
      onStop={() => stop.mutate(task.id)}
      // Helpers are the assistant's to start again; a task you sent away is yours.
      onRetry={task.kind === 'background' ? () => retry.mutate(task.id) : undefined}
      onRemove={() => remove.mutate(task.id)}
    />
  );
}
