import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConchBuild, UpdatesStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type LatestLookup, type NeedSpec, Setup } from '../setup/needs';
import type { ConchCheck, ConchCheckout, ConchResult, UpdateProgressReport } from './conch';
import { updatesCheck } from './doctor';
import { DAY, MINUTE } from './schedule';
import { readState, writeState } from './layout';
import type { Offer, ReleaseCheck, ReleaseFollower, StagedResult } from './releases';
import { UpdatesService } from './service';

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0))
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

const lookup: LatestLookup = {
  npm: async () => '0.160.0',
  winget: async () => undefined,
  brew: async () => undefined,
  pypi: async () => undefined,
  github: async () => undefined,
};

/**
 * Programs whose versions live in a JSON file; "updating" one runs Node (the
 * package manager here) with a script that moves it on — or fails.
 */
async function world(
  options: {
    fail?: boolean;
    build?: ConchBuild;
    conch?: Partial<ConchCheckout>;
    releases?: Partial<ReleaseFollower>;
  } = {},
) {
  const home = await mkdtemp(join(tmpdir(), 'conch-updates-'));
  homes.push(home);
  const file = join(home, 'versions.json');
  await writeFile(file, JSON.stringify({ codex: '0.159.0', uv: '0.8.3', gone: undefined }));
  const read = async () => JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
  const script = (id: string, to: string) =>
    options.fail
      ? "console.error('InternetOpenUrl() failed. 0x80072ee7'); process.exitCode = 1;"
      : `const fs=require('fs');const f=${JSON.stringify(file)};const v=JSON.parse(fs.readFileSync(f,'utf8'));
         console.log('  12.0 MB / 24.0 MB');
         setTimeout(()=>{v[${JSON.stringify(id)}]=${JSON.stringify(to)};fs.writeFileSync(f,JSON.stringify(v));},300);`;
  const spec = (id: string, short: string, latest: string): NeedSpec => ({
    id,
    name: short,
    short,
    find: async () => ((await read())[id] ? `/bin/${id}` : undefined),
    version: async () => (await read())[id],
    latest: async () => latest,
    update: () => [{ manager: 'npm', args: ['-e', script(id, latest)] }],
    download: { win32: `https://example.com/${id}` },
  });
  const specs = new Map(
    [
      spec('codex', 'Codex', '0.160.0'),
      spec('uv', 'uv', '0.8.3'),
      spec('gone', 'Gone', '1.0.0'),
      // Can't say its version: never listed.
      { id: 'docker', name: 'Docker', short: 'Docker', find: async () => '/bin/docker' },
    ].map((s) => [s.id, s] as const),
  );
  const setup = new Setup(specs, {
    platform: 'win32',
    manager: () => Promise.resolve(process.execPath),
  });
  const seen: UpdatesStatus[] = [];
  const healed: string[] = [];
  const landed: string[] = [];
  let busy = false;
  let now = new Date(2026, 8, 30, 14, 0).getTime();
  const restart = vi.fn(() => true);
  // Pausing for the restart: what was working stops, and is no longer busy.
  const pause = vi.fn(async () => {
    busy = false;
    return 1;
  });
  const unpause = vi.fn();
  const announced: string[] = [];
  const service = new UpdatesService({
    home,
    setup,
    specs,
    lookup,
    conch: options.conch as ConchCheckout | undefined,
    releases: options.releases as ReleaseFollower | undefined,
    announce: (version) => announced.push(version),
    version: '0.2.0',
    build: options.build,
    bootId: 'boot-1',
    emit: (status) => seen.push(status),
    heal: (message) => healed.push(message),
    busy: () => busy,
    working: () => (busy ? [{ id: 'chat-1', title: 'Fix Conch CI failures' }] : []),
    pause,
    unpause,
    idleCheckMs: 10,
    landed: async (id) => void landed.push(id),
    restartable: () => true,
    restart,
    schedule: false,
    now: () => now,
    random: () => 0.5,
    restartDelayMs: 0,
  });
  return {
    home,
    service,
    seen,
    healed,
    landed,
    restart,
    pause,
    unpause,
    read,
    announced,
    setBusy: (b: boolean) => (busy = b),
    at: (t: number) => (now = t),
    now: () => now,
  };
}

