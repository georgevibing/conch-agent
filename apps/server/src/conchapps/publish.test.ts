import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConchAppManifest } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RunResult } from '../lib/proc';
import {
  createPublisher,
  DEVICE_URL,
  realExec,
  type Exec,
  publishedInMemory,
  readCode,
  readme,
  type Running,
} from './publish';

const GH = '/bin/gh';
const GIT = '/bin/git';
const TOKEN = 'gho_' + '16C7e42F292c6912E7710c838347Ae178B4a';

/** gh 2.102's own words without a terminal (October 2026). */
const GH_NOW =
  '\n! One-time code (0865-992D) copied to clipboard\nOpen this URL to continue in your web browser: https://github.com/login/device\n';
/** Older gh, which waits for Enter. */
const GH_BEFORE =
  '\u001b[0;33m!\u001b[0m First copy your one-time code: \u001b[1mABCD-1234\u001b[0m\n\u001b[1mPress Enter\u001b[0m to open github.com in your browser... ';

const manifest = ConchAppManifest.parse({
  conch: 1,
  id: 'plant-diary',
  name: 'Plant diary',
  tagline: 'Keeps track of when you water your plants',
  description: 'Logs each watering and tells you which plant is thirsty.',
  version: '1.1.0',
  icon: { glyph: 'leaf', color: 'green' },
  tools: 'tools.mjs',
  pages: [{ id: 'main', title: 'Plants', file: 'pages/main.html' }],
  reaches: ['api.open-meteo.com'],
  examples: ['I watered the fern'],
});

const ok = (stdout = ''): RunResult => ({ stdout, stderr: '', code: 0 });
const no = (stderr: string): RunResult => ({ stdout: '', stderr, code: 1 });

interface Call {
  file: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

/** Everything under `dir` but `.git`, as `/` paths. */
async function tree(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await tree(join(dir, entry.name), name)));
    else out.push(name);
  }
  return out.sort();
}

interface World {
  signedIn: boolean;
  /** The repository by the app's name on Ada's GitHub. */
  repo:
    | 'none'
    | 'empty'
    | {
        manifestId?: string;
        archived?: boolean;
        fork?: boolean;
        /** What GitHub calls it: another name when the old one was renamed or moved. */
        fullName?: string;
        /** GitHub's repository id (7001 unless said). */
        id?: number;
      };
  release: 'none' | 'exists' | 'raced';
  push: RunResult;
  status: string;
  /** What gh prints when it starts signing in; `undefined`: nothing. */
  loginSays?: string;
  /** Answers that override the pretend GitHub, by the command's words. */
  answers: Record<string, RunResult>;
}

