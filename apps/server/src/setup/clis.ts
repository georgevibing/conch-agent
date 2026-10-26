/**
 * The programs on this computer that already reach a service, and as whom
 * (ADR 0016). A model that knows `gh` is signed in as one account, and
 * `wrangler` as another, picks the right way first: the program, before the
 * browser and a sign-in page; another account's key from Passwords when the
 * signed-in one can't see something, before asking the person to sign in.
 *
 * Each program is asked the cheapest question that names its account
 * (`gh auth status`, `wrangler whoami`), with a deadline, nothing on stdin and
 * no prompts. Only account names come back: what a program prints is never
 * kept, and a name that looks like a key is dropped (`cleanAccount`). Token
 * files are never opened. The answers are kept for a while, and a turn never
 * waits long for them: it gets what's known and the rest is filled in later.
 */
import { findCloudProgram } from '../clouds/exec';
import { agentEnv, findExecutable, run, type RunResult } from '../lib/proc';
import { findGh, findGit } from './known';

/** What one program says about itself. */
export interface CliState {
  /** The program's name, as it's typed. */
  name: string;
  /** Who it acts as; empty when it's signed out or doesn't say. */
  accounts: string[];
  /** The account it uses now, when it has several. */
  active?: string;
  /** `out` when it says it isn't signed in; `unknown` when it wasn't asked or didn't answer. */
  signedIn: 'yes' | 'out' | 'unknown';
  /** What it's for, in a few words. */
  about: string;
}

export interface Probe {
  name: string;
  about: string;
  find: () => Promise<string | undefined>;
  /** The question that names its account; absent when there's no cheap, safe one. */
  ask?: readonly string[];
  read?: (out: RunResult) => Pick<CliState, 'accounts' | 'active' | 'signedIn'>;
}

/** An account name, a profile, a context: never anything longer or key-shaped. */
const ACCOUNT = /^[\w.@+:/-]{1,80}$/;
const KEYISH =
  /^(?:gh[opsu]_|github_pat_|sk[-_]|xox[abp]-|AKIA|ASIA|ya29\.|eyJ)|[A-Za-z0-9+/=_-]{40,}/;

