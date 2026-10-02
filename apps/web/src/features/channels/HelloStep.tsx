import type { Channel } from '@conch/protocol';
import { Button, ChannelRequest, HelloCard, Stack, Text, toast } from '@conch/nacre';
import { Send } from 'lucide-react';
import { useState } from 'react';

import { relativeTime } from '../../lib/time';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import { APPS, handleOf, isLinkedKind, SELF_CHAT } from './describe';
import { usePointerFine } from './hooks';
import { errorText, useChannelAction } from './queries';

/**
 * The last step of connecting: you say hello from the app, and Conch knows
 * it's you. On Telegram that's one link (and a QR code for the phone) that
 * carries a one-time code; Discord and Slack have no such link, so you send
 * the bot anything and confirm "That's me" here. Either way, nobody else
 * gets in without you pressing a button in Conch.
 */
export function HelloStep({
  channel,
  onFinish,
  finishLabel = 'Done',
}: {
  channel: Channel;
  onFinish?: () => void;
  finishLabel?: string;
}) {
  const fine = usePointerFine();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const pair = useChannelAction(() => channelsApi.pair(channel.id), 'Couldn’t make a new link.');
  const answer = useChannelAction((personId: string, how: 'allow' | 'block') =>
    channelsApi.answer(channel.id, personId, how),
  );
  const [testing, setTesting] = useState(false);
  const app = APPS[channel.kind].name;
  const handle = handleOf(channel);
  const who = handle ? `@${handle}` : channel.bot.name;
  const owner = channel.people[0];

  if (owner) {
    const test = async () => {
      setTesting(true);
      try {
        await channelsApi.test(channel.id);
        toast.success(`Sent. Look in ${app}.`);
      } catch (error) {
        toast.error(errorText(error, 'Couldn’t send the test message.'));
      } finally {
        setTesting(false);
      }
    };
    return (
      <HelloCard
        state="done"
        title={`You’re connected, ${owner.name.split(' ')[0]}`}
        openLabel={`Open in ${app}`}
        actions={
          <>
            <Button
              variant="solid"
              leadingIcon={<Send />}
              loading={testing}
              onClick={() => void test()}
            >
              Send a test message
            </Button>
            {onFinish && (
              <Button variant="ghost" onClick={onFinish}>
                {finishLabel}
              </Button>
            )}
          </>
        }
      >
        {isLinkedKind(channel.kind) ? (
          <p>
            Write to your assistant in <b>{SELF_CHAT[channel.kind]}</b> in {app}, from your phone or
            any device. Everything you say there is also here, in Conch. Before anything important
            it asks there, and you answer with a number.
          </p>
        ) : (
          <p>
            Message {who} in {app} anytime. Everything you say there is also here, in Conch, and
            your assistant asks you there before it does anything important.
          </p>
        )}
      </HelloCard>
    );
  }

  const telegram = channel.kind === 'telegram';
  const link = telegram ? channel.pairing?.link : channel.bot.chatUrl;
  const waiting = Boolean(link) && (!telegram || Boolean(channel.pairing));

  return (
    <Stack gap={4}>
      {channel.requests.map((request) => (
        <ChannelRequest
          key={request.id}
          hello
          name={request.name}
          username={request.username}
          preview={request.preview}
          count={request.count}
          when={relativeTime(request.at)}
          allowing={answer.isPending && answer.variables?.[0] === request.id}
          onAllow={() =>
            void guard(async () => {
              await answer.mutateAsync([request.id, 'allow']);
              toast.success(`You’re connected. Say anything to ${who} in ${app}.`);
            }).catch(() => undefined)
          }
          onBlock={() => answer.mutate([request.id, 'block'])}
        />
      ))}
      {/* Discord and Slack: once someone has written, confirming them is the only thing left. */}
      {(telegram || channel.requests.length === 0) && (
        <HelloCard
          state={waiting ? 'waiting' : 'expired'}
          title={
            telegram
              ? waiting
                ? `Say hello to ${who}`
                : 'That link expired'
              : `Send ${who} a message`
          }
          link={link}
          qr={fine}
          openLabel={`Open in ${app}`}
          waitingLabel={telegram ? 'Waiting for you to press Start' : 'Waiting for your message'}
          expiresAt={telegram ? channel.pairing?.expiresAt : undefined}
          onRenew={() => void guard(() => pair.mutateAsync([]))}
          renewing={pair.isPending}
        >
          {telegram ? (
            waiting ? (
              <p>
                {fine ? 'Scan the code with your phone, or open it here.' : 'Open it here.'}{' '}
                Telegram opens your bot: press <b>Start</b>, and it knows it’s you.
              </p>
            ) : (
              <p>Links work for 10 minutes and only once, so nobody else can use an old one.</p>
            )
          ) : channel.kind === 'discord' ? (
            <>
              <p>
                Open {who} in Discord (it’s in your server’s member list) and send it anything, like
                “hi”. Then press <b>That’s me</b> here.
              </p>
              <Text size="xs" tone="subtle">
                If Discord won’t let you message it: open your server’s menu → Privacy Settings, and
                allow Direct Messages.
              </Text>
            </>
          ) : (
            <p>
              Open {who} in Slack (it’s under Apps) and send it anything, like “hi”. Then press{' '}
              <b>That’s me</b> here.
            </p>
          )}
        </HelloCard>
      )}
      {!telegram && channel.requests.length > 0 && (
        <Text size="sm" tone="subtle">
          Not you? Press Not me, then send {who} a message from your own account.
        </Text>
      )}
      {dialog}
    </Stack>
  );
}
