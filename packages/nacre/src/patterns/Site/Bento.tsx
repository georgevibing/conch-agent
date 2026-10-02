import { useId, type ComponentProps, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { Reveal } from './Reveal';
import styles from './Bento.module.css';

export type BentoProps = ComponentProps<'div'>;

/**
 * A grid of tiles of different widths, each one thing the product does with
 * a small picture of it. Six columns when there's room, two on a tablet, one
 * on a phone; a tile's `span` is how many of the six it takes.
 */
function BentoRoot({ className, ...props }: BentoProps) {
  return (
    <div className={cx(styles.frame, className)}>
      <div className={styles.grid} {...props} />
    </div>
  );
}

export interface BentoTileProps extends Omit<ComponentProps<'article'>, 'title'> {
  title: ReactNode;
  /** One or two plain sentences. */
  text?: ReactNode;
  /** How many of the grid's six columns it takes on a wide screen. */
  span?: 2 | 3 | 4 | 6;
  /** Its place in the grid, so tiles surface one after another. */
  index?: number;
  /**
   * What the picture shows, in a sentence. The picture itself (the children)
   * can't be focused and isn't read out.
   */
  picture?: string;
}

function BentoTile({
  title,
  text,
  span = 2,
  index = 0,
  picture,
  className,
  children,
  ...props
}: BentoTileProps) {
  const id = useId();
  return (
    <Reveal asChild index={index % 3}>
      <article
        aria-labelledby={id}
        data-span={span}
        data-lustre=""
        className={cx(styles.tile, className)}
        {...props}
      >
        <div className={styles.words}>
          <h3 id={id} className={styles.title}>
            {title}
          </h3>
          {text != null && <p className={styles.text}>{text}</p>}
        </div>
        {children != null && (
          <figure className={styles.picture} aria-label={picture}>
            <div className={styles.inner} inert aria-hidden>
              {children}
            </div>
          </figure>
        )}
      </article>
    </Reveal>
  );
}

export const Bento = Object.assign(BentoRoot, { Tile: BentoTile });
