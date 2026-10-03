/**
 * `conch <command>` (or `pnpm conch` in a checkout): Conch from the terminal
 * of the computer it runs on. Setting it up, signing in, devices, running it.
 * This is also the way back in if you forget your password: having this
 * terminal *is* the proof that it's you.
 *
 * Everything it prints goes through the terminal kit (`cli/ui.ts`), in the
 * voice `cli/words.ts` describes: warm, a little playful, always exact.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';

import { AddressStatus, checkPassword, suggestPassword } from '@conch/protocol';

import { ensurePrivateNode, lowPortsAllowed, setcapCommand } from './address/runtime';
import { dnsReport } from './address/service';
import { HERE_HEADER, hereKeyFile } from './auth/here';
import { setup as setupWizard } from './cli/setup';

import { checkup, secureHome, workspaceRules } from './auth/checkup';
import { ThisComputer } from './auth/here';
import { askHere, openHere } from './auth/open-here';
import { backgroundCommand, quitCommand, type BackgroundIo } from './background/cli';
import { carriedEnv } from './background/files';
import { backendFor, BackgroundService, lastWords } from './background/service';
import { AfterLogout } from './background/little';
import { Shortcut } from './background/shortcut';
import { askUrl, TrayService } from './background/tray';
import { cliName, installShim, removeShim } from './cli/command';
import { banner, working } from './cli/pearl';
import { createPrompts } from './cli/prompts';
import { createUi } from './cli/ui';
import { ago, plural, until } from './cli/words';
import { Tailscale } from './network/tailscale';
import { SERVER_VERSION } from './version';
import { HostPolicy, exposure } from './auth/network';
import { Devices } from './auth/devicesCli';
import { CLI_COMMANDS, type CliCommand, type CliCommandName, type CliGroup } from './cliCommands';
import { AccessError, AccessStore } from './auth/store';
import { BrowserStore } from './browser/store';
import { terminalRemote } from './terminal/service';
import { loadConfig } from './config';
import { IntegrationStore } from './integrations/store';
import { Healed } from './lib/healed';
import { quietCryptoWarnings } from './lib/quiet';
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
import { SkillUsage } from './skills/usage';
import { deviceSealer, registerSealer } from './lib/sealed';
import { deviceKeyFor, keystoreMode } from './vault/keystore';

quietCryptoWarnings();
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

const ui = createUi();
const prompts = createPrompts({ ui });
/** What to tell people to type: `conch` once it's on PATH, `pnpm conch` in a checkout. */
const conch = (args: string) => `${cliName()} ${args}`;
const { bold, dim } = ui;
const say = (text = '') => ui.say(text);

/** Ask a question; nothing typed is echoed with `hidden`. No keyboard is no answer. */
async function ask(question: string, options: { hidden?: boolean; default?: string } = {}) {
  return (await prompts.ask(question, options)) ?? '';
}

/** The address a phone or another computer would use, best first (an address of your own first). */
async function addresses(): Promise<string[]> {
  const hosts = new HostPolicy(config);
  await hosts.discover();
  return hosts.urls();
}

/** A one-time link in a card, with a QR code when it fits. */
function linkCard(title: string, url: string, lines: string[]) {
  ui.blank();
  if (ui.qr(url)) ui.blank();
  ui.box([ui.link(url), ...lines.map((line) => dim(line))], { title, tone: 'accent' });
}

// ── Getting started ──────────────────────────────────────────────────────

/** `conch hello`: the link that makes an unclaimed Conch yours (ADR 0064). */
async function hello() {
  const method = await store.method();
  if (method !== 'none') {
    ui.ok('This Conch is already yours. 🐚');
    ui.hint('Sign in on any device you’ve let in. Lost your way in?');
    ui.hint(`${conch('reset')} starts over, then ${conch('hello')} makes it yours again.`);
    return;
  }
  const urls = (await addresses()).filter((url) => url.startsWith('https://'));
  if (!urls.length) {
    ui.note('Conch is only reachable from this computer right now.');
    ui.hint(`On this computer, just open it: ${conch('open')}`);
    ui.hint(`To reach it from anywhere, give it an address first: ${conch('setup')}`);
    process.exitCode = 1;
    return;
  }
  const { code, expiresAt } = await store.createHello();
  const url = `${urls[0]}/#hello=${code}`;
  say('Open this on your own computer or phone to make Conch yours:');
  linkCard('Make it yours', url, [
    `Works once, ${until(expiresAt)}.`,
    'Whoever opens it first owns this Conch, so keep it to yourself.',
  ]);
  ui.blank();
  ui.hint('You’ll choose Touch ID, Windows Hello or a password there. That’s it.');
}

