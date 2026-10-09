import { META_SEP } from '@conch/nacre';
import { conchBuildLabel } from '@conch/protocol';
import type { ConchUpdate, ReleaseNotes as Notes, UpdatesStatus } from '@conch/protocol';
import type {
  ReleaseNoteItem,
  UpdateChipState,
  UpdateDialogProgress,
  UpdateDialogStage,
} from '@conch/nacre';

/** Set just before the page reloads onto a new version; read once when it's back. */
export const ARRIVED = 'conch.updateArrived';

/** "0.160.0" reads as "0.160" in a sentence. */
export const short = (version: string) => version.replace(/^(\d+\.\d+)\.0$/, '$1');

/** Source selection is not proof that the installed build is a release. */
export const installedLabel = (conch: ConchUpdate) =>
  conchBuildLabel(conch.build ?? { kind: 'dev', commit: conch.commit });

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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How far Conch's own update has come, overall, 0–100; undefined when it can't be known. */
export function overall(running: ConchUpdate['running']): number | undefined {
  if (!running) return undefined;
  const { phase, step = 1, steps = 3, percent } = running;
  if (phase === 'restart') return 100;
  if (phase === 'rollback') return undefined;
  return Math.round(((step - 1 + (percent ?? 0) / 100) / steps) * 100);
}

/** An update of Conch itself is one press away (or one download). */
export function conchWaiting(conch: ConchUpdate): boolean {
  return conch.checkable && conch.behind > 0 && (!conch.blocked || Boolean(conch.blocked.download));
}

/** The sidebar's chip: only when there's something to press, or something moving. */
export function chipView(
  status: UpdatesStatus | undefined,
): { state: UpdateChipState; value?: number; label: string } | undefined {
  const conch = status?.conch;
  if (!conch) return undefined;
  if (conch.running) {
    const value = overall(conch.running);
    return {
      state: 'updating',
      value,
      label:
        conch.running.phase === 'restart'
          ? 'Starting the new Conch'
          : `Updating Conch${value === undefined ? '' : `, ${value}%`}`,
    };
  }
  if (conchWaiting(conch)) return { state: 'ready', label: `Update Conch: ${whatComes(conch)}` };
  if (conch.restartNeeded && status.restartable && conch.source === 'branch')
    return { state: 'restart', label: 'Restart Conch to finish updating' };
  return undefined;
}

/** "16 improvements", "Conch 0.5". */
function whatComes(conch: ConchUpdate): string {
  if (conch.latest) return `Conch ${short(conch.latest.version)}`;
  return conch.improvements > 0
    ? plural(conch.improvements, 'improvement')
    : plural(conch.behind, 'small change');
}

export type UpdateOffer =
  | 'update'
  | 'retry'
  | 'download'
  | 'restart'
  | 'later'
  | 'done'
  | 'close'
  /** Armed: stop waiting for the work to finish. */
  | 'stop-waiting';

type Working = UpdatesStatus['working'];

/**
 * Update now (or Restart now) while something works: the question the
 * dialog asks in place, naming it. "Fix Conch CI failures is working. Update
 * anyway? It will pause, and carry on after Conch restarts."
 */
export function confirmText(working: Working, verb: 'Update' | 'Restart' = 'Update'): string {
  const list = working ?? [];
  const [first] = list;
  const others = list.length - 1;
  if (!first)
    return `Something is still working. ${verb} anyway? It will pause, and carry on after Conch restarts.`;
  if (others <= 0)
    return `${first.title} is working. ${verb} anyway? It will pause, and carry on after Conch restarts.`;
  return `${first.title} and ${plural(others, 'more chat', 'more chats')} are working. ${verb} anyway? They’ll pause, and carry on after Conch restarts.`;
}

/** Armed: what it waits for, in a few quiet words (the dialog, and Health). */
export function waitingText(working: Working): string {
  const count = working?.length ?? 1;
  if (count === 0) return 'Will update as soon as nothing is working';
  return count === 1 ? 'Will update when the chat finishes' : 'Will update when the chats finish';
}

export interface UpdateView {
  stage: UpdateDialogStage;
  title: string;
  detail?: string;
  changes: string[];
  /** Release notes to draw (`ReleaseNotes`), from the status. */
  releases: UpdatesStatus['conch']['releases'];
  more: number;
  progress?: UpdateDialogProgress;
  footnote?: string;
  notice?: { tone: 'warning' | 'danger'; message: string; command?: string };
  /** Armed: it updates by itself once the work that's running has finished. */
  waiting?: string;
  /** The buttons, the main one last. */
  offers: UpdateOffer[];
  download?: string;
}

/** A try that ended this recently is still worth telling in the dialog. */
const RECENT_MS = 15 * 60_000;

/**
 * The update dialog, from where things stand. `arrived`: the page just came
 * back on the new version. A try that didn't work, lately, is told first.
 */
