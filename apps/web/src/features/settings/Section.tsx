import { Heading, Stack, Text } from '@conch/nacre';
import type { ReactNode } from 'react';

import styles from './Settings.module.css';
import type { useAutosave } from './useAutosave';

export function SaveStatus({ status }: { status: ReturnType<typeof useAutosave> }) {
  return (
    <Text
      as="span"
      size="xs"
      tone="subtle"
      className={styles.saved}
      data-status={status}
      aria-live="polite"
    >
      {status === 'saving'
        ? 'Saving…'
        : status === 'saved'
          ? 'Saved'
          : status === 'error'
            ? 'Couldn’t save'
            : ''}
    </Text>
  );
}

export function Section({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description?: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <Stack gap={0.5}>
          <Heading level={3} size="lg">
            {title}
          </Heading>
          {description && (
            <Text size="sm" tone="muted">
              {description}
            </Text>
          )}
        </Stack>
        {status}
      </div>
      {children}
    </section>
  );
}
