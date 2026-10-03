import type { Routine, RoutineRun } from '@conch/protocol';
import {
  AlertDialog,
  Button,
  Callout,
  CodeBlock,
  Collapsible,
  DropdownMenu,
  EmptyState,
  formatWhen,
  Heading,
  IconButton,
  Page,
  RunStatusBadge,
  RunTimeline,
  Skeleton,
  Stack,
  Surface,
  Switch,
  Text,
} from '@conch/nacre';
import { ArrowLeft, Copy, MessageSquare, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { useUi } from '../../app/ui';
import { routineIcon } from './icon';
import { useDeleteRoutine, useRoutine, useRunRoutine, useUpdateRoutine } from './queries';
import { RoutineEditor } from './RoutineEditor';
import styles from './Routines.module.css';
import { useSchedulePreview } from './useSchedulePreview';
import { AlwaysOnHint } from '../background/AlwaysOnHint';

const trustLabels: Record<Routine['trust'], string> = {
  ask: 'Asks you before doing anything that needs permission',
  edits: 'Can change files without asking; commands wait for you',
  full: 'Can do anything without asking',
};

function statusLine(routine: Routine, now: number) {
  if (routine.status === 'draft') return 'Not on yet';
  if (routine.status === 'paused') return 'Paused';
  if (routine.status === 'completed') return 'Finished';
  return routine.nextRunAt
    ? `Next run ${formatWhen(routine.nextRunAt, { now }).replace(/^./, (c) => c.toLowerCase())}`
    : 'On';
}

function NextRuns({ routine }: { routine: Routine }) {
  const { preview, loading } = useSchedulePreview(routine.schedule, routine.timezone);
  if (routine.status !== 'active') return null;
  return (
    <Surface variant="sunken" radius="lg" padding={4} className={styles.nextRuns}>
      <Text size="xs" weight="medium" tone="subtle">
        Coming up
      </Text>
      {loading && !preview ? (
        <Skeleton lines={3} />
      ) : (
        <ol className={styles.nextList}>
          {preview?.next.map((t) => (
            <li key={t}>
              <Text size="sm">{formatWhen(t)}</Text>
            </li>
          ))}
        </ol>
      )}
      <Text size="2xs" tone="subtle">
        Times are in {routine.timezone.replaceAll('_', ' ')}.
      </Text>
      <AlwaysOnHint what="This routine runs" />
    </Surface>
  );
}

export function RoutineDetailView({ routineId }: { routineId: string }) {
  const { data, isPending, error } = useRoutine(routineId);
  const update = useUpdateRoutine();
  const run = useRunRoutine();
  const remove = useDeleteRoutine();
  const navigate = useNavigate();
  const openSettings = useUi((s) => s.openSettings);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [now] = useState(Date.now);

  if (isPending) {
    return (
      <Page gap={6}>
        <Skeleton shape="block" height="8rem" />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page gap={6}>
        <EmptyState
          title="This routine is gone"
          description="It may have been deleted."
          actions={
            <Button variant="surface" onClick={() => void navigate('/routines')}>
              Back to routines
            </Button>
          }
        />
      </Page>
    );
  }

  const { routine, runs } = data;
  const running = runs[0]?.status === 'running' || runs[0]?.status === 'needs-you';
  const openRun = (id: string) => {
    const r = runs.find((x) => x.id === id);
    if (r?.conversationId) void navigate(`/c/${r.conversationId}`);
  };
  const timeline = runs.map((r: RoutineRun) => ({
    id: r.id,
    status: r.status,
    at: r.startedAt,
    trigger: r.trigger,
    outcome: r.outcome,
    error: r.error,
    durationMs: r.finishedAt ? r.finishedAt - r.startedAt : undefined,
  }));

  return (
    <Page gap={6}>
      <Link to="/routines" className={styles.back}>
        <ArrowLeft aria-hidden size={14} /> Routines
      </Link>

      <header className={styles.detailHeader}>
        <span className={styles.detailIcon} aria-hidden>
          {routineIcon(routine.schedule)}
        </span>
        <Stack gap={1} className={styles.detailTitle}>
          <Heading level={1} size="2xl">
            {routine.title}
          </Heading>
          {routine.summary && <Text tone="muted">{routine.summary}</Text>}
          <Text size="sm" tone="subtle">
            {routine.scheduleText} · {statusLine(routine, now)}
          </Text>
        </Stack>
        <Stack direction="row" gap={2} align="center" className={styles.detailActions}>
          {routine.status !== 'completed' && routine.status !== 'draft' && (
            <Switch
              checked={routine.status === 'active'}
              onCheckedChange={(on) =>
                update.mutate({ id: routine.id, patch: { status: on ? 'active' : 'paused' } })
              }
              label={routine.status === 'active' ? 'On' : 'Paused'}
            />
          )}
          <Button
            variant="surface"
            leadingIcon={<Play />}
            loading={run.isPending}
            disabled={running}
            onClick={() => run.mutate(routine.id)}
          >
            {running ? 'Running…' : 'Run now'}
          </Button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label="More" variant="ghost">
                <MoreHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item icon={<Pencil />} onSelect={() => setEditing(true)}>
                Edit
              </DropdownMenu.Item>
              {routine.sourceConversationId && (
                <DropdownMenu.Item
                  icon={<MessageSquare />}
                  onSelect={() => void navigate(`/c/${routine.sourceConversationId}`)}
                >
                  Open the chat it came from
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                icon={<Copy />}
                onSelect={() => void navigator.clipboard?.writeText(routine.prompt)}
              >
                Copy instruction
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
              <DropdownMenu.Item
                icon={<Trash2 />}
                tone="danger"
                onSelect={() => setConfirmDelete(true)}
              >
                Delete
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        </Stack>
      </header>

      {routine.status === 'draft' && (
        <Callout
          tone="info"
          title="Conch suggested this routine"
          action={
            <Button
              size="sm"
              onClick={() => update.mutate({ id: routine.id, patch: { status: 'active' } })}
            >
              Turn on
            </Button>
          }
        >
          It won’t run until you turn it on. Try it once first if you like.
        </Callout>
      )}
      {runs[0]?.status === 'failed' && runs[0].waitingFor && (
        // Held, not lost: it runs by itself once the provider is back.
        <Callout
          tone="warning"
          title="Waiting for its provider"
          action={
            <Button size="sm" onClick={() => openSettings('providers')}>
              Sign in
            </Button>
          }
        >
          {runs[0].error}
        </Callout>
      )}
      {runs[0]?.status === 'needs-you' && (
        <Callout
          tone="warning"
          title={running ? 'Waiting for you' : 'Worth a look'}
          action={
            runs[0].conversationId && (
              <Button size="sm" onClick={() => openRun(runs[0]?.id ?? '')}>
                Open
              </Button>
            )
          }
        >
          {running
            ? 'This run needs your permission to continue.'
            : (runs[0].outcome ?? 'The last run asked you to take a look.')}
        </Callout>
      )}

      <div className={styles.detailGrid}>
        <section aria-labelledby="history" className={styles.section}>
          <Stack direction="row" justify="between" align="baseline">
            <Heading level={2} id="history" size="sm" tone="muted">
              History
            </Heading>
            {runs[0] && <RunStatusBadge status={runs[0].status} size="sm" />}
          </Stack>
          <RunTimeline
            runs={timeline}
            onOpen={openRun}
            emptyText={
              routine.status === 'active'
                ? 'It hasn’t run yet. Use “Run now” to try it.'
                : 'No runs yet.'
            }
          />
        </section>
        <aside className={styles.side}>
          <NextRuns routine={routine} />
          <Collapsible>
            <Collapsible.Trigger className={styles.detailsTrigger}>Details</Collapsible.Trigger>
            <Collapsible.Content>
              <Stack gap={4} className={styles.details}>
                <Stack gap={1}>
                  <Text size="xs" weight="medium" tone="subtle">
                    Instruction
                  </Text>
                  <Text size="sm" className={styles.instruction}>
                    {routine.prompt}
                  </Text>
                </Stack>
                <Stack gap={1}>
                  <Text size="xs" weight="medium" tone="subtle">
                    Permissions
                  </Text>
                  <Text size="sm">{trustLabels[routine.trust]}</Text>
                </Stack>
                <Stack gap={1}>
                  <Text size="xs" weight="medium" tone="subtle">
                    If Conch was off
                  </Text>
                  <Text size="sm">
                    {routine.catchUp
                      ? 'Catches up once when Conch is back'
                      : 'Skips the missed time'}
                  </Text>
                </Stack>
                <Stack gap={1}>
                  <Text size="xs" weight="medium" tone="subtle">
                    Made by
                  </Text>
                  <Text size="sm">
                    {routine.createdBy === 'agent' ? 'Conch, from a chat' : 'You'} ·{' '}
                    {formatWhen(routine.createdAt)}
                  </Text>
                </Stack>
                <CodeBlock
                  language="json"
                  filename={`~/.conch/routines/${routine.id}.json`}
                  code={JSON.stringify(
                    {
                      title: routine.title,
                      summary: routine.summary,
                      prompt: routine.prompt,
                      schedule: routine.schedule,
                      timezone: routine.timezone,
                      status: routine.status,
                      trust: routine.trust,
                      catchUp: routine.catchUp,
                      options: routine.options,
                    },
                    null,
                    2,
                  )}
                  maxLines={24}
                />
                <Button
                  variant="surface"
                  size="sm"
                  leadingIcon={<Pencil />}
                  onClick={() => setEditing(true)}
                >
                  Edit routine
                </Button>
              </Stack>
            </Collapsible.Content>
          </Collapsible>
        </aside>
      </div>

      {editing && <RoutineEditor open routine={routine} onOpenChange={setEditing} />}
      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Content>
          <AlertDialog.Title>Delete “{routine.title}”?</AlertDialog.Title>
          <AlertDialog.Description>
            It won’t run again. Its past runs stay in your chats.
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep it</AlertDialog.Cancel>
            <AlertDialog.Action
              onClick={() => {
                remove.mutate(routine);
                void navigate('/routines');
              }}
            >
              Delete
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Page>
  );
}
