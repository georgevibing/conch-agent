import type { Channel, ChannelCatalogEntry } from '@conch/protocol';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { appState, FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { ChannelDetailView } from './ChannelDetailView';
import { ConnectChannel } from './ConnectChannel';
import { slackCreateUrl, slackManifest, telegramNames } from './guides';

afterEach(() => vi.unstubAllGlobals());

const catalog: ChannelCatalogEntry[] = [
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'The easiest.',
    color: '#26A5E4',
    minutes: 2,
    available: true,
  },
  {
    id: 'discord',
    name: 'Discord',
    tagline: 'Privately.',
    color: '#5865F2',
    minutes: 4,
    available: true,
  },
  { id: 'slack', name: 'Slack', tagline: 'A DM.', color: '#4A154B', minutes: 4, available: true },
  { id: 'signal', name: 'Signal', tagline: 'Coming soon.', color: '#3A76F0', available: false },
];

const channel = (patch: Partial<Channel> = {}): Channel => ({
  id: 'ch_1',
  kind: 'telegram',
  enabled: true,
  createdAt: 1,
  bot: {
    id: '42',
    name: 'Ada’s Conch',
    username: 'adas_conch_bot',
    chatUrl: 'https://t.me/adas_conch_bot',
  },
  people: [],
  requests: [],
  blocked: 0,
  settings: { notifyRoutines: true },
  health: { state: 'online' },
  ...patch,
});

const ada = { id: '4242', name: 'Ada Lovelace', username: 'ada', since: 1 };

const base = {
  'GET /api/state': () => appState(),
  'GET /api/conversations': () => [],
};

// The list of chat apps is a filter of Apps now (ADR 0052): see integrations/Apps.test.tsx.

describe('Connecting Telegram', () => {
  it('suggests names, checks a pasted key at once, connects it and opens the hello link', async () => {
    const made = channel({
      pairing: {
        link: 'https://t.me/adas_conch_bot?start=abcdefghijklmnop',
        expiresAt: Date.now() + 600_000,
      },
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: made.bot, checked: ['token'] }),
      'POST /api/channels': () => made,
    });
    renderApp(<ConnectChannel kind="telegram" />, { route: '/channels/new/telegram' });
    expect(await screen.findByRole('heading', { name: 'Connect Telegram' })).toBeInTheDocument();
    // Answers for BotFather's two questions, ready to copy.
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Conch for Ada'));
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toMatch(
      /^ada_conch_\d{4}_bot$/,
    );

    await userEvent.click(screen.getByRole('button', { name: 'I have the key' }));
    const field = await screen.findByLabelText('Bot key');
    await userEvent.click(field);
    await userEvent.paste(
      'Use this token to access the HTTP API:\n123456789:' + 'AAHmockmockmockmockmockmockmockmock1',
    );
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/channels')?.body).toEqual({
        kind: 'telegram',
        // A field holds one line; the gateway finds the key in whatever was pasted.
        token: expect.stringContaining('123456789:' + 'AAHmockmockmockmockmockmockmockmock1'),
      }),
    );
    const open = await screen.findByRole('link', { name: 'Open in Telegram' });
    expect(open).toHaveAttribute('href', made.pairing?.link);
    expect(screen.getByText('Waiting for you to press Start')).toBeInTheDocument();

    // The owner presses Start in Telegram: the page hears it and says so.
    const socket = FakeSocket.last;
    act(() =>
      socket?.push({
        type: 'channel.changed',
        channel: { ...made, pairing: undefined, people: [ada] },
      }),
    );
    expect(await screen.findByText('You’re connected, Ada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a test message' })).toBeInTheDocument();
  });

  it('picks up a key pasted anywhere on the page', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({
        ok: false,
        field: 'token',
        message: 'Telegram doesn’t recognise this key.',
      }),
    });
    renderApp(<ConnectChannel kind="telegram" />, { route: '/channels/new/telegram' });
    await screen.findByRole('heading', { name: 'Connect Telegram' });
    const event = new Event('paste', { bubbles: true }) as Event & { clipboardData: unknown };
    event.clipboardData = {
      getData: () => 'token: 123456789:' + 'AAHmockmockmockmockmockmockmockmock1 thanks',
    };
    act(() => {
      window.dispatchEvent(event);
    });
    expect(await screen.findByLabelText('Bot key')).toHaveValue(
      '123456789:' + 'AAHmockmockmockmockmockmockmockmock1',
    );
    expect(await screen.findByText('Telegram doesn’t recognise this key.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/channels/check')).toBe(true);
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/channels')).toBe(false);
  });
});

