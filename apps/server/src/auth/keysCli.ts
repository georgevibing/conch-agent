/**
 * `conch key`, `conch keys` and `conch revoke`: access keys for scripts and
 * agents, from the terminal of the computer running Conch (ADR 0153).
 *
 * Having this terminal is the proof that it's you, so a key made here is let
 * in from the start, even where new devices need approving. Making one never
 * changes how people sign in and never signs anyone out; `--sign-in` is the
 * one way to make access keys how people sign in, and it says so first.
 */
import { readKeyLifetime, type AccessMethod } from '@conch/protocol';

import type { Ui } from '../cli/ui';
import { ago, plural, span, until } from '../cli/words';
import { AccessError, type AccessStore } from './store';

export interface KeysIo {
  store: AccessStore;
  /** Everything a person reads goes through the terminal kit. */
  ui: Ui;
  /** What to tell people to type: `conch …` (or `pnpm conch` in a checkout). */
  conch: (args: string) => string;
  now: () => number;
}

/** How people sign in, the way a person says it. */
const HOW: Record<AccessMethod, string> = {
  none: 'Sign-in is still off',
  password: 'You still sign in with your password',
  passkey: 'You still sign in with your passkeys',
  key: 'You still sign in with your access key',
};

/** What a key may do, in plain words: a script with it is you, in Conch, minus a few things. */
const CAN_DO =
  'It can do what you can do in Conch, through its API: chats, files, commands and settings. It can’t change how you sign in, sign a device in, or make more keys.';

/** "for 30 minutes", "until 15:32, for 2 hours", "until 24 Nov, for 30 days". */
function lifetime(expiresAt: number, now: number): string {
  const when = until(expiresAt, now);
  return when.startsWith('for ') ? when : `${when}, for ${span(expiresAt - now)}`;
}

interface KeyArgs {
  name: string;
  /** `--for 1h`: how long it lasts. */
  lifetime?: number;
  /** `--for` was given, but not as a time Conch understands. */
  badLifetime?: string;
  signIn: boolean;
}

/** `[name words…] [--for <time>] [--sign-in]`, in any order. `--for=1h` works too. */
export function readKeyArgs(args: readonly string[]): KeyArgs {
  const words: string[] = [];
  let lifetime: number | undefined;
  let badLifetime: string | undefined;
  let signIn = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--sign-in') signIn = true;
    else if (arg === '--for' || arg.startsWith('--for=')) {
      // "--for 2 days" and "--for 2days" both read; so does "--for=1h".
      let text = arg.startsWith('--for=') ? arg.slice('--for='.length) : (args[++i] ?? '');
      if (/^\d+$/.test(text) && args[i + 1] && !args[i + 1]?.startsWith('--'))
        text = `${text} ${args[++i]}`;
      lifetime = readKeyLifetime(text);
      if (lifetime === undefined) badLifetime = text;
    } else if (!arg.startsWith('--')) words.push(arg);
  }
  return {
    name: words.join(' ').trim() || 'Terminal',
    ...(lifetime !== undefined && { lifetime }),
    ...(badLifetime !== undefined && { badLifetime }),
    signIn,
  };
}

