/**
 * `pnpm conch devices …` — see what has signed in to Conch, and approve new
 * devices. The terminal of the computer running Conch is where approving
 * happens: having it is the proof that it's you.
 *
 * Subcommands: `list`, `approve`, `reject`, `remove` and `rename`. With no
 * code, `approve` shows who is waiting and asks, or waits for the device to
 * ask.
 */
import {
  formatApprovalCode,
  isStaleDevice,
  normalizeApprovalCode,
  type ApprovedHow,
  type DeviceInfo,
  type DeviceRequest,
} from '@conch/protocol';

import { DEVICES_SUBCOMMANDS } from '../cliCommands';
import { AccessError, type AccessStore } from './store';

export interface DevicesIo {
  store: AccessStore;
  /** A fresh store on the same file, to check a change really landed. */
  reopen: () => AccessStore;
  say: (line?: string) => void;
  /** Exactly as given, for machines (`--json`). */
  print: (text: string) => void;
  ask: (question: string) => Promise<string>;
  /** Someone is at the keyboard (questions can be asked, and waited on). */
  interactive: boolean;
  style: {
    bold: (s: string) => string;
    dim: (s: string) => string;
    green: (s: string) => string;
    yellow: (s: string) => string;
  };
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const HOW: Record<ApprovedHow, string> = {
  'this-computer': 'approved on this computer',
  terminal: 'approved in the terminal',
  settings: 'approved in Settings',
  link: 'added with a sign-in link',
  'already-signed-in': 'was signed in when approval was turned on',
};

/** How long to wait for a device to ask, when `approve` is run before it does. */
const WAIT_FOR_ASK_MS = 10 * 60 * 1000;

export function ago(then: number, now: number): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

function left(until: number, now: number): string {
  const m = Math.max(1, Math.ceil((until - now) / 60_000));
  return `${m} min left`;
}

const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

export function describeRequest(r: DeviceRequest, now: number): string {
  const what = r.script
    ? `with the key “${r.keyName ?? '?'}”`
    : r.via === 'key'
      ? `with the access key “${r.keyName ?? '?'}”`
      : 'with your password';
  return [
    r.address && `from ${r.address}`,
    what,
    `asked ${ago(r.createdAt, now)}`,
    r.rejected ? 'turned down' : left(r.expiresAt, now),
  ]
    .filter(Boolean)
    .join(' · ');
}

function describeDevice(d: DeviceInfo, now: number, approval: boolean): string {
  return [
    d.signedIn ? 'signed in' : `last seen ${ago(d.lastSeenAt, now)}`,
    approval && d.approvedHow && HOW[d.approvedHow],
    d.address,
    isStaleDevice(d, now) && 'not used in 90 days',
  ]
    .filter(Boolean)
    .join(' · ');
}

export class Devices {
  constructor(private readonly io: DevicesIo) {}

  async run(args: string[]): Promise<void> {
    const [sub = 'list', ...rest] = args;
    const flags = new Set(rest.filter((a) => a.startsWith('--')));
    const words = rest.filter((a) => !a.startsWith('--'));
    switch (sub) {
      case 'list':
      case 'ls':
        return flags.has('--json') ? this.json() : this.list();
      case 'approve':
        return this.approve(words.join(''), flags);
      case 'reject':
      case 'deny':
        return flags.has('--all') ? this.rejectAll() : this.reject(words.join(''));
      case 'remove':
      case 'rm':
        return this.remove(words[0], flags);
      case 'rename':
        return this.rename(words[0], words.slice(1).join(' '));
      case 'on':
        return this.turn(true);
      case 'off':
        return this.turn(false);
      case 'help':
        return this.help();
      default:
        this.io.say(`✗ There’s no “devices ${sub}”.`);
        this.help();
        process.exitCode = 1;
    }
  }

  help() {
    const { say, style } = this.io;
    say(style.bold('pnpm conch devices <command>'));
    say();
    for (const { usage, summary } of DEVICES_SUBCOMMANDS)
      say(`${pad(usage, 28)}${style.dim(summary)}`);
  }

