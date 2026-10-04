import type {
  Routine,
  RoutineDetail,
  RoutineRun,
  RoutineSpending,
  ServerEvent,
} from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { routinesApi } from './api';

export const routineKeys = {
  all: ['routines'] as const,
  detail: (id: string) => ['routines', id] as const,
  spending: ['routines-spending'] as const,
};

export function useRoutines() {
  return useQuery({ queryKey: routineKeys.all, queryFn: routinesApi.list, staleTime: 30_000 });
}

export function useRoutine(id: string | undefined) {
  return useQuery({
    queryKey: routineKeys.detail(id ?? ''),
    queryFn: () => routinesApi.detail(id ?? ''),
    enabled: Boolean(id),
  });
}

/** What routines spent this month, live (ADR 0057). */
export function useRoutineSpending() {
  return useQuery({
    queryKey: routineKeys.spending,
    queryFn: routinesApi.spending,
    staleTime: 60_000,
  });
}

function useSpendingMutation<T>(fn: (arg: T) => Promise<RoutineSpending>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (spending) => {
      client.setQueryData(routineKeys.spending, spending);
      // What each routine may do follows the limit.
      void client.invalidateQueries({ queryKey: routineKeys.all });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t change the limit.'),
  });
}

/** A person sets the monthly limit for routines; `null` turns it off. */
export function useSetSpendingLimit() {
  return useSpendingMutation((limitUsd: number | null) => routinesApi.setSpendingLimit(limitUsd));
}

/** “Keep paused”: the card goes away until next month. */
export function useKeepPaused() {
  return useSpendingMutation(() => routinesApi.keepPaused());
}

/** Merge a routine into every cached view of it. */
function putRoutine(client: QueryClient, routine: Routine) {
  client.setQueryData<Routine[]>(routineKeys.all, (list) => {
    if (!list) return list;
    const rest = list.filter((r) => r.id !== routine.id);
    return [routine, ...rest].sort((a, b) => b.createdAt - a.createdAt);
  });
  client.setQueryData<RoutineDetail>(routineKeys.detail(routine.id), (d) =>
    d ? { ...d, routine } : d,
  );
}

function putRun(client: QueryClient, run: RoutineRun) {
  client.setQueryData<RoutineDetail>(routineKeys.detail(run.routineId), (d) => {
    if (!d) return d;
    const runs = [run, ...d.runs.filter((r) => r.id !== run.id)].sort(
      (a, b) => b.startedAt - a.startedAt,
    );
    return { ...d, runs, routine: { ...d.routine, lastRun: runs[0], runCount: runs.length } };
  });
  client.setQueryData<Routine[]>(routineKeys.all, (list) =>
    list?.map((r) =>
      r.id === run.routineId && (!r.lastRun || r.lastRun.startedAt <= run.startedAt)
        ? { ...r, lastRun: run }
        : r,
    ),
  );
}

const finished = new Set(['succeeded', 'nothing-to-do', 'failed', 'needs-you', 'missed']);

/**
 * Routine events from the live socket. Finished runs surface as a toast (and a
 * system notification when the tab is in the background and you opted in).
 */
export function applyRoutineEvent(
  client: QueryClient,
  event: Extract<ServerEvent, { type: `routine.${string}` | 'routines.spending' }>,
  navigate?: (to: string) => void,
) {
  if (event.type === 'routines.spending') {
    client.setQueryData(routineKeys.spending, event.spending);
    return;
  }
  if (event.type === 'routine.changed') return putRoutine(client, event.routine);
  if (event.type === 'routine.deleted') {
    client.setQueryData<Routine[]>(routineKeys.all, (list) =>
      list?.filter((r) => r.id !== event.routineId),
    );
    client.removeQueries({ queryKey: routineKeys.detail(event.routineId) });
    return;
  }
  const { run } = event;
  const before = client
    .getQueryData<RoutineDetail>(routineKeys.detail(run.routineId))
    ?.runs.find((r) => r.id === run.id);
  putRun(client, run);
  if (!finished.has(run.status) || before?.status === run.status) return;
  const routine = client
    .getQueryData<Routine[]>(routineKeys.all)
    ?.find((r) => r.id === run.routineId);
  announce(routine?.title ?? 'Routine', run, navigate);
}

function announce(title: string, run: RoutineRun, navigate?: (to: string) => void) {
  const open = run.conversationId
    ? { label: 'Open', onClick: () => navigate?.(`/c/${run.conversationId}`) }
    : { label: 'View', onClick: () => navigate?.(`/routines/${run.routineId}`) };
  const text = run.outcome ?? run.error ?? '';
  if (run.status === 'failed')
    toast.error(`${title} didn’t finish`, { description: text, action: open });
  else if (run.status === 'needs-you')
    toast(`${title} needs you`, { description: text || 'Open it to continue.', action: open });
  else if (run.status === 'missed')
    toast(`${title} was missed`, { description: 'Conch wasn’t running at the time.' });
  else toast.success(title, { description: text, action: open });

  if (
    typeof Notification !== 'undefined' &&
    Notification.permission === 'granted' &&
    document.visibilityState === 'hidden'
  ) {
    const n = new Notification(run.status === 'needs-you' ? `${title} needs you` : title, {
      body: text,
      tag: run.id,
    });
    n.onclick = () => {
      window.focus();
      open.onClick();
    };
  }
}

/**
 * Change a routine. Turning it on or off shows at once (the switch, the
 * card), and goes back if the gateway says no.
 */
export function useUpdateRoutine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (arg: { id: string; patch: Parameters<typeof routinesApi.update>[1] }) =>
      routinesApi.update(arg.id, arg.patch),
    onMutate: ({ id, patch }) => {
      const before = client.getQueryData<Routine[]>(routineKeys.all);
      const status = patch.status;
      if (status)
        client.setQueryData<Routine[]>(routineKeys.all, (list) =>
          list?.map((r) => (r.id === id ? { ...r, status } : r)),
        );
      return { before };
    },
    onSuccess: (routine) => putRoutine(client, routine),
    onError: (error, _arg, context) => {
      if (context?.before) client.setQueryData(routineKeys.all, context.before);
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong.');
    },
  });
}

export function useRunRoutine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => routinesApi.runNow(id),
    onSuccess: (run) => putRun(client, run),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t start it.'),
  });
}

export function useDeleteRoutine() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (routine: Routine) => routinesApi.remove(routine.id),
    onSuccess: (_r, routine) => {
      client.setQueryData<Routine[]>(routineKeys.all, (list) =>
        list?.filter((r) => r.id !== routine.id),
      );
      toast(`Deleted “${routine.title}”`, {
        action: {
          label: 'Undo',
          onClick: () =>
            void routinesApi
              .create({
                title: routine.title,
                summary: routine.summary,
                prompt: routine.prompt,
                // A routine that started when something happened comes back the same way.
                ...(routine.when
                  ? { when: routine.when, ...(routine.onlyIf && { onlyIf: routine.onlyIf }) }
                  : { schedule: routine.schedule }),
                timezone: routine.timezone,
                trust: routine.trust,
                catchUp: routine.catchUp,
                options: routine.options,
                status: routine.status === 'paused' ? 'paused' : 'active',
              })
              .then((r) => putRoutine(client, r)),
        },
      });
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Couldn’t delete it.'),
  });
}
