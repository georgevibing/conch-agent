import { formatWhen } from '@conch/nacre';
import { Repeat } from 'lucide-react';
import { Link } from 'react-router';

import { useConversations } from '../../api/queries';
import { useRoutines } from './queries';
import styles from './Routines.module.css';

/** Shown at the top of a conversation that is a routine's run. */
export function RunBanner({ conversationId }: { conversationId?: string }) {
  const { data: routines } = useRoutines();
  const { data: conversations } = useConversations();
  const conversation = conversations?.find((c) => c.id === conversationId);
  const origin = conversation?.origin;
  if (!conversation || origin?.kind !== 'routine') return null;
  const routine = routines?.find((r) => r.id === origin.routineId);
  return (
    <div className={styles.runBanner} role="note">
      <Repeat size={14} aria-hidden />
      <span>
        {routine ? `“${routine.title}”` : 'A routine'} ran{' '}
        {formatWhen(conversation.createdAt).toLowerCase()}. You can reply to follow up.
      </span>
      <Link to={`/routines/${origin.routineId}`}>See routine</Link>
    </div>
  );
}

/** A routine run's first message: what it was asked to do (you didn't type it). */
export function RoutineInstruction({ text }: { text: string }) {
  return (
    <details className={styles.instructionNote}>
      <summary>Routine instruction</summary>
      <p>{text}</p>
    </details>
  );
}
