import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { Devices, ago, type DevicesIo } from './devicesCli';
import { AccessStore } from './store';

vi.setConfig({ testTimeout: 20_000 });

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';

afterEach(() => {
  process.exitCode = undefined;
});

/** A terminal: what was said, and answers typed in turn. */
async function terminal(answers: string[] = [], interactive = true) {
  const home = await mkdtemp(join(tmpdir(), 'conch-devices-cli-'));
  const store = new AccessStore(home);
  const out: string[] = [];
  const asked: string[] = [];
  const plain = (s: string) => s;
  // Real time, plus however long the terminal has (pretended to have) slept.
  let slept = 0;
  const io: DevicesIo = {
    store,
    reopen: () => new AccessStore(home),
    say: (line = '') => void out.push(line),
    print: (text) => void out.push(text),
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? '';
    },
    interactive,
    style: { bold: plain, dim: plain, green: plain, yellow: plain },
    sleep: async (ms) => void (slept += ms),
    now: () => Date.now() + slept,
  };
  const devices = new Devices(io);
  return {
    store,
    out,
    asked,
    text: () => out.join('\n'),
    run: (...args: string[]) => devices.run(args),
  };
}

/** A phone that signed in with the right password and is now waiting. */
async function waitingPhone(store: AccessStore, address = '100.64.0.7') {
  const { device } = await store.signInDevice({ userAgent: IPHONE, address, via: 'password' });
  const { request } = await store.startWaiting({
    deviceId: device.id,
    via: 'password',
    userAgent: IPHONE,
    address,
  });
  return request;
}

async function withPassword(store: AccessStore) {
  await store.setPassword('ada', 'purple otters juggle at dawn');
}

describe('pnpm conch devices', () => {
  it('lists who is waiting, with the command to approve each, and what is approved', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    await t.run();
    expect(t.text()).toContain('approving new devices');
    expect(t.text()).toContain('Waiting for you (1)');
    expect(t.text()).toContain(`● ${request.code}  Safari on iPhone`);
    expect(t.text()).toContain(
      'from 100.64.0.7 · with your password · asked just now · 10 min left',
    );
    expect(t.text()).toContain(`→ pnpm conch devices approve ${request.code}`);
    expect(t.text()).toContain('Approved (0)');
  });

  it('says how to start when sign-in or approval is off', async () => {
    const t = await terminal();
    await t.run();
    expect(t.text()).toContain('Choose a password first: pnpm conch password');
    await withPassword(t.store);
    t.out.length = 0;
    await t.run();
    expect(t.text()).toContain('For extra protection: pnpm conch devices on');
  });

  it('approves by code, however it is typed, and checks it really landed', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    // `pnpm conch devices approve k7m q2x`
    const [first = '', second = ''] = request.code.toLowerCase().split('-');
    await t.run('approve', first, second);
    expect(t.text()).toContain('✓ Approved Safari on iPhone.');
    const fresh = await new AccessStore(t.store.path.replace(/access\.json$/, '')).devices();
    expect(fresh[0]).toMatchObject({ approved: true, approvedHow: 'terminal' });
  });

  it('with no code, shows the one waiting and asks first', async () => {
    const t = await terminal(['n']);
    await withPassword(t.store);
    await t.store.setApproval(true);
    await waitingPhone(t.store);
    await t.run('approve');
    expect(t.asked).toEqual(['Approve Safari on iPhone? [y/N] ']);
    expect(t.text()).toContain('Nothing was changed.');
    expect((await t.store.requests())[0]?.rejected).toBe(false);

    const yes = await terminal(['y']);
    await withPassword(yes.store);
    await yes.store.setApproval(true);
    await waitingPhone(yes.store);
    await yes.run('approve');
    expect(yes.text()).toContain('✓ Approved Safari on iPhone.');
  });

  it('with several waiting, lets you pick one by number', async () => {
    const t = await terminal(['2']);
    await withPassword(t.store);
    await t.store.setApproval(true);
    await waitingPhone(t.store, '100.64.0.7');
    await waitingPhone(t.store, '100.64.0.8');
    // Newest first, as listed: number 2 is the first to have asked.
    const [, oldest] = await t.store.requests();
    await t.run('approve', '--yes');
    expect(t.text()).toContain('2 devices are waiting:');
    const left = await t.store.requests();
    expect(left).toHaveLength(1);
    expect(left[0]?.code).not.toBe(oldest?.code);
  });

  it('waits for a device to ask when nobody has yet', async () => {
    const t = await terminal(['y']);
    await withPassword(t.store);
    await t.store.setApproval(true);
    // The phone signs in while the terminal is waiting.
    let asked = false;
    const original = t.store.requests.bind(t.store);
    vi.spyOn(t.store, 'requests').mockImplementation(async () => {
      if (!asked) {
        asked = true;
        return [];
      }
      if ((await original()).length === 0) await waitingPhone(t.store);
      return original();
    });
    await t.run('approve');
    expect(t.text()).toContain('No device is waiting yet. Sign in on the new device now');
    expect(t.text()).toContain('✓ Approved Safari on iPhone.');
  });

  it('refuses to guess without a keyboard, and says so for an unknown code', async () => {
    const t = await terminal([], false);
    await withPassword(t.store);
    await t.store.setApproval(true);
    await waitingPhone(t.store);
    await t.run('approve');
    expect(t.text()).toContain('Usage: pnpm conch devices approve <code>');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    await t.run('approve', 'ZZZZZZ');
    expect(t.text()).toContain('No device is waiting with the code ZZZ-ZZZ.');
    expect(process.exitCode).toBe(1);
  });

  it('turns a device down and says what to do if it wasn’t you', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    await t.run('reject', request.code);
    expect(t.text()).toContain('✓ Turned down Safari on iPhone.');
    expect(t.text()).toContain('someone knows your password. Change it: pnpm conch password');
    expect((await t.store.requests())[0]?.rejected).toBe(true);
  });

  it('removes a device by the start of its id, and renames one', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    await t.store.approve(request.code, 'terminal');
    const [device] = await t.store.devices();
    await t.run('rename', device?.id.slice(0, 8) ?? '', 'Ada’s', 'iPhone');
    expect(t.text()).toContain('is now Ada’s iPhone');
    await t.run('remove', device?.id ?? '');
    expect(t.text()).toContain('✓ Removed Ada’s iPhone and signed it out.');
    expect(await t.store.devices()).toEqual([]);
  });

  it('turns approval on and off, and lists who stays approved', async () => {
    const t = await terminal();
    await withPassword(t.store);
    const { device } = await t.store.signInDevice({ userAgent: IPHONE, via: 'password' });
    await t.store.createSession({ via: 'password', userAgent: IPHONE, deviceId: device.id });
    await t.run('on');
    expect(t.text()).toContain('✓ Approving new devices.');
    expect(t.text()).toContain('These were signed in, so they stay approved:');
    expect(t.text()).toContain('• Safari on iPhone');
    await t.run('off');
    expect(t.text()).toContain('No longer approving new devices');
    expect(await t.store.approvalOn()).toBe(false);
  });

  it('prints machine-readable JSON with --json', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    await waitingPhone(t.store);
    await t.run('list', '--json');
    const parsed = JSON.parse(t.out.join('\n'));
    expect(parsed.approval).toBe(true);
    expect(parsed.requests[0]).toMatchObject({ device: 'Safari on iPhone', via: 'password' });
  });
});

describe('ago', () => {
  it('reads like a person would say it', () => {
    const now = 1_000_000_000;
    expect(ago(now - 10_000, now)).toBe('just now');
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});
