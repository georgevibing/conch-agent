import { Check, MonitorUp, MousePointerClick, Square } from 'lucide-react';
import { useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import styles from './ComputerUse.module.css';

// ── The live card ──────────────────────────────────────────────────────────

export interface ComputerUseLiveProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** What it's doing right now: "Clicking in Notes". */
  label: string;
  /** Steps taken this turn, and how many it may take. */
  steps: number;
  maxSteps: number;
  /** The latest look at the screen (an image address), while the turn lasts. */
  shot?: string;
  /** The keys that stop it, when the desktop app listens for them: `⌘⎋`. */
  stopKeys?: string;
  onStop: () => void;
  /** Stop was pressed and the turn is winding down. */
  stopping?: boolean;
  /** Its name in the title: "Conch is using your computer". */
  name?: string;
}

/**
 * The chat's card while the assistant uses the person's computer (ADR 0110):
 * the latest look at the screen inside the same slowly turning pearl edge the
 * desktop app draws around the real screen, what it's doing in a few words,
 * how far along it is, and one big Stop. The edge never encodes anything on
 * its own: the words say it. Reduced motion holds the edge still.
 */
export function ComputerUseLive({
  label,
  steps,
  maxSteps,
  shot,
  stopKeys,
  onStop,
  stopping = false,
  name = 'Conch',
  className,
  ...props
}: ComputerUseLiveProps) {
  const [broken, setBroken] = useState<string>();
  const picture = shot && shot !== broken ? shot : undefined;
  return (
    <section
      className={cx(styles.live, className)}
      aria-label={`${name} is using your computer`}
      data-stopping={stopping || undefined}
      {...props}
    >
      <div className={styles.screen}>
        <span className={styles.edge} aria-hidden />
        {picture ? (
          <img
            className={styles.shot}
            src={picture}
            alt={`The screen as ${name} last saw it`}
            onError={() => setBroken(picture)}
          />
        ) : (
          <span className={styles.blank} aria-hidden>
            <MonitorUp />
          </span>
        )}
      </div>
      <div className={styles.liveBody}>
        <Pearl state={stopping ? 'idle' : 'streaming'} size="sm" label={null} />
        <div className={styles.liveWords}>
          <p className={styles.liveTitle}>{name} is using your computer</p>
          <p className={styles.liveLabel} aria-live="polite">
            {stopping ? 'Letting go…' : label}
          </p>
          <p className={styles.liveSteps}>
            Step {Math.min(steps, maxSteps)} of {maxSteps}
          </p>
        </div>
        <Button
          tone="danger"
          size="lg"
          onClick={onStop}
          loading={stopping}
          leadingIcon={<Square />}
          trailing={stopKeys ? <kbd className={styles.keys}>{stopKeys}</kbd> : undefined}
          aria-keyshortcuts={stopKeys ? 'Meta+Escape' : undefined}
        >
          Stop
        </Button>
      </div>
    </section>
  );
}

// ── The two macOS switches ─────────────────────────────────────────────────

export type ComputerUseAccessState = 'granted' | 'missing' | 'unknown';

export interface ComputerUseAccessProps extends ComponentProps<'ul'> {
  screen: ComputerUseAccessState;
  control: ComputerUseAccessState;
  /** The app macOS lists the switches under: "Conch", "Terminal". */
  grantTo: string;
  /** This page is on the computer itself, so it can open System Settings there. */
  here: boolean;
  onOpen: (kind: 'screen' | 'control') => void;
  /** The switch whose page is opening. */
  opening?: 'screen' | 'control';
}

const ACCESS: Record<'screen' | 'control', { title: string; place: string; icon: ReactNode }> = {
  screen: { title: 'See the screen', place: 'Screen Recording', icon: <MonitorUp /> },
  control: { title: 'Click and type', place: 'Accessibility', icon: <MousePointerClick /> },
};

/** A switch that just turned on gets a moment's glint, once (read while drawing, not after). */
function useJustGranted(state: ComputerUseAccessState): boolean {
  const [seen, setSeen] = useState(state);
  const [glint, setGlint] = useState(false);
  if (seen !== state) {
    setSeen(state);
    setGlint(seen !== 'granted' && state === 'granted');
  }
  return glint;
}

function AccessRow({
  kind,
  state,
  grantTo,
  here,
  onOpen,
  opening,
}: {
  kind: 'screen' | 'control';
  state: ComputerUseAccessState;
  grantTo: string;
  here: boolean;
  onOpen: (kind: 'screen' | 'control') => void;
  opening: boolean;
}) {
  const { title, place, icon } = ACCESS[kind];
  const glint = useJustGranted(state);
  const granted = state === 'granted';
  return (
    <li className={styles.row} data-state={state} data-glint={glint || undefined}>
      <span className={styles.rowIcon} aria-hidden>
        {granted ? <Check /> : icon}
      </span>
      <span className={styles.rowWords}>
        <span className={styles.rowTitle}>{title}</span>
        <span className={styles.rowDetail}>
          {granted
            ? `${place} is on for ${grantTo}.`
            : state === 'unknown'
              ? `Conch couldn’t check ${place} just now.`
              : here
                ? `Turn on ${grantTo} in ${place}.`
                : `On the computer itself, turn on ${grantTo} in ${place}.`}
        </span>
      </span>
      {!granted && here && (
        <Button size="sm" variant="surface" onClick={() => onOpen(kind)} loading={opening}>
          Open {place}
        </Button>
      )}
      {granted && <span className={styles.rowOn}>On</span>}
    </li>
  );
}

/**
 * The two switches macOS keeps for itself, as one short checklist: what each
 * lets Conch do in plain words, and one press that opens the right page of
 * System Settings with Conch already on its list. When a switch turns on the
 * row says so with a moment's glint; nobody has to come back and press
 * anything.
 */
export function ComputerUseAccess({
  screen,
  control,
  grantTo,
  here,
  onOpen,
  opening,
  className,
  ...props
}: ComputerUseAccessProps) {
  return (
    <ul className={cx(styles.access, className)} aria-label="What macOS lets Conch do" {...props}>
      <AccessRow
        kind="screen"
        state={screen}
        grantTo={grantTo}
        here={here}
        onOpen={onOpen}
        opening={opening === 'screen'}
      />
      <AccessRow
        kind="control"
        state={control}
        grantTo={grantTo}
        here={here}
        onOpen={onOpen}
        opening={opening === 'control'}
      />
    </ul>
  );
}
