import type {
  AccessSettings,
  AuthStatus,
  HelloCheck,
  PasskeyAssertion,
  PasskeyRegistration,
} from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../../api/client';
import { mockFetch, renderApp } from '../../test/harness';
import { HelloScreen } from './HelloScreen';
import type * as PasskeyModule from './passkey';
import { askPasskey, createPasskey, passkeySupport } from './passkey';
import { SecurityTab } from './SecurityTab';
import { SignIn } from './SignIn';
import { useVerify } from './useVerify';
import { WaitingForApproval } from './WaitingForApproval';

/**
 * Passkeys in the web app (ADR 0065) and the hello link (ADR 0064). The
 * browser's own prompt is pretend: `createPasskey` and `askPasskey` answer as
 * Touch ID would, and the gateway is `mockFetch`.
 */

vi.mock('./passkey', async (importOriginal) => {
  const real = await importOriginal<typeof PasskeyModule>();
  return {
    ...real,
    passkeySupport: vi.fn(),
    createPasskey: vi.fn(),
    askPasskey: vi.fn(),
    cancelPasskey: vi.fn(),
  };
});

const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15';

const REGISTRATION: PasskeyRegistration = {
  id: 'cred',
  rawId: 'cred',
  type: 'public-key',
  response: { clientDataJSON: 'e30', attestationObject: 'o2M' },
  clientExtensionResults: {},
};
const ASSERTION: PasskeyAssertion = {
  id: 'cred',
  rawId: 'cred',
  type: 'public-key',
  response: { clientDataJSON: 'e30', authenticatorData: 'AA', signature: 'AA' },
  clientExtensionResults: {},
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const status = (patch: Partial<AuthStatus> = {}): AuthStatus => ({
  method: 'password',
  signedIn: false,
  setupRequired: false,
  secure: true,
  ...patch,
});

const settings = (patch: Partial<AccessSettings> = {}): AccessSettings => ({
  method: 'passkey',
  suggestedUsername: 'ada',
  keys: [],
  passkeys: [
    {
      id: 'cred-1',
      name: 'Apple Passwords',
      rpId: 'conch.example.com',
      createdAt: Date.now() - 3 * 86_400_000,
      synced: true,
      here: true,
    },
  ],
  passkeysHere: true,
  sessions: [],
  devices: [],
  requests: [],
  approval: { on: true, here: false, canApprove: true },
  checkup: [],
  exposure: 'local',
  port: 4317,
  urls: [],
  verified: true,
  ...patch,
});

const hello = (patch: Partial<HelloCheck> = {}): HelloCheck => ({
  ok: true,
  expiresAt: Date.now() + 3_600_000,
  address: 'conch.example.com',
  suggestedUsername: 'george',
  passkeys: true,
  ...patch,
});

beforeEach(() => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(MAC);
  vi.mocked(passkeySupport).mockResolvedValue({ supported: true, platform: true, autofill: false });
  vi.mocked(createPasskey).mockResolvedValue(REGISTRATION);
  vi.mocked(askPasskey).mockResolvedValue(ASSERTION);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the hello link', () => {
  it('makes Conch yours with Touch ID, then opens it', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'POST /api/auth/hello': () => hello(),
      'POST /api/auth/hello/finish': () => status({ signedIn: true, method: 'passkey' }),
    });
    const onLeave = vi.fn();
    renderApp(<HelloScreen code="the-code" onLeave={onLeave} />);
    expect(await screen.findByRole('heading', { name: 'Make Conch yours' })).toBeInTheDocument();
    expect(screen.getAllByText('conch.example.com').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Use Touch ID' }));
    expect(createPasskey).toHaveBeenCalledWith({ purpose: 'hello', code: 'the-code' });
    expect(await screen.findByRole('heading', { name: 'It’s yours' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/hello/finish')?.body).toEqual({
      with: 'passkey',
      code: 'the-code',
      response: REGISTRATION,
    });
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1), { timeout: 4000 });
  });

  it('makes Conch yours with a password instead', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'POST /api/auth/hello': () => hello(),
      'POST /api/auth/hello/finish': () => status({ signedIn: true }),
    });
    renderApp(<HelloScreen code="the-code" onLeave={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Choose a password instead' }));
    const form = screen.getByRole('form', { name: 'Choose a password' });
    expect(within(form).getByLabelText('Username')).toHaveValue('george');
    await user.type(
      within(form).getByLabelText('Password', { selector: 'input' }),
      'purple otters juggle at dawn',
    );
    await user.click(within(form).getByRole('button', { name: 'Make it mine' }));
    expect(await screen.findByRole('heading', { name: 'It’s yours' })).toBeInTheDocument();
    expect(calls.find((c) => c.path === '/api/auth/hello/finish')?.body).toEqual({
      with: 'password',
      code: 'the-code',
      username: 'george',
      password: 'purple otters juggle at dawn',
    });
  });

  it('says how to get a new link when this one is spent', async () => {
    mockFetch({
      'POST /api/auth/hello': () => hello({ ok: false, reason: 'expired', expiresAt: undefined }),
      'GET /api/auth': () => status(),
    });
    renderApp(<HelloScreen code="old" onLeave={vi.fn()} />);
    expect(
      await screen.findByRole('heading', { name: 'This link has run its course' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('conch hello').length).toBeGreaterThan(0);
  });

  it('goes straight in when the link is spent but this browser is already signed in', async () => {
    mockFetch({
      'POST /api/auth/hello': () => hello({ ok: false, reason: 'claimed' }),
      'GET /api/auth': () => status({ signedIn: true }),
    });
    const onLeave = vi.fn();
    renderApp(<HelloScreen code="old" onLeave={onLeave} />);
    await waitFor(() => expect(onLeave).toHaveBeenCalled());
  });

  it('closing the browser’s prompt is no error: the button is there again', async () => {
    const user = userEvent.setup();
    vi.mocked(createPasskey).mockRejectedValue(
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }),
    );
    mockFetch({ 'POST /api/auth/hello': () => hello() });
    renderApp(<HelloScreen code="the-code" onLeave={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Use Touch ID' }));
    expect(await screen.findByRole('button', { name: 'Use Touch ID' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('signing in with a passkey', () => {
  it('offers Touch ID first when a passkey works here, with the password below', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({ 'POST /api/auth/sign-in': () => status({ signedIn: true }) });
    renderApp(<SignIn status={status({ passkeys: true })} />);
    await user.click(await screen.findByRole('button', { name: 'Sign in with Touch ID' }));
    expect(askPasskey).toHaveBeenCalledWith('sign-in', { autofill: false });
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/auth/sign-in')?.body).toEqual({
        with: 'passkey',
        response: ASSERTION,
      }),
    );
    expect(screen.getByLabelText('Password', { selector: 'input' })).toBeInTheDocument();
  });

  it('shows no passkey button when no passkey works here', async () => {
    mockFetch({});
    renderApp(<SignIn status={status()} />);
    await screen.findByLabelText('Username');
    await waitFor(() => expect(passkeySupport).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Touch ID/ })).toBeNull();
  });

  it('has no password box at all when passkeys are the only way in', async () => {
    mockFetch({});
    renderApp(<SignIn status={status({ method: 'passkey', passkeys: true })} />);
    expect(
      await screen.findByRole('button', { name: 'Sign in with Touch ID' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Password', { selector: 'input' })).toBeNull();
    expect(screen.getByText('Lost your passkey?')).toBeInTheDocument();
  });

  it('offers passkeys in the username field as it’s filled, when the browser can', async () => {
    vi.mocked(passkeySupport).mockResolvedValue({
      supported: true,
      platform: true,
      autofill: true,
    });
    vi.mocked(askPasskey).mockReturnValue(new Promise(() => undefined));
    mockFetch({});
    renderApp(<SignIn status={status({ passkeys: true })} />);
    await waitFor(() => expect(askPasskey).toHaveBeenCalledWith('sign-in', { autofill: true }));
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username webauthn');
  });
});

describe('waiting for approval', () => {
  it('says the owner’s devices can approve it, and offers to let yourself in with Touch ID', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/auth': () => status(),
      'POST /api/auth/sign-in': () => status({ signedIn: true }),
    });
    renderApp(
      <WaitingForApproval
        passkeys
        onLeave={vi.fn()}
        approval={{
          code: 'K7M-Q2X',
          device: 'Safari on Mac',
          expiresAt: Date.now() + 600_000,
          state: 'waiting',
        }}
      />,
    );
    expect(screen.getByText('conch devices approve K7M-Q2X')).toBeInTheDocument();
    await user.click(
      await screen.findByRole('button', { name: /Use Touch ID to let yourself in/ }),
    );
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/auth/sign-in')?.body).toEqual({
        with: 'passkey',
        response: ASSERTION,
      }),
    );
  });
});

