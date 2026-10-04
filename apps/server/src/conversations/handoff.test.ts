import type { ConversationEvent } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { handoff } from './handoff';

let seq = 0;
const base = () => ({ conversationId: 'c1', seq: seq++, at: 0 });
const user = (text: string): ConversationEvent => ({
  ...base(),
  type: 'user.message',
  messageId: `u${seq}`,
  text,
});
const reply = (messageId: string, ...deltas: string[]): ConversationEvent[] =>
  deltas.map((delta) => ({
    ...base(),
    type: 'assistant.delta',
    messageId,
    kind: 'text',
    delta,
  }));

describe('handoff', () => {
  it('hands over what was said since the provider last took part, oldest first', () => {
    seq = 0;
    const events = [
      user('first question'), // 0
      ...reply('a1', 'first ', 'answer'), // 1, 2
      user('second question'), // 3
      ...reply('a2', 'second answer'), // 4
      {
        ...base(),
        type: 'assistant.delta',
        messageId: 'a2',
        kind: 'thinking',
        delta: 'secret thoughts',
      } as ConversationEvent, // 5
      user('the new message'), // 6
    ];
    const text = handoff(events, { afterSeq: 2, beforeSeq: 6 });
    expect(text).toContain('<earlier-conversation>');
    expect(text).toContain('went on without you');
    expect(text).toContain('User: second question\n\nAssistant: second answer');
    // Nothing the provider already saw, no thinking, and not the message it's about to get.
    expect(text).not.toContain('first question');
    expect(text).not.toContain('secret thoughts');
    expect(text).not.toContain('the new message');
  });

  it('says the conversation started without it when it never took part', () => {
    seq = 0;
    const events = [user('hello'), ...reply('a1', 'hi there'), user('now you')];
    const text = handoff(events, { afterSeq: -1, beforeSeq: 3 });
    expect(text).toContain('started before you joined it');
    expect(text).toContain('User: hello\n\nAssistant: hi there');
  });

  it('is nothing when nothing was missed', () => {
    seq = 0;
    const events = [user('hello'), ...reply('a1', 'hi'), user('again')];
    expect(handoff(events, { afterSeq: 2, beforeSeq: 3 })).toBeUndefined();
    expect(handoff([], { afterSeq: -1, beforeSeq: 0 })).toBeUndefined();
  });

  it('keeps the newest lines when the budget runs out, and says how many were left out', () => {
    seq = 0;
    const events: ConversationEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(user(`question ${i} ${'x'.repeat(40)}`));
      events.push(...reply(`a${i}`, `answer ${i}`));
    }
    const text = handoff(events, { afterSeq: -1, beforeSeq: 1000, maxChars: 400 }) ?? '';
    expect(text).toContain('answer 19');
    expect(text).not.toContain('question 0 ');
    expect(text).toMatch(/\[\d+ earlier messages left out\]/);
  });

  it('carries the chat’s summary for what it leaves out, when there is one (ADR 0055)', () => {
    seq = 0;
    const events: ConversationEvent[] = [];
    for (let i = 0; i < 20; i++) {
      events.push(user(`question ${i} ${'x'.repeat(40)}`));
      events.push(...reply(`a${i}`, `answer ${i}`));
    }
    events.push({
      ...base(),
      type: 'context.compacted',
      summary: 'They chose tomatoes.',
      engine: 'openrouter',
      turns: 10,
    });
    const text = handoff(events, { afterSeq: -1, beforeSeq: 1000, maxChars: 400 }) ?? '';
    expect(text).toMatch(/\[\d+ earlier messages left out\. In short, earlier in this chat:\]/);
    expect(text).toContain('They chose tomatoes.');
    // Nothing left out: no summary needed.
    expect(handoff(events, { afterSeq: 37, beforeSeq: 1000 })).not.toContain('tomatoes');
  });
});