describe('looking for updates', () => {
  it('lists each program that can say its version, with what’s newer', async () => {
    const { service, seen } = await world();
    await service.check();
    const status = await service.status();
    expect(status.checking).toBe(false);
    expect(status.programs).toEqual([
      expect.objectContaining({
        id: 'codex',
        name: 'Codex',
        installed: '0.159.0',
        latest: '0.160.0',
        available: true,
        canUpdate: true,
        state: 'idle',
      }),
      expect.objectContaining({ id: 'uv', installed: '0.8.3', available: false }),
    ]);
    // It told the page it was looking, then what it found.
    expect(seen.some((s) => s.checking)).toBe(true);
    expect(seen.at(-1)?.checking).toBe(false);
  });

  it('remembers what it found across restarts, and the last answer stands when a lookup fails', async () => {
    const first = await world();
    await first.service.check();
    const again = new UpdatesService({
      ...(first.service as unknown as { deps: ConstructorParameters<typeof UpdatesService>[0] })
        .deps,
      lookup: { ...lookup, npm: async () => undefined },
    });
    expect((await again.status()).programs.map((p) => p.id)).toEqual(['codex', 'uv']);
    await again.check();
    expect((await again.status()).programs[0]).toMatchObject({
      latest: '0.160.0',
      available: true,
    });
    expect(JSON.parse(await readFile(join(first.home, 'updates.json'), 'utf8'))).toMatchObject({
      programs: { codex: { installed: '0.159.0', latest: '0.160.0' } },
    });
  });

  it('heals a damaged list by starting it again, and says so quietly', async () => {
    const { service, home, healed } = await world();
    await writeFile(join(home, 'updates.json'), '{ not json');
    expect((await service.status()).programs).toEqual([]);
    expect(healed).toEqual(['Started the list of updates afresh']);
  });

  it('looks once a day by itself, never in the first minute', async () => {
    const { service, at, now } = await world();
    const check = vi.spyOn(service, 'check');
    const start = now();
    service.start();
    service.stop();
    await service.tick(start + 30_000);
    expect(check).not.toHaveBeenCalled();
    await service.tick(start + 7 * MINUTE);
    expect(check).toHaveBeenCalledTimes(1);
    at(start + 7 * MINUTE);
    await service.tick(start + 8 * MINUTE);
    await service.tick(start + DAY - 2 * MINUTE);
    expect(check).toHaveBeenCalledTimes(1);
    await service.tick(start + DAY + 8 * MINUTE);
    expect(check).toHaveBeenCalledTimes(2);
  });
});