function Guarded() {
  const { guard, dialog } = useVerify('passkey');
  return (
    <>
      <button type="button" onClick={() => void guard(() => api.setApproval(true))}>
        Change it
      </button>
      {dialog}
    </>
  );
}

describe('confirming it’s you', () => {
  it('uses Touch ID, with no password to type on a passkey Conch', async () => {
    const user = userEvent.setup();
    let verified = false;
    const calls = mockFetch({
      'GET /api/access': () => settings(),
      'PUT /api/access/approval': () =>
        verified
          ? settings()
          : json({ error: 'verify-required', message: 'Confirm it’s you.' }, 403),
      'POST /api/access/verify': () => {
        verified = true;
        return settings();
      },
    });
    renderApp(<Guarded />);
    await user.click(screen.getByRole('button', { name: 'Change it' }));
    const dialog = await screen.findByRole('dialog', { name: 'Confirm it’s you' });
    expect(within(dialog).queryByLabelText('Password', { selector: 'input' })).toBeNull();
    await user.click(await within(dialog).findByRole('button', { name: 'Confirm with Touch ID' }));
    expect(askPasskey).toHaveBeenCalledWith('verify');
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/api/access/approval')).toHaveLength(2),
    );
    expect(calls.find((c) => c.path === '/api/access/verify')?.body).toEqual({
      passkey: ASSERTION,
    });
  });
});

