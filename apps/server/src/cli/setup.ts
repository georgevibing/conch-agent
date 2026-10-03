/**
 * `conch setup` (ADR 0064): the conversation the installer ends with on a
 * computer with no screen of its own, and the way to change it later.
 *
 *   How will you reach Conch?
 *     1  From anywhere, at an address of my own
 *     2  Only from my own devices, privately (Tailscale)
 *     3  Just from this computer for now
 *
 * For an address of your own it works out the record to add, waits for it,
 * gets Conch the right to answer on ports 80 and 443 (asking once for
 * `sudo`), opens the server's firewall, gets the certificate and ends with
 * the link that makes Conch yours. Everything it touches comes in as `deps`,
 * so every path is tested without a network, a sudo or a running Conch.
 */
import type { AccessMethod, AddressStatus, DnsReport } from '@conch/protocol';

import { normaliseName } from '../address/store';
import { banner, working } from './pearl';
import type { Option, Prompts } from './prompts';
import type { Ui } from './ui';
import { greeting, until } from './words';

export type Reach = 'address' | 'tailscale' | 'local';

export interface SetupDeps {
  ui: Ui;
  prompts: Prompts;
  /** `conch <args>` as the person types it here. */
  conch: (args: string) => string;
  version: string;
  /** This computer's name, for the banner. */
  hostname: string;
  /** The address the person reached this computer at over SSH, for the tunnel hint. */
  sshHost?: string;
  /** No screen of its own: a server, or someone here over SSH. */
  headless: boolean;
  /** Where Conch is on this computer, for the SSH tunnel hint. */
  port: number;
  user: string;

  gateway: {
    /** Conch is running and answering. */
    running(): Promise<boolean>;
    /** Start Conch in the background (Always on); true once it answers. */
    start(): Promise<boolean>;
    /** Start Conch again on this Node (after it got its port permission); true once it answers. */
    restartOn(node: string): Promise<boolean>;
    address: {
      status(): Promise<AddressStatus>;
      set(name: string): Promise<AddressStatus>;
    };
  };
  /** Where a name points, without needing Conch to run. */
  dns(name: string): Promise<DnsReport>;
  ports: {
    /** Conch may answer on ports 80 and 443 here (always, but on Linux). */
    allowed(): Promise<boolean>;
    /** Conch's own Node, fetched when it runs on someone else's. */
    privateNode(): Promise<string>;
    /** The one command that gives that Node the permission. */
    command(node: string): Promise<string>;
  };
  /** The firewall on this server, when it's on and may keep 80 and 443 shut. */
  firewall(): Promise<{ name: string; command: string } | undefined>;
  /** Run a command as the administrator, the person typing their password. */
  sudo(command: string): Promise<boolean>;
  tailscale: {
    /** `ready` with its address, or what's in the way in one sentence (and a link or command). */
    turnOn(): Promise<{ url?: string; problem?: string; next?: string }>;
  };
  access: {
    method(): Promise<AccessMethod>;
    hello(): Promise<{ code: string; expiresAt: number }>;
  };
  /** Open Conch in this computer's browser, as this computer. */
  open(): Promise<boolean>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/** How long to wait for a record to arrive before saying so. */
const DNS_PATIENCE_MS = 30 * 60 * 1000;
/** How long the reach check and the certificate may take. */
const CERT_PATIENCE_MS = 6 * 60 * 1000;

const OPTIONS = (headless: boolean): Option<Reach>[] => [
  {
    value: 'address',
    label: 'From anywhere, at an address of my own',
    hint: 'like conch.yourname.com',
  },
  { value: 'tailscale', label: 'Only from my own devices, privately', hint: 'Tailscale' },
  {
    value: 'local',
    label: 'Just from this computer for now',
    ...(headless && { hint: 'through an SSH tunnel' }),
  },
];

interface Args {
  reach?: Reach;
  domain?: string;
  yes: boolean;
}

function parse(args: string[]): Args {
  const out: Args = { yes: args.includes('--yes') || args.includes('-y') };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--domain') out.domain = args[++i];
    else if (arg.startsWith('--domain=')) out.domain = arg.slice('--domain='.length);
    else if (arg === '--tailscale') out.reach = 'tailscale';
    else if (arg === '--local') out.reach = 'local';
  }
  if (out.domain) out.reach = 'address';
  return out;
}

