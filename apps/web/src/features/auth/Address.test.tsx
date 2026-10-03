import type { AddressStatus, DnsReport } from '@conch/protocol';
import { Toaster } from '@conch/nacre';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FakeSocket, mockFetch, renderApp } from '../../test/harness';
import { AddressSection } from './AddressSection';

vi.setConfig({ testTimeout: 20_000 });

/**
 * Settings → Security → Your address (ADR 0064): the web's twin of `conch
 * setup`. The gateway is `mockFetch`; what Conch does next arrives as
 * `address.changed` on the pretend socket, as it would.
 */

const NAME = 'conch.example.com';

const report = (pointing: DnsReport['pointing']): DnsReport => ({
  name: NAME,
  mine: { v4: '203.0.113.7' },
  found: { v4: pointing === 'here' ? ['203.0.113.7'] : [], v6: [] },
  pointing,
  message: pointing === 'here' ? `${NAME} points here.` : `${NAME} doesn’t point anywhere yet.`,
  advice:
    pointing === 'here' ? [] : [{ type: 'A', host: 'conch', name: NAME, value: '203.0.113.7' }],
});

const ready: AddressStatus = {
  state: 'ready',
  name: NAME,
  url: `https://${NAME}`,
  certificate: { notAfter: Date.UTC(2027, 0, 2), issuer: 'Let’s Encrypt' },
};

/** Confirming it's you is someone else's test: here it always goes through. */
const guard = async (task: () => Promise<unknown>) => {
  await task();
  return true;
};

function show(status: AddressStatus, routes: Parameters<typeof mockFetch>[0] = {}) {
  const calls = mockFetch({ 'GET /api/address': () => status, ...routes });
  const view = renderApp(
    <>
      <Toaster />
      <AddressSection guard={guard} />
    </>,
  );
  return { calls, ...view };
}

const say = async (address: AddressStatus) => {
  await waitFor(() => expect(FakeSocket.last).toBeDefined());
  act(() => FakeSocket.last?.push({ type: 'address.changed', address }));
};

describe('your address', () => {
  it('sets one up: the record to add, noticed when it arrives, then Conch answering there', async () => {
    const user = userEvent.setup();
    let pointing: DnsReport['pointing'] = 'missing';
    const { calls } = show(
      { state: 'off' },
      {
        'POST /api/address/dns': () => report(pointing),
        'PUT /api/address': () => ({ state: 'checking', name: NAME }),
        'GET /api/access': () => new Response('{}', { status: 404 }),
      },
    );
    await user.click(await screen.findByRole('button', { name: /Set up/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Your own address' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Address' }), `https://${NAME}/`);
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));

    expect(
      await within(dialog).findByText('Add this record where you bought your domain:'),
    ).toBeVisible();
    expect(within(dialog).getByText(/This server is at 203\.0\.113\.7/)).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Copy the value 203.0.113.7' }),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Turn it on' })).toBeDisabled();
    expect(within(dialog).getByText(/Let’s Encrypt/)).toBeVisible();

    // The record arrives; coming back to the page looks again at once.
    pointing = 'here';
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(await within(dialog).findByText(`${NAME} points here.`)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Turn it on' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'PUT', path: '/api/address', body: { name: NAME } }),
    );
    expect(await within(dialog).findByText('Checking the way in from the internet…')).toBeVisible();
    await say({ state: 'getting-certificate', name: NAME });
    expect(
      await within(dialog).findByText('Getting your certificate from Let’s Encrypt…'),
    ).toBeVisible();
    await say(ready);
    const link = await within(dialog).findByRole('link', { name: `https://${NAME}` });
    expect(link).toHaveAttribute('href', `https://${NAME}`);
    await user.click(within(dialog).getByRole('button', { name: 'Done' }));
    // Behind the dialog, the section says it's secure.
    expect(await screen.findByText(/Secure · renews by itself/)).toBeVisible();
  });

  it('says what the gateway says about a name that isn’t an address', async () => {
    const user = userEvent.setup();
    show(
      { state: 'off' },
      {
        'POST /api/address/dns': () =>
          new Response(
            JSON.stringify({ error: 'bad-name', message: 'That’s an IP address, not a name.' }),
            { status: 400 },
          ),
      },
    );
    await user.click(await screen.findByRole('button', { name: /Set up/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Address' }), '192.0.2.1');
    await user.click(within(dialog).getByRole('button', { name: 'Check' }));
    expect(await within(dialog).findByText('That’s an IP address, not a name.')).toBeVisible();
  });

  it('turns off only after saying who loses their way in', async () => {
    const user = userEvent.setup();
    const { calls } = show(ready, { 'DELETE /api/address': () => ({ state: 'off' }) });
    expect(await screen.findByText(/good until/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Turn off' }));
    const alert = await screen.findByRole('alertdialog', { name: 'Turn off your address?' });
    expect(within(alert).getByText(/lose their way in/)).toBeVisible();
    await user.click(within(alert).getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(calls).toContainEqual({ method: 'DELETE', path: '/api/address', body: undefined }),
    );
    expect(await screen.findByText('Open Conch from anywhere')).toBeVisible();
  });

  it('gives a problem its one fix: try again, or turn on here what a backup brought', async () => {
    const user = userEvent.setup();
    const unreachable = show(
      {
        state: 'problem',
        name: NAME,
        problem: { kind: 'unreachable', message: 'Port 80 can’t be reached from the internet.' },
      },
      { 'PUT /api/address': () => ({ state: 'checking', name: NAME }) },
    );
    await user.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(unreachable.calls).toContainEqual({
        method: 'PUT',
        path: '/api/address',
        body: { name: NAME },
      }),
    );
    unreachable.unmount();

    const elsewhere = show(
      {
        state: 'problem',
        name: NAME,
        problem: {
          kind: 'another-computer',
          message: 'This address was set up on another computer.',
        },
      },
      { 'POST /api/address/here': () => ({ state: 'checking', name: NAME }) },
    );
    await user.click(await screen.findByRole('button', { name: 'Turn on here' }));
    await waitFor(() =>
      expect(elsewhere.calls.some((c) => c.path === '/api/address/here')).toBe(true),
    );
  });

  it('shows the one command for the ports, and what to do with it', async () => {
    show({
      state: 'problem',
      name: NAME,
      problem: {
        kind: 'ports-privilege',
        message: 'Conch isn’t allowed to answer on port 443 yet.',
        command: 'sudo setcap cap_net_bind_service=+ep /home/ada/.conch/runtime/node/bin/node',
      },
    });
    expect(
      await screen.findByText(/Run this on the computer running Conch, then press Try again/),
    ).toBeVisible();
    expect(screen.getByText(/sudo setcap/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Copy command' })).toBeVisible();
  });

  it('offers to renew when renewing hasn’t worked, while the old certificate still serves', async () => {
    const user = userEvent.setup();
    const { calls } = show(
      {
        ...ready,
        problem: {
          kind: 'ca-unavailable',
          message: 'Renewing didn’t work yet; Conch tries again in an hour.',
        },
      },
      { 'POST /api/address/renew': () => ({ ...ready, state: 'getting-certificate' }) },
    );
    await user.click(await screen.findByRole('button', { name: 'Try renewing now' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/api/address/renew')).toBe(true));
  });

  it('stays out of the way on a gateway from before addresses', async () => {
    mockFetch({ 'GET /api/address': () => new Response('{}', { status: 404 }) });
    renderApp(<AddressSection guard={guard} />);
    await waitFor(() => expect(screen.queryByText('Your address')).not.toBeInTheDocument());
  });
});
