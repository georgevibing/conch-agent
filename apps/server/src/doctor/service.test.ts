import type { DoctorItem, DoctorReport } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { Doctor, settle, type DoctorCheck } from './service';

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
        repair
          ? item('search:index', 'fixed', 'Rebuilt it.')
          : { ...item('search:index', 'warning'), repairable: true },
      ]),
    );
    expect((await doctor.run()).items[0]?.state).toBe('warning');
    expect((await doctor.run({ repair: true })).items[0]?.state).toBe('fixed');
    expect(notes).toEqual(['search:index: Rebuilt it.']);
  });

  it('says so when a part won’t answer, and carries on with the rest', async () => {
    const doctor = new Doctor({ emit: () => undefined, timeoutMs: 50, warn: () => undefined });
    doctor.register(check('stuck', () => new Promise(() => undefined)));
    doctor.register(
      check('broken', async () => {
        throw new Error('boom');
      }),
    );
    doctor.register(check('fine', async () => [item('fine:1', 'ok')]));
    const report = await doctor.run();
    expect(report.items.map((i) => [i.id, i.state])).toEqual([
      ['stuck:unchecked', 'info'],
      ['broken:unchecked', 'info'],
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

describe('nothing worth a look without something to do about it', () => {
  const open = { kind: 'open', label: 'Open', place: 'health' } as const;

  it('shows a warning or a needs-you with no action as news, and says so once', async () => {
    const told: string[] = [];
    const doctor = new Doctor({ emit: () => undefined, warn: (m) => told.push(m) });
    doctor.register(
      check('parts', async () => [
        item('parts:bare', 'warning'),
        item('parts:person', 'needs-you'),
        { ...item('parts:open', 'warning'), action: open },
        { ...item('parts:you', 'needs-you'), action: open },
        { ...item('parts:repair', 'warning'), repairable: true },
        item('parts:news', 'info'),
        item('parts:fine', 'ok'),
      ]),
    );
    const states = (r: DoctorReport) => r.items.map((i) => [i.id, i.state]);
    expect(states(await doctor.run())).toEqual([
      ['parts:bare', 'info'],
      ['parts:person', 'info'],
      ['parts:open', 'warning'],
      ['parts:you', 'needs-you'],
      ['parts:repair', 'warning'],
      ['parts:news', 'info'],
      ['parts:fine', 'ok'],
    ]);
    await doctor.run();
    expect(told).toHaveLength(2);
    expect(told[0]).toMatch(/parts:bare/);
  });

  it('leaves nothing for Repair to do after a repair: what it couldn’t fix is news', async () => {
    const doctor = new Doctor({ emit: () => undefined, warn: () => undefined });
    doctor.register(
      check('parts', async () => [
        { ...item('parts:repair', 'warning'), repairable: true },
        { ...item('parts:open', 'warning'), action: open, repairable: true },
      ]),
    );
    const report = await doctor.run({ repair: true });
    expect(report.items.map((i) => [i.id, i.state, i.repairable])).toEqual([
      ['parts:repair', 'info', undefined],
      ['parts:open', 'warning', undefined],
    ]);
  });

  it('settles one item by the same rule', () => {
    expect(settle({ ...item('a', 'needs-you') }, false)).toMatchObject({
      bug: true,
      item: { state: 'info' },
    });
    expect(settle({ ...item('a', 'off'), repairable: true }, false)).toEqual({
      bug: false,
      item: item('a', 'off'),
    });
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
          action: { kind: 'open', label: 'Open Passwords', place: 'passwords' },
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
