/**
 * Publishing an app on GitHub (ADR 0061 §5), through GitHub's own program,
 * `gh`, so Conch never sees a GitHub password or keeps a token of its own.
 *
 * One press of **Publish on GitHub** walks `PublishState`: the program (a
 * need), GitHub's device sign-in (the code shown in Conch, then carrying on by
 * itself), and the repository: made, or updated when it's this app's own, a
 * `conch-app` topic, and a release `v<version>`.
 *
 * Safety:
 * - Conch only pushes to a repository by the app's name that's missing or
 *   empty, or that it published this app to before (remembered by GitHub's
 *   own repository id, which a rename, a transfer or a new repository by the
 *   same name doesn't carry). With nothing remembered, an existing repository
 *   must hold a `conch-app.json` with the same `id`, not be a fork, and be the
 *   very repository asked for (GitHub follows a renamed repository's old
 *   name). Anyone else's repository is left alone.
 * - Every program runs by its full path with an argument array, without a
 *   terminal: `GIT_TERMINAL_PROMPT=0`, `GH_PROMPT_DISABLED=1` (except the
 *   sign-in), no pager, no colour. Values that come from the manifest go in
 *   `--flag=value` form, so none can be read as a flag.
 * - git gets its GitHub credentials from `gh auth git-credential`, so no token
 *   is ever in an argument, an address or a log; whatever gh or git print is
 *   scrubbed before it's put in a message.
 * - Temporary folders are removed whatever happens.
 */
import { spawn } from 'node:child_process';
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  APP_LIMITS,
  AppId,
  isAppPicture,
  type ConchAppManifest,
  type ConchAppTool,
  type PublishState,
} from '@conch/protocol';
import { z } from 'zod';

import { agentEnv, launch, run, type RunResult } from '../lib/proc';
import { scrubSecrets } from '../search/past';
import { findGh, findGit } from '../setup/known';
import type { Publisher } from './types';

/** Where GitHub's device sign-in takes the code. */
export const DEVICE_URL = 'https://github.com/login/device';

// ── Running programs ────────────────────────────────────────────────────────

export interface RunOptions {
  env?: Record<string, string>;
  cwd?: string;
  timeout?: number;
}

/** A program left running: GitHub's sign-in, which waits for the person. */
export interface Running {
  /** Its output as it comes, stdout and stderr alike. */
  onOutput(listener: (text: string) => void): void;
  write(text: string): void;
  /** Its exit code; unset when it was killed or never started. */
  readonly exited: Promise<number | undefined>;
  kill(): void;
}

/** How the publisher runs gh and git; tests pretend to be both. */
export interface Exec {
  run(file: string, args: string[], options?: RunOptions): Promise<RunResult>;
  start(file: string, args: string[], options?: { env?: Record<string, string> }): Running;
}