describe('Settings → Security → Passkeys', () => {
  it('lists passkeys, keeps the only way in, and adds Touch ID', async () => {
    const user = userEvent.setup();
    const calls = mockFetch({
      'GET /api/access': () => settings(),
      'POST /api/access/passkeys': () =>
        settings({
          passkeys: [
            ...settings().passkeys,
            {
              id: 'cred-2',
              name: 'Bitwarden',
              rpId: 'conch.example.com',
              createdAt: Date.now(),
              synced: true,
              here: true,
            },
          ],
        }),
    });
    renderApp(
      <>
        <SecurityTab />
        <Toaster />
      </>,
    );
    const list = await screen.findByRole('list', { name: 'Passkeys' });
    expect(within(list).getByText('Apple Passwords')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Remove Apple Passwords' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Add Touch ID' }));
    await waitFor(() =>
      expect(calls.find((c) => c.path === '/api/access/passkeys')?.body).toEqual({
        response: REGISTRATION,
      }),
    );
    expect(createPasskey).toHaveBeenCalledWith({ purpose: 'add' });
    expect(await within(list).findByText('Bitwarden')).toBeInTheDocument();
  });

  it('removes a passkey after asking', async () => {
    const user = userEvent.setup();
    const two = settings({
      method: 'password',
      username: 'ada',
      passkeys: [
        ...settings().passkeys,
        {
          id: 'cred-2',
          name: 'Bitwarden',
          rpId: 'conch.example.com',
          createdAt: 1,
          synced: true,
          here: true,
        },
      ],
    });
    const calls = mockFetch({
      'GET /api/access': () => two,
      'DELETE /api/access/passkeys/cred-2': () => settings({ method: 'password', username: 'ada' }),
    });
    renderApp(<SecurityTab />);
    await user.click(await screen.findByRole('button', { name: 'Remove Bitwarden' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove Bitwarden?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        calls.some((c) => c.method === 'DELETE' && c.path === '/api/access/passkeys/cred-2'),
      ).toBe(true),
    );
  });

  it('shows Approve on an approved device that can approve, even away from this computer', async () => {
    mockFetch({
      'GET /api/access': () =>
        settings({
          requests: [
            {
              code: 'K7M-Q2X',
              deviceId: 'dev_2',
              device: 'Safari on iPhone',
              kind: 'phone',
              via: 'password',
              script: false,
              createdAt: Date.now(),
              expiresAt: Date.now() + 600_000,
              rejected: false,
            },
          ],
        }),
    });
    renderApp(<SecurityTab />);
    const list = await screen.findByRole('list', { name: 'Waiting for your approval' });
    expect(within(list).getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
  });
});
