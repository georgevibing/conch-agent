import type { ComputerUseAccessKind, ComputerUseStatus } from '@conch/protocol';
import {
  ComputerUseAccess,
  IconButton,
  joinMeta,
  Skeleton,
  Stack,
  Switch,
  Text,
} from '@conch/nacre';
import { AppWindowMac, X } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { useAssistantName } from '../integrations/queries';
import { Section } from '../settings/Section';
import styles from './ComputerUse.module.css';
import { computerUseApi, useComputerUse, useComputerUseChange } from './useApps';

/**
 * Settings → This computer → Use your apps (ADR 0110): one switch, the two
 * macOS switches one press each, and what it never touches. Nothing else to
 * set: each app asks once per chat, and Stop is always one press away.
 */
export function ComputerUseSection() {
  const name = useAssistantName();
  const { data: status } = useComputerUse();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const toggle = useComputerUseChange(
    (enabled: boolean) => computerUseApi.setEnabled(enabled),
    'Couldn’t change that',
  );
  const forget = useComputerUseChange(
    (id: string) => computerUseApi.forget(id),
    'Couldn’t remove that app',
  );
  const open = useComputerUseChange(
    (kind: ComputerUseAccessKind) => computerUseApi.openAccess(kind),
    'Couldn’t open System Settings',
  );
  const [opening, setOpening] = useState<ComputerUseAccessKind>();

  return (
    <Section
      title="Use your apps"
      description={`${name} can look at the screen and click and type in the apps you let it, while you watch. Off until you turn it on.`}
    >
      {!status ? (
        <Skeleton height={56} />
      ) : status.platform !== 'mac' ? (
        <Text size="sm" tone="muted">
          On a Mac for now. Windows and Linux are next.
        </Text>
      ) : (
        <ComputerUseSettings
          status={status}
          name={name}
          opening={opening}
          onToggle={(enabled) =>
            enabled
              ? void guard(async () => {
                  await toggle.mutateAsync(true);
                })
              : toggle.mutate(false)
          }
          onOpen={(kind) => {
            setOpening(kind);
            open.mutate(kind, { onSettled: () => setOpening(undefined) });
          }}
          onForget={(id) => forget.mutate(id)}
        />
      )}
      {dialog}
    </Section>
  );
}

export function ComputerUseSettings({
  status,
  name,
  opening,
  onToggle,
  onOpen,
  onForget,
}: {
  status: ComputerUseStatus;
  name: string;
  opening?: ComputerUseAccessKind;
  onToggle: (enabled: boolean) => void;
  onOpen: (kind: ComputerUseAccessKind) => void;
  onForget: (id: string) => void;
}) {
  return (
    <Stack gap={4}>
      <Switch
        checked={status.enabled}
        onCheckedChange={onToggle}
        label={`Let ${name} use your apps`}
        description={
          status.overlay === 'app'
            ? `A glowing edge shows while it does. Press ${status.stopKeys ?? 'Stop'} or Stop on it to take back control.`
            : 'Stop in the chat takes back control. The Conch app adds a glowing edge and a key to stop it from anywhere.'
        }
      />
      {status.enabled && (
        <ComputerUseAccess
          screen={status.access.screen}
          control={status.access.control}
          grantTo={status.grantTo}
          here={status.here}
          onOpen={onOpen}
          opening={opening}
        />
      )}
      <Text size="sm" tone="subtle">
        Each app asks once per chat. Always kept away: {joinMeta(status.keptAway)}.
      </Text>
      {status.apps.length > 0 && (
        <ul className={styles.apps} aria-label="Apps you always allow">
          {status.apps.map((app) => (
            <li key={app.id} className={styles.app}>
              <AppWindowMac aria-hidden className={styles.appIcon} />
              <span className={styles.appName}>{app.name}</span>
              <Text as="span" size="xs" tone="subtle">
                Always allowed
              </Text>
              <IconButton
                size="sm"
                label={`Stop always allowing ${app.name}`}
                onClick={() => onForget(app.id)}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </Stack>
  );
}
