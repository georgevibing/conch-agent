import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  captureEvidence,
  EVIDENCE_MAX_BYTES,
  evidenceFolder,
  evidenceText,
  readEvidence,
  stackOnly,
} from './evidence';

const homes: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function home() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'conch-evidence-')));
  homes.push(path);
  return path;
}

describe('only stack frames, never anything else', () => {
  it('keeps allowlisted names, relative release paths and lines', () => {
    expect(
      stackOnly([
        { name: 'spinForever', file: 'apps/server/src/x.ts', line: 12 },
        { name: 'get value', file: 'node_modules/.pnpm/a@1.0.0/node_modules/a/i.js', line: 3 },
        { name: '(anonymous)', file: 'apps/server/src/routes.ts', line: 7 },
        { name: '(anything)', file: 'apps/x.ts', line: 1 },
        { name: 'leak', file: '/Users/someone/.ssh/id_rsa', line: 1 },
        { name: 'escape', file: '../outside/x.ts', line: 1 },
        { name: 'dots', file: 'apps/./x.ts', line: 1 },
        { name: 'TOKEN=xoxb-123', file: 'apps/x.ts', line: 1 },
        { name: 'url', file: 'file:///etc/passwd', line: 1 },
        { name: 'query', file: 'apps/x.ts?token=1', line: 1 },
        { name: 'nonsense', file: 'apps/x.ts', line: 0 },
        { name: 'fractional', file: 'apps/x.ts', line: 1.5 },
        { name: 'x'.repeat(81), file: 'apps/x.ts', line: 1 },
        { name: 'extra', file: 'apps/x.ts', line: 2, value: 'secret', env: { A: 'b' } },
        'at main (/x.ts:1:1)',
        null,
      ]),
    ).toEqual([
      { name: 'spinForever', file: 'apps/server/src/x.ts', line: 12 },
      { name: 'get value', file: 'node_modules/.pnpm/a@1.0.0/node_modules/a/i.js', line: 3 },
      { name: '(anonymous)', file: 'apps/server/src/routes.ts', line: 7 },
      { name: 'extra', file: 'apps/x.ts', line: 2 },
    ]);
    expect(stackOnly('spinForever')).toEqual([]);
    expect(
      stackOnly(Array.from({ length: 500 }, () => ({ name: 'f', file: 'a.ts', line: 1 }))),
    ).toHaveLength(40);
  });

  it('stays under its size bound, keeping the innermost frames', () => {
    const frames = Array.from({ length: 80 }, (_, i) => ({
      name: `f${i}`.padEnd(80, 'x'),
      file: `apps/${'d'.repeat(180)}/${i}.ts`,
      line: i + 1,
    }));
    const text = evidenceText({ version: 1, at: 1, where: 'javascript', frames });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(EVIDENCE_MAX_BYTES);
    const kept = (JSON.parse(text) as { frames: { line: number }[] }).frames;
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(80);
    expect(kept[0]?.line).toBe(1);
  });
});

describe('capturing evidence from the supervisor', () => {
  /** A pretend gateway's thread: answers the request with whatever it's given. */
  async function answer(folder: string, pid: number, body: string) {
    for (let i = 0; i < 100; i++) {
      try {
        statSync(join(folder, `${pid}.request`));
        writeFileSync(join(folder, `${pid}.frames.json`), body);
        return;
      } catch {
        await new Promise((done) => setTimeout(done, 10));
      }
    }
  }

  it('gives up within its bound and leaves nothing behind when nobody answers', async () => {
    const at = home();
    const started = performance.now();
    expect(await captureEvidence(424242, at, { boundMs: 200 })).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(readdirSync(evidenceFolder(at))).toEqual([]);
    expect(await captureEvidence(undefined, at)).toBe(false);
  });

  it('keeps a sanitised copy, private, and only the newest three', async () => {
    const at = home();
    const folder = evidenceFolder(at);
    let clock = 1_000;
    for (let i = 0; i < 5; i++) {
      const capture = captureEvidence(77, at, { boundMs: 1_000, now: () => ++clock });
      await answer(
        folder,
        77,
        JSON.stringify({
          where: 'javascript',
          frames: [
            { name: 'spin', file: 'apps/server/src/a.ts', line: i + 1 },
            { name: 'env', file: '/etc/environment', line: 1, value: 'API_KEY=1' },
          ],
          environmentVariables: { SECRET: 'x' },
        }),
      );
      expect(await capture).toBe(true);
    }
    expect(readdirSync(folder).sort()).toEqual([
      'frozen-1003.json',
      'frozen-1004.json',
      'frozen-1005.json',
    ]);
    if (process.platform !== 'win32')
      expect(statSync(join(folder, 'frozen-1005.json')).mode & 0o777).toBe(0o600);
    const text = readFileSync(join(folder, 'frozen-1005.json'), 'utf8');
    expect(text).not.toMatch(/SECRET|API_KEY|environment/);
    expect(readEvidence(at).map((entry) => entry.frames[0]?.line)).toEqual([5, 4, 3]);
  });

  it('passes over an oversized or malformed answer', async () => {
    const at = home();
    const folder = evidenceFolder(at);
    mkdirSync(folder, { recursive: true });
    const big = captureEvidence(78, at, { boundMs: 500 });
    await answer(folder, 78, 'x'.repeat(70_000));
    expect(await big).toBe(false);
    const broken = captureEvidence(79, at, { boundMs: 500 });
    await answer(folder, 79, '{"where":');
    expect(await broken).toBe(false);
    expect(readdirSync(folder)).toEqual([]);
  });
});

