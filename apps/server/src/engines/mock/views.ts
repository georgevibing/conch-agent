/**
 * What the mock's pretend app tools find (ADR 0060): a calendar, emails,
 * files and messages, so `pnpm dev:mock` and e2e can show every tool view
 * without Google or Slack. Everything here is plainly made up.
 */
import type { ToolView } from '@conch/protocol';

/** A pretend call: the tool's name, what it was asked, the text the model reads, the view. */
export interface PretendFind {
  tool: string;
  input: Record<string, unknown>;
  text: string;
  view: ToolView;
  reply: string;
}

const HOUR = 3_600_000;

/** `hh:mm` local time, `days` from today, as ISO. */
function at(now: number, days: number, hh: number, mm = 0): string {
  const d = new Date(now + days * 24 * HOUR);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

function day(now: number, days: number): string {
  const d = new Date(now + days * 24 * HOUR);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function calendar(now: number): PretendFind {
  const view: ToolView = {
    kind: 'agenda',
    from: at(now, 0, 0),
    to: at(now, 2, 0),
    items: [
      {
        title: 'Team offsite',
        start: day(now, 1),
        end: day(now, 2),
        allDay: true,
        call: false,
        color: '#33b679',
      },
      {
        title: 'Standup',
        start: at(now, 0, 9, 30),
        end: at(now, 0, 9, 45),
        allDay: false,
        call: true,
        color: '#039be5',
        url: 'https://calendar.example.org/e/standup',
      },
      {
        title: 'Design review',
        start: at(now, 0, 14),
        end: at(now, 0, 15),
        allDay: false,
        call: false,
        location: 'Room 4',
        color: '#7986cb',
      },
      {
        title: 'Dentist',
        start: at(now, 1, 8, 15),
        end: at(now, 1, 9),
        allDay: false,
        call: false,
        location: '12 Harbour Street',
        color: '#e67c73',
      },
    ],
  };
  return {
    tool: 'google_calendar_briefing',
    input: { accountId: 'pretend', start: view.from, end: view.to },
    text: JSON.stringify({ items: view.items.map((i) => ({ summary: i.title, start: i.start })) }),
    view,
    reply:
      'Today you have standup at 9:30 and the design review at 2. Tomorrow is the offsite, after the dentist.',
  };
}

function mail(now: number, about: string): PretendFind {
  const view: ToolView = {
    kind: 'mail',
    items: [
      {
        from: 'Ada Lovelace',
        subject: `Q4 ${about}, final numbers`,
        snippet: 'Here are the final numbers. The travel line came in under.',
        date: new Date(now - 2 * HOUR).toISOString(),
        unread: true,
        attachments: true,
        url: 'https://mail.example.org/m/1',
      },
      {
        from: 'Sam Rivera',
        subject: `Re: ${about} for the launch`,
        snippet: 'Works for me. Can we move the review to Thursday?',
        date: new Date(now - 26 * HOUR).toISOString(),
        unread: false,
        attachments: false,
        url: 'https://mail.example.org/m/2',
      },
    ],
  };
  return {
    tool: 'google_mail_search',
    input: { accountId: 'pretend', query: about, limit: 20 },
    text: JSON.stringify({
      messages: [{ id: 'pretend1' }, { id: 'pretend2' }],
      resultSizeEstimate: 2,
    }),
    view,
    reply: `The newest is Ada’s “Q4 ${about}, final numbers”, with the spreadsheet attached.`,
  };
}

function files(now: number, name: string): PretendFind {
  const view: ToolView = {
    kind: 'files',
    items: [
      {
        name: `Q4 launch ${name}`,
        mime: 'application/vnd.google-apps.presentation',
        modified: new Date(now - 3 * HOUR).toISOString(),
        owner: 'Ada Lovelace',
        url: 'https://drive.example.org/f/1',
      },
      {
        name: 'Launch budget',
        mime: 'application/vnd.google-apps.spreadsheet',
        modified: new Date(now - 30 * HOUR).toISOString(),
        owner: 'Sam Rivera',
        url: 'https://drive.example.org/f/2',
      },
    ],
  };
  return {
    tool: 'google_drive_search',
    input: { accountId: 'pretend', query: name },
    text: JSON.stringify({ files: view.items.map((f) => ({ name: f.name })) }),
    view,
    reply: `It’s “Q4 launch ${name}”, which Ada changed this morning.`,
  };
}

function messages(now: number, channel: string): PretendFind {
  const view: ToolView = {
    kind: 'messages',
    place: `#${channel}`,
    items: [
      {
        author: 'Sam Rivera',
        text: 'Pushed the new onboarding screens. Feedback welcome!',
        at: new Date(now - 3 * HOUR).toISOString(),
      },
      {
        author: 'Ada Lovelace',
        text: 'Looks great. Two things:\n1. Step 2 says “Continue” but it saves.\n2. Smaller picture on phones?',
        at: new Date(now - 2 * HOUR).toISOString(),
      },
      {
        author: 'Grace Hopper',
        text: 'Agree on the button: Save and continue.',
        at: new Date(now - HOUR).toISOString(),
      },
    ],
  };
  return {
    tool: 'slack_read_channel',
    input: { channel: 'CPRETEND01', limit: 50 },
    text: JSON.stringify({ channel: { name: channel }, messages: view.items }),
    view,
    reply: `#${channel} likes the new onboarding; Ada and Grace want step 2 to say “Save and continue”.`,
  };
}

/** What a prompt asks the pretend apps for, if anything. */
export function pretendFind(prompt: string, now = Date.now()): PretendFind | undefined {
  const text = prompt.trim();
  if (/\bwhat(?:'|’)?s on my calendar\b/i.test(text)) return calendar(now);
  const email = /\bfind the (.+?) email\b/i.exec(text)?.[1];
  if (email) return mail(now, email.replace(/^.*\s/, ''));
  const file = /\bfind the (.+?) in drive\b/i.exec(text)?.[1];
  if (file) return files(now, file.replace(/^.*\s/, ''));
  const said = /\bwhat did #([\w-]+) say\b/i.exec(text)?.[1];
  if (said) return messages(now, said);
  return undefined;
}
