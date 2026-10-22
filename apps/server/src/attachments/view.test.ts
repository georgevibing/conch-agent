import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AttachmentViewResponse } from '@conch/protocol';
import { strToU8, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from '../app';
import { loadConfig } from '../config';
import { Services } from '../services';
import { onThisComputer } from '../test/here';
import type { Reader } from './readers';
import { AttachmentStore } from './store';
import { AttachmentViews, buildView, partsOf, summaryOf, VIEW_ROOM, viewFrom } from './view';

describe('views from readers’ text', () => {
  it('turns a sheet’s cells into a table, with its name', () => {
    const parts = partsOf(
      '[Sheet: Q3]\nA1: Name | B1: Team\nA2: Ada | B2: Platform [formula: =X; cached value]\nB4: late',
    );
    expect(parts).toEqual([
      {
        kind: 'table',
        title: 'Q3',
        columns: ['A', 'B'],
        rows: [
          ['Name', 'Team'],
          ['Ada', 'Platform'],
          ['', ''],
          ['', 'late'],
        ],
        total: 4,
      },
    ]);
  });

  it('keeps a recording’s facts and the times things were said', () => {
    const parts = partsOf(
      'Title: Standup\nArtist: Team\n\nWhat is said:\n[0:00] Hello.\n[1:02:03] Bye.',
    );
    expect(parts).toEqual([
      {
        kind: 'facts',
        facts: [
          { label: 'Title', value: 'Standup' },
          { label: 'Artist', value: 'Team' },
        ],
      },
      {
        kind: 'transcript',
        segments: [
          { start: 0, text: 'Hello.' },
          { start: 3723, text: 'Bye.' },
        ],
      },
    ]);
  });

  it('reads an email’s headers apart from its words', () => {
    const [email] = partsOf(
      'From: Ada <ada@example.com>\nTo: Grace\nSubject: Launch\nAttachments: plan.pdf (2 MB), a.png\n\nHi Grace,\n\nShip it.',
    );
    expect(email).toMatchObject({
      kind: 'email',
      headers: [
        { name: 'From', value: 'Ada <ada@example.com>' },
        { name: 'To', value: 'Grace' },
        { name: 'Subject', value: 'Launch' },
      ],
      body: 'Hi Grace,\n\nShip it.',
      attachments: [{ name: 'plan.pdf', size: 2 * 1024 * 1024 }, { name: 'a.png' }],
    });
  });

  it('draws a list of paths as a tree, tables as tables, and the rest as lines', () => {
    expect(partsOf('docs/\ndocs/a.txt (12 KB)\nphotos/b.jpg')[0]).toMatchObject({
      kind: 'tree',
      entries: [
        { path: 'docs/', folder: true },
        { path: 'docs/a.txt', size: 12 * 1024 },
        { path: 'photos/b.jpg' },
      ],
    });
    expect(partsOf('id\tname\n1\tusers\n2\torders')[0]).toMatchObject({
      kind: 'table',
      columns: ['id', 'name'],
      rows: [
        ['1', 'users'],
        ['2', 'orders'],
      ],
    });
    expect(partsOf('[Page 1]\n# Plan\nWe ship.\n- one\n> said\n<script>x</script>')).toEqual([
      {
        kind: 'text',
        title: 'Page 1',
        blocks: [
          { kind: 'heading', text: 'Plan' },
          { kind: 'paragraph', text: 'We ship.' },
          { kind: 'item', text: 'one' },
          { kind: 'quote', text: 'said' },
          // Markup is only ever words: the browser shows it, never runs it.
          { kind: 'paragraph', text: '<script>x</script>' },
        ],
      },
    ]);
  });

  it('says what a file is, but never repeats what was meant for a model', () => {
    expect(summaryOf('(A ZIP archive of 14 files. Its text files are below.)')).toBe(
      'A ZIP archive of 14 files.',
    );
    expect(summaryOf('(If the message depends on it, say so.)')).toBeUndefined();
    expect(summaryOf('(Use read_document for more.)')).toBeUndefined();
  });

  it('uses a reader’s own view, and refuses one the schema doesn’t allow', () => {
    const tree = { kind: 'tree' as const, entries: [{ path: 'a.txt' }] };
    expect(viewFrom({ note: '(An archive.)', view: { parts: [tree] } })).toEqual({
      summary: 'An archive.',
      parts: [tree],
    });
    const bad = viewFrom({
      note: '(x.)',
      text: 'plain words',
      view: { parts: [{ kind: 'html', html: '<b>' }] } as never,
    });
    expect(bad.parts[0]).toMatchObject({ kind: 'text' });
  });
});

describe('making a view', () => {
  const home = () => mkdtemp(join(tmpdir(), 'conch-view-'));

  it('reads for a person: more room, no pictures, no tools, no file paths for a model', async () => {
    const store = new AttachmentStore(await home());
    const saved = await store.save({ name: 'a.bin', bytes: Buffer.from([0, 1, 2, 3]) });
    const found = await store.get(saved.id);
    if (!found) throw new Error('not saved');
    const read = vi.fn<Reader['read']>(async () => ({ note: '(A small program.)' }));
    const reader: Reader = { id: 'test', matches: () => true, read };
    const view = await buildView(found, {}, [reader]);
    expect(view).toEqual({ summary: 'A small program.', parts: [] });
    expect(read.mock.calls[0]?.[0]).toMatchObject({
      room: VIEW_ROOM,
      can: { images: false, files: false, tools: false },
    });
    expect(await buildView(found, {}, [])).toBeNull();
  });

  it('keeps each view, so a reader runs once per attachment', async () => {
    const store = new AttachmentStore(await home());
    const saved = await store.save({ name: 'a.bin', bytes: Buffer.from([0, 1, 2, 3]) });
    const read = vi.fn<Reader['read']>(async () => ({ note: '(Bytes.)', text: 'hello' }));
    const views = new AttachmentViews(store, () => ({}), [
      { id: 'test', matches: () => true, read },
    ]);
    await views.get(saved.id);
    const again = await views.get(saved.id);
    expect(read).toHaveBeenCalledTimes(1);
    expect(again?.parts).toEqual([
      { kind: 'text', blocks: [{ kind: 'paragraph', text: 'hello' }] },
    ]);
    expect(await views.get('att_nothere')).toBeUndefined();
    expect(await views.get('../../settings')).toBeUndefined();
  });
});

describe('GET /api/attachments/:id/view', () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function setup() {
    const config = loadConfig({
      CONCH_HOME: await mkdtemp(join(tmpdir(), 'conch-view-app-')),
      CONCH_ENGINE: 'mock',
      CONCH_LOG_LEVEL: 'silent',
      CONCH_WEB_DIST: '/nonexistent',
    });
    const services = new Services(config);
    const app = onThisComputer(await buildApp(services), services);
    close = () => app.close();
    return app;
  }

  const workbook = () =>
    Buffer.from(
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'xl/workbook.xml': strToU8(
          '<workbook><sheets><sheet name="Team" sheetId="1" r:id="rId1"/></sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
        ),
        'xl/worksheets/sheet1.xml': strToU8(
          '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Commits</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Ada</t></is></c><c r="B2"><v>1289</v></c></row></sheetData></worksheet>',
        ),
      }),
    );

  it('shows a workbook’s sheets as tables, as JSON that can’t be taken for a page', async () => {
    const app = await setup();
    const { attachment } = (
      await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: {
          'content-type': 'application/octet-stream',
          'x-conch-name': 'team.xlsx',
        },
        payload: workbook(),
      })
    ).json();
    const res = await app.inject(`/api/attachments/${attachment.id}/view`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toMatch(/^sandbox/);
    const { view } = AttachmentViewResponse.parse(res.json());
    expect(view?.parts).toContainEqual(
      expect.objectContaining({
        kind: 'table',
        title: 'Team',
        rows: [
          ['Name', 'Commits'],
          ['Ada', '1289'],
        ],
      }),
    );
  });

  it('says null when nothing reads it, and refuses strangers, other sites and path tricks', async () => {
    const app = await setup();
    const { attachment } = (
      await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { 'content-type': 'application/octet-stream', 'x-conch-name': 'notes.txt' },
        payload: Buffer.from('just words'),
      })
    ).json();
    expect((await app.inject(`/api/attachments/${attachment.id}/view`)).json()).toEqual({
      view: null,
    });
    expect((await app.inject('/api/attachments/att_missing/view')).statusCode).toBe(404);
    expect((await app.inject('/api/attachments/..%2F..%2Fsettings.json/view')).statusCode).toBe(
      404,
    );
    const remote = await app.inject({
      url: `/api/attachments/${attachment.id}/view`,
      remoteAddress: '192.168.1.20',
    });
    expect(remote.statusCode).toBe(401);
    const crossSite = await app.inject({
      url: `/api/attachments/${attachment.id}/view`,
      headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
    });
    expect(crossSite.statusCode).toBe(403);
  });
});
