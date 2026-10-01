import type { DoctorItem, DoctorReport } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { Doctor, type DoctorCheck } from './service';

const item = (id: string, state: DoctorItem['state'], message = 'Fine.'): DoctorItem => ({
  id,
  group: 'Test',
  title: id,
  state,
  message,
});

const check = (id: string, run: DoctorCheck['run']): DoctorCheck => ({
  id,
  group: 'Test',
  title: `The ${id}`,
  run,
});

describe('Repair everything', () => {
  it('looks at every part at once, filling the report in as each answers', async () => {
    const seen: DoctorReport[] = [];
    const doctor = new Doctor({ emit: (r) => seen.push(r) });
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    doctor.register(check('fast', async () => [item('fast:1', 'ok')]));
    doctor.register(
      check('slow', async () => {
        await slow;
        return [item('slow:1', 'ok')];
      }),
    );
    const done = doctor.run();
    await vi.waitFor(() =>
      expect(seen.at(-1)?.items.map((i) => i.state)).toEqual(['ok', 'checking']),
    );
    release();
    const report = await done;
    expect(report).toMatchObject({ running: false, repaired: false });
    expect(report.items.map((i) => i.id)).toEqual(['fast:1', 'slow:1']);
    expect(report.checkedAt).toBeGreaterThan(0);
  });

  it('asks checks to repair, and notes what they fixed', async () => {
    const notes: string[] = [];
    const doctor = new Doctor({ emit: () => undefined, onHeal: (m) => notes.push(m) });
    doctor.register(
      check('search', async ({ repair }) => [
        repair ? item('search:index', 'fixed', 'Rebuilt it.') : item('search:index', 'warning'),
      ]),
    );
    expect((await doctor.run()).items[0]?.state).toBe('warning');
    expect((await doctor.run({ repair: true })).items[0]?.state).toBe('fixed');
    expect(notes).toEqual(['search:index: Rebuilt it.']);
  });

  it('says so when a part won’t answer, and carries on with the rest', async () => {
    const doctor = new Doctor({ emit: () => undefined, timeoutMs: 50 });
    doctor.register(check('stuck', () => new Promise(() => undefined)));
    doctor.register(
      check('broken', async () => {
        throw new Error('boom');
      }),
    );
    doctor.register(check('fine', async () => [item('fine:1', 'ok')]));
    const report = await doctor.run();
    expect(report.items.map((i) => [i.id, i.state])).toEqual([
      ['stuck:unchecked', 'warning'],
      ['broken:unchecked', 'warning'],
      ['fine:1', 'ok'],
    ]);
    expect(report.items[0]?.message).toMatch(/didn’t answer in time/);
  });

  it('runs one look at a time, and a repair asked for during a look right after it', async () => {
    const runs: boolean[] = [];
    const doctor = new Doctor({ emit: () => undefined });
    doctor.register(
      check('x', async ({ repair }) => {
        runs.push(repair);
        await new Promise((r) => setTimeout(r, 20));
        return [];
      }),
    );
    await Promise.all([doctor.run(), doctor.run(), doctor.run({ repair: true })]);
    expect(runs).toEqual([false, true]);
  });
});

describe('one check again', () => {
  it('corrects that check’s lines in the report, and leaves the rest', async () => {
    const { Doctor } = await import('./service');
    let locked = true;
    const reports: { items: { id: string; state: string }[] }[] = [];
    const doctor = new Doctor({ emit: (r) => reports.push(r) } as ConstructorParameters<
      typeof Doctor
    >[0]);
    doctor.register({
      id: 'passwords',
      group: 'data',
      title: 'Passwords',
      run: async () => [
        {
          id: 'passwords:keepassxc',
          group: 'data',
          title: 'KeePassXC',
          state: locked ? 'needs-you' : 'ok',
          message: '',
        },
      ],
    } as never);
    doctor.register({
      id: 'other',
      group: 'data',
      title: 'Other',
      run: async () => [{ id: 'other', group: 'data', title: 'Other', state: 'ok', message: '' }],
    } as never);
    await doctor.refresh('passwords');
    expect(reports).toHaveLength(0);
    await doctor.run();
    locked = false;
    await doctor.refresh('passwords');
    expect(doctor.report.items.map((i) => [i.id, i.state])).toEqual([
      ['passwords:keepassxc', 'ok'],
      ['other', 'ok'],
    ]);
  });
});
