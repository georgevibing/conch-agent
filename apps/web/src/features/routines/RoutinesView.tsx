import type { Routine } from '@conch/protocol';
import {
  Button,
  EmptyState,
  Heading,
  Pearl,
  RoutineCard,
  Skeleton,
  Stack,
  Text,
} from '@conch/nacre';
import { Bell, Plus } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { routineIcon } from './icon';
import { NewRoutine } from './NewRoutine';
import { useRoutines, useUpdateRoutine } from './queries';
import styles from './Routines.module.css';

function needsYou(r: Routine) {
  return (
    r.status === 'active' && (r.lastRun?.status === 'needs-you' || r.lastRun?.status === 'failed')
  );
}

const sections: { id: string; title: string; hint?: string; match: (r: Routine) => boolean }[] = [
  { id: 'attention', title: 'Needs you', match: needsYou },
  {
    id: 'drafts',
    title: 'Suggested in chat',
    hint: 'Conch drafted these. Turn them on when they look right.',
    match: (r) => r.status === 'draft',
  },
  { id: 'on', title: 'On', match: (r) => r.status === 'active' && !needsYou(r) },
  { id: 'paused', title: 'Paused', match: (r) => r.status === 'paused' },
  {
    id: 'done',
    title: 'Done',
    hint: 'One-off routines that have run.',
    match: (r) => r.status === 'completed',
  },
];

function NotifyButton() {
  const [permission, setPermission] = useState(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  if (permission !== 'default') return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      leadingIcon={<Bell />}
      onClick={() => void Notification.requestPermission().then(setPermission)}
    >
      Notify me when they finish
    </Button>
  );
}

export function RoutinesView() {
  const { data: routines, isPending } = useRoutines();
  const update = useUpdateRoutine();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const card = (r: Routine) => (
    <li key={r.id}>
      <RoutineCard
        title={r.title}
        summary={r.summary}
        scheduleText={r.scheduleText}
        status={r.status}
        nextRunAt={r.nextRunAt}
        icon={routineIcon(r.schedule)}
        lastRun={
          r.lastRun && {
            status: r.lastRun.status,
            at: r.lastRun.finishedAt ?? r.lastRun.startedAt,
            outcome: r.lastRun.outcome ?? r.lastRun.error,
          }
        }
        onOpen={() => void navigate(`/routines/${r.id}`)}
        onToggle={
          r.status === 'completed'
            ? undefined
            : (active) =>
                update.mutate({ id: r.id, patch: { status: active ? 'active' : 'paused' } })
        }
      />
    </li>
  );

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Routines
          </Heading>
          <Text tone="muted">Things Conch does for you, on a schedule.</Text>
        </Stack>
        <Button leadingIcon={<Plus />} onClick={() => setCreating(true)}>
          New routine
        </Button>
      </header>

      {isPending ? (
        <Stack gap={3}>
          <Skeleton shape="block" height="6rem" />
          <Skeleton shape="block" height="6rem" />
        </Stack>
      ) : !routines?.length ? (
        <EmptyState
          size="lg"
          icon={<Pearl size="lg" label={null} />}
          title="Nothing scheduled yet"
          description="Ask Conch to do something regularly — a morning briefing, a weekly tidy-up, a reminder — and it’ll take care of it on its own."
          actions={
            <Button leadingIcon={<Plus />} onClick={() => setCreating(true)}>
              Create your first routine
            </Button>
          }
        />
      ) : (
        <Stack gap={8}>
          {sections.map((section) => {
            const items = routines.filter(section.match);
            if (!items.length) return null;
            return (
              <section
                key={section.id}
                aria-labelledby={`routines-${section.id}`}
                className={styles.section}
              >
                <Stack gap={0.5}>
                  <Heading level={2} id={`routines-${section.id}`} size="sm" tone="muted">
                    {section.title}
                  </Heading>
                  {section.hint && (
                    <Text size="xs" tone="subtle">
                      {section.hint}
                    </Text>
                  )}
                </Stack>
                <ul className={styles.cards}>{items.map(card)}</ul>
              </section>
            );
          })}
        </Stack>
      )}

      <footer className={styles.pageFooter}>
        <Text size="xs" tone="subtle">
          Routines run on this computer while Conch is open. If it’s closed, they catch up when
          you’re back.
        </Text>
        <NotifyButton />
      </footer>

      <NewRoutine open={creating} onOpenChange={setCreating} />
    </div>
  );
}
