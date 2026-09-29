import type { Schedule } from '@conch/protocol';
import { Bell, CalendarDays, Moon, Repeat, Sparkles, Sun, Sunrise } from 'lucide-react';
import type { ReactNode } from 'react';

/** A calm glyph that hints at when a routine runs. */
export function routineIcon(schedule: Schedule): ReactNode {
  if (schedule.type === 'once') return <Bell />;
  if (schedule.type === 'interval') return <Repeat />;
  if (schedule.type === 'monthly') return <CalendarDays />;
  if (schedule.type === 'cron') return <Sparkles />;
  const hour = Number(schedule.time.split(':')[0]);
  if (hour < 11) return <Sunrise />;
  if (hour >= 18) return <Moon />;
  return <Sun />;
}
