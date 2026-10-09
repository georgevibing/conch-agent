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
import { useEffect, useRef, type ReactNode } from 'react';

import { useHealed } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { Section } from './Section';

/** `openSettings('health', HEALED_FOCUS)` brings the list into view. */
export const HEALED_FOCUS = 'healed';

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

/** Which part of Conch a repair was in, said with its mark. */
const AREA: Record<HealArea, string> = {
  settings: 'Settings',
  search: 'Search',
  integrations: 'Apps',
  providers: 'Providers',
  routines: 'Routines',
  secrets: 'Passwords',
  browser: 'Browser',
  gateway: 'Conch',
  access: 'Access',
  conversations: 'Chats',
  terminal: 'Terminal',
  skills: 'Skills',
  usage: 'Usage',
  updates: 'Updates',
  backups: 'Backups',
  channels: 'Channels',
  agents: 'Agents',
};

/**
 * What Conch repaired by itself lately (AGENTS.md agreement 11): reassurance
 * next to the checkup, never an alert. This is the one place repairs are
 * listed: the browser's, the terminal's and every other part's, each with
 * its mark.
 */
export function HealedSection() {
  const { data } = useHealed();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const { settingsFocus } = useUi.getState();
    if (settingsFocus !== HEALED_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const notes = (data?.notes ?? []).map((note) => ({
    at: note.at,
    message: note.message,
    icon: MARK[note.area],
    label: AREA[note.area],
  }));
  return (
    <Section ref={ref} title="Fixed on its own">
      {data && <HealedLog notes={notes} formatTime={(at) => relativeTime(at)} />}
    </Section>
  );
}
