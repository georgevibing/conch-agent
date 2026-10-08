import { useState, type CSSProperties, type ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './Knowledge.module.css';
import type { CardPicture } from './shared';

export interface PictureProps {
  picture: CardPicture | undefined;
  className?: string;
  style?: CSSProperties;
  /** What shows while it loads, or instead when it can't. */
  fallback?: ReactNode;
}

/**
 * A picture that fades in once it has loaded, and gives way to its fallback
 * if it never does. Decorative: what it shows is said by the card's words.
 */
export function Picture({ picture, className, style, fallback }: PictureProps) {
  const [state, setState] = useState<'loading' | 'loaded' | 'broken'>('loading');
  const shown = picture && state !== 'broken';
  return (
    <span className={cx(styles.picture, className)} style={style} data-state={state}>
      {(!shown || state === 'loading') && fallback}
      {shown && (
        <img
          src={picture.src}
          alt=""
          width={picture.width}
          height={picture.height}
          decoding="async"
          loading="lazy"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('broken')}
        />
      )}
    </span>
  );
}
