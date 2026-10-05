import {
  AlertDialog,
  Callout,
  Collapsible,
  SealCoverage,
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
import { AdminCommand } from '../setup/AdminCommand';
import { safetyApi, safetyKeys } from './api';

type Guard = 'checkAfterReading' | 'sealedCommands' | 'checkMemories';

const OFF: Record<Guard, { title: string; detail: string }> = {
  checkAfterReading: {
    title: 'Stop checking after it reads something?',
    detail:
      'A web page, an email or someone else’s message could then tell the assistant to send your things somewhere or change this computer, and nothing would stop to ask you first.',
  },
  checkMemories: {
    title: 'Stop checking what it remembers?',
    detail:
      'A web page or an email could then slip in a memory — where your invoices go, who to trust, an order to follow in every chat — and the assistant would act on it in later chats without asking you. Passwords, keys and hidden characters are still held.',
  },
  sealedCommands: {
    title: 'Stop sealing commands?',
    detail:
      'Commands the assistant runs could then read your SSH keys, cloud sign-ins and browsers’ saved passwords, and change any file you can.',
  },
};

/**
 * Settings → Security → Safety (ADR 0028, ADR 0087): the checks that hold in
 * every mode. All start on; turning one off says what could happen, and asks
 * that it's you.
 */
export function SafetySection() {
  const { data: app } = useAppState();
  const update = useUpdateSettings();
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  // While commands can't be sealed, look again now and then (and on coming back to the tab):
  // a command run in a terminal elsewhere shows here by itself, no reload.
  const { data: safety } = useQuery({
    queryKey: safetyKeys.status,
    queryFn: safetyApi.status,
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) => (q.state.data && !q.state.data.sandbox.available ? 5_000 : false),
  });
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
      description="Checks that hold in every mode, Full trust included. They’re on unless you turn them off."
    >
      <Stack gap={5}>
        <Switch
          labelPosition="start"
          checked={prefs.checkAfterReading}
          onCheckedChange={(on) => change('checkAfterReading', on)}
          label="Check before acting on what it read"
          description="Once a chat has read a web page, an email or someone else’s message, anything that could send your things somewhere or change this computer asks you first, with why."
        />
        <Switch
          labelPosition="start"
          checked={prefs.checkMemories}
          onCheckedChange={(on) => change('checkMemories', on)}
          label="Check what it remembers"
          description="A memory that looks planted — where invoices go, an order to follow, a password — isn’t saved. The chat shows it, says why, and asks you."
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
              <Stack gap={3}>
                <span>{sandbox.reason}</span>
                {sandbox.command && (
                  <AdminCommand
                    command={sandbox.command}
                    label="Seal commands"
                    watch="command-sandbox"
                  />
                )}
              </Stack>
            </Callout>
          )}
          {safety?.providers && <SealCoverage providers={safety.providers} />}
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