describe('Saying hello on Discord and Slack', () => {
  it('asks “Is this you?” for the first message, and lets you in with one press', async () => {
    const waiting = channel({
      kind: 'discord',
      bot: {
        id: '7',
        name: 'Conch',
        username: 'conch_bot',
        chatUrl: 'https://discord.com/users/7',
        servers: 1,
      },
      requests: [
        {
          id: '4242',
          name: 'Ada Lovelace',
          username: 'ada',
          preview: 'hi',
          at: Date.now(),
          count: 1,
        },
      ],
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [waiting], catalog }),
      'POST /api/channels/ch_1/requests/4242': () => ({ ...waiting, requests: [], people: [ada] }),
    });
    renderApp(<ChannelDetailView channelId="ch_1" />, { route: '/channels/ch_1' });
    const ask = await screen.findByRole('article', { name: 'Is this you? Ada Lovelace' });
    // Confirming them is all that's left, so the big hello card steps aside.
    expect(screen.queryByRole('link', { name: 'Open in Discord' })).toBeNull();
    await userEvent.click(within(ask).getByRole('button', { name: 'That’s me' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/channels/ch_1/requests/4242')?.body).toEqual({
        answer: 'allow',
      }),
    );
    expect(await screen.findByRole('region', { name: /Who can talk/ })).toHaveTextContent(
      'Ada Lovelace',
    );
  });
});

describe('Connecting a Slack bot another app had one key for (ADR 0042)', () => {
  const half = {
    source: 'hermes' as const,
    label: 'Hermes',
    has: 'botToken' as const,
    bot: { id: 'U0BOT', name: 'Pearl', workspace: 'Babbage & Co' },
    appId: 'A0MOCKAPP',
  };
  const appKey = ['xapp', '1', 'A0MOCKAPP', '3333333333', 'mockmockmockmockmock'].join('-');

  it('picks up from Come home: the app is made, the bot token is there, and Slack’s page for the other key is one press away', async () => {
    const made = channel({ id: 'ch_s', kind: 'slack', bot: half.bot });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'GET /api/import/slack': () => ({ half }),
      'GET /api/auth': () => ({
        method: 'none',
        signedIn: true,
        setupRequired: false,
        secure: true,
      }),
      'POST /api/channels/check': () => ({
        ok: true,
        bot: { id: '', name: 'Slack app' },
        checked: ['appToken'],
        appId: 'A0MOCKAPP',
      }),
      'POST /api/import/hermes/slack': () => made,
    });
    renderApp(<ConnectChannel kind="slack" />, { route: '/channels/new/slack?from=hermes' });
    expect(await screen.findByText('Made, in Hermes')).toBeInTheDocument();
    expect(screen.getByText('From Hermes: Pearl in Babbage & Co')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /Open your app’s Socket Mode page/ });
    expect(open).toHaveAttribute('href', 'https://api.slack.com/apps/A0MOCKAPP/socket-mode');
    expect(screen.getByText(/only had the bot token/)).toHaveTextContent(
      'keep the connections:write scope it suggests',
    );
    // No box asks for the key Conch already has.
    expect(screen.queryByLabelText('Bot token')).toBeNull();

    await userEvent.click(screen.getByLabelText('App-level token'));
    await userEvent.paste(appKey);
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/import/hermes/slack').at(-1)?.body).toEqual({
        appToken: appKey,
      }),
    );
    // The bot token never travelled from the page.
    expect(JSON.stringify(calls)).not.toContain('xoxb-');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/channels')).toBe(false);
  });

  it('offers the key it found when you open Connect Slack yourself, and only uses it if you say so', async () => {
    mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'GET /api/import/slack': () => ({ half }),
    });
    renderApp(<ConnectChannel kind="slack" />, { route: '/channels/new/slack' });
    const offer = await screen.findByText('Hermes had this bot’s bot token');
    expect(screen.getByRole('link', { name: /Make the app in Slack/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use it' }));
    expect(offer).not.toBeInTheDocument();
    expect(await screen.findByText('Made, in Hermes')).toBeInTheDocument();
  });
});

