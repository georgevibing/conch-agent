import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineStatus, ToolView } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine, EngineEvent } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import { ConversationStore } from './store';
import { cleanView, HostToolRows } from './views';

const mail = (url: string) => ({
  kind: 'mail',
  items: [{ from: 'Ada', subject: 'Budget', date: '2026-10-02T10:00:00Z', url }],
});

describe('a tool’s view, before it’s logged', () => {
  it('keeps a good view as it is, with its defaults', () => {
    expect(cleanView(mail('https://mail.google.com/mail/#all/1'))).toEqual({
      kind: 'mail',
      items: [
        {
          from: 'Ada',
          subject: 'Budget',
          date: '2026-10-02T10:00:00Z',
          unread: false,
          attachments: false,
          url: 'https://mail.google.com/mail/#all/1',
        },
      ],
    });
  });

  it('drops links that aren’t web links, or carry a sign-in, and keeps the rest', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      ' JAVASCRIPT:alert(1)',
      'https://user:secret@example.org/',
      'https://',
    ]) {
      const view = cleanView(mail(bad));
      expect(view?.kind === 'mail' && view.items[0]?.url).toBeUndefined();
      expect(view?.kind === 'mail' && view.items[0]?.subject).toBe('Budget');
    }
  });

  it('refuses what isn’t a view at all', () => {
    expect(cleanView(undefined)).toBeUndefined();
    expect(cleanView('agenda')).toBeUndefined();
    expect(cleanView([])).toBeUndefined();
    expect(cleanView({ kind: 'html', html: '<script>' })).toBeUndefined();
    expect(cleanView({ kind: 'mail', items: [{ from: 'Ada' }] })).toBeUndefined();
    expect(
      cleanView({ kind: 'agenda', items: [{ title: 'x', start: 'soon', color: 'red' }] }),
    ).toBe(undefined);
  });

  it('keeps at most as many rows as each kind allows', () => {
    const view = cleanView({
      kind: 'files',
      items: Array.from({ length: 45 }, (_, i) => ({ name: `File ${i}` })),
    });
    expect(view?.kind === 'files' && view.items).toHaveLength(30);
  });

  it('redacts a saved password wherever it turns up, but never the kind', () => {
    const view = cleanView(
      {
        kind: 'messages',
        place: '#ops hunter2',
        items: [{ author: 'Eve', text: 'pw is hunter2', at: '2026-10-02' }],
      },
      (text) => text.replaceAll('hunter2', '••••'),
    );
    expect(view).toEqual({
      kind: 'messages',
      place: '#ops ••••',
      items: [{ author: 'Eve', text: 'pw is ••••', at: '2026-10-02' }],
    });
  });
});

describe('Conch’s own tool calls in the transcript', () => {
  it('get a row, with the view, only when they found something to show', () => {
    let now = 1_000;
    const rows = new HostToolRows(undefined, () => now);
    rows.start({
      toolUseId: 't1',
      name: 'mcp__conch__google_drive_search',
      input: { query: 'deck' },
    });
    rows.start({ toolUseId: 't2', name: 'mcp__conch__remember', input: {} });
    expect(rows.owns('t1')).toBe(true);
    now = 1_450;
    expect(
      rows.end({
        toolUseId: 't1',
        status: 'success',
        output: '{"files":[]}',
        view: { kind: 'files', items: [{ name: 'Deck' }] },
      }),
    ).toEqual([
      {
        type: 'tool.started',
        toolUseId: 't1',
        name: 'mcp__conch__google_drive_search',
        input: { query: 'deck' },
      },
      {
        type: 'tool.finished',
        toolUseId: 't1',
        status: 'success',
        output: '{"files":[]}',
        durationMs: 450,
        view: { kind: 'files', items: [{ name: 'Deck' }] },
      },
    ]);
    expect(rows.owns('t1')).toBe(false);
    // No view: stays out of the transcript, as before.
    expect(rows.end({ toolUseId: 't2', status: 'success', output: 'Saved.' })).toEqual([]);
  });

  it('show nothing for a failed call, a bad view, or a call they never saw start', () => {
    const rows = new HostToolRows();
    rows.start({ toolUseId: 'a', name: 'mcp__conch__slack_search', input: {} });
    rows.start({ toolUseId: 'b', name: 'mcp__conch__slack_search', input: {} });
    const view = { kind: 'messages', items: [] };
    expect(rows.end({ toolUseId: 'a', status: 'error', view })).toEqual([]);
    expect(rows.end({ toolUseId: 'b', status: 'success', view: { kind: 'nope' } })).toEqual([]);
    expect(rows.end({ toolUseId: 'c', status: 'success', view })).toEqual([]);
  });
});