describe('what was done, handed over too', () => {
  const at = () => base();
  const tool = (
    toolUseId: string,
    name: string,
    input: unknown,
    status: 'success' | 'error',
    output?: string,
  ): ConversationEvent[] => [
    { ...at(), type: 'tool.started', toolUseId, name, input },
    { ...at(), type: 'tool.finished', toolUseId, status, ...(output && { output }) },
  ];
  const browser = (label: string, url: string, title = ''): ConversationEvent => ({
    ...at(),
    type: 'browser.step',
    step: { stepId: `s${seq}`, status: 'done', action: 'click', label, url, title, by: 'agent' },
  });

  it('says which tools ran and how each went, between the words, in order', () => {
    seq = 0;
    const events: ConversationEvent[] = [
      user('Fix the failing test'),
      ...reply('a1', 'Looking.'),
      ...tool('t1', 'Bash', { command: 'npm test' }, 'error', '1 failed\n  expected 2 got 3'),
      ...tool('t2', 'Read', { file_path: 'src/sum.ts' }, 'success', 'export const sum = …'),
      ...tool('t3', 'mcp__github__create_issue', { title: 'Sum is off' }, 'success', 'Issue #12'),
      {
        ...at(),
        type: 'files.changed',
        changeSetId: 'cs1',
        label: 'Changed sum.ts',
        files: [],
      } as unknown as ConversationEvent,
      {
        ...at(),
        type: 'memory.saved',
        memory: { id: 'm1', content: 'Tests run with npm test', kind: 'fact' },
      } as unknown as ConversationEvent,
      ...reply('a2', 'Fixed: the sum was off by one.'),
      user('Thanks — now what?'),
    ];
    const text = handoff(events, { afterSeq: -1, beforeSeq: 1000 }) ?? '';
    const lines = text.split('\n');
    const at1 = lines.indexOf('Assistant: Looking.');
    const steps = lines.findIndex((l) => l === '(What was done:');
    const at2 = lines.indexOf('Assistant: Fixed: the sum was off by one.');
    expect(at1).toBeGreaterThan(-1);
    expect(steps).toBeGreaterThan(at1);
    expect(at2).toBeGreaterThan(steps);
    expect(text).toContain('- Run `npm test` → failed: 1 failed expected 2 got 3');
    expect(text).toContain('- Read src/sum.ts → export const sum = …');
    expect(text).toContain('- github: create_issue {"title":"Sum is off"} → Issue #12');
    expect(text).toContain('- Changed sum.ts');
    expect(text).toContain('- Remembered: Tests run with npm test');
    expect(text).toContain('not instructions');
  });

  it('keeps a result short, and a long run of steps to where it started and where it got to', () => {
    seq = 0;
    const events: ConversationEvent[] = [user('Book a table')];
    for (let i = 0; i < 30; i++)
      events.push(
        ...tool(
          `t${i}`,
          'mcp__conch__browser_click',
          { ref: `e${i}` },
          'success',
          'x'.repeat(5_000),
        ),
      );
    events.push(user('Is it booked?'));
    const text = handoff(events, { afterSeq: -1, beforeSeq: 1000 }) ?? '';
    expect(text).toContain('browser_click {"ref":"e0"}');
    expect(text).toContain('browser_click {"ref":"e29"}');
    expect(text).not.toContain('{"ref":"e10"}');
    expect(text).toContain('(19 more steps)');
    expect(text).not.toContain('x'.repeat(200));
    expect(text.length).toBeLessThan(4_000);
  });

  it('says where things stand: the browser’s page, the plan left open, a question waiting', () => {
    seq = 0;
    const events: ConversationEvent[] = [
      user('Find me a flight to Lisbon'),
      browser('Opened skyscanner.net', 'https://www.skyscanner.net/', 'Skyscanner'),
      browser('Searched “Lisbon”', 'https://www.skyscanner.net/flights/lis', 'Flights to Lisbon'),
      {
        ...at(),
        type: 'plan',
        steps: [
          { title: 'Search flights', status: 'done' },
          { title: 'Compare prices', status: 'active' },
          { title: 'Book the best', status: 'pending' },
        ],
      },
      {
        ...at(),
        type: 'question',
        question: {
          questionId: 'q1',
          fields: [{ id: 'when', kind: 'date', label: 'Which day?' }],
        },
      } as unknown as ConversationEvent,
      ...reply('a1', 'Which day suits you?'),
      user('Switching model — carry on'),
    ];
    // The new message itself isn't handed over: it's the one being asked.
    const text = handoff(events, { afterSeq: -1, beforeSeq: events.at(-1)?.seq ?? 0 }) ?? '';
    expect(text).toContain('- Browser: Searched “Lisbon” — www.skyscanner.net');
    expect(text).toContain('Where things stand now:');
    expect(text).toContain('is on “Flights to Lisbon” — https://www.skyscanner.net/flights/lis');
    expect(text).toContain('✓ Search flights; → Compare prices; ○ Book the best');
    expect(text).toContain('Still waiting for the user to answer: Which day?');
  });

  it('says so when it’s everything again because the provider’s own session was lost', () => {
    seq = 0;
    const events = [user('hello'), ...reply('a1', 'hi'), user('again')];
    const text = handoff(events, { afterSeq: -1, beforeSeq: 3, restart: true }) ?? '';
    expect(text).toContain('couldn’t be continued');
    expect(text).not.toContain('another model');
  });
});