describe('A channel’s page', () => {
  it('asks for a new key when the app stopped taking the old one, and reconnects', async () => {
    const broken = channel({
      people: [ada],
      health: { state: 'needs-token', message: 'Telegram stopped accepting this bot’s key.' },
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [broken], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: broken.bot, checked: ['token'] }),
      'PUT /api/channels/ch_1/token': () => ({ ...broken, health: { state: 'online' } }),
    });
    renderApp(<ChannelDetailView channelId="ch_1" />, { route: '/channels/ch_1' });
    expect(await screen.findByText('It needs a new key')).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText('New key'),
      '123456789:' + 'AAHrenewedrenewedrenewedrenewed123',
    );
    const reconnect = screen.getByRole('button', { name: 'Reconnect' });
    await waitFor(() => expect(reconnect).toBeEnabled());
    await userEvent.click(reconnect);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    await waitFor(() => expect(screen.queryByText('It needs a new key')).toBeNull());
  });

  it('lets people in, blocks, and removes them', async () => {
    const busy = channel({
      people: [ada, { id: '5151', name: 'Grace Hopper', since: 1 }],
      requests: [{ id: '666', name: 'Eve', preview: 'let me in', at: Date.now(), count: 3 }],
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [busy], catalog }),
      'POST /api/channels/ch_1/requests/666': () => ({ ...busy, requests: [], blocked: 1 }),
      'DELETE /api/channels/ch_1/people/5151': () => ({ ...busy, people: [ada] }),
    });
    renderApp(<ChannelDetailView channelId="ch_1" />, { route: '/channels/ch_1' });
    const waiting = await screen.findByRole('region', { name: 'Waiting to be let in' });
    expect(waiting).toHaveTextContent('3 messages');
    await userEvent.click(within(waiting).getByRole('button', { name: 'Block' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/channels/ch_1/requests/666')?.body).toEqual({
        answer: 'block',
      }),
    );
    const people = screen.getByRole('region', { name: /Who can talk/ });
    expect(within(people).queryByRole('button', { name: /Stop Ada/ })).toBeNull();
    await userEvent.click(
      within(people).getByRole('button', { name: 'Stop Grace Hopper talking to Conch' }),
    );
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('Guides', () => {
  it('suggests Telegram names that fit its rules', () => {
    const names = telegramNames('Conch', 'Zoë Ångström', '1234');
    expect(names).toEqual({ name: 'Conch for Zoë', username: 'zoe_conch_1234_bot' });
    expect(telegramNames('My Helper!', undefined, '9999').username).toBe('my_my_helper_9999_bot');
    expect(
      telegramNames('x'.repeat(40), 'Bartholomew', '1111').username.length,
    ).toBeLessThanOrEqual(32);
  });

  it('makes a Slack app that can be messaged privately over Socket Mode', () => {
    const manifest = slackManifest('Conch');
    expect(manifest.features.app_home).toMatchObject({
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    });
    expect(manifest.settings).toMatchObject({
      socket_mode_enabled: true,
      event_subscriptions: { bot_events: ['message.im'] },
    });
    expect(manifest.oauth_config.scopes.bot).toEqual(
      expect.arrayContaining(['chat:write', 'im:history']),
    );
    // The same app is Slack with every model: it reads and sends as you (ADR 0049).
    expect(manifest.oauth_config.scopes.user).toEqual(
      expect.arrayContaining(['search:read', 'channels:history', 'chat:write']),
    );
    const url = new URL(slackCreateUrl('Conch'));
    expect(url.searchParams.get('new_app')).toBe('1');
    expect(JSON.parse(url.searchParams.get('manifest_json') ?? '{}')).toEqual(manifest);
  });
});

