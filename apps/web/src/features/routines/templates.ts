import type { CreateRoutineBody } from '@conch/protocol';
import type { z } from 'zod';

export type Template = Omit<z.input<typeof CreateRoutineBody>, 'timezone'> & { id: string };

/** Starting points written the way we want every routine to read. */
export const templates: Template[] = [
  // When… (ADR 0056): routines that start from what happens, free until it does.
  {
    id: 'meeting-brief',
    title: 'Meeting brief',
    summary: 'A short brief before each meeting: who, what it’s about, and what to bring.',
    prompt:
      'Before this meeting, write me a short brief: who I’m meeting (and anything I know about them from recent email), what it’s about, and anything I should prepare. Keep it under 120 words. If it’s a routine meeting with nothing to prepare, report nothing-to-do.',
    when: { kind: 'calendar', minutesBefore: 15, withOthers: true, words: [] },
  },
  {
    id: 'waiting-on',
    title: 'When they reply',
    summary: 'Tells you as soon as someone you’re waiting on writes back.',
    prompt:
      'Tell me in one or two lines what this email says and whether it needs an answer from me. If it’s an automatic reply or a newsletter, report nothing-to-do.',
    when: { kind: 'mail', from: [], words: [] },
  },
  {
    id: 'page-watch',
    title: 'Page watch',
    summary: 'Tells you what changed on a page you care about.',
    prompt:
      'Tell me in a sentence or two what changed on this page and whether it matters to me. If only small wording changed, report nothing-to-do.',
    when: { kind: 'page', url: '', every: 60 },
  },
  {
    id: 'task-done',
    title: 'When a big task finishes',
    summary: 'A short note when a background task is done, with what to check.',
    prompt:
      'A background task just finished. Tell me in two lines what it did and the one thing I should check. If it failed, say why and what to try next.',
    when: { kind: 'task' },
  },
  {
    id: 'briefing',
    title: 'Morning briefing',
    summary: 'A short summary of today’s calendar, weather and anything important.',
    prompt:
      'Write me a short morning briefing for today. Include the weather where I am, anything on my calendar if you can see it, and one or two things worth knowing today. Keep it under 150 words and friendly.',
    schedule: { type: 'weekly', days: ['mon', 'tue', 'wed', 'thu', 'fri'], time: '07:30' },
  },
  {
    id: 'weekly-review',
    title: 'Weekly review',
    summary: 'A look back at this week and a nudge on what matters next.',
    prompt:
      'Help me review my week. Look at the files I changed in my working folder this week and our recent conversations, summarise what got done, and suggest the three most important things for next week.',
    schedule: { type: 'weekly', days: ['fri'], time: '16:00' },
  },
  {
    id: 'tidy-downloads',
    title: 'Tidy Downloads',
    summary: 'Sorts new files in your Downloads folder into tidy subfolders.',
    prompt:
      'Look at files added to ~/Downloads since the last run. Move them into subfolders by type (Documents, Images, Installers, Archives, Other), creating folders as needed. Never delete anything. List what you moved.',
    schedule: { type: 'weekly', days: ['sun'], time: '18:00' },
    trust: 'edits',
  },
  {
    id: 'stretch',
    title: 'Stretch reminder',
    summary: 'A gentle nudge to stand up, stretch and look away from the screen.',
    prompt:
      'Give me a one-line, friendly reminder to stand up and stretch, with a different quick stretch idea each time.',
    schedule: { type: 'interval', every: 2, unit: 'hours' },
  },
];
