import type { Channel } from '@conch/protocol';
import {
  AppMadeBadge,
  Button,
  GuideSteps,
  Handset,
  Heading,
  IntegrationLogo,
  KeyField,
  Page,
  Stack,
  Text,
} from '@conch/nacre';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useAppState } from '../../api/queries';
import { usePageTrail } from '../../app/trail';
import { APPS_PATH } from '../integrations/paths';
import styles from './Channels.module.css';
import { stepState, useConnect } from './ConnectChannel';
import { HelloStep } from './HelloStep';
import { useChannels } from './queries';

/**
 * A chat app a Conch app brings (ADR 0122), connected like any other:
 * the steps its maker wrote, what it needs typed (checked with the app's own
 * code before anything is kept), then the hello that recognises you.
 */
export function AppChannelSetup({ app }: { app: string }) {
  const navigate = useNavigate();
  const { data } = useChannels();
  const state = useAppState();
  const assistant = state.data?.persona.name ?? 'Conch';
  const entry = data?.catalog.find((c) => c.id === `app:${app}`);
  const name = entry?.name ?? 'Your chat app';
  usePageTrail([{ label: 'Apps', to: APPS_PATH }, { label: `Connect ${name}` }]);
  const [values, setValues] = useState<Record<string, string>>({});
  const { channel, connect, busy, error, reset, dialog } = useConnect();
  const fields = entry?.contributed?.fields ?? [];
  const steps = entry?.contributed?.steps ?? [];
  const ready = fields.every((f) => f.optional || values[f.key]?.trim());
  const at = channel ? 2 : steps.length ? (Object.keys(values).length ? 1 : 0) : 1;

  if (data && !entry?.contributed)
    return (
      <Page gap={4}>
        <Heading level={1} size="2xl">
          That chat app isn’t here
        </Heading>
        <Text tone="muted">Its app may have been removed. Look for it again in Apps.</Text>
        <Button className={styles.fit} onClick={() => void navigate('/apps?show=talk')}>
          Open Apps
        </Button>
      </Page>
    );

  return (
    <Page gap={8}>
      <div className={styles.setup}>
        <div className={styles.setupMain}>
          <Stack gap={2}>
            <IntegrationLogo brand="app" name={name} color={entry?.color} size="lg" decorative />
            <Heading level={1} display size="4xl">
              Connect {name}
            </Heading>
            <Stack direction="row" gap={2} align="center">
              {entry?.contributed && (
                <AppMadeBadge kind={entry.contributed.from === 'made' ? 'made' : 'link'} />
              )}
            </Stack>
            <Text tone="muted">
              {entry?.tagline}.{' '}
              {entry?.contributed?.receives === 'webhook'
                ? `${name} delivers to Conch’s public address.`
                : `Conch asks ${name} for messages from this computer, so nothing needs a public address.`}{' '}
              Its code only delivers messages: it can’t read your chats or use your apps.
            </Text>
          </Stack>
          <GuideSteps label={`Connect ${name}`}>
            {steps.length > 0 && (
              <GuideSteps.Step
                number={1}
                title={`In ${name}`}
                state={stepState(0, at)}
                summary="Done"
              >
                <ol className={styles.how}>
                  {steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </GuideSteps.Step>
            )}
            <GuideSteps.Step
              number={steps.length ? 2 : 1}
              title="Paste what it gave you"
              state={stepState(steps.length ? 1 : 0, at)}
              summary="Connected"
            >
              {fields.map((field, index) => (
                <KeyField
                  key={field.key}
                  label={field.label}
                  value={values[field.key] ?? ''}
                  onValueChange={(v) => {
                    reset();
                    setValues((now) => ({ ...now, [field.key]: v }));
                  }}
                  status={error && index === fields.length - 1 ? 'error' : 'idle'}
                  placeholder={field.placeholder}
                  description={field.help}
                  error={index === fields.length - 1 ? error : undefined}
                  focusOnShow={index === 0}
                />
              ))}
              <Button
                className={styles.fit}
                disabled={!ready || Boolean(channel)}
                loading={busy}
                onClick={() =>
                  void connect({
                    kind: 'app',
                    app,
                    fields: Object.fromEntries(
                      Object.entries(values).map(([k, v]) => [k, v.trim()]),
                    ),
                  })
                }
              >
                Connect
              </Button>
            </GuideSteps.Step>
            <GuideSteps.Step
              number={steps.length ? 3 : 2}
              title="Say hello"
              state={stepState(steps.length ? 2 : 1, at)}
            >
              {channel && (
                <HelloStep
                  channel={channel}
                  onFinish={() => void navigate(`/channels/${channel.id}`)}
                />
              )}
            </GuideSteps.Step>
          </GuideSteps>
        </div>
        <aside className={styles.setupPreview} aria-label={`What you’ll see in ${name}`}>
          <Preview name={name} color={entry?.color} assistant={assistant} channel={channel} />
        </aside>
      </div>
      {dialog}
    </Page>
  );
}

function Preview({
  name,
  color,
  assistant,
  channel,
}: {
  name: string;
  color?: string;
  assistant: string;
  channel?: Channel;
}) {
  return (
    <Handset
      label={`A chat with ${assistant} on ${name}`}
      brand="app"
      {...(color && { color })}
      title={channel?.bot.name ?? assistant}
      subtitle="bot"
      alive={Boolean(channel && !channel.people.length)}
      messages={
        channel?.people.length
          ? [
              { id: '1', from: 'you', text: 'hello' },
              { id: '2', from: 'them', text: `Hi! 👋 I’m ${assistant}, connected to Conch.` },
            ]
          : [{ id: '1', from: 'you', text: 'hello' }]
      }
      footer={<Handset.Composer />}
    />
  );
}