describe('When connecting fails', () => {
  it('says why once, and tries again only for a different key', async () => {
    let creates = 0;
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: channel().bot, checked: ['token'] }),
      'POST /api/channels': () => {
        creates++;
        return new Response(
          JSON.stringify({ error: 'internal', message: 'Conch had a problem.' }),
          {
            status: 500,
          },
        );
      },
    });
    renderApp(<ConnectChannel kind="telegram" />, { route: '/channels/new/telegram' });
    await userEvent.click(await screen.findByRole('button', { name: 'I have the key' }));
    const field = screen.getByLabelText('Bot key');
    await userEvent.type(field, '123456789:' + 'AAHmockmockmockmockmockmockmockmock1');
    expect(await screen.findByText('Conch had a problem.')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 600));
    expect(creates).toBe(1);
    // A different key is a new try.
    await userEvent.type(field, '2');
    await waitFor(() => expect(creates).toBe(2));
    expect(calls.filter((c) => c.method === 'POST' && c.path === '/api/channels')).toHaveLength(2);
  });
});

describe('Linking WhatsApp and Signal', () => {
  const wa = channel({
    id: 'ch_wa',
    kind: 'whatsapp',
    bot: { id: '15550001111', name: 'Ada Lovelace', phone: '+15550001111' },
    people: [{ id: '15550001111', name: 'Ada Lovelace', since: 1 }],
    settings: { notifyRoutines: true, others: 'ignore' },
  });

  it('shows the code at once, says plainly what it risks, and welcomes you once scanned', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/link': () => ({ id: 'lk_1', kind: 'whatsapp', state: 'starting' }),
      'GET /api/channels/link/lk_1': () => ({ id: 'lk_1', kind: 'whatsapp', state: 'starting' }),
    });
    const { client } = renderApp(<ConnectChannel kind="whatsapp" />, {
      route: '/channels/new/whatsapp',
    });
    expect(await screen.findByText(/WhatsApp’s terms allow only its own apps/)).toBeInTheDocument();
    await waitFor(() =>
      expect(calls.some((c) => c.method === 'POST' && c.path === '/api/channels/link')).toBe(true),
    );
    // The phone's own screen, with the button to press.
    expect(screen.getByRole('figure', { name: /Linked devices in WhatsApp/ })).toBeInTheDocument();
    await screen.findByRole('heading', { name: 'Getting a code from WhatsApp' });
    act(() =>
      FakeSocket.last?.push({
        type: 'channel.link',
        link: {
          id: 'lk_1',
          kind: 'whatsapp',
          state: 'showing',
          qr: 'https://wa.me/settings/linked_devices#2@abc,def,ghi,jkl,7',
        },
      }),
    );
    expect(
      await screen.findByRole('img', { name: 'Scan with WhatsApp on your phone' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Link a device', { selector: 'li b' })).toBeInTheDocument();
    client.setQueryData(['channels'], { channels: [], catalog });
    act(() => {
      FakeSocket.last?.push({ type: 'channel.changed', channel: wa });
      FakeSocket.last?.push({
        type: 'channel.link',
        link: {
          id: 'lk_1',
          kind: 'whatsapp',
          state: 'linked',
          channelId: 'ch_wa',
          phone: '+15550001111',
        },
      });
    });
    expect(await screen.findByText('You’re connected, Ada')).toBeInTheDocument();
    expect(screen.getByText(/Message yourself/, { selector: 'b' })).toBeInTheDocument();
  });

  it('Signal without signal-cli: one button to install it', async () => {
    mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'GET /api/needs/signal-cli': () => ({
        id: 'signal-cli',
        name: 'signal-cli',
        short: 'signal-cli',
        present: false,
      }),
      'POST /api/channels/link': () => ({
        id: 'lk_2',
        kind: 'signal',
        state: 'needs-install',
        need: 'signal-cli',
        message: 'Signal needs signal-cli, which isn’t on this computer yet.',
      }),
    });
    renderApp(<ConnectChannel kind="signal" />, { route: '/channels/new/signal' });
    expect(await screen.findByText(/Signal needs signal-cli/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the code' })).toBeInTheDocument();
  });

  it('unlinked on the phone: link again from the channel’s page; your own number stays yours', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({
        channels: [
          {
            ...wa,
            health: { state: 'needs-token', message: 'WhatsApp unlinked Conch.' },
          },
        ],
        catalog,
      }),
      'PATCH /api/channels/ch_wa': () => ({
        ...wa,
        settings: { notifyRoutines: true, others: 'ask' },
      }),
      'POST /api/channels/link': () => ({
        id: 'lk_3',
        kind: 'whatsapp',
        state: 'starting',
        channelId: 'ch_wa',
      }),
      'GET /api/channels/link/lk_3': () => ({ id: 'lk_3', kind: 'whatsapp', state: 'starting' }),
    });
    const user = userEvent.setup();
    renderApp(<ChannelDetailView channelId="ch_wa" />, { route: '/channels/ch_wa' });
    expect(await screen.findByText('Link WhatsApp again')).toBeInTheDocument();
    expect(screen.getByText(/\+1 555 000 1111 on WhatsApp/)).toBeInTheDocument();
    expect(screen.getByText(/Conch never reads their chats/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show the code' }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.method === 'POST' && c.path === '/api/channels/link')?.body,
      ).toEqual({ kind: 'whatsapp', channelId: 'ch_wa' }),
    );
    await user.click(screen.getByRole('switch', { name: /A number just for/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        settings: { others: 'ask' },
      }),
    );
  });
});
describe('Connecting iMessage', () => {
  it('asks for Full Disk Access first, opens System Settings, and moves on once it’s on', async () => {
    let access: 'full-disk-access' | 'ready' = 'full-disk-access';
    const made = channel({
      id: 'ch_im',
      kind: 'imessage',
      bot: {
        id: 'iYWRh',
        name: 'You, on this Mac',
        address: 'ada@icloud.com',
        chatUrl: 'sms:ada@icloud.com',
      },
      people: [{ id: 'iYWRh', name: 'Ada Lovelace', username: 'ada@icloud.com', since: 1 }],
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'GET /api/channels/imessage': () => ({
        access,
        handles: access === 'ready' ? ['ada@icloud.com'] : [],
        app: 'Terminal',
      }),
      'POST /api/channels/imessage/open': () => ({ ok: true }),
      'POST /api/channels': () => made,
    });
    renderApp(<ConnectChannel kind="imessage" />, { route: '/channels/new/imessage' });
    expect(await screen.findByRole('heading', { name: 'Connect iMessage' })).toBeInTheDocument();
    expect(screen.getByText(/turn on/)).toHaveTextContent('Full Disk Access and turn on Terminal');
    expect(
      screen.getByRole('figure', { name: 'System Settings, on Full Disk Access' }),
    ).toHaveTextContent('Terminal (off) (turn this on)');
    await userEvent.click(screen.getByRole('button', { name: 'Open System Settings' }));
    expect(calls.find((c) => c.path === '/api/channels/imessage/open')?.body).toEqual({
      place: 'full-disk-access',
    });

    // Turned on in System Settings: the page notices by itself.
    access = 'ready';
    expect(await screen.findByText('ada@icloud.com', {}, { timeout: 5000 })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/channels')?.body).toEqual({
        kind: 'imessage',
        mode: 'self',
        handle: 'ada@icloud.com',
      }),
    );
    expect(await screen.findByText('You’re connected, Ada')).toBeInTheDocument();
    expect(screen.getByText(/Text yourself at/)).toHaveTextContent('ada@icloud.com');
  });

  it('says plainly when this isn’t a Mac', async () => {
    mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'GET /api/channels/imessage': () => ({ access: 'not-mac', handles: [] }),
    });
    renderApp(<ConnectChannel kind="imessage" />, { route: '/channels/new/imessage' });
    expect(await screen.findByText('iMessage only works on a Mac')).toBeInTheDocument();
  });

  it('shows the switch to turn on, on the channel’s page, when macOS took it away', async () => {
    mockFetch({
      ...base,
      'GET /api/channels': () => ({
        channels: [
          channel({
            kind: 'imessage',
            bot: { id: 'i1', name: 'You, on this Mac', address: 'ada@icloud.com' },
            people: [ada],
            health: {
              state: 'error',
              access: 'full-disk-access',
              message: 'macOS hides Messages.',
            },
          }),
        ],
        catalog,
      }),
      'GET /api/channels/imessage': () => ({
        access: 'full-disk-access',
        handles: [],
        app: 'iTerm',
      }),
    });
    renderApp(<ChannelDetailView channelId="ch_1" />, { route: '/channels/ch_1' });
    expect(await screen.findByText('Turn on Full Disk Access')).toBeInTheDocument();
    await waitFor(() => expect(document.body).toHaveTextContent('turn on iTerm'));
    expect(screen.getByText('Needs your OK on this Mac')).toBeInTheDocument();
    expect(screen.getByText(/never reads their chats/)).toBeInTheDocument();
  });
});

