import { describe, expect, it } from 'vitest';

import { chunkFor, estimateTokens, SUMMARY_SYSTEM } from './context';
import {
  findToolsSpec,
  foundText,
  isLean,
  LOADED_MAX,
  leanSystem,
  remember,
  searchTools,
} from './lean';

const SYSTEM = [
  '# Who you are',
  'You are Pearl, a personal AI assistant.',
  '',
  '# About the user',
  'Their name is Ada.',
  '',
  '# Memory',
  '- [m1] (fact) Likes tea',
  '',
  '## Routines',
  'Long guidance about routines. '.repeat(200),
  '',
  '# Making a Conch app',
  'Long guidance about apps. '.repeat(400),
  '',
  '# What you can do in this conversation',
  'You have Conch’s tools.',
].join('\n');

const TOOLS = [
  {
    name: 'mcp__conch__remember',
    display: 'mcp__conch__remember',
    description: 'Save one durable fact about the user to memory.',
  },
  {
    name: 'mcp__conch__recall',
    display: 'mcp__conch__recall',
    description: 'Search what you remember.',
  },
  {
    name: 'mcp__conch__browser_open',
    display: 'mcp__conch__browser_open',
    description: 'Open a web page in the browser.',
  },
  {
    name: 'mcp__conch__browser_click',
    display: 'mcp__conch__browser_click',
    description: 'Click an element on the page.',
  },
  {
    name: 'mcp__google__calendar_events',
    display: 'mcp__google__calendar_events',
    description: 'List events on the calendar.',
  },
  { name: 'Bash', display: 'Bash', description: 'Run a shell command in the work folder.' },
];

describe('lean mode (ADR 0073)', () => {
  it('goes lean for a small window, or when Conch’s fixed part would crowd it', () => {
    expect(isLean({ window: 8_192, system: 500, tools: 500 })).toBe(true);
    expect(isLean({ window: 32_768, system: 6_000, tools: 20_000 })).toBe(true);
    expect(isLean({ window: 200_000, system: 6_000, tools: 20_000 })).toBe(false);
  });

  it('keeps who, whom, what it remembers and what it can do; leaves the rest to the tools', () => {
    const lean = leanSystem(SYSTEM, { tools: true });
    expect(lean).toContain('You are Pearl');
    expect(lean).toContain('Their name is Ada.');
    expect(lean).toContain('Likes tea');
    expect(lean).toContain('You have Conch’s tools.');
    expect(lean).not.toContain('routines');
    expect(lean).not.toContain('apps');
    expect(lean).toContain('find_tools');
    expect(estimateTokens(lean)).toBeLessThan(estimateTokens(SYSTEM) / 5);
    // A model that can't call tools isn't told about one.
    expect(leanSystem(SYSTEM, { tools: false })).not.toContain('find_tools');
  });

  it('keeps words before the first heading, and caps every section', () => {
    expect(leanSystem('You are Pearl.', { tools: false })).toBe('You are Pearl.');
    const long = leanSystem(`# Memory\n${'- [m] (fact) something true\n'.repeat(500)}`, {
      tools: false,
    });
    expect(long.length).toBeLessThan(2_000);
    expect(long.endsWith('…')).toBe(true);
  });

  it('finds tools by what the model wants to do, in its own words', () => {
    expect(searchTools('browse the web', TOOLS).slice(0, 2)).toEqual([
      'mcp__conch__browser_open',
      'mcp__conch__browser_click',
    ]);
    expect(searchTools('remember something', TOOLS)[0]).toBe('mcp__conch__remember');
    expect(searchTools('what is on my calendar', TOOLS)[0]).toBe('mcp__google__calendar_events');
    expect(searchTools('run a command', TOOLS)[0]).toBe('Bash');
    expect(searchTools('Bash', TOOLS)[0]).toBe('Bash');
    expect(searchTools('the', TOOLS)).toEqual([]);
  });

  it('guesses from the person’s own words only by a tool’s name, and knows an address is the web', () => {
    // A word of the tool's own name: loaded before the model is asked.
    expect(searchTools('Please remember that my favourite tea is oolong', TOOLS, 3, 3)).toContain(
      'mcp__conch__remember',
    );
    // Only words of the description: left for find_tools, not guessed.
    expect(searchTools('what did I save earlier', TOOLS, 3, 3)).toEqual([]);
    expect(searchTools('Can you check what example.com shows?', TOOLS)[0]).toBe(
      'mcp__conch__browser_open',
    );
    // A common word that happens to be a tool's name isn't asking for it.
    expect(
      searchTools('read the front page of example.com', [
        ...TOOLS,
        { name: 'Read', display: 'Read', description: 'Read a text file in the work folder.' },
      ])[0],
    ).toBe('mcp__conch__browser_open');
  });

  it('answers with each tool’s schema, and says plainly when nothing matched', () => {
    const spec = findToolsSpec();
    expect(spec.schema).toMatchObject({ required: ['query'] });
    expect(foundText([spec], 'x')).toContain('"query"');
    expect(foundText([], 'teleport')).toMatch(/^No tool matches “teleport”/);
  });

  it('keeps a handful of loaded tools, newest last', () => {
    let loaded: string[] = [];
    for (let i = 0; i < LOADED_MAX + 3; i++) loaded = remember(loaded, [`t${i}`]);
    expect(loaded).toHaveLength(LOADED_MAX);
    expect(loaded.at(-1)).toBe(`t${LOADED_MAX + 2}`);
    expect(remember(['a', 'b'], ['a'])).toEqual(['b', 'a']);
  });

  it('gives the summariser pieces that fit the window, and the full size where it can', () => {
    for (const window of [4_096, 8_192, 16_384]) {
      const words = 120;
      const chars = chunkFor(window, words);
      // The request: instructions, the summary so far, the piece, and room for the answer.
      const request = estimateTokens(SUMMARY_SYSTEM) + Math.ceil(words * 1.4) * 2 + 256 + chars / 3;
      expect(request).toBeLessThan(window);
    }
    expect(chunkFor(200_000, 900)).toBe(24_000);
  });
});