describe('updating programs', () => {
  it('updates one with its progress, reads the new version, and lets its users know', async () => {
    const { service, seen, landed, healed } = await world();
    await service.check();
    await service.updateProgram('codex');
    await service.settled();
    const codex = (await service.status()).programs[0];
    expect(codex).toMatchObject({
      installed: '0.160.0',
      available: false,
      state: 'idle',
      updated: { from: '0.159.0' },
    });
    expect(codex?.problem).toBeUndefined();
    expect(seen.some((s) => s.programs[0]?.state === 'updating')).toBe(true);
    expect(landed).toEqual(['codex']);
    // A manual update is its own success line, not a "fixed on its own" note.
    expect(healed).toEqual([]);
  });

  it('says why an update didn’t work, in plain words', async () => {
    const { service } = await world({ fail: true });
    await service.check();
    await service.updateProgram('codex');
    await service.settled();
    expect((await service.status()).programs[0]).toMatchObject({
      installed: '0.159.0',
      available: true,
      state: 'idle',
      problem: 'Couldn’t download Codex: the internet seems to be unreachable.',
    });
  });

  it('runs one at a time, however many are asked for', async () => {
    const { service, seen } = await world();
    await service.check();
    await Promise.all([service.updateProgram('codex'), service.updateProgram('codex')]);
    await service.updateAll();
    await service.settled();
    expect(seen.some((s) => s.programs.filter((p) => p.state === 'updating').length > 1)).toBe(
      false,
    );
    await expect(service.updateProgram('docker')).rejects.toThrow(/Nothing like that/);
    await expect(service.updateProgram('../../x')).rejects.toThrow(/Nothing like that/);
  });

  it('updates by itself only at night, when nothing is running, and says so quietly', async () => {
    const { service, healed, at, setBusy } = await world();
    await service.check();
    const afternoon = new Date(2026, 8, 30, 15, 0).getTime();
    const night = new Date(2026, 9, 1, 3, 0).getTime();
    await service.setAuto(true);
    at(afternoon);
    await service.tick(afternoon);
    await service.settled();
    expect((await service.status()).programs[0]?.installed).toBe('0.159.0');
    setBusy(true);
    at(night);
    await service.tick(night);
    await service.settled();
    expect((await service.status()).programs[0]?.installed).toBe('0.159.0');
    setBusy(false);
    await service.tick(night + 5 * MINUTE);
    await service.settled();
    expect((await service.status()).programs[0]?.installed).toBe('0.160.0');
    expect(healed).toEqual(['Updated Codex to 0.160.0 overnight']);
  });

  it('doesn’t retry a failing automatic update every night', async () => {
    const { service, seen } = await world({ fail: true });
    await service.check();
    await service.setAuto(true);
    const night = new Date(2026, 9, 1, 3, 0).getTime();
    await service.tick(night);
    await service.settled();
    const tries = seen.filter((s) => s.programs[0]?.state === 'updating').length;
    await service.tick(night + 5 * MINUTE);
    await service.settled();
    expect(seen.filter((s) => s.programs[0]?.state === 'updating').length).toBe(tries);
  });
});

