import {
  STANDING_ORDER_POWER_NOTE,
  standingOrderKind,
  standingOrderPower,
  type CheckInStatus,
  type QuietHours,
  type StandingOrder,
} from '@conch/protocol';
import {
  Button,
  CheckInCard,
  formatTime,
  formatWhen,
  Heading,
  Popover,
  StandingOrderList,
  Stack,
  Text,
  TimePicker,
  type StandingOrderItem,
} from '@conch/nacre';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ApiError } from '../../api/client';
import { checkInApi, useCheckIn, useCheckInChange, useOrderChange, useStandingOrders } from './api';
import styles from './CheckIns.module.css';

/** “10:00 PM” from “22:00”, on today's date, in the reader's own way of saying times. */
function clock(hhmm: string): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const at = new Date();
  at.setHours(h, m, 0, 0);
  return formatTime(at.getTime());
}

export function quietWords(quiet: QuietHours): string {
  return `Quiet ${clock(quiet.from)} – ${clock(quiet.to)}`;
}

/** How it's doing, in one line: what it watches for, when it looked, what it costs. */
export function checkInLine(status: CheckInStatus, watching: number, now = Date.now()): string {
  if (status.state === 'off') return 'Turn it on to hear about what your standing orders ask for.';
  if (status.state === 'resting' || status.state === 'needs-you' || status.state === 'held')
    return status.message ?? '';
  const parts = [`Watching for ${watching === 1 ? '1 thing' : `${watching} things`}`];
  if (status.state === 'quiet' && status.nextLookAt)
    parts.push(`looks again ${formatWhen(status.nextLookAt, { now }).toLowerCase()}`);
  else if (status.lastLookAt)
    parts.push(`looked ${formatWhen(status.lastLookAt, { now }).toLowerCase()}`);
  parts.push(
    status.month.usd >= 0.01
      ? `$${status.month.usd.toFixed(2)} this month`
      : 'free until something’s new',
  );
  return parts.join(' · ');
}

/** What the list shows of an order: how often it brought you news. */
export function orderItem(order: StandingOrder, now = Date.now()): StandingOrderItem {
  const meta =
    order.told > 0
      ? `Told you ${order.told === 1 ? 'once' : order.told === 2 ? 'twice' : `${order.told} times`}${
          order.lastToldAt ? ` · last ${formatWhen(order.lastToldAt, { now }).toLowerCase()}` : ''
        }`
      : undefined;
  return {
    id: order.id,
    text: order.text,
    kind: order.kind,
    state: order.state,
    ...(order.power && { power: true }),
    ...(meta && { meta }),
  };
}

function QuietHoursButton({
  quiet,
  onSave,
}: {
  quiet: QuietHours;
  onSave: (quiet: QuietHours) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(quiet.from);
  const [to, setTo] = useState(quiet.to);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setFrom(quiet.from);
          setTo(quiet.to);
        }
      }}
    >
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" tone="neutral">
          {quietWords(quiet)}
        </Button>
      </Popover.Trigger>
      <Popover.Content align="start" padding="md">
        <Stack gap={3}>
          <Text size="sm" tone="muted">
            No check-ins between these times. The first look after them covers the night.
          </Text>
          <div className={styles.quietRow}>
            <TimePicker
              aria-label="Quiet from"
              value={from}
              onValueChange={setFrom}
              minuteStep={15}
            />
            <Text size="sm" tone="muted">
              to
            </Text>
            <TimePicker aria-label="Quiet until" value={to} onValueChange={setTo} minuteStep={15} />
          </div>
          <Button
            size="sm"
            onClick={() => {
              onSave({ from, to });
              setOpen(false);
            }}
          >
            Save
          </Button>
        </Stack>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * Routines → Check-ins (ADR 0107): your standing orders, in your words, and
 * the check-in that tells you when something they ask about turns up.
 */
