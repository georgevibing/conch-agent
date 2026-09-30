import { HealedNotes, Text } from '@conch/nacre';

import { useHealed } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { Section } from './Section';

/**
 * What Conch repaired by itself lately (AGENTS.md agreement 11): reassurance
 * next to the checkup, never an alert.
 */
export function HealedSection() {
  const { data } = useHealed();
  const notes = data?.notes ?? [];
  return (
    <Section
      title="Fixed on its own"
      description="What Conch noticed and repaired by itself, so you didn’t have to."
    >
      {notes.length ? (
        <HealedNotes notes={notes} limit={8} bare formatTime={(at) => relativeTime(at)} />
      ) : (
        <Text size="sm" tone="muted">
          Nothing has needed fixing lately.
        </Text>
      )}
    </Section>
  );
}
