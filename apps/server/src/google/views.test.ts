import { ToolView } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { ToolContext } from '../conversations/manager';
import type { HostToolResult } from '../engines/types';
import type { GoogleService } from './service';
import { googleTools } from './tools';
import { agendaView, filesView, gmailItem, imapItem, mailView, senderName } from './views';

const WINDOW = { start: '2026-10-03T00:00:00+02:00', end: '2026-10-05T00:00:00+02:00' };

describe('the calendar as an agenda', () => {
  it('draws timed and all-day events for the days asked about', () => {
    const view = agendaView(
      {
        summary: 'Ada Lovelace',
        items: [
          {
            summary: 'Design review',
            start: { dateTime: '2026-10-03T10:00:00+02:00' },
            end: { dateTime: '2026-10-03T11:00:00+02:00' },
            location: 'Room 4',
            colorId: '7',
            hangoutLink: 'https://meet.google.com/abc-defg-hij',
            htmlLink: 'https://www.google.com/calendar/event?eid=abc',
          },
          {
            summary: 'Offsite',
            start: { date: '2026-10-04' },
            end: { date: '2026-10-05' },
          },
        ],
      },
      WINDOW,
    );
    expect(ToolView.safeParse(view).success).toBe(true);
    expect(view).toEqual({
      kind: 'agenda',
      from: WINDOW.start,
      to: WINDOW.end,
      items: [
        {
          title: 'Design review',
          start: '2026-10-03T10:00:00+02:00',
          end: '2026-10-03T11:00:00+02:00',
          allDay: false,
          location: 'Room 4',
          calendar: 'Ada Lovelace',
          color: '#039be5',
          call: true,
          url: 'https://www.google.com/calendar/event?eid=abc',
        },
        {
          title: 'Offsite',
          start: '2026-10-04',
          end: '2026-10-05',
          allDay: true,
          calendar: 'Ada Lovelace',
          call: false,
        },
      ],
    });
  });

  it('leaves out what was cancelled or declined, and what has no start', () => {
    const view = agendaView(
      {
        items: [
          { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-10-03T09:00:00Z' } },
          {
            summary: 'Said no',
            start: { dateTime: '2026-10-03T09:00:00Z' },
            attendees: [{ self: true, responseStatus: 'declined' }],
          },
          { summary: 'Nowhen' },
          { start: { dateTime: '2026-10-03T12:00:00Z' } },
          'nonsense',
        ],
      },
      WINDOW,
    );
    expect(view.kind === 'agenda' && view.items).toEqual([
      { title: 'Busy', start: '2026-10-03T12:00:00Z', allDay: false, call: false },
    ]);
  });

  it('shows a call link as a call, not a place, and keeps only Google’s links', () => {
    const view = agendaView(
      {
        items: [
          {
            summary: 'Standup',
            start: { dateTime: '2026-10-03T09:00:00Z' },
            location: 'https://zoom.us/j/123',
            htmlLink: 'javascript:alert(1)',
          },
          {
            summary: 'Phone',
            start: { dateTime: '2026-10-03T10:00:00Z' },
            conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://x' }] },
            htmlLink: 'https://evil.example/calendar',
          },
        ],
      },
      WINDOW,
    );
    if (view.kind !== 'agenda') throw new Error('not an agenda');
    expect(view.items.map((i) => [i.call, i.location, i.url])).toEqual([
      [true, undefined, undefined],
      [true, undefined, undefined],
    ]);
  });

  it('keeps an empty window, so its days show as free, and stops at sixty events', () => {
    expect(agendaView({ items: [] }, WINDOW)).toEqual({
      kind: 'agenda',
      items: [],
      from: WINDOW.start,
      to: WINDOW.end,
    });
    const many = agendaView(
      {
        items: Array.from({ length: 80 }, (_, i) => ({
          summary: `Event ${i} ${'x'.repeat(400)}`,
          start: { dateTime: '2026-10-03T09:00:00Z' },
        })),
      },
      WINDOW,
    );
    expect(ToolView.safeParse(many).success).toBe(true);
    if (many.kind !== 'agenda') throw new Error('not an agenda');
    expect(many.items).toHaveLength(60);
    expect(many.items[0]?.title.length).toBeLessThanOrEqual(300);
  });
});

describe('Gmail as emails', () => {
  const meta = (overrides: Record<string, unknown> = {}) => ({
    id: '18c2f0a',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'Here&#39;s the Q4 budget &amp; the notes',
    internalDate: String(Date.UTC(2026, 9, 2, 14, 30)),
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: '"Ada Lovelace" <ada@example.org>' },
        { name: 'Subject', value: 'Q4 budget' },
      ],
    },
    ...overrides,
  });

  it('reads who it’s from, the subject, the snippet as text, unread and attachments', () => {
    expect(gmailItem(meta(), 'me@example.org')).toEqual({
      from: 'Ada Lovelace',
      subject: 'Q4 budget',
      snippet: "Here's the Q4 budget & the notes",
      date: '2026-10-02T14:30:00.000Z',
      unread: true,
      attachments: true,
      url: 'https://mail.google.com/mail/?authuser=me%40example.org#all/18c2f0a',
    });
  });

  it('copes with missing headers, a written date, and nothing to go on', () => {
    expect(
      gmailItem(
        meta({
          labelIds: [],
          snippet: undefined,
          internalDate: undefined,
          payload: { headers: [{ name: 'Date', value: 'Fri, 2 Oct 2026 09:00:00 +0000' }] },
        }),
        'me@example.org',
      ),
    ).toMatchObject({
      from: 'Unknown sender',
      subject: '(no subject)',
      date: '2026-10-02T09:00:00.000Z',
      unread: false,
      attachments: false,
    });
    expect(gmailItem(meta({ internalDate: undefined }), 'me@example.org')).toBeUndefined();
    expect(gmailItem({ nope: true }, 'me@example.org')).toBeUndefined();
  });

  it('names senders the way a mail app does', () => {
    expect(senderName('Ada Lovelace <ada@example.org>')).toBe('Ada Lovelace');
    expect(senderName('"Lovelace, Ada" <ada@example.org>')).toBe('Lovelace, Ada');
    expect(senderName('<ada@example.org>')).toBe('ada@example.org');
    expect(senderName('ada@example.org')).toBe('ada@example.org');
  });

  it('reads what IMAP saw, and gives no view for nothing', () => {
    expect(
      imapItem(
        {
          id: 'abc',
          from: { name: '', address: 'sam@example.org' },
          subject: 'Lunch',
          date: new Date('2026-10-01T12:00:00Z'),
          seen: true,
          attachments: false,
        },
        'me@example.org',
      ),
    ).toMatchObject({ from: 'sam@example.org', subject: 'Lunch', unread: false });
    expect(imapItem({ id: 'abc', seen: false, attachments: false }, 'me')).toBeUndefined();
    expect(mailView([undefined])).toBeUndefined();
    const many = mailView(Array.from({ length: 40 }, () => gmailItem(meta(), 'me@example.org')));
    expect(many?.kind === 'mail' && many.items).toHaveLength(30);
  });
});