/** `conch open [page] [--link]`: Conch in this computer's browser, as this computer (ADR 0063). */
async function open() {
  const args = process.argv.slice(3);
  const wantsLink = args.includes('--link');
  const page = args.find((arg) => arg.startsWith('/'));
  const port = (await runningGateway(config.CONCH_HOME))?.port ?? config.CONCH_PORT;
  if ((await probePort(config.CONCH_HOST, port)) !== 'conch') {
    ui.error('Conch isn’t running right now.');
    ui.hint(`Start it with ${conch('background on')}, or pnpm start in its folder.`);
    process.exitCode = 1;
    return;
  }
  if (wantsLink) {
    const link = await askHere({ home: config.CONCH_HOME, page });
    if (!link) {
      ui.error('Conch didn’t hand out a link.');
      ui.hint(`Restart it (${conch('quit')}, then start it again) and try once more.`);
      process.exitCode = 1;
      return;
    }
    say('Open this in the browser you want to use Conch in, on this computer:');
    linkCard('Open Conch', link.url, [
      'Works once, for two minutes, and only on this computer.',
      'Don’t share it: whoever opens it first gets in.',
    ]);
    return;
  }
  const how = await openHere({ home: config.CONCH_HOME, url: `http://localhost:${port}`, page });
  if (how === 'opened') ui.ok('Opened Conch in your browser. ✨');
  else if (how === 'plain') {
    ui.note('Opened Conch, but it couldn’t hand your browser its key.');
    ui.hint('Restart Conch and try again.');
  } else {
    ui.note('There’s no browser to open here.');
    ui.hint(
      `For a browser at the end of an SSH tunnel, ask for a one-time link: ${conch('open --link')}`,
    );
  }
}

// ── Signing in ───────────────────────────────────────────────────────────

async function password() {
  const current = (await store.get()).username;
  const fallback = current ?? userInfo().username;
  let username = fallback;
  let secret = '';
  if (!process.argv.includes('--generate')) {
    say('Let’s choose a password.');
    ui.hint('At least 15 characters. A short sentence you’ll remember works great.');
    ui.hint('Press Enter on an empty line and Conch makes a strong one for you.');
    ui.blank();
    username = (await ask('Username', { default: fallback })).trim() || fallback;
    secret = await ask('New password', { hidden: true });
  }
  const generated = !secret;
  if (generated) {
    secret = suggestPassword();
  } else {
    const check = checkPassword(secret, { username });
    if (!check.ok) {
      ui.error(check.message);
      ui.hint('Nothing was changed.');
      process.exitCode = 1;
      return;
    }
    if ((await ask('Once more, to be sure', { hidden: true })) !== secret) {
      ui.error('Those didn’t match, so nothing was changed.');
      process.exitCode = 1;
      return;
    }
  }
  await store.setPassword(username, secret);
  ui.blank();
  ui.ok(`Password sign-in is on for “${username}”.`);
  if (generated) {
    ui.blank();
    ui.box(
      [bold(secret), dim('Save it in your password manager now: Conch won’t show it again.')],
      {
        title: 'Your password',
        tone: 'accent',
      },
    );
  }
  ui.hint('Every other device was signed out, and signs in with it from now on.');
}