describe('updating Conch itself', () => {
  const check = (patch: Partial<ConchCheck> = {}): ConchCheck => ({
    head: 'a'.repeat(40),
    branch: 'main',
    behind: 12,
    ahead: 0,
    improvements: 9,
    whatsNew: ['Attach files to a message'],
    fetched: true,
    ...patch,
  });
  const fake = (result: ConchResult, found = check()): Partial<ConchCheckout> => ({
    head: async () => 'a'.repeat(40),
    check: async () => found,
    update: async (onProgress: (p: UpdateProgressReport) => void) => {
      onProgress({ phase: 'install', label: 'Installing', step: 2, steps: 3, percent: 40 });
      return result;
    },
  });

  it('looks for a new Conch every quarter hour, and when a page comes back to an old look', async () => {
    let looks = 0;
    let behind = 0;
    const { service, at, now, seen } = await world({
      conch: {
        head: async () => 'a'.repeat(40),
        check: async ({ fetch }) => {
          if (fetch) looks += 1;
          return check({ behind, improvements: behind });
        },
      },
    });
    const start = now();
    service.start();
    service.stop();
    // The daily look (programs too) comes first, then Conch alone, every quarter hour.
    at(start + 7 * MINUTE);
    await service.tick();
    expect(looks).toBe(1);
    at(start + 15 * MINUTE);
    await service.tick();
    expect(looks).toBe(1);
    behind = 3;
    at(start + 23 * MINUTE);
    await service.tick();
    expect(looks).toBe(2);
    // What it found reaches every page at once.
    expect(seen.at(-1)?.conch.behind).toBe(3);
    // A page coming back: a look only when the last one is older than asked.
    await service.lookConch({ ifOlderThan: 5 * MINUTE });
    expect(looks).toBe(2);
    at(start + 29 * MINUTE);
    await Promise.all([
      service.lookConch({ ifOlderThan: 5 * MINUTE }),
      service.lookConch({ ifOlderThan: 5 * MINUTE }),
    ]);
    expect(looks).toBe(3);
  });

  it('says how many improvements are waiting, and what’s new', async () => {
    const { service } = await world({ conch: fake({ kind: 'current' }) });
    await service.check();
    expect((await service.status()).conch).toMatchObject({
      checkable: true,
      version: '0.2.0',
      commit: 'aaaaaaa',
      behind: 12,
      improvements: 9,
      whatsNew: ['Attach files to a message'],
      restartNeeded: false,
    });
  });

  it('shows real progress, then starts itself again on the new version', async () => {
    const to = 'b'.repeat(40);
    const { service, seen, restart } = await world({
      conch: fake({ kind: 'updated', from: 'a'.repeat(40), to, improvements: 9, whatsNew: ['X'] }),
    });
    service.start();
    service.stop();
    await service.check();
    await service.updateConch();
    await vi.waitFor(() => expect(restart).toHaveBeenCalled());
    const phases = seen.map((s) => s.conch.running?.phase).filter(Boolean);
    expect(phases).toEqual(expect.arrayContaining(['fetch', 'install', 'restart']));
    const restarting = seen.find((s) => s.conch.running?.phase === 'restart');
    expect(restarting?.conch.running?.label).toBe('Updating Conch…');
    expect(restarting?.bootId).toBe('boot-1');
    expect((await service.status()).conch).toMatchObject({
      behind: 0,
      outcome: { kind: 'updated', whatsNew: ['X'] },
    });
  });

  it('says to restart by hand when it can’t start itself again', async () => {
    const to = 'b'.repeat(40);
    const w = await world({
      conch: fake({ kind: 'updated', from: 'a'.repeat(40), to, improvements: 1, whatsNew: [] }),
    });
    const service = new UpdatesService({
      ...(w.service as unknown as { deps: ConstructorParameters<typeof UpdatesService>[0] }).deps,
      restartable: () => false,
    });
    service.start();
    service.stop();
    await vi.waitFor(async () => expect((await service.status()).conch.commit).toBe('aaaaaaa'));
    await service.updateConch();
    await vi.waitFor(async () => expect((await service.status()).conch.restartNeeded).toBe(true));
    expect((await service.status()).conch.running).toBeUndefined();
    expect(w.restart).not.toHaveBeenCalled();
  });

  it('says in one sentence when it went back to the version you had', async () => {
    const message =
      'The update didn’t install (the new version wouldn’t build), so Conch went back to the version you had.';
    const { service } = await world({ conch: fake({ kind: 'rolled-back', message }) });
    await service.updateConch();
    await vi.waitFor(async () =>
      expect((await service.status()).conch.outcome).toMatchObject({
        kind: 'rolled-back',
        message,
      }),
    );
    expect((await service.status()).conch.running).toBeUndefined();
  });

  it('asks first while a chat is working, naming it', async () => {
    const { service, setBusy, pause } = await world({ conch: fake({ kind: 'current' }) });
    setBusy(true);
    await expect(service.updateConch()).rejects.toMatchObject({
      code: 'busy',
      message: expect.stringMatching(/^Fix Conch CI failures is working\. Update anyway/),
    });
    // The page names it before anyone presses, too.
    expect((await service.status()).working).toEqual([
      { id: 'chat-1', title: 'Fix Conch CI failures' },
    ]);
    expect((await service.status()).conch.running).toBeUndefined();
    expect(pause).not.toHaveBeenCalled();
  });

  it('updates anyway when asked: what’s working pauses at a safe point just before the restart', async () => {
    const to = 'b'.repeat(40);
    const { service, seen, restart, pause, setBusy } = await world({
      conch: fake({ kind: 'updated', from: 'a'.repeat(40), to, improvements: 1, whatsNew: ['X'] }),
    });
    service.start();
    service.stop();
    await service.check();
    setBusy(true);
    await service.updateConch('anyway');
    await vi.waitFor(() => expect(restart).toHaveBeenCalled());
    // Paused once, before the restart, and the page said so while it did.
    expect(pause).toHaveBeenCalledTimes(1);
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(
      restart.mock.invocationCallOrder[0] ?? 0,
    );
    expect(seen.map((s) => s.conch.running?.label)).toContain(
      'Pausing Fix Conch CI failures at a safe point',
    );
  });

  it('lets what was paused go on when the restart doesn’t happen', async () => {
    const to = 'b'.repeat(40);
    const w = await world({
      conch: fake({ kind: 'updated', from: 'a'.repeat(40), to, improvements: 1, whatsNew: [] }),
    });
    w.restart.mockReturnValue(false);
    w.service.start();
    w.service.stop();
    await w.service.check();
    w.setBusy(true);
    await w.service.updateConch('anyway');
    await vi.waitFor(() => expect(w.unpause).toHaveBeenCalled());
  });

  it('waits until it’s done when asked, then updates by itself', async () => {
    const to = 'b'.repeat(40);
    const { service, setBusy, restart, pause } = await world({
      conch: fake({ kind: 'updated', from: 'a'.repeat(40), to, improvements: 1, whatsNew: [] }),
    });
    await service.check();
    setBusy(true);
    await service.updateConch('idle');
    const armed = await service.status();
    expect(armed.conch.armed).toEqual({ at: expect.any(Number) });
    expect(armed.conch.running).toBeUndefined();
    // Still working: it keeps waiting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(restart).not.toHaveBeenCalled();
    // It finished: the update goes, with nothing to pause.
    setBusy(false);
    await vi.waitFor(() => expect(restart).toHaveBeenCalled());
    expect(pause).not.toHaveBeenCalled();
    expect((await service.status()).conch.armed).toBeUndefined();
    service.stop();
  });

  it('stops waiting when asked, and remembers the wait across a restart', async () => {
    const { service, setBusy, home } = await world({ conch: fake({ kind: 'current' }) });
    await service.check();
    setBusy(true);
    await service.updateConch('idle');
    // The next Conch reads the same file: still armed.
    const saved = JSON.parse(await readFile(join(home, 'updates.json'), 'utf8')) as {
      armed?: unknown;
    };
    expect(saved.armed).toEqual({ at: expect.any(Number) });
    await service.updateConch('cancel');
    expect((await service.status()).conch.armed).toBeUndefined();
    service.stop();
  });

  it('says so when Conch doesn’t run from a folder it can update', async () => {
    const { service } = await world();
    expect((await service.status()).conch).toMatchObject({ checkable: false });
    await expect(service.updateConch()).rejects.toThrow(/isn’t running from a folder/);
  });
});