describe('Drive as files', () => {
  it('lists files with their type, owner and date, and only Google’s links', () => {
    const view = filesView({
      files: [
        {
          id: '1',
          name: 'Q4 deck',
          mimeType: 'application/vnd.google-apps.presentation',
          modifiedTime: '2026-10-01T08:00:00.000Z',
          webViewLink: 'https://docs.google.com/presentation/d/1/edit',
          owners: [{ displayName: 'Ada Lovelace' }],
        },
        { id: '2', name: 'Elsewhere', webViewLink: 'https://evil.example/file' },
        { id: '3', name: '   ' },
        { id: '4' },
      ],
    });
    expect(view).toEqual({
      kind: 'files',
      items: [
        {
          name: 'Q4 deck',
          mime: 'application/vnd.google-apps.presentation',
          modified: '2026-10-01T08:00:00.000Z',
          owner: 'Ada Lovelace',
          url: 'https://docs.google.com/presentation/d/1/edit',
        },
        { name: 'Elsewhere' },
      ],
    });
    const many = filesView({ files: Array.from({ length: 50 }, (_, i) => ({ name: `f${i}` })) });
    expect(ToolView.safeParse(many).success).toBe(true);
    expect(many.kind === 'files' && many.items).toHaveLength(30);
  });
});

describe('the tools give the model text and the person a view', () => {
  const profile = { id: 'account1', email: 'me@example.org', state: 'ready' };
  function service(api: (path: string, query?: Record<string, string>) => unknown) {
    return {
      api: vi.fn(
        async (
          _id: string,
          _capability: string,
          path: string,
          options?: { query?: Record<string, string> },
        ) => api(path, options?.query),
      ),
      viaPassword: vi.fn(async () => false),
      status: vi.fn(async () => ({ configured: true, accounts: [profile] })),
    } as unknown as GoogleService;
  }
  const run = (google: GoogleService, name: string, args: Record<string, unknown>) => {
    const tool = googleTools(google, {} as ToolContext).find((t) => t.name === name);
    if (!tool) throw new Error(name);
    return tool.run(args as never) as Promise<string | HostToolResult>;
  };

  it('the calendar', async () => {
    const google = service(() => ({
      summary: 'me@example.org',
      items: [{ summary: 'Dentist', start: { dateTime: '2026-10-03T15:00:00+02:00' } }],
    }));
    const out = await run(google, 'google_calendar_briefing', { accountId: 'account1', ...WINDOW });
    if (typeof out === 'string') throw new Error('no view');
    expect(JSON.parse(out.text)).toMatchObject({ items: [{ summary: 'Dentist' }] });
    expect(out.view).toMatchObject({
      kind: 'agenda',
      from: WINDOW.start,
      items: [{ title: 'Dentist' }],
    });
  });

  it('Gmail search: ids for the model, who and what for the person', async () => {
    const google = service((path) =>
      path.endsWith('/messages')
        ? { messages: [{ id: 'm1' }, { id: 'm2' }], resultSizeEstimate: 2 }
        : path.endsWith('/m1')
          ? {
              id: 'm1',
              internalDate: '1790000000000',
              payload: { headers: [{ name: 'From', value: 'Ada <ada@example.org>' }] },
            }
          : Promise.reject(new Error('gone')),
    );
    const out = await run(google, 'google_mail_search', { accountId: 'account1', query: 'budget' });
    if (typeof out === 'string') throw new Error('no view');
    expect(out.text).not.toContain('Ada');
    expect(out.view).toMatchObject({ kind: 'mail', items: [{ from: 'Ada' }] });
    expect(out.view?.kind === 'mail' && out.view.items).toHaveLength(1);
  });

  it('Gmail search with nothing found, or nothing describable, has no view', async () => {
    const google = service(() => ({ resultSizeEstimate: 0 }));
    expect(
      typeof (await run(google, 'google_mail_search', { accountId: 'account1', query: 'x' })),
    ).toBe('string');
  });

  it('Drive search asks for owners and shows files', async () => {
    const queries: (Record<string, string> | undefined)[] = [];
    const google = service((_path, query) => {
      queries.push(query);
      return { files: [{ id: '1', name: 'Budget.xlsx', owners: [{ displayName: 'Sam' }] }] };
    });
    const out = await run(google, 'google_drive_search', {
      accountId: 'account1',
      query: 'budget',
    });
    expect(queries[0]?.fields).toContain('owners(displayName)');
    if (typeof out === 'string') throw new Error('no view');
    expect(out.view).toEqual({ kind: 'files', items: [{ name: 'Budget.xlsx', owner: 'Sam' }] });
  });
});
