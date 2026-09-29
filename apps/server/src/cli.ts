/* eslint-disable no-console -- a CLI talks on stdout */
/**
 * `pnpm conch <command>` — manage sign-in from the terminal of the computer
 * running Conch. This is also the way back in if you forget your password:
 * having this terminal *is* the proof that it's you.
 */
import { userInfo } from 'node:os';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

import { checkPassword, suggestPassword } from '@conch/protocol';
import { renderUnicodeCompact } from 'uqr';

import { checkup, secureHome, workspaceRules } from './auth/checkup';
import { HostPolicy, exposure } from './auth/network';
import { AccessError, AccessStore } from './auth/store';
import { loadConfig } from './config';
import { SettingsStore } from './settings/store';

const config = loadConfig();
const store = new AccessStore(config.CONCH_HOME);

const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const say = (s = '') => console.log(s ? `  ${s.replaceAll('\n', '\n  ')}` : '');

/** Ask a question; with `hidden`, nothing typed is echoed (for passwords). */
function ask(question: string, { hidden = false } = {}): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: process.stdin.isTTY });
  return new Promise((resolve) => {
    rl.question(`  ${question}`, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

async function password() {
  const current = (await store.get()).username;
  const fallback = current ?? userInfo().username;
  const username = (await ask(`Username ${dim(`(${fallback})`)}: `)).trim() || fallback;
  let secret = '';
  if (!process.argv.includes('--generate')) {
    say(dim(`At least 15 characters. A short sentence you'll remember works well.`));
    say(dim(`Press Enter on an empty line to have a strong one made for you.`));
    secret = await ask('New password: ', { hidden: true });
  }
  const generated = !secret;
  if (generated) {
    secret = suggestPassword();
  } else {
    const check = checkPassword(secret, { username });
    if (!check.ok) {
      say(`✗ ${check.message}`);
      process.exitCode = 1;
      return;
    }
    if ((await ask('Type it again: ', { hidden: true })) !== secret) {
      say('✗ Those didn’t match. Nothing was changed.');
      process.exitCode = 1;
      return;
    }
  }
  await store.setPassword(username, secret);
  say();
  say(`✓ Password sign-in is on for “${username}”. Every device now has to sign in.`);
  if (generated) {
    say();
    say(`Your password: ${bold(secret)}`);
    say(dim('Save it in your password manager now — it won’t be shown again.'));
  }
  say(dim('Any other signed-in devices were signed out.'));
}

async function key() {
  const name =
    process.argv
      .slice(3)
      .filter((a) => !a.startsWith('--'))
      .join(' ') || 'Terminal';
  const { key: value, info } = await store.addKey(name);
  say(`✓ Access key “${info.name}” created. Sign-in with access keys is on.`);
  say();
  say(bold(value));
  say();
  say(dim('Copy it now — it won’t be shown again. Paste it on the sign-in screen,'));
  say(dim(`or send it as a header: Authorization: Bearer ${value.slice(0, 10)}…`));
}

async function keys() {
  const list = await store.keys();
  if (!list.length) return say('No access keys.');
  for (const k of list) {
    const used = k.lastUsedAt
      ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
      : 'never used';
    say(`${bold(k.name)}  ${dim(`…${k.hint}  ${k.id}  ${used}`)}`);
  }
}

async function revoke() {
  const id = process.argv[3];
  if (!id) return say('Usage: pnpm conch revoke <key id>   (see `pnpm conch keys`)');
  const ended = await store.revokeKey(id);
  say(`✓ Revoked. ${ended.length} device${ended.length === 1 ? '' : 's'} signed out.`);
}

async function pair() {
  if ((await store.method()) === 'none') {
    say('Set up sign-in first: pnpm conch password');
    process.exitCode = 1;
    return;
  }
  const hosts = new HostPolicy(config);
  await hosts.discover();
  const urls = hosts.urls();
  if (!urls.length) {
    say('Conch is only reachable from this computer right now.');
    say('To use it on your phone, see docs/SECURITY.md (Tailscale is the easy, encrypted way).');
    process.exitCode = 1;
    return;
  }
  const { code, expiresAt } = await store.createPairing();
  const link = `${urls[0]}/#pair=${code}`;
  say('Scan with your phone’s camera to sign it in:');
  say();
  console.log(renderUnicodeCompact(link, { border: 2 }).replace(/^/gm, '  '));
  say(link);
  say(
    dim(
      `Works once, until ${new Date(expiresAt).toLocaleTimeString()}. Don’t share it — whoever opens it is signed in.`,
    ),
  );
}

async function signOutEverywhere() {
  const ended = await store.revokeOtherSessions();
  say(`✓ Signed out ${ended.length} device${ended.length === 1 ? '' : 's'}.`);
}

async function reset() {
  say('This turns sign-in off, deletes your password and access keys, and signs');
  say('every device out. Only this computer will be able to open Conch.');
  const answer = await ask('Type “reset” to continue: ');
  if (answer.trim() !== 'reset') return say('Nothing was changed.');
  await store.disable();
  say('✓ Sign-in is off. Open Conch on this computer and choose a new password in');
  say('  Settings → Security, or run: pnpm conch password');
}

async function status() {
  const access = await store.get();
  const settings = new SettingsStore(config.CONCH_HOME);
  const items = checkup({
    config,
    access,
    permissionMode: (await settings.get()).preferences.permissionMode,
    secure: exposure(config) === 'local',
    homeProblems: await secureHome(config.CONCH_HOME),
    workspaceRules: await workspaceRules(await settings.workspace()),
  });
  const icon = { ok: '✓', info: 'ℹ', warn: '⚠', danger: '⛔' } as const;
  say(bold('Conch security'));
  say();
  for (const item of items) {
    say(`${icon[item.level]}  ${item.title}`);
    if (item.level !== 'ok') say(dim(`   ${item.detail}`));
    if (item.command) say(dim(`   → ${item.command}`));
  }
  say();
  say(dim(`${access.sessions.length} signed-in device(s) · ${access.keys.length} access key(s)`));
}

function help() {
  say(bold('pnpm conch <command>'));
  say();
  const rows: [string, string][] = [
    ['status', 'Security checkup'],
    ['password [--generate]', 'Choose a password (or have a strong one made)'],
    ['key [name]', 'Create an access key'],
    ['keys', 'List access keys'],
    ['revoke <id>', 'Revoke an access key'],
    ['pair', 'Sign in your phone with a QR code'],
    ['sign-out-everywhere', 'Sign every device out'],
    ['reset', 'Forgot your password? Turn sign-in off and start again'],
  ];
  for (const [cmd, what] of rows) say(`${cmd.padEnd(24)}${dim(what)}`);
}

const commands: Record<string, () => Promise<void> | void> = {
  status,
  password,
  key,
  keys,
  revoke,
  pair,
  'sign-out-everywhere': signOutEverywhere,
  reset,
  help,
};

console.log();
try {
  await (commands[process.argv[2] ?? 'help'] ?? help)();
} catch (error) {
  say(`✗ ${error instanceof AccessError ? error.message : String(error)}`);
  process.exitCode = 1;
}
console.log();