export const realExec: Exec = {
  run: (file, args, options) => run(file, args, options),
  start(file, args, options) {
    const { command, prefix } = launch(file);
    const child = spawn(command, [...prefix, ...args], {
      env: options?.env ?? agentEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const listeners: ((text: string) => void)[] = [];
    const emit = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      for (const listener of listeners) listener(text);
    };
    child.stdout.on('data', emit);
    child.stderr.on('data', emit);
    child.stdin.on('error', () => undefined);
    const exited = new Promise<number | undefined>((resolve) => {
      child.once('error', () => resolve(undefined));
      child.once('close', (code) => resolve(code ?? undefined));
    });
    return {
      onOutput: (listener) => void listeners.push(listener),
      write: (text) => void child.stdin.write(text),
      exited,
      kill: () => void child.kill(),
    };
  },
};

// ── Words ───────────────────────────────────────────────────────────────────

const AGAIN = 'Press Publish on GitHub to try again.';

/** Something that went wrong, already in words for the person. */
class PublishError extends Error {}

const failed = (message: string): PublishState => ({
  state: 'failed',
  message: message.length <= 500 ? message : `${message.slice(0, 499)}…`,
});

const step = (words: string): PublishState => ({ state: 'publishing', step: words });

/** The one-time code in gh's sign-in output, in any of the ways gh has said it. */
export function readCode(output: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  return /one-time code\W{0,4}([A-Z0-9]{4}-[A-Z0-9]{4})\b/i.exec(plain)?.[1]?.toUpperCase();
}

/** What the person sees on GitHub and in the app's README: what it is and can do. */
export function readme(
  manifest: ConchAppManifest,
  tools: readonly ConchAppTool[] = [],
  /** Its picture (ADR 0090), shown above its name. */
  picture?: string,
): string {
  const line = (text: string) => text.replace(/\s+/g, ' ').trim();
  const out = [
    ...(picture ? [`<img src="${picture}" alt="" width="72" height="72">`, ''] : []),
    `# ${line(manifest.name)}`,
    '',
    line(manifest.tagline),
    '',
  ];
  if (manifest.description) out.push(manifest.description.trim(), '');
  out.push('## What it can do', '');
  if (manifest.reaches.length > 0)
    out.push(`- Reaches ${manifest.reaches.map((host) => `\`${host}\``).join(', ')}.`);
  else out.push('- Doesn’t reach any website.');
  if (manifest.tools) out.push('- Keeps its own notes on the computer it’s added to.');
  for (const tool of tools)
    out.push(
      `- **${line(tool.title)}**${tool.changes ? ' (changes things)' : ''}: ${line(tool.description)}`,
    );
  for (const page of manifest.pages) out.push(`- A page: ${line(page.title)}.`);
  if (manifest.settings.length > 0)
    out.push(
      `- Needs from you: ${manifest.settings.map((setting) => line(setting.label)).join(', ')}.`,
    );
  out.push('');
  if (manifest.examples.length > 0) {
    out.push('## Try saying', '');
    for (const example of manifest.examples) out.push(`- “${line(example)}”`);
    out.push('');
  }
  out.push(
    '## Add it',
    '',
    'This is an app for Conch. In Conch, open **Apps**, press **Add your own**, choose **From a link** and paste this page’s address.',
    '',
  );
  return out.join('\n');
}

const notes = (manifest: ConchAppManifest) =>
  `${manifest.tagline}\n\nIn Conch, open **Apps**, press **Add your own**, choose **From a link** and paste this repository’s address.`;

// ── The publisher ───────────────────────────────────────────────────────────

export interface PublisherDeps {
  exec?: Exec;
  /** Finds gh or git (`setup/known.ts`'s needs); tests point it at fakes. */
  find?: (program: 'gh' | 'git') => Promise<string | undefined>;
  /** Conch's home. Publishing keeps nothing there: its work happens in `tmp`. */
  home?: string;
  /** Where temporary copies go (the system's). */
  tmp?: string;
  /** Takes anything secret out of a program's output (the vault's redactor). */
  redact?: (text: string) => string;
  /** How long gh may take to show its code (30 s), and the person to enter it (15 min). */
  codeWaitMs?: number;
  signInMs?: number;
  /**
   * Which repository each app was published to, by GitHub's repository id.
   * The service keeps it across restarts; without it, only until Conch stops.
   */
  published?: PublishedRepos;
}

/** The repository an app was last published to, by GitHub's numeric repository id. */
export interface PublishedRepos {
  get(appId: string): Promise<{ repoId: number } | undefined>;
  set(appId: string, repoId: number): Promise<void>;
}

/** `PublishedRepos` that lasts until Conch stops. */
export function publishedInMemory(): PublishedRepos {
  const ids = new Map<string, number>();
  return {
    get: async (appId) => {
      const repoId = ids.get(appId);
      return repoId === undefined ? undefined : { repoId };
    },
    set: async (appId, repoId) => void ids.set(appId, repoId),
  };
}

export type GitHubPublisher = Publisher & {
  /** Resolves when the work for `appId` is over: published, failed, or needing a program (after a sign-in, once it's done). */
  settled(appId: string): Promise<PublishState>;
};

type App = Parameters<Publisher['publish']>[0];

type SignIn = { code: string; done: Promise<true | string> } | { failed: string };

const User = z.object({ login: z.string().regex(/^[A-Za-z0-9-]{1,39}$/), id: z.number().int() });
const Repo = z.object({
  id: z.number().int().positive(),
  full_name: z.string(),
  fork: z.boolean().optional(),
  archived: z.boolean().optional(),
});
const Contents = z.object({ content: z.string(), encoding: z.literal('base64') });

/** What a repository by the app's name is, as far as Conch may touch it. */
type Found =
  | { found: 'none' }
  | { found: 'empty' | 'ours'; repoId: number }
  | { found: 'theirs' }
  | { found: 'archived' }
  | { found: 'fork' }
  | { found: 'moved' };

export function createPublisher(deps: PublisherDeps = {}): GitHubPublisher {
  const exec = deps.exec ?? realExec;
  const find = deps.find ?? ((program: 'gh' | 'git') => (program === 'gh' ? findGh() : findGit()));
  const states = new Map<string, PublishState>();
  const jobs = new Map<string, Promise<void>>();
  const published = deps.published ?? publishedInMemory();
  /** One sign-in at a time, shared by every app waiting on it. */
  let signIn: Promise<SignIn> | undefined;

  const clean = (text: string) => {
    const scrubbed = scrubSecrets(deps.redact ? deps.redact(text) : text);
    const first = scrubbed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !/^(?:warning|hint):/i.test(l));
    return (first ?? '').replace(/^(?:gh|error|fatal|remote):\s*/i, '').slice(0, 160);
  };
  const said = (result: RunResult) => {
    const why = clean(`${result.stderr}\n${result.stdout}`);
    return why ? ` (GitHub said: ${why.replace(/\.$/, '')})` : '';
  };
  const signedOut = (result: RunResult) =>
    /HTTP 401|not logged in|authentication (?:failed|required)|gh auth login/i.test(
      `${result.stderr}\n${result.stdout}`,
    );

  /** gh and git's surroundings: never a prompt, a pager or colour. */
  const quiet = (extra: Record<string, string> = {}) =>
    agentEnv({
      GH_PROMPT_DISABLED: '1',
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GH_PAGER: '',
      GIT_PAGER: '',
      PAGER: '',
      NO_COLOR: '1',
      CLICOLOR: '0',
      GH_NO_UPDATE_NOTIFIER: '1',
      GH_SPINNER_DISABLED: '1',
      ...extra,
    });

  const gh = (path: string, args: string[], options: RunOptions = {}) =>
    exec.run(path, args, { env: quiet(), timeout: 120_000, ...options });

  async function isSignedIn(ghPath: string): Promise<boolean> {
    const status = await gh(ghPath, ['auth', 'status', '--hostname', 'github.com'], {
      timeout: 30_000,
    });
    return status.code === 0;
  }

  /** Starts GitHub's device sign-in (or joins the one already going), and waits for its code. */
  function startSignIn(ghPath: string, gitPath: string): Promise<SignIn> {
    signIn ??= beginSignIn(ghPath, gitPath).then((started) => {
      if ('failed' in started) signIn = undefined;
      else void started.done.finally(() => (signIn = undefined));
      return started;
    });
    return signIn;
  }

  async function beginSignIn(ghPath: string, gitPath: string): Promise<SignIn> {
    const env = quiet();
    // The sign-in reads nothing from a person here; the code is shown in Conch.
    delete env.GH_PROMPT_DISABLED;
    // gh never opens a browser without a terminal; if one ever tries, it
    // runs `git --version`, which does nothing. Conch shows the link itself.
    if (!gitPath.includes("'")) env.GH_BROWSER = `'${gitPath.replaceAll('\\', '/')}' --version`;
    const child = exec.start(
      ghPath,
      [
        'auth',
        'login',
        '--hostname',
        'github.com',
        '--git-protocol',
        'https',
        '--web',
        '--skip-ssh-key',
      ],
      { env },
    );
    let output = '';
    let pressed = false;
    const code = new Promise<string | undefined>((resolve) => {
      const timer = setTimeout(() => resolve(undefined), deps.codeWaitMs ?? 30_000);
      child.onOutput((text) => {
        output = `${output}${text}`.slice(-8_000);
        // An older gh waits for Enter before going on; GH_BROWSER keeps it from opening one.
        if (!pressed && /press enter/i.test(output)) {
          pressed = true;
          child.write('\n');
        }
        const found = readCode(output);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        }
      });
      void child.exited.then(() => {
        clearTimeout(timer);
        resolve(readCode(output));
      });
    });
    const shown = await code;
    if (!shown) {
      child.kill();
      const why = clean(output);
      return {
        failed: `GitHub’s sign-in didn’t start${why ? ` (${why.replace(/\.$/, '')})` : ''}. Check your internet connection, then press Publish on GitHub again.`,
      };
    }
    const done = new Promise<true | string>((resolve) => {
      const timer = setTimeout(
        () => {
          child.kill();
          resolve(
            'The GitHub code ran out before it was entered. Press Publish on GitHub for a new one.',
          );
        },
        deps.signInMs ?? 15 * 60_000,
      );
      void child.exited.then((exit) => {
        clearTimeout(timer);
        resolve(
          exit === 0
            ? true
            : 'Signing in to GitHub didn’t finish. Press Publish on GitHub for a new code.',
        );
      });
    });
    return { code: shown, done };
  }

  /** Whether a repository by the app's name is there, and whether it's this app's to update. */
  async function inspect(ghPath: string, repo: string, id: string): Promise<Found> {
    const lookFailed = (result: RunResult) =>
      signedOut(result)
        ? new PublishError(signedOutWords)
        : new PublishError(`Conch couldn’t look at your GitHub account${said(result)}. ${AGAIN}`);
    const meta = await gh(ghPath, ['api', `repos/${repo}`]);
    if (meta.code !== 0) {
      if (/HTTP 404|Not Found/i.test(meta.stderr)) return { found: 'none' };
      throw lookFailed(meta);
    }
    const info = Repo.safeParse(parseJson(meta.stdout));
    if (!info.success) throw lookFailed(meta);
    // GitHub answers a renamed or transferred repository's old name with the new one.
    if (info.data.full_name.toLowerCase() !== repo.toLowerCase()) return { found: 'moved' };
    if (info.data.archived) return { found: 'archived' };
    if (info.data.fork) return { found: 'fork' };
    const repoId = info.data.id;
    // An empty repository is Conch's to fill.
    const commits = await gh(ghPath, ['api', `repos/${repo}/commits?per_page=1`]);
    if (commits.code !== 0) {
      if (/HTTP 409|is empty/i.test(commits.stderr)) return { found: 'empty', repoId };
      throw lookFailed(commits);
    }
    const list = parseJson(commits.stdout);
    if (Array.isArray(list) && list.length === 0) return { found: 'empty', repoId };
    // Published here before: only that very repository, whatever it holds now.
    const before = await published.get(id);
    if (before) return before.repoId === repoId ? { found: 'ours', repoId } : { found: 'theirs' };
    // Never published from here: it must already be this app.
    const manifest = await gh(ghPath, ['api', `repos/${repo}/contents/conch-app.json`]);
    if (manifest.code === 0) {
      const file = Contents.safeParse(parseJson(manifest.stdout));
      const read = file.success
        ? parseJson(Buffer.from(file.data.content, 'base64').toString('utf8'))
        : undefined;
      return (read as { id?: unknown } | undefined)?.id === id
        ? { found: 'ours', repoId }
        : { found: 'theirs' };
    }
    if (/HTTP 404|Not Found/i.test(manifest.stderr)) return { found: 'theirs' };
    throw lookFailed(manifest);
  }

  /** The id of the repository Conch just made, checking it's the one asked for. */
  async function madeId(ghPath: string, repo: string): Promise<number> {
    const meta = await gh(ghPath, ['api', `repos/${repo}`]);
    const info = meta.code === 0 ? Repo.safeParse(parseJson(meta.stdout)) : undefined;
    if (!info?.success || info.data.full_name.toLowerCase() !== repo.toLowerCase())
      throw new PublishError(
        `Conch made ${repo} on GitHub but couldn’t find it again${said(meta)}. ${AGAIN}`,
      );
    return info.data.id;
  }

  /** The app's files, without links or hidden files, under the package limits. */
  async function filesOf(root: string): Promise<string[]> {
    const out: string[] = [];
    let bytes = 0;
    async function walk(dir: string, prefix: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const path = join(dir, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path, name);
        else if (entry.isFile()) {
          bytes += (await lstat(path)).size;
          out.push(name);
        }
        if (out.length > APP_LIMITS.files || bytes > APP_LIMITS.bytes)
          throw new PublishError(
            'The app is bigger than an app can be, so Conch didn’t publish it. Make it smaller, then press Publish on GitHub again.',
          );
      }
    }
    await walk(root, '');
    return out;
  }

  async function fill(app: App, into: string) {
    const files = await filesOf(app.dir).catch((error: unknown) => {
      if (error instanceof PublishError) throw error;
      throw new PublishError(
        `Conch couldn’t read ${app.manifest.name}’s files. Open Settings → Health and press Repair, then press Publish on GitHub again.`,
      );
    });
    for (const file of files) {
      const to = join(into, ...file.split('/'));
      await mkdir(dirname(to), { recursive: true });
      await copyFile(join(app.dir, ...file.split('/')), to);
    }
    if (!files.some((file) => file.toLowerCase() === 'readme.md'))
      await writeFile(
        join(into, 'README.md'),
        readme(
          app.manifest,
          app.tools,
          files.find((file) => isAppPicture(file)),
        ),
      );
  }

  /** Empties a clone, keeping only its `.git`. */
  async function empty(dir: string) {
    for (const entry of await readdir(dir))
      if (entry !== '.git') await rm(join(dir, entry), { recursive: true, force: true });
  }

  async function upload(app: App, ghPath: string, gitPath: string, set: (s: PublishState) => void) {
    const { manifest } = app;
    set(step('Checking your GitHub account'));
    const me = await gh(ghPath, ['api', 'user']);
    const user = me.code === 0 ? User.safeParse(parseJson(me.stdout)) : undefined;
    if (!user?.success) {
      if (signedOut(me)) throw new PublishError(signedOutWords);
      throw new PublishError(`Conch couldn’t read your GitHub account${said(me)}. ${AGAIN}`);
    }
    const { login, id: userId } = user.data;
    const repo = `${login}/${app.id}`;
    const address = `https://github.com/${repo}`;
    const looked = await inspect(ghPath, repo, app.id);
    if (looked.found === 'theirs')
      throw new PublishError(
        `There’s already a repository called ${app.id} on your GitHub that isn’t this app, so Conch left it alone. Give the app another name, then press Publish on GitHub again.`,
      );
    if (looked.found === 'fork')
      throw new PublishError(
        `Your repository ${repo} is a copy of someone else’s, so Conch left it alone. Give the app another name, then press Publish on GitHub again.`,
      );
    if (looked.found === 'moved')
      throw new PublishError(
        `GitHub sends ${repo} on to a repository with another name, so Conch left it alone. Give the app another name, then press Publish on GitHub again.`,
      );
    if (looked.found === 'archived')
      throw new PublishError(
        `Your repository ${repo} is archived, so Conch can’t update it. Unarchive it in its settings on GitHub, then press Publish on GitHub again.`,
      );

    // Commits in the person's name, with GitHub's private address: never asked for.
    const who = { name: login, email: `${userId}+${login}@users.noreply.github.com` };
    const gitEnv = quiet({
      GIT_AUTHOR_NAME: who.name,
      GIT_AUTHOR_EMAIL: who.email,
      GIT_COMMITTER_NAME: who.name,
      GIT_COMMITTER_EMAIL: who.email,
    });
    const git = (args: string[], cwd: string, timeout = 120_000) =>
      exec.run(
        gitPath,
        [
          // Bytes as they are (the signature covers them), nothing that would wait on a person.
          '-c',
          'core.autocrlf=false',
          '-c',
          'core.safecrlf=false',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'credential.helper=',
          '-c',
          `credential.helper=!'${ghPath.replaceAll("'", `'\\''`)}' auth git-credential`,
          ...args,
        ],
        { env: gitEnv, cwd, timeout },
      );
    const must = async (result: Promise<RunResult>, words: string) => {
      const done = await result;
      if (done.code === 0) return done;
      if (signedOut(done)) throw new PublishError(signedOutWords);
      throw new PublishError(`${words}${said(done)}. ${AGAIN}`);
    };

    const tmp = await mkdtemp(join(deps.tmp ?? tmpdir(), 'conch-publish-'));
    try {
      const work = join(tmp, 'repo');
      if (looked.found === 'none') {
        set(step('Making the repository'));
        await must(
          gh(ghPath, ['repo', 'create', repo, '--public', `--description=${manifest.tagline}`]),
          `Conch couldn’t make the repository ${repo} on GitHub`,
        );
      }
      // Remembered before uploading, so a failed upload can be finished later.
      const repoId = looked.found === 'none' ? await madeId(ghPath, repo) : looked.repoId;
      await published.set(app.id, repoId);
      set(step('Uploading'));
      const pushTo = `${address}.git`;
      let branch = 'HEAD';
      if (looked.found === 'ours') {
        await must(
          gh(ghPath, ['repo', 'clone', pushTo, work, '--', '--depth', '1'], { cwd: tmp }),
          `Conch couldn’t get ${repo} from GitHub`,
        );
        await empty(work);
      } else {
        await mkdir(work);
        await must(
          git(['init', '--quiet', '-b', 'main'], work),
          'Conch couldn’t prepare the upload',
        );
        branch = 'HEAD:refs/heads/main';
      }
      await fill(app, work);
      await must(git(['add', '--all'], work), 'Conch couldn’t prepare the upload');
      const status = await must(
        git(['status', '--porcelain'], work),
        'Conch couldn’t prepare the upload',
      );
      if (status.stdout.trim()) {
        await must(
          git(['commit', '--quiet', '-m', `Version ${manifest.version}`], work),
          'Conch couldn’t prepare the upload',
        );
        const pushed = await git(['push', '--quiet', pushTo, branch], work, 300_000);
        if (pushed.code !== 0) {
          if (signedOut(pushed)) throw new PublishError(signedOutWords);
          throw new PublishError(
            /rejected|fetch first|non-fast-forward/i.test(pushed.stderr)
              ? `${repo} changed on GitHub while Conch was uploading. ${AGAIN}`
              : `Conch couldn’t upload ${manifest.name} to GitHub${said(pushed)}. ${AGAIN}`,
          );
        }
      }

      set(step('Marking it as a Conch app'));
      await must(
        gh(ghPath, ['repo', 'edit', repo, '--add-topic', 'conch-app']),
        `Conch couldn’t add the conch-app topic to ${repo}`,
      );

      set(step('Making the release'));
      const tag = `v${manifest.version}`;
      const existing = await gh(ghPath, [
        'release',
        'view',
        tag,
        '--repo',
        repo,
        '--json',
        'tagName',
      ]);
      if (existing.code !== 0) {
        const release = await gh(ghPath, [
          'release',
          'create',
          tag,
          '--repo',
          repo,
          `--title=${manifest.name} ${manifest.version}`,
          `--notes=${notes(manifest)}`,
        ]);
        // Published before at this version: the release is already there.
        if (release.code !== 0 && !/already exists/i.test(`${release.stderr}\n${release.stdout}`)) {
          if (signedOut(release)) throw new PublishError(signedOutWords);
          throw new PublishError(
            `Conch couldn’t make the release ${tag}${said(release)}. ${AGAIN}`,
          );
        }
      }
      set({ state: 'published', url: address, version: manifest.version });
    } finally {
      await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async function work(app: App, set: (s: PublishState, show?: boolean) => void) {
    // The id names the repository: only one that reads as an app's id, and is this app's.
    if (!AppId.safeParse(app.id).success || app.manifest.id !== app.id)
      return set(
        failed(
          'Conch couldn’t tell which app to publish. Open the app’s page in Apps and press Publish on GitHub there.',
        ),
      );
    const ghPath = await find('gh');
    if (!ghPath) return set({ state: 'needs-program', need: 'gh' });
    const gitPath = await find('git');
    if (!gitPath) return set({ state: 'needs-program', need: 'git' });
    if (!(await isSignedIn(ghPath))) {
      const started = await startSignIn(ghPath, gitPath);
      if ('failed' in started) return set(failed(started.failed));
      set({ state: 'needs-sign-in', code: started.code, url: DEVICE_URL });
      const done = await started.done;
      if (done !== true) return set(failed(done));
      if (!(await isSignedIn(ghPath))) return set(failed(signedOutWords));
    }
    await upload(app, ghPath, gitPath, set);
  }

  return {
    state: (appId) => states.get(appId) ?? { state: 'idle' },

    publish(app) {
      const running = jobs.get(app.id);
      if (running) return Promise.resolve(states.get(app.id) ?? { state: 'idle' });
      let show: (state: PublishState) => void = () => undefined;
      const first = new Promise<PublishState>((resolve) => (show = resolve));
      const set = (state: PublishState, visible = true) => {
        states.set(app.id, state);
        if (visible) show(state);
      };
      set(step('Getting ready'), false);
      const job = work(app, set)
        .catch((error: unknown) => {
          set(
            failed(
              error instanceof PublishError
                ? error.message
                : `Conch couldn’t publish ${app.manifest.name}: ${clean(error instanceof Error ? error.message : String(error)) || 'something went wrong'}. ${AGAIN}`,
            ),
          );
        })
        .finally(() => {
          jobs.delete(app.id);
          show(states.get(app.id) ?? { state: 'idle' });
        });
      jobs.set(app.id, job);
      return first;
    },

    async settled(appId) {
      await jobs.get(appId);
      return states.get(appId) ?? { state: 'idle' };
    },
  };
}

const signedOutWords =
  'GitHub says Conch isn’t signed in any more. Press Publish on GitHub to sign in again.';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
