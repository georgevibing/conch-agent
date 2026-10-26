import {
  AlertDialog,
  AllowedList,
  AutoEnvironment,
  Callout,
  Collapsible,
  SealCoverage,
  Stack,
  Switch,
  Text,
  toast,
} from '@conch/nacre';
import { autoLiftWords, autoRuleWords, type AutoRule } from '@conch/protocol';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { keys, useAppState, useUpdateSettings } from '../../api/queries';
import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { SaveStatus, Section } from '../settings/Section';
import { useAutosave } from '../settings/useAutosave';
import { AdminCommand } from '../setup/AdminCommand';
import { safetyApi, safetyKeys } from './api';
import { AUTO_ENVIRONMENT_FOCUS, AUTO_LIFTED_FOCUS } from './focus';

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
 * What Auto should know about where you work (ADR 0149), saved as it's typed. Only here:
 * no tool of the assistant writes it. ⌘K brings it into view, ready to type in.
 */
function EnvironmentNote({ saved }: { saved: string }) {
  const update = useUpdateSettings();
  const [note, setNote] = useState(saved);
  const status = useAutosave(note, (value) =>
    update.mutateAsync({ preferences: { autoEnvironment: value } }),
  );
  const ref = useRef<HTMLDivElement>(null);
  const focus = useUi((s) => s.settingsFocus);
  useEffect(() => {
    if (focus !== AUTO_ENVIRONMENT_FOCUS) return;
    useUi.setState({ settingsFocus: undefined });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'center', behavior: calm ? 'auto' : 'smooth' });
    ref.current?.querySelector('textarea')?.focus({ preventScroll: true });
  }, [focus]);
  return (
    <AutoEnvironment
      ref={ref}
      value={note}
      onChange={setNote}
      status={<SaveStatus status={status} />}
    />
  );
}

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
  // ⌘K's "What Auto never asks about": the section comes into view (ADR 0149).
  const ref = useRef<HTMLElement>(null);
  const focus = useUi((s) => s.settingsFocus);
  useEffect(() => {
    if (focus !== AUTO_LIFTED_FOCUS || !app) return;
    useUi.setState({ settingsFocus: undefined });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' });
  }, [focus, app]);
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
  // A kind of step, or one command, the person told Auto never to ask about again (ADR 0128,
  // ADR 0149): forgetting one only makes Auto ask again, so it needs no second look.
  const forget = async (preferences: { autoAllowed?: string[]; autoRules?: AutoRule[] }) => {
    try {
      await update.mutateAsync({ preferences });
    } catch (failure) {
      toast.error(failure instanceof ApiError ? failure.message : 'That didn’t save. Try again.');
    }
  };
  const ruleId = (rule: AutoRule) => JSON.stringify([rule.tool, rule.cwd ?? '', rule.prefix]);

  const sandbox = safety?.sandbox;
  return (
    <Section
      ref={ref}
      title="Safety"
      description="Checks that hold in every mode, Full trust included."
    >
      <Stack gap={5}>
        <Switch
          labelPosition="start"
          checked={prefs.checkAfterReading}
          onCheckedChange={(on) => change('checkAfterReading', on)}
          label="Check before acting on what it read"
          description="After a chat reads a web page, an email or a message, anything that could send your things somewhere asks you first."
        />
        <Switch
          labelPosition="start"
          checked={prefs.checkMemories}
          onCheckedChange={(on) => change('checkMemories', on)}
          label="Check what it remembers"
          description="A memory that looks planted isn’t saved: the chat shows it, says why, and asks you."
        />
        <Stack gap={2}>
          <Switch
            labelPosition="start"
            // As saved until this computer has said whether it can seal: never off, then on.
            checked={prefs.sealedCommands && (sandbox?.available ?? true)}
            disabled={!sandbox?.available}
            onCheckedChange={(on) => change('sealedCommands', on)}
            label="Seal commands"
            description="A command reaches your work folder, never your keys and passwords. One that needs out asks first."
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
        <EnvironmentNote saved={prefs.autoEnvironment} />
        {prefs.autoAllowed.length > 0 && (
          <Stack gap={2}>
            <Text size="sm" tone="subtle">
              Auto never asks again, in any chat, before it would:
            </Text>
            <AllowedList
              aria-label="Kinds of step Auto never asks about"
              rows={prefs.autoAllowed.map((cls) => ({
                id: cls,
                words: autoLiftWords(cls),
                forget: `Ask again before it would ${autoLiftWords(cls)}`,
              }))}
              onForget={(cls) =>
                void forget({ autoAllowed: prefs.autoAllowed.filter((c) => c !== cls) })
              }
            />
          </Stack>
        )}
        {prefs.autoRules.length > 0 && (
          <Stack gap={2}>
            <Text size="sm" tone="subtle">
              Auto never asks again before it runs:
            </Text>
            <AllowedList
              aria-label="Commands Auto never asks about"
              code
              rows={prefs.autoRules.map((rule) => ({
                id: ruleId(rule),
                words: autoRuleWords(rule),
                forget: `Ask again before ${autoRuleWords(rule)}`,
                ...(rule.cwd && { where: rule.cwd.split(/[\\/]/).filter(Boolean).at(-1) }),
              }))}
              onForget={(id) =>
                void forget({ autoRules: prefs.autoRules.filter((r) => ruleId(r) !== id) })
              }
            />
          </Stack>
        )}
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
