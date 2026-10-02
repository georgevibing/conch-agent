import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Reveal } from './Reveal';
import styles from './Scene.module.css';

export interface SceneProps extends Omit<ComponentProps<'section'>, 'title'> {
  /** One or two words above the title: what this is about. */
  kicker?: ReactNode;
  /** The claim, in the display serif. Wrap the turn of it in `<em>`. */
  title: ReactNode;
  /** The picture that proves it, usually a `Stage`. */
  stage?: ReactNode;
  /** Put the picture first on wide screens. Alternate it down a page. */
  flip?: boolean;
  /** Short facts under the words, each a line. */
  points?: ReactNode[];
  /** The way onward, after everything else: a link to the whole story. */
  action?: ReactNode;
}

/**
 * One claim and the picture that proves it, side by side when there's room and
 * stacked when there isn't (the words first, always). The parts surface as the
 * scene scrolls into view, once.
 */
export function Scene({
  kicker,
  title,
  stage,
  flip,
  points,
  action,
  className,
  children,
  ...props
}: SceneProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx(styles.scene, className)} {...props}>
      <div className={styles.layout} data-flip={flip || undefined}>
        <Reveal className={styles.words}>
          {kicker != null && <p className={styles.kicker}>{kicker}</p>}
          <h2 id={id} className={styles.title}>
            {title}
          </h2>
          {children != null && <div className={styles.body}>{children}</div>}
          {points != null && points.length > 0 && (
            <ul className={styles.points}>
              {points.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}
          {action}
        </Reveal>
        {stage != null && (
          <Reveal index={1} className={styles.stage}>
            {stage}
          </Reveal>
        )}
      </div>
    </section>
  );
}
