import type { Task } from '@conch/protocol';
import { TasksPulse, type PulseTask } from '@conch/nacre';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useLive } from '../../live/LiveProvider';
import { withCode } from './LiveTaskCard';
import { TaskLink } from './open';
import { going, useTasks } from './queries';

const finished = (status: Task['status']) => status === 'done' || status === 'unverified';

/**
 * The pearl by the assistant's name, alive with what's going on in the
 * background, from every chat (ADR 0033). It glints when something finishes
 * while you're looking elsewhere.
 */
export function BackgroundPulse({
  children,
  className,
  onNavigate,
  bound = true,
}: {
  /** The assistant's name; left out (the phone's header), just the pearl and a count. */
  children?: ReactNode;
  className?: string;
  onNavigate?: () => void;
  /**
   * The one on screen: ⌘K and Repair open its list. The sidebar's, when the
   * sidebar's away, isn't.
   */
  bound?: boolean;
}) {
  const pulseOpen = useUi((s) => s.pulseOpen);
  const setPulseOpen = useUi((s) => s.setPulseOpen);
  const { data } = useTasks();
  const { data: chats } = useConversations();
  const live = useLive();
  const [answered, setAnswered] = useState<ReadonlySet<string>>(new Set());
  const tasks = data?.tasks ?? [];
  const now = tasks.filter(going);

  // One glint when something finishes and you're not already watching it.
  const [celebrate, setCelebrate] = useState(false);
  const seen = useRef<Map<string, Task['status']> | undefined>(undefined);
  useEffect(() => {
    if (!data) return;
    const before = seen.current;
    seen.current = new Map(data.tasks.map((t) => [t.id, t.status]));
    if (!before) return;
    const at = window.location.pathname;
    const done = data.tasks.some((t) => {
      const was = before.get(t.id);
      if (!was || !going({ status: was }) || !finished(t.status)) return false;
      return at !== `/c/${t.conversationId}` && at !== `/c/${t.parentConversationId}`;
    });
    if (done) setCelebrate(true);
  }, [data]);
  useEffect(() => {
    if (!celebrate) return;
    const timer = setTimeout(() => setCelebrate(false), 1200);
    return () => clearTimeout(timer);
  }, [celebrate]);

  // Nothing left to list: the list closes, and stays closed for next time.
  const empty = now.length === 0;
  useEffect(() => {
    if (bound && empty && pulseOpen) setPulseOpen(false);
  }, [bound, empty, pulseOpen, setPulseOpen]);

  const titleOf = (id: string | undefined) => chats?.find((c) => c.id === id)?.title;
  const items: PulseTask[] = now.map((task) => {
    const asking = task.status === 'needs-you' ? task.asking : undefined;
    const pending = asking ? answered.has(asking.permissionId) : false;
    const answer = (decision: 'allow' | 'deny') => {
      if (!asking || !task.conversationId) return;
      setAnswered((s) => new Set(s).add(asking.permissionId));
      live.respond(task.conversationId, asking.permissionId, decision);
    };
    return {
      id: task.id,
      status: task.status,
      link: (
        <TaskLink task={task} onClick={onNavigate}>
          {task.title}
        </TaskLink>
      ),
      chat: titleOf(task.parentConversationId),
      current: asking
        ? withCode(`Wants to ${asking.summary.charAt(0).toLowerCase()}${asking.summary.slice(1)}`)
        : task.status === 'queued' && task.waiting
          ? task.waiting.words
          : task.current && withCode(task.current),
      asking:
        asking?.here && task.conversationId
          ? { pending, onAllow: () => answer('allow'), onDeny: () => answer('deny') }
          : undefined,
    };
  });

  return (
    <TasksPulse
      tasks={items}
      celebrate={celebrate}
      className={className}
      {...(bound && { open: pulseOpen && items.length > 0, onOpenChange: setPulseOpen })}
    >
      {children}
    </TasksPulse>
  );
}
