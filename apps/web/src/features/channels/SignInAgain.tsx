import type { Channel, ChannelSecrets } from '@conch/protocol';
import { Button, Callout, Field, KeyField, PasswordInput, Stack, Text, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { useKeyCheck } from './hooks';
import { errorText, putChannel } from './queries';

/**
 * Teams, Matrix and WeChat stopped accepting what Conch has: a new client
 * secret, a new sign-in, or a new Secret for the same bot, and it reconnects.
 * Everything else (the address, WeChat's Token and key) stays as it was.
 */
export function SignInAgain({ channel }: { channel: Channel }) {
  const client = useQueryClient();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const secrets: ChannelSecrets | undefined = !value.trim()
    ? undefined
    : channel.kind === 'microsoftteams'
      ? { kind: 'microsoftteams', appId: channel.bot.id, appPassword: value }
      : channel.kind === 'matrix'
        ? { kind: 'matrix', homeserver: '', user: channel.bot.id, password: value }
        : {
            kind: 'wechat',
            mode: channel.bot.account === 'official' ? 'official' : 'wecom',
            appId: channel.bot.id,
            secret: value,
          };
  // A password is checked by signing in, so Matrix checks when you press the button.
  const { status, check } = useKeyCheck(channel.kind === 'matrix' ? undefined : secrets, value);
  const where =
    channel.kind === 'microsoftteams'
      ? 'On the bot’s page (Teams Developer Portal → Bot management, or Azure → Configuration), add a new client secret and copy its value.'
      : channel.kind === 'matrix'
        ? `Type the password of ${channel.bot.id}. Conch signs in once, as a new session, and doesn’t keep the password.`
        : channel.bot.account === 'official'
          ? 'In 设置与开发 → 基本配置, reset the AppSecret (重置) and copy it.'
          : 'On the bot’s page in WeCom, copy its Secret again (or make a new one).';

  const save = async () => {
    if (!secrets) return;
    setBusy(true);
    setError(undefined);
    try {
      await guard(async () => {
        putChannel(client, await channelsApi.replaceToken(channel.id, secrets));
        toast.success('Connected again.');
      });
    } catch (e) {
      setError(errorText(e, 'That didn’t work.'));
    } finally {
      setBusy(false);
    }
  };

  const label =
    channel.kind === 'microsoftteams'
      ? 'New client secret'
      : channel.kind === 'matrix'
        ? 'Password'
        : 'New Secret';
  return (
    <Callout
      tone="warning"
      title={channel.kind === 'matrix' ? 'Sign in again' : 'It needs a new key'}
    >
      <Stack gap={3}>
        <Text size="sm">
          {channel.health.message} {where}
        </Text>
        {channel.kind === 'matrix' ? (
          <Field invalid={Boolean(error)}>
            <Field.Label size="sm">{label}</Field.Label>
            <PasswordInput
              value={value}
              onChange={(event) => setValue(event.target.value)}
              autoComplete="current-password"
            />
            {error && <Field.Error>{error}</Field.Error>}
          </Field>
        ) : (
          <KeyField
            label={label}
            value={value}
            onValueChange={setValue}
            status={error ? 'error' : status}
            found={<>That works.</>}
            error={error ?? (check && !check.ok ? check.message : undefined)}
          />
        )}
        <Button
          variant="solid"
          className={styles.fit}
          loading={busy}
          disabled={channel.kind === 'matrix' ? !value : status !== 'ok'}
          onClick={() => void save()}
        >
          {channel.kind === 'matrix' ? 'Sign in' : 'Reconnect'}
        </Button>
      </Stack>
      {dialog}
    </Callout>
  );
}
