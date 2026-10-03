import type { Schedule, Trigger } from '@conch/protocol';
import {
  Bell,
  CalendarClock,
  CalendarDays,
  CircleCheckBig,
  FolderOpen,
  Globe,
  Mail,
  Moon,
  Repeat,
  Sparkles,
  Sun,
  Sunrise,
  Webhook,
} from 'lucide-react';
import type { ReactNode } from 'react';

const WHEN_ICONS: Record<Trigger['kind'], ReactNode> = {
  mail: <Mail />,
  calendar: <CalendarClock />,
  page: <Globe />,
  folder: <FolderOpen />,
  task: <CircleCheckBig />,
  routine: <Repeat />,
  hook: <Webhook />,
};

/** A calm glyph that hints at when a routine runs, or what starts it (ADR 0056). */
export function routineIcon(schedule: Schedule, when?: { kind: Trigger['kind'] }): ReactNode {
  if (when) return WHEN_ICONS[when.kind];
  if (schedule.type === 'once') return <Bell />;
  if (schedule.type === 'interval') return <Repeat />;
  if (schedule.type === 'monthly') return <CalendarDays />;
  if (schedule.type === 'cron') return <Sparkles />;
  const hour = Number(schedule.time.split(':')[0]);
  if (hour < 11) return <Sunrise />;
  if (hour >= 18) return <Moon />;
  return <Sun />;
}

/** Said instead of the next run, for a routine that starts when something happens. */
export const WAITING_TEXT = 'Free until something happens';

/** A When-routine whose source can't look, in a sentence (for its card). */
export function watchProblem(routine: {
  status: string;
  watch?: { state: string; message?: string };
}): string | undefined {
  if (routine.status !== 'active' || !routine.watch) return undefined;
  return routine.watch.state === 'needs-you' || routine.watch.state === 'trouble'
    ? routine.watch.message
    : undefined;
}