describe('Connecting email', () => {
  it('picks the service from the address, checks the app password, and you’re in', async () => {
    const made = channel({
      id: 'ch_mail',
      kind: 'email',
      bot: {
        id: 'mYWRh',
        name: 'ada@gmail.com',
        address: 'ada+conch@gmail.com',
        chatUrl: 'mailto:ada+conch@gmail.com?subject=Hello',
      },
      people: [{ id: 'mYWRh', name: 'Ada Lovelace', username: 'ada@gmail.com', since: 1 }],
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: made.bot, checked: ['password'] }),
      'POST /api/channels': () => made,
    });
    renderApp(<ConnectChannel kind="email" />, { route: '/channels/new/email' });
    await userEvent.type(await screen.findByLabelText('Email address'), 'ada@gmail.com');
    expect(screen.getByRole('radio', { name: 'Gmail' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('link', { name: /Make one in Gmail/ })).toHaveAttribute(
      'href',
      'https://myaccount.google.com/apppasswords',
    );
    await userEvent.click(screen.getByLabelText('App password'));
    await userEvent.paste('abcd efgh ijkl mnop');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/channels')?.body).toEqual({
        kind: 'email',
        provider: 'gmail',
        address: 'ada@gmail.com',
        password: 'abcd efgh ijkl mnop',
      }),
    );
    expect(await screen.findByText('You’re connected, Ada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Write an email' })).toHaveAttribute(
      'href',
      'mailto:ada+conch@gmail.com?subject=Hello',
    );
  });

  it('says Outlook needs a sign-in Conch can’t do yet, instead of failing later', async () => {
    const calls = mockFetch({ ...base, 'GET /api/channels': () => ({ channels: [], catalog }) });
    renderApp(<ConnectChannel kind="email" />, { route: '/channels/new/email' });
    await userEvent.type(await screen.findByLabelText('Email address'), 'ada@outlook.com');
    expect(screen.getByText('Outlook doesn’t take app passwords any more')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(calls.some((c) => c.path === '/api/channels/check')).toBe(false);
  });

  it('asks for only a new app password when the old one stops working', async () => {
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({
        channels: [
          channel({
            kind: 'email',
            bot: { id: 'm1', name: 'ada@gmail.com', address: 'ada+conch@gmail.com' },
            people: [ada],
            health: { state: 'needs-token', message: 'Gmail didn’t take that app password.' },
          }),
        ],
        catalog,
      }),
      'PUT /api/channels/ch_1/token': () => channel({ kind: 'email', people: [ada] }),
    });
    renderApp(<ChannelDetailView channelId="ch_1" />, { route: '/channels/ch_1' });
    expect(await screen.findByText('It needs a new app password')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New app password'), 'qrst uvwx yzab cdef');
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        kind: 'email',
        password: 'qrst uvwx yzab cdef',
      }),
    );
  });
});

