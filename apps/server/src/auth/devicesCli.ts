/**
 * `conch devices …` — see what has signed in to Conch, and approve new
 * devices. The terminal of the computer running Conch can always approve:
 * having it is the proof that it's you. A device that's already let in can
 * too, from Conch itself (ADR 0065).
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
import { working } from '../cli/pearl';
import type { Ui } from '../cli/ui';
import { ago, plural, span } from '../cli/words';
import { AccessError, type AccessStore } from './store';

export interface DevicesIo {
  store: AccessStore;
  /** A fresh store on the same file, to check a change really landed. */
  reopen: () => AccessStore;
  /** Everything a person reads goes through the terminal kit. */
  ui: Ui;
  /** Exactly as given, for machines (`--json`): never coloured. */
  print: (text: string) => void;
  /** A line of text from the keyboard ('' for no answer). */
  ask: (question: string) => Promise<string>;
  /** Yes or no; Enter takes `fallback`. */
  confirm: (question: string, fallback: boolean) => Promise<boolean>;
  /** Someone is at the keyboard (questions can be asked, and waited on). */
  interactive: boolean;
  /** What to tell people to type: `conch devices …` (or `pnpm conch` in a checkout). */
  conch: (args: string) => string;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

const HOW: Record<ApprovedHow, string> = {
  'this-computer': 'approved on this computer',
  terminal: 'approved in the terminal',
  settings: 'approved in Settings',
  link: 'came in with a sign-in link',
  'already-signed-in': 'was signed in when approval was turned on',
  passkey: 'let itself in with a passkey',
  hello: 'made Conch theirs with the hello link',
  device: 'approved from another device',
};

/** How long to wait for a device to ask, when `approve` is run before it does. */
const WAIT_FOR_ASK_MS = 10 * 60 * 1000;

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
    r.rejected ? 'turned down' : `${span(r.expiresAt - now)} left`,
  ]
    .filter(Boolean)
    .join(' · ');
}