  async json() {
    const { store } = this.io;
    const out = {
      approval: await store.approvalOn(),
      requests: await store.requests(),
      devices: await store.devices(),
    };
    this.io.print(JSON.stringify(out, null, 2));
  }

  async list() {
    const { store, say, style } = this.io;
    const now = this.io.now();
    const method = await store.method();
    const approval = await store.approvalOn();
    const requests = await store.requests();
    const devices = await store.devices();

    say(`${style.bold('Devices')}  ${style.dim('·')}  ${this.#approvalLine(approval)}`);
    if (method === 'none') {
      say(style.dim('Sign-in is off, so only this computer can use Conch.'));
      say(style.dim('Choose a password first: pnpm conch password'));
      return;
    }
    say(
      style.dim(
        approval
          ? 'A new device waits here for you after signing in, even with the right password.'
          : 'Anyone with your password or key can sign in from a new device.',
      ),
    );

    if (requests.length) {
      say();
      say(style.bold(`Waiting for you (${requests.filter((r) => !r.rejected).length})`));
      for (const r of requests) {
        const mark = r.rejected ? style.dim('✗') : style.yellow('●');
        say(`${mark} ${style.bold(r.code)}  ${r.device}`);
        say(`           ${style.dim(describeRequest(r, now))}`);
        if (!r.rejected) say(`           ${style.dim('→')} pnpm conch devices approve ${r.code}`);
      }
    }

    say();
    say(style.bold(approval ? `Approved (${devices.length})` : `Signed in (${devices.length})`));
    if (!devices.length) say(style.dim('  None yet.'));
    const width = Math.min(32, Math.max(...devices.map((d) => d.name.length), 10) + 2);
    for (const d of devices) {
      const mark = d.signedIn ? style.green('●') : style.dim('○');
      say(`${mark} ${pad(d.name, width)}${style.dim(d.id)}`);
      say(`  ${style.dim(describeDevice(d, now, approval))}`);
    }

    say();
    if (!approval) say(style.dim('For extra protection: pnpm conch devices on'));
    else if (devices.length)
      say(style.dim('Remove one you don’t recognise: pnpm conch devices remove <id>'));
  }

  #approvalLine(on: boolean) {
    return on
      ? this.io.style.green('approving new devices')
      : this.io.style.dim('not approving new devices');
  }