/** A pretend gh and git, written from what they print (gh 2.102, git 2.51). */
function programs(world: Partial<World> = {}) {
  const w: World = {
    signedIn: true,
    repo: 'none',
    release: 'none',
    push: ok(),
    status: ' M conch-app.json',
    loginSays: GH_NOW,
    answers: {},
    ...world,
  };
  const calls: Call[] = [];
  let pushed: string[] | undefined;
  let readmeText: string | undefined;
  const login: {
    started: number;
    killed: boolean;
    written: string;
    env: Record<string, string>;
    args: string[];
    exit: (code: number | undefined) => void;
  } = { started: 0, killed: false, written: '', env: {}, args: [], exit: () => undefined };

  const gh = async (args: string[], cwd?: string): Promise<RunResult> => {
    const words = args.join(' ');
    const answer = w.answers[words];
    if (answer) return answer;
    if (words === 'auth status --hostname github.com')
      return w.signedIn
        ? ok('github.com\n  ✓ Logged in to github.com account ada (keyring)')
        : no('You are not logged into any GitHub hosts. To log in, run: gh auth login');
    if (words === 'api user') return ok(JSON.stringify({ login: 'ada', id: 42, name: 'Ada' }));
    if (words === 'api repos/ada/plant-diary')
      return w.repo === 'none'
        ? no('gh: Not Found (HTTP 404)')
        : ok(
            JSON.stringify(
              typeof w.repo === 'object'
                ? {
                    id: w.repo.id ?? 7001,
                    full_name: w.repo.fullName ?? 'ada/plant-diary',
                    fork: !!w.repo.fork,
                    archived: !!w.repo.archived,
                  }
                : { id: 7001, full_name: 'ada/plant-diary', fork: false, archived: false },
            ),
          );
    if (words === 'api repos/ada/plant-diary/contents/conch-app.json') {
      const id = typeof w.repo === 'object' ? w.repo.manifestId : undefined;
      return id
        ? ok(
            JSON.stringify({
              content: Buffer.from(JSON.stringify({ conch: 1, id })).toString('base64'),
              encoding: 'base64',
            }),
          )
        : no('gh: Not Found (HTTP 404)');
    }
    if (words === 'api repos/ada/plant-diary/commits?per_page=1')
      return w.repo === 'empty'
        ? no('gh: Git Repository is empty. (HTTP 409)')
        : ok(JSON.stringify([{ sha: 'abc' }]));
    if (args[0] === 'repo' && args[1] === 'create') {
      w.repo = 'empty';
      return ok('https://github.com/ada/plant-diary');
    }
    if (args[0] === 'repo' && args[1] === 'clone') {
      const dir = args[3] ?? '';
      expect(cwd).toBeDefined();
      await mkdir(join(dir, '.git'), { recursive: true });
      await writeFile(join(dir, 'conch-app.json'), '{"old":true}');
      await writeFile(join(dir, 'gone.txt'), 'from an older version');
      return ok();
    }
    if (args[0] === 'repo' && args[1] === 'edit') return ok();
    if (args[0] === 'release' && args[1] === 'view')
      return w.release === 'exists' ? ok('{"tagName":"v1.1.0"}') : no('release not found');
    if (args[0] === 'release' && args[1] === 'create')
      return w.release === 'raced'
        ? no(
            'HTTP 422: Validation Failed (https://api.github.com/repos/ada/plant-diary/releases)\nRelease.tag_name already exists',
          )
        : ok('https://github.com/ada/plant-diary/releases/tag/v1.1.0');
    throw new Error(`gh was asked something unexpected: ${words}`);
  };

  const git = async (all: string[], cwd?: string): Promise<RunResult> => {
    const args = [...all];
    while (args[0] === '-c') args.splice(0, 2);
    const [command] = args;
    if (command === 'init') {
      await mkdir(join(cwd ?? '', '.git'), { recursive: true });
      return ok();
    }
    if (command === 'add' || command === 'commit') return ok();
    if (command === 'status') return ok(w.status);
    if (command === 'push') {
      pushed = await tree(cwd ?? '');
      readmeText = await readFile(join(cwd ?? '', 'README.md'), 'utf8').catch(() => undefined);
      return w.push;
    }
    throw new Error(`git was asked something unexpected: ${args.join(' ')}`);
  };

  const exec: Exec = {
    async run(file, args, options) {
      calls.push({
        file,
        args,
        env: options?.env ?? {},
        ...(options?.cwd && { cwd: options.cwd }),
      });
      if (file === GH) return gh(args, options?.cwd);
      if (file === GIT) return git(args, options?.cwd);
      throw new Error(`ran ${file}`);
    },
    start(file, args, options): Running {
      expect(file).toBe(GH);
      login.started++;
      login.args = args;
      login.env = options?.env ?? {};
      const listeners: ((text: string) => void)[] = [];
      let finish: (code: number | undefined) => void = () => undefined;
      const exited = new Promise<number | undefined>((resolve) => (finish = resolve));
      login.exit = (code) => finish(code);
      if (w.loginSays !== undefined) {
        const says = w.loginSays;
        setTimeout(() => {
          for (const listener of listeners) listener(says);
        }, 1);
      }
      return {
        onOutput: (listener) => void listeners.push(listener),
        write: (text) => void (login.written += text),
        exited,
        kill: () => {
          login.killed = true;
          finish(undefined);
        },
      };
    },
  };
  return {
    exec,
    calls,
    login,
    world: w,
    get pushed() {
      return pushed;
    },
    get readme() {
      return readmeText;
    },
    said: (file: string) =>
      calls
        .filter((c) => c.file === file)
        .map((c) => c.args.filter((a, i, all) => a !== '-c' && all[i - 1] !== '-c').join(' ')),
  };
}