async function key() {
  const name =
    process.argv
      .slice(3)
      .filter((a) => !a.startsWith('--'))
      .join(' ') || 'Terminal';
  const { key: value, info } = await store.addKey(name);
  ui.ok(`Made the access key “${info.name}”. Sign-in with access keys is on.`);
  ui.blank();
  ui.box(
    [
      bold(value),
      dim('Copy it now: it won’t be shown again.'),
      dim(
        `Paste it on the sign-in screen, or send it as Authorization: Bearer ${value.slice(0, 10)}…`,
      ),
    ],
    { title: 'Access key', tone: 'accent' },
  );
}

async function keys() {
  const list = await store.keys();
  if (!list.length) {
    say('No access keys yet.');
    ui.hint(`Make one for a script or another device: ${conch('key "My laptop"')}`);
    return;
  }
  say(bold(plural(list.length, 'access key')));
  ui.blank();
  for (const k of list)
    say(
      `${ui.accent(k.name)}  ${dim(`…${k.hint}  ${k.id}  ${k.lastUsedAt ? `used ${ago(k.lastUsedAt)}` : 'never used'}`)}`,
    );
}

async function revoke() {
  const id = process.argv[3];
  if (!id) {
    say(`Which one? ${conch('revoke <key id>')}`);
    ui.hint(`${conch('keys')} lists them with their ids.`);
    process.exitCode = 1;
    return;
  }
  const ended = await store.revokeKey(id);
  ui.ok(`Revoked. ${plural(ended.length, 'device')} signed out.`);
}

/** `conch passkeys [remove <id>]` (ADR 0065). */
async function passkeys() {
  if (process.argv[3] === 'remove') {
    const id = process.argv[4];
    if (!id) {
      say(`Which one? ${conch('passkeys remove <id>')}`);
      process.exitCode = 1;
      return;
    }
    const found = (await store.passkeyRecords()).find((p) => p.id === id || p.id.startsWith(id));
    if (!found) throw new AccessError('not-found', 'No passkey has that id. See conch passkeys.');
    const ended = await store.removePasskey(found.id);
    ui.ok(`Forgot “${found.label ?? found.name}”. ${plural(ended.length, 'device')} signed out.`);
    return;
  }
  const list = await store.passkeyRecords();
  if (!list.length) {
    say('No passkeys yet.');
    ui.hint('Add one in Conch, on the device that keeps it: Settings → Security → Passkeys.');
    ui.hint('Touch ID, Windows Hello and Face ID all work.');
    return;
  }
  say(bold(plural(list.length, 'passkey')));
  ui.blank();
  for (const p of list) {
    say(`${ui.accent(p.label ?? p.name)}  ${dim(`for ${p.rpId}`)}`);
    ui.hint(
      `  ${p.id.slice(0, 12)}  added ${ago(p.createdAt)}${p.lastUsedAt ? ` · used ${ago(p.lastUsedAt)}` : ''}${p.synced ? ' · synced' : ''}`,
    );
  }
}

async function pair() {
  if ((await store.method()) === 'none') {
    ui.note('Choose how you sign in first.');
    ui.hint(`${conch('password')}, or open Conch and add a passkey in Settings → Security.`);
    process.exitCode = 1;
    return;
  }
  const urls = await addresses();
  if (!urls.length) {
    ui.note('Conch is only reachable from this computer right now.');
    ui.hint(`Give your phone a way in first: ${conch('phone')} (Tailscale) or ${conch('setup')}.`);
    process.exitCode = 1;
    return;
  }
  const { code, expiresAt } = await store.createPairing();
  say('Point your phone’s camera at this to sign it in:');
  linkCard('Sign in your phone', `${urls[0]}/#pair=${code}`, [
    `Works once, ${until(expiresAt)}.`,
    'Whoever opens it is signed in, so don’t share it.',
  ]);
}

async function devices() {
  await new Devices({
    store,
    reopen: () => new AccessStore(config.CONCH_HOME, heal),
    ui,
    print: (text) => ui.write(`${text}\n`),
    ask: (question) => ask(question),
    confirm: (question, fallback) => prompts.confirm(question, fallback),
    interactive: prompts.interactive && Boolean(process.stdout.isTTY),
    conch,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: Date.now,
  }).run(process.argv.slice(3));
}

async function signOutEverywhere() {
  const ended = await store.revokeOtherSessions();
  ui.ok(`Signed out ${plural(ended.length, 'device')}. Your ways of signing in still work.`);
}

