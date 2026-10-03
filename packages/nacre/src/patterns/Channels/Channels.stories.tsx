import type { Meta, StoryObj } from '@storybook/react-vite';
import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/Button';
import { Stack } from '../../components/Stack';
import { Heading, Text } from '../../components/Text';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { ChannelCard, ChannelSoon, ChannelTile } from './ChannelCard';
import { ChannelRequest, PersonRow } from './ChannelPeople';
import { GuideSteps } from './GuideSteps';
import { Handset, type HandsetMessage } from './Handset';
import { HelloCard } from './HelloCard';
import { KeyField, type KeyFieldStatus } from './KeyField';
import { PortalSketch } from './PortalSketch';
import { PublicDoor, type PublicDoorState } from './PublicDoor';

const meta = {
  title: 'Patterns/Channels',
  parameters: {
    docs: {
      description: {
        component:
          'Reaching your assistant from the chat apps on your phone. Setting one up is a short numbered path beside a phone that shows exactly what you’ll see in the app — BotFather’s reply with the key lit up, the Start button to press, the first hello. Keys are checked the moment they’re pasted; the last step is one link (and a QR code) that recognises you.',
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const TOKEN = '123456789:' + 'AAH-example-not-a-real-token-000000';

const catalog = [
  {
    brand: 'telegram',
    name: 'Telegram',
    color: '#26A5E4',
    minutes: 2,
    tagline: 'The easiest. Make a bot, paste its key, say hello.',
  },
  {
    brand: 'discord',
    name: 'Discord',
    color: '#5865F2',
    minutes: 4,
    tagline: 'Message your assistant privately, from any device.',
  },
  {
    brand: 'slack',
    name: 'Slack',
    color: '#4A154B',
    minutes: 4,
    tagline: 'A private DM with your assistant, in your workspace.',
  },
  {
    brand: 'whatsapp',
    name: 'WhatsApp',
    color: '#25D366',
    minutes: 1,
    tagline: 'Your own WhatsApp. Scan a code, then message yourself.',
  },
  {
    brand: 'signal',
    name: 'Signal',
    color: '#3A76F0',
    minutes: 2,
    tagline: 'Your own Signal. Scan a code, then use Note to Self.',
  },
  {
    brand: 'imessage',
    name: 'iMessage',
    color: '#34DA50',
    minutes: 1,
    tagline: 'Text yourself from your iPhone. Nothing to make.',
  },
  {
    brand: 'email',
    name: 'Email',
    color: '#5B6B7F',
    minutes: 3,
    tagline: 'Write to yourself+conch, from any mail app.',
  },
];

const soon = [
  { brand: 'microsoftteams', name: 'Microsoft Teams', color: '#6264A7' },
  { brand: 'matrix', name: 'Matrix', color: '#0DBD8B' },
];

export const Tiles: Story = {
  render: () => (
    <Stack gap={5} style={{ maxWidth: 820 }}>
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        }}
      >
        {catalog.map((c, i) => (
          <ChannelTile key={c.brand} index={i} {...c} onConnect={() => undefined} />
        ))}
      </div>
      <ChannelSoon apps={soon} />
    </Stack>
  ),
};

export const Cards: Story = {
  render: () => (
    <Stack gap={3} style={{ maxWidth: 720 }}>
      <ChannelCard
        brand="telegram"
        app="Telegram"
        color="#26A5E4"
        name="Ada’s Conch"
        handle="adas_conch_bot"
        state="online"
        meta="You and Grace · last message 5 minutes ago"
        enabled
        onToggle={() => undefined}
        onOpen={() => undefined}
      />
      <ChannelCard
        brand="discord"
        app="Discord"
        color="#5865F2"
        name="Conch"
        handle="conch_bot"
        state="online"
        meta="You"
        requests={2}
        action={{ label: 'Review', onClick: () => undefined }}
        enabled
        onToggle={() => undefined}
        onOpen={() => undefined}
        index={1}
      />
      <ChannelCard
        brand="slack"
        app="Slack"
        name="Conch"
        state="hello"
        message="Connected. Say hello from Slack to finish."
        action={{ label: 'Say hello', onClick: () => undefined }}
        enabled
        onToggle={() => undefined}
        onOpen={() => undefined}
        index={2}
      />
      <ChannelCard
        brand="telegram"
        app="Telegram"
        color="#26A5E4"
        name="Old bot"
        handle="old_conch_bot"
        state="needs-token"
        message="Telegram stopped accepting this bot’s key. It was probably reset in BotFather."
        action={{ label: 'Paste the new key', onClick: () => undefined }}
        enabled
        onToggle={() => undefined}
        onOpen={() => undefined}
        index={3}
      />
      <ChannelCard
        brand="telegram"
        app="Telegram"
        color="#26A5E4"
        name="Shared bot"
        handle="shared_bot"
        state="conflict"
        message="Another program is reading this bot’s messages (another Conch, or an app like OpenClaw)."
        enabled
        onToggle={() => undefined}
        onOpen={() => undefined}
        index={4}
      />
      <ChannelCard
        brand="discord"
        app="Discord"
        color="#5865F2"
        name="Conch"
        state="reconnecting"
        message="Reconnecting to Discord."
        enabled
        onToggle={() => undefined}
        onOpen={() => undefined}
        index={5}
      />
      <ChannelCard
        brand="slack"
        app="Slack"
        name="Conch"
        state="off"
        message="Off"
        enabled={false}
        onToggle={() => undefined}
        onOpen={() => undefined}
        index={6}
      />
    </Stack>
  ),
};

const botFather: HandsetMessage[] = [
  { id: '1', from: 'you', text: '/newbot' },
  {
    id: '2',
    from: 'them',
    text: 'Alright, a new bot. How are we going to call it? Please choose a name for your bot.',
  },
  { id: '3', from: 'you', text: 'Ada’s Conch' },
  {
    id: '4',
    from: 'them',
    text: 'Good. Now let’s choose a username for your bot. It must end in `bot`.',
  },
  { id: '5', from: 'you', text: 'adas_conch_bot' },
  {
    id: '6',
    from: 'them',
    text: (
      <>
        <p>Done! Congratulations on your new bot.</p>
        <p>
          Use this token to access the HTTP API:
          <br />
          <Handset.Key>{TOKEN}</Handset.Key>
        </p>
      </>
    ),
  },
];

export const HandsetBotFather: Story = {
  name: 'Handset — BotFather',
  render: () => (
    <Handset
      label="What you’ll see in Telegram"
      brand="telegram"
      color="#26A5E4"
      title="BotFather"
      subtitle="bot"
      messages={botFather}
      footer={<Handset.Composer />}
    />
  ),
};

export const HandsetStart: Story = {
  name: 'Handset — press Start',
  render: () => (
    <Handset
      label="Your bot in Telegram, waiting for Start"
      brand="telegram"
      color="#26A5E4"
      title="Ada’s Conch"
      subtitle="bot"
      alive
      messages={[
        {
          id: '1',
          from: 'them',
          text: 'I’m Conch, Ada’s assistant. I run on Ada’s computer and can do everything there. I’m private: only people who were let in can talk to me.',
        },
      ]}
      footer={<Handset.Action>START</Handset.Action>}
    />
  ),
};

export const HandsetConversation: Story = {
  name: 'Handset — asking first',
  render: () => (
    <Handset
      label="A conversation with your bot"
      brand="telegram"
      color="#26A5E4"
      title="Ada’s Conch"
      subtitle="bot"
      messages={[
        { id: '1', from: 'you', text: 'Can you run the tests and tell me what failed?' },
        {
          id: '2',
          from: 'them',
          text: (
            <p>
              🔐 <b>Conch would like to:</b> run <code>npm test</code>
            </p>
          ),
          buttons: [
            { label: 'Allow', tone: 'primary' },
            { label: 'Always' },
            { label: 'Don’t', tone: 'danger' },
          ],
        },
      ]}
      typing
      footer={<Handset.Composer />}
    />
  ),
};

function Steps({ at }: { at: 0 | 1 | 2 | 3 }) {
  const state = (i: number) => (i < at ? 'done' : i === at ? 'current' : 'upcoming');
  return (
    <GuideSteps label="Connect Telegram" style={{ maxWidth: 520 }}>
      <GuideSteps.Step
        number={1}
        title="Make your bot in Telegram"
        state={state(0)}
        summary="Done in BotFather"
        onEdit={() => undefined}
      >
        <Text tone="muted">
          Open BotFather, send <b>/newbot</b>, then give your bot a name and a username that ends in
          “bot”.
        </Text>
        <Button variant="solid" style={{ alignSelf: 'flex-start' }}>
          Open BotFather
        </Button>
      </GuideSteps.Step>
      <GuideSteps.Step
        number={2}
        title="Paste its key"
        state={state(1)}
        summary="Found @adas_conch_bot"
        onEdit={() => undefined}
      >
        <KeyField
          label="Bot key"
          value=""
          onValueChange={() => undefined}
          status="idle"
          placeholder="123456789:ABC…"
          description="BotFather sends it in its last message. Pasting the whole message is fine."
        />
      </GuideSteps.Step>
      <GuideSteps.Step number={3} title="Say hello" state={state(2)}>
        <Text tone="muted">One tap, and your bot knows it’s you.</Text>
      </GuideSteps.Step>
    </GuideSteps>
  );
}

export const StepsAtEachStage: Story = {
  render: () => (
    <Stack gap={8}>
      <Steps at={0} />
      <Steps at={1} />
      <Steps at={2} />
      <Steps at={3} />
    </Stack>
  ),
};

function Key() {
  const [value, setValue] = useState('');
  const [status, setStatus] = useState<KeyFieldStatus>('idle');
  // The check starts when the value changes, like the app's does.
  const change = (next: string) => {
    setValue(next);
    setStatus(next ? 'checking' : 'idle');
  };
  useEffect(() => {
    if (!value) return;
    const t = setTimeout(() => setStatus(/\d+:[\w-]{30,}/.test(value) ? 'ok' : 'error'), 900);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <KeyField
      label="Bot key"
      value={value}
      onValueChange={change}
      status={status}
      placeholder="123456789:ABC…"
      checkingLabel="Checking with Telegram…"
      description="BotFather sends it in its last message. Pasting the whole message is fine."
      found={
        <>
          Found <b>@adas_conch_bot</b> — Ada’s Conch
        </>
      }
      error="Telegram doesn’t recognise this key. Copy it again from BotFather (it looks like 123456:ABC…)."
    />
  );
}

export const KeyFieldStates: Story = {
  render: () => (
    <Stack gap={6} style={{ maxWidth: 480 }}>
      <Key />
      <KeyField
        label="Bot key"
        value={TOKEN}
        onValueChange={() => undefined}
        status="checking"
        checkingLabel="Checking with Telegram…"
      />
      <KeyField
        label="Bot key"
        value={TOKEN}
        onValueChange={() => undefined}
        status="ok"
        found={
          <>
            Found <b>@adas_conch_bot</b> — Ada’s Conch
          </>
        }
      />
      <KeyField
        label="Bot key"
        value="12345:nope"
        onValueChange={() => undefined}
        status="error"
        error="Telegram doesn’t recognise this key. Copy it again from BotFather (it looks like 123456:ABC…)."
      />
    </Stack>
  ),
};

const LINK = 'https://t.me/adas_conch_bot?start=Qm9vdHN0cmFwUGVhcmw';

export const Hello: Story = {
  render: () => (
    <Stack gap={5} style={{ maxWidth: 640 }}>
      <HelloCard
        state="waiting"
        title="Say hello to @adas_conch_bot"
        link={LINK}
        openLabel="Open in Telegram"
        waitingLabel="Waiting for you to press Start"
        expiresAt={Date.now() + 9 * 60_000}
      >
        <p>
          Scan the code with your phone, or open it here. Telegram opens your bot: press Start, and
          it knows it’s you.
        </p>
      </HelloCard>
      <HelloCard
        state="expired"
        title="That link expired"
        link={LINK}
        openLabel="Open in Telegram"
        onRenew={() => undefined}
      >
        <p>Links work for 10 minutes, so nobody else can use an old one.</p>
      </HelloCard>
      <HelloCard
        state="done"
        title="You’re connected, Ada"
        openLabel="Open in Telegram"
        actions={
          <>
            <Button variant="solid" leadingIcon={<Send />}>
              Send a test message
            </Button>
            <Button variant="ghost">Done</Button>
          </>
        }
      >
        <p>Message @adas_conch_bot anytime. Everything you say there is also here, in Conch.</p>
      </HelloCard>
    </Stack>
  ),
};

export const People: Story = {
  render: () => (
    <Stack gap={5} style={{ maxWidth: 560 }}>
      <ChannelRequest
        hello
        name="Ada Lovelace"
        username="ada"
        preview="hi"
        when="just now"
        onAllow={() => undefined}
        onBlock={() => undefined}
      />
      <ChannelRequest
        name="Grace Hopper"
        username="grace"
        preview="Hey! Ada said I could ask you about the release schedule?"
        count={2}
        when="3 minutes ago"
        onAllow={() => undefined}
        onBlock={() => undefined}
        onDismiss={() => undefined}
      />
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        <PersonRow
          name="Ada Lovelace"
          username="ada"
          badge="You"
          meta="Last message 5 minutes ago"
        />
        <PersonRow
          name="Grace Hopper"
          username="grace"
          meta="Let in yesterday"
          onRemove={() => undefined}
        />
      </ul>
    </Stack>
  ),
};

/** The whole setup screen, as the app composes it: the path on the left, the phone on the right. */
export const TelegramSetup: Story = {
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div
      style={{ padding: 32, display: 'flex', flexWrap: 'wrap', gap: 48, alignItems: 'flex-start' }}
    >
      <Stack gap={6} style={{ flex: '1 1 420px', maxWidth: 560 }}>
        <Stack gap={2}>
          <IntegrationLogo brand="telegram" name="Telegram" color="#26A5E4" size="lg" />
          <Heading level={1} display size="4xl">
            Connect Telegram
          </Heading>
          <Text tone="muted">
            About two minutes. You’ll make a bot of your own, and your assistant will answer through
            it.
          </Text>
        </Stack>
        <Steps at={1} />
      </Stack>
      <Handset
        label="What you’ll see in Telegram"
        brand="telegram"
        color="#26A5E4"
        title="BotFather"
        subtitle="bot"
        messages={botFather}
        footer={<Handset.Composer />}
      />
    </div>
  ),
};

export const PortalSketches: Story = {
  render: () => (
    <Stack direction="row" gap={5} wrap>
      <PortalSketch
        label="The Discord Developer Portal, on the Bot page"
        address="discord.com/developers/applications"
        nav={['General Information', 'Installation', 'OAuth2', 'Bot', 'Emojis']}
        active="Bot"
        title="Bot"
        color="#5865F2"
      >
        <PortalSketch.Bar width={60} />
        <PortalSketch.Field label="Token" />
        <PortalSketch.Row>
          <PortalSketch.Button>Reset Token</PortalSketch.Button>
          <PortalSketch.Button quiet>Copy</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Bar width={80} />
        <PortalSketch.Bar width={45} />
      </PortalSketch>
      <PortalSketch
        label="Your Slack app's settings, on Install App"
        address="api.slack.com/apps"
        nav={['Basic Information', 'Install App', 'OAuth & Permissions', 'Socket Mode', 'App Home']}
        active="Install App"
        title="Install App"
        color="#4A154B"
      >
        <PortalSketch.Field label="Bot User OAuth Token">xoxb-1234-5678-AbCdEf…</PortalSketch.Field>
        <PortalSketch.Row>
          <PortalSketch.Button>Copy</PortalSketch.Button>
        </PortalSketch.Row>
        <PortalSketch.Bar width={70} />
      </PortalSketch>
    </Stack>
  ),
};

/** iMessage and email (ADR 0044): the switch macOS needs, and the chats as you'll see them. */
export const MacAndMail: Story = {
  render: () => (
    <Stack direction="row" gap={5} wrap>
      <PortalSketch
        label="System Settings, on Full Disk Access"
        address="System Settings"
        nav={['Wi-Fi', 'General', 'Privacy & Security', 'Notifications']}
        active="Privacy & Security"
        title="Full Disk Access"
        color="#34DA50"
      >
        <PortalSketch.Bar width={70} />
        <PortalSketch.Toggle label="Backup app" on />
        <PortalSketch.Toggle label="Terminal" press />
        <PortalSketch.Bar width={45} />
      </PortalSketch>
      <Handset
        label="Texting yourself in Messages"
        brand="imessage"
        color="#34DA50"
        title="Ada Lovelace"
        subtitle="iMessage · you"
        messages={[
          { id: '1', from: 'you', text: 'what’s on today?' },
          { id: '2', from: 'them', text: 'Dentist at 3, then dinner with Grace at 8.' },
          {
            id: '3',
            from: 'them',
            text: 'I’d like to delete 3 old log files. Reply yes to allow it, or no.',
          },
          { id: '4', from: 'you', text: 'yes' },
        ]}
        footer={<Handset.Composer placeholder="iMessage" />}
      />
      <Handset
        label="Writing to your assistant by email"
        brand="email"
        color="#5B6B7F"
        title="ada+conch@gmail.com"
        subtitle="Re: Plans for Friday"
        messages={[
          { id: '1', from: 'you', text: 'Can you find a table for four on Friday?' },
          {
            id: '2',
            from: 'them',
            text: 'Two places have room at 8: Ottolenghi and Dishoom. Want me to book one?',
          },
        ]}
        footer={<Handset.Composer placeholder="Reply" />}
      />
    </Stack>
  ),
};

/**
 * The public door Teams and WeChat deliver to: off with its one button (and
 * an address of your own folded under it), turning on, on with its address
 * behind a lock, and the step only a person can take.
 */
export const PublicAddress: Story = {
  render: function Render() {
    const [state, setState] = useState<PublicDoorState>('off');
    return (
      <Stack gap={4} style={{ maxInlineSize: 560 }}>
        <PublicDoor
          state={state}
          apps={['Teams', 'WeChat']}
          via="tailscale"
          url={state === 'ready' ? 'https://studio-mac.tail1234.ts.net/conch' : undefined}
          onTailscale={() => {
            setState('starting');
            setTimeout(() => setState('ready'), 1200);
          }}
          onOwn={() => setState('ready')}
          onOff={() => setState('off')}
          onCheck={() => undefined}
        />
        <PublicDoor
          state="needs-you"
          apps={['Teams']}
          via="tailscale"
          problem={{
            message:
              'Tailscale needs your OK to make one address of this computer public. Open the page, press Enable, and Conch carries on by itself.',
            url: 'https://login.tailscale.com/f/funnel?node=n123',
          }}
          onTailscale={() => undefined}
          onOwn={() => undefined}
        />
        <PublicDoor
          state="error"
          via="own"
          apps={['WeChat']}
          message="https://conch.example.com doesn’t reach Conch. Make it forward to http://127.0.0.1:4319 on this computer, then press Try again."
          onTailscale={() => undefined}
          onOwn={() => undefined}
          onOff={() => undefined}
          ownError="Teams and WeChat only deliver to HTTPS addresses. Use one starting https://."
        />
      </Stack>
    );
  },
};
