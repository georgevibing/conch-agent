import type { CatalogEntry, GoogleAccount, Integration } from '@conch/protocol';
import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { IntegrationDetailView } from './IntegrationDetailView';
import { AppsView } from './AppsView';

configure({ asyncUtilTimeout: 4000 });
afterEach(() => vi.unstubAllGlobals());

/** Gmail, Google Calendar and Google Drive as ordinary apps (ADR 0048). */
const entry = (id: string, name: string): CatalogEntry => ({
  id,
  name,
  tagline: `${name} tagline`,
  description: `Use ${name}.`,
  category: 'productivity',
  auth: 'google',
  local: false,
  fields: [],
  steps: [],
  examples: ['What did I miss?'],
  access: [],
  featured: true,
});
const catalog = [
  entry('gmail', 'Gmail'),
  entry('google-calendar', 'Google Calendar'),
  entry('google-drive', 'Google Drive'),
];

const gmail = (patch: Partial<Integration> = {}): Integration => ({
  id: 'gmail',
  catalogId: 'gmail',
  name: 'Gmail',
  server: 'gmail',
  transport: { type: 'host', how: 'With an app password (Gmail only, can’t send)' },
  auth: 'token',
  enabled: true,
  policy: 'ask-writes',
  health: { state: 'ok', checkedAt: 1, okAt: 1 },
  tools: [
    {
      name: 'google_mail_search',
      title: 'Search your mail',
      description: '',
      access: 'read',
      destructive: false,
    },
    {
      name: 'google_mail_read',
      title: 'Read an email',
      description: '',
      access: 'read',
      destructive: false,
    },
    {
      name: 'google_mail_create_draft',
      title: 'Save a draft',
      description: '',
      access: 'write',
      destructive: false,
      asksFirst: true,
    },
    {
      name: 'google_mail_send',
      title: 'Send an email',
      description: '',
      access: 'write',
      destructive: false,
      asksFirst: true,
    },
  ],
  values: {},
  secrets: [],
  account: 'ada@gmail.com',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});

const account = (patch: Partial<GoogleAccount> = {}): GoogleAccount => ({
  id: 'pw-ada',
  email: 'ada@gmail.com',
  name: 'ada@gmail.com',
  capabilities: ['mail-read', 'mail-draft', 'mail-send'],
  state: 'ready',
  via: 'app-password',
  access: { gmail: 'write' },
  granted: { gmail: 'write' },
  ...patch,
});