describe.skipIf(process.platform === 'win32')('a real frozen gateway', () => {
  const server = resolve(import.meta.dirname, '..', '..');
  const SECRET = 'xoxb-' + 'evidence-not-for-disk';

  /** A gateway stuck as `body` says, answering requests from its own thread. */
  async function frozen(at: string, body: string): Promise<ChildProcess> {
    const root = home();
    const script = join(root, 'gateway.mjs');
    writeFileSync(
      script,
      `import { answerEvidenceRequests } from ${JSON.stringify(pathToFileURL(join(server, 'src', 'recovery', 'evidence.ts')).href)};
import { execFileSync } from 'node:child_process';
answerEvidenceRequests(${JSON.stringify(at)}, { root: ${JSON.stringify(root)} });
function spinForever() { let i = 0; for (;;) i++; }
function blockedInNative() { execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 4000)']); }
function handleTurn() { ${body} }
setTimeout(() => { process.send('stuck'); handleTurn(); }, 300);
`,
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script, `--token=${SECRET}`], {
      cwd: server,
      env: { ...process.env, CONCH_TEST_SECRET: SECRET },
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    children.push(child);
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('fixture did not start')), 10_000);
      child.once('message', () => {
        clearTimeout(timer);
        done();
      });
      child.once('exit', () => fail(new Error('fixture exited')));
    });
    return child;
  }

  it('records where a busy loop is, as stack frames only', async () => {
    const at = home();
    const child = await frozen(at, 'spinForever();');
    await new Promise((done) => setTimeout(done, 200));
    const started = performance.now();
    expect(await captureEvidence(child.pid, at)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_100);
    const [evidence, ...rest] = readEvidence(at);
    expect(rest).toEqual([]);
    expect(evidence?.where).toBe('javascript');
    expect(evidence?.frames.slice(0, 2).map(({ name, file }) => [name, file])).toEqual([
      ['spinForever', 'gateway.mjs'],
      ['handleTurn', 'gateway.mjs'],
    ]);
    expect(evidence?.frames[0]?.line).toBe(4);
    expect(evidence?.frames.every(({ file }) => file === 'gateway.mjs')).toBe(true);
    const folder = evidenceFolder(at);
    const files = readdirSync(folder);
    expect(files).toHaveLength(1);
    const text = readFileSync(join(folder, files[0] ?? ''), 'utf8');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('CONCH_TEST_SECRET');
    expect(text).not.toContain(at);
    expect(text).not.toMatch(/node:internal|--import|tsx/);
    expect(child.exitCode).toBeNull();
  }, 20_000);

  it('names the line of the TypeScript as written, not of what tsx runs', async () => {
    const at = home();
    const root = home();
    const script = join(root, 'turns.ts');
    // tsx runs this as a line or two; the loop is on line 14 of the file.
    writeFileSync(
      script,
      `import { answerEvidenceRequests } from ${JSON.stringify(pathToFileURL(join(server, 'src', 'recovery', 'evidence.ts')).href)};

interface Turn {
  id: string;
  steps: number;
}

answerEvidenceRequests(${JSON.stringify(at)}, { root: ${JSON.stringify(root)} });

const pending: Turn[] = [{ id: 'a', steps: 1 }];

function spinForever(turn: Turn): number {
  let i: number = turn.steps;
  for (;;) i = (i + 1) % 1_000_003;
}

function handleTurn(turns: Turn[]): void {
  for (const turn of turns) spinForever(turn);
}

setTimeout(() => {
  process.send?.('stuck');
  handleTurn(pending);
}, 300);
`,
    );
    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: server,
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    children.push(child);
    await new Promise<void>((done, fail) => {
      const timer = setTimeout(() => fail(new Error('fixture did not start')), 10_000);
      child.once('message', () => {
        clearTimeout(timer);
        done();
      });
      child.once('exit', () => fail(new Error('fixture exited')));
    });
    await new Promise((done) => setTimeout(done, 200));
    expect(await captureEvidence(child.pid, at)).toBe(true);
    expect(readEvidence(at)[0]?.frames.slice(0, 2)).toEqual([
      { name: 'spinForever', file: 'turns.ts', line: 14 },
      { name: 'handleTurn', file: 'turns.ts', line: 18 },
    ]);
  }, 20_000);

  it('says so when the gateway is stuck outside JavaScript', async () => {
    const at = home();
    const child = await frozen(at, 'blockedInNative();');
    await new Promise((done) => setTimeout(done, 200));
    expect(await captureEvidence(child.pid, at)).toBe(true);
    expect(readEvidence(at)).toEqual([
      { version: 1, at: expect.any(Number), where: 'outside-javascript', frames: [] },
    ]);
  }, 20_000);
});
