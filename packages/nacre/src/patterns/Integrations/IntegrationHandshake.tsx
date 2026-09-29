import { Check, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Pearl } from '../../components/Pearl';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from './IntegrationLogo';
import styles from './IntegrationHandshake.module.css';

export type HandshakePhase = 'idle' | 'waiting' | 'connected' | 'failed';

export interface IntegrationHandshakeProps extends Omit<ComponentProps<'div'>, 'children'> {
  name: string;
  brand?: string;
  color?: string;
  phase?: HandshakePhase;
}

const phaseLabel: Record<HandshakePhase, string> = {
  idle: '',
  waiting: 'Connecting…',
  connected: 'Connected',
  failed: 'Couldn’t connect',
};

/**
 * Conch and the app, side by side, with the link between them telling the
 * story: light travels along it while you sign in, it closes with a check
 * when you're connected, and it breaks apart when something went wrong.
 */
export function IntegrationHandshake({
  name,
  brand,
  color,
  phase = 'idle',
  className,
  ...props
}: IntegrationHandshakeProps) {
  return (
    <div data-phase={phase} className={cx(styles.root, className)} {...props}>
      <span className={styles.side}>
        <Pearl size="lg" state={phase === 'waiting' ? 'thinking' : 'idle'} label={null} />
      </span>
      <span className={styles.link} aria-hidden>
        <span className={styles.track} />
        <span className={styles.flow} />
        <span className={styles.knot}>
          {phase === 'connected' && <Check />}
          {phase === 'failed' && <X />}
        </span>
      </span>
      <span className={styles.side}>
        <IntegrationLogo brand={brand} name={name} color={color} size="xl" decorative />
      </span>
      <span className="nc-visually-hidden" role="status">
        {phase === 'idle' ? '' : `${name}: ${phaseLabel[phase]}`}
      </span>
    </div>
  );
}
