import type { Channel, VaultSource } from '@conch/protocol';
import { AppAbilities, type AppAbility, Heading, Stack, Text, toast } from '@conch/nacre';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FilePen,
  KeyRound,
  MessageCircle,
  Search,
  Send,
  SquareTerminal,
  Wrench,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from '../channels/api';
import { channelMessage, isLinkedKind, needsYou, whoOf } from '../channels/describe';
import { errorText, putChannel } from '../channels/queries';
import { vaultApi } from '../passwords/api';
import { vaultKeys } from '../passwords/queries';
import { groupOn, groupPatch, TALKS_AS, toolGroups, type AppItem } from './apps';
import { ConnectDialog } from './ConnectDialog';
import styles from './Integrations.module.css';
import { useAssistantName, useUpdateIntegration } from './queries';

const ICONS: Record<string, ReactNode> = {
  read: <Search />,
  draft: <FilePen />,
  send: <Send />,
  write: <Wrench />,
};

/** `ada@gmail.com` → `ada+conch@gmail.com`: where you'd write to talk to it (ADR 0044). */
const plus = (address: string) => address.replace(/@/, '+conch@');

/**
 * What an app does, as plain switches (ADR 0052): its tools in a few groups,
 * "Talk to me here" for an app you can chat in, and for 1Password, filling
 * sign-ins. A half that isn't set up yet has the button that sets it up;
 * one that can share a sign-in Conch already has turns on in one tap, and
 * only when the person flips it.
 */
