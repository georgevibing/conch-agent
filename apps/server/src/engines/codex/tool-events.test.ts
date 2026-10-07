import { describe, expect, it } from 'vitest';
import { CodexToolEvents } from './tool-events';

const none = new Set<string>();
describe('provider-owned tool observations', () => {
  it('preserves MCP failures, including tools falsely annotated read-only', () => {
    const events = new CodexToolEvents();
    const item = {
      id: '1',
      type: 'mcpToolCall',
      server: 'clock',
      tool: 'curr_time',
      arguments: {},
      status: 'completed',
      readOnlyHint: true,
      result: { isError: true, content: [{ type: 'text', text: 'Unavailable' }] },
    };
    expect(events.read('item/completed', { item }, none)).toEqual([
      { type: 'tool-start', toolUseId: '1', name: 'mcp__clock__curr_time', input: {} },
      { type: 'tool-end', toolUseId: '1', status: 'error', output: 'Unavailable' },
    ]);
    expect(events.read('item/completed', { item: { ...item, result: {} } }, none)).toEqual([]);
  });
  it('records provider dynamic calls but never duplicates Conch calls', () => {
    const events = new CodexToolEvents(new Set(['conch__current_time']));
    const item = {
      id: 'p',
      type: 'dynamicToolCall',
      namespace: 'clock',
      tool: 'curr_time',
      arguments: {},
      status: 'completed',
      success: true,
      contentItems: [{ type: 'inputText', text: '16:00 UTC' }],
    };
    expect(events.read('item/started', { item }, none)[0]).toMatchObject({
      name: 'provider__clock__curr_time',
    });
    expect(events.read('item/completed', { item }, none)).toEqual([
      { type: 'tool-end', toolUseId: 'p', status: 'success', output: '16:00 UTC' },
    ]);
    expect(
      events.read(
        'item/started',
        { item: { ...item, id: 'host', namespace: 'conch', tool: 'current_time' } },
        none,
      ),
    ).toEqual([]);
    expect(
      events.read('item/started', { item: { ...item, id: 'known' } }, new Set(['known'])),
    ).toEqual([]);
  });
  it('does not turn unrelated, malformed or in-progress items into successful tools', () => {
    const events = new CodexToolEvents();
    expect(events.read('item/completed', { item: { type: 'reasoning', id: 'r' } }, none)).toEqual(
      [],
    );
    expect(
      events.read(
        'item/completed',
        { item: { type: 'mcpToolCall', id: 'm', server: 'x', tool: {} } },
        none,
      ),
    ).toEqual([]);
    expect(
      events
        .read(
          'item/completed',
          { item: { type: 'dynamicToolCall', id: 'p', tool: 'x', status: 'inProgress' } },
          none,
        )
        .at(-1),
    ).toMatchObject({ status: 'error' });
  });
});
