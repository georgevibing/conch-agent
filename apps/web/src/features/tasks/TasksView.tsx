import { EmptyState, Heading, Kbd, Skeleton, Stack, Text } from '@conch/nacre';
import { ListChecks } from 'lucide-react';

import { LiveTaskCard } from './LiveTaskCard';
import { going, useTasks } from './queries';
import styles from './Tasks.module.css';

/**
 * Tasks (ADR 0033): what's working in the background, what needs you, and
 * what finished, newest first. Each opens as the chat it ran in.
 */
export function TasksView() {
  const { data, isPending } = useTasks();
  const tasks = [...(data?.tasks ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  // Waiting for you first, then working, then waiting their turn.
  const rank = { 'needs-you': 0, running: 1, queued: 2 } as Record<string, number>;
  const now = tasks.filter(going).sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
  const finished = tasks.filter((t) => !going(t));

  return (
    <div className={styles.page}>
      <Stack gap={1}>
        <Heading level={1} display size="3xl">
          Tasks
        </Heading>
        <Text tone="muted">
          Things working in the background while you get on with something else. Each one tells you
          when it’s done, and its result comes back to the chat it came from.
        </Text>
      </Stack>
      {isPending ? (
        <Skeleton lines={4} />
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title="Nothing in the background"
          description={
            <>
              Write something in a chat and press <Kbd keys="mod+shift+enter" size="sm" /> to send
              it off as a task. You can keep chatting while it works.
            </>
          }
        />
      ) : (
        <>
          {now.length > 0 && (
            <section className={styles.section} aria-labelledby="tasks-now">
              <Heading level={2} size="md" id="tasks-now">
                Working on it
              </Heading>
              <ul className={styles.list}>
                {now.map((task) => (
                  <li key={task.id}>
                    <LiveTaskCard task={task} />
                  </li>
                ))}
              </ul>
              <Text size="xs" tone="subtle">
                Up to {data?.concurrent ?? 3} work at once; the rest wait their turn.
              </Text>
            </section>
          )}
          {finished.length > 0 && (
            <section className={styles.section} aria-labelledby="tasks-done">
              <Heading level={2} size="md" id="tasks-done">
                Finished
              </Heading>
              <ul className={styles.list}>
                {finished.map((task) => (
                  <li key={task.id}>
                    <LiveTaskCard task={task} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
