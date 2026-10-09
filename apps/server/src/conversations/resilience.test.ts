/**
 * How every assistant works on a problem (ADR 0102): the same words reach
 * every provider, in every permission mode, in plan mode and in a task, and
 * the forms for a small window or a model with no tools stay in step.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, EngineId, EngineStatus, PermissionMode } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { leanSystem } from '../engines/api/lean';
import { conchInstructions, preamble } from '../engines/acp/engine';
import type { Engine, EngineEvent, TurnInput } from '../engines/types';
import { MemoryStore } from '../memory/store';
import { SettingsStore } from '../settings/store';
import { ConversationManager } from './manager';
import {
  RESILIENCE_COMPACT,
  RESILIENCE_HEADING,
  RESILIENCE_PROMPT,
  RESILIENCE_WORDS,
  resiliencePrompt,
  withResilience,
} from './resilience';
import { ConversationStore } from './store';

const MODES: PermissionMode[] = ['default', 'auto', 'plan', 'bypassPermissions'];

/** Every kind of provider Conch drives: its own agents, the vendors' programs, APIs, local. */
const PROVIDERS: EngineId[] = [
  'claude-code',
  'codex-agent',
  'codex-cli',
  'copilot',
  'gemini-cli',
  'grok',
  'anthropic-api',
  'openrouter',
  'openai',
  'gemini',
  'ollama',
  'lm-studio',
  'mock',
];

class Recording implements Engine {
  readonly integrations = { mode: 'bridge' as const };
  readonly turns: TurnInput[] = [];
  constructor(
    readonly id: EngineId,
    readonly label: string,
    readonly hostTools?: boolean,
  ) {}
  async detect(): Promise<EngineStatus> {
    return {
      engine: this.id,
      label: this.label,
      state: 'ready',
      install: [],
      canSignIn: false,
      checkedAt: Date.now(),
    };
  }
  async capabilities(): Promise<Capabilities> {
    return {
      engine: this.id,
      label: this.label,
      models: [],
      commands: [],
      permissionModes: MODES,
    };
  }
  async *runTurn(input: TurnInput): AsyncIterable<EngineEvent> {
    this.turns.push(input);
    yield { type: 'session', resumeId: `${this.id}-${this.turns.length}`, model: 'm' };
    yield { type: 'text', messageId: `m${this.turns.length}`, delta: 'ok' };
    yield { type: 'done', outcome: 'success' };
  }
}

async function setup(chatOnly = false) {
  const home = await mkdtemp(join(tmpdir(), 'conch-resilience-'));
  const engines = new Map(
    PROVIDERS.map((id) => [
      id,
      new Recording(id, id, chatOnly && id === 'openrouter' ? false : undefined),
    ]),
  );
  const settings = new SettingsStore(home);
  await settings.update({ preferences: { engine: 'openrouter', autoTitle: false } });
  const manager = new ConversationManager({
    store: new ConversationStore(join(home, 'conversations')),
    settings,
    memory: new MemoryStore(join(home, 'memory')),
    engine: (id) => engines.get(id ?? 'openrouter') ?? (engines.get('openrouter') as Recording),
  });
  return { manager, engines };
}