async function reset() {
  if (await store.locked()) {
    ui.note('Conch couldn’t read who may sign in, so it locked itself to keep you safe.');
    ui.hint('A copy of the damaged file is kept next to it, in the Conch folder.');
    ui.blank();
  }
  say('This turns sign-in off: your password, access keys and passkeys are forgotten,');
  say('and every device is signed out. Only this computer can open Conch afterwards.');
  ui.blank();
  const answer = await ask(`Type ${bold('reset')} to go ahead`);
  if (answer.trim() !== 'reset') {
    ui.hint('Nothing was changed.');
    return;
  }
  await store.disable();
  // Every browser here proves itself again (ADR 0063): one that kept a cookie isn't trusted on it.
  new ThisComputer(config.CONCH_HOME).rotate();
  ui.ok('Sign-in is off. Fresh start. 🐚');
  ui.blank();
  ui.hint(
    `On this computer: ${conch('open')}, then choose how you sign in in Settings → Security.`,
  );
  ui.hint(`On a server: ${conch('hello')} prints a link that makes it yours again.`);
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
  const urls = await addresses();
  await banner(ui, {
    line: 'Security checkup',
    sub: [`v${SERVER_VERSION}`, urls[0]?.replace(/^https?:\/\//, '')].filter(Boolean).join(' · '),
  });
  const mark = {
    ok: ui.success(ui.sym.ok),
    info: ui.pearl(ui.sym.dot, 1),
    warn: ui.warning(ui.sym.warn),
    danger: ui.danger(ui.sym.fail),
  } as const;
  for (const item of items) {
    say(`${mark[item.level]} ${item.title}`);
    if (item.level !== 'ok') ui.hint(`  ${item.detail}`);
    if (item.command) say(`  ${ui.code(item.command)}`);
  }
  ui.blank();
  const signedIn = access.sessions.filter((s) => !s.pending).length;
  ui.hint(
    [
      `${plural(signedIn, 'device')} signed in`,
      ...(access.passkeys.length ? [plural(access.passkeys.length, 'passkey')] : []),
      ...(access.keys.length ? [plural(access.keys.length, 'access key')] : []),
      access.approval ? 'new devices need your OK' : 'new devices don’t need your OK',
    ].join(' · '),
  );
  const waiting = (await store.requests()).filter((r) => !r.rejected).length;
  if (waiting)
    say(
      `${ui.warning(ui.sym.dot)} ${waiting === 1 ? 'A device is' : `${waiting} devices are`} knocking: ${ui.code(conch('devices'))}`,
    );
}

// ── Running Conch ────────────────────────────────────────────────────────

const backgroundIo: BackgroundIo = {
  ui,
  conch,
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

/** Always on, with `node` to run Conch on (the one running now, unless Conch moves to its own). */
async function backgroundService(node = process.execPath) {
  const recorded = await runningGateway(config.CONCH_HOME);
  return new BackgroundService({
    home: config.CONCH_HOME,
    checkout: findRepository(import.meta.dirname, config.CONCH_CHECKOUT),
    // A person at this terminal; a Conch the computer started is left running.
    running: recorded?.background ? 'background' : 'window',
    since: Date.now(),
    backend: backendFor(config.CONCH_HOME),
    spec: { node, env: carriedEnv(process.env), path: process.env.PATH ?? '' },
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

/** `conch tray [on|off|status]`: Conch in the menu bar, tray or panel (ADR 0029). */
async function tray() {
  const service = trayService();
  const verb = process.argv[3] ?? 'status';
  if (verb === 'on' || verb === 'off') await service.set(verb === 'on');
  const status = await service.status();
  if (!status.available) {
    ui.note(status.unavailable ?? 'This computer can’t show Conch there.');
    if (status.need === 'command-line-tools') ui.command('xcode-select --install');
    if (status.need === 'appindicator')
      ui.command('sudo apt install python3-gi gir1.2-ayatanaappindicator3-0.1');
    return;
  }
  say(
    status.running
      ? `${ui.success(ui.sym.dot)} The pearl is in the ${status.where}. 🐚`
      : status.on
        ? `${dim(ui.sym.ring)} The pearl shows in the ${status.where} whenever Conch runs.`
        : `${dim(ui.sym.ring)} Conch isn’t shown in the ${status.where}.`,
  );
  ui.hint(status.on ? `Hide it: ${conch('tray off')}` : `Show it: ${conch('tray on')}`);
}

/** `conch phone`: your phone's secure address (Tailscale, ADR 0027), on with one command. */
async function phone() {
  const recorded = await runningGateway(config.CONCH_HOME);
  const tailscale = new Tailscale({ port: () => recorded?.port ?? config.CONCH_PORT });
  const address = await working(ui, 'Looking for Tailscale', async () => {
    const now = await tailscale.status();
    return now.state === 'off' ? tailscale.serve() : now;
  });
  const next = {
    missing:
      'Install Tailscale on this computer and on your phone, and sign in to both: https://tailscale.com/download',
    stopped: 'Open Tailscale on this computer (sudo tailscale up on Linux), then run this again.',
    'signed-out': 'Sign in to Tailscale on this computer (tailscale up), then run this again.',
  } as const;
  if (address.state === 'ready') {
    ui.ok(`Your devices reach Conch at ${bold(address.url ?? '')} ✨`);
    ui.hint(
      (await store.method()) === 'none'
        ? `Make it yours from your phone: ${conch('hello')}`
        : `Sign your phone in: ${conch('pair')}`,
    );
    return;
  }
  if (address.state in next) ui.note(next[address.state as keyof typeof next]);
  if (address.problem) {
    ui.note(address.problem.message);
    if (address.problem.url) ui.hint(`  ${address.problem.url}`);
    if (address.problem.command) ui.command(address.problem.command);
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
      ui.note(result.note ?? 'This computer stops Conch when you log out.');
    else if (result.state === (on ? 'on' : 'off'))
      ui.ok(on ? 'Conch keeps running after you log out.' : 'Conch stops when you log out.');
    else {
      ui.note(result.note ?? 'That needs an administrator.');
      if (result.command) ui.command(result.command);
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

async function shortcut() {
  if (process.argv[3] === 'remove') {
    await (await backgroundService()).removeShortcut();
    ui.ok('Conch is no longer in your apps.');
    return;
  }
  const status = await (await backgroundService()).addShortcut();
  ui.ok(`Conch is in ${status.shortcut?.where ?? 'your apps'}. Open it from there any time. ✨`);
}

async function quit() {
  process.exitCode = await quitCommand(backgroundIo);
}

// ── Setting up, and your own address (ADR 0064) ──────────────────────────

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The running Conch answers on loopback. */
async function answering(): Promise<boolean> {
  const port = (await runningGateway(config.CONCH_HOME))?.port ?? config.CONCH_PORT;
  return (await probePort(config.CONCH_HOST, port)) === 'conch';
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return true;
    await pause(500);
  }
  return check();
}

/**
 * Ask the running Conch about its address, as a program on this computer:
 * with the key only this account can read (ADR 0063), never a sign-in.
 */
async function hereApi(method: 'GET' | 'PUT' | 'DELETE' | 'POST', path: string, body?: object) {
  const key = readFileSync(hereKeyFile(config.CONCH_HOME), 'utf8').trim();
  const port = (await runningGateway(config.CONCH_HOME))?.port ?? config.CONCH_PORT;
  const response = await fetch(`${askUrl(config.CONCH_HOST, port)}/api/here${path}`, {
    method,
    headers: { [HERE_HEADER]: key, ...(body && { 'content-type': 'application/json' }) },
    ...(body && { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) throw new Error(json.message ?? `Conch said ${response.status}.`);
  return json;
}

const addressApi = {
  status: async () => AddressStatus.parse(await hereApi('GET', '/address')),
  set: async (name: string) => AddressStatus.parse(await hereApi('PUT', '/address', { name })),
  remove: async () => AddressStatus.parse(await hereApi('DELETE', '/address')),
  renew: async () => AddressStatus.parse(await hereApi('POST', '/address/renew')),
  here: async () => AddressStatus.parse(await hereApi('POST', '/address/here')),
};

/** Run something as the administrator, the person at the keyboard typing their password. */
function sudo(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { stdio: 'inherit' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** A firewall on this server that may keep the web's ports shut, and the one command that opens them. */
async function firewall(): Promise<{ name: string; command: string } | undefined> {
  if (process.platform !== 'linux') return undefined;
  try {
    if (/^\s*ENABLED\s*=\s*yes/m.test(readFileSync('/etc/ufw/ufw.conf', 'utf8')))
      return { name: 'The ufw firewall', command: 'sudo ufw allow 80,443/tcp' };
  } catch {
    // No ufw.
  }
  const active = await new Promise<boolean>((resolve) => {
    const child = spawn('systemctl', ['is-active', '--quiet', 'firewalld'], { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
  return active
    ? {
        name: 'firewalld',
        command:
          'sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload',
      }
    : undefined;
}

/** No screen of its own: a server, or someone here over SSH. */
function headless(): boolean {
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)
    return true;
  return Boolean(process.env.SSH_CONNECTION) && !process.env.DISPLAY;
}

/** `conch setup`: how you'll reach Conch, and the link that makes it yours (ADR 0064). */
async function setup() {
  const tailscaleFor = async () => {
    const recorded = await runningGateway(config.CONCH_HOME);
    return new Tailscale({ port: () => recorded?.port ?? config.CONCH_PORT });
  };
  process.exitCode = await setupWizard(process.argv.slice(3), {
    ui,
    prompts,
    conch,
    version: SERVER_VERSION,
    hostname: hostname(),
    headless: headless(),
    port: config.CONCH_PORT,
    user: userInfo().username,
    gateway: {
      running: answering,
      start: async () => {
        await (await backgroundService()).set(true);
        return waitFor(answering, 60_000);
      },
      restartOn: async (node) => {
        // Stop the one running, then let the computer start it on its new Node.
        const now = await runningGateway(config.CONCH_HOME);
        if (now) {
          try {
            process.kill(now.pid, 'SIGTERM');
          } catch {
            // Already gone.
          }
          await waitFor(async () => !(await answering()), 20_000);
        }
        await (await backgroundService(node)).enable();
        return waitFor(answering, 60_000);
      },
      address: { status: addressApi.status, set: addressApi.set },
    },
    dns: (name) => dnsReport(name),
    ports: {
      allowed: () => lowPortsAllowed({ home: config.CONCH_HOME }),
      privateNode: () => ensurePrivateNode({ home: config.CONCH_HOME }),
      command: (node) => setcapCommand(node),
    },
    firewall,
    sudo,
    tailscale: {
      turnOn: async () => {
        const tailscale = await tailscaleFor();
        let address = await tailscale.status();
        if (address.state === 'off') address = await tailscale.serve();
        if (address.state === 'ready' && address.url) return { url: address.url };
        const next = {
          missing:
            'Install Tailscale on this computer and your devices, and sign in: https://tailscale.com/download',
          stopped: 'Start Tailscale on this computer: sudo tailscale up',
          'signed-out': 'Sign in to Tailscale on this computer: tailscale up',
        } as const;
        return {
          problem:
            address.problem?.message ??
            (address.state in next ? next[address.state as keyof typeof next] : undefined),
          next: address.problem?.command ?? address.problem?.url,
        };
      },
    },
    access: { method: () => store.method(), hello: () => store.createHello() },
    open: async () => {
      const port = (await runningGateway(config.CONCH_HOME))?.port ?? config.CONCH_PORT;
      const how = await openHere({ home: config.CONCH_HOME, url: `http://localhost:${port}` });
      return how === 'opened';
    },
    sleep: pause,
    now: Date.now,
  });
}

/** `conch address [status|set <name>|off|renew|here]`: your own address (ADR 0064). */
async function address() {
  const [verb = 'status', name] = process.argv.slice(3);
  if (verb === 'set') {
    if (!name) {
      say(`Which address? ${conch('address set conch.yourname.com')}`);
      process.exitCode = 1;
      return;
    }
    // The whole conversation: the record, the ports, the certificate, starting Conch if needed.
    process.argv.splice(3, process.argv.length, '--domain', name);
    return setup();
  }
  if (!existsSync(hereKeyFile(config.CONCH_HOME)) || !(await answering())) {
    ui.error('Conch isn’t running right now.');
    ui.hint(`Start it with ${conch('background on')}, then try again.`);
    process.exitCode = 1;
    return;
  }
  const show = (status: AddressStatus) => {
    if (status.state === 'off') {
      say('Conch has no address of its own yet.');
      ui.hint(`Give it one: ${conch('setup')}`);
      return;
    }
    const where = status.url ?? `https://${status.name ?? ''}`;
    if (status.state === 'ready') {
      ui.ok(`Conch answers at ${bold(where)} 🔒`);
      if (status.certificate)
        ui.hint(
          `Certificate from ${status.certificate.issuer}, good ${until(status.certificate.notAfter)}. It renews by itself.`,
        );
    } else if (status.state === 'problem')
      ui.error(status.problem?.message ?? `${where} isn’t answering.`);
    else
      say(
        `${ui.pearl(ui.sym.dot)} ${where}: ${status.state === 'checking' ? 'checking the way in' : 'getting its certificate'}…`,
      );
    if (status.state === 'ready' && status.problem) ui.note(status.problem.message);
    if (status.problem?.command) ui.command(status.problem.command);
  };
  if (verb === 'off') {
    const sure = await prompts.confirm(
      'Turn the address off? Devices that use it can’t reach Conch until it’s back.',
      false,
    );
    if (!sure) return ui.hint('Nothing was changed.');
    show(await addressApi.remove());
    return ui.ok('The address is off. Conch is reachable the other ways you set up.');
  }
  if (verb === 'renew') {
    await addressApi.renew();
    const status = await working(ui, 'Renewing the certificate', async () => {
      await waitFor(
        async () => (await addressApi.status()).state !== 'getting-certificate',
        120_000,
      );
      return addressApi.status();
    });
    return show(status);
  }
  if (verb === 'here') return show(await addressApi.here());
  show(await addressApi.status());
}

/** `conch command [on|off]`: the `conch` command on PATH, so nobody needs Conch's folder. */
async function command() {
  if (process.argv[3] === 'off') {
    await removeShim({});
    ui.ok('The conch command is gone.');
    ui.hint('pnpm conch still works in Conch’s folder, and the installer puts it back.');
    return;
  }
  const installDir = findRepository(import.meta.dirname, config.CONCH_CHECKOUT);
  if (!installDir) throw new Error('Conch couldn’t find its own folder to point the command at.');
  const result = await installShim({ installDir, conchHome: config.CONCH_HOME });
  ui.ok(`The conch command is ready${result.ready ? '. Try conch help. 🐚' : '.'}`);
  if (!result.ready)
    ui.hint(
      result.profile
        ? `It works in new terminals (Conch added its folder to ${result.profile}).`
        : 'It works in new terminals.',
    );
}

// ── Your things ──────────────────────────────────────────────────────────

async function importFrom() {
  const settings = new SettingsStore(config.CONCH_HOME, heal);
  const memory = new MemoryStore(join(config.CONCH_HOME, 'memory'));
  const skills = new SkillStore(config.CONCH_HOME);
  const usage = new SkillUsage(config.CONCH_HOME, heal);
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
        // Brought in by Conch: the tidy shelf may offer it back one day (ADR 0058).
        adopt: async (folder, base) => {
          const skill = await skills.adopt(folder, base);
          await usage.note(skill.id, 'imported').catch(() => undefined);
          return skill;
        },
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
    ui,
    conch,
    running: async () => Boolean(await runningGateway(config.CONCH_HOME)),
  });
}

async function skills() {
  process.exitCode = await skillsCommand(process.argv.slice(3), new SkillTrust(config.CONCH_HOME), {
    ui,
    conch,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    defaultName: userInfo().username,
  });
}

// ── Help ─────────────────────────────────────────────────────────────────

const GROUPS: readonly CliGroup[] = [
  'Getting started',
  'Signing in',
  'Devices',
  'Running Conch',
  'Your things',
];

const commandList: readonly CliCommand[] = CLI_COMMANDS;

/** The closest command to a typo, if one is close enough to be what was meant. */
function closest(word: string): string | undefined {
  const distance = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let previous = row[0] ?? 0;
      row[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const above = row[j] ?? 0;
        row[j] = Math.min(
          above + 1,
          (row[j - 1] ?? 0) + 1,
          previous + (a[i - 1] === b[j - 1] ? 0 : 1),
        );
        previous = above;
      }
    }
    return row[b.length] ?? Infinity;
  };
  const names = [...new Set(commandList.map((c) => c.name))];
  const best = names
    .map((name) => ({ name, d: distance(word.toLowerCase(), name) }))
    .sort((a, b) => a.d - b.d)[0];
  return best && best.d <= Math.max(1, Math.floor(best.name.length / 3)) ? best.name : undefined;
}

/** `conch help <command>`: what one command does, in full. */
function helpFor(name: string) {
  const rows = commandList.filter((c) => c.name === name);
  if (!rows.length) return false;
  for (const row of rows) {
    say(`${ui.accent(conch(row.usage))}`);
    say(row.summary);
    ui.blank();
    for (const line of wrap(row.detail, Math.min(76, ui.term.columns - 4))) ui.hint(line);
    if (row.subcommands?.length) {
      ui.blank();
      const width = Math.max(...row.subcommands.map((s) => s.usage.length)) + 2;
      for (const sub of row.subcommands)
        say(`  ${ui.accent(sub.usage.padEnd(width))}${dim(sub.summary)}`);
    }
    ui.blank();
  }
  return true;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

async function help() {
  const topic = process.argv[3];
  if (process.argv[2] === 'help' && topic && helpFor(topic)) return;
  await banner(ui, {
    line: 'Your assistant, on your own computer.',
    sub: `v${SERVER_VERSION} · ${conch('help <command>')} for the details`,
  });
  const width = Math.max(...commandList.map((c) => c.usage.length)) + 2;
  for (const group of GROUPS) {
    const rows = commandList.filter((c) => c.group === group);
    if (!rows.length) continue;
    say(bold(group));
    for (const { usage, summary } of rows) {
      const [name = '', ...rest] = usage.split(' ');
      const args = rest.join(' ');
      say(
        `  ${ui.accent(name)}${args ? ` ${dim(args)}` : ''}${' '.repeat(Math.max(1, width - usage.length))}${summary}`,
      );
    }
    ui.blank();
  }
  ui.hint(`New here? ${conch('setup')} walks you through it.`);
}

/** Typed by `cliCommands.ts`: a command needs its words there before it can exist here. */
const commands: Record<CliCommandName | 'help', () => Promise<void> | void> = {
  setup,
  hello,
  open,
  address,
  status,
  password,
  key,
  keys,
  revoke,
  pair,
  passkeys,
  devices,
  'sign-out-everywhere': signOutEverywhere,
  reset,
  command,
  background,
  quit,
  shortcut,
  tray,
  phone,
  import: importFrom,
  skills,
  help,
};

ui.blank();
try {
  const word = process.argv[2] ?? 'help';
  const handlers: Record<string, (() => Promise<void> | void) | undefined> = commands;
  const handler = handlers[word];
  if (handler) await handler();
  else if (word === '--help' || word === '-h') await help();
  else if (word === '--version' || word === '-v') say(`Conch ${SERVER_VERSION} 🐚`);
  else {
    const guess = closest(word);
    ui.error(`Hmm, “${word}” isn’t something Conch knows.`);
    ui.hint(guess ? `Did you mean ${ui.code(conch(guess))}?` : `See everything: ${conch('help')}`);
    process.exitCode = 1;
  }
} catch (error) {
  ui.error(error instanceof AccessError ? error.message : String(error));
  process.exitCode = 1;
} finally {
  prompts.close();
}
ui.blank();