describe('Repair everything’s look at updates', () => {
  it('lists what’s waiting, each with its one action, and never updates Conch itself', async () => {
    const { service, home } = await world({
      conch: {
        head: async () => 'a'.repeat(40),
        check: async () => ({
          head: 'a'.repeat(40),
          behind: 3,
          ahead: 0,
          improvements: 2,
          whatsNew: [],
          fetched: true,
        }),
        update: vi.fn(),
      },
    });
    const doctor = updatesCheck(service, home);
    await service.check();
    const items = await doctor.run({ repair: true, signal: new AbortController().signal });
    expect(items).toEqual([
      expect.objectContaining({
        id: 'updates:conch',
        state: 'warning',
        message: 'Conch has an update: 2 improvements.',
        action: { kind: 'open', label: 'See what’s new', place: 'health' },
      }),
      expect.objectContaining({
        id: 'updates:codex',
        state: 'warning',
        message: 'Codex 0.160 is out (you have 0.159).',
        action: { kind: 'need', label: 'Update Codex', need: 'codex', mode: 'update' },
      }),
    ]);
  });

  it('says all is well once it has looked and nothing waits', async () => {
    const { service, home } = await world();
    const doctor = updatesCheck(service, home);
    expect(await doctor.run({ repair: false, signal: new AbortController().signal })).toEqual([]);
    await service.updateProgram('codex').catch(() => undefined);
    await service.check();
    await service.updateProgram('codex');
    await service.settled();
    expect(await doctor.run({ repair: false, signal: new AbortController().signal })).toEqual([
      expect.objectContaining({ id: 'updates:current', state: 'ok' }),
    ]);
  });
});

