import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureUi } from '../cli/ui';
import { Devices, type DevicesIo } from './devicesCli';
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
  const { ui, text } = captureUi();
  const json: string[] = [];
  const asked: string[] = [];
  const answer = async (question: string) => {
    asked.push(question);
    return answers.shift() ?? '';
  };
  // Real time, plus however long the terminal has (pretended to have) slept.
  let slept = 0;
  const io: DevicesIo = {
    store,
    reopen: () => new AccessStore(home),
    ui,
    print: (out) => void json.push(out),
    ask: answer,
    confirm: async (question, fallback) => {
      const typed = (await answer(question)).trim();
      return typed ? /^y/i.test(typed) : fallback;
    },
    interactive,
    conch: (args) => `conch ${args}`,
    sleep: async (ms) => void (slept += ms),
    now: () => Date.now() + slept,
  };
  const devices = new Devices(io);
  let from = 0;
  return {
    store,
    json,
    asked,
    text: () => text().slice(from),
    /** Forget what was said so far. */
    clear: () => void (from = text().length),
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

describe('conch devices', () => {
  it('lists who is waiting, with the command to approve each, and what is let in', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    await t.run();
    expect(t.text()).toContain('new devices need your OK');
    expect(t.text()).toContain('Knocking at the door (1)');
    expect(t.text()).toContain(`● ${request.code}  Safari on iPhone`);
    expect(t.text()).toContain(
      'from 100.64.0.7 · with your password · asked just now · 10 minutes left',
    );
    expect(t.text()).toContain(`$ conch devices approve ${request.code}`);
    expect(t.text()).toContain('Or approve it from any device you’re already signed in on.');
    expect(t.text()).toContain('Let in (0)');
  });

  it('says how to start when sign-in or approval is off', async () => {
    const t = await terminal();
    await t.run();
    expect(t.text()).toContain('Choose how you sign in first: conch password');
    await withPassword(t.store);
    t.clear();
    await t.run();
    expect(t.text()).toContain('For a second lock on the door: conch devices on');
  });

  it('approves by code, however it is typed, and checks it really landed', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    // `conch devices approve k7m q2x`
    const [first = '', second = ''] = request.code.toLowerCase().split('-');
    await t.run('approve', first, second);
    expect(t.text()).toContain('✓ Safari on iPhone is in. ✨');
    const fresh = await new AccessStore(t.store.path.replace(/access\.json$/, '')).devices();
    expect(fresh[0]).toMatchObject({ approved: true, approvedHow: 'terminal' });
  });

  it('with no code, shows the one waiting as a card and asks first', async () => {
    const t = await terminal(['n']);
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    await t.run('approve');
    expect(t.text()).toContain('Knock knock');
    expect(t.text()).toContain(`Code  ${request.code}`);
    expect(t.asked).toEqual(['Let Safari on iPhone in?']);
    expect(t.text()).toContain('Nothing was changed.');
    expect((await t.store.requests())[0]?.rejected).toBe(false);

    // Enter takes yes: the person ran `approve` to approve.
    const yes = await terminal(['']);
    await withPassword(yes.store);
    await yes.store.setApproval(true);
    await waitingPhone(yes.store);
    await yes.run('approve');
    expect(yes.text()).toContain('✓ Safari on iPhone is in. ✨');
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
    expect(t.text()).toContain('2 devices are knocking:');
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
    expect(t.text()).toContain('No device is waiting yet. Go ahead and sign in on the new one');
    expect(t.text()).toContain('✓ A device is asking to come in.');
    expect(t.text()).toContain('✓ Safari on iPhone is in. ✨');
  });

  it('stops waiting after ten minutes when nobody asks', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    await t.run('approve');
    expect(t.text()).toContain('✗ Nobody asked in 10 minutes.');
    expect(process.exitCode).toBeUndefined();
  });

  it('refuses to guess without a keyboard, and says so for an unknown code', async () => {
    const t = await terminal([], false);
    await withPassword(t.store);
    await t.store.setApproval(true);
    await waitingPhone(t.store);
    await t.run('approve');
    expect(t.text()).toContain('conch devices approve <code>');
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
    expect(t.text()).toContain('someone knows your password. Change it: conch password');
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

  it('says which device let another in (ADR 0065)', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    const request = await waitingPhone(t.store);
    await t.store.approve(request.code, 'device', 'Chrome on Mac');
    await t.store.createSession({
      via: 'password',
      userAgent: IPHONE,
      deviceId: (await t.store.devices())[0]?.id ?? '',
    });
    await t.run();
    expect(t.text()).toContain('approved from Chrome on Mac');
  });

  it('turns approval on and off, and lists who stays let in', async () => {
    const t = await terminal();
    await withPassword(t.store);
    const { device } = await t.store.signInDevice({ userAgent: IPHONE, via: 'password' });
    await t.store.createSession({ via: 'password', userAgent: IPHONE, deviceId: device.id });
    await t.run('on');
    expect(t.text()).toContain('✓ Approving new devices.');
    expect(t.text()).toContain('or from any device you’re already signed in on');
    expect(t.text()).toContain('These were signed in, so they stay let in:');
    expect(t.text()).toContain('• Safari on iPhone');
    await t.run('off');
    expect(t.text()).toContain('No longer approving new devices');
    expect(await t.store.approvalOn()).toBe(false);
  });

  it('prints machine-readable JSON with --json, and nothing else', async () => {
    const t = await terminal();
    await withPassword(t.store);
    await t.store.setApproval(true);
    await waitingPhone(t.store);
    await t.run('list', '--json');
    expect(t.text()).toBe('');
    const parsed = JSON.parse(t.json.join('\n'));
    expect(parsed.approval).toBe(true);
    expect(parsed.requests[0]).toMatchObject({ device: 'Safari on iPhone', via: 'password' });
  });
});
