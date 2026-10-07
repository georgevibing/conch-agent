import type { HealArea } from '@conch/protocol';
import { HealedLog } from '@conch/nacre';
import {
  Activity,
  Archive,
  BookOpen,
  Bot,
  CalendarClock,
  CircleArrowUp,
  Gauge,
  Globe,
  KeyRound,
  MessageSquare,
  Puzzle,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  UserRound,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useHealed } from '../../api/queries';
import { relativeTime } from '../../lib/time';
import { Section } from './Section';

/** One small mark per kind of repair, so the list reads at a glance. */
const MARK: Record<HealArea, ReactNode> = {
  settings: <SlidersHorizontal />,
  search: <Search />,
  integrations: <Puzzle />,
  providers: <Bot />,
  routines: <CalendarClock />,
  secrets: <KeyRound />,
  browser: <Globe />,
  gateway: <Activity />,
  access: <ShieldCheck />,
  conversations: <MessageSquare />,
  terminal: <SquareTerminal />,
  skills: <BookOpen />,
  usage: <Gauge />,
  updates: <CircleArrowUp />,
  backups: <Archive />,
  channels: <Send />,
  agents: <UserRound />,
};

/**
 * What Conch repaired by itself lately (AGENTS.md agreement 11): reassurance
 * next to the checkup, never an alert.
 */
export function HealedSection() {
  const { data } = useHealed();
  const notes = (data?.notes ?? []).map((note) => ({
    at: note.at,
    message: note.message,
    icon: MARK[note.area],
  }));
  return (
    <Section title="Fixed on its own">
      {data && <HealedLog notes={notes} formatTime={(at) => relativeTime(at)} />}
    </Section>
  );
}
