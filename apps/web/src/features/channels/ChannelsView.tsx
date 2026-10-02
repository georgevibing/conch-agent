import type { Channel } from '@conch/protocol';
import {
  ChannelCard,
  ChannelSoon,
  ChannelTile,
  Handset,
  Heading,
  Skeleton,
  Stack,
  Text,
  toast,
} from '@conch/nacre';
import { ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { channelsApi } from './api';
import styles from './Channels.module.css';
import {
  APPS,
  channelFix,
  channelMessage,
  channelMeta,
  channelState,
  handleOf,
  isKind,
  needsYou,
} from './describe';
import { errorText, useChannelAction, useChannels } from './queries';

const order = (a: Channel, b: Channel) =>
  Number(needsYou(b)) - Number(needsYou(a)) || a.createdAt - b.createdAt;

/**
 * `/channels`: the chat apps your assistant can be reached from. What you
 * have comes first (what needs you at the top, with its one button), then the
 * apps you can add, each a single tile.
 */
export function ChannelsView() {
  const { data, isPending } = useChannels();
  const state = useAppState();
  const navigate = useNavigate();
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const toggle = useChannelAction(
    (id: string, enabled: boolean) => channelsApi.update(id, { enabled }),
    'Couldn’t change that channel.',
  );
  const repair = useChannelAction((id: string) => channelsApi.repair(id), 'Repair didn’t work.');
  const assistant = state.data?.persona.name ?? 'Conch';
  const channels = [...(data?.channels ?? [])].sort(order);
  const available = data?.catalog.filter((c) => c.available) ?? [];
  const soon = data?.catalog.filter((c) => !c.available && c.tagline === 'Coming soon.') ?? [];
  // Here but not on this computer (iMessage away from a Mac): said so, apart from what's coming.
  const elsewhere = data?.catalog.filter((c) => !c.available && c.tagline !== 'Coming soon.') ?? [];

  const act = (channel: Channel) => {
    const state = channelState(channel);
    if (state === 'conflict' || state === 'error') {
      repair.mutate([channel.id], {
        onSuccess: (fixed) =>
          fixed.health.state === 'online'
            ? toast.success(`${APPS[channel.kind].name} is back.`)
            : undefined,
      });
      return;
    }
    void navigate(`/channels/${channel.id}`);
  };

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.pageIntro}>
          <Heading level={1} display size="4xl">
            Channels
          </Heading>
          <Text tone="muted">
            Talk to {assistant} from the apps on your phone. It answers from this computer, with
            everything it can do here, and asks you right there before anything important.
          </Text>
          {!isPending && channels.length === 0 && (
            <ol className={styles.how} aria-label="How it works">
              <li>
                <Text as="span" size="sm">
                  Pick an app below.
                </Text>
              </li>
              <li>
                <Text as="span" size="sm">
                  Make a bot of your own there, or link your own WhatsApp or Signal by scanning a
                  code. Conch shows you every click and checks each step.
                </Text>
              </li>
              <li>
                <Text as="span" size="sm">
                  Say hello from your phone. From then on, it’s yours: nobody else gets in unless
                  you let them.
                </Text>
              </li>
            </ol>
          )}
        </div>
        {!isPending && channels.length === 0 && (
          <Handset
            label="An example conversation in Telegram"
            brand="telegram"
            color={APPS.telegram.color}
            title={assistant}
            subtitle="bot"
            messages={[
              {
                id: '1',
                from: 'you',
                text: 'Did the build pass? And what’s on my calendar tomorrow?',
              },
              {
                id: '2',
                from: 'them',
                text: 'The build passed ✅. Tomorrow: stand-up at 9:30 and lunch with Grace at 1.',
              },
              { id: '3', from: 'you', text: 'Great. Move lunch to 1:30 and tell her.' },
              {
                id: '4',
                from: 'them',
                text: (
                  <p>
                    🔐 <b>{assistant} would like to:</b> send an email to Grace
                  </p>
                ),
                buttons: [
                  { label: 'Allow', tone: 'primary' },
                  { label: 'Don’t', tone: 'danger' },
                ],
              },
            ]}
            footer={<Handset.Composer />}
          />
        )}
      </header>

      {isPending ? (
        <Stack gap={3}>
          <Skeleton shape="block" height="4.5rem" />
          <Skeleton shape="block" height="4.5rem" />
        </Stack>
      ) : (
        channels.length > 0 && (
          <section aria-labelledby="ch-yours" className={styles.section}>
            <Heading level={2} id="ch-yours" size="sm" tone="muted">
              Your channels
            </Heading>
            <ul className={styles.cards}>
              {channels.map((channel, index) => {
                const fix = channelFix(channel);
                return (
                  <li key={channel.id}>
                    <ChannelCard
                      index={index}
                      brand={channel.kind}
                      app={APPS[channel.kind].name}
                      color={APPS[channel.kind].color}
                      name={channel.bot.name}
                      handle={handleOf(channel)}
                      avatar={channel.bot.avatar}
                      state={channelState(channel)}
                      message={channelMessage(channel)}
                      meta={channelMeta(channel)}
                      requests={
                        channel.requests.length && channel.people.length
                          ? channel.requests.length
                          : 0
                      }
                      action={
                        fix
                          ? {
                              label: fix,
                              onClick: () => act(channel),
                              loading: repair.isPending && repair.variables?.[0] === channel.id,
                            }
                          : undefined
                      }
                      enabled={channel.enabled}
                      onToggle={(enabled) =>
                        void guard(() => toggle.mutateAsync([channel.id, enabled])).catch(
                          (error: unknown) => toast.error(errorText(error)),
                        )
                      }
                      onOpen={() => void navigate(`/channels/${channel.id}`)}
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}

      <section aria-labelledby="ch-add" className={styles.section}>
        <Heading level={2} id="ch-add" size="sm" tone="muted">
          {channels.length ? 'Add another' : 'Pick an app'}
        </Heading>
        <ul className={styles.tiles}>
          {available.map((entry, index) => (
            <li key={entry.id}>
              <ChannelTile
                index={index}
                brand={entry.id}
                name={entry.name}
                color={entry.color}
                tagline={entry.tagline}
                minutes={entry.minutes}
                onConnect={() => isKind(entry.id) && void navigate(`/channels/new/${entry.id}`)}
              />
            </li>
          ))}
        </ul>
        {soon.length > 0 && (
          <ChannelSoon apps={soon.map((s) => ({ brand: s.id, name: s.name, color: s.color }))} />
        )}
        {elsewhere.map((entry) => (
          <ChannelSoon
            key={entry.id}
            note={entry.tagline.replace(/\.$/, '')}
            apps={[{ brand: entry.id, name: entry.name, color: entry.color }]}
          />
        ))}
      </section>

      <footer className={styles.footer}>
        <ShieldCheck size={14} aria-hidden />
        <Text size="sm" tone="subtle">
          Private by default: only people you let in can talk to {assistant}, and only in a private
          chat. Keys stay on this computer, and Conch connects out to each app, so nothing here is
          open to the internet.
        </Text>
      </footer>
      {dialog}
    </div>
  );
}