export function updateView(
  status: UpdatesStatus,
  { arrived = false, now = Date.now() }: { arrived?: boolean; now?: number } = {},
): UpdateView {
  const conch = status.conch;
  const restartable = status.restartable;
  const releases = conch.source === 'releases';
  const outcome = conch.outcome;
  const base = { changes: conch.whatsNew, releases: [], more: 0 };

  if (conch.running) {
    const { phase, label, step, steps } = conch.running;
    if (phase === 'restart')
      return {
        ...base,
        stage: 'restarting',
        title: 'Starting the new Conch',
        detail: 'A few seconds. Your chats are safe.',
        offers: [],
      };
    const back = phase === 'rollback';
    return {
      ...base,
      stage: 'updating',
      title: back ? 'Going back to the version you had' : 'Updating Conch',
      progress: {
        label: back ? 'The update didn’t work. Nothing of yours changes.' : label,
        value: overall(conch.running),
        ...(!back && { step, steps }),
      },
      footnote: restartable
        ? 'You can close this and keep working. Conch restarts by itself when it’s ready.'
        : 'You can close this and keep working. You’ll restart Conch when it’s ready.',
      offers: ['later'],
    };
  }

  // How the last try ended, while it's news.
  if (outcome && (arrived || now - outcome.at < RECENT_MS)) {
    if (outcome.kind === 'failed' || outcome.kind === 'rolled-back')
      return {
        ...base,
        changes: [],
        stage: 'failed',
        title: outcome.kind === 'rolled-back' ? 'The update didn’t finish' : 'Conch didn’t update',
        detail: 'Nothing of yours changed.',
        notice: {
          tone: outcome.kind === 'failed' ? 'danger' : 'warning',
          message: outcome.message,
          ...(outcome.command && { command: outcome.command }),
        },
        offers: conchWaiting(conch) ? ['close', 'retry'] : ['close'],
      };
    if (arrived && outcome.kind === 'updated') {
      const count = outcome.whatsNew.length;
      // Where it is now, the way it's known: a release by its number, a branch by its commit.
      const to = releases ? installedLabel(conch) : (conch.commit ?? installedLabel(conch));
      return {
        ...base,
        stage: 'done',
        title: 'You’re on the new Conch',
        detail: [!releases && count ? plural(count, 'improvement') : undefined, `Updated to ${to}`]
          .filter(Boolean)
          .join(META_SEP),
        changes: outcome.whatsNew,
        releases: outcome.releases,
        offers: ['done'],
      };
    }
  }

  if (conch.blocked && !conch.blocked.download && conch.behind > 0)
    return {
      ...base,
      changes: [],
      stage: 'failed',
      title: 'Conch can’t update by itself',
      detail: here(conch),
      notice: {
        tone: 'warning',
        message: conch.blocked.reason,
        ...(conch.blocked.command && { command: conch.blocked.command }),
      },
      offers: ['close'],
    };

  if (conchWaiting(conch)) {
    const listed = conch.whatsNew;
    const download = conch.blocked?.download;
    return {
      ...base,
      stage: 'ready',
      title: conch.latest
        ? `Conch ${short(conch.latest.version)} is ready`
        : conch.improvements > 0
          ? `${plural(conch.improvements, 'improvement')} ${conch.improvements === 1 ? 'is' : 'are'} ready`
          : `${plural(conch.behind, 'small change')} ${conch.behind === 1 ? 'is' : 'are'} ready`,
      detail: here(conch),
      releases: conch.releases,
      more: releases ? 0 : Math.max(0, conch.improvements - listed.length),
      footnote: download
        ? conch.blocked?.reason
        : restartable
          ? 'Keep working while it gets ready. Conch then restarts by itself in a few seconds, and your chats are safe.'
          : 'Keep working while it gets ready, then restart Conch. Your chats are safe.',
      ...(download && { download }),
      // Waiting for the work to finish: said quietly, with a way to stop waiting.
      ...(conch.armed && !download
        ? {
            waiting: waitingText(status.working),
            footnote: undefined,
            offers: ['stop-waiting', 'update'],
          }
        : { offers: ['later', download ? 'download' : 'update'] }),
    };
  }

  if (conch.restartNeeded)
    return {
      ...base,
      stage: 'ready',
      title: 'Restart Conch to finish',
      detail: restartable
        ? 'The update is in. Conch starts on the new version when it restarts.'
        : 'The update is in. Stop Conch and run pnpm start, and it starts on the new version.',
      changes: outcome?.whatsNew ?? [],
      releases: outcome?.releases ?? [],
      offers: restartable ? ['later', 'restart'] : ['close'],
    };

  return {
    ...base,
    changes: [],
    stage: 'ready',
    title: 'Conch is up to date',
    detail: here(conch),
    offers: ['close'],
  };
}

/** The installed build, with a target commit only while a branch update waits. */
function here(conch: ConchUpdate): string {
  return `You have ${installedLabel(conch)}${conch.source === 'branch' && conch.target && conch.behind > 0 ? ` → ${conch.target}` : ''}`;
}