/** `conch setup [--domain NAME | --tailscale | --local] [--yes]`. Returns the exit code. */
export async function setup(argv: string[], deps: SetupDeps): Promise<number> {
  const { ui, prompts } = deps;
  const args = parse(argv);
  const asking = prompts.interactive && !args.yes;

  await banner(ui, {
    line: greeting(new Date(deps.now())),
    sub: `v${deps.version} · ${deps.hostname}`,
    shimmer: 900,
  });

  if (!(await deps.gateway.running())) {
    const started = await working(ui, 'Starting Conch', () => deps.gateway.start(), {
      done: (ok) => (ok ? 'Conch is running' : 'Conch didn’t start'),
    });
    if (!started) {
      ui.hint(`Start it by hand to see why: ${deps.conch('background on')}`);
      return 1;
    }
  }

  let reach = args.reach;
  if (!reach && asking) {
    ui.blank();
    reach = await prompts.choose(
      'How will you reach Conch?',
      OPTIONS(deps.headless),
      deps.headless ? 0 : 2,
    );
    ui.blank();
  }
  if (!reach) {
    ui.say('Conch is running. When you’re at a keyboard, choose how you’ll reach it:');
    ui.command(deps.conch('setup'));
    return 0;
  }

  if (reach === 'address') return (await ownAddress(deps, args, asking)) ? finale(deps) : 1;
  if (reach === 'tailscale') return (await tailscale(deps)) ? finale(deps) : 1;
  await local(deps);
  return finale(deps);
}

// ── An address of my own ─────────────────────────────────────────────────

