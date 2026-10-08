/**
 * Every tool call's words on the wire (ADR 0103), and the provider's notes:
 * the gateway with the mock engine, which narrates as it looks around.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConversationEvent, describeTool, ToolLabel } from '@conch/protocol';
import type * as Protocol from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MockEngine } from '../../engines/mock/engine';
import { MemoryStore } from '../../memory/store';
import { SettingsStore } from '../../settings/store';
import { ConversationManager } from '../manager';
import { ConversationStore } from '../store';
import { redactLabel, toolLabel } from './labels';
import { cleanNarration, NARRATION_MAX } from './narration';

vi.mock('@conch/protocol', async (importOriginal) => {
  const real = await importOriginal<typeof Protocol>();
  return {
    ...real,
    describeTool: (...args: Parameters<typeof real.describeTool>) => {
      if (args[0] === 'Explode') throw new Error('boom');
      if (args[0] === 'Rambles') return { family: 'other', doing: 'x'.repeat(500), done: 'y' };
      if (args[0] === 'Pictures')
        return {
          ...real.describeTool(...args),
          chips: [
            { kind: 'image', label: 'big', image: `data:image/png;base64,${'A'.repeat(10_000)}` },
            { kind: 'site', label: 'small', image: 'https://example.test/favicon.ico' },
          ],
        };
      return real.describeTool(...args);
    },
  };
});

const homes: string[] = [];
afterEach(async () => {
  while (homes.length) await rm(homes.pop() ?? '', { recursive: true, force: true });
});

async function chat(text: string, redact?: (text: string) => string, autoTitle = false) {
  const home = await mkdtemp(join(tmpdir(), 'conch-labels-'));
  homes.push(home);
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { autoTitle } });
  const engine = new MockEngine({ speed: 0 });
  const runTurn = vi.spyOn(engine, 'runTurn');
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: () => engine,
    context: async () => '',
    ...(redact && { redact }),
  });
  const done = new Promise<void>((resolve) =>
    manager.events.on((e) => {
      if (e.type === 'conversation.event' && e.event.type === 'turn.completed') resolve();
    }),
  );
  const started = await manager.send({ clientMessageId: `m${Math.random()}`, text });
  await done;
  const { events } = await manager.detail(started.id);
  return { events, engine, manager, id: started.id, runTurn };
}

describe('tool calls in plain words on the wire (ADR 0103)', () => {
  it('writes the label on every start and finish, with what the call found', async () => {
    const { events } = await chat('Please look around the project');
    const starts = events.filter(
      (e): e is Extract<ConversationEvent, { type: 'tool.started' }> => e.type === 'tool.started',
    );
    expect(starts.map((e) => e.name)).toEqual(['Read', 'Grep', 'Bash']);
    for (const start of starts) {
      expect(start.label).toEqual(describeTool(start.name, start.input));
      const end = events.find(
        (e): e is Extract<ConversationEvent, { type: 'tool.finished' }> =>
          e.type === 'tool.finished' && e.toolUseId === start.toolUseId,
      );
      expect(end?.label).toEqual(
        describeTool(start.name, start.input, { status: 'success', output: end?.output }),
      );
    }
    // Everything logged is what the protocol accepts, labels and narration included.
    for (const event of events) expect(() => ConversationEvent.parse(event)).not.toThrow();
  });

  it('passes the provider’s notes on as narration, plain and paced', async () => {
    const { events } = await chat('Please look around the project');
    const said = events.filter((e) => e.type === 'narration');
    expect(said[0]).toMatchObject({
      type: 'narration',
      text: 'Looking at how the project is laid out',
      source: 'provider',
    });
    // The second came within half a second, and the turn ended first: never after it.
    const last = events.findLastIndex((e) => e.type === 'narration');
    expect(last).toBeLessThan(events.findIndex((e) => e.type === 'turn.completed'));
    expect(said.every((e) => e.type === 'narration' && !/[*`#]/.test(e.text))).toBe(true);
  });

  it('keeps a story’s headline in the chat’s log, after the turn it’s about', async () => {
    const { manager, id, events } = await chat('Please look around the project');
    const first = events.find((e) => e.type === 'tool.started');
    if (first?.type !== 'tool.started') throw new Error('no step');
    await manager.noteStory(id, {
      type: 'story.titled',
      storyId: first.toolUseId,
      headline: 'Looked around the project',
      source: 'model',
    });
    await manager.noteStory('c_missing00000', {
      type: 'story.titled',
      storyId: 'x',
      headline: 'Nothing',
      source: 'model',
    });
    const after = (await manager.detail(id)).events;
    expect(after.at(-1)).toMatchObject({
      type: 'story.titled',
      storyId: first.toolUseId,
      headline: 'Looked around the project',
    });
    expect(() => ConversationEvent.parse(after.at(-1))).not.toThrow();
  });

  it('leaves the label off when the words can’t be made, and the turn goes on', () => {
    expect(toolLabel('Explode', {})).toBeUndefined();
    expect(toolLabel('Rambles', {})).toBeUndefined();
    const pictures = toolLabel('Pictures', {});
    expect(pictures?.chips?.map((c) => c.image)).toEqual([
      undefined,
      'https://example.test/favicon.ico',
    ]);
  });

  it('reads a log written before labels as it always did', () => {
    const old = {
      conversationId: 'c1',
      seq: 3,
      at: 1,
      type: 'tool.started',
      toolUseId: 't1',
      name: 'Bash',
      input: { command: 'ls' },
    };
    expect(ConversationEvent.parse(old)).toEqual(old);
    expect(
      ConversationEvent.parse({ ...old, type: 'tool.finished', status: 'success', seq: 4 }),
    ).not.toHaveProperty('label');
  });

  it('keeps a saved password out of the provider’s notes and every label', async () => {
    const redact = (text: string) => text.replace(/project|package|plan\.ts/g, '•••');
    const { events } = await chat('Please look around the project', redact);
    const said = events.filter((e) => e.type === 'narration');
    expect(said[0]).toMatchObject({ text: 'Looking at how the ••• is laid out' });
    const labels = events.flatMap((e) =>
      (e.type === 'tool.started' || e.type === 'tool.finished') && e.label ? [e.label] : [],
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(JSON.stringify(labels)).not.toMatch(/package|plan\.ts/);
    for (const event of events) expect(() => ConversationEvent.parse(event)).not.toThrow();
  });

  it('redacts a note before it’s cut, so half a password never shows', () => {
    const secret = 'hunter2hunter2';
    const raw = `${'x'.repeat(230)}${secret} and more after it`;
    const redact = (text: string) => text.replaceAll(secret, '•••');
    // Cut first, the password's first half would be left to show.
    expect(cleanNarration(raw)).toContain('hunter');
    const line = cleanNarration(redact(raw));
    expect(line).not.toContain('hunter');
    expect(line.length).toBeLessThanOrEqual(NARRATION_MAX);
  });

  it('redacts every word of a label within the protocol’s lengths', () => {
    const label = redactLabel(
      {
        family: 'run',
        doing: 'Running s3cr3t',
        done: 'Ran s3cr3t',
        outcome: 's3cr3t',
        subject: 'mysql -ps3cr3t',
        effects: [{ kind: 'other', text: 's3cr3t', target: 's3cr3t' }],
        chips: [{ kind: 'text', label: 's3cr3t', href: 'https://x.test/?k=s3cr3t' }],
      },
      (text) => text.replaceAll('s3cr3t', 'x'.repeat(400)),
    );
    expect(() => ToolLabel.parse(label)).not.toThrow();
    expect(JSON.stringify(label)).not.toContain('s3cr3t');
  });

  it('asks the provider for its notes only with small-model naming on', async () => {
    const off = await chat('Please look around the project');
    expect(off.runTurn.mock.calls[0]?.[0].narrate).toBeUndefined();
    const on = await chat('Please look around the project', undefined, true);
    expect(on.runTurn.mock.calls[0]?.[0].narrate).toBe(true);
  });
});
