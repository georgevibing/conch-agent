/* eslint-disable no-console -- a CLI talks on stdout */
/**
 * `pnpm conch <command>` — manage sign-in from the terminal of the computer
 * running Conch. This is also the way back in if you forget your password:
 * having this terminal *is* the proof that it's you.
 */
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';

import { checkPassword, suggestPassword } from '@conch/protocol';
import { renderUnicodeCompact } from 'uqr';

import { checkup, secureHome, workspaceRules } from './auth/checkup';
import { backgroundCommand, quitCommand, type BackgroundIo } from './background/cli';
import { carriedEnv } from './background/files';
import { backendFor, BackgroundService, lastWords } from './background/service';
import { AfterLogout } from './background/little';
import { Shortcut } from './background/shortcut';
import { askUrl, TrayService } from './background/tray';
import { Tailscale } from './network/tailscale';
import { SERVER_VERSION } from './version';
import { HostPolicy, exposure } from './auth/network';
import { Devices } from './auth/devicesCli';
import { CLI_COMMANDS, type CliCommandName } from './cliCommands';
import { AccessError, AccessStore } from './auth/store';
import { BrowserStore } from './browser/store';
import { terminalRemote } from './terminal/service';
import { loadConfig } from './config';
import { IntegrationStore } from './integrations/store';
import { Healed } from './lib/healed';
import type { Heal } from './lib/recover';
import { importCommand } from './import/cli';
import { ImportService } from './import/service';
import { MemoryStore } from './memory/store';
import { probePort, runningGateway } from './port';
import { ProviderKeys } from './providers/keys';
import { RoutineService } from './routines/service';
import { RoutineStore } from './routines/store';
import { SkillStore } from './skills/store';
import { findRepository } from './updates/conch';
import { PROVIDER_COPY } from './providers/catalog';
import { SettingsStore } from './settings/store';
import { skillsCommand } from './skills/cli';
import { SkillTrust } from './skills/trust';
import { deviceSealer, registerSealer } from './lib/sealed';
import { deviceKeyFor, keystoreMode } from './vault/keystore';

const config = loadConfig();
// Conch may have started on another port (the usual one was busy): links point where it really is.
const running = await runningGateway(config.CONCH_HOME);
if (running) config.CONCH_PORT = running.port;
// Conch's own keys open here as they do in the gateway: with this computer's
// device key, found the same way and only when a sealed file is read (ADR 0047).
registerSealer(
  config.CONCH_HOME,
  deviceSealer(deviceKeyFor(config.CONCH_HOME, keystoreMode(config))),
);
const healed = new Healed(config.CONCH_HOME);
const heal: Heal = (area, message) => void healed.note(area, message);
const store = new AccessStore(config.CONCH_HOME, heal);

