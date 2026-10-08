import { Box, Cloud, Laptop, Server } from 'lucide-react';
import type { ComponentProps } from 'react';

import { cx } from '../../utils/cx';
import styles from './WorkPlaces.module.css';

export type WorkPlaceKind = 'computer' | 'container' | 'ssh' | 'cloud';

/** Each place's mark: this computer, a box, a machine, the cloud. */
export function PlaceGlyph({ kind, className }: { kind: WorkPlaceKind; className?: string }) {
  const Icon =
    kind === 'container' ? Box : kind === 'ssh' ? Server : kind === 'cloud' ? Cloud : Laptop;
  return <Icon aria-hidden className={className} />;
}

export interface WorkedAtProps extends Omit<ComponentProps<'span'>, 'children'> {
  kind: Exclude<WorkPlaceKind, 'computer'>;
  /** A few words: "a container", "build-box", "the cloud". */
  name: string;
}

const SHORT: Record<WorkedAtProps['kind'], (name: string) => string> = {
  container: () => 'container',
  ssh: (name) => name,
  cloud: () => 'cloud',
};

const SAID: Record<WorkedAtProps['kind'], (name: string) => string> = {
  container: () => 'Ran in a container',
  ssh: (name) => `Ran on ${name}`,
  cloud: () => 'Ran in the cloud',
};

/**
 * Where one command ran, on its row, whenever that wasn't this computer
 * (ADR 0106): a small tag with the place's mark. Read in full by screen
 * readers ("Ran in a container"); shown in a word.
 */
export function WorkedAt({ kind, name, className, ...props }: WorkedAtProps) {
  return (
    <span
      {...props}
      className={cx(styles.tag, className)}
      data-kind={kind}
      role="img"
      aria-label={SAID[kind](name)}
      title={SAID[kind](name)}
    >
      <PlaceGlyph kind={kind} className={styles.tagIcon} />
      <span className={styles.tagLabel} aria-hidden>
        {SHORT[kind](name)}
      </span>
    </span>
  );
}
