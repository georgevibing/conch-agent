import type { ComponentProps, ReactNode } from 'react';

import { RadioGroup } from '../../components/RadioGroup';
import { cx } from '../../utils/cx';
import styles from './Releases.module.css';

export type ReleaseChannelValue = 'stable' | 'beta' | 'alpha';

export const RELEASE_CHANNELS: {
  value: ReleaseChannelValue;
  label: string;
  description: string;
}[] = [
  { value: 'stable', label: 'Stable', description: 'Tested releases. Recommended.' },
  { value: 'beta', label: 'Beta', description: 'New things a little early. Mostly finished.' },
  {
    value: 'alpha',
    label: 'Alpha',
    description: 'The newest work, as soon as it’s tagged. Expect rough edges.',
  },
];

export interface ReleaseChannelPickerProps extends Omit<
  ComponentProps<'div'>,
  'onChange' | 'defaultValue'
> {
  value: ReleaseChannelValue;
  onValueChange: (value: ReleaseChannelValue) => void;
  /** "Which releases Conch gets" */
  label?: string;
  /** A sentence under the choices: going back to stable waits for its next release. */
  note?: ReactNode;
  disabled?: boolean;
}

/**
 * Which releases Conch follows, in plain words: Stable (the default), Beta
 * or Alpha, each with one sentence about what it means. Arrow keys move
 * between them.
 */
export function ReleaseChannelPicker({
  value,
  onValueChange,
  label = 'Which releases Conch gets',
  note,
  disabled,
  className,
  ...props
}: ReleaseChannelPickerProps) {
  return (
    <div className={cx(styles.channels, className)} {...props}>
      <RadioGroup
        variant="card"
        aria-label={label}
        value={value}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as ReleaseChannelValue)}
        className={styles.channelGroup}
      >
        {RELEASE_CHANNELS.map((channel) => (
          <RadioGroup.Item
            key={channel.value}
            value={channel.value}
            label={channel.label}
            description={channel.description}
          />
        ))}
      </RadioGroup>
      {note && <p className={styles.channelNote}>{note}</p>}
    </div>
  );
}