describe('Connecting Matrix', () => {
  it('signs in with the password once, and never checks it by itself', async () => {
    const made = channel({
      kind: 'matrix',
      bot: {
        id: '@pearl:matrix.org',
        name: 'Pearl',
        username: 'pearl:matrix.org',
        chatUrl: 'https://matrix.to/#/%40pearl%3Amatrix.org',
      },
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels': () => made,
    });
    renderApp(<ConnectChannel kind="matrix" />, { route: '/channels/new/matrix' });
    expect(await screen.findByRole('heading', { name: 'Connect Matrix' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'It has an account' }));
    expect(screen.getByLabelText('Homeserver')).toHaveValue('matrix.org');
    await userEvent.type(screen.getByLabelText('Username'), 'pearl');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    expect(calls.some((c) => c.path === '/api/channels/check')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/channels')?.body).toEqual({
        kind: 'matrix',
        homeserver: 'matrix.org',
        user: 'pearl',
        password: 'correct horse',
      }),
    );
    expect(
      await screen.findByText(/start a direct message with @pearl:matrix.org/),
    ).toBeInTheDocument();
  });
});

describe('Connecting Microsoft Teams', () => {
  const door = (state: string, url?: string) => ({
    state,
    apps: ['microsoftteams'],
    ...(url && { url, via: 'tailscale' }),
  });
  it('checks the Bot ID and secret together, then asks for a public address, then where to paste it', async () => {
    const made = channel({
      kind: 'microsoftteams',
      bot: { id: '00000000-0000-4000-8000-00000000c0c4', name: 'Teams bot' },
      hook: {},
      health: { state: 'error', message: 'Teams can’t reach Conch yet.' },
    });
    let doorState = door('off');
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: made.bot, checked: [] }),
      'POST /api/channels': () => made,
      'GET /api/channels/door': () => doorState,
      'POST /api/channels/door/tailscale': () => {
        doorState = door('ready', 'https://mac.tail1.ts.net/conch');
        return doorState;
      },
      'GET /api/auth': () => ({ method: 'none' }),
    });
    renderApp(<ConnectChannel kind="microsoftteams" />, { route: '/channels/new/microsoftteams' });
    expect(
      await screen.findByRole('heading', { name: 'Connect Microsoft Teams' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the Developer Portal' })).toHaveAttribute(
      'href',
      'https://dev.teams.microsoft.com/bots',
    );
    await userEvent.click(screen.getByRole('button', { name: 'I made it' }));
    await userEvent.type(
      screen.getByLabelText('Bot ID'),
      'App ID: 00000000-0000-4000-8000-00000000c0c4',
    );
    expect(screen.getByLabelText('Bot ID')).toHaveValue('00000000-0000-4000-8000-00000000c0c4');
    await userEvent.type(screen.getByLabelText('Client secret'), 'secret~value');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/channels')?.body).toEqual({
        kind: 'microsoftteams',
        appId: '00000000-0000-4000-8000-00000000c0c4',
        appPassword: 'secret~value',
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on with Tailscale' }));
    // The step closes on the address; the next says where to paste the channel's own.
    expect(await screen.findByText(/At https:\/\/mac\.tail1\.ts\.net\/conch/)).toBeInTheDocument();
  });

  it('asks for the directory (tenant) ID only when Microsoft needs it', async () => {
    mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({
        ok: false,
        field: 'tenantId',
        message:
          'This bot belongs to your organisation only (single-tenant). Paste its Directory (tenant) ID too.',
      }),
      'GET /api/channels/door': () => door('off'),
    });
    renderApp(<ConnectChannel kind="microsoftteams" />, { route: '/channels/new/microsoftteams' });
    await userEvent.click(await screen.findByRole('button', { name: 'I made it' }));
    expect(screen.queryByLabelText('Directory (tenant) ID')).toBeNull();
    await userEvent.type(screen.getByLabelText('Bot ID'), '00000000-0000-4000-8000-00000000c0c4');
    await userEvent.type(screen.getByLabelText('Client secret'), 'secret');
    expect(await screen.findByLabelText('Directory (tenant) ID')).toBeInTheDocument();
  });
});