describe('Google apps on the Integrations page', () => {
  it('has no Google box at the top: a connected Gmail is a card, and its tile is gone', async () => {
    mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [gmail()] }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    const connected = await screen.findByRole('region', { name: 'Connected' });
    expect(within(connected).getByRole('button', { name: 'Gmail' })).toBeInTheDocument();
    expect(within(connected).getByRole('switch', { name: /Gmail/ })).toBeChecked();
    expect(screen.queryByText('What would you like to do with Google?')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Google accounts' })).toBeNull();
    const add = screen.getByRole('region', { name: 'Add another app' });
    expect(within(add).queryByRole('button', { name: 'Gmail' })).toBeNull();
    expect(within(add).getByRole('button', { name: 'Google Calendar' })).toBeInTheDocument();
  });

  it('adds a Gmail account the simplest way: choose what it does, an app password, a paste', async () => {
    let tries = 0;
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google': () => ({ configured: false, accounts: [] }),
      'GET /api/google/mail/reusable': () => ({}),
      'POST /api/google/mail/password': () =>
        ++tries === 1
          ? new Response(
              JSON.stringify({
                error: 'expired',
                message:
                  'Gmail didn’t take that app password. Make a new one at Google and paste it.',
              }),
              { status: 400 },
            )
          : { configured: false, accounts: [account({ access: { gmail: 'write' } })] },
      'POST /api/google/apps/gmail/use': () => ({ ok: true }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Gmail' });
    // 1. What it should help with: Gmail, as the tile said; Read & write chosen here.
    const gmailLevels = within(dialog).getByRole('radiogroup', { name: 'Gmail' });
    expect(within(gmailLevels).getByRole('radio', { name: 'Read' })).toBeChecked();
    await userEvent.click(within(gmailLevels).getByRole('radio', { name: 'Read & write' }));
    expect(within(dialog).getByText(/Also save drafts and send email/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    // 2. How: an app password is simplest for Gmail alone, with the trade-off in a line.
    const how = within(dialog).getByRole('radiogroup', { name: 'How to connect' });
    expect(within(how).getByRole('radio', { name: /App password.*Simplest/ })).toBeChecked();
    expect(within(how).getByText(/Gmail only/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    // 3. Connect.
    await userEvent.type(within(dialog).getByLabelText('Gmail address'), 'ada@gmail.com{Enter}');
    expect(
      within(dialog).getByRole('link', { name: /Google’s app passwords page/ }),
    ).toHaveAttribute('href', 'https://myaccount.google.com/apppasswords');
    expect(within(dialog).getByText(/2-Step Verification/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('App password'), 'zzzz zzzz zzzz zzzz');
    expect(await within(dialog).findByText(/didn’t take that app password/)).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText('App password'));
    await userEvent.type(within(dialog).getByLabelText('App password'), 'abcd efgh ijkl mnop');
    expect(await screen.findByRole('heading', { name: 'Gmail is connected' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/google/mail/password').at(-1)?.body).toEqual({
      address: 'ada@gmail.com',
      password: 'abcdefghijklmnop',
      access: 'write',
    });
  });

  it('offers the email channel’s Gmail sign-in, and uses it only when asked', async () => {
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google': () => ({ configured: false, accounts: [] }),
      'GET /api/google/mail/reusable': () => ({ address: 'ada@gmail.com' }),
      'POST /api/google/mail/reuse': () => ({ configured: false, accounts: [account()] }),
      'POST /api/google/apps/gmail/use': () => ({ ok: true }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Gmail' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(
      await within(dialog).findByText(/signs in to Gmail as ada@gmail.com/),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/google/mail/reuse')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use it for Gmail' }));
    expect(await screen.findByRole('heading', { name: 'Gmail is connected' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/google/mail/reuse')).toHaveLength(1);
  });

  it('says plainly that Calendar needs Google sign-in, and sets up the Google app with a drop zone', async () => {
    mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google': () => ({ configured: false, accounts: [] }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Google Calendar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Google Calendar' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).queryByRole('radiogroup', { name: 'How to connect' })).toBeNull();
    expect(within(dialog).getByText(/only open to Google’s own sign-in/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'I already have a credential file' }),
    );
    expect(
      within(dialog).getByRole('group', { name: 'Drop the file you downloaded' }),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('App password')).toBeNull();
  });

  it('Google sign-in is simplest once the Google app is set up, even for Gmail alone', async () => {
    mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google': () => ({ configured: true, clientType: 'desktop', accounts: [] }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Gmail' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    const how = within(dialog).getByRole('radiogroup', { name: 'How to connect' });
    expect(within(how).getByRole('radio', { name: /Google sign-in.*Simplest/ })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    expect(within(dialog).getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  });

  it('uses an account that’s already connected for another app in one tap', async () => {
    const work = account({
      id: 'work',
      email: 'ada@work.example',
      via: 'google',
      capabilities: ['mail-read'],
      access: { gmail: 'read' },
      granted: { gmail: 'write', calendar: 'read' },
    });
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [gmail()] }),
      'GET /api/google': () => ({ configured: true, accounts: [work] }),
      'POST /api/google/accounts/work/access': () => ({
        configured: true,
        accounts: [{ ...work, access: { gmail: 'read', calendar: 'read' } }],
      }),
      'POST /api/google/apps/google-calendar/use': () => ({ ok: true }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Google Calendar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Google Calendar' });
    const card = within(dialog).getByRole('article', { name: 'ada@work.example' });
    // Only this app's row here; Read & write would ask Google, so it says so.
    expect(within(card).queryByRole('radiogroup', { name: 'Gmail' })).toBeNull();
    expect(within(card).getByText('Read & write asks Google once.')).toBeInTheDocument();
    const levels = within(card).getByRole('radiogroup', { name: 'Google Calendar' });
    await userEvent.click(within(levels).getByRole('radio', { name: 'Read' }));
    expect(
      await screen.findByRole('heading', { name: 'Google Calendar is connected' }),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/google/accounts/work/access')?.body).toEqual({
      product: 'calendar',
      level: 'read',
    });
  });

  it('asks Google once for write access, right on the account, keeping what it already has', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const work = account({
      id: 'work',
      email: 'ada@work.example',
      via: 'google',
      capabilities: ['mail-read', 'calendar-read'],
      access: { gmail: 'read', calendar: 'read' },
      granted: { gmail: 'read', calendar: 'read' },
    });
    const calls = mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [],
        integrations: [gmail({ id: 'google-calendar', catalogId: 'google-calendar' })],
      }),
      'GET /api/google': () => ({ configured: true, accounts: [work] }),
      'POST /api/google/connect': () => ({
        url: 'https://accounts.google.com/auth',
        flowId: 'more',
        mode: 'automatic',
      }),
      'GET /api/google/flows/more': () => ({ state: 'pending', mode: 'automatic' }),
    });
    renderApp(<IntegrationDetailView integrationId="google-calendar" />, {
      route: '/apps/google-calendar',
    });
    const card = await screen.findByRole('article', { name: 'ada@work.example' });
    const levels = within(card).getByRole('radiogroup', { name: 'Google Calendar' });
    await userEvent.click(within(levels).getByRole('radio', { name: 'Read & write' }));
    expect(
      within(card).getByText('Allow Google Calendar read & write for ada@work.example'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.includes('/access'))).toBe(false);
    await userEvent.click(within(card).getByRole('button', { name: 'Allow on Google' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/google/connect')?.body).toEqual({
        capabilities: ['mail-read', 'calendar-read', 'calendar-write'],
        accountId: 'work',
      }),
    );
  });
});

