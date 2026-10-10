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
  /** None, for a copy that follows every change and hasn't chosen releases yet. */
  value?: ReleaseChannelValue;
  onValueChange: (value: ReleaseChannelValue) => void;
  /** The channels with a release to follow; the others can't be chosen yet. All, when not given. */
  available?: readonly ReleaseChannelValue[];
  /** "Which releases Conch gets" */
  label?: string;
  /** A sentence under the choices: going back to stable waits for its next release. */
  note?: ReactNode;
  disabled?: boolean;
}

/**
 * Which releases Conch follows, in plain words: Stable (the default), Beta
 * or Alpha, each with one sentence about what it means. A channel with no
 * release yet says so, and can't be chosen. Arrow keys move between them.
 */
export function ReleaseChannelPicker({
  value,
  onValueChange,
  label = 'Which releases Conch gets',
  note,
  disabled,
  available,
  className,
  ...props
}: ReleaseChannelPickerProps) {
  return (
    <div className={cx(styles.channels, className)} {...props}>
      <RadioGroup
        variant="card"
        aria-label={label}
        value={value ?? ''}
        disabled={disabled}
        onValueChange={(next) => onValueChange(next as ReleaseChannelValue)}
        className={styles.channelGroup}
      >
        {RELEASE_CHANNELS.map((channel) => {
          const none = available !== undefined && !available.includes(channel.value);
          return (
            <RadioGroup.Item
              key={channel.value}
              value={channel.value}
              label={channel.label}
              description={none ? `${channel.description} None yet.` : channel.description}
              disabled={none}
            />
          );
        })}
      </RadioGroup>
      {note && <p className={styles.channelNote}>{note}</p>}
    </div>
  );
}
