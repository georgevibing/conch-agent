/**
 * `conch routines` (ADR 0154): list, pause with a reason, resume, export, both
 * through the running Conch's folder and with none running.
 */
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RoutineExport } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { captureUi } from '../cli/ui';
import { routinesCommand, type RoutinesIo } from './cli';
import { RoutineService } from './service';
import { RoutineStore } from './store';
import { answerAsk, askRunning, RoutineAsks, routineAsksDir } from './terminal';

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

async function setup({ running = false } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'conch-routines-cli-'));
  const events: string[] = [];
  const routines = new RoutineService({
    store: new RoutineStore(join(home, 'routines')),
    conversations: undefined as never,
    engine: () => undefined as never,
    emit: (event) => void events.push(event.type),
  });
  const fitness = await routines.create(
    {
      title: 'Weekly fitness recap',
      summary: 'Your week of workouts.',
      prompt: 'Summarise my workouts. Send it to the user with message_user (Telegram).',
      schedule: { type: 'weekly', days: ['sun'], time: '19:00' },
      timezone: 'Europe/Berlin',
    },
    { createdBy: 'user' },
  );
  const wealth = await routines.create(
    {
      title: 'Monthly wealth check-in',
      summary: 'Where your money stands.',
      prompt: 'Read ~/Finance/accounts.csv and summarise.',
      schedule: { type: 'monthly', day: 1, time: '09:00' },
      timezone: 'Europe/Berlin',
    },
    { createdBy: 'user' },
  );
  const draft = await routines.create(
    {
      title: 'Plant watering',
      summary: '',
      prompt: 'Remind me to water the plants.',
      schedule: { type: 'daily', time: '18:00' },
      timezone: 'UTC',
      status: 'draft',
    },
    { createdBy: 'agent' },
  );
  if (running) stops.push(new RoutineAsks({ home, routines }).watch());
  const { ui, text } = captureUi();
  const printed: string[] = [];
  const io: RoutinesIo = {
    ui,
    print: (t) => void printed.push(t),
    conch: (args) => `conch ${args}`,
    ask: async (ask) =>
      running
        ? ((await askRunning(home, ask)) ?? { ok: false, error: 'no answer' })
        : answerAsk(routines, ask),
  };
  const lines = () =>
    text()
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.replace(/^ {2}/, ''));
  return { home, routines, io, lines, printed, fitness, wealth, draft, events };
}

describe('conch routines', () => {
  it('lists each routine with its schedule, next run and status', async () => {
    const { io, lines, fitness } = await setup();
    expect(await routinesCommand([], io)).toBe(0);
    const said = lines().join('\n');
    expect(said).toContain('Weekly fitness recap');
    expect(said).toContain(fitness.id);
    expect(said).toMatch(/Every Sunday at 7:00 PM \(Europe\/Berlin\), next Sun .* · on/);
    expect(said).toContain('Plant watering');
    expect(said).toContain('not turned on yet');
  });

  it('lists as JSON for programs', async () => {
    const { io, printed, wealth } = await setup();
    expect(await routinesCommand(['list', '--json'], io)).toBe(0);
    const list = JSON.parse(printed.join('')) as {
      id: string;
      status: string;
      nextRunAt?: string;
    }[];
    expect(list.find((r) => r.id === wealth.id)).toMatchObject({
      name: 'Monthly wealth check-in',
      timezone: 'Europe/Berlin',
      status: 'active',
      nextRunAt: expect.stringMatching(/T08:00:00\.000Z$/),
    });
  });

  it('pauses by name with a reason the Routines page shows, and resumes by id', async () => {
    const { io, lines, routines, fitness } = await setup();
    expect(
      await routinesCommand(['pause', 'weekly', 'fitness', '--reason', 'moved to Hermes'], io),
    ).toBe(0);
    expect(lines()[0]).toBe('✓ Paused “Weekly fitness recap”: Moved to Hermes.');
    const paused = (await routines.detail(fitness.id)).routine;
    expect(paused.status).toBe('paused');
    expect(paused.pausedBecause).toMatchObject({ reason: 'Moved to Hermes', by: 'terminal' });
    expect(paused.nextRunAt).toBeUndefined();
    expect(await routinesCommand(['resume', fitness.id], io)).toBe(0);
    const back = (await routines.detail(fitness.id)).routine;
    expect(back.status).toBe('active');
    // Turned back on, the reason goes.
    expect(back.pausedBecause).toBeUndefined();
  });

  it('says which it means when a name fits more than one, and changes nothing', async () => {
    const { io, lines, routines } = await setup();
    expect(await routinesCommand(['pause', 'month'], io)).toBe(0);
    expect(await routinesCommand(['pause', 'xyz'], io)).toBe(1);
    expect(lines().some((l) => l.includes('No routine is called “xyz”'))).toBe(true);
    await routines.create(
      {
        title: 'Monthly review',
        summary: '',
        prompt: 'Review.',
        schedule: { type: 'monthly', day: 2, time: '09:00' },
        timezone: 'UTC',
      },
      { createdBy: 'user' },
    );
    expect(await routinesCommand(['resume', 'monthly'], io)).toBe(1);
    expect(lines().some((l) => l.includes('fits more than one routine'))).toBe(true);
  });

  it('never turns on a draft: that’s for its card in Conch', async () => {
    const { io, lines, routines, draft } = await setup();
    expect(await routinesCommand(['resume', 'Plant watering'], io)).toBe(1);
    expect(lines().join('\n')).toContain('press Turn on on its card in Conch');
    expect((await routines.detail(draft.id)).routine.status).toBe('draft');
  });

  it('exports everything another agent needs, as JSON or Markdown', async () => {
    const { io, printed, fitness } = await setup();
    expect(await routinesCommand(['export', '--json'], io)).toBe(0);
    const doc = RoutineExport.parse(JSON.parse(printed.join('')));
    expect(doc.routines).toHaveLength(3);
    expect(doc.routines.find((r) => r.id === fitness.id)).toMatchObject({
      schedule: { timezone: 'Europe/Berlin', cron: '0 19 * * 0' },
      delivery: { channels: ['telegram'] },
    });
    printed.length = 0;
    expect(await routinesCommand(['export', 'Monthly wealth check-in'], io)).toBe(0);
    expect(printed.join('')).toContain('## Monthly wealth check-in');
    expect(printed.join('')).toContain('Files: ~/Finance/accounts.csv');
  });

  it('asks the running Conch through a folder only this account can use', async () => {
    const { io, lines, routines, wealth, home, events } = await setup({ running: true });
    expect(await routinesCommand(['pause', wealth.id, '--reason', 'moved to Hermes'], io)).toBe(0);
    expect(lines()[0]).toContain('Paused “Monthly wealth check-in”');
    // The running Conch changed it, so the Routines page heard at once.
    expect((await routines.detail(wealth.id)).routine.status).toBe('paused');
    expect(events).toContain('routine.changed');
    // Nothing left behind, and the folder is private.
    expect(await readdir(routineAsksDir(home))).toEqual([]);
    if (process.platform !== 'win32')
      expect((await stat(routineAsksDir(home))).mode & 0o777).toBe(0o700);
  });

  it('says when no Conch answers, rather than waiting for ever', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-routines-none-'));
    expect(await askRunning(home, { op: 'list' }, 200)).toBeUndefined();
  });
});