let root: string;
let appDir: string;
let tmp: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'conch-publish-test-'));
  appDir = join(root, 'plant-diary');
  tmp = join(root, 'tmp');
  await mkdir(join(appDir, 'pages'), { recursive: true });
  await mkdir(tmp);
  await writeFile(join(appDir, 'conch-app.json'), JSON.stringify(manifest));
  await writeFile(join(appDir, 'tools.mjs'), 'export const tools = {};\n');
  await writeFile(join(appDir, 'pages', 'main.html'), '<!doctype html><html lang="en"></html>');
  // Never published: hidden files.
  await writeFile(join(appDir, '.env'), `TOKEN=${TOKEN}`);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const app = () => ({
  id: 'plant-diary',
  dir: appDir,
  manifest,
  tools: [
    {
      name: 'log_watering',
      title: 'Log watering',
      description: 'Records that a plant was watered.',
      changes: true,
    },
  ],
});

function publisher(
  fake: ReturnType<typeof programs>,
  more: Parameters<typeof createPublisher>[0] = {},
) {
  return createPublisher({
    exec: fake.exec,
    find: async (program) => (program === 'gh' ? GH : GIT),
    tmp,
    home: root,
    codeWaitMs: 200,
    ...more,
  });
}

describe('running a program that waits', () => {
  it('reads its output as it comes, answers it, and hears it end', async () => {
    const child = realExec.start(process.execPath, [
      '-e',
      "console.error('! First copy your one-time code: ABCD-1234'); process.stdin.once('data', () => process.exit(3));",
    ]);
    let output = '';
    const heard = new Promise<void>((resolve) =>
      child.onOutput((text) => {
        output += text;
        if (readCode(output)) resolve();
      }),
    );
    await heard;
    child.write('\n');
    expect(await child.exited).toBe(3);
  });

  it('can be stopped', async () => {
    const child = realExec.start(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    child.kill();
    expect(await child.exited).toBeUndefined();
  });
});

describe('reading what gh says', () => {
  it('finds the one-time code however gh words it', () => {
    expect(readCode(GH_NOW)).toBe('0865-992D');
    expect(readCode(GH_BEFORE)).toBe('ABCD-1234');
    expect(readCode('! First copy your one-time code: 3F2A-B71C\n')).toBe('3F2A-B71C');
    expect(readCode('Open this URL to continue in your web browser')).toBeUndefined();
    expect(readCode('error connecting to api.github.com')).toBeUndefined();
  });

  it('writes a README that says what the app does, can do, and how to add it', () => {
    const text = readme(manifest, app().tools);
    expect(text).toMatch(/^# Plant diary\n\nKeeps track of when you water your plants/);
    expect(text).toContain('Reaches `api.open-meteo.com`.');
    expect(text).toContain('**Log watering** (changes things): Records that a plant was watered.');
    expect(text).toContain('A page: Plants.');
    expect(text).toContain('“I watered the fern”');
    expect(text).toContain(
      'In Conch, open **Apps**, press **Add your own**, choose **From a link** and paste this page’s address.',
    );
    expect(readme({ ...manifest, reaches: [] })).toContain('Doesn’t reach any website.');
  });
});

describe('publishing on GitHub', () => {
  it('asks for GitHub’s program, then Git, before anything else', async () => {
    const fake = programs();
    const noGh = publisher(fake, { find: async () => undefined });
    expect(await noGh.publish(app())).toEqual({ state: 'needs-program', need: 'gh' });
    expect(noGh.state('plant-diary')).toEqual({ state: 'needs-program', need: 'gh' });
    const noGit = publisher(fake, {
      find: async (program) => (program === 'gh' ? GH : undefined),
    });
    expect(await noGit.publish(app())).toEqual({ state: 'needs-program', need: 'git' });
    expect(fake.calls).toEqual([]);
  });

  it('makes a new public repository, uploads the app, tags it and makes the release', async () => {
    const fake = programs();
    const publish = publisher(fake);
    expect(publish.state('plant-diary')).toEqual({ state: 'idle' });
    const first = await publish.publish(app());
    expect(first).toMatchObject({ state: 'publishing' });
    expect(await publish.settled('plant-diary')).toEqual({
      state: 'published',
      url: 'https://github.com/ada/plant-diary',
      version: '1.1.0',
    });
    expect(fake.said(GH)).toEqual([
      'auth status --hostname github.com',
      'api user',
      'api repos/ada/plant-diary',
      'repo create ada/plant-diary --public --description=Keeps track of when you water your plants',
      'api repos/ada/plant-diary',
      'repo edit ada/plant-diary --add-topic conch-app',
      'release view v1.1.0 --repo ada/plant-diary --json tagName',
      'release create v1.1.0 --repo ada/plant-diary --title=Plant diary 1.1.0 --notes=Keeps track of when you water your plants\n\nIn Conch, open **Apps**, press **Add your own**, choose **From a link** and paste this repository’s address.',
    ]);
    expect(fake.said(GIT)).toEqual([
      'init --quiet -b main',
      'add --all',
      'status --porcelain',
      'commit --quiet -m Version 1.1.0',
      'push --quiet https://github.com/ada/plant-diary.git HEAD:refs/heads/main',
    ]);
    // The app's own files and a README, nothing hidden.
    expect(fake.pushed).toEqual(['README.md', 'conch-app.json', 'pages/main.html', 'tools.mjs']);
    expect(fake.readme).toContain('**Log watering**');
  });

  it('commits as the person’s GitHub private address, with GitHub’s program as git’s password', async () => {
    const fake = programs();
    const publish = publisher(fake);
    await publish.publish(app());
    await publish.settled('plant-diary');
    const commit = fake.calls.find((c) => c.file === GIT && c.args.includes('commit'));
    expect(commit?.env).toMatchObject({
      GIT_AUTHOR_NAME: 'ada',
      GIT_AUTHOR_EMAIL: '42+ada@users.noreply.github.com',
      GIT_COMMITTER_EMAIL: '42+ada@users.noreply.github.com',
    });
    const push = fake.calls.find((c) => c.file === GIT && c.args.includes('push'));
    expect(push?.args).toEqual(
      expect.arrayContaining([
        'credential.helper=',
        `credential.helper=!'${GH}' auth git-credential`,
        'core.autocrlf=false',
      ]),
    );
    // Nothing waits on a person, nothing pages.
    for (const call of fake.calls) {
      expect(call.env).toMatchObject({
        GIT_TERMINAL_PROMPT: '0',
        GH_PROMPT_DISABLED: '1',
        GH_PAGER: '',
      });
      expect(Object.keys(call.env).some((key) => key.startsWith('CONCH_'))).toBe(false);
    }
  });

  it('signs in with GitHub’s code, then carries on by itself', async () => {
    const fake = programs({ signedIn: false });
    const publish = publisher(fake);
    const shown = await publish.publish(app());
    expect(shown).toEqual({ state: 'needs-sign-in', code: '0865-992D', url: DEVICE_URL });
    expect(fake.login.args).toEqual([
      'auth',
      'login',
      '--hostname',
      'github.com',
      '--git-protocol',
      'https',
      '--web',
      '--skip-ssh-key',
    ]);
    // gh may ask here; it never opens a browser of its own.
    expect(fake.login.env.GH_PROMPT_DISABLED).toBeUndefined();
    expect(fake.login.env.GH_BROWSER).toBe(`'${GIT}' --version`);
    // Pressing again while it waits shows the same code, and starts nothing new.
    expect(await publish.publish(app())).toEqual(shown);
    expect(fake.login.started).toBe(1);
    // The person enters the code on GitHub.
    fake.world.signedIn = true;
    fake.login.exit(0);
    expect(await publish.settled('plant-diary')).toMatchObject({ state: 'published' });
    expect(fake.said(GH)).toContain(
      'repo create ada/plant-diary --public --description=Keeps track of when you water your plants',
    );
  });

  it('presses Enter for an older gh, which then opens nothing', async () => {
    const fake = programs({ signedIn: false, loginSays: GH_BEFORE });
    const publish = publisher(fake);
    expect(await publish.publish(app())).toMatchObject({ code: 'ABCD-1234' });
    expect(fake.login.written).toBe('\n');
    fake.login.exit(1);
    expect(await publish.settled('plant-diary')).toEqual({
      state: 'failed',
      message: 'Signing in to GitHub didn’t finish. Press Publish on GitHub for a new code.',
    });
  });

  it('gives up on a sign-in whose code never comes', async () => {
    const fake = programs({ signedIn: false, loginSays: undefined });
    const publish = publisher(fake, { codeWaitMs: 20 });
    const state = await publish.publish(app());
    expect(state.state).toBe('failed');
    expect(state).toMatchObject({
      message: expect.stringMatching(/^GitHub’s sign-in didn’t start\. .*Publish on GitHub/),
    });
    expect(fake.login.killed).toBe(true);
  });

  it('says so when gh stops before giving a code, without its secrets', async () => {
    const fake = programs({ signedIn: false, loginSays: `error: token ${TOKEN} rejected\n` });
    const publish = publisher(fake);
    setTimeout(() => fake.login.exit(1), 20);
    const state = await publish.publish(app());
    expect(state.state).toBe('failed');
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('gives up when the code is never entered', async () => {
    const fake = programs({ signedIn: false });
    const publish = publisher(fake, { signInMs: 30 });
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toEqual({
      state: 'failed',
      message:
        'The GitHub code ran out before it was entered. Press Publish on GitHub for a new one.',
    });
    expect(fake.login.killed).toBe(true);
    expect(fake.said(GH)).not.toContain('api user');
  });

  it('updates its own repository with the new version, replacing the old files', async () => {
    const fake = programs({ repo: { manifestId: 'plant-diary' } });
    const publish = publisher(fake);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({
      state: 'published',
      version: '1.1.0',
    });
    const gh = fake.said(GH);
    expect(gh).not.toContainEqual(expect.stringMatching(/^repo create/));
    expect(gh.find((line) => line.startsWith('repo clone'))).toMatch(
      /^repo clone https:\/\/github\.com\/ada\/plant-diary\.git .*conch-publish-.*repo -- --depth 1$/,
    );
    expect(fake.said(GIT)).toContain('commit --quiet -m Version 1.1.0');
    expect(fake.said(GIT)).toContain('push --quiet https://github.com/ada/plant-diary.git HEAD');
    expect(fake.pushed).not.toContain('gone.txt');
    expect(fake.pushed).toContain('tools.mjs');
  });

  it('fills an empty repository of the same name', async () => {
    const fake = programs({ repo: 'empty' });
    const publish = publisher(fake);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({ state: 'published' });
    expect(fake.said(GH)).not.toContainEqual(expect.stringMatching(/^repo (create|clone)/));
    expect(fake.said(GIT)).toContain(
      'push --quiet https://github.com/ada/plant-diary.git HEAD:refs/heads/main',
    );
  });

  it('never touches someone else’s repository that has the same name', async () => {
    for (const repo of [{ manifestId: 'another-app' }, {}]) {
      const fake = programs({ repo });
      const publish = publisher(fake);
      await publish.publish(app());
      expect(await publish.settled('plant-diary')).toEqual({
        state: 'failed',
        message:
          'There’s already a repository called plant-diary on your GitHub that isn’t this app, so Conch left it alone. Give the app another name, then press Publish on GitHub again.',
      });
      expect(fake.said(GH)).not.toContainEqual(expect.stringMatching(/^(repo|release) /));
      expect(fake.calls.filter((c) => c.file === GIT)).toEqual([]);
    }
  });

  it('never empties a fork, even of this very app', async () => {
    const fake = programs({ repo: { manifestId: 'plant-diary', fork: true } });
    const publish = publisher(fake);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toEqual({
      state: 'failed',
      message:
        'Your repository ada/plant-diary is a copy of someone else’s, so Conch left it alone. Give the app another name, then press Publish on GitHub again.',
    });
    expect(fake.calls.filter((c) => c.file === GIT)).toEqual([]);
    expect(fake.said(GH)).not.toContainEqual(expect.stringMatching(/^(repo|release) /));
  });

  it('never follows GitHub from a renamed or moved repository’s old name', async () => {
    for (const fullName of ['ada/plant-diary-old', 'grace/plant-diary']) {
      const fake = programs({ repo: { manifestId: 'plant-diary', fullName } });
      const publish = publisher(fake);
      await publish.publish(app());
      expect(await publish.settled('plant-diary')).toMatchObject({
        state: 'failed',
        message: expect.stringMatching(
          /^GitHub sends ada\/plant-diary on to a repository with another name/,
        ),
      });
      expect(fake.calls.filter((c) => c.file === GIT)).toEqual([]);
    }
    // GitHub's names ignore case.
    const same = programs({ repo: { manifestId: 'plant-diary', fullName: 'Ada/Plant-Diary' } });
    const publish = publisher(same);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({ state: 'published' });
  });

  it('remembers the repository it published to by GitHub’s id, and updates only that one', async () => {
    const published = publishedInMemory();
    const first = programs();
    const publisherOne = publisher(first, { published });
    await publisherOne.publish(app());
    expect(await publisherOne.settled('plant-diary')).toMatchObject({ state: 'published' });
    expect(await published.get('plant-diary')).toEqual({ repoId: 7001 });
    // The same repository later, even without a manifest Conch would recognise: its own.
    const again = programs({ repo: { id: 7001 } });
    const publisherTwo = publisher(again, { published });
    await publisherTwo.publish(app());
    expect(await publisherTwo.settled('plant-diary')).toMatchObject({ state: 'published' });
    expect(again.said(GIT)).toContain('push --quiet https://github.com/ada/plant-diary.git HEAD');
    // Another repository by that name since (deleted and made again, or moved in):
    // not its own, whatever its manifest says.
    const other = programs({ repo: { id: 9999, manifestId: 'plant-diary' } });
    const publisherThree = publisher(other, { published });
    await publisherThree.publish(app());
    expect(await publisherThree.settled('plant-diary')).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/isn’t this app, so Conch left it alone/),
    });
    expect(other.calls.filter((c) => c.file === GIT)).toEqual([]);
    expect(await published.get('plant-diary')).toEqual({ repoId: 7001 });
  });

  it('fills an empty repository by that name whatever it remembered, and remembers it', async () => {
    const published = publishedInMemory();
    await published.set('plant-diary', 1234);
    const fake = programs({ repo: 'empty' });
    const publish = publisher(fake, { published });
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({ state: 'published' });
    expect(await published.get('plant-diary')).toEqual({ repoId: 7001 });
  });

  it('leaves an archived repository alone, saying how to unarchive it', async () => {
    const fake = programs({ repo: { manifestId: 'plant-diary', archived: true } });
    const publish = publisher(fake);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/archived.*Unarchive it/),
    });
    expect(fake.calls.filter((c) => c.file === GIT)).toEqual([]);
  });

  it('says published when that version’s release is there already', async () => {
    const already = programs({
      repo: { manifestId: 'plant-diary' },
      release: 'exists',
      status: '',
    });
    const publish = publisher(already);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({ state: 'published' });
    // Nothing changed: no empty commit, no push, no second release.
    expect(already.said(GIT)).not.toContainEqual(expect.stringMatching(/^(commit|push)/));
    expect(already.said(GH)).not.toContainEqual(expect.stringMatching(/^release create/));
    const raced = programs({ release: 'raced' });
    const again = publisher(raced);
    await again.publish(app());
    expect(await again.settled('plant-diary')).toMatchObject({ state: 'published' });
  });

  it('says when GitHub changed underneath, and when the upload failed, in words', async () => {
    const rejected = programs({
      repo: { manifestId: 'plant-diary' },
      push: no(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'),
    });
    const publish = publisher(rejected);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toEqual({
      state: 'failed',
      message:
        'ada/plant-diary changed on GitHub while Conch was uploading. Press Publish on GitHub to try again.',
    });
    const broken = programs({
      push: no(
        `fatal: unable to access 'https://ada:${TOKEN}@github.com/': Could not resolve host`,
      ),
    });
    const other = publisher(broken);
    await other.publish(app());
    const state = await other.settled('plant-diary');
    expect(state).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(
        /^Conch couldn’t upload Plant diary to GitHub \(GitHub said: .*\)\. Press Publish on GitHub to try again\.$/,
      ),
    });
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it('asks to sign in again when GitHub forgot Conch midway', async () => {
    const fake = programs({
      answers: { 'api user': no('HTTP 401: Bad credentials (https://api.github.com/user)') },
    });
    const publish = publisher(fake);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toEqual({
      state: 'failed',
      message:
        'GitHub says Conch isn’t signed in any more. Press Publish on GitHub to sign in again.',
    });
  });

  it('scrubs whatever gh says before it reaches a message', async () => {
    const fake = programs({
      answers: {
        'repo edit ada/plant-diary --add-topic conch-app': no(
          `HTTP 403: Resource not accessible by token ${TOKEN} (https://api.github.com/repos/ada/plant-diary/topics)`,
        ),
      },
    });
    const publish = publisher(fake, { redact: (text) => text.replaceAll('Resource', '•••') });
    await publish.publish(app());
    const state = await publish.settled('plant-diary');
    expect(state).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/conch-app topic.*•••/),
    });
    expect(JSON.stringify(state)).not.toContain(TOKEN);
    // And no token ever went in an argument.
    for (const call of fake.calls) expect(call.args.join(' ')).not.toMatch(/gho_|ghp_|github_pat_/);
  });

  it('cleans up its temporary folder whatever happens', async () => {
    for (const world of [
      {},
      { push: no('fatal: the remote end hung up') },
      { repo: { manifestId: 'plant-diary' } },
    ]) {
      const fake = programs(world);
      const publish = publisher(fake);
      await publish.publish(app());
      await publish.settled('plant-diary');
      expect(await readdir(tmp)).toEqual([]);
    }
  });

  it('refuses an app that’s bigger than an app can be', async () => {
    const big = Buffer.alloc(1024 * 1024, 'a');
    for (const name of ['a.txt', 'b.txt', 'c.txt']) await writeFile(join(appDir, name), big);
    const fake = programs();
    const publish = publisher(fake);
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({
      state: 'failed',
      message: expect.stringMatching(/bigger than an app can be/),
    });
    expect(fake.said(GIT)).not.toContainEqual(expect.stringMatching(/^push/));
    expect(await readdir(tmp)).toEqual([]);
  });

  it('names a repository only after a real app id', async () => {
    const fake = programs();
    const publish = publisher(fake);
    for (const id of ['../../evil', 'other-app']) {
      expect(await publish.publish({ ...app(), id })).toMatchObject({
        state: 'failed',
        message: expect.stringMatching(/couldn’t tell which app/),
      });
    }
    expect(fake.calls).toEqual([]);
  });

  it('can publish again after it failed', async () => {
    const fake = programs({ push: no('fatal: the remote end hung up') });
    const publish = publisher(fake);
    await publish.publish(app());
    expect((await publish.settled('plant-diary')).state).toBe('failed');
    fake.world.push = ok();
    await publish.publish(app());
    expect(await publish.settled('plant-diary')).toMatchObject({ state: 'published' });
    // The repository it made the first time is still its own to fill.
    expect(fake.said(GH).filter((line) => line.startsWith('repo create'))).toHaveLength(1);
  });
});