async function idle(manager: ConversationManager, id: string) {
  for (let i = 0; i < 400; i++) {
    const { conversation } = await manager.detail(id);
    if (conversation.status === 'idle' || conversation.status === 'error') return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('never finished');
}

describe('how every assistant works on a problem', () => {
  it('is in the instructions of every provider, in every permission mode', async () => {
    const { manager, engines } = await setup();
    for (const id of PROVIDERS)
      for (const mode of MODES) {
        const convo = await manager.send({
          clientMessageId: `u-${id}-${mode}`,
          text: 'fix the build',
          options: { engine: id, permissionMode: mode },
        });
        await idle(manager, convo.id);
        const turn = engines.get(id)?.turns.at(-1);
        expect(turn?.systemAppend, `${id} in ${mode}`).toContain(RESILIENCE_PROMPT);
        expect(turn?.options.permissionMode, `${id} in ${mode}`).toBe(mode);
      }
  });

  it('comes right after who the assistant is, and the same every turn, so caches keep it', async () => {
    const { manager, engines } = await setup();
    const first = await manager.send({ clientMessageId: 'u1', text: 'one' });
    await idle(manager, first.id);
    await manager.send({ conversationId: first.id, clientMessageId: 'u2', text: 'two' });
    await idle(manager, first.id);
    const [a, b] = engines.get('openrouter')?.turns ?? [];
    const prefix = (s = '') => s.slice(0, s.indexOf(RESILIENCE_PROMPT) + RESILIENCE_PROMPT.length);
    expect(prefix(a?.systemAppend)).toBe(prefix(b?.systemAppend));
    expect(a?.systemAppend.indexOf('# Who you are')).toBeLessThan(
      a?.systemAppend.indexOf(RESILIENCE_HEADING) ?? -1,
    );
  });

  it('stays in plan mode beside its rules, and never tells the assistant to skip a question', async () => {
    const { manager, engines } = await setup();
    const convo = await manager.send({
      clientMessageId: 'u-plan',
      text: 'plan the fix',
      options: { permissionMode: 'plan' },
    });
    await idle(manager, convo.id);
    const system = engines.get('openrouter')?.turns.at(-1)?.systemAppend ?? '';
    expect(system).toContain(RESILIENCE_PROMPT);
    expect(system).toContain('<plan-mode>');
    // Persistence never outranks asking: the words keep the stops in.
    expect(RESILIENCE_PROMPT).toMatch(/approval Conch asks for/);
    expect(RESILIENCE_PROMPT).toMatch(/don’t look for another way to do the same thing/);
    expect(RESILIENCE_PROMPT).toMatch(
      /In plan mode, investigate as hard as ever, but change nothing/,
    );
    expect(RESILIENCE_PROMPT).not.toMatch(/don’t ask|never ask|without asking/i);
  });

  it('reaches a task too, beside its brief', async () => {
    const { manager, engines } = await setup();
    const { conversationId } = await manager.start({
      title: 'Look into it',
      text: 'look into the failing test',
      origin: { kind: 'task', taskId: 't1' },
      extras: { systemExtra: 'You are a helper working on one part of a bigger job.' },
    });
    await idle(manager, conversationId);
    const system = engines.get('openrouter')?.turns.at(-1)?.systemAppend ?? '';
    expect(system).toContain(RESILIENCE_PROMPT);
    expect(system).toContain('You are a helper');
  });

  it('is thinking it through for a model that can only chat, and for a guest', async () => {
    const { manager, engines } = await setup(true);
    const convo = await manager.send({ clientMessageId: 'u-words', text: 'why is the sky blue?' });
    await idle(manager, convo.id);
    const words = engines.get('openrouter')?.turns.at(-1)?.systemAppend ?? '';
    expect(words).toContain(RESILIENCE_WORDS);
    expect(words).not.toContain(RESILIENCE_PROMPT);

    const guest = await manager.send({
      clientMessageId: 'u-guest',
      text: 'hello',
      options: { engine: 'claude-code' },
      origin: { kind: 'channel', channelId: 'ch1', channel: 'telegram', guest: true },
    });
    await idle(manager, guest.id);
    const theirs = engines.get('claude-code')?.turns.at(-1)?.systemAppend ?? '';
    expect(theirs).toContain(RESILIENCE_WORDS);
    expect(theirs).not.toContain(RESILIENCE_PROMPT);
  });
});

describe('its forms', () => {
  it('are short enough for every model, the compact one shortest', () => {
    expect(RESILIENCE_PROMPT.length).toBeLessThan(2_600);
    expect(RESILIENCE_COMPACT.length).toBeLessThan(700);
    expect(RESILIENCE_WORDS.length).toBeLessThan(500);
    for (const form of [RESILIENCE_PROMPT, RESILIENCE_COMPACT, RESILIENCE_WORDS])
      expect(form.startsWith(`${RESILIENCE_HEADING}\n`)).toBe(true);
    expect(resiliencePrompt({ tools: true })).toBe(RESILIENCE_PROMPT);
    expect(resiliencePrompt({ tools: false })).toBe(RESILIENCE_WORDS);
  });

  it('say the same few things, in every form', () => {
    for (const form of [RESILIENCE_PROMPT, RESILIENCE_COMPACT]) {
      expect(form).toMatch(/read (the whole|the) error/);
      expect(form).toMatch(/never (repeat )?the (very )?same step/i);
      expect(form).toMatch(/Check (the result|your work)/);
      expect(form).toMatch(/what you tried, what’s in the way, and the one thing/);
      expect(form).toMatch(/Never claim a success you haven’t seen/);
    }
    expect(RESILIENCE_WORDS).toMatch(/Never invent facts/);
  });

  it('swaps in place, leaving every other section as it was', () => {
    const system = ['# Who you are\nYou are Pearl.', RESILIENCE_PROMPT, '## Browser\nUse it.'].join(
      '\n\n',
    );
    const compact = withResilience(system, 'compact');
    expect(compact).toBe(
      ['# Who you are\nYou are Pearl.', RESILIENCE_COMPACT, '## Browser\nUse it.'].join('\n\n'),
    );
    expect(withResilience(system, 'words')).toContain(RESILIENCE_WORDS);
    expect(withResilience('# Who you are\nhi', 'compact')).toBe('# Who you are\nhi');
    // At the very end, too.
    expect(withResilience(`a\n${RESILIENCE_PROMPT}`, 'compact')).toBe(`a\n${RESILIENCE_COMPACT}`);
  });

  it('goes compact in lean mode, and stays', () => {
    const system = ['# Who you are\nYou are Pearl.', RESILIENCE_PROMPT, '## Browser\nLong.'].join(
      '\n\n',
    );
    const lean = leanSystem(system, { tools: true });
    expect(lean).toContain(RESILIENCE_COMPACT);
    expect(lean).not.toContain(RESILIENCE_PROMPT);
    expect(lean).not.toContain('## Browser');
    expect(leanSystem(system, { tools: false })).toContain(RESILIENCE_WORDS);
  });

  it('reaches the vendors’ programs whole (Copilot, Gemini CLI, Grok)', () => {
    const system = `# Who you are\nYou are Pearl.\n\n${RESILIENCE_PROMPT}`;
    expect(conchInstructions(system, true)).toContain(RESILIENCE_PROMPT);
    expect(preamble(system, false)).toContain(RESILIENCE_PROMPT);
  });
});