export function cleanAccount(raw: string | undefined): string | undefined {
  const name = raw?.trim().replace(/^["'`]|["'`.]$/g, '');
  return name && ACCOUNT.test(name) && !KEYISH.test(name) ? name : undefined;
}

const both = (out: RunResult) => `${out.stdout}\n${out.stderr}`;
const unique = (names: (string | undefined)[]) => [
  ...new Set(names.filter((n): n is string => !!n)),
];

/** `gh auth status`: every account on github.com, and which one is in use. */
export function readGhStatus(out: RunResult): Pick<CliState, 'accounts' | 'active' | 'signedIn'> {
  const accounts: string[] = [];
  let active: string | undefined;
  let last: string | undefined;
  for (const line of both(out).split(/\r?\n/)) {
    // "✓ Logged in to github.com account NAME (keyring)", or older "… as NAME (oauth_token)".
    const m = /Logged in to (\S+) (?:account|as) (\S+)/.exec(line);
    if (m) {
      last = m[1] === 'github.com' ? cleanAccount(m[2]) : undefined;
      if (last) accounts.push(last);
      continue;
    }
    if (last && /Active account:\s*true/i.test(line)) active = last;
  }
  const names = unique(accounts);
  if (!names.length)
    return {
      accounts: [],
      signedIn: /not logged in|no accounts/i.test(both(out)) ? 'out' : 'unknown',
    };
  return { accounts: names, active: active ?? names[0], signedIn: 'yes' };
}

/** The first email in what a program printed (`wrangler whoami`, `fly auth whoami`). */
function email(out: RunResult, signedOut: RegExp): Pick<CliState, 'accounts' | 'signedIn'> {
  const text = both(out);
  if (signedOut.test(text)) return { accounts: [], signedIn: 'out' };
  const found = cleanAccount(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(text)?.[0]);
  return found ? { accounts: [found], signedIn: 'yes' } : { accounts: [], signedIn: 'unknown' };
}

/** A program that prints just the name on success (`vercel whoami`, `az … -o tsv`). */
function lastLine(out: RunResult, signedOut: RegExp): Pick<CliState, 'accounts' | 'signedIn'> {
  if (out.code !== 0 || signedOut.test(both(out)))
    return { accounts: [], signedIn: out.code === undefined ? 'unknown' : 'out' };
  const lines = out.stdout.split(/\r?\n/).map((l) => l.replace(/^>\s*/, '').trim());
  const found = cleanAccount(lines.filter(Boolean).at(-1));
  return found ? { accounts: [found], signedIn: 'yes' } : { accounts: [], signedIn: 'unknown' };
}

const PROBES: Probe[] = [
  {
    name: 'gh',
    about: 'GitHub: repositories, issues, pull requests, Actions, `gh api`',
    find: () => findGh(),
    ask: ['auth', 'status'],
    read: readGhStatus,
  },
  { name: 'git', about: 'clone, pull, push', find: () => findGit() },
  {
    name: 'wrangler',
    about: 'Cloudflare: Workers, Pages, KV, R2, D1',
    find: () => findExecutable('wrangler'),
    ask: ['whoami'],
    read: (out) => email(out, /not authenticated|wrangler login/i),
  },
  {
    name: 'supabase',
    about: 'Supabase: projects, database, functions',
    find: () => findExecutable('supabase'),
  },
  {
    name: 'vercel',
    about: 'Vercel: deployments, projects, logs',
    find: () => findExecutable('vercel'),
    ask: ['whoami'],
    read: (out) => lastLine(out, /no existing credentials|vercel login|not logged in/i),
  },
  {
    name: 'fly',
    about: 'Fly.io: apps, machines, logs',
    find: async () => (await findExecutable('flyctl')) ?? findExecutable('fly'),
    ask: ['auth', 'whoami'],
    read: (out) => email(out, /no access token|not logged in|fly auth login/i),
  },
  {
    name: 'heroku',
    about: 'Heroku: apps, logs, config',
    find: () => findExecutable('heroku'),
    ask: ['auth:whoami'],
    read: (out) => email(out, /not logged in|heroku login/i),
  },
  { name: 'netlify', about: 'Netlify: sites, deploys', find: () => findExecutable('netlify') },
  {
    name: 'aws',
    about: 'AWS',
    find: () => findCloudProgram('aws'),
    // Profile names only, read from its own settings: no network, no keys.
    ask: ['configure', 'list-profiles'],
    read: (out) => {
      const names = unique(out.stdout.split(/\r?\n/).map(cleanAccount)).slice(0, 8);
      return names.length
        ? { accounts: names, signedIn: 'yes' }
        : { accounts: [], signedIn: 'unknown' };
    },
  },
  {
    name: 'gcloud',
    about: 'Google Cloud',
    find: () => findCloudProgram('gcloud'),
    ask: ['config', 'get-value', 'account'],
    read: (out) => lastLine(out, /\(unset\)/),
  },
  {
    name: 'az',
    about: 'Azure',
    find: () => findCloudProgram('az'),
    ask: ['account', 'show', '--query', 'user.name', '-o', 'tsv'],
    read: (out) => lastLine(out, /az login/i),
  },
  {
    name: 'kubectl',
    about: 'Kubernetes',
    find: () => findExecutable('kubectl'),
    ask: ['config', 'current-context'],
    read: (out) => lastLine(out, /current-context is not set/i),
  },
  { name: 'docker', about: 'containers', find: () => findExecutable('docker') },
  { name: 'terraform', about: 'infrastructure as code', find: () => findExecutable('terraform') },
  { name: 'stripe', about: 'Stripe', find: () => findExecutable('stripe') },
];

export interface CliDeps {
  probes?: Probe[];
  run?: typeof run;
  now?: () => number;
  /** How long a turn waits for the first answers before it carries on without them. */
  waitMs?: number;
}

/** How long the answers are kept: a sign-in changes rarely, and asking costs a few programs. */
const KEEP_MS = 10 * 60_000;
/** Each program's deadline: some ask their service over the network. */
const ASK_MS = 8_000;

export class Clis {
  #probes: Probe[];
  #run: typeof run;
  #now: () => number;
  #waitMs: number;
  #known: CliState[] = [];
  #at = -Infinity;
  #looking: Promise<CliState[]> | undefined;

  constructor(deps: CliDeps = {}) {
    this.#probes = deps.probes ?? PROBES;
    this.#run = deps.run ?? run;
    this.#now = deps.now ?? Date.now;
    this.#waitMs = deps.waitMs ?? 1_500;
  }

  /** What's known now, looking again when it's old; never waits long. */
  async states(): Promise<CliState[]> {
    if (this.#now() - this.#at > KEEP_MS && !this.#looking) {
      this.#looking = this.#look().finally(() => (this.#looking = undefined));
    }
    if (this.#looking && this.#at === -Infinity) {
      const first = await Promise.race([
        this.#looking,
        new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), this.#waitMs).unref?.();
        }),
      ]);
      return first ?? this.#known;
    }
    return this.#known;
  }

  /** Forget what's known (after a sign-in Conch helped with). */
  stale(): void {
    this.#at = -Infinity;
  }

  async #look(): Promise<CliState[]> {
    const found = await Promise.all(
      this.#probes.map(async (probe): Promise<CliState | undefined> => {
        const path = await probe.find().catch(() => undefined);
        if (!path) return undefined;
        const base = { name: probe.name, about: probe.about };
        if (!probe.ask || !probe.read) return { ...base, accounts: [], signedIn: 'unknown' };
        const out = await this.#run(path, [...probe.ask], {
          timeout: ASK_MS,
          input: '',
          maxBuffer: 256 * 1024,
          env: agentEnv({
            CI: '1',
            NO_COLOR: '1',
            GH_PROMPT_DISABLED: '1',
            GH_NO_UPDATE_NOTIFIER: '1',
            WRANGLER_SEND_METRICS: 'false',
            CLOUDSDK_CORE_DISABLE_PROMPTS: '1',
            AZURE_CORE_NO_COLOR: '1',
          }),
        }).catch((): RunResult => ({ stdout: '', stderr: '' }));
        return { ...base, ...probe.read(out) };
      }),
    );
    this.#known = found.filter((s): s is CliState => !!s);
    this.#at = this.#now();
    return this.#known;
  }

  /** The prompt's lines: what's here and as whom, and how to reach what that account can't. */
  async promptSection(): Promise<string> {
    const states = await this.states().catch(() => []);
    return clisPrompt(states);
  }
}