/** A provider whose turn calls Conch's own tools, the way every engine reports them. */
class Scripted implements Engine {
  readonly id = 'mock' as const;
  readonly label = 'Scripted';
  readonly integrations = { mode: 'bridge' as const };
  constructor(private readonly view: unknown) {}
  async detect(): Promise<EngineStatus> {
    return {
      engine: 'mock',
      label: 'Scripted',
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: 'mock',
      label: 'Scripted',
      models: [],
      commands: [],
      permissionModes: ['default'],
    };
  }
  async *runTurn(): AsyncIterable<EngineEvent> {
    const input = { accountId: 'a1', start: '2026-10-03T00:00:00Z', end: '2026-10-04T00:00:00Z' };
    yield {
      type: 'tool-start',
      toolUseId: 'cal',
      name: 'mcp__conch__google_calendar_briefing',
      input,
    };
    yield {
      type: 'tool-end',
      toolUseId: 'cal',
      status: 'success',
      output: '{"items":[]}',
      view: this.view as ToolView,
    };
    yield { type: 'tool-start', toolUseId: 'mem', name: 'mcp__conch__remember', input: {} };
    yield { type: 'tool-end', toolUseId: 'mem', status: 'success', output: 'Saved.' };
    yield { type: 'text', messageId: 'm', delta: 'Your day is free.' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function turnWith(view: unknown) {
  const home = await mkdtemp(join(tmpdir(), 'conch-views-'));
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'mock', autoTitle: false } });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => new Scripted(view),
  });
  const convo = await manager.send({ clientMessageId: 'u1', text: 'what’s on today?' });
  for (let i = 0; i < 2000; i++) {
    const { events } = await manager.detail(convo.id);
    if (events.some((e) => e.type === 'turn.completed')) return events;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

describe('a turn whose tool found something to show', () => {
  it('logs the tool’s row with its view; Conch’s other tools stay out of sight', async () => {
    const view = {
      kind: 'agenda',
      from: '2026-10-03T00:00:00Z',
      to: '2026-10-04T00:00:00Z',
      items: [{ title: 'Standup', start: '2026-10-03T09:00:00Z', url: 'javascript:alert(1)' }],
    };
    const events = await turnWith(view);
    const tools = events.filter((e) => e.type === 'tool.started' || e.type === 'tool.finished');
    expect(tools.map((e) => [e.type, e.toolUseId])).toEqual([
      ['tool.started', 'cal'],
      ['tool.finished', 'cal'],
    ]);
    expect(tools[0]).toMatchObject({ name: 'mcp__conch__google_calendar_briefing' });
    expect(tools[1]).toMatchObject({
      status: 'success',
      output: '{"items":[]}',
      view: {
        kind: 'agenda',
        items: [{ title: 'Standup', start: '2026-10-03T09:00:00Z', allDay: false, call: false }],
      },
    });
  });

  it('a view that isn’t one is dropped, and the tool stays out of sight as before', async () => {
    const events = await turnWith({ kind: 'agenda', items: 'everything' });
    expect(events.some((e) => e.type === 'tool.started' || e.type === 'tool.finished')).toBe(false);
    expect(events.some((e) => e.type === 'turn.completed')).toBe(true);
  });
});
