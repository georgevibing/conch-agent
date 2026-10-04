import type { Routine } from '@conch/protocol';
import {
  Button,
  EmptyState,
  formatMoney,
  Heading,
  Page,
  Pearl,
  RoutineCard,
  RoutinesPaused,
  Skeleton,
  Stack,
  Text,
} from '@conch/nacre';
import { Bell, Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import { ROUTINES_SPEND_FOCUS } from './SpendingSection';

import { routineIcon, WAITING_TEXT, watchProblem } from './icon';
import { NewRoutine } from './NewRoutine';
import { PlanRoomSection } from './PlanRoomSection';
import { RoutineEditor } from './RoutineEditor';
import { useKeepPaused, useRoutines, useRoutineSpending, useUpdateRoutine } from './queries';
import styles from './Routines.module.css';

function needsYou(r: Routine) {
  return (
    r.status === 'active' &&
    (r.lastRun?.status === 'needs-you' ||
      r.lastRun?.status === 'failed' ||
      // A routine that starts when something happens, and can't look (ADR 0056).
      r.watch?.state === 'needs-you')
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
  const { data: spending } = useRoutineSpending();
  const keepPaused = useKeepPaused();
  const openSettings = useUi((s) => s.openSettings);
  const raiseLimit = () => openSettings('usage', ROUTINES_SPEND_FOCUS);
  // Say what routines spend only once there's something to say.
  // Room for your own chats (ADR 0057): only once a routine runs on a plan.
  const onPlan = Boolean(
    spending?.plans?.length || routines?.some((r) => r.spend?.billing === 'plan'),
  );
  const spends = Boolean(
    spending && (spending.monthUsd > 0 || routines?.some((r) => r.spend?.billing === 'metered')),
  );
  // ⌘K's “New routine that starts when…” opens the editor at When… (ADR 0056).
  const location = useLocation();
  const startWhen = (location.state as { create?: string } | null)?.create === 'when';
  const setStartWhen = (on: boolean) =>
    !on && void navigate('/routines', { replace: true, state: null });

  const card = (r: Routine) => (
    <li key={r.id}>
      <RoutineCard
        title={r.title}
        summary={r.summary}
        scheduleText={r.scheduleText}
        {...(r.when && { waitingText: WAITING_TEXT })}
        {...(watchProblem(r) && { problem: watchProblem(r) })}
        status={r.status}
        nextRunAt={r.nextRunAt}
        icon={routineIcon(r.schedule, r.when)}
        cost={r.spend?.text ? { text: r.spend.text, billing: r.spend.billing } : undefined}
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
    <Page gap={6}>
      <header className={styles.pageHeader}>
        <Stack gap={1}>
          <Heading level={1} display size="4xl">
            Routines
          </Heading>
          <Text tone="muted">Things Conch does for you, at a time or when something happens.</Text>
        </Stack>
        {/* When there are none yet, the empty state's button is the only call to action. */}
        {Boolean(routines?.length) && (
          <Button leadingIcon={<Plus />} onClick={() => setCreating(true)}>
            New routine
          </Button>
        )}
      </header>

      {spending?.paused && !spending.paused.dismissed && (
        <RoutinesPaused
          monthUsd={spending.monthUsd}
          until={spending.paused.until}
          onRaise={raiseLimit}
          onKeepPaused={() => keepPaused.mutate()}
          busy={keepPaused.isPending}
        />
      )}

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
          description="Ask Conch to do something regularly, or when something happens — a morning briefing, a brief before each meeting, telling you when someone replies — and it’ll take care of it on its own."
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

      {onPlan && <PlanRoomSection />}

      <footer className={styles.pageFooter}>
        <Text size="xs" tone="subtle">
          Routines run on this computer while Conch is open. If it’s closed, they catch up when
          you’re back, and email and meetings from while it was closed still count. Changes to
          folders don’t.
          {spends && spending && (
            <>
              {' '}
              {spending.limitUsd === null
                ? `They’ve spent ${formatMoney(spending.monthUsd)} this month.`
                : `They’ve spent ${formatMoney(spending.monthUsd)} of this month’s ${formatMoney(spending.limitUsd)}.`}
            </>
          )}
        </Text>
        {spends && (
          <Button variant="ghost" size="sm" leadingIcon={<Wallet />} onClick={raiseLimit}>
            Spending limit
          </Button>
        )}
        <NotifyButton />
      </footer>

      <NewRoutine open={creating} onOpenChange={setCreating} />
      {startWhen && (
        <RoutineEditor
          open
          draft={{ when: { kind: 'mail', from: [], words: [] } }}
          onOpenChange={(o) => !o && setStartWhen(false)}
        />
      )}
    </Page>
  );
}