export function CheckInSection() {
  const { data: status } = useCheckIn();
  const { data: list } = useStandingOrders();
  const navigate = useNavigate();
  const location = useLocation();
  const [problem, setProblem] = useState<string>();
  const place = useRef<HTMLElement>(null);
  // A notification or ⌘K opens here (`?checkin=1`): bring the section into view once.
  const shown = Boolean(status);
  useEffect(() => {
    if (shown && new URLSearchParams(location.search).has('checkin'))
      place.current?.scrollIntoView?.({ block: 'start' });
  }, [shown, location.search]);
  const orders = list?.orders ?? [];
  const watching = orders.filter((o) => o.state === 'on' && o.kind === 'tell').length;

  const add = useOrderChange((text: string) => checkInApi.add(text), 'Couldn’t add that.', {
    inline: true,
  });
  const save = useOrderChange(
    ({ id, text }: { id: string; text: string }) => checkInApi.change(id, { text }),
    'Couldn’t change that.',
    { inline: true },
  );
  const keep = useOrderChange(
    (id: string) => checkInApi.change(id, { state: 'on' }),
    'Couldn’t keep that.',
  );
  const remove = useOrderChange((id: string) => checkInApi.remove(id), 'Couldn’t remove that.');
  const configure = useCheckInChange(checkInApi.configure);
  const look = useCheckInChange(checkInApi.look);
  const forget = useCheckInChange(checkInApi.forget);

  const refused = (error: unknown) => {
    setProblem(error instanceof ApiError ? error.message : 'Couldn’t save that. Try again.');
    throw error;
  };

  return (
    <section ref={place} aria-labelledby="routines-checkins" className={styles.section}>
      <Stack gap={0.5}>
        <Heading level={2} id="routines-checkins" size="sm" tone="muted">
          Check-ins and standing orders
        </Heading>
        <Text size="xs" tone="subtle">
          Say once what you want to hear about, or what Conch may do. Every chat keeps it in mind,
          and Conch tells you only when something comes up.
        </Text>
      </Stack>
      {status && (
        <CheckInCard
          state={status.state}
          line={checkInLine(status, watching)}
          quiet={
            <QuietHoursButton
              quiet={status.quiet}
              onSave={(quiet) => configure.mutate({ quiet })}
            />
          }
          onToggle={(on) => configure.mutate({ on })}
          onLookNow={() => look.mutate(undefined)}
          looking={look.isPending}
          {...(status.state === 'needs-you' &&
            status.message && {
              problem: {
                message: status.message,
                ...(status.fix && {
                  action: status.fix.label,
                  onAction: () =>
                    void navigate(status.fix?.place === 'integrations' ? '/apps' : '/routines'),
                }),
              },
            })}
          told={status.told.map((t) => ({
            id: t.id,
            source: t.source,
            title: t.label,
            ...(t.note && { note: t.note }),
            why: t.why,
            when: formatWhen(t.at),
            ...(t.quiet && { quiet: true }),
            ...(t.link && { href: t.link }),
          }))}
          onForget={(id) => forget.mutate(id)}
        />
      )}
      <StandingOrderList
        items={orders.map((o) => orderItem(o))}
        kindOf={standingOrderKind}
        powerOf={standingOrderPower}
        powerNote={STANDING_ORDER_POWER_NOTE}
        {...(problem && { problem })}
        busy={
          (keep.isPending ? keep.variables : undefined) ??
          (remove.isPending ? remove.variables : undefined) ??
          (save.isPending ? save.variables?.id : undefined)
        }
        onAdd={async (text) => {
          setProblem(undefined);
          await add.mutateAsync(text).catch(refused);
        }}
        onSave={async (id, text) => {
          setProblem(undefined);
          await save.mutateAsync({ id, text }).catch(refused);
        }}
        onKeep={(id) => keep.mutate(id)}
        onRemove={(id) => remove.mutate(id)}
      />
    </section>
  );
}
