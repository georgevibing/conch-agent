import { describe, expect, it } from 'vitest';

import type { Engine } from '../engines/types';
import { canCarryTools } from './capabilities';

const engine = (tools: boolean, shell = true): Engine => ({
  id: 'mock',
  label: 'Test',
  integrations: { mode: 'bridge' },
  detect: async () => {
    throw new Error('Not called');
  },
  capabilities: async () => ({
    engine: 'mock',
    label: 'Test',
    models: [
      {
        id: 'm',
        label: 'M',
        description: '',
        efforts: [],
        supportsFastMode: false,
        supportsAutoMode: false,
        tools,
      },
    ],
    commands: [],
    permissionModes: ['default'],
    tools: { host: true, files: true, shell, approvals: true },
  }),
  async *runTurn() {
    yield { type: 'done', outcome: 'success' };
  },
});

describe('capability-aware fallback', () => {
  it('refuses a chat-only fallback for a tool-capable source', async () => {
    expect(await canCarryTools(engine(true), engine(false))).toBe(false);
  });
  it('refuses to drop commands or approvals but allows equivalent configured providers', async () => {
    expect(await canCarryTools(engine(true), engine(true, false))).toBe(false);
    expect(await canCarryTools(engine(true), engine(true))).toBe(true);
  });
});
