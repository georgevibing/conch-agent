import type { CreateRoutineBody } from '@conch/protocol';
import type { z } from 'zod';

type Template = Omit<z.input<typeof CreateRoutineBody>, 'timezone'> & { id: string };

/** Starting points written the way we want every routine to read. */
export const templates: Template[] = [
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
