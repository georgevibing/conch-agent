import type { Channel, ChannelHookSecrets } from '@conch/protocol';
import { Button, Field, Heading, Input, Stack, Text, CopyButton, toast } from '@conch/nacre';
import { Download, Eye } from 'lucide-react';
import { useState } from 'react';

import { relativeTime } from '../../lib/time';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import { DoorStep } from './DoorStep';
import { errorText } from './queries';

/** Teams, and a WeChat Official Account, come in through the public door (ADR 0045). */
export const usesDoor = (channel: Channel) =>
  channel.kind === 'microsoftteams' ||
  channel.kind === 'sms' ||
  channel.kind === 'line' ||
  (channel.kind === 'wechat' && channel.bot.account === 'official');

/** One value to paste somewhere else, with its copy button. */
export function CopyRow({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Field>
      <Field.Label size="sm">{label}</Field.Label>
      <Input
        readOnly
        value={value}
        size="sm"
        style={mono ? { fontFamily: 'var(--nc-font-mono)' } : undefined}
        trailing={
          <CopyButton value={value} label={`Copy the ${label.replace(/\s*\(.*\)$/, '')}`} />
        }
      />
    </Field>
  );
}

/** What WeChat's server settings need: the address, the Token and the EncodingAESKey, shown on request. */
export function WeChatServerFields({ channel }: { channel: Channel }) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const [secrets, setSecrets] = useState<ChannelHookSecrets>();
  const [loading, setLoading] = useState(false);
  const show = async () => {
    setLoading(true);
    try {
      await guard(async () => setSecrets(await channelsApi.hook(channel.id)));
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t show them.'));
    } finally {
      setLoading(false);
    }
  };
  const url = secrets?.url ?? channel.hook?.url;
  return (
    <Stack gap={3}>
      {url && <CopyRow label="URL (服务器地址)" value={url} />}
      {secrets?.token ? (
        <>
          <CopyRow label="Token (令牌)" value={secrets.token} />
          {secrets.aesKey && (
            <CopyRow label="EncodingAESKey (消息加解密密钥)" value={secrets.aesKey} />
          )}
        </>
      ) : (
        <Button
          variant="surface"
          size="sm"
          leadingIcon={<Eye />}
          loading={loading}
          className={styles.fit}
          onClick={() => void show()}
        >
          Show the Token and EncodingAESKey
        </Button>
      )}
      {dialog}
    </Stack>
  );
}

/**
 * On a channel's page: where its app delivers, and whether it has been heard
 * from there. Nothing for the apps Conch reaches by itself.
 */
export function HookSection({ channel }: { channel: Channel }) {
  if (!usesDoor(channel)) return null;
  const teams = channel.kind === 'microsoftteams';
  // Conch points the Twilio number at its address itself: nothing to paste.
  const sms = channel.kind === 'sms' || channel.kind === 'line';
  const app = teams
    ? 'Teams'
    : channel.kind === 'sms'
      ? 'Twilio'
      : channel.kind === 'line'
        ? 'LINE'
        : 'WeChat';
  return (
    <section aria-labelledby="ch-hook" className={styles.section}>
      <Heading level={2} id="ch-hook" size="sm" tone="muted">
        Where {app} delivers
      </Heading>
      <DoorStep />
      {teams && channel.hook?.url && (
        <CopyRow label="Messaging endpoint" value={channel.hook.url} />
      )}
      {!teams && !sms && <WeChatServerFields channel={channel} />}
      <Text size="sm" tone="subtle" aria-live="polite">
        {channel.hook?.heardAt
          ? `${app} last delivered here ${relativeTime(channel.hook.heardAt)}.`
          : `Nothing from ${app} yet.`}
      </Text>
      {teams && (
        <Button asChild variant="ghost" size="sm" leadingIcon={<Download />} className={styles.fit}>
          <a href={channelsApi.teamsAppUrl(channel.id)} download>
            Download the Teams app again
          </a>
        </Button>
      )}
    </section>
  );
}
