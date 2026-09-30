import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UpdatesStatus } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type LatestLookup, type NeedSpec, Setup } from '../setup/needs';
import type { ConchCheck, ConchCheckout, ConchResult, UpdateProgressReport } from './conch';
import { updatesCheck } from './doctor';
import { DAY, MINUTE } from './schedule';
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
};

/**
 * Programs whose versions live in a JSON file; "updating" one runs Node (the
 * package manager here) with a script that moves it on — or fails.
 */
async function world(options: { fail?: boolean; conch?: Partial<ConchCheckout> } = {}) {
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
  const service = new UpdatesService({
    home,
    setup,
    specs,
    lookup,
    conch: options.conch as ConchCheckout | undefined,
    version: '0.2.0',
    bootId: 'boot-1',
    emit: (status) => seen.push(status),
    heal: (message) => healed.push(message),
    busy: () => busy,
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
    read,
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
    expect(healed).toEqual(['The list of updates couldn’t be read, so Conch started it again.']);
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
    expect(healed).toEqual(['Codex was updated to 0.160.0 overnight.']);
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

  it('won’t start while a chat is working, and says why', async () => {
    const { service, setBusy } = await world({ conch: fake({ kind: 'current' }) });
    setBusy(true);
    await expect(service.updateConch()).rejects.toThrow(/A chat is still working/);
  });

  it('says so when Conch doesn’t run from a folder it can update', async () => {
    const { service } = await world();
    expect((await service.status()).conch).toMatchObject({ checkable: false });
    await expect(service.updateConch()).rejects.toThrow(/isn’t running from a folder/);
  });
});

describe('Repair everything’s look at updates', () => {
  it('lists what’s waiting, each with its one action, and never updates Conch itself', async () => {
    const { service } = await world({
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
    const doctor = updatesCheck(service);
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
    const { service } = await world();
    const doctor = updatesCheck(service);
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
