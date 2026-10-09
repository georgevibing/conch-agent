import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { clipHeadline, headlineOf, type Usage } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import type { CompletionInput, Engine } from '../engines/types';
import type { SmallPick } from '../providers/small';
import { SkillHeadlines } from '../skills/headlines';
import { mintConsent, NEW_MEMORY } from './consent';
import {
  cleanHeadline,
  Headliner,
  headlinePrompt,
  MemoryHeadlines,
  readHeadlines,
  type HeadlinerDeps,
} from './headline';
import { MemoryStore } from './store';

const temp = () => mkdtemp(join(tmpdir(), 'conch-headline-'));

const JOUDA =
  'George tracks his wife Jouda’s job search (started July 2026) in a JSON database at ~/.conch/workspace/jouda-report/data/jouda_job_search.json (README.md alongside explains the fields). When George asks to update it, search her mailbox from last_synced onward, merge into the JSON, and optionally regenerate the PDF.';
const PUSH =
  'When George says a conch-agent fix is ready, commit it on main and push it straight to origin without a pull request, then watch the CI run until it finishes and fix what fails.';
const USAGE: Usage = { inputTokens: 300, outputTokens: 40 } as Usage;

/** A pretend small model: answers with `answer(prompt)`, and says what it was asked. */
function small(answer: (input: CompletionInput) => string) {
  const engine = { id: 'mock', label: 'Mock' } as unknown as Engine;
  const asked: CompletionInput[] = [];
  const pick = vi.fn(async (): Promise<SmallPick> => ({
    small: {
      engine,
      model: 'tiny',
      complete: async (input) => {
        asked.push(input);
        return { text: answer(input), usage: USAGE };
      },
    },
  }));
  return { engine, asked, pick };
}

/** Numbered answers for however many it was asked about. */
const numbered = (lines: string[]) => (input: CompletionInput) =>
  input.prompt
    .split('\n')
    .map((_, i) => `${i + 1}. ${lines[i] ?? ''}`)
    .join('\n');

const person = (content: string) =>
  mintConsent({ method: 'POST', url: '/api/memories' }, 'add', { id: NEW_MEMORY, content });

function headliner(over: Partial<HeadlinerDeps> = {}) {
  const saved: [string, string, string][] = [];
  const spent = vi.fn();
  const h = new Headliner({
    of: 'memory',
    pick: async () => ({ not: 'none' }),
    spent,
    save: async (key, text, headline) => void saved.push([key, text, headline]),
    gatherMs: 60_000,
    ...over,
  });
  return { h, saved, spent };
}

describe('cleanHeadline', () => {
  it('takes a plain line, without quotes or a full stop', () => {
    expect(cleanHeadline('“Tracks Jouda’s job search in a JSON file.”', JOUDA)).toBe(
      'Tracks Jouda’s job search in a JSON file',
    );
    expect(cleanHeadline('Headline: Push fixes to main, then watch CI', PUSH)).toBe(
      'Push fixes to main, then watch CI',
    );
  });

  it('refuses a path, a link, code, nothing, or no shorter than the words', () => {
    expect(cleanHeadline('Keeps ~/.conch/workspace/jouda.json up to date', JOUDA)).toBeUndefined();
    expect(cleanHeadline('See https://example.com', JOUDA)).toBeUndefined();
    expect(cleanHeadline('Runs `git push`', PUSH)).toBeUndefined();
    expect(cleanHeadline('  ', JOUDA)).toBeUndefined();
    expect(cleanHeadline('Lives in Lisbon', 'Lives in Lisbon')).toBeUndefined();
  });

  it('clips one that runs long at a word', () => {
    const long =
      'Tracks the job search of Jouda in a database and keeps it up to date from her mail when asked to';
    const clean = cleanHeadline(long, JOUDA);
    expect(clean).toBe(clipHeadline(long));
    expect(clean?.length).toBeLessThanOrEqual(80);
  });
});

