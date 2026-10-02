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
      alwaysAsks: true,
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
  capabilities: ['mail-read', 'mail-draft'],
  state: 'ready',
  via: 'app-password',
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

  it('connects Gmail with an app password by default: one link, a paste, checked by signing in', async () => {
    let tries = 0;
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
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
          : { configured: false, accounts: [account()] },
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Gmail' });
    await userEvent.type(within(dialog).getByLabelText('Gmail address'), 'ada@gmail.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
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
    });
  });

  it('offers the email channel’s Gmail sign-in, and uses it only when asked', async () => {
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google/mail/reusable': () => ({ address: 'ada@gmail.com' }),
      'POST /api/google/mail/reuse': () => ({ configured: false, accounts: [account()] }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Gmail' });
    expect(
      await within(dialog).findByText(/signs in to Gmail as ada@gmail.com/),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/api/google/mail/reuse')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Use it for Gmail' }));
    expect(await screen.findByRole('heading', { name: 'Gmail is connected' })).toBeInTheDocument();
    expect(calls.filter((c) => c.path === '/api/google/mail/reuse')).toHaveLength(1);
  });

  it('says plainly that Calendar needs your own Google Cloud app, and starts there', async () => {
    mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google': () => ({ configured: false, accounts: [] }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Google Calendar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Google Calendar' });
    expect(
      within(dialog).getByText('This needs a Google Cloud app of your own'),
    ).toBeInTheDocument();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'I already have a credential file' }),
    );
    // Said once: the dialog's own words, not a second heading about Google under them.
    expect(
      within(dialog).queryByRole('heading', { name: 'Google, connected to Conch' }),
    ).toBeNull();
    expect(within(dialog).getByLabelText('Google credential JSON')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('App password')).toBeNull();
  });

  it('keeps the advanced way for Gmail one press away, with the job picker in the dialog', async () => {
    mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [] }),
      'GET /api/google/mail/reusable': () => ({}),
      'GET /api/google': () => ({ configured: false, accounts: [] }),
    });
    renderApp(<AppsView />, { route: '/apps' });
    await userEvent.click(await screen.findByRole('button', { name: 'Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connect Gmail' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: /Use your own Google Cloud app instead/ }),
    );
    const job = within(dialog).getByRole('radiogroup', { name: 'What Gmail should do' });
    await userEvent.click(within(job).getByRole('radio', { name: 'Read and save drafts' }));
    expect(
      await within(dialog).findByText(/never calls Gmail’s send endpoint/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Back to the app password/ }));
    expect(within(dialog).getByLabelText('Gmail address')).toBeInTheDocument();
  });
});

describe('a Google app’s page', () => {
  it('has Allow · Ask · Off per tool, but saving a draft can only Ask or be Off', async () => {
    const calls = mockFetch({
      'GET /api/integrations': () => ({ catalog, providers: [], integrations: [gmail()] }),
      'GET /api/google': () => ({ configured: false, accounts: [account()] }),
      'PATCH /api/integrations/gmail': (body) =>
        gmail({ tools: gmail().tools, ...(body as object) }),
    });
    renderApp(<IntegrationDetailView integrationId="gmail" />, { route: '/apps/gmail' });
    expect(await screen.findByRole('heading', { name: 'Gmail' })).toBeInTheDocument();
    const draft = screen.getByRole('radiogroup', { name: 'Save a draft' });
    expect(within(draft).queryByRole('radio', { name: 'Allow' })).toBeNull();
    expect(screen.getByText(/Saving a draft always asks/)).toBeInTheDocument();
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
    expect(screen.getByText('With an app password (Gmail only, can’t send)')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Accounts' })).getByText('ada@gmail.com'),
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole('heading', { name: /done:\s*Your Gmail address/ }),
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
});