/** A release, as the follower offers it. */
const offer = (version: string, line: string): Offer => ({
  version,
  channel: version.includes('beta') ? 'beta' : 'stable',
  tag: `v${version}`,
  object: 'b'.repeat(40),
  commit: 'c'.repeat(40),
  notes: { version, channel: 'stable', headsUp: [], new: [line], better: [], fixed: [] },
});

describe('following releases (ADR 0051)', () => {
  /** Conch on a release, with a pretend follower whose answers the test sets. */
  async function releaseWorld(found: Partial<ReleaseCheck>, staged?: StagedResult) {
    const checks: { channel?: string }[] = [];
    const stage = vi.fn(async () => staged ?? ({ kind: 'failed', message: 'no' } as StagedResult));
    const w = await world({
      conch: {
        head: async () => 'a'.repeat(40),
        check: async (): Promise<ConchCheck> => ({
          head: 'a'.repeat(40),
          behind: 0,
          ahead: 0,
          improvements: 0,
          whatsNew: [],
          fetched: false,
        }),
      },
      releases: {
        root: '/conch/versions/0.2.0',
        version: () => '0.2.0',
        installedChannel: async () => undefined,
        waiting: () => undefined,
        prune: async () => [],
        check: async (options) => {
          checks.push(options);
          return {
            source: 'releases',
            current: '0.2.0',
            offers: [],
            fetched: true,
            anyReleases: true,
            ...found,
          };
        },
        stage,
      },
    });
    return { ...w, checks, stage };
  }

  it('offers the newest release with its notes, announces it once, and calls it news in Repair', async () => {
    const w = await releaseWorld({
      offers: [offer('0.4.0', 'Talk to it'), offer('0.3.0', 'Edit by hand')],
    });
    await w.service.check();
    await w.service.check();
    const { conch } = await w.service.status();
    expect(conch).toMatchObject({
      source: 'releases',
      version: '0.2.0',
      latest: { version: '0.4.0', channel: 'stable' },
      behind: 2,
      announce: true,
      whatsNew: ['Talk to it'],
    });
    expect(conch.releases.map((r) => r.version)).toEqual(['0.4.0', '0.3.0']);
    expect(w.announced).toEqual(['0.4.0']);
    const items = await updatesCheck(w.service, w.home).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(items[0]).toMatchObject({
      id: 'updates:conch',
      state: 'info',
      message: 'Conch 0.4 is ready.',
    });
    // Put away: not shown again for this version.
    await w.service.setSettings({ dismiss: '0.4.0' });
    expect((await w.service.status()).conch.announce).toBe(false);
  });

  it('follows the channel chosen, and says a refused release in a sentence', async () => {
    const w = await releaseWorld({
      refused: 'Conch 0.3.1 isn’t signed, so Conch won’t install it.',
    });
    await w.service.check();
    await w.service.setSettings({ channel: 'beta' });
    expect(w.checks.at(-1)?.channel).toBe('beta');
    const status = await w.service.status();
    expect(status.conch).toMatchObject({
      channel: 'beta',
      refused: 'Conch 0.3.1 isn’t signed, so Conch won’t install it.',
    });
    const items = await updatesCheck(w.service, w.home).run({
      repair: false,
      signal: new AbortController().signal,
    });
    expect(items).toContainEqual(expect.objectContaining({ id: 'updates:refused', state: 'info' }));
  });

  it('a release made ready is swapped in with a restart, and says what it brought', async () => {
    const notes = [offer('0.3.0', 'Edit by hand').notes];
    const w = await releaseWorld(
      { offers: [offer('0.3.0', 'Edit by hand')] },
      { kind: 'staged', version: '0.3.0', folder: '/conch/versions/0.3.0', notes },
    );
    await w.service.check();
    await w.service.updateConch();
    await vi.waitUntil(() => w.restart.mock.calls.length > 0);
    expect(w.stage).toHaveBeenCalledOnce();
    const status = await w.service.status();
    expect(status.conch.outcome).toMatchObject({
      kind: 'updated',
      message: 'Conch was updated to 0.3.0.',
      releases: notes,
    });
    expect(status.conch.running?.phase).toBe('restart');
  });

  it('a release that couldn’t be made ready leaves the version you have, and says so', async () => {
    const w = await releaseWorld(
      { offers: [offer('0.3.0', 'Edit by hand')] },
      {
        kind: 'failed',
        message:
          'The update didn’t install (the new version wouldn’t build), so Conch kept the version you have. Nothing of yours changed.',
      },
    );
    await w.service.check();
    await w.service.updateConch();
    await vi.waitUntil(async () => !(await w.service.status()).conch.running);
    expect((await w.service.status()).conch.outcome).toMatchObject({
      kind: 'rolled-back',
      message: expect.stringMatching(/kept the version you have/),
    });
    expect(w.restart).not.toHaveBeenCalled();
  });

  it('says once that the supervisor went back by itself, and offers going back by hand', async () => {
    const w = await releaseWorld({});
    writeState(w.home, {
      current: { folder: '/conch/versions/0.2.0', version: '0.2.0' },
      previous: { folder: '/conch', version: '0.1.0' },
      failed: ['0.3.0'],
      wentBack: { version: '0.3.0', to: '0.2.0', at: w.now() },
    });
    w.service.start();
    await vi.waitUntil(async () => Boolean((await w.service.status()).conch.outcome));
    const { conch } = await w.service.status();
    expect(conch.outcome?.message).toBe(
      'Conch 0.3.0 didn’t start properly, so Conch went back to 0.2.0 by itself. It won’t offer 0.3.0 again; the next release will be.',
    );
    expect(conch.failed).toEqual(['0.3.0']);
    expect(conch.previous).toBe('0.1.0');
    expect(readState(w.home).wentBack).toBeUndefined();
    await w.service.goBack();
    await vi.waitUntil(() => w.restart.mock.calls.length > 0);
    const state = readState(w.home);
    expect(state.pending).toMatchObject({ version: '0.1.0', from: { version: '0.2.0' } });
    expect(state.failed).toEqual(['0.3.0', '0.2.0']);
    w.service.stop();
  });

  it('a copy of main that now follows releases hears it once', async () => {
    const w = await releaseWorld({});
    const onMain = await world({
      conch: {
        head: async () => 'a'.repeat(40),
        check: async (): Promise<ConchCheck> => ({
          head: 'a'.repeat(40),
          branch: 'main',
          behind: 0,
          ahead: 0,
          improvements: 0,
          whatsNew: [],
          fetched: false,
        }),
      },
      releases: {
        root: '/conch',
        version: () => '0.3.0',
        installedChannel: async () => undefined,
        waiting: () => undefined,
        check: async () => ({
          source: 'releases',
          current: '0.3.0',
          offers: [],
          fetched: true,
          anyReleases: true,
        }),
      },
    });
    await onMain.service.check();
    expect((await onMain.service.status()).conch.notice).toMatchObject({
      id: 'releases',
      message: expect.stringMatching(/^Conch now follows its releases instead of every change/),
    });
    await onMain.service.setSettings({ dismissNotice: 'releases' });
    expect((await onMain.service.status()).conch.notice).toBeUndefined();
    // Installed from a release: nothing to say.
    await w.service.check();
    expect((await w.service.status()).conch.notice).toBeUndefined();
  });
});

it('keeps the running build identity separate from the base version and update channel', async () => {
  const build = { kind: 'release', version: '0.1.0-beta.2', channel: 'beta' } as const;
  const { service } = await world({ build });
  expect((await service.status()).conch).toMatchObject({
    build,
    channel: 'stable',
    version: '0.2.0',
  });
  service.stop();
});
