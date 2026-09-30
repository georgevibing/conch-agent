import type { ConchUpdate, ProgramUpdate } from '@conch/protocol';
import {
  Badge,
  Button,
  Callout,
  Heading,
  ProgramUpdates,
  SoftwareUpdate,
  Stack,
  Switch,
  Text,
  useNow,
  type ProgramUpdateItemProps,
  type SoftwareUpdateProps,
} from '@conch/nacre';
import { ArrowUpRight, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { Section } from '../settings/Section';
import { followRestart, updatesWaiting, useUpdateActions, useUpdates } from '../updates/queries';

const DAY = 86_400_000;
/** "What's new" lists a few lines; the rest are "and N more". */
const LINES = 5;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "0.160.0" reads as "0.160" in a sentence. */
const short = (version: string) => version.replace(/^(\d+\.\d+)\.0$/, '$1');

/** "12 improvements", or the count of changes when none of them is one. */
function changes(conch: ConchUpdate): string {
  return conch.improvements > 0
    ? plural(conch.improvements, 'improvement')
    : plural(conch.behind, 'small change');
}

/** Where Conch itself stands, as the card says it. */
export function conchCard(
  conch: ConchUpdate,
  options: { restartable: boolean; now?: number },
): Omit<SoftwareUpdateProps, 'action'> & { offer?: 'update' | 'retry' | 'restart' } {
  const now = options.now ?? Date.now();
  const checked = conch.checkedAt ? `Checked ${relativeTime(conch.checkedAt, now)}` : undefined;
  const outcome = conch.outcome;
  const notice: SoftwareUpdateProps['notice'] =
    outcome?.kind === 'rolled-back'
      ? { tone: 'warning', message: outcome.message }
      : outcome?.kind === 'failed'
        ? { tone: 'danger', message: outcome.message, command: outcome.command }
        : undefined;

  if (conch.running) {
    const { phase, label, step = 1, steps = 3, percent } = conch.running;
    const value =
      phase === 'restart'
        ? 100
        : phase === 'rollback'
          ? undefined
          : Math.round(((step - 1 + (percent ?? 0) / 100) / steps) * 100);
    return {
      state: 'updating',
      title: phase === 'rollback' ? 'Going back to the version you had' : 'Updating Conch',
      detail:
        phase === 'rollback'
          ? 'The update didn’t work. Nothing of yours changes.'
          : phase === 'restart'
            ? 'Starting again on the new version. Your chats are safe.'
            : changes(conch),
      progress: {
        label: phase === 'rollback' ? 'Putting things back' : label,
        value,
        ...(phase !== 'restart' && phase !== 'rollback' && { step, steps }),
      },
    };
  }
  if (!conch.checkable)
    return { state: 'unavailable', title: `Conch ${conch.version}`, detail: conch.problem };
  if (conch.behind > 0) {
    const listed = conch.whatsNew.slice(0, LINES);
    return {
      state: 'available',
      title: 'An update is ready',
      detail: [changes(conch), checked].filter(Boolean).join(' · '),
      whatsNew: listed,
      more: Math.max(0, conch.improvements - listed.length),
      blocked: conch.blocked,
      // Refused now: why is the one thing worth saying, not how the last try went.
      notice: conch.blocked ? undefined : notice,
      footnote: conch.blocked
        ? undefined
        : options.restartable
          ? 'Conch restarts by itself when it’s done. Your chats are safe.'
          : 'You’ll restart Conch once it’s done. Your chats are safe.',
      offer: conch.blocked ? undefined : notice ? 'retry' : 'update',
    };
  }
  // Only when nothing newer waits: updating restarts Conch anyway.
  if (conch.restartNeeded)
    return {
      state: 'current',
      title: 'Restart Conch to finish',
      detail: options.restartable
        ? 'The update is in. Conch starts on the new version when it restarts.'
        : 'The update is in. Stop Conch and run pnpm start, and it starts on the new version.',
      whatsNew: outcome?.whatsNew.slice(0, LINES),
      offer: options.restartable ? 'restart' : undefined,
    };
  if (conch.blocked)
    return {
      state: 'unavailable',
      title: 'Conch can’t check for updates',
      detail: [conch.version, checked].filter(Boolean).join(' · '),
      blocked: conch.blocked,
    };
  const justUpdated = outcome?.kind === 'updated' && now - outcome.at < DAY;
  const when = justUpdated ? `Updated ${relativeTime(outcome.at, now)}` : checked;
  return {
    state: 'current',
    title: 'Conch is up to date',
    detail: conch.problem
      ? [conch.problem, checked && `${checked}.`].filter(Boolean).join(' ')
      : [conch.version, when ?? 'Not checked yet'].join(' · '),
    whatsNew: justUpdated ? outcome.whatsNew.slice(0, LINES) : undefined,
    whatsNewLabel: 'What’s new in this update',
    notice,
  };
}

/** One program's row. */
function programRow(
  program: ProgramUpdate,
  now: number,
): Omit<ProgramUpdateItemProps, 'action'> & { offer?: 'update' | 'retry' | 'get' } {
  const base = { name: program.name, version: program.installed };
  if (program.state === 'updating')
    return {
      ...base,
      state: 'updating',
      progress: {
        value: program.progress?.percent,
        label: program.progress?.label ?? `Updating ${program.name}…`,
      },
    };
  if (program.state === 'queued') return { ...base, state: 'queued', status: 'Waiting…' };
  if (program.problem && program.available)
    return {
      ...base,
      state: 'failed',
      message: program.problem,
      offer: program.canUpdate ? 'retry' : undefined,
    };
  if (program.available && program.latest)
    return program.canUpdate
      ? { ...base, state: 'available', offer: 'update' }
      : {
          ...base,
          state: 'available',
          status: `${short(program.latest)} is out`,
          offer: program.download ? 'get' : undefined,
          message: 'Conch can’t update this one here.',
        };
  if (program.updated && now - program.updated.at < DAY)
    return {
      ...base,
      state: 'updated',
      status: `Updated ${relativeTime(program.updated.at, now)}`,
    };
  return { ...base, state: 'current', status: 'Up to date' };
}

/**
 * Settings → Health → Updates. As calm as a phone's Software Update: Conch
 * itself, the programs it uses, a quiet "Check now", and one switch for
 * automatic updates. Nothing here nags: the sidebar's dot is the only signal.
 */
export function UpdatesSection() {
  const { data: status } = useUpdates();
  const actions = useUpdateActions();
  const [restartNote, setRestartNote] = useState<string>();
  const ref = useRef<HTMLElement>(null);
  const focus = useUi((s) => s.settingsFocus);
  const started = useRef(false);
  // "Checked 2 hours ago" stays true while the page is open.
  const now = useNow(60_000);

  // An event may be missed; the poll catches the restart too.
  useEffect(() => {
    if (status) followRestart(status);
  }, [status]);

  // ⌘K "Check for updates" / "Update Conch" land here, and do what they say once.
  useEffect(() => {
    if (!status || (focus !== 'check-updates' && focus !== 'update-conch')) return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    if (started.current) return;
    started.current = true;
    if (focus === 'check-updates') void actions.check();
    else if (status.conch.behind > 0) void actions.updateConch();
  }, [focus, status, actions]);

  if (!status) return null;
  const card = conchCard(status.conch, { restartable: status.restartable, now });
  const conchBusy = Boolean(status.conch.running) || actions.pending === 'conch';
  const cardAction =
    card.offer === 'restart' ? (
      <Button
        leadingIcon={<RotateCcw />}
        onClick={() => void actions.restart('Updating Conch…').then(setRestartNote)}
      >
        Restart Conch
      </Button>
    ) : card.offer ? (
      <Button
        leadingIcon={<RefreshCw />}
        loading={conchBusy}
        onClick={() => void actions.updateConch()}
      >
        {card.offer === 'retry' ? 'Try again' : 'Update Conch'}
      </Button>
    ) : undefined;

  const programs = status.programs;
  const updatable = programs.filter((p) => p.available && p.canUpdate && p.state === 'idle');

  return (
    <Section
      ref={ref}
      title="Updates"
      description="Conch looks once a day, quietly, and tells you here."
      status={
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<RefreshCw />}
          loading={status.checking || actions.pending === 'check'}
          onClick={() => void actions.check()}
        >
          Check now
        </Button>
      }
    >
      <Stack gap={5}>
        <SoftwareUpdate {...card} action={cardAction} />
        {restartNote && (
          <Callout tone="neutral" live="polite">
            {restartNote}
          </Callout>
        )}

        {programs.length > 0 && (
          <Stack gap={2}>
            <Stack direction="row" align="center" justify="between" gap={3}>
              <Heading level={4} size="sm" weight="medium">
                Programs Conch uses
              </Heading>
              {updatable.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={actions.pending === 'all'}
                  onClick={() => void actions.updateAll()}
                >
                  Update all
                </Button>
              )}
            </Stack>
            <ProgramUpdates aria-label="Programs Conch uses">
              {programs.map((program) => {
                const { offer, ...row } = programRow(program, now);
                const action =
                  offer === 'update' || offer === 'retry' ? (
                    <Button
                      size="sm"
                      variant="soft"
                      leadingIcon={offer === 'retry' ? <RotateCcw /> : undefined}
                      loading={actions.pending === `program:${program.id}`}
                      onClick={() => void actions.updateProgram(program.id)}
                    >
                      {offer === 'retry' ? 'Try again' : `Update to ${program.latest ?? ''}`}
                    </Button>
                  ) : offer === 'get' && program.download ? (
                    <Button asChild size="sm" variant="ghost" trailingIcon={<ArrowUpRight />}>
                      <a href={program.download} target="_blank" rel="noopener noreferrer">
                        Get it
                      </a>
                    </Button>
                  ) : undefined;
                return <ProgramUpdates.Item key={program.id} {...row} action={action} />;
              })}
            </ProgramUpdates>
          </Stack>
        )}

        {actions.error && (
          <Callout tone="danger" live="polite">
            {actions.error}
          </Callout>
        )}

        <Switch
          checked={status.auto}
          disabled={actions.pending === 'auto'}
          onCheckedChange={(on) => void actions.setAuto(on)}
          label="Keep the programs Conch uses up to date"
          description="Updates install by themselves overnight, when nothing is running. Conch itself always asks first, since it restarts."
        />
      </Stack>
      {actions.dialog}
    </Section>
  );
}

/** "Conch and Codex", "Codex, uv and 1 more". */
function names(list: string[]): string {
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, 2).join(', ')} and ${list.length - 2} more`;
}

/**
 * The line at the top of Settings → Health when updates wait: what for, in
 * a few words. It goes away by itself when there's nothing to say.
 */
export function UpdatesHeadline() {
  const { data: status } = useUpdates();
  if (!status || !updatesWaiting(status)) return null;
  const waiting = [
    ...(status.conch.behind > 0 ? ['Conch'] : []),
    ...status.programs.filter((p) => p.available).map((p) => p.name),
  ];
  return (
    <Stack direction="row" align="center" gap={2} wrap>
      <Badge tone="accent" variant="soft" dot>
        Update available
      </Badge>
      <Text as="span" size="sm" tone="muted">
        for {names(waiting)}
      </Text>
    </Stack>
  );
}