describe('a Google app’s page', () => {
  it('has Allow · Ask · Off per tool, and lists every Google account with what it may do', async () => {
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [gmail()] }),
      'GET /api/google': () => ({
        configured: false,
        accounts: [account({ access: { gmail: 'write' }, granted: { gmail: 'write' } })],
      }),
      'PATCH /api/integrations/gmail': (body) => {
        const chosen = (body as { tools?: Record<string, 'allow' | 'ask' | 'off'> }).tools ?? {};
        return gmail({
          tools: gmail().tools.map((t) => (chosen[t.name] ? { ...t, policy: chosen[t.name] } : t)),
        });
      },
      'POST /api/google/accounts/pw-ada/access': () => ({
        configured: false,
        accounts: [account({ access: { gmail: 'read' }, granted: { gmail: 'write' } })],
      }),
    });
    renderApp(<IntegrationDetailView integrationId="gmail" />, { route: '/apps/gmail' });
    expect(await screen.findByRole('heading', { name: 'Gmail' })).toBeInTheDocument();
    // Read & write can send: the tool is there, Ask by default, and says what that means.
    const send = screen.getByRole('radiogroup', { name: 'Send an email' });
    expect(within(send).getByRole('radio', { checked: true })).toHaveTextContent('Ask');
    expect(send).toHaveAccessibleDescription('Asks you each time.');
    expect(screen.queryByText(/nothing is ever sent/)).toBeNull();
    expect(
      screen.getByText(/Sending and saving drafts show you the email first/),
    ).toBeInTheDocument();
    // Allow is the person's to choose, said plainly as it's chosen, with Undo.
    await userEvent.click(within(send).getByRole('radio', { name: 'Allow' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        tools: { google_mail_send: 'allow' },
      }),
    );
    expect(
      await screen.findByText('Conch will send an email without showing you first.'),
    ).toBeInTheDocument();
    calls.length = 0;
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Read an email' })).getByRole('radio', {
        name: 'Off',
      }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
        tools: { google_mail_read: 'off' },
      }),
    );
    const list = screen.getByRole('list', { name: 'Google accounts' });
    const card = within(list).getByRole('article', { name: 'ada@gmail.com' });
    expect(
      within(card).getByText(
        'App password · Gmail: read and send. Calendar and Drive need Google sign-in.',
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole('button', { name: 'Switch to Google sign-in' }),
    ).toBeInTheDocument();
    // An app password reaches Gmail only: Calendar and Drive say how to get there.
    expect(within(card).getAllByRole('button', { name: 'Use Google sign-in' })).toHaveLength(2);
    // Taking access away is one tap.
    const levels = within(card).getByRole('radiogroup', { name: 'Gmail' });
    expect(within(levels).getByRole('radio', { name: 'Read & write' })).toBeChecked();
    await userEvent.click(within(levels).getByRole('radio', { name: 'Read' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/google/accounts/pw-ada/access')?.body).toEqual({
        product: 'gmail',
        level: 'read',
      }),
    );
  });

  it('says how to allow changes when every account only reads', async () => {
    mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [],
        integrations: [gmail({ tools: gmail().tools.filter((t) => t.access === 'read') })],
      }),
      'GET /api/google': () => ({
        configured: false,
        accounts: [account({ capabilities: ['mail-read'], access: { gmail: 'read' } })],
      }),
    });
    renderApp(<IntegrationDetailView integrationId="gmail" />, { route: '/apps/gmail' });
    const abilities = await screen.findByRole('list', { name: /What Gmail does/ });
    expect(within(abilities).getByText('Draft & send')).toBeInTheDocument();
    expect(
      within(abilities).getByText(/Choose Read & write on one under Google accounts/),
    ).toBeInTheDocument();
    await userEvent.click(within(abilities).getByRole('button', { name: 'Allow' }));
    expect(screen.getByRole('heading', { name: 'Google accounts' })).toHaveFocus();
  });

  it('a refused app password has its one fix on the page: paste a new one', async () => {
    const calls = mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [],
        integrations: [
          gmail({
            health: {
              state: 'needs-auth',
              message:
                'Gmail didn’t take that app password. Make a new one at Google and paste it.',
              action: 'reconnect',
            },
          }),
        ],
      }),
      'GET /api/google': () => ({
        configured: false,
        accounts: [account({ state: 'needs-auth' })],
      }),
      'GET /api/google/mail/reusable': () => ({}),
      'POST /api/google/mail/password': () => ({ configured: false, accounts: [account()] }),
    });
    renderApp(<IntegrationDetailView integrationId="gmail" />, { route: '/apps/gmail' });
    expect(await screen.findByRole('button', { name: 'Sign in again' })).toBeInTheDocument();
    const card = await screen.findByRole('article', { name: 'ada@gmail.com' });
    expect(within(card).getByText('Needs you')).toBeInTheDocument();
    expect(
      await within(card).findByRole('heading', { name: /done:\s*Your Gmail address/ }),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('App password'), 'abcdefghijklmnop');
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/google/mail/password')?.body).toEqual({
        address: 'ada@gmail.com',
        password: 'abcdefghijklmnop',
        accountId: 'pw-ada',
      }),
    );
  });

  it('says plainly when a sign-in can’t send, and offers the app password that can', async () => {
    mockFetch({
      'GET /api/integrations': () => ({
        catalog,
        providers: [],
        integrations: [gmail({ auth: 'oauth', tools: gmail().tools.slice(0, 2) })],
      }),
      'GET /api/google': () => ({
        configured: true,
        accounts: [
          account({
            id: 'work',
            email: 'ada@work.example',
            name: 'ada@work.example',
            via: 'google',
            capabilities: ['mail-read', 'calendar-read'],
            access: { gmail: 'read', calendar: 'read' },
            granted: { gmail: 'read', calendar: 'read' },
          }),
        ],
      }),
      'GET /api/google/mail/reusable': () => ({}),
    });
    renderApp(<IntegrationDetailView integrationId="gmail" />, { route: '/apps/gmail' });
    const card = await screen.findByRole('article', { name: 'ada@work.example' });
    expect(
      within(card).getByText(
        'Google sign-in · Gmail read only: this sign-in can’t send yet. Calendar and Drive too.',
      ),
    ).toBeInTheDocument();
    expect(within(card).getByText('Read only: this sign-in can’t send.')).toBeInTheDocument();
    expect(
      within(card).getByText('Read & write asks Google once, so it can send.'),
    ).toBeInTheDocument();
    await userEvent.click(
      within(card).getByRole('button', { name: 'Use an app password instead' }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Use an app password for Gmail' });
    expect(
      within(dialog).getByText(/Calendar and Drive keep using Google sign-in/),
    ).toBeInTheDocument();
  });
});
