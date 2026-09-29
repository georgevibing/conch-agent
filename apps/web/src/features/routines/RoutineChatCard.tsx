import { RoutineCard } from '@conch/nacre';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { routineIcon } from './icon';
import { useRoutines, useRunRoutine, useUpdateRoutine } from './queries';
import { RoutineEditor } from './RoutineEditor';
import styles from './Routines.module.css';

/**
 * The card a routine gets in the chat that created or changed it — live: it
 * reflects the routine's current state, not a snapshot.
 */
export function RoutineChatCard({
  routineId,
  title,
  action,
}: {
  routineId: string;
  title: string;
  action: 'proposed' | 'updated' | 'paused' | 'deleted';
}) {
  const { data: routines } = useRoutines();
  const update = useUpdateRoutine();
  const run = useRunRoutine();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const routine = routines?.find((r) => r.id === routineId);

  if (!routine) {
    return (
      <div className={styles.chatCard}>
        <RoutineCard variant="proposal" title={title} summary="" scheduleText="" status="deleted" />
      </div>
    );
  }

  return (
    <div className={styles.chatCard}>
      <RoutineCard
        variant={action === 'proposed' ? 'proposal' : 'list'}
        title={routine.title}
        summary={routine.summary}
        scheduleText={routine.scheduleText}
        status={routine.status}
        nextRunAt={routine.nextRunAt}
        icon={routineIcon(routine.schedule)}
        lastRun={
          routine.lastRun && {
            status: routine.lastRun.status,
            at: routine.lastRun.finishedAt ?? routine.lastRun.startedAt,
            outcome: routine.lastRun.outcome ?? routine.lastRun.error,
          }
        }
        busy={update.isPending}
        onActivate={() => update.mutate({ id: routine.id, patch: { status: 'active' } })}
        onTryNow={() => run.mutate(routine.id)}
        onEdit={() => setEditing(true)}
        onDismiss={() => update.mutate({ id: routine.id, patch: { status: 'paused' } })}
        onOpen={() => void navigate(`/routines/${routine.id}`)}
        onToggle={(active) =>
          update.mutate({ id: routine.id, patch: { status: active ? 'active' : 'paused' } })
        }
      />
      {editing && <RoutineEditor open routine={routine} onOpenChange={setEditing} />}
    </div>
  );
}
