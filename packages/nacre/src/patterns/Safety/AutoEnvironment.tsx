import type { ComponentProps, ReactNode } from 'react';

import { Field } from '../../components/Field';
import { Textarea } from '../../components/Textarea';
import { cx } from '../../utils/cx';
import styles from './AutoLearned.module.css';

/** The most a note may say, as `preferences.autoEnvironment` keeps it (ADR 0149). */
export const AUTO_ENVIRONMENT_MAX = 2000;

export interface AutoEnvironmentProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  /** A quiet word beside the label while it saves: "Saving…", "Saved". */
  status?: ReactNode;
  disabled?: boolean;
}

/**
 * What Auto should know about where you work (ADR 0149): hosts you trust, your
 * remotes and buckets, what production means here. A person's own note, in
 * their words: Auto's review reads it before a question reaches them. Calm,
 * like any setting: one field, and a count only when it's nearly full.
 */
export function AutoEnvironment({
  value,
  onChange,
  status,
  disabled,
  className,
  ...props
}: AutoEnvironmentProps) {
  const near = value.length >= AUTO_ENVIRONMENT_MAX * 0.8;
  return (
    <div className={cx(styles.environment, className)} {...props}>
      <Field disabled={disabled}>
        <div className={styles.labelRow}>
          <Field.Label>What Auto should know about where you work</Field.Label>
          {status}
        </div>
        <Field.Description>
          Hosts you trust, your remotes and buckets, and what production means here. Auto reads it
          before it asks you. Only you can change it.
        </Field.Description>
        <Textarea
          autosize
          minRows={3}
          maxRows={10}
          maxLength={AUTO_ENVIRONMENT_MAX}
          value={value}
          placeholder="Our GitHub org is acme. staging.acme.dev and the acme-scratch bucket are ours to change. Production is the prod AWS account."
          onChange={(e) => onChange(e.target.value)}
          footer={
            near ? (
              <span className={styles.count} aria-live="polite">
                {value.length.toLocaleString('en-US')} of{' '}
                {AUTO_ENVIRONMENT_MAX.toLocaleString('en-US')}
              </span>
            ) : undefined
          }
        />
      </Field>
    </div>
  );
}
