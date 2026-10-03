import { describe, expect, it } from 'vitest';

import { toolSummary } from './tools';

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
  });
});
