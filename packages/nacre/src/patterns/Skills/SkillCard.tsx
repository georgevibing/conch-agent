import { CircleAlert, Hand, Sparkles } from 'lucide-react';
import { useId, type ComponentProps } from 'react';

import { Highlight, type HighlightRange } from '../../components/Highlight';
import { LiveTitle } from '../../components/LiveTitle';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { SkillIcon } from './SkillIcon';
import styles from './Skills.module.css';

export type SkillMode = 'auto' | 'manual' | 'off';

export const skillModeLabels: Record<SkillMode, { label: string; description: string }> = {
  auto: {
    label: 'Automatically',
    description: 'Used whenever a request fits, or when you ask for it.',
  },
  manual: { label: 'When I ask', description: 'Only when you ask for it by name.' },
  off: { label: 'Off', description: 'Never used.' },
};

export interface SkillCardProps extends Omit<ComponentProps<'article'>, 'title' | 'onToggle'> {
  title: string;
  description: string;
  /** The skill's name — its folder and its slash command. */
  name: string;
  mode: SkillMode;
  /** Where it lives, when it isn't Conch's own ("OpenClaw", "Hermes"). */
  source?: string;
  /** A provider that reads this skill by itself ("Claude Code"). */
  loadedBy?: string;
  /** Why it can't be used, in plain words. */
  problem?: string;
  /** Title and description are still being written. */
  pending?: boolean;
  /** Parts of the title to mark (a search match). */
  highlight?: readonly HighlightRange[];
  /** `list` for the Skills page; `preview` shows how a skill being written will look. */
  variant?: 'list' | 'preview';
  onOpen?: () => void;
  /** The quick switch: on means it can be used (keeping "When I ask" if that's the mode). */
  onToggle?: (on: boolean) => void;
}

/**
 * A skill at a glance: its tile, its title, what it's for, how to ask for it,
 * and whether it's on. The whole card opens it; the switch turns it on or off
 * without leaving the list.
 */
export function SkillCard({
  title,
  description,
  name,
  mode,
  source,
  loadedBy,
  problem,
  pending = false,
  highlight,
  variant = 'list',
  onOpen,
  onToggle,
  className,
  ...props
}: SkillCardProps) {
  const titleId = useId();
  const off = mode === 'off' || Boolean(problem);
  const heading =
    variant === 'preview' || pending ? (
      <LiveTitle pending={pending}>{title}</LiveTitle>
    ) : highlight?.length ? (
      <Highlight text={title} ranges={highlight} />
    ) : (
      title
    );

  return (
    <article
      aria-labelledby={titleId}
      data-variant={variant}
      data-mode={mode}
      data-off={off || undefined}
      data-lustre=""
      className={cx(styles.card, className)}
      {...props}
    >
      <SkillIcon name={name} title={title} muted={off && variant === 'list'} />
      <div className={styles.text}>
        <h3 className={styles.title}>
          {onOpen && variant === 'list' ? (
            <button type="button" id={titleId} className={styles.open} onClick={onOpen}>
              {heading}
            </button>
          ) : (
            <span id={titleId}>{heading}</span>
          )}
        </h3>
        <p className={styles.description} data-pending={pending || undefined}>
          {pending ? (
            <LiveTitle pending className={styles.descriptionLive}>
              {description || 'Writing a description…'}
            </LiveTitle>
          ) : (
            description
          )}
        </p>
        <p className={styles.meta}>
          <code className={styles.command}>/{name}</code>
          {variant === 'list' && (
            <span className={styles.mode} data-mode={mode}>
              {mode === 'auto' ? (
                <Sparkles aria-hidden />
              ) : mode === 'manual' ? (
                <Hand aria-hidden />
              ) : null}
              {skillModeLabels[mode].label}
            </span>
          )}
          {source && <span className={styles.source}>{source}</span>}
          {loadedBy && variant === 'list' && (
            <span className={styles.dim}>From {loadedBy}, which also reads it itself</span>
          )}
        </p>
        {problem && (
          <p className={styles.problem}>
            <CircleAlert aria-hidden />
            {problem}
          </p>
        )}
      </div>
      {onToggle && variant === 'list' && !problem && (
        <Switch
          size="sm"
          className={styles.toggle}
          checked={mode !== 'off'}
          onCheckedChange={onToggle}
          aria-label={mode === 'off' ? `Turn on ${title}` : `Turn off ${title}`}
        />
      )}
    </article>
  );
}
