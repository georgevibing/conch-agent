import type { ConchUpdate, ProgramUpdate, ReleaseNotes as Notes } from '@conch/protocol';
import {
  Badge,
  Button,
  Callout,
  Heading,
  ProgramUpdates,
  ReleaseChannelPicker,
  ReleaseNotes,
  SoftwareUpdate,
  Stack,
  Switch,
  Text,
  useNow,
  type ProgramUpdateItemProps,
  type ReleaseNoteItem,
  type SoftwareUpdateProps,
} from '@conch/nacre';
import { ArrowUpRight, Download, RefreshCw, RotateCcw, Undo2 } from 'lucide-react';
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

/** A release's notes as Nacre draws them, with its date in words. */
export function noteItems(releases: Notes[]): ReleaseNoteItem[] {
  return releases.map((r) => ({
    version: r.version,
    ...(r.date && {
      date: new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' }),
    }),
    headsUp: r.headsUp,
    new: r.new,
    better: r.better,
    fixed: r.fixed,
  }));
}

export type ConchCard = Omit<SoftwareUpdateProps, 'action' | 'notes'> & {
  offer?: 'update' | 'retry' | 'restart' | 'download';
  /** Where to download it, when the app can't replace itself (ADR 0054). */
  download?: string;
  /** A release's notes, drawn with `ReleaseNotes` behind "What's new". */
  releases?: Notes[];
};

/** Where Conch itself stands, as the card says it. */
export function conchCard(
  conch: ConchUpdate,
  options: { restartable: boolean; now?: number },
): ConchCard {
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
  if (conch.source === 'releases') return releaseCard(conch, { ...options, now, checked, notice });
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

/** Conch following its releases (ADR 0051): the release waiting, and its own notes. */
function releaseCard(
  conch: ConchUpdate,
  {
    restartable,
    now,
    checked,
    notice,
  }: { restartable: boolean; now: number; checked?: string; notice: SoftwareUpdateProps['notice'] },
): ConchCard {
  const outcome = conch.outcome;
  // The desktop app that can't replace itself: the release page, one press away (ADR 0054).
  if (conch.latest && conch.blocked?.download)
    return {
      state: 'available',
      title: `Conch ${short(conch.latest.version)} is ready`,
      detail: [`You have ${conch.version}`, checked].filter(Boolean).join(' · '),
      releases: conch.releases,
      footnote: conch.blocked.reason,
      offer: 'download',
      download: conch.blocked.download,
    };
  if (conch.latest)
    return {
      state: 'available',
      title: `Conch ${short(conch.latest.version)} is ready`,
      detail: [`You have ${conch.version}`, checked].filter(Boolean).join(' · '),
      releases: conch.releases,
      notice,
      footnote: restartable
        ? 'Conch gets it ready while you keep working, then restarts in a few seconds. Your chats are safe.'
        : 'Conch gets it ready while you keep working; then you restart it. Your chats are safe.',
      offer: notice?.tone === 'danger' ? 'retry' : 'update',
    };
  if (conch.restartNeeded)
    return {
      state: 'current',
      title: 'Restart Conch to finish',
      detail: restartable
        ? 'The new version is ready. Conch starts on it when it restarts.'
        : 'The new version is ready. Stop Conch and run pnpm start, and it starts on it.',
      releases: outcome?.releases,
      whatsNewLabel: 'What’s new in this update',
      offer: restartable ? 'restart' : undefined,
    };
  const justUpdated = outcome?.kind === 'updated' && now - outcome.at < DAY;
  const when = justUpdated ? `Updated ${relativeTime(outcome.at, now)}` : checked;
  return {
    state: 'current',
    title: 'Conch is up to date',
    detail: conch.problem
      ? [conch.problem, checked && `${checked}.`].filter(Boolean).join(' ')
      : [conch.version, when ?? 'Not checked yet'].join(' · '),
    releases: justUpdated ? outcome.releases : undefined,
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
    if (!status || (focus !== 'check-updates' && focus !== 'update-conch' && focus !== 'updates'))
      return;
    useUi.setState({ settingsFocus: undefined });
    ref.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    if (focus === 'updates' || started.current) return;
    started.current = true;
    if (focus === 'check-updates') void actions.check();
    // An app that can’t replace itself only shows its download (ADR 0054).
    else if (status.conch.behind > 0 && !status.conch.blocked?.download) void actions.updateConch();
  }, [focus, status, actions]);

  if (!status) return null;
  const { conch } = status;
  const {
    releases: cardNotes,
    download,
    ...card
  } = conchCard(conch, {
    restartable: status.restartable,
    now,
  });
  const notes = cardNotes?.length ? <ReleaseNotes releases={noteItems(cardNotes)} /> : undefined;
  const releases = conch.source === 'releases';
  // A contributor's switch: only where it could matter, out of everyone else's sight.
  const developer =
    conch.everyChange ||
    (conch.checkable && conch.source === 'branch') ||
    Boolean(conch.branch && conch.branch !== 'main');
  const conchBusy = Boolean(status.conch.running) || actions.pending === 'conch';
  const cardAction =
    card.offer === 'download' && download ? (
      <Button asChild leadingIcon={<Download />}>
        <a href={download} target="_blank" rel="noopener noreferrer">
          Download Conch {conch.latest ? short(conch.latest.version) : ''}
        </a>
      </Button>
    ) : card.offer === 'restart' ? (
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
        <SoftwareUpdate {...card} notes={notes} action={cardAction} />
        {!releases && conch.sourceWhy && (
          <Text size="sm" tone="muted">
            {conch.sourceWhy}
          </Text>
        )}
        {conch.refused && (
          <Callout tone="warning" live="polite">
            {conch.refused} Conch only installs releases signed by Conch’s makers.
          </Callout>
        )}
        {conch.notice && (
          <Callout tone="neutral" live="polite">
            <Stack gap={2} align="start">
              <span>{conch.notice.message}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => conch.notice && void actions.dismissNotice(conch.notice.id)}
              >
                Got it
              </Button>
            </Stack>
          </Callout>
        )}
        {releases && conch.previous && !conch.running && (
          <Stack direction="row" align="center" justify="between" gap={3} wrap>
            <Text size="sm" tone="muted">
              Conch keeps {conch.previous} beside this version, so going back is instant.
            </Text>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Undo2 />}
              loading={actions.pending === 'back'}
              onClick={() => void actions.goBack()}
            >
              Go back to {conch.previous}
            </Button>
          </Stack>
        )}
        {releases && !conch.everyChange && (
          <Stack gap={2}>
            <Heading level={4} size="sm" weight="medium">
              Release channel
            </Heading>
            <ReleaseChannelPicker
              value={conch.channel}
              disabled={actions.pending === 'channel' || Boolean(conch.running)}
              onValueChange={(channel) => void actions.setChannel(channel)}
              note={conch.waiting}
            />
          </Stack>
        )}
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
        {developer && (
          <Switch
            checked={conch.everyChange}
            disabled={actions.pending === 'every-change'}
            onCheckedChange={(on) => void actions.setEveryChange(on)}
            label="Every change on main"
            description="For people working on Conch: every change as it lands, not only signed releases."
          />
        )}
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
