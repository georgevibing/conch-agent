/** Made-up results for stories and tests: nobody here is real. */
import type { ReactNode } from 'react';

import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import { Message, MessageList } from '../Message';
import { Prose } from '../Prose';
import { ToolCall } from '../ToolCall';
import type { AgendaEvent } from './AgendaView';
import type { ChatMessage } from './ChatMessages';
import type { FoundFile } from './FileList';
import type { MailMessage } from './MailList';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** `hh:mm` on the day `offset` days from the day of `now`, local time, as ISO. */
export function at(now: number, offset: number, hh: number, mm = 0): string {
  const d = new Date(now + offset * DAY);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** The local calendar day `offset` days from `now`: `2026-10-03`. */
export function day(now: number, offset: number): string {
  const d = new Date(now + offset * DAY);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function agenda(now: number): AgendaEvent[] {
  return [
    {
      title: 'Offsite planning',
      start: day(now, 0),
      end: day(now, 2),
      allDay: true,
      color: '#33b679',
      url: 'https://calendar.example.org/e/offsite',
    },
    {
      title: 'Standup',
      start: at(now, 0, 9, 30),
      end: at(now, 0, 9, 45),
      call: true,
      color: '#039be5',
      url: 'https://calendar.example.org/e/standup',
    },
    {
      title: 'Design review: onboarding flow',
      start: at(now, 0, 11),
      end: at(now, 0, 12),
      location: 'Room 4, second floor',
      color: '#7986cb',
      url: 'https://calendar.example.org/e/review',
    },
    {
      title: 'Lunch with Sam',
      start: at(now, 0, 13),
      end: at(now, 0, 14),
      location: 'Café Lumen',
      color: '#f6bf26',
    },
    {
      title: 'Budget sync with finance',
      start: at(now, 0, 16, 30),
      end: at(now, 0, 17),
      call: true,
      color: '#039be5',
    },
    {
      title: 'Dentist',
      start: at(now, 1, 8, 15),
      end: at(now, 1, 9),
      location: '12 Harbour Street',
      color: '#e67c73',
    },
  ];
}

export function mail(now: number): MailMessage[] {
  return [
    {
      from: 'Ada Lovelace',
      subject: 'Q4 budget, final numbers',
      snippet:
        'Here are the final numbers for Q4. The travel line came in under, which leaves room for the offsite.',
      date: new Date(now - 2 * HOUR).toISOString(),
      unread: true,
      attachments: true,
      url: 'https://mail.example.org/m/1',
    },
    {
      from: 'Sam Rivera',
      subject: 'Re: Budget for the launch',
      snippet: 'Works for me. Can we move the review to Thursday?',
      date: new Date(now - 26 * HOUR).toISOString(),
      unread: true,
      url: 'https://mail.example.org/m/2',
    },
    {
      from: 'Finance team',
      subject: 'Budget templates for next year',
      snippet: 'Attached are the templates. Please fill in your team’s lines by the 15th.',
      date: new Date(now - 4 * DAY).toISOString(),
      attachments: true,
      url: 'https://mail.example.org/m/3',
    },
    {
      from: 'Grace Hopper',
      subject: 'Budget question',
      snippet: 'Quick one: does the hardware refresh come out of ours or IT’s?',
      date: new Date(now - 40 * DAY).toISOString(),
      url: 'https://mail.example.org/m/4',
    },
  ];
}

export function files(now: number): FoundFile[] {
  return [
    {
      name: 'Q4 launch deck',
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
    {
      name: 'Launch plan and timeline, with every milestone written out in full',
      mime: 'application/vnd.google-apps.document',
      modified: new Date(now - 5 * DAY).toISOString(),
      owner: 'You',
      url: 'https://drive.example.org/f/3',
    },
    {
      name: 'Signed contract.pdf',
      mime: 'application/pdf',
      modified: new Date(now - 60 * DAY).toISOString(),
      owner: 'Legal',
      url: 'https://drive.example.org/f/4',
    },
    {
      name: 'Launch photos',
      mime: 'application/vnd.google-apps.folder',
      owner: 'Grace Hopper',
      url: 'https://drive.example.org/f/5',
    },
    { name: 'hero-shot.png', mime: 'image/png', modified: new Date(now - 8 * DAY).toISOString() },
  ];
}

export function messages(now: number): ChatMessage[] {
  return [
    {
      author: 'Sam Rivera',
      text: 'Pushed the new onboarding screens to the shared file. Feedback welcome!',
      at: new Date(now - 5 * HOUR).toISOString(),
      url: 'https://chat.example.org/p/1',
    },
    {
      author: 'Sam Rivera',
      text: 'The empty state is the one I’m least sure about.',
      at: new Date(now - 5 * HOUR + 2 * 60_000).toISOString(),
    },
    {
      author: 'Ada Lovelace',
      text: 'Looks great. Two things:\n1. The button on step 2 reads “Continue” but it saves.\n2. Can the illustration be smaller on phones?',
      at: new Date(now - 3 * HOUR).toISOString(),
      url: 'https://chat.example.org/p/2',
    },
    {
      author: 'Grace Hopper',
      text: 'Agree on the button. I’d call it Save and continue. Also, a long thought on the empty state: it should say what will be here, show one thing to do, and never feel like an error. Right now it reads a bit like something went wrong, mostly because of the grey icon and the word “nothing”. If we swap the icon for the illustration from step 1 and say “Your projects will show up here”, it gets warmer without more words. Happy to pair on it tomorrow morning if that helps.',
      at: new Date(now - 2 * HOUR).toISOString(),
    },
    {
      author: 'Sam Rivera',
      text: 'Yes please, 10:00?',
      at: new Date(now - 90 * 60_000).toISOString(),
    },
  ];
}

/** A tool row as the chat draws it: the app's logo and name, then what it did. */
export function AppTool({
  brand,
  app,
  title,
  summary,
  output,
  children,
}: {
  brand: string;
  app: string;
  title: string;
  summary?: string;
  output?: string;
  children: ReactNode;
}) {
  return (
    <ToolCall
      name={title}
      summary={summary}
      status="success"
      duration={840}
      output={output ?? '{"items":[…]}'}
      leading={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IntegrationLogo brand={brand} name={app} size="xs" decorative />
          <span style={{ fontWeight: 520, color: 'var(--nc-text-muted)' }}>{app}</span>
        </span>
      }
      view={children}
    />
  );
}

/** A question, the tool row with its view, and the answer: a chat as it looks. */
export function InChat({
  ask,
  answer,
  children,
}: {
  ask: string;
  answer: string;
  children: ReactNode;
}) {
  return (
    <div style={{ maxInlineSize: 760, marginInline: 'auto' }}>
      <MessageList>
        <Message from="user">{ask}</Message>
        {children}
        <Message from="assistant">
          <Prose>{answer}</Prose>
        </Message>
      </MessageList>
    </div>
  );
}

/** A view on its own, on the tool row's surface. */
export function ViewSurface({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        maxInlineSize: 640,
        marginInline: 'auto',
        background: 'var(--nc-surface)',
        borderRadius: 12,
        boxShadow: 'inset 0 0 0 1px var(--nc-border-subtle)',
      }}
    >
      {children}
    </div>
  );
}