const bold = (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[22m` : s);
const green = (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[39m` : s);
const yellow = (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[39m` : s);
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
    let answered = false;
    rl.question(`  ${question}`, (answer) => {
      answered = true;
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    // Ctrl+D (or input that ends) is no answer, never a hang.
    rl.on('close', () => {
      if (!answered) process.stdout.write('\n');
      resolve('');
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

async function devices() {
  await new Devices({
    store,
    reopen: () => new AccessStore(config.CONCH_HOME, heal),
    say,
    print: (text) => console.log(text),
    ask: (question) => ask(question),
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    style: { bold, dim, green, yellow },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  }).run(process.argv.slice(3));
}

async function signOutEverywhere() {
  const ended = await store.revokeOtherSessions();
  say(`✓ Signed out ${ended.length} device${ended.length === 1 ? '' : 's'}.`);
}

async function reset() {
  if (await store.locked()) {
    say('Conch couldn’t read who may sign in, so sign-in is locked. A copy of the');
    say('damaged file was kept next to it, in the Conch folder.');
    say();
  }
  say('This turns sign-in off, deletes your password and access keys, and signs');
  say('every device out. Only this computer will be able to open Conch.');
  const answer = await ask('Type “reset” to continue: ');
  if (answer.trim() !== 'reset') return say('Nothing was changed.');
  await store.disable();
  say('✓ Sign-in is off. Open Conch on this computer and choose a new password in');
  say('  Settings → Security, or run: pnpm conch password');
}

/** The provider in use, for the checkup, without starting the whole gateway. */
function providerCopy(id: string) {
  const copy = PROVIDER_COPY.get(id as never);
  return { name: copy?.name ?? id, asksFirst: copy?.asksFirst ?? true };
}

async function status() {
  const access = await store.get();
  const settings = new SettingsStore(config.CONCH_HOME, heal);
  const items = checkup({
    config,
    access,
    accessLocked: await store.locked(),
    permissionMode: (await settings.get()).preferences.permissionMode,
    secure: exposure(config) === 'local',
    homeProblems: await secureHome(config.CONCH_HOME),
    workspaceRules: await workspaceRules(await settings.workspace()),
    trustedIntegrations: await new IntegrationStore(config.CONCH_HOME, heal).trusted(),
    browserLocal: (await new BrowserStore(config.CONCH_HOME, heal).settings()).allowLocal,
    terminalRemote: await terminalRemote(config.CONCH_HOME),
    provider: providerCopy(config.CONCH_ENGINE ?? (await settings.get()).preferences.engine),
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
  say(
    dim(
      `${access.sessions.filter((s) => !s.pending).length} signed-in device(s) · ${access.keys.length} access key(s) · ${access.approval ? 'approving new devices' : 'not approving new devices'}`,
    ),
  );
  const waiting = (await store.requests()).filter((r) => !r.rejected).length;
  if (waiting)
    say(
      `${yellow('●')} ${waiting} device${waiting === 1 ? ' is' : 's are'} waiting: pnpm conch devices`,
    );
}

const backgroundIo: BackgroundIo = {
  say,
  bold,
  dim,
  green,
  yellow,
  running: () => runningGateway(config.CONCH_HOME),
  answering: async () => {
    const port = (await runningGateway(config.CONCH_HOME))?.port ?? config.CONCH_PORT;
    return (await probePort(config.CONCH_HOST, port)) === 'conch';
  },
  url: async () => {
    const port = (await runningGateway(config.CONCH_HOME))?.port ?? config.CONCH_PORT;
    return `http://${config.CONCH_HOST === '127.0.0.1' ? 'localhost' : config.CONCH_HOST}:${port}`;
  },
  lastWords: () => lastWords(config.CONCH_HOME),
  kill: (pid) => process.kill(pid, 'SIGTERM'),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function backgroundService() {
  const recorded = await runningGateway(config.CONCH_HOME);
  return new BackgroundService({
    home: config.CONCH_HOME,
    checkout: findRepository(import.meta.dirname, config.CONCH_CHECKOUT),
    // A person at this terminal; a Conch the computer started is left running.
    running: recorded?.background ? 'background' : 'window',
    since: Date.now(),
    backend: backendFor(config.CONCH_HOME),
    spec: { node: process.execPath, env: carriedEnv(process.env), path: process.env.PATH ?? '' },
    handover: () => false,
    heal: (message) => heal('gateway', message),
    url: `http://localhost:${recorded?.port ?? config.CONCH_PORT}`,
    shortcut: new Shortcut({ version: SERVER_VERSION }),
  });
}

function trayService() {
  const settings = new SettingsStore(config.CONCH_HOME, heal);
  return new TrayService({
    home: config.CONCH_HOME,
    checkout: findRepository(import.meta.dirname, config.CONCH_CHECKOUT),
    url: `http://localhost:${config.CONCH_PORT}`,
    ask: askUrl(config.CONCH_HOST, config.CONCH_PORT),
    spec: { node: process.execPath, env: carriedEnv(process.env), path: process.env.PATH ?? '' },
    wanted: async () => (await settings.get()).preferences.menuBar,
    setWanted: async (on) => void (await settings.update({ preferences: { menuBar: on } })),
    onToken: () => undefined,
  });
}

/** `pnpm conch tray [on|off|status]`: Conch in the menu bar, tray or panel (ADR 0029). */
async function tray() {
  const service = trayService();
  const verb = process.argv[3] ?? 'status';
  if (verb === 'on' || verb === 'off') await service.set(verb === 'on');
  const status = await service.status();
  if (!status.available) {
    say(`${yellow('⚠')} ${status.unavailable ?? 'This computer can’t show Conch there.'}`);
    if (status.need === 'command-line-tools') say(dim('  → xcode-select --install'));
    if (status.need === 'appindicator')
      say(dim('  → sudo apt install python3-gi gir1.2-ayatanaappindicator3-0.1'));
    return;
  }
  say(
    status.running
      ? `${green('●')} Conch is in the ${status.where}.`
      : status.on
        ? `${dim('○')} Conch shows in the ${status.where} whenever it runs.`
        : `${dim('○')} Conch isn’t shown in the ${status.where}.`,
  );
  say(dim(status.on ? '  pnpm conch tray off' : '  pnpm conch tray on'));
}

/** `pnpm conch phone`: your phone's secure address (Tailscale, ADR 0027), on with one command. */
async function phone() {
  const recorded = await runningGateway(config.CONCH_HOME);
  const tailscale = new Tailscale({ port: () => recorded?.port ?? config.CONCH_PORT });
  let address = await tailscale.status();
  if (address.state === 'off') address = await tailscale.serve();
  const next = {
    missing:
      'Install Tailscale on this computer and on your phone, and sign in to both: https://tailscale.com/download',
    stopped: 'Open Tailscale on this computer (sudo tailscale up on Linux), then run this again.',
    'signed-out': 'Sign in to Tailscale on this computer (tailscale up), then run this again.',
  } as const;
  if (address.state === 'ready') {
    say(`${green('✓')} Your devices reach Conch at ${bold(address.url ?? '')}`);
    say(dim('  Sign your phone in: pnpm conch pair'));
    return;
  }
  if (address.state in next) say(next[address.state as keyof typeof next]);
  if (address.problem) {
    say(`${yellow('⚠')} ${address.problem.message}`);
    if (address.problem.url) say(dim(`  → ${address.problem.url}`));
    if (address.problem.command) say(dim(`  → ${address.problem.command}`));
  }
  process.exitCode = 1;
}

async function background() {
  if (process.argv[3] === 'after-logout') {
    const on = process.argv[4] !== 'off';
    const backend = await backendFor(config.CONCH_HOME);
    const result = await new AfterLogout({ systemd: async () => backend?.kind === 'systemd' }).set(
      on,
    );
    if (result.state === 'unavailable')
      say(result.note ?? 'This computer stops Conch when you log out.');
    else if (result.state === (on ? 'on' : 'off'))
      say(
        `${green('✓')} ${on ? 'Conch keeps running after you log out.' : 'Conch stops when you log out.'}`,
      );
    else {
      say(`${yellow('⚠')} ${result.note ?? 'That needs an administrator.'}`);
      if (result.command) say(dim(`  → ${result.command}`));
      process.exitCode = 1;
    }
    return;
  }
  process.exitCode = await backgroundCommand(
    process.argv.slice(3),
    await backgroundService(),
    backgroundIo,
  );
}

async function importFrom() {
  const settings = new SettingsStore(config.CONCH_HOME, heal);
  const memory = new MemoryStore(join(config.CONCH_HOME, 'memory'));
  const skills = new SkillStore(config.CONCH_HOME);
  const routineStore = new RoutineStore(join(config.CONCH_HOME, 'routines'), heal);
  // The CLI only ever adds drafts: no runs, so nothing needs a provider here.
  const routines = new RoutineService({
    store: routineStore,
    conversations: undefined as never,
    engine: () => undefined as never,
    emit: () => undefined,
  });
  const keys = new ProviderKeys(settings);
  const imports = new ImportService({
    home: config.CONCH_HOME,
    ...(config.CONCH_IMPORT_HOME && { sourceHome: config.CONCH_IMPORT_HOME }),
    targets: {
      settings,
      memory,
      skills: {
        // Conch's own: another app's skills are only read in place, and go with it.
        names: async () =>
          (await skills.list()).skills.filter((s) => s.source === 'conch').map((s) => s.name),
        adopt: (folder, base) => skills.adopt(folder, base),
        remove: (id) => skills.remove(id),
      },
      routines: {
        create: (input) => routines.create(input, { createdBy: 'user' }),
        remove: (id) => routines.remove(id),
      },
      channels: {
        connect: async () => {
          throw new Error('Chat bots come over in Conch itself.');
        },
        remove: async () => undefined,
      },
      keys: {
        has: async (provider) => Boolean(await keys.describe(provider)),
        set: async () => {
          throw new Error('Keys come over in Conch itself.');
        },
        clear: async () => undefined,
      },
    },
  });
  process.exitCode = await importCommand(process.argv.slice(3), imports, {
    say,
    bold,
    dim,
    green,
    yellow,
    running: async () => Boolean(await runningGateway(config.CONCH_HOME)),
  });
}

async function shortcut() {
  if (process.argv[3] === 'remove') {
    await (await backgroundService()).removeShortcut();
    say(`${green('✓')} Conch is no longer in your apps.`);
    return;
  }
  const status = await (await backgroundService()).addShortcut();
  say(
    `${green('✓')} Conch is in ${status.shortcut?.where ?? 'your apps'}. Open it from there any time.`,
  );
}

async function skills() {
  process.exitCode = await skillsCommand(process.argv.slice(3), new SkillTrust(config.CONCH_HOME), {
    say,
    bold,
    dim,
    green,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    defaultName: userInfo().username,
  });
}

async function quit() {
  process.exitCode = await quitCommand(backgroundIo);
}

function help() {
  say(bold('pnpm conch <command>'));
  say();
  const width = Math.max(...CLI_COMMANDS.map((c) => c.usage.length)) + 2;
  for (const { usage, summary } of CLI_COMMANDS) say(`${usage.padEnd(width)}${dim(summary)}`);
}

/** Typed by `cliCommands.ts`: a command needs its words there before it can exist here. */
const commands: Record<CliCommandName | 'help', () => Promise<void> | void> = {
  status,
  password,
  key,
  keys,
  revoke,
  pair,
  devices,
  'sign-out-everywhere': signOutEverywhere,
  reset,
  background,
  quit,
  shortcut,
  tray,
  phone,
  import: importFrom,
  skills,
  help,
};

console.log();
try {
  const handlers: Record<string, (() => Promise<void> | void) | undefined> = commands;
  await (handlers[process.argv[2] ?? 'help'] ?? help)();
} catch (error) {
  say(`✗ ${error instanceof AccessError ? error.message : String(error)}`);
  process.exitCode = 1;
}
console.log();