export function AppAbilitiesSection({
  item,
  onSetUp,
}: {
  item: AppItem;
  /**
   * Opens the app's connect dialog. The page passes its own, so the dialog
   * stays open when the half it set up arrives and the page changes.
   */
  onSetUp?: () => void;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const assistant = useAssistantName();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const update = useUpdateIntegration();
  const [connecting, setConnecting] = useState(false);
  const setUp = onSetUp ?? (() => setConnecting(true));
  const [busy, setBusy] = useState<string>();
  const { integration, entry, channels, source } = item;
  const catalogId = integration?.catalogId ?? entry?.id;
  const talksAs = catalogId ? TALKS_AS[catalogId] : undefined;
  const channel = channels[0];
  // Gmail's app password, offered for talking by email (only its address is ever said).
  const gmail = useQuery({
    queryKey: ['channels', 'gmail-offer'],
    queryFn: channelsApi.gmailOffer,
    enabled: talksAs === 'email' && !channel,
    staleTime: 30_000,
  });

  const run = async (id: string, task: () => Promise<void>) => {
    setBusy(id);
    try {
      await guard(task);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(undefined);
    }
  };

  const setChannel = (target: Channel, enabled: boolean) =>
    run('talk', async () => putChannel(client, await channelsApi.update(target.id, { enabled })));

  const rows: AppAbility[] = [];

  // What the assistant uses: its tools in a few groups, or the one step that sets it up.
  if (catalogId === '1password') {
    rows.push({
      id: 'environments',
      title: 'Manage Environments',
      description:
        'For developers: the names of your Environments and their variables. Never the secret values.',
      icon: <SquareTerminal />,
      on: Boolean(integration?.enabled),
      ...(integration
        ? {
            onChange: (enabled: boolean) =>
              update.mutate({ id: integration.id, patch: { enabled } }),
          }
        : { setup: { label: 'Set up', onClick: setUp } }),
    });
  } else if (integration) {
    for (const group of toolGroups(integration))
      rows.push({
        id: group.id,
        title: group.title,
        description: group.description,
        icon: ICONS[group.id] ?? <Wrench />,
        on: groupOn(group),
        disabled: !integration.enabled,
        ...(group.note && { note: group.note }),
        onChange: (on: boolean) =>
          update.mutate({ id: integration.id, patch: { tools: groupPatch(group, on) } }),
      });
  } else if (entry) {
    rows.push({
      id: 'use',
      title: `Let ${assistant} use ${entry.name}`,
      description: entry.description,
      icon: <Search />,
      on: false,
      setup: { label: 'Set up', onClick: setUp },
    });
  }

  // Where you talk to it.
  if (talksAs) {
    const talk = {
      id: 'talk',
      title: 'Talk to me here',
      icon: <MessageCircle />,
      description:
        talksAs === 'slack'
          ? `Message ${assistant} privately in Slack, from your phone or any computer.`
          : `Write to yourself from any mail app, and ${assistant} answers by email.`,
    };
    if (channel)
      rows.push({
        ...talk,
        on: channel.enabled,
        busy: busy === 'talk',
        onChange: (on: boolean) => void setChannel(channel, on),
        note:
          channel.enabled && needsYou(channel)
            ? (channelMessage(channel) ?? `As ${whoOf(channel)}.`)
            : talksAs === 'email'
              ? `Write to ${whoOf(channel)}.`
              : `As ${whoOf(channel)}${channel.bot.workspace ? `, in ${channel.bot.workspace}` : ''}.`,
        attention: channel.enabled && needsYou(channel),
        action: {
          label:
            isLinkedKind(channel.kind) || talksAs === 'email'
              ? 'Who can write to it'
              : 'Who can talk to it',
          onClick: () => void navigate(`/channels/${channel.id}`),
        },
      });
    else if (talksAs === 'email' && gmail.data?.address) {
      const address = gmail.data.address;
      rows.push({
        ...talk,
        on: false,
        busy: busy === 'talk',
        note: `Uses the app password Gmail already has. You’d write to ${plus(address)}.`,
        onChange: (on: boolean) =>
          on &&
          void run('talk', async () => {
            const made = await channelsApi.fromGmail();
            putChannel(client, made);
            toast.success(`Write to ${whoOf(made)} from any mail app.`);
          }),
      });
    } else
      rows.push({
        ...talk,
        on: false,
        setup: {
          label: 'Set up',
          onClick: () =>
            void navigate(
              talksAs === 'slack' ? '/channels/new/slack?with=app' : '/channels/new/email',
            ),
        },
        note:
          talksAs === 'slack'
            ? integration
              ? 'Uses the same Slack app. It needs two more keys from it: about two minutes.'
              : 'About four minutes, in your own Slack app.'
            : 'With an app password from your mail service: about three minutes.',
      });
  }

  // 1Password's sign-ins, in Passwords.
  if (catalogId === '1password' && source) rows.unshift(fillRow(source));

  function fillRow(from: VaultSource): AppAbility {
    const base = {
      id: 'fill',
      title: 'Fill sign-ins from 1Password',
      description: `Your 1Password logins show in Passwords, and ${assistant} fills one in the browser when you say OK. Nothing is copied.`,
      icon: <KeyRound />,
    };
    if (from.state === 'missing')
      return {
        ...base,
        on: false,
        note: from.message ?? 'Needs 1Password’s command line on this computer.',
        setup: {
          label: 'Set up',
          onClick: () => void navigate('/passwords', { state: { sources: true } }),
        },
      };
    return {
      ...base,
      on: from.state !== 'off',
      busy: busy === 'fill',
      onChange: (enabled: boolean) =>
        void run('fill', async () => {
          await vaultApi.setSource(from.id, { enabled });
          await client.invalidateQueries({ queryKey: vaultKeys.all });
        }),
      ...(from.state === 'locked' && { note: 'Locked. Unlock 1Password to use it.' }),
      ...(from.state === 'error' && { note: from.message, attention: true }),
      ...(from.state === 'ready' &&
        from.count !== undefined && {
          note: `${from.count} ${from.count === 1 ? 'item' : 'items'}, read where they are.`,
        }),
      action: { label: 'Open Passwords', onClick: () => void navigate('/passwords') },
    };
  }

  if (!rows.length) return null;
  return (
    <section className={styles.section} aria-labelledby="app-does">
      <Stack gap={0.5}>
        <Heading level={2} id="app-does" size="md">
          What it does
        </Heading>
        <Text size="sm" tone="muted">
          Turn on what you want. Works with every model you pick.
        </Text>
      </Stack>
      <AppAbilities label={`What ${item.name} does`} abilities={rows} />
      {entry && !onSetUp && (
        <ConnectDialog
          entry={connecting ? entry : undefined}
          onOpenChange={(open) => !open && setConnecting(false)}
        />
      )}
      {dialog}
    </section>
  );
}