  /** The waiting request a code means, or a clear "no". */
  async #find(code: string): Promise<DeviceRequest | undefined> {
    const wanted = normalizeApprovalCode(code);
    return (await this.io.store.requests()).find((r) => normalizeApprovalCode(r.code) === wanted);
  }

  /** Let the person pick one of several, by number. */
  async #pick<T>(items: T[], line: (item: T, n: number) => void): Promise<T | undefined> {
    items.forEach((item, i) => line(item, i + 1));
    const answer = (await this.io.ask(`Which one? (1–${items.length}, Enter to cancel): `)).trim();
    const n = Number(answer);
    return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : undefined;
  }

  async #confirm(question: string, flags: Set<string>): Promise<boolean> {
    if (flags.has('--yes') || flags.has('-y')) return true;
    if (!this.io.interactive) return false;
    return /^y(es)?$/i.test((await this.io.ask(`${question} [y/N] `)).trim());
  }

  async approve(code: string, flags: Set<string>) {
    const { store, say, style } = this.io;
    if (!(await store.approvalOn()) && !code) {
      say('Conch isn’t asking for approval, so no device is waiting.');
      say(style.dim('Turn it on first: pnpm conch devices on'));
      return;
    }
    let request: DeviceRequest | undefined;
    if (code) {
      request = await this.#find(code);
      if (!request) return this.#noSuch(code);
    } else {
      if (!this.io.interactive) {
        say('Usage: pnpm conch devices approve <code>   (see pnpm conch devices)');
        process.exitCode = 1;
        return;
      }
      const waiting = await this.#waiting();
      const [only] = waiting;
      if (!only) return;
      if (waiting.length === 1) {
        request = only;
        say(`${style.yellow('●')} ${style.bold(only.code)}  ${only.device}`);
        say(`           ${style.dim(describeRequest(only, this.io.now()))}`);
        say();
      } else {
        say(style.bold(`${waiting.length} devices are waiting:`));
        request = await this.#pick(waiting, (r, n) => {
          say(`  ${n}. ${style.bold(r.code)}  ${r.device}`);
          say(`     ${style.dim(describeRequest(r, this.io.now()))}`);
        });
        if (!request) return say('Nothing was changed.');
      }
      if (!(await this.#confirm(`Approve ${request.device}?`, flags)))
        return say('Nothing was changed.');
    }
    try {
      await this.#approveSurely(request.code);
    } catch (error) {
      if (error instanceof AccessError && error.code === 'not-found') return this.#noSuch(code);
      throw error;
    }
    say(`${style.green('✓')} Approved ${style.bold(request.device)}.`);
    say(
      style.dim(
        request.script
          ? 'Scripts using that key work from other devices now.'
          : 'It’s let in where it’s waiting — no need to sign in again.',
      ),
    );
  }

  /**
   * Approve, then read the file back from scratch: Conch, running beside us,
   * may have saved over it at the same moment. If it did, approve again.
   */
  async #approveSurely(code: string) {
    for (let attempt = 0; ; attempt++) {
      const request = await this.#find(code);
      await this.io.store.approve(code, 'terminal');
      await this.io.sleep(700);
      const check = this.io.reopen();
      const device = (await check.get()).devices.find((d) => d.id === request?.deviceId);
      if (device?.approvedAt !== undefined || attempt >= 2) return;
      if (!(await this.#find(code))) return;
    }
  }

  /** Who is waiting; if nobody yet, wait for the first to ask (the person is signing in now). */
  async #waiting(): Promise<DeviceRequest[]> {
    const { store, say, style } = this.io;
    const open = async () => (await store.requests()).filter((r) => !r.rejected);
    let waiting = await open();
    if (waiting.length) return waiting;
    say('No device is waiting yet. Sign in on the new device now — this waits for it.');
    say(style.dim('(Ctrl+C to stop)'));
    const until = this.io.now() + WAIT_FOR_ASK_MS;
    while (!waiting.length && this.io.now() < until) {
      await this.io.sleep(1000);
      waiting = await open();
    }
    if (!waiting.length) say('Nobody asked. Run this again when you’re signing in.');
    else say();
    return waiting;
  }

  #noSuch(code: string) {
    this.io.say(
      `✗ No device is waiting with ${code ? `the code ${formatApprovalCode(code)}` : 'that code'}.`,
    );
    this.io.say(
      this.io.style.dim(
        'It may have run out after 10 minutes: sign in again on the device for a new one. See who’s waiting: pnpm conch devices',
      ),
    );
    process.exitCode = 1;
  }

  async reject(code: string) {
    const { store, say, style } = this.io;
    let request: DeviceRequest | undefined;
    if (code) request = await this.#find(code);
    else {
      const waiting = (await store.requests()).filter((r) => !r.rejected);
      if (!waiting.length) return say('No device is waiting.');
      if (waiting.length === 1) request = waiting[0];
      else if (!this.io.interactive) {
        say('Usage: pnpm conch devices reject <code>   (or --all)');
        process.exitCode = 1;
        return;
      } else
        request = await this.#pick(waiting, (r, n) =>
          say(
            `  ${n}. ${style.bold(r.code)}  ${r.device}  ${style.dim(describeRequest(r, this.io.now()))}`,
          ),
        );
      if (!request) return say('Nothing was changed.');
    }
    if (!request) return this.#noSuch(code);
    await store.reject(request.code);
    say(`${style.green('✓')} Turned down ${style.bold(request.device)}. It’s been told.`);
    this.#ifNotYou(request);
  }

  async rejectAll() {
    const { store, say, style } = this.io;
    const n = await store.rejectAll();
    say(
      n
        ? `${style.green('✓')} Turned down ${n} device${n === 1 ? '' : 's'}.`
        : 'No device is waiting.',
    );
    if (n) this.#ifNotYou();
  }

  #ifNotYou(request?: DeviceRequest) {
    const { say, style } = this.io;
    say(
      style.dim(
        request?.via === 'key'
          ? `If it wasn’t you, someone has the key “${request.keyName ?? '?'}”: revoke it with pnpm conch keys / revoke.`
          : 'If it wasn’t you, someone knows your password. Change it: pnpm conch password',
      ),
    );
  }

  /** A device by id (or the start of one), or picked from the list. */
  async #device(id: string | undefined, verb: string): Promise<DeviceInfo | undefined> {
    const { store, say, style } = this.io;
    const devices = await store.devices();
    if (id) {
      const matches = devices.filter((d) => d.id === id || d.id.startsWith(id));
      if (matches.length === 1) return matches[0];
      say(matches.length ? `✗ “${id}” could be more than one device.` : `✗ No device “${id}”.`);
      say(style.dim('See them, with their ids: pnpm conch devices'));
      process.exitCode = 1;
      return undefined;
    }
    if (!devices.length) {
      say('No devices.');
      return undefined;
    }
    if (!this.io.interactive) {
      say(`Usage: pnpm conch devices ${verb} <id>   (see pnpm conch devices)`);
      process.exitCode = 1;
      return undefined;
    }
    const now = this.io.now();
    const approval = await store.approvalOn();
    const picked = await this.#pick(devices, (d, n) =>
      say(`  ${n}. ${d.name}  ${style.dim(describeDevice(d, now, approval))}`),
    );
    if (!picked) say('Nothing was changed.');
    return picked;
  }

  async remove(id: string | undefined, flags: Set<string>) {
    const { store, say, style } = this.io;
    const device = await this.#device(id, 'remove');
    if (!device) return;
    const approval = await store.approvalOn();
    const what = approval
      ? 'It will be signed out, and need your approval to sign in again.'
      : 'It will be signed out.';
    // Named on the command line, it's meant; picked from a list, it's asked once more.
    if (!id && !(await this.#confirm(`Remove ${device.name}? ${what}`, flags)))
      return say('Nothing was changed.');
    const { ended } = await store.removeDevice(device.id);
    say(
      `${style.green('✓')} Removed ${style.bold(device.name)}${ended.length ? ' and signed it out' : ''}.`,
    );
  }

  async rename(id: string | undefined, name: string) {
    const { store, say, style } = this.io;
    if (!id || !name.trim()) {
      say('Usage: pnpm conch devices rename <id> <new name>');
      process.exitCode = 1;
      return;
    }
    const device = await this.#device(id, 'rename');
    if (!device) return;
    await store.renameDevice(device.id, name);
    say(`${style.green('✓')} “${device.name}” is now ${style.bold(name.trim().slice(0, 64))}.`);
  }

  async turn(on: boolean) {
    const { store, say, style } = this.io;
    if (on && (await store.method()) === 'none') {
      say('Choose a password or access key first: pnpm conch password');
      process.exitCode = 1;
      return;
    }
    const was = await store.approvalOn();
    await store.setApproval(on);
    if (on) {
      say(
        `${style.green('✓')} ${was ? 'Already approving' : 'Approving'} new devices. After signing in, a new device waits until you approve it here.`,
      );
      const devices = await store.devices();
      if (devices.length && !was) {
        say(style.dim('These were signed in, so they stay approved:'));
        for (const d of devices) say(style.dim(`  • ${d.name}  ${d.id}`));
        say(style.dim('Remove any you don’t recognise: pnpm conch devices remove <id>'));
      }
      say(style.dim('This computer never needs approving.'));
    } else {
      say(
        `${style.green('✓')} No longer approving new devices: the password or key is enough again.`,
      );
      say(style.dim('Devices you approved are remembered, should you turn it back on.'));
    }
  }
}
