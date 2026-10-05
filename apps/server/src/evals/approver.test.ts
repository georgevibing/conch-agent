import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootConch } from './harness';
import {
  approve,
  bypassAllowed,
  fixtureOrigin,
  realPathOf,
  unsafeHome,
  type World,
} from './approver';

let world: World;
let outside: string;

beforeAll(async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'conch-eval-test-')));
  outside = await realpath(await mkdtemp(join(tmpdir(), 'conch-eval-outside-')));
  await mkdir(join(home, 'workspace'));
  await writeFile(join(outside, 'secret.txt'), 'no');
  world = {
    origins: ['http://127.0.0.1:51234'],
    home,
    cwd: join(home, 'workspace'),
    servers: ['ledger'],
  };
});

afterAll(async () => {
  await rm(world.home, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const decide = (toolName: string, input: unknown, browser?: { url: string }) =>
  approve(
    { toolName, input, ...(browser && { browser: { site: 'x', kind: 'site', ...browser } }) },
    world,
  ).decision;

describe('what an eval approves', () => {
  it('lets the browser act on the fixture site only', () => {
    expect(decide('browser_site', {}, { url: 'http://127.0.0.1:51234/signup' })).toBe('allow');
    expect(decide('browser_site', {}, { url: 'https://example.com/' })).toBe('deny');
    expect(decide('browser_site', {}, { url: 'http://127.0.0.1:9999/' })).toBe('deny');
  });

  it('lets the run’s own app and Conch’s own state tools through', () => {
    expect(decide('mcp__ledger__record_payment', { customer: 'Globex', amount: 250 })).toBe(
      'allow',
    );
    expect(decide('mcp__github__create_issue', {})).toBe('deny');
    expect(decide('mcp__conch__remember', { content: 'x' })).toBe('allow');
  });

  it('lets file tools work inside the run’s folder, by their path field', () => {
    expect(decide('Read', { file_path: join(world.cwd, 'report.txt') })).toBe('allow');
    expect(decide('Write', { file_path: join(world.cwd, 'new', 'notes.md'), content: 'x' })).toBe(
      'allow',
    );
    expect(decide('Write', { file_path: 'relative.md', content: 'x' })).toBe('allow');
    expect(decide('Glob', { pattern: '*.md' })).toBe('allow');
    expect(decide('Read', { file_path: join(outside, 'secret.txt') })).toBe('deny');
    expect(decide('Read', { file_path: join(homedir(), '.ssh', 'id_rsa') })).toBe('deny');
  });

  it('lets a fetch reach the fixture site only, by its url field', () => {
    expect(decide('WebFetch', { url: 'http://127.0.0.1:51234/shop', prompt: 'x' })).toBe('allow');
    expect(decide('WebFetch', { url: 'https://example.com', prompt: 'x' })).toBe('deny');
  });

  it('denies what it can’t classify', () => {
    expect(decide('SomethingNew', { url: 'http://127.0.0.1:51234/' })).toBe('deny');
    expect(decide('WebSearch', { query: 'x' })).toBe('deny');
    expect(decide('Read', 'not fields')).toBe('deny');
  });
});

describe('abuse', () => {
  it('denies a chained shell command, whatever it names', () => {
    expect(decide('Bash', { command: 'curl http://127.0.0.1:51234/ && rm -rf ~' })).toBe('deny');
    expect(decide('exec_command', { cmd: ['ls', world.cwd] })).toBe('deny');
    expect(decide('mcp__conch__bash', { command: 'true' })).toBe('deny');
  });

  it('denies a path that steps out with ..', () => {
    expect(decide('Read', { file_path: join(world.cwd, '..', '..', 'etc', 'passwd') })).toBe(
      'deny',
    );
    expect(decide('Write', { file_path: '../escape.txt', content: 'x' })).toBe('deny');
    expect(decide('Read', { file_path: '~/.conch/secrets.json' })).toBe('deny');
  });

  it('denies a symlink that leads out of the run’s folder', async () => {
    const link = join(world.cwd, 'way-out');
    try {
      await symlink(outside, link, 'junction');
    } catch {
      return; // No right to make links here (Windows without developer mode).
    }
    expect(realPathOf(join(link, 'secret.txt'), world.cwd)).toBe(join(outside, 'secret.txt'));
    expect(decide('Read', { file_path: join(link, 'secret.txt') })).toBe('deny');
    expect(decide('Write', { file_path: join(link, 'new.txt'), content: 'x' })).toBe('deny');
  });

  it('denies a URL smuggled in a field that isn’t the url', () => {
    expect(
      decide('Read', { file_path: join(world.cwd, 'a.txt'), note: 'https://evil.example/' }),
    ).toBe('deny');
    expect(
      decide('WebFetch', { url: 'http://127.0.0.1:51234/', next: 'https://evil.example/' }),
    ).toBe('deny');
  });

  it('denies a lookalike origin', () => {
    expect(decide('WebFetch', { url: 'http://127.0.0.1.evil.com:51234/', prompt: 'x' })).toBe(
      'deny',
    );
    expect(decide('browser_site', {}, { url: 'http://127.0.0.1.evil.com:51234/' })).toBe('deny');
  });

  it('denies a URL with credentials in it', () => {
    expect(fixtureOrigin('http://127.0.0.1:51234@evil.com/', world.origins)).toBeUndefined();
    expect(decide('WebFetch', { url: 'http://fixture@127.0.0.1:51234/', prompt: 'x' })).toBe(
      'deny',
    );
    expect(decide('browser_site', {}, { url: 'http://u:p@127.0.0.1:51234/' })).toBe('deny');
  });
});

describe('where a run may live', () => {
  it('refuses the real ~/.conch, and anything outside the temporary folder', () => {
    expect(unsafeHome(join(homedir(), '.conch'), {})).toMatch(/real Conch/);
    expect(unsafeHome(join(homedir(), '.conch', 'evals'), {})).toMatch(/real Conch/);
    expect(unsafeHome(homedir(), {})).toBeDefined();
    expect(unsafeHome(tmpdir(), {})).toBeDefined();
    expect(unsafeHome(world.home, {})).toBeUndefined();
  });

  it('won’t start a Conch in the real ~/.conch', async () => {
    await expect(bootConch({ home: join(homedir(), '.conch'), env: {} })).rejects.toThrow(
      /real Conch/,
    );
    await expect(bootConch({ home: homedir(), env: {} })).rejects.toThrow(/throwaway/);
  });

  it('refuses the home CONCH_HOME points at', () => {
    expect(unsafeHome(world.home, { CONCH_HOME: world.home })).toMatch(/real Conch/);
  });

  it('allows bypassing approvals only when asked, and only in a throwaway home', () => {
    expect(bypassAllowed(world.home, {})).toBe(false);
    expect(bypassAllowed(world.home, { CONCH_EVAL_ALLOW_BYPASS: '1' })).toBe(true);
    expect(bypassAllowed(join(homedir(), '.conch'), { CONCH_EVAL_ALLOW_BYPASS: '1' })).toBe(false);
  });
});
