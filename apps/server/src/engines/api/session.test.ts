import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_MESSAGES, sessionsDir, startsTurn, TranscriptStore, trim } from './session';
import type { WireMessage } from './types';

const turn = (n: number): WireMessage[] => [
  { role: 'user', content: `question ${n}` },
  { role: 'assistant', content: `answer ${n}` },
];

async function store(): Promise<{ store: TranscriptStore; dir: string }> {
  const home = await mkdtemp(join(tmpdir(), 'conch-api-'));
  const dir = sessionsDir(home);
  return { store: new TranscriptStore(dir), dir };
}

describe('the transcript on disk', () => {
  it('saves and replays the provider’s own messages, verbatim', async () => {
    const { store: sessions } = await store();
    const id = TranscriptStore.newId();
    const messages: WireMessage[] = [
      { role: 'user', content: 'Hello' },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'sig-abc' },
          { type: 'redacted_thinking', data: 'opaque' },
          { type: 'text', text: 'Hi' },
        ],
      },
    ];
    await sessions.save(id, { provider: 'anthropic-api', model: 'claude', messages });

    expect(await sessions.load(id, 'anthropic-api')).toEqual(messages);
  });

  // Windows has no POSIX modes; the user profile's permissions do this job there.
  it.skipIf(process.platform === 'win32')(
    'keeps a transcript as private as a chat (0600)',
    async () => {
      const { store: sessions, dir } = await store();
      const id = TranscriptStore.newId();
      await sessions.save(id, {
        provider: 'openrouter',
        messages: [{ role: 'user', content: 'x' }],
      });

      const mode = (await stat(join(dir, `${id}.json`))).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it('reads as empty rather than failing when the file is gone or corrupt', async () => {
    const { store: sessions, dir } = await store();
    const id = TranscriptStore.newId();
    expect(await sessions.load(id, 'openrouter')).toEqual([]);

    await sessions.save(id, { provider: 'openrouter', messages: [{ role: 'user', content: 'x' }] });
    await writeFile(join(dir, `${id}.json`), 'not json');
    expect(await sessions.load(id, 'openrouter')).toEqual([]);
  });

  it('never replays one provider’s messages to the other', async () => {
    const { store: sessions } = await store();
    const id = TranscriptStore.newId();
    await sessions.save(id, { provider: 'openrouter', messages: [{ role: 'user', content: 'x' }] });

    expect(await sessions.load(id, 'anthropic-api')).toEqual([]);
  });

  it('refuses an id that could become a path', async () => {
    const { store: sessions } = await store();
    for (const id of ['../escape', 'a/b', 'a.b', '', '..']) {
      expect(TranscriptStore.valid(id)).toBe(false);
      await expect(sessions.save(id, { provider: 'openrouter', messages: [] })).rejects.toThrow();
      expect(await sessions.load(id, 'openrouter')).toEqual([]);
    }
  });
});

describe('trimming a long transcript', () => {
  it('knows where a turn begins', () => {
    expect(startsTurn({ role: 'user', content: 'hi' })).toBe(true);
    expect(startsTurn({ role: 'assistant', content: 'hi' })).toBe(false);
    expect(startsTurn({ role: 'tool', tool_call_id: 't1', content: 'done' })).toBe(false);
    // Anthropic answers a tool call with a user message; that's mid-turn.
    expect(
      startsTurn({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }] }),
    ).toBe(false);
    expect(
      startsTurn({
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1' },
          { type: 'text', text: 'and this' },
        ],
      }),
    ).toBe(true);
  });

  it('keeps a safety net on the file: past the message cap, the oldest whole turns go', () => {
    const turns = MAX_MESSAGES / 2 + 5;
    const messages = Array.from({ length: turns }, (_, i) => turn(i)).flat();
    const kept = trim(messages);

    expect(kept.length).toBe(MAX_MESSAGES);
    expect(kept[0]).toEqual({ role: 'user', content: 'question 5' });
    expect(kept.at(-1)).toEqual({ role: 'assistant', content: `answer ${turns - 1}` });
  });

  it('drops by size too, and always leaves a user turn at the front', () => {
    const big = (n: number): WireMessage[] => [
      { role: 'user', content: `q${n}` },
      { role: 'assistant', content: 'x'.repeat(2_000_000) },
      { role: 'tool', tool_call_id: `t${n}`, content: 'y'.repeat(2_000_000) },
    ];
    const messages = Array.from({ length: 6 }, (_, i) => big(i)).flat();
    const kept = trim(messages);

    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(16_000_000);
    expect(startsTurn(kept[0] as WireMessage)).toBe(true);
  });

  it('leaves a short conversation exactly as it was', () => {
    const messages = [...turn(1), ...turn(2)];
    expect(trim(messages)).toEqual(messages);
  });

  it('writes back only what it kept, with each turn’s place still lined up', async () => {
    const { store: sessions } = await store();
    const id = TranscriptStore.newId();
    const turns = MAX_MESSAGES / 2 + 3;
    const messages = Array.from({ length: turns }, (_, i) => turn(i)).flat();
    const seqs = Array.from({ length: turns }, (_, i) => i * 10);

    const written = await sessions.save(id, { provider: 'openrouter', messages, seqs });
    expect(written.length).toBe(MAX_MESSAGES);
    const back = await sessions.open(id, 'openrouter');
    expect(back.messages).toEqual(written);
    expect(back.seqs[0]).toBe(30);
    expect(back.seqs).toHaveLength(MAX_MESSAGES / 2);
  });
});

describe('the summary kept with the transcript (ADR 0055)', () => {
  it('saves and reads back the summary, the turns’ places and the estimate’s correction', async () => {
    const { store: sessions } = await store();
    const id = TranscriptStore.newId();
    const messages: WireMessage[] = [
      { role: 'user', content: 'and then?' },
      { role: 'assistant', content: 'then this' },
    ];
    await sessions.save(id, {
      provider: 'openrouter',
      messages,
      summary: { text: 'Earlier: a garden plan.', turns: 4, at: 1 },
      seqs: [42],
      factor: 1.3,
    });

    expect(await sessions.open(id, 'openrouter')).toEqual({
      messages,
      summary: { text: 'Earlier: a garden plan.', turns: 4, at: 1 },
      seqs: [42],
      factor: 1.3,
    });
  });

  it('reads a file written before summaries existed as places unknown, not wrong', async () => {
    const { store: sessions, dir } = await store();
    const id = TranscriptStore.newId();
    const file = {
      version: 1,
      provider: 'openrouter',
      createdAt: 1,
      updatedAt: 1,
      messages: [...turn(1), ...turn(2)],
    };
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.json`), JSON.stringify(file));

    const back = await sessions.open(id, 'openrouter');
    expect(back.messages).toHaveLength(4);
    expect(back.seqs).toEqual([null, null]);
    expect(back.summary).toBeUndefined();
  });

  it('never trusts places that don’t line up with the turns', async () => {
    const { store: sessions } = await store();
    const id = TranscriptStore.newId();
    await sessions.save(id, { provider: 'openrouter', messages: [...turn(1)], seqs: [1, 2, 3] });
    expect((await sessions.open(id, 'openrouter')).seqs).toEqual([null]);
  });
});
