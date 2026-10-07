import { assessTask, type Task } from '@conch/protocol';
import {
  Button,
  elapsed,
  Sheet,
  TASK_STATUS_LABELS,
  TaskStatusMark,
  useMediaQuery,
} from '@conch/nacre';
import { Maximize2, Square } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { NARROW } from '../../app/widths';
import { useLive } from '../../live/LiveProvider';
import { emptyView } from '../../live/reducer';
import { useLiveStore } from '../../live/store';
import { Transcript } from '../chat/Transcript';
import { useSeen } from '../chatlist/useSeen';
import { going, useStopTask, useTasks } from './queries';
import styles from './TaskSheet.module.css';

const RANK: Record<string, number> = { 'needs-you': 0, running: 1, queued: 2 };

/** Its batch, what needs you first, then what's working, then the rest as they started. */
export function siblingsOf(task: Task, all: Task[]): Task[] {
  const batch = task.group
    ? all.filter(
        (t) => t.group === task.group && t.parentConversationId === task.parentConversationId,
      )
    : [task];
  return [...batch].sort(
    (a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || a.createdAt - b.createdAt,
  );
}

const wordOf = (task: Task) =>
  task.status === 'unverified' && assessTask(task).verdict === 'unchecked'
    ? 'Finished'
    : TASK_STATUS_LABELS[task.status];

/**
 * A task over the chat it came from (ADR 0033): its live conversation, where
 * you answer what it asks; its batch along the top, one mark each, to step
 * between (a tap, a swipe, the arrow keys). From the bottom on a phone, from
 * the side on a computer, with the glint every panel has. Closing it is going
 * back to where you were.
 */
export function TaskSheet({
  taskId,
  onClose,
  onShow,
}: {
  taskId: string | undefined;
  onClose: () => void;
  onShow: (id: string) => void;
}) {
  const { data } = useTasks();
  const all = data?.tasks ?? [];
  const task = all.find((t) => t.id === taskId);
  // Kept while it closes, so the sheet leaves with what it showed.
  const [shown, setShown] = useState(task);
  if (task && task !== shown) setShown(task);
  const narrow = useMediaQuery(NARROW);
  const open = Boolean(taskId && task);
  const current = task ?? shown;
  return (
    <Sheet.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Sheet.Content
        side={narrow ? 'bottom' : 'right'}
        size="lg"
        className={styles.sheet}
        aria-describedby={undefined}
      >
        {current && (
          <SheetBody task={current} siblings={siblingsOf(current, all)} onShow={onShow} />
        )}
      </Sheet.Content>
    </Sheet.Root>
  );
}

function SheetBody({
  task,
  siblings,
  onShow,
}: {
  task: Task;
  siblings: Task[];
  onShow: (id: string) => void;
}) {
  const navigate = useNavigate();
  const stop = useStopTask();
  const tabsId = useId();
  const at = siblings.findIndex((t) => t.id === task.id);
  // Which way it moved, so the next one slides in from that side.
  const [direction, setDirection] = useState<'next' | 'back'>('next');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  // Ten of them don't all fit: the one showing stays in view.
  useEffect(() => {
    tabs.current[at]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [at]);
  const step = (to: number, focus = false) => {
    const next = siblings[(to + siblings.length) % siblings.length];
    if (!next || next.id === task.id) return;
    setDirection(to > at ? 'next' : 'back');
    onShow(next.id);
    if (focus) tabs.current[siblings.indexOf(next)]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: at + 1,
      ArrowLeft: at - 1,
      Home: 0,
      End: siblings.length - 1,
    };
    const to = keys[e.key];
    if (to === undefined) return;
    e.preventDefault();
    step(to, true);
  };
  // A swipe across (not down: that scrolls) steps to the next or the one before.
  const swipe = useRef<{ x: number; y: number } | undefined>(undefined);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || siblings.length < 2) return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const from = swipe.current;
    swipe.current = undefined;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) > 64 && Math.abs(dx) > 1.6 * Math.abs(dy)) step(at + (dx < 0 ? 1 : -1));
  };
  const live = going(task);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  const took = task.startedAt ? elapsed((task.finishedAt ?? now) - task.startedAt) : undefined;
  return (
    <>
      <Sheet.Header className={styles.header}>
        <Sheet.Title className={styles.title}>{task.title}</Sheet.Title>
        <p className={styles.meta} data-status={task.status} aria-live="polite">
          <span className={styles.word}>{wordOf(task)}</span>
          {took && task.status !== 'queued' && <span> · {took}</span>}
          {task.by && <span> · by {task.by}</span>}
        </p>
      </Sheet.Header>

      {siblings.length > 1 && (
        <div
          className={styles.tabs}
          role="tablist"
          aria-label={`${siblings.length} tasks started together`}
        >
          {siblings.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${tabsId}-${t.id}`}
              aria-selected={t.id === task.id}
              aria-controls={`${tabsId}-panel`}
              aria-label={`${t.title}: ${wordOf(t)}`}
              tabIndex={t.id === task.id ? 0 : -1}
              className={styles.tab}
              data-status={t.status}
              onClick={() => step(i)}
              onKeyDown={onKeyDown}
            >
              <TaskStatusMark status={t.status} />
              <span className={styles.tabTitle} aria-hidden>
                {t.title}
              </span>
            </button>
          ))}
        </div>
      )}

      <div
        id={`${tabsId}-panel`}
        role={siblings.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={siblings.length > 1 ? `${tabsId}-${task.id}` : undefined}
        key={task.id}
        className={styles.panel}
        data-direction={direction}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = undefined)}
      >
        {task.conversationId ? (
          <TaskTranscript conversationId={task.conversationId} />
        ) : (
          <p className={styles.waiting}>
            {task.status === 'queued'
              ? 'It starts as soon as there’s room.'
              : 'It never got started.'}
          </p>
        )}
      </div>

      <div className={styles.footer}>
        {live && (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Square />}
            onClick={() => stop.mutate(task.id)}
            disabled={stop.isPending}
          >
            Stop
          </Button>
        )}
        {task.conversationId && (
          <Button
            variant="soft"
            size="sm"
            leadingIcon={<Maximize2 />}
            className={styles.full}
            onClick={() => void navigate(`/c/${task.conversationId}`)}
          >
            Continue in full
          </Button>
        )}
      </div>
    </>
  );
}

/** The task's own conversation, live, answered right here. */
function TaskTranscript({ conversationId }: { conversationId: string }) {
  const live = useLive();
  const { data: app } = useAppState();
  const view = useLiveStore((s) => s.views[conversationId]) ?? emptyView;
  useEffect(() => live.watch(conversationId), [conversationId, live]);
  useSeen(conversationId);
  return (
    <Transcript
      view={view}
      opening={!view.loaded && view.items.length === 0}
      pending={[]}
      name={app?.persona.name ?? 'Conch'}
      conversationId={conversationId}
      taskChat
      onRespond={(permissionId, decision) => live.respond(conversationId, permissionId, decision)}
      onRetry={() => undefined}
    />
  );
}