describe('readHeadlines', () => {
  it('reads numbered lines, however they are numbered', () => {
    const lines = readHeadlines('Here you go:\n1. First\n2) Second\n- 3: Third\n\n1. Again');
    expect([...lines]).toEqual([
      [1, 'First'],
      [2, 'Second'],
      [3, 'Third'],
    ]);
  });

  it('asks about each on a line of its own, words whole and on one line', () => {
    expect(headlinePrompt(['a\nb', 'c'])).toBe('1. a b\n2. c');
  });
});

describe('Headliner', () => {
  it('asks once, about several at a time, and counts what it cost', async () => {
    const model = small(
      numbered(['Tracks Jouda’s job search in a JSON file', 'Push fixes to main']),
    );
    const { h, saved, spent } = headliner({ pick: model.pick });
    h.want([
      { key: 'a', text: JOUDA },
      { key: 'b', text: PUSH },
      { key: 'short', text: 'Lives in Lisbon' },
    ]);
    await h.flush();
    expect(model.asked).toHaveLength(1);
    expect(model.asked[0]?.prompt.split('\n')).toHaveLength(2);
    expect(model.asked[0]?.system).toMatch(/same language/);
    expect(saved).toEqual([
      ['a', JOUDA, 'Tracks Jouda’s job search in a JSON file'],
      ['b', PUSH, 'Push fixes to main'],
    ]);
    expect(spent).toHaveBeenCalledWith(USAGE, model.engine, 'tiny');
    // The same words again: not asked again.
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    expect(model.asked).toHaveLength(1);
  });

  it('splits many into a few questions, one after another', async () => {
    const model = small(numbered(Array.from({ length: 8 }, (_, i) => `Headline number ${i}`)));
    const { h, saved } = headliner({ pick: model.pick, perAsk: 3 });
    h.want(Array.from({ length: 7 }, (_, i) => ({ key: `m${i}`, text: `${i} ${JOUDA}` })));
    await h.flush();
    expect(model.asked.map((a) => a.prompt.split('\n').length)).toEqual([3, 3, 1]);
    expect(saved).toHaveLength(7);
  });

  it('with nobody to ask, keeps nothing and asks again later', async () => {
    let now = 1_000;
    const model = small(numbered(['Tracks Jouda’s job search']));
    let open = false;
    const pick = vi.fn(async (): Promise<SmallPick> => (open ? model.pick() : { not: 'budget' }));
    const { h, saved, spent } = headliner({ pick, now: () => now, retryMs: 60_000 });
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    expect(saved).toEqual([]);
    expect(spent).not.toHaveBeenCalled();
    // Too soon: not asked.
    open = true;
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    expect(pick).toHaveBeenCalledTimes(1);
    now += 61_000;
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    expect(saved).toEqual([['a', JOUDA, 'Tracks Jouda’s job search']]);
  });

  it('an answer that isn’t a headline leaves the clipped words, for good', async () => {
    const model = small(() => '1. ~/.conch/workspace/jouda-report/data/jouda_job_search.json');
    const { h, saved } = headliner({ pick: model.pick });
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    expect(saved).toEqual([]);
    expect(model.asked).toHaveLength(1);
    expect(headlineOf({ content: JOUDA })).toBe('George tracks his wife Jouda’s job search');
  });

  it('a model that fails or takes too long is let go', async () => {
    const pick = async (): Promise<SmallPick> => ({
      small: {
        engine: {} as Engine,
        complete: (input) =>
          new Promise((_, reject) =>
            input.signal.addEventListener('abort', () => reject(new Error('slow'))),
          ),
      },
    });
    const { h, saved } = headliner({ pick, timeoutMs: 10 });
    h.want([{ key: 'a', text: JOUDA }]);
    await h.flush();
    expect(saved).toEqual([]);
  });
});

