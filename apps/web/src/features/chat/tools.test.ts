import { describe, expect, it } from 'vitest';

import { managedProcessSummary, toolSummary } from './tools';

describe('what a tool row says it’s about', () => {
  it('names what each step of making an app works on (ADR 0061)', () => {
    expect(toolSummary('mcp__conch__app_new', { name: 'Plant diary' })).toBe('Plant diary');
    expect(toolSummary('mcp__conch__app_write', { path: 'pages/main.html', content: '…' })).toBe(
      'pages/main.html',
    );
    expect(toolSummary('mcp__conch__app_try', { tool: 'log_watering', input: {} })).toBe(
      'log_watering',
    );
    expect(toolSummary('mcp__conch__app_get', { link: 'github.com/ada/plant-diary' })).toBe(
      'github.com/ada/plant-diary',
    );
    expect(toolSummary('mcp__conch__app_check', {})).toBeUndefined();
    // An app's picture: where it came from, never its bytes.
    expect(
      toolSummary('mcp__conch__app_icon', { url: 'https://www.yazio.com/apple-touch-icon.png' }),
    ).toBe('https://www.yazio.com/apple-touch-icon.png');
    expect(toolSummary('mcp__conch__app_icon', { base64: 'iVBORw0KGgo…' })).toBeUndefined();
  });
});

describe('managed command snapshots', () => {
  it('distinguishes an accepted command from work that has finished', () => {
    expect(
      managedProcessSummary(
        'mcp__conch__process_start',
        JSON.stringify({
          command: 'pnpm test',
          status: 'queued',
          reason: 'Waiting for memory to recover.',
        }),
      ),
    ).toBe('Waiting to start · Waiting for memory to recover.');
    expect(
      managedProcessSummary(
        'process_read',
        JSON.stringify({ command: 'pnpm test', status: 'running' }),
      ),
    ).toBe('Running when checked · pnpm test');
    expect(
      managedProcessSummary(
        'process_stop',
        JSON.stringify({
          command: 'pnpm test',
          status: 'stopped',
          reason: 'Stopped to keep Conch responsive.',
        }),
      ),
    ).toBe('Stopped · Stopped to keep Conch responsive.');
  });
  it('keeps unrelated tools, old results and malformed output unchanged', () => {
    for (const output of [
      'not JSON',
      'null',
      '[]',
      '{}',
      JSON.stringify({ status: 'queued', command: 7 }),
    ])
      expect(managedProcessSummary('process_start', output)).toBeUndefined();
    expect(
      managedProcessSummary(
        'some_other_process_start',
        JSON.stringify({ status: 'queued', command: 'test' }),
      ),
    ).toBeUndefined();
    expect(
      managedProcessSummary('process_start', JSON.stringify({ status: 'exited', command: 'test' })),
    ).toBeUndefined();
  });
});