function describeDevice(d: DeviceInfo, now: number, approval: boolean): string {
  const how =
    d.approvedHow === 'device' && d.approvedBy
      ? `approved from ${d.approvedBy}`
      : d.approvedHow && HOW[d.approvedHow];
  return [
    d.signedIn ? 'signed in' : `last seen ${ago(d.lastSeenAt, now)}`,
    approval && how,
    d.address,
    isStaleDevice(d, now) && 'not used in 90 days',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Nobody signed in on a new device while `approve` waited for one. */
class NobodyAsked extends Error {}

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
        this.io.ui.error(`Hmm, there’s no “devices ${sub}”. Here’s what there is:`);
        this.io.ui.blank();
        this.help();
        process.exitCode = 1;
    }
  }

  help() {
    const { ui } = this.io;
    ui.say(ui.bold(this.io.conch('devices <command>')));
    ui.blank();
    for (const { usage, summary } of DEVICES_SUBCOMMANDS)
      ui.say(`  ${ui.accent(pad(usage, 28))}${ui.dim(summary)}`);
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
    const { store, ui } = this.io;
    const now = this.io.now();
    const method = await store.method();
    const approval = await store.approvalOn();
    const requests = await store.requests();
    const devices = await store.devices();

    ui.say(`${ui.bold('Devices')}  ${ui.dim('·')}  ${this.#approvalLine(approval)}`);
    if (method === 'none') {
      ui.hint('Sign-in is off, so only this computer can use Conch.');
      ui.hint(`Choose how you sign in first: ${ui.code(this.io.conch('password'))}`);
      return;
    }
    ui.hint(
      approval
        ? 'A new device waits for your OK after signing in, even with the right password.'
        : 'Anyone with your password or key can sign in from a new device.',
    );

    if (requests.length) {
      const open = requests.filter((r) => !r.rejected).length;
      ui.blank();
      ui.say(ui.bold(open ? `Knocking at the door (${open})` : 'Turned down'));
      for (const r of requests) {
        const mark = r.rejected ? ui.dim(ui.sym.fail) : ui.warning(ui.sym.dot);
        ui.say(`${mark} ${ui.bold(r.code)}  ${r.device}`);
        ui.hint(`  ${describeRequest(r, now)}`);
        if (!r.rejected)
          ui.say(`  ${ui.dim('$')} ${ui.code(this.io.conch(`devices approve ${r.code}`))}`);
      }
      if (open) ui.hint('Or approve it from any device you’re already signed in on.');
    }

    ui.blank();
    ui.say(ui.bold(approval ? `Let in (${devices.length})` : `Signed in (${devices.length})`));
    if (!devices.length) ui.hint('  None yet.');
    const width = Math.min(32, Math.max(...devices.map((d) => d.name.length), 10) + 2);
    for (const d of devices) {
      const mark = d.signedIn ? ui.success(ui.sym.dot) : ui.dim(ui.sym.ring);
      ui.say(`${mark} ${ui.accent(pad(d.name, width))}${ui.dim(d.id)}`);
      ui.hint(`  ${describeDevice(d, now, approval)}`);
    }

    ui.blank();
    if (!approval)
      ui.hint(`For a second lock on the door: ${ui.code(this.io.conch('devices on'))}`);
    else if (devices.length)
      ui.hint(
        `Don’t recognise one? ${ui.code(this.io.conch('devices remove <id>'))} signs it out for good.`,
      );
  }

  #approvalLine(on: boolean) {
    return on
      ? this.io.ui.success('new devices need your OK')
      : this.io.ui.dim('new devices don’t need your OK');
  }

  /** The waiting request a code means, or a clear "no". */
  async #find(code: string): Promise<DeviceRequest | undefined> {
    const wanted = normalizeApprovalCode(code);
    return (await this.io.store.requests()).find((r) => normalizeApprovalCode(r.code) === wanted);
  }

  /** Let the person pick one of several, by number. */
  async #pick<T>(items: T[], line: (item: T, n: number) => void): Promise<T | undefined> {
    items.forEach((item, i) => line(item, i + 1));
    const answer = (await this.io.ask(`Which one? (1–${items.length}, Enter to cancel)`)).trim();
    const n = Number(answer);
    return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : undefined;
  }

  async #confirm(question: string, flags: Set<string>, fallback = false): Promise<boolean> {
    if (flags.has('--yes') || flags.has('-y')) return true;
    if (!this.io.interactive) return false;
    return this.io.confirm(question, fallback);
  }

  /** A device at the door, as a little card: who, from where, and its code. */
  #card(r: DeviceRequest) {
    const { ui } = this.io;
    ui.box(
      [
        ui.bold(r.device),
        ui.dim(describeRequest(r, this.io.now())),
        '',
        `Code  ${ui.accent(ui.bold(r.code))}  ${ui.dim('(the same as on its screen)')}`,
      ],
      { title: 'Knock knock', tone: 'accent' },
    );
  }

  async approve(code: string, flags: Set<string>) {
    const { store, ui } = this.io;
    if (!(await store.approvalOn()) && !code) {
      ui.note('Conch isn’t asking for approval, so no device is waiting.');
      ui.hint(`Turn it on first: ${ui.code(this.io.conch('devices on'))}`);
      return;
    }
    let request: DeviceRequest | undefined;
    if (code) {
      request = await this.#find(code);
      if (!request) return this.#noSuch(code);
    } else {
      if (!this.io.interactive) {
        ui.error('Which device? There’s nobody here to ask.');
        ui.hint(`Say its code: ${ui.code(this.io.conch('devices approve <code>'))}`);
        process.exitCode = 1;
        return;
      }
      const waiting = await this.#waiting();
      const [only] = waiting;
      if (!only) return;
      if (waiting.length === 1) {
        request = only;
        this.#card(only);
        ui.blank();
      } else {
        ui.say(ui.bold(`${waiting.length} devices are knocking:`));
        request = await this.#pick(waiting, (r, n) => {
          ui.say(`  ${ui.accent(`${n}.`)} ${ui.bold(r.code)}  ${r.device}`);
          ui.hint(`     ${describeRequest(r, this.io.now())}`);
        });
        if (!request) return ui.hint('Nothing was changed.');
      }
      if (!(await this.#confirm(`Let ${request.device} in?`, flags, true)))
        return ui.hint('Nothing was changed. It keeps waiting until it runs out.');
    }
    const chosen = request;
    try {
      await working(ui, `Letting ${chosen.device} in`, () => this.#approveSurely(chosen.code), {
        done: `${chosen.device} is in. ✨`,
      });
    } catch (error) {
      if (error instanceof AccessError && error.code === 'not-found') return this.#noSuch(code);
      throw error;
    }
    ui.hint(
      chosen.script
        ? 'Scripts using that key work from other devices now.'
        : 'It’s let in right where it’s waiting, no need to sign in again.',
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
    const { store, ui } = this.io;
    const open = async () => (await store.requests()).filter((r) => !r.rejected);
    const waiting = await open();
    if (waiting.length) return waiting;
    ui.say('No device is waiting yet. Go ahead and sign in on the new one: this waits for it.');
    ui.hint('(Ctrl+C to stop)');
    try {
      return await working(
        ui,
        'Waiting for a device to knock',
        async () => {
          const until = this.io.now() + WAIT_FOR_ASK_MS;
          let found = await open();
          while (!found.length && this.io.now() < until) {
            await this.io.sleep(1000);
            found = await open();
          }
          if (!found.length) throw new NobodyAsked('Nobody asked in 10 minutes.');
          return found;
        },
        {
          done: (found) =>
            found.length === 1
              ? 'A device is asking to come in.'
              : `${found.length} devices are asking.`,
        },
      ).then((found) => {
        ui.blank();
        return found;
      });
    } catch (error) {
      if (!(error instanceof NobodyAsked)) throw error;
      ui.hint('Run this again when you’re signing in.');
      return [];
    }
  }

  #noSuch(code: string) {
    const { ui } = this.io;
    ui.error(
      `No device is waiting with ${code ? `the code ${formatApprovalCode(code)}` : 'that code'}.`,
    );
    ui.hint('Codes run out after 10 minutes: sign in again on the device for a new one.');
    ui.hint(`See who’s waiting: ${ui.code(this.io.conch('devices'))}`);
    process.exitCode = 1;
  }

  async reject(code: string) {
    const { store, ui } = this.io;
    let request: DeviceRequest | undefined;
    if (code) request = await this.#find(code);
    else {
      const waiting = (await store.requests()).filter((r) => !r.rejected);
      if (!waiting.length) return ui.say('No device is waiting. All quiet. 🐚');
      if (waiting.length === 1) request = waiting[0];
      else if (!this.io.interactive) {
        ui.error('Which device? There’s nobody here to ask.');
        ui.hint(
          `Say its code: ${ui.code(this.io.conch('devices reject <code>'))}, or turn them all down with --all.`,
        );
        process.exitCode = 1;
        return;
      } else
        request = await this.#pick(waiting, (r, n) =>
          ui.say(
            `  ${ui.accent(`${n}.`)} ${ui.bold(r.code)}  ${r.device}  ${ui.dim(describeRequest(r, this.io.now()))}`,
          ),
        );
      if (!request) return ui.hint('Nothing was changed.');
    }
    if (!request) return this.#noSuch(code);
    await store.reject(request.code);
    ui.ok(`Turned down ${ui.bold(request.device)}. It’s been told.`);
    this.#ifNotYou(request);
  }

  async rejectAll() {
    const { store, ui } = this.io;
    const n = await store.rejectAll();
    if (!n) return ui.say('No device is waiting. All quiet. 🐚');
    ui.ok(`Turned down ${plural(n, 'device')}.`);
    this.#ifNotYou();
  }

  #ifNotYou(request?: DeviceRequest) {
    const { ui } = this.io;
    ui.hint(
      request?.via === 'key'
        ? `If it wasn’t you, someone has the key “${request.keyName ?? '?'}”. Revoke it: ${ui.code(this.io.conch('keys'))}, then ${ui.code(this.io.conch('revoke <id>'))}`
        : `If it wasn’t you, someone knows your password. Change it: ${ui.code(this.io.conch('password'))}`,
    );
  }

  /** A device by id (or the start of one), or picked from the list. */
  async #device(id: string | undefined, verb: string): Promise<DeviceInfo | undefined> {
    const { store, ui } = this.io;
    const devices = await store.devices();
    if (id) {
      const matches = devices.filter((d) => d.id === id || d.id.startsWith(id));
      if (matches.length === 1) return matches[0];
      ui.error(
        matches.length ? `“${id}” could be more than one device.` : `There’s no device “${id}”.`,
      );
      ui.hint(`See them, with their ids: ${ui.code(this.io.conch('devices'))}`);
      process.exitCode = 1;
      return undefined;
    }
    if (!devices.length) {
      ui.say('No devices yet.');
      return undefined;
    }
    if (!this.io.interactive) {
      ui.error('Which device? There’s nobody here to ask.');
      ui.hint(`Say its id: ${ui.code(this.io.conch(`devices ${verb} <id>`))}`);
      process.exitCode = 1;
      return undefined;
    }
    const now = this.io.now();
    const approval = await store.approvalOn();
    const picked = await this.#pick(devices, (d, n) =>
      ui.say(`  ${ui.accent(`${n}.`)} ${d.name}  ${ui.dim(describeDevice(d, now, approval))}`),
    );
    if (!picked) ui.hint('Nothing was changed.');
    return picked;
  }

  async remove(id: string | undefined, flags: Set<string>) {
    const { store, ui } = this.io;
    const device = await this.#device(id, 'remove');
    if (!device) return;
    const approval = await store.approvalOn();
    const what = approval ? 'It’s signed out, and needs your OK to come back.' : 'It’s signed out.';
    // Named on the command line, it's meant; picked from a list, it's asked once more.
    if (!id && !(await this.#confirm(`Remove ${device.name}? ${what}`, flags)))
      return ui.hint('Nothing was changed.');
    const { ended } = await store.removeDevice(device.id);
    ui.ok(`Removed ${ui.bold(device.name)}${ended.length ? ' and signed it out' : ''}.`);
  }

  async rename(id: string | undefined, name: string) {
    const { store, ui } = this.io;
    if (!id || !name.trim()) {
      ui.error('Which device, and what should it be called?');
      ui.hint(ui.code(this.io.conch('devices rename <id> <new name>')));
      process.exitCode = 1;
      return;
    }
    const device = await this.#device(id, 'rename');
    if (!device) return;
    await store.renameDevice(device.id, name);
    ui.ok(`“${device.name}” is now ${ui.bold(name.trim().slice(0, 64))}.`);
  }

  async turn(on: boolean) {
    const { store, ui } = this.io;
    if (on && (await store.method()) === 'none') {
      ui.error('Choose how you sign in first.');
      ui.hint(ui.code(this.io.conch('password')));
      process.exitCode = 1;
      return;
    }
    const was = await store.approvalOn();
    await store.setApproval(on);
    if (on) {
      ui.ok(
        `${was ? 'Already approving' : 'Approving'} new devices. A new one waits for your OK after signing in.`,
      );
      ui.hint('Approve it here, or from any device you’re already signed in on.');
      const devices = await store.devices();
      if (devices.length && !was) {
        ui.blank();
        ui.hint('These were signed in, so they stay let in:');
        for (const d of devices) ui.hint(`  ${ui.sym.bullet} ${d.name}  ${d.id}`);
        ui.hint(`Don’t recognise one? ${ui.code(this.io.conch('devices remove <id>'))}`);
      }
      ui.hint('This computer never needs approving.');
    } else {
      ui.ok('No longer approving new devices: the password or key is enough again.');
      ui.hint('Devices you approved are remembered, should you turn it back on.');
    }
  }
}
