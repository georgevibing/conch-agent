import { describe, expect, it } from 'vitest';

import { ConchAppChanges, ConchAppManifest, type ConchAppTool } from './conch-apps';
import { appAbilities, appSourceLine, describeChanges, toolTitle } from './conch-apps-words';

const manifest = ConchAppManifest.parse({
  conch: 1,
  id: 'plant-diary',
  name: 'Plant diary',
  tagline: 'Remembers when you water your plants',
  version: '1.0.0',
  icon: { glyph: 'sprout', color: 'green' },
  tools: 'tools.mjs',
  reaches: ['api.open-meteo.com'],
  settings: [
    { key: 'apiKey', label: 'API key', secret: true },
    { key: 'city', label: 'City' },
  ],
});

const tools: ConchAppTool[] = [
  { name: 'find_plants', title: 'Find plants', description: '', changes: false },
  { name: 'last_watered', title: 'When last watered', description: '', changes: false },
  { name: 'log_watering', title: 'Log watering', description: '', changes: true },
];

const unsigned = { state: 'unsigned' as const };

describe('appAbilities', () => {
  it('says what an app can do, one plain line each, in order', () => {
    expect(appAbilities(manifest, tools)).toEqual([
      { kind: 'data', text: 'Keeps its own notes on this computer' },
      { kind: 'reach', text: 'Reaches api.open-meteo.com' },
      { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
      { kind: 'needs', text: 'Needs from you: API key, City' },
      { kind: 'looks', text: 'Looks things up: Find plants, When last watered' },
      { kind: 'changes', text: 'Makes changes: Log watering (asks first)' },
    ]);
  });

  it('says when it reaches nothing, and leaves out what it doesn’t have', () => {
    const page = ConchAppManifest.parse({
      ...manifest,
      tools: undefined,
      reaches: [],
      settings: [],
    });
    expect(appAbilities(page, [])).toEqual([
      { kind: 'reach', text: 'Reaches no websites' },
      { kind: 'nothing-else', text: 'Can’t read your files, run programs or see your other apps' },
    ]);
  });

  it('names every host, marks optional settings, and shortens long lists of tools', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      name: `tool_${i}`,
      title: '',
      description: '',
      changes: true,
    }));
    const lines = appAbilities(
      {
        ...manifest,
        reaches: ['a.example.com', 'b.example.com', 'c.example.com'],
        settings: [
          { key: 'k', label: 'API key', secret: true, optional: false },
          { key: 'c', label: 'City', secret: false, optional: true },
        ],
      },
      many,
    );
    expect(lines.find((l) => l.kind === 'reach')?.text).toBe(
      'Reaches a.example.com, b.example.com and c.example.com',
    );
    expect(lines.find((l) => l.kind === 'needs')?.text).toBe(
      'Needs from you: API key, City (optional)',
    );
    expect(lines.find((l) => l.kind === 'changes')?.text).toBe(
      'Makes changes: Tool 0, Tool 1, Tool 2, Tool 3 and 3 more (each asks first)',
    );
  });

  it('gives a tool without a title a name from its own', () => {
    expect(toolTitle({ name: 'log_watering', title: '  ' })).toBe('Log watering');
    expect(toolTitle({ name: 'x', title: 'Find plants' })).toBe('Find plants');
  });
});

describe('describeChanges', () => {
  it('puts new reach first, then what got more powerful, in names a person knows', () => {
    const changes = ConchAppChanges.parse({
      from: '1.0.0',
      to: '1.1.0',
      reachesAdded: ['api.example.com'],
      reachesRemoved: ['old.example.com'],
      settingsAdded: ['city'],
      toolsAdded: ['find_plants'],
      toolsRemoved: ['old_tool'],
      toolsNowChange: ['last_watered'],
      pagesAdded: ['main'],
    });
    expect(
      describeChanges(changes, {
        manifest: {
          ...manifest,
          pages: [{ id: 'main', title: 'Overview', file: 'pages/main.html' }],
        },
        tools,
      }),
    ).toEqual([
      'Now also reaches api.example.com',
      'When last watered now makes changes',
      'Now needs from you: City',
      'New: Find plants',
      'A new page: Overview',
      'No longer: Old tool',
      'No longer reaches old.example.com',
    ]);
  });

  it('says nothing when nothing it can reach or do changed', () => {
    expect(describeChanges(ConchAppChanges.parse({ from: '1.0.0', to: '1.0.1' }))).toEqual([]);
  });

  it('falls back to the raw names when it has no manifest to read', () => {
    const changes = ConchAppChanges.parse({
      from: '1',
      to: '2',
      reachesAdded: ['a.example.com', 'b.example.com'],
      toolsNowChange: ['a_b', 'c_d'],
    });
    expect(describeChanges(changes)).toEqual([
      'Now also reaches a.example.com and b.example.com',
      'A b, C d now make changes',
    ]);
  });
});

describe('appSourceLine', () => {
  const github = {
    kind: 'github' as const,
    owner: 'ada',
    repo: 'plant-diary',
    url: 'https://github.com/ada/plant-diary',
  };

  it('says who an app is from in a few words', () => {
    expect(appSourceLine({ kind: 'made' }, unsigned)).toBe('Made by you');
    expect(appSourceLine(github, { state: 'verified', publisher: 'Ada Lovelace' })).toBe(
      'Signed by Ada Lovelace',
    );
    expect(appSourceLine(github, unsigned)).toBe('From github.com/ada/plant-diary');
    expect(appSourceLine({ ...github, repo: 'apps', path: '/plant-diary/' }, unsigned)).toBe(
      'From github.com/ada/apps/plant-diary',
    );
    expect(appSourceLine({ kind: 'file', name: 'plant-diary.conchapp' }, unsigned)).toBe(
      'From a file',
    );
    expect(
      appSourceLine(
        { kind: 'link', url: 'https://Apps.Example.com/x/plant.conchapp?y=1' },
        unsigned,
      ),
    ).toBe('From apps.example.com');
  });

  it('never lends a name to a signature that doesn’t hold or a look-alike key', () => {
    const link = { kind: 'link' as const, url: 'https://example.com/a.conchapp' };
    expect(appSourceLine(link, { state: 'invalid', publisher: 'Ada Lovelace' })).toBe(
      'Its signature doesn’t hold',
    );
    expect(
      appSourceLine(link, { state: 'untrusted', publisher: 'Ada Lovelace', lookalike: true }),
    ).toBe('Signed with a key that isn’t Ada Lovelace’s');
    expect(appSourceLine(link, { state: 'untrusted', publisher: 'Ada Lovelace' })).toBe(
      'Signed by Ada Lovelace',
    );
  });
});
