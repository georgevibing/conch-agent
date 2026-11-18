import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ExportedRoutine, RoutineExport, type Routine } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { exportRoutine, exportRoutines, exportText } from './export';
import { RoutineService } from './service';
import { RoutineStore } from './store';

async function service() {
  const home = await mkdtemp(join(tmpdir(), 'conch-export-'));
  return new RoutineService({
    store: new RoutineStore(join(home, 'routines')),
    conversations: undefined as never,
    engine: () => undefined as never,
    emit: () => undefined,
  });
}

describe('exporting routines for another agent (ADR 0154)', () => {
  it('says what, when (with its timezone and as cron), where it goes and what it uses', async () => {
    const routines = await service();
    const made = await routines.create(
      {
        title: 'Weekly fitness recap',
        summary: 'Your week of workouts in one message.',
        prompt:
          'Read ~/Health/workouts.csv and https://example.com/plan. Summarise the week.\nSend it to the user with message_user (Telegram).',
        schedule: { type: 'weekly', days: ['mon'], time: '07:30' },
        timezone: 'Europe/Berlin',
        options: { engine: 'mock', model: 'small' },
      },
      { createdBy: 'user' },
    );
    const exported = exportRoutine(made, Date.UTC(2026, 10, 18, 12));
    expect(ExportedRoutine.parse(exported)).toEqual(exported);
    expect(exported).toMatchObject({
      id: made.id,
      name: 'Weekly fitness recap',
      prompt: made.prompt,
      status: 'active',
      schedule: {
        timezone: 'Europe/Berlin',
        structured: { type: 'weekly', days: ['mon'], time: '07:30' },
        cron: '30 7 * * 1',
      },
      delivery: { conch: true, channels: ['telegram'] },
      uses: {
        paths: ['~/Health/workouts.csv'],
        urls: ['https://example.com/plan'],
        engine: 'mock',
        model: 'small',
      },
      trust: 'ask',
      catchUp: true,
    });
    expect(exported.schedule.text).toMatch(/Monday/);
    // The next runs, in ISO, on Mondays at 07:30 Berlin time (06:30 UTC in winter).
    expect(exported.schedule.next?.[0]).toBe('2026-11-23T06:30:00.000Z');
    expect(exported.schedule.next).toHaveLength(3);
  });

  it('says no cron where cron can’t say it exactly, and no channel for a word that only mentions one', async () => {
    const routines = await service();
    const last = await routines.create(
      {
        title: 'Monthly wealth check-in',
        summary: 'Where your money stands.',
        prompt: 'Summarise my email from the bank. Add a line about the signal in the data.',
        schedule: { type: 'monthly', day: 'last', time: '18:00' },
        timezone: 'America/New_York',
      },
      { createdBy: 'user' },
    );
    const exported = exportRoutine(last);
    expect(exported.schedule.cron).toBeUndefined();
    expect(exported.delivery.channels).toEqual([]);
    const every = await routines.create(
      {
        title: 'Stretch',
        summary: 'A nudge.',
        prompt: 'Remind me to stretch. Text it to me on WhatsApp.',
        schedule: { type: 'interval', every: 2, unit: 'hours' },
        timezone: 'UTC',
      },
      { createdBy: 'user' },
    );
    const interval = exportRoutine(every);
    expect(interval.schedule.cron).toBeUndefined();
    expect(interval.delivery.channels).toEqual(['whatsapp']);
  });

  it('never carries another app’s address', () => {
    const routine = {
      id: 'r_hook',
      title: 'Shop orders',
      summary: '',
      prompt: 'Tell me about the order.',
      schedule: { type: 'once', at: '2000-01-01T00:00:00Z' },
      timezone: 'UTC',
      status: 'active',
      trust: 'ask',
      catchUp: true,
      options: {},
      createdBy: 'user',
      createdAt: 1,
      updatedAt: 1,
      scheduleText: 'When another app sends a message',
      runCount: 0,
      when: { kind: 'hook', hookId: 'a'.repeat(40) },
    } satisfies Routine;
    const exported = exportRoutine(routine);
    expect(exported.when).toEqual({ kind: 'hook' });
    expect(JSON.stringify(exported)).not.toContain('a'.repeat(40));
    expect(exported.schedule.structured).toBeUndefined();
  });

  it('wraps them in a versioned document, and reads as Markdown for people', async () => {
    const routines = await service();
    await routines.create(
      {
        title: 'Morning brief',
        summary: 'Today in a glance.',
        prompt: 'Look at my calendar.',
        schedule: { type: 'daily', time: '08:00' },
        timezone: 'UTC',
      },
      { createdBy: 'user' },
    );
    const doc = exportRoutines(await routines.list(), 0);
    expect(RoutineExport.parse(doc)).toMatchObject({
      format: 'conch.routines/1',
      exportedAt: '1970-01-01T00:00:00.000Z',
    });
    const text = exportText(doc);
    expect(text).toContain('## Morning brief');
    expect(text).toContain('cron `0 8 * * *`');
    expect(text).toContain('> Look at my calendar.');
  });
});
