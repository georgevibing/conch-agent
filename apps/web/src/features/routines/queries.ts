import type { Routine, RoutineDetail, RoutineRun, ServerEvent } from '@conch/protocol';
import { toast } from '@conch/nacre';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { ApiError } from '../../api/client';
import { routinesApi } from './api';

export const routineKeys = {
  all: ['routines'] as const,
  detail: (id: string) => ['routines', id] as const,
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
  event: Extract<ServerEvent, { type: `routine.${string}` }>,
  navigate?: (to: string) => void,
) {
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

function useRoutineMutation<T>(
  fn: (arg: T) => Promise<Routine | unknown>,
  success?: (arg: T) => string,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, arg) => {
      if (result && typeof result === 'object' && 'scheduleText' in result)
        putRoutine(client, result as Routine);
      const message = success?.(arg);
      if (message) toast.success(message);
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Something went wrong.'),
  });
}

export function useUpdateRoutine() {
  return useRoutineMutation(
    (arg: { id: string; patch: Parameters<typeof routinesApi.update>[1] }) =>
      routinesApi.update(arg.id, arg.patch),
  );
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
                schedule: routine.schedule,
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
