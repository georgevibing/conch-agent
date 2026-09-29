import { Check, ChevronDown, Globe, PanelRight, X } from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { HoverCard } from '../../components/HoverCard';
import { cx } from '../../utils/cx';
import styles from './Browser.module.css';

export interface BrowserTrailStep {
  id: string;
  status: 'running' | 'done' | 'error';
  /** "Clicked “Sign in”". */
  label: string;
  url: string;
  title?: string;
  /** Thumbnail URL. */
  shot?: string;
  by?: 'agent' | 'user';
}

export interface BrowserTrailProps extends ComponentProps<'div'> {
  steps: BrowserTrailStep[];
  /** Show the browser panel (optionally at a step). */
  onShow?: () => void;
  defaultOpen?: boolean;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** "booking.com", "booking.com and 2 other sites". */
function sitesLabel(steps: BrowserTrailStep[]): string {
  const hosts = [...new Set(steps.map((s) => hostOf(s.url)).filter(Boolean))];
  if (hosts.length === 0) return 'the web';
  if (hosts.length === 1) return hosts[0] ?? '';
  const others = hosts.length - 1;
  return `${hosts.at(-1)} and ${others} other ${others === 1 ? 'site' : 'sites'}`;
}

function Thumb({ step, size = 'sm' }: { step: BrowserTrailStep; size?: 'sm' | 'lg' }) {
  return (
    <span className={styles.thumb} data-size={size} data-status={step.status}>
      {step.shot ? (
        <img src={step.shot} alt="" loading="lazy" draggable={false} />
      ) : (
        <Globe aria-hidden />
      )}
    </span>
  );
}

/**
 * The assistant's browsing in the transcript: a filmstrip of what it saw,
 * growing as it goes, with the step in progress shimmering at the end. Open
 * it for every step; hover a frame to see it bigger.
 */
export function BrowserTrail({
  steps,
  onShow,
  defaultOpen = false,
  className,
  ...props
}: BrowserTrailProps) {
  const [open, setOpen] = useState(defaultOpen);
  const running = steps.some((s) => s.status === 'running');
  const last = steps.at(-1);
  const count = steps.length;
  const title = running
    ? `Browsing ${sitesLabel(steps)}`
    : `Browsed ${sitesLabel(steps)} · ${count} ${count === 1 ? 'step' : 'steps'}`;
  const film = steps.filter((s) => s.shot || s.status === 'running').slice(-8);

  return (
    <CollapsiblePrimitive.Root open={open} onOpenChange={setOpen} asChild>
      <div
        className={cx(styles.trail, className)}
        data-running={running ? '' : undefined}
        data-open={open ? '' : undefined}
        {...props}
      >
        <div className={styles.trailHead}>
          <CollapsiblePrimitive.Trigger className={styles.trailToggle} data-lustre="">
            <span className={styles.trailIcon} aria-hidden>
              <Globe />
            </span>
            <span className={styles.trailTitle}>{title}</span>
            <ChevronDown className={styles.trailChevron} aria-hidden />
          </CollapsiblePrimitive.Trigger>
          {onShow && (
            <Button size="sm" variant="ghost" leadingIcon={<PanelRight />} onClick={onShow}>
              {running ? 'Watch' : 'Show browser'}
            </Button>
          )}
        </div>

        {film.length > 0 && (
          <ol className={styles.film} aria-label="What the assistant saw">
            {film.map((step) => (
              <li key={step.id} className={styles.filmFrame}>
                <HoverCard.Root openDelay={250} closeDelay={80}>
                  <HoverCard.Trigger asChild>
                    <button
                      type="button"
                      className={styles.filmButton}
                      aria-label={`${step.label}${step.title ? ` · ${step.title}` : ''}`}
                      onClick={onShow}
                    >
                      <Thumb step={step} />
                    </button>
                  </HoverCard.Trigger>
                  <HoverCard.Content side="top" className={styles.preview}>
                    <Thumb step={step} size="lg" />
                    <span className={styles.previewLabel}>{step.label}</span>
                    {step.url && <span className={styles.previewUrl}>{hostOf(step.url)}</span>}
                  </HoverCard.Content>
                </HoverCard.Root>
              </li>
            ))}
          </ol>
        )}

        {!open && last && (
          <p className={styles.trailNow} data-status={last.status} aria-live="polite">
            {last.label}
          </p>
        )}

        <CollapsiblePrimitive.Content className={styles.trailBody}>
          <ol className={styles.steps}>
            {steps.map((step) => (
              <li key={step.id} className={styles.step} data-status={step.status}>
                <span className={styles.stepGlyph} aria-hidden>
                  {step.status === 'done' ? <Check /> : step.status === 'error' ? <X /> : <i />}
                </span>
                <span className={styles.stepLabel}>{step.label}</span>
                <span className={styles.stepHost}>
                  {step.by === 'user' ? 'You' : hostOf(step.url)}
                </span>
              </li>
            ))}
          </ol>
        </CollapsiblePrimitive.Content>
      </div>
    </CollapsiblePrimitive.Root>
  );
}
