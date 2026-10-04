import { describe, expect, it } from 'vitest';

import { coverage } from './safety-routes';

describe('what sealing means for each provider (ADR 0031)', () => {
  const providers = [
    { id: 'claude-code', label: 'Claude Code' },
    { id: 'codex-agent', label: 'Codex CLI', version: '0.159.1' },
    { id: 'anthropic-api', label: 'Anthropic API' },
  ];

  it('says which are sealed, and that API providers run no commands', () => {
    expect(coverage(providers, { available: true, on: true }).map((p) => p.state)).toEqual([
      'sealed',
      'sealed',
      'no-commands',
    ]);
  });

  it('never claims what isn’t there: an older Codex, sealing off, a computer that can’t', () => {
    const old = coverage([{ id: 'codex-agent', label: 'Codex CLI', version: '0.120.0' }], {
      available: true,
      on: true,
    });
    expect(old[0]).toMatchObject({
      state: 'partly',
      note: expect.stringMatching(/can still read where keys live/),
    });
    // A build whose version can't be read isn't assumed to be new enough.
    expect(
      coverage([{ id: 'codex-agent', label: 'Codex CLI' }], { available: true, on: true })[0]
        ?.state,
    ).toBe('partly');
    expect(coverage(providers, { available: true, on: false }).map((p) => p.state)).toEqual([
      'not-sealed',
      'not-sealed',
      'no-commands',
    ]);
    // Windows.
    expect(coverage(providers, { available: false, on: true })[0]).toMatchObject({
      state: 'not-sealed',
      note: 'This computer can’t seal its commands yet.',
    });
  });
});

describe('Repair everything, on trust (ADR 0031)', () => {
  it('names a partly sealed Codex with its update, and a skill whose signature doesn’t hold', async () => {
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { SettingsStore } = await import('../settings/store');
    const { safetyCheck } = await import('./safety-doctor');
    const settings = new SettingsStore(await mkdtemp(join(tmpdir(), 'conch-trust-doctor-')));
    const items = await safetyCheck(settings, () => ({ available: true }), {
      providers: async () =>
        coverage([{ id: 'codex-agent', label: 'Codex CLI', version: '0.120.0' }], {
          available: true,
          on: true,
        }),
      skills: async () => [
        {
          id: 'openclaw_notes',
          name: 'notes',
          title: 'Notes',
          description: 'x',
          source: 'openclaw',
          sourceLabel: 'OpenClaw',
          editable: false,
          mode: 'off',
          path: '/x',
          files: [],
          updatedAt: 0,
          signature: { state: 'invalid', problem: 'It was changed after Ada signed it.' },
        },
      ],
    }).run({ repair: false, signal: new AbortController().signal });
    expect(items.slice(3)).toMatchObject([
      {
        id: 'safety:sealed:codex-agent',
        state: 'warning',
        action: { kind: 'need', need: 'codex', mode: 'update' },
      },
      {
        id: 'safety:signature:openclaw_notes',
        message: 'It was changed after Ada signed it. It’s off.',
        action: { kind: 'open', place: 'skills', focus: 'openclaw_notes' },
      },
    ]);
  });
});

describe('Conch-owned commands', () => {
  it('are sealed where this computer can and sealing is on; otherwise they ask first, and say so', () => {
    const provider = [{ id: 'openrouter', label: 'OpenRouter', commandSandbox: 'conch' as const }];
    expect(coverage(provider, { available: true, on: true })[0]?.state).toBe('sealed');
    expect(coverage(provider, { available: true, on: false })[0]).toMatchObject({
      state: 'not-sealed',
      note: expect.stringMatching(/Sealing is off/),
    });
    expect(coverage(provider, { available: false, on: true })[0]).toMatchObject({
      state: 'not-sealed',
      note: expect.stringMatching(
        /can’t seal commands yet, so they run with your access and ask first/,
      ),
    });
  });
});