describe('Connecting WeChat', () => {
  it('offers the WeCom bot first, and says why personal WeChat can’t be one', async () => {
    const made = channel({
      kind: 'wechat',
      bot: { id: 'aibMock', name: 'WeCom bot', account: 'wecom' },
    });
    const calls = mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: made.bot, checked: [] }),
      'POST /api/channels': () => made,
    });
    renderApp(<ConnectChannel kind="wechat" />, { route: '/channels/new/wechat' });
    expect(await screen.findByRole('heading', { name: 'Connect WeChat' })).toBeInTheDocument();
    expect(screen.getByText(/Personal WeChat accounts can’t be bots/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /A WeCom bot/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'I made it' }));
    await userEvent.type(screen.getByLabelText('Bot ID'), 'aibMock');
    await userEvent.type(screen.getByLabelText('Secret'), 'the-secret');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST' && c.path === '/api/channels')?.body).toEqual({
        kind: 'wechat',
        mode: 'wecom',
        appId: 'aibMock',
        secret: 'the-secret',
      }),
    );
  });

  it('an Official Account: the test account’s page, then the public address and the three things to paste', async () => {
    const made = channel({
      kind: 'wechat',
      bot: { id: 'wx' + '0123456789abcdef', name: 'Official Account', account: 'official' },
      hook: { url: 'https://mac.tail1.ts.net/conch/hooks/abc' },
    });
    mockFetch({
      ...base,
      'GET /api/channels': () => ({ channels: [], catalog }),
      'POST /api/channels/check': () => ({ ok: true, bot: made.bot, checked: [] }),
      'POST /api/channels': () => made,
      'GET /api/channels/door': () => ({
        state: 'ready',
        apps: ['wechat'],
        via: 'tailscale',
        url: 'https://mac.tail1.ts.net/conch',
      }),
      'GET /api/channels/ch_1/hook': () => ({
        url: made.hook?.url,
        token: 'Tok3n',
        aesKey: 'k'.repeat(43),
      }),
      'GET /api/auth': () => ({ method: 'none' }),
    });
    renderApp(<ConnectChannel kind="wechat" />, { route: '/channels/new/wechat' });
    await userEvent.click(await screen.findByRole('radio', { name: /An Official Account/ }));
    expect(screen.getByRole('link', { name: 'Open the test account page' })).toHaveAttribute(
      'href',
      expect.stringContaining('mp.weixin.qq.com/debug'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'I have one' }));
    await userEvent.type(screen.getByLabelText('AppID'), 'wx' + '0123456789abcdef');
    await userEvent.type(screen.getByLabelText('AppSecret'), '0123456789abcdef0123456789abcdef');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Show the Token and EncodingAESKey' }),
    );
    expect(await screen.findByDisplayValue('Tok3n')).toBeInTheDocument();
    expect(
      screen.getByDisplayValue('https://mac.tail1.ts.net/conch/hooks/abc'),
    ).toBeInTheDocument();
  });
});
