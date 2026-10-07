import { ChevronRight, Layers } from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { useState, type ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import { stepsLabel } from './format';
import { Story, type StoryProps } from './Story';
import styles from './StoryStack.module.css';

export interface StoryStackItem extends StoryProps {
  /** Stable key: the story's first tool call, which never changes. */
  id: string;
}

export interface StoryStackProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The run's stories, oldest first. */
  stories: StoryStackItem[];
  /**
   * More stories than this and the earlier ones fold into one line ("3
   * earlier steps") that opens to them, leaving the latest few in view.
   * Default 4.
   */
  max?: number;
  /** Start with the earlier stories shown. */
  defaultShowEarlier?: boolean;
  /** Given to every story that doesn't bring its own. */
  renderRaw?: StoryProps['renderRaw'];
  renderFound?: StoryProps['renderFound'];
  onExplain?: StoryProps['onExplain'];
  /** The run is arriving live (see `Story`'s `arriving`). */
  arriving?: boolean;
}

/**
 * One run's stories, in a tight column. A long run keeps its latest few in
 * view and folds the rest into a quiet line with their glyphs, which opens
 * to them. Pass the stories as data; anything a `Story` takes, each can carry.
 */
export function StoryStack({
  stories,
  max = 4,
  defaultShowEarlier = false,
  renderRaw,
  renderFound,
  onExplain,
  arriving,
  className,
  ...props
}: StoryStackProps) {
  const [showEarlier, setShowEarlier] = useState(defaultShowEarlier);
  // Folding one story to save one line isn't worth a line: fold to leave max - 1 in view.
  const folded = stories.length > max ? stories.length - (max - 1) : 0;
  const earlier = stories.slice(0, folded);
  const latest = stories.slice(folded);

  const draw = ({ id, ...story }: StoryStackItem) => (
    <Story
      key={id}
      renderRaw={renderRaw}
      renderFound={renderFound}
      onExplain={onExplain}
      arriving={arriving}
      {...story}
    />
  );

  const failed = earlier.filter((s) => s.status === 'failed').length;

  return (
    <div className={cx(styles.stack, className)} {...props}>
      {folded > 0 && (
        <Collapsible.Root open={showEarlier} onOpenChange={setShowEarlier} asChild>
          <div className={styles.earlier}>
            <Collapsible.Trigger className={styles.fold}>
              <span className={styles.fwell} aria-hidden>
                <Layers />
              </span>
              <span className={styles.foldText}>
                {folded} earlier {folded === 1 ? 'step' : 'steps'}
                {failed > 0 && <span className={styles.foldNote}> · {failed} didn’t work</span>}
              </span>
              <span className="nc-visually-hidden">
                , {stepsLabel(earlier.reduce((n, s) => n + s.steps.length, 0))} in all
              </span>
              <ChevronRight className={styles.chevron} aria-hidden />
            </Collapsible.Trigger>
            <Collapsible.Content className={styles.content}>
              <div className={styles.list}>{earlier.map(draw)}</div>
            </Collapsible.Content>
          </div>
        </Collapsible.Root>
      )}
      <div className={styles.list}>{latest.map(draw)}</div>
    </div>
  );
}