function whoOf(state: CliState): string {
  const main = state.active ?? state.accounts[0];
  if (state.signedIn === 'out') return 'not signed in';
  if (state.signedIn !== 'yes' || !main) return 'installed';
  if (state.name === 'aws') return `profiles: ${state.accounts.join(', ')}`;
  if (state.name === 'kubectl') return `context ${main}`;
  const others = state.accounts.filter((a) => a !== main);
  return `signed in as ${main}${others.length ? ` (also: ${others.join(', ')})` : ''}`;
}

const lineOf = (state: CliState) => `- \`${state.name}\` (${state.about}) — ${whoOf(state)}`;

export function clisPrompt(states: CliState[]): string {
  if (!states.length) return '';
  return [
    '## Programs on this computer',
    'These command-line programs are installed here, signed in as shown. When one covers the job, use it: it acts as the person’s own account, and it’s usually quicker and surer than the browser.',
    ...states.map(lineOf),
    'When the signed-in account can’t see something (a 404 or 403 on another account’s private repository, project or zone), don’t ask the person to sign in again: find a key for the right account in Passwords (`passwords_find`), and give it to the command through the `secrets` option (process_start has it) (an environment variable such as `GH_TOKEN`), never typed into the command itself. Name the account you used.',
  ].join('\n');
}
