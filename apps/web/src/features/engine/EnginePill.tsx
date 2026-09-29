import { Badge, Button, Popover, Stack, Text } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { RotateCw, Settings2 } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../api/client';
import { setEngineStatus, useAppState } from '../../api/queries';
import { useUi } from '../../app/ui';
import styles from './EnginePill.module.css';

/** Tiny status indicator in the header; click for details and fixes. */
export function EnginePill() {
  const { data } = useAppState();
  const client = useQueryClient();
  const openSettings = useUi((s) => s.openSettings);
  const [checking, setChecking] = useState(false);
  const status = data?.engine;
  if (!status) return null;

  const tone =
    status.state === 'ready' ? 'success' : status.state === 'signed-out' ? 'warning' : 'danger';
  const label =
    status.state === 'ready'
      ? status.label
      : status.state === 'signed-out'
        ? 'Sign in needed'
        : status.state === 'not-installed'
          ? 'Not installed'
          : 'Unavailable';

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label={`${status.label}: ${label}`}>
          <Badge tone={tone} variant="soft" dot={status.state === 'ready' ? true : 'pulse'}>
            {label}
          </Badge>
        </button>
      </Popover.Trigger>
      <Popover.Content align="end" aria-label="Claude Code status" className={styles.content}>
        <Stack gap={3}>
          <Stack gap={0.5}>
            <Text weight="semibold">{status.label}</Text>
            <Text size="sm" tone="muted">
              {status.state === 'ready'
                ? (status.auth?.description ?? 'Connected')
                : status.state === 'signed-out'
                  ? 'Installed, but not signed in.'
                  : status.state === 'not-installed'
                    ? 'Not found on this computer.'
                    : (status.message ?? 'Not responding.')}
            </Text>
            {status.version && (
              <Text size="xs" tone="subtle">
                Version {status.version}
              </Text>
            )}
          </Stack>
          <Stack direction="row" gap={2}>
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<RotateCw />}
              loading={checking}
              onClick={async () => {
                setChecking(true);
                try {
                  setEngineStatus(client, await api.engine(true));
                } finally {
                  setChecking(false);
                }
              }}
            >
              Check again
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leadingIcon={<Settings2 />}
              onClick={() => openSettings('engine')}
            >
              Settings
            </Button>
          </Stack>
        </Stack>
      </Popover.Content>
    </Popover.Root>
  );
}