describe('MemoryHeadlines', () => {
  it('writes one when a memory is saved, kept with it for exactly its words', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const model = small(
      numbered(['Tracks Jouda’s job search in a JSON file, and how to update it']),
    );
    const headlines = new MemoryHeadlines(store, {
      pick: model.pick,
      spent: () => {},
      gatherMs: 0,
    });
    headlines.start();
    const m = await store.add({ content: JOUDA, source: 'user' }, person(JOUDA));
    await vi.waitFor(async () => expect((await store.get(m.id))?.headline).toBeDefined());
    await headlines.headliner.flush();
    const kept = await store.get(m.id);
    expect(kept?.headline).toBe('Tracks Jouda’s job search in a JSON file, and how to update it');
    // The words, the time and where it came from are as they were; what models read is the words.
    expect(kept).toEqual({ ...m, headline: kept?.headline });
    expect((await store.usable()).map((u) => u.id)).toEqual([m.id]);
    // Sealed with it: a fresh store reads it back.
    expect((await new MemoryStore(dir).get(m.id))?.headline).toBe(kept?.headline);
    // New words: the headline is for the old ones, so it goes (and a new one is written).
    const edited = await store.update(m.id, { content: PUSH }, person(PUSH));
    expect(edited?.headline).toBeUndefined();
  });

  it('writes none for one held or waiting: the person reads its own words', async () => {
    const store = new MemoryStore(await temp());
    const model = small(numbered(['Anything']));
    const headlines = new MemoryHeadlines(store, { pick: model.pick, spent: () => {} });
    const waiting = await store.add({ content: JOUDA, source: 'agent', pending: true });
    headlines.shown([waiting]);
    await headlines.headliner.flush();
    expect(model.asked).toEqual([]);
    expect(await store.setHeadline(waiting.id, JOUDA, 'Anything')).toBe(false);
  });

  it('backfills older memories when they are shown, in one question', async () => {
    const dir = await temp();
    const before = new MemoryStore(dir);
    const a = await before.add({ content: JOUDA, source: 'user' }, person(JOUDA));
    const b = await before.add({ content: PUSH, source: 'user' }, person(PUSH));
    await before.add({ content: 'Lives in Lisbon', source: 'user' }, person('Lives in Lisbon'));
    const store = new MemoryStore(dir);
    const model = small(numbered(['First headline', 'Second headline']));
    const headlines = new MemoryHeadlines(store, { pick: model.pick, spent: () => {} });
    headlines.start();
    await new Promise((r) => setTimeout(r, 10));
    // Already there: nothing asked until they're shown.
    await headlines.headliner.flush();
    expect(model.asked).toEqual([]);
    headlines.shown(await store.list());
    await headlines.headliner.flush();
    expect(model.asked).toHaveLength(1);
    const got = new Map((await store.list()).map((m) => [m.id, m.headline]));
    expect(got.get(a.id)).toBeDefined();
    expect(got.get(b.id)).toBeDefined();
    expect([...got.values()].filter(Boolean)).toHaveLength(2);
  });

  it('a headline in a file changed outside Conch isn’t believed', async () => {
    const dir = await temp();
    const store = new MemoryStore(dir);
    const m = await store.add({ content: JOUDA, source: 'user' }, person(JOUDA));
    await store.setHeadline(m.id, JOUDA, 'Tracks Jouda’s job search');
    const path = join(dir, `${m.id}.md`);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text.replace('Tracks Jouda’s job search', 'Prefers tea'));
    expect((await new MemoryStore(dir).get(m.id))?.headline).toBeUndefined();
  });
});

describe('SkillHeadlines', () => {
  it('fills the list from what was written, for the description as it is', async () => {
    const home = await temp();
    const model = small(numbered(['Push conch-agent fixes straight to main, then watch CI']));
    const changed = vi.fn();
    const skills = new SkillHeadlines({ home, pick: model.pick, spent: () => {}, changed });
    const skill = { id: 'push', description: PUSH } as never;
    const short = { id: 'tea', description: 'Make tea' } as never;
    expect(await skills.fill([skill, short])).toEqual([skill, short]);
    await skills.headliner.flush();
    expect(changed).toHaveBeenCalled();
    expect(model.asked).toHaveLength(1);
    const [filled] = await new SkillHeadlines({ home, pick: model.pick, spent: () => {} }).fill([
      skill,
    ]);
    expect(filled).toMatchObject({
      headline: 'Push conch-agent fixes straight to main, then watch CI',
    });
    // A new description: that headline isn't for it.
    const [other] = await skills.fill([{ id: 'push', description: `${PUSH} Always.` } as never]);
    expect(other).not.toHaveProperty('headline');
  });
});
