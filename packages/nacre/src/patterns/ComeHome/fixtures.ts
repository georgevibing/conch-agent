import type { ImportPreviewItem } from './ImportPreview';

/** What Conch might find in an OpenClaw folder, for stories and tests. */
export const openClawItems: ImportPreviewItem[] = [
  {
    id: 'persona:name',
    group: 'persona',
    title: 'Call your assistant “Pearl”',
    detail: 'From OpenClaw’s IDENTITY.md. Now it’s “Conch”.',
  },
  {
    id: 'persona:instructions',
    group: 'persona',
    title: 'How your assistant should behave',
    detail: 'From OpenClaw’s SOUL.md, as your instructions in every chat.',
    preview: 'Be warm and brief. Use British spelling.\n\nAsk before anything risky.',
  },
  {
    id: 'about',
    group: 'about',
    title: 'What it knows about you',
    detail: 'From OpenClaw’s USER.md, added to About you.',
    preview: 'Ada Lovelace, in London. Works on analytical engines.',
  },
  {
    id: 'memory:0',
    group: 'memories',
    title: 'Ada takes her tea with lemon.',
    detail: 'From MEMORY.md',
    duplicate: true,
  },
  {
    id: 'memory:1',
    group: 'memories',
    title: 'Her sister is called Grace.',
    detail: 'From MEMORY.md',
  },
  {
    id: 'memory:2',
    group: 'memories',
    title: 'The build runs on Fridays.',
    detail: 'From MEMORY.md',
  },
  {
    id: 'skill:weekly-review',
    group: 'skills',
    title: 'Weekly review',
    detail: 'Comes over off: turn it on in Skills when you’re ready.',
  },
  {
    id: 'skill:solana-helper',
    group: 'skills',
    title: 'Solana helper',
    detail: 'Comes over off: turn it on in Skills when you’re ready.',
    warning: 'Left unticked: read what Conch found before bringing it.',
  },
  {
    id: 'routine:0',
    group: 'routines',
    title: 'Morning briefing',
    detail:
      'At 08:00 AM, Monday through Friday in OpenClaw. Comes over as a draft: nothing runs until you turn it on.',
    preview: 'Summarise my calendar and the weather.',
  },
  {
    id: 'channel:telegram',
    group: 'channels',
    title: 'Your Telegram bot',
    detail:
      'Its key, from OpenClaw’s openclaw.json. Conch checks it with Telegram, then waits for your hello: nobody else gets in.',
    warning: 'A bot answers in one app at a time. Stop OpenClaw first, or both will try to answer.',
  },
  {
    id: 'key:openrouter',
    group: 'keys',
    title: 'Your OpenRouter key',
    detail: 'Saved in Conch’s encrypted key file, so OpenRouter works here too. It’s never shown.',
  },
];

export const openClawTicked = [
  'persona:name',
  'persona:instructions',
  'about',
  'memory:1',
  'memory:2',
  'skill:weekly-review',
  'routine:0',
];