/** `conch key [name] [--for <time>] [--sign-in]`. */
export async function makeKey(args: readonly string[], io: KeysIo): Promise<void> {
  const { ui, store, conch } = io;
  const wanted = readKeyArgs(args);
  if (wanted.badLifetime !== undefined) {
    ui.error(`“${wanted.badLifetime}” isn’t a time Conch understands.`);
    ui.hint(
      `Say how long, from 5 minutes to a year: ${ui.code(conch('key "My script" --for 1h'))}`,
    );
    ui.hint('Nothing was made.');
    process.exitCode = 1;
    return;
  }
  if (wanted.signIn && wanted.lifetime !== undefined) {
    ui.error('A key you sign in with can’t run out, or you’d be locked out when it did.');
    ui.hint('Leave out --for, or leave out --sign-in to make a key for a script.');
    process.exitCode = 1;
    return;
  }
  const before = await store.method();
  const locked = await store.locked();
  const now = io.now();
  const made = await store.addKey(wanted.name, {
    ...(wanted.signIn && { signIn: true }),
    ...(wanted.lifetime !== undefined && { expiresAt: now + wanted.lifetime }),
    // This terminal is where approving happens: the key needs no approving.
    approvedHow: 'terminal',
  });
  const { info } = made;
  const lasts =
    info.expiresAt !== undefined
      ? `It works ${lifetime(info.expiresAt, now)}, then stops by itself.`
      : 'It works until you revoke it.';
  ui.ok(`Made the access key “${info.name}”. ${lasts}`);
  ui.blank();
  ui.box(
    [
      ui.bold(made.key),
      ui.dim('Copy it now: it won’t be shown again.'),
      ui.dim(`Send it as Authorization: Bearer ${made.key.slice(0, 10)}…`),
    ],
    { title: 'Access key', tone: 'accent' },
  );
  ui.blank();
  ui.say(CAN_DO);
  if (made.method === 'none')
    ui.say('Sign-in is off, so it works for scripts on this computer only.');
  if (await store.approvalOn()) ui.say('Made in this terminal, so it needs no approving.');
  if (made.turnedOn) {
    ui.blank();
    if (locked) ui.note('Sign-in was locked, so access keys are now how you sign in.');
    else
      ui.note(
        before === 'password'
          ? 'Access keys are now how you sign in: your password no longer works.'
          : 'Access keys are now how you sign in.',
      );
    ui.hint('Paste this key on the sign-in screen. Every other device was signed out.');
    if (before === 'passkey' || (await store.passkeyRecords()).length)
      ui.hint('Your passkeys still work.');
  } else {
    ui.hint(`${HOW[made.method]}, and nobody was signed out.`);
  }
  ui.hint(`Revoke it any time: ${ui.code(conch(`revoke ${info.id}`))}`);
}

/** `conch keys`. */
export async function listKeys(io: KeysIo): Promise<void> {
  const { ui, store, conch } = io;
  const list = await store.keys();
  if (!list.length) {
    ui.say('No access keys yet.');
    ui.hint(`Make one for a script or an agent: ${ui.code(conch('key "My script"'))}`);
    ui.hint(`Just for a while: ${ui.code(conch('key "Handoff" --for 1h'))}`);
    return;
  }
  const now = io.now();
  ui.say(ui.bold(plural(list.length, 'access key')));
  ui.blank();
  for (const k of list) {
    const facts = [
      `…${k.hint}`,
      k.id,
      k.lastUsedAt ? `used ${ago(k.lastUsedAt, now)}` : 'never used',
      k.expiresAt !== undefined ? `works ${until(k.expiresAt, now)}` : '',
      k.signIn ? 'signs you in' : 'for scripts',
    ].filter(Boolean);
    ui.say(`${ui.accent(k.name)}  ${ui.dim(facts.join('  '))}`);
  }
  ui.blank();
  ui.hint(`Revoke one: ${ui.code(conch('revoke <id>'))}. How you sign in stays as it is.`);
}

/** `conch revoke <id>`. */
export async function revokeKey(args: readonly string[], io: KeysIo): Promise<void> {
  const { ui, store, conch } = io;
  const id = args[0];
  if (!id) {
    ui.say(`Which one? ${ui.code(conch('revoke <key id>'))}`);
    ui.hint(`${conch('keys')} lists them with their ids.`);
    process.exitCode = 1;
    return;
  }
  const name = (await store.keys()).find((k) => k.id === id)?.name;
  let ended: string[];
  try {
    ended = await store.revokeKey(id);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    ui.error(error.code === 'not-found' ? 'No access key has that id.' : error.message);
    if (error.code === 'not-found') ui.hint(`${conch('keys')} lists them with their ids.`);
    process.exitCode = 1;
    return;
  }
  ui.ok(
    `Revoked${name ? ` “${name}”` : ''}. It stopped working at once${ended.length ? `, and ${plural(ended.length, 'device')} signed in with it ${ended.length === 1 ? 'was' : 'were'} signed out` : ''}.`,
  );
  ui.hint(`${HOW[await store.method()]}.`);
}