async function ownAddress(deps: SetupDeps, args: Args, asking: boolean): Promise<boolean> {
  const { ui, prompts } = deps;
  let name: string | undefined;
  const check = (raw: string) => {
    try {
      normaliseName(raw);
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  };
  if (args.domain) {
    const problem = check(args.domain);
    if (problem) {
      ui.error(problem);
      return false;
    }
    name = normaliseName(args.domain);
  } else if (asking) {
    ui.hint('A domain you own, or a subdomain of it. Conch handles the secure connection.');
    const raw = await prompts.ask('Your address:', { validate: check });
    name = raw ? normaliseName(raw) : undefined;
  }
  if (!name) return false;
  ui.blank();

  // 1. The name points here.
  // A lookup that fails outright is said in words, never shown as an error from deep inside.
  const lookup = (name: string) =>
    deps.dns(name).catch((): DnsReport => ({
      name,
      mine: {},
      found: { v4: [], v6: [] },
      pointing: 'missing',
      message: `Conch couldn’t look ${name} up just now. It keeps trying.`,
      advice: [],
    }));
  let report = await working(ui, `Looking up ${name}`, () => lookup(name), {
    done: (r) => (r.pointing === 'here' ? `${name} points here` : `Looked up ${name}`),
  });
  const mine = report.mine.v4 ?? report.mine.v6;
  if (report.pointing === 'cloudflare') {
    ui.note(report.message);
  } else if (report.pointing !== 'here') {
    ui.say(report.message);
    ui.blank();
    ui.box(
      [
        ...(mine ? [ui.dim(`This server is at ${mine}.`)] : []),
        ...report.advice.map(
          (r) => `${ui.bold(r.type.padEnd(5))} ${ui.accent(r.host.padEnd(12))} ${r.value}`,
        ),
      ],
      { title: 'Add this record where you bought your domain', tone: 'accent' },
    );
    ui.hint('It’s under DNS, or DNS records, at most providers. Conch keeps looking by itself.');
    ui.blank();
    if (!asking) {
      ui.hint(`Once it’s there: ${deps.conch(`setup --domain ${name}`)}`);
      return false;
    }
    const started = deps.now();
    report = await working(
      ui,
      `Waiting for ${name} to point here`,
      async ({ update }) => {
        let tries = 1;
        for (;;) {
          await deps.sleep(5000);
          const now = await lookup(name);
          tries++;
          if (now.pointing === 'here' || now.pointing === 'cloudflare') return now;
          if (deps.now() - started > DNS_PATIENCE_MS) return now;
          update(`Waiting for ${name} to point here · looked ${tries} times`);
        }
      },
      {
        done: (r) =>
          r.pointing === 'here' || r.pointing === 'cloudflare'
            ? `${name} points here`
            : `${name} doesn’t point here yet`,
        chatterAfter: 8000,
      },
    );
    if (report.pointing !== 'here' && report.pointing !== 'cloudflare') {
      ui.hint(`Records can take a while. Run ${deps.conch('setup')} again once it’s there.`);
      return false;
    }
  }

  // 2. Conch may answer on ports 80 and 443.
  if (!(await deps.ports.allowed()) && !(await grantPorts(deps, name, asking))) return false;

  // 3. This server's firewall lets them in.
  const firewall = await deps.firewall();
  if (firewall) {
    ui.blank();
    ui.say(`${firewall.name} is on here. Ports 80 and 443 need to be open for Conch.`);
    ui.command(firewall.command);
    if (asking && (await prompts.confirm('Open them now?', true))) {
      if (await deps.sudo(firewall.command)) ui.ok('Ports 80 and 443 are open.');
      else ui.note('That didn’t work. Conch tries anyway, and says if they’re still shut.');
    }
  }

  // 4. The certificate, and Conch answering at https://<name>.
  ui.blank();
  ui.hint('Conch gets its certificate from Let’s Encrypt, free and renewed by itself.');
  ui.hint('Their terms: https://letsencrypt.org/repository/');
  let granted = false;
  for (;;) {
    const result = await connect(deps, name);
    if (result.state === 'ready') break;
    const problem = result.problem;
    // Conch runs on a Node that may not use the ports after all (another copy, say): fix that, once.
    if (problem?.kind === 'ports-privilege' && !granted) {
      granted = true;
      if (await grantPorts(deps, name, asking)) continue;
      return false;
    }
    ui.error(problem?.message ?? 'Conch couldn’t answer at that address yet.');
    if (problem?.command) ui.command(problem.command);
    const again =
      asking && problem?.kind !== 'rate-limited' && (await prompts.confirm('Try again?', true));
    if (!again) {
      ui.hint(`Run ${deps.conch('setup')} again whenever you’re ready. Nothing is lost.`);
      return false;
    }
  }
  ui.ok(`Conch answers at ${ui.bold(`https://${name}`)} 🔒`);

  // 5. Make it yours.
  return makeItYours(deps, `https://${name}`);
}

/**
 * Linux keeps ports below 1024 for root. Conch's own copy of Node gets the one
 * capability it needs (asking once for `sudo`), and Conch starts again on it.
 */
async function grantPorts(deps: SetupDeps, name: string, asking: boolean): Promise<boolean> {
  const { ui, prompts } = deps;
  ui.blank();
  ui.say('Conch runs as you, never as root, so it needs one permission to answer on');
  ui.say('the web’s ports (80 and 443). Only Conch’s own copy of Node gets it.');
  const node = await working(ui, 'Making sure Conch has its own Node', () =>
    deps.ports.privateNode(),
  );
  const command = await deps.ports.command(node);
  ui.command(command);
  if (!asking || !(await prompts.confirm('Run it now? It asks for your password once.', true))) {
    ui.hint(`Run it yourself, then ${deps.conch(`setup --domain ${name}`)} again.`);
    return false;
  }
  if (!(await deps.sudo(command))) {
    ui.error('That didn’t work, so Conch can’t answer on those ports yet.');
    ui.hint(`Run the command above yourself, then ${deps.conch('setup')} again.`);
    return false;
  }
  const back = await working(ui, 'Starting Conch again with its new permission', () =>
    deps.gateway.restartOn(node),
  );
  if (!back) ui.hint(`Start it by hand to see why: ${deps.conch('background on')}`);
  return back;
}

/** Set the address and follow it until it's ready or something's in the way. */
async function connect(deps: SetupDeps, name: string): Promise<AddressStatus> {
  const { ui } = deps;
  const label = (status: AddressStatus) =>
    status.state === 'getting-certificate'
      ? 'Getting your certificate from Let’s Encrypt'
      : 'Checking the way in from the internet';
  return working(
    ui,
    'Checking the way in from the internet',
    async ({ update }) => {
      let status = await deps.gateway.address.set(name);
      const started = deps.now();
      while (status.state === 'checking' || status.state === 'getting-certificate') {
        update(label(status));
        if (deps.now() - started > CERT_PATIENCE_MS) break;
        await deps.sleep(1000);
        status = await deps.gateway.address.status();
      }
      return status;
    },
    {
      done: (s) => (s.state === 'ready' ? 'Secure connection ready' : 'Not there yet'),
      chatterAfter: 6000,
    },
  );
}

// ── Only my own devices (Tailscale) ──────────────────────────────────────

async function tailscale(deps: SetupDeps): Promise<boolean> {
  const { ui } = deps;
  const result = await working(ui, 'Turning on your private address', () =>
    deps.tailscale.turnOn(),
  );
  if (!result.url) {
    ui.note(result.problem ?? 'Tailscale isn’t ready on this computer yet.');
    if (result.next) ui.hint(result.next);
    ui.hint(`When it is: ${deps.conch('setup --tailscale')}`);
    return false;
  }
  ui.ok(`Your devices reach Conch at ${ui.bold(result.url)}`);
  ui.hint('Only devices signed in to your Tailscale can. Nothing is open to the internet.');
  return makeItYours(deps, result.url);
}

// ── Just this computer ───────────────────────────────────────────────────

async function local(deps: SetupDeps): Promise<void> {
  const { ui } = deps;
  if (!deps.headless) {
    if (await deps.open()) ui.ok('Opened Conch in your browser. ✨');
    else ui.say(`Open it with ${ui.code(deps.conch('open'))}`);
    return;
  }
  ui.say('Conch stays on this computer. To open it from yours, connect with a tunnel:');
  ui.command(
    `ssh -N -L ${deps.port}:localhost:${deps.port} ${deps.user}@${deps.sshHost ?? deps.hostname}`,
  );
  ui.say(`Then, here, ask for a link to open on your end of it:`);
  ui.command(deps.conch('open --link'));
  ui.hint(`Want it reachable from anywhere later? ${deps.conch('setup')}`);
}

// ── The link that makes it yours ─────────────────────────────────────────

async function makeItYours(deps: SetupDeps, base: string): Promise<boolean> {
  const { ui } = deps;
  ui.blank();
  if ((await deps.access.method()) !== 'none') {
    ui.ok('This Conch is already yours: sign in there as usual.');
    ui.hint(`A phone to add? ${deps.conch('pair')} shows a code to scan.`);
    return true;
  }
  const { code, expiresAt } = await deps.access.hello();
  const url = `${base}/#hello=${code}`;
  ui.say(ui.bold('Last step: open this on your own computer or phone.'));
  ui.blank();
  if (ui.qr(url)) ui.blank();
  ui.box(
    [
      ui.link(url),
      ui.dim(`Works once, ${until(expiresAt, deps.now())}.`),
      ui.dim('Whoever opens it first owns this Conch, so keep it to yourself.'),
    ],
    { title: 'Make it yours', tone: 'accent' },
  );
  ui.hint('You’ll choose Touch ID, Windows Hello or a password there. That’s the whole thing.');
  ui.hint(`Need a fresh link later? ${deps.conch('hello')}`);
  return true;
}

function finale(deps: SetupDeps): number {
  const { ui } = deps;
  ui.blank();
  ui.ok(ui.bold('All set. ✨'));
  ui.hint(`${deps.conch('status')} checks on it, ${deps.conch('help')} shows the rest.`);
  return 0;
}
