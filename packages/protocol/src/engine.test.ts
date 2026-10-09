import { describe, expect, it } from 'vitest';

import { AgentDefaults } from './agents';
import { PermissionMode, Preferences } from './index';
import { Capabilities, honouredMode } from './engine';
import { RoutineTrust } from './routines';

describe('honouredMode', () => {
  it('keeps a mode the provider honours', () => {
    expect(honouredMode('auto', ['plan', 'auto', 'bypassPermissions'])).toBe('auto');
  });

  it('falls back to the provider’s first, safest mode for one it can’t honour', () => {
    // A provider that can't ask first reads those as "read only", never as licence to write.
    expect(honouredMode('auto', ['plan', 'bypassPermissions'])).toBe('plan');
    expect(honouredMode('default', ['plan', 'auto', 'bypassPermissions'])).toBe('plan');
    expect(honouredMode('auto', ['default', 'plan'])).toBe('default');
  });

  it('keeps the wish when the provider hasn’t said what it honours', () => {
    expect(honouredMode('auto', [])).toBe('auto');
    expect(honouredMode('auto', undefined)).toBe('auto');
  });
});

describe('four modes, Auto by default (ADR 0119)', () => {
  it('starts new chats in Auto', () => {
    expect(Preferences.parse({}).permissionMode).toBe('auto');
  });

  it('reads Edit freely, saved before, as Auto wherever a mode is kept', () => {
    expect(PermissionMode.parse('acceptEdits')).toBe('auto');
    expect(Preferences.parse({ permissionMode: 'acceptEdits' }).permissionMode).toBe('auto');
    expect(AgentDefaults.parse({ permissionMode: 'acceptEdits' }).permissionMode).toBe('auto');
    expect(RoutineTrust.parse('edits')).toBe('auto');
    expect(PermissionMode.safeParse('editFreely').success).toBe(false);
  });
});

describe('provider capability contract', () => {
  it('retains explicit chat-only models rather than inventing universal tool support', () => {
    const capabilities = Capabilities.parse({
      engine: 'ollama',
      label: 'Local',
      models: [{ id: 'small', label: 'Small', tools: false }],
      commands: [],
      permissionModes: ['default'],
      tools: { host: true, files: true, shell: false, approvals: true },
    });
    expect(capabilities.models[0]?.tools).toBe(false);
    expect(capabilities.tools?.shell).toBe(false);
  });
  it('accepts existing providers without a new capability declaration', () => {
    expect(
      Capabilities.parse({
        engine: 'mock',
        label: 'Mock',
        models: [],
        commands: [],
        permissionModes: ['default'],
      }).tools,
    ).toBeUndefined();
  });
});
