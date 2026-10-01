import {
  AlertDialog,
  Callout,
  Collapsible,
  CopyButton,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { ApiError } from '../../api/client';
import { keys, useAppState, useUpdateSettings } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { Section } from '../settings/Section';
import { safetyApi, safetyKeys } from './api';

type Guard = 'checkAfterReading' | 'sealedCommands';

const OFF: Record<Guard, { title: string; detail: string }> = {
  checkAfterReading: {
    title: 'Stop checking after it reads something?',
    detail:
      'A web page, an email or someone else’s message could then tell the assistant to send your things somewhere or change this computer, and nothing would stop to ask you first.',
  },
  sealedCommands: {
    title: 'Stop sealing commands?',
    detail:
      'Commands the assistant runs could then read your SSH keys, cloud sign-ins and browsers’ saved passwords, and change any file you can.',
  },
};

/**
 * Settings → Security → Safety (ADR 0028): the two checks that hold in every
 * mode. Both start on; turning one off says what could happen, and asks that
 * it's you.
 */
export function SafetySection() {
  const { data: app } = useAppState();
  const update = useUpdateSettings();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const { data: safety } = useQuery({ queryKey: safetyKeys.status, queryFn: safetyApi.status });
  const [confirm, setConfirm] = useState<Guard>();
  if (!app) return null;
  const prefs = app.preferences;

  const set = async (key: Guard, value: boolean) => {
    try {
      await guard(() => update.mutateAsync({ preferences: { [key]: value } }));
      // The security checkup above says it right away.
      void client.invalidateQueries({ queryKey: keys.access });
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'That didn’t save. Try again.');
    }
  };
  const change = (key: Guard, value: boolean) => (value ? void set(key, true) : setConfirm(key));

  const sandbox = safety?.sandbox;
  return (
    <Section
      title="Safety"
      description="Two checks that hold in every mode, Full trust included. Both are on unless you turn them off."
    >
      <Stack gap={5}>
        <Switch
          labelPosition="start"
          checked={prefs.checkAfterReading}
          onCheckedChange={(on) => change('checkAfterReading', on)}
          label="Check before acting on what it read"
          description="Once a chat has read a web page, an email or someone else’s message, anything that could send your things somewhere or change this computer asks you first, with why."
        />
        <Stack gap={2}>
          <Switch
            labelPosition="start"
            checked={prefs.sealedCommands && Boolean(sandbox?.available)}
            disabled={sandbox ? !sandbox.available : true}
            onCheckedChange={(on) => change('sealedCommands', on)}
            label="Seal commands"
            description="Commands can change your work folder and the caches installs use, and can’t read where your keys and passwords live. A command that needs out asks first."
          />
          {sandbox && !sandbox.available && (
            <Callout tone="info">
              {sandbox.reason}
              {sandbox.command && (
                <span>
                  {' '}
                  <code>{sandbox.command}</code>{' '}
                  <CopyButton value={sandbox.command} label="Copy command" />
                </span>
              )}
            </Callout>
          )}
          {sandbox?.available && (
            <Collapsible>
              <Collapsible.Trigger>What a sealed command can’t read</Collapsible.Trigger>
              <Collapsible.Content>
                <Text size="sm" tone="muted">
                  {sandbox.protects.join(', ')}.
                </Text>
              </Collapsible.Content>
            </Collapsible>
          )}
        </Stack>
      </Stack>
      <AlertDialog.Root open={Boolean(confirm)} onOpenChange={(o) => !o && setConfirm(undefined)}>
        {confirm && (
          <AlertDialog.Content tone="danger" icon={<ShieldAlert />}>
            <AlertDialog.Header>
              <AlertDialog.Title>{OFF[confirm].title}</AlertDialog.Title>
              <AlertDialog.Description>{OFF[confirm].detail}</AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Keep it on</AlertDialog.Cancel>
              <AlertDialog.Action
                tone="danger"
                onClick={() => {
                  const key = confirm;
                  setConfirm(undefined);
                  void set(key, false);
                }}
              >
                Turn it off
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        )}
      </AlertDialog.Root>
      {dialog}
    </Section>
  );
}
