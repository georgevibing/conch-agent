import type { TerminalStatus, UpdateTerminalSettingsBody } from '@conch/protocol';
import {
  Callout,
  Field,
  SegmentedControl,
  Select,
  SettingsAdvanced,
  Skeleton,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { useAdvanced } from '../settings/useAdvanced';
import { terminalApi } from './api';
import { terminalKeys, useTerminalStatus } from './queries';

const SIZES = [
  { value: '12', label: 'Small' },
  { value: '13', label: 'Medium' },
  { value: '15', label: 'Large' },
  { value: '17', label: 'Larger' },
];

/** Settings › Terminal: whether you can open one, how big its text is, and, under Advanced, the rest. */
export function TerminalSettings() {
  const { data: status, isPending } = useTerminalStatus();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [advanced, setAdvanced] = useAdvanced();

  if (isPending || !status) {
    return (
      <Stack gap={4}>
        <Skeleton height={80} />
        <Skeleton height={160} />
      </Stack>
    );
  }
  const { settings } = status;
  const save = (patch: UpdateTerminalSettingsBody) =>
    void guard(async () => {
      client.setQueryData<TerminalStatus>(
        terminalKeys.status,
        await terminalApi.updateSettings(patch),
      );
    }).catch((error: unknown) =>
      toast.error('Couldn’t save that', {
        description: error instanceof Error ? error.message : undefined,
      }),
    );
  const usual = status.shells[0];
  const running = status.terminals.filter((t) => t.status === 'running').length;

  return (
    <Stack gap={8}>
      <Section
        title="Terminal"
        description="Real shells on this computer, a keystroke away (Ctrl+`)."
      >
        <Stack gap={4}>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(enabled) => save({ enabled })}
            label="Let me open terminals in Conch"
            description={
              running
                ? `${running} ${running === 1 ? 'terminal is' : 'terminals are'} open. Turning this off ends them.`
                : undefined
            }
          />
          <Field>
            <Field.Label>Text size</Field.Label>
            <SegmentedControl
              value={String(settings.fontSize)}
              onValueChange={(v) => v && save({ fontSize: Number(v) })}
              aria-label="Text size"
            >
              {SIZES.map((size) => (
                <SegmentedControl.Item key={size.value} value={size.value}>
                  {size.label}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
          </Field>
        </Stack>
      </Section>

      <SettingsAdvanced open={advanced} onOpenChange={setAdvanced}>
        <Section title="How it looks and works">
          <Stack gap={4}>
            {status.shells.length > 1 && (
              <Field>
                <Field.Label>Shell</Field.Label>
                <Select
                  value={settings.shell}
                  onValueChange={(shell) => save({ shell })}
                  aria-label="Shell"
                >
                  <Select.Item value="auto">
                    Your usual{usual ? ` (${usual.name})` : ''}
                  </Select.Item>
                  {status.shells.map((shell) => (
                    <Select.Item key={shell.id} value={shell.id}>
                      {shell.name}
                    </Select.Item>
                  ))}
                </Select>
              </Field>
            )}
            <Switch
              checked={settings.cursorBlink}
              onCheckedChange={(cursorBlink) => save({ cursorBlink })}
              label="Blinking cursor"
            />
            <Switch
              checked={settings.screenReader}
              onCheckedChange={(screenReader) => save({ screenReader })}
              label="Screen reader support"
              description="Readable to screen readers, a little slower with lots of output."
            />
          </Stack>
        </Section>

        <Section
          title="From other devices"
          description="Off unless you turn it on: a terminal runs any command as you."
        >
          <Stack gap={3}>
            <Switch
              checked={settings.allowRemote}
              disabled={!settings.enabled}
              onCheckedChange={(allowRemote) => save({ allowRemote })}
              label="Let my signed-in devices open terminals"
              description="They confirm it’s you each time. Signing one out ends its terminals."
            />
            {settings.allowRemote && (
              <Callout tone="warning" title="Other devices can run commands here">
                Anyone who gets into a signed-in device and knows your password could use this
                computer. Turn it off when you don’t need it.
              </Callout>
            )}
            {status.remote && !settings.allowRemote && (
              <Text size="sm" tone="subtle">
                You’re on another device, so terminals won’t open here until this is on.
              </Text>
            )}
          </Stack>
        </Section>

        {status.healed.length > 0 && (
          <Section title="Fixed on its own">
            <Stack gap={1}>
              {status.healed.slice(0, 4).map((note) => (
                <Text key={`${note.at}-${note.message}`} size="sm" tone="muted">
                  {note.message}
                </Text>
              ))}
            </Stack>
          </Section>
        )}
      </SettingsAdvanced>
      {dialog}
    </Stack>
  );
}
