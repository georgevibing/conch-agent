import { describe, expect, it } from 'vitest';

import {
  AGENT_LIMITS,
  AgentDefaults,
  AgentId,
  CreateAgentBody,
  FIRST_AGENT_ID,
  TONES,
  Tone,
  UpdateAgentBody,
  aboutTokens,
  agentImageUrl,
  chatAgentId,
  findAgent,
  instructionsWeight,
  roughTokens,
  speakersAlong,
} from './agents';
import { ClientCommand, ConversationEvent, ServerEvent, UpdateConversationBody } from './index';

const list = (ids: string[], defaultId: string) => ({
  agents: ids.map((id) => ({ id: id as AgentId })),
  defaultId: defaultId as AgentId,
});

describe('agents on the wire', () => {
  it('ids are never paths', () => {
    expect(AgentId.safeParse(FIRST_AGENT_ID).success).toBe(true);
    for (const bad of ['ag_', 'ag_..', 'ag_a/b/c/d', '../ag_abcd', 'c_abcdef', 'ag_a b c'])
      expect(AgentId.safeParse(bad).success, bad).toBe(false);
    expect(agentImageUrl('ag_sage01', 'im_abcd01')).toBe('/api/agents/ag_sage01/avatar/im_abcd01');
  });

  it('a new agent has careful defaults, and its limits hold', () => {
    const body = CreateAgentBody.parse({ name: '  Sage ' });
    expect(body).toEqual({
      name: 'Sage',
      role: '',
      avatar: { kind: 'preset', id: 'shell' },
      persona: { tone: 'warm', personality: '' },
      instructions: '',
    });
    expect(CreateAgentBody.safeParse({ name: 'x'.repeat(AGENT_LIMITS.name + 1) }).success).toBe(
      false,
    );
    expect(
      CreateAgentBody.safeParse({
        name: 'A',
        instructions: 'x'.repeat(AGENT_LIMITS.instructions + 1),
      }).success,
    ).toBe(false);
    expect(CreateAgentBody.safeParse({ name: 'A', role: 'x'.repeat(121) }).success).toBe(false);
    expect(CreateAgentBody.safeParse({ name: 'A', extra: 1 }).success).toBe(false);
  });

  it('an agent never carries Full trust, and a model needs its provider', () => {
    expect(AgentDefaults.safeParse({ permissionMode: 'bypassPermissions' }).success).toBe(false);
    expect(AgentDefaults.safeParse({ permissionMode: 'auto' }).success).toBe(true);
    expect(AgentDefaults.safeParse({ model: 'gpt-5' }).success).toBe(false);
    expect(AgentDefaults.safeParse({ engine: 'openai', model: 'gpt-5' }).success).toBe(true);
  });

  it('a change says what changes, and a picture of its own comes only through its route', () => {
    expect(UpdateAgentBody.safeParse({}).success).toBe(false);
    expect(UpdateAgentBody.safeParse({ defaults: null }).success).toBe(true);
    expect(
      UpdateAgentBody.safeParse({
        avatar: { kind: 'image', id: 'im_abcd', type: 'image/png', url: '/x' },
      }).success,
    ).toBe(false);
  });

  it('every tone has its words', () => {
    for (const tone of Tone.options) {
      expect(TONES[tone].label).toBeTruthy();
      expect(TONES[tone].prompt.length).toBeGreaterThan(20);
    }
  });

  it('the socket and the chat carry them', () => {
    expect(
      ClientCommand.safeParse({
        type: 'conversation.send',
        clientMessageId: 'm1',
        text: 'hi',
        agentId: 'ag_sage01',
      }).success,
    ).toBe(true);
    expect(UpdateConversationBody.safeParse({ agentId: 'ag_sage01' }).success).toBe(true);
    expect(
      ConversationEvent.safeParse({
        type: 'agent',
        conversationId: 'c_1',
        seq: 3,
        at: 1,
        agentId: 'ag_sage01',
        name: 'Sage',
        from: { agentId: FIRST_AGENT_ID, name: 'Conch' },
      }).success,
    ).toBe(true);
    expect(ServerEvent.options.some((o) => o.shape.type.value === 'agents.changed')).toBe(true);
  });
});

describe('who answers', () => {
  it('a chat is with its own agent, the first one from before agents, else the default', () => {
    const agents = list([FIRST_AGENT_ID, 'ag_sage01'], 'ag_sage01');
    expect(chatAgentId({ agentId: 'ag_sage01' }, agents)).toBe('ag_sage01');
    expect(chatAgentId({}, agents)).toBe(FIRST_AGENT_ID);
    expect(chatAgentId(undefined, agents)).toBe(FIRST_AGENT_ID);
    // Its agent is gone: the default answers, not the first.
    expect(chatAgentId({ agentId: 'ag_gone01' }, agents)).toBe('ag_sage01');
    expect(chatAgentId({}, list(['ag_sage01'], 'ag_sage01'))).toBe('ag_sage01');
  });

  it('who spoke each part of a chat, from its log', () => {
    const at = { conversationId: 'c_1', at: 1 };
    const events: ConversationEvent[] = [
      { ...at, seq: 0, type: 'user.message', messageId: 'u1', text: 'hi' },
      { ...at, seq: 1, type: 'assistant.done', messageId: 'a1' },
      {
        ...at,
        seq: 2,
        type: 'agent',
        agentId: 'ag_sage01',
        name: 'Sage',
        from: { agentId: FIRST_AGENT_ID, name: 'Shelly' },
      },
      { ...at, seq: 3, type: 'assistant.done', messageId: 'a2' },
    ];
    const speakers = speakersAlong(events, { agentId: 'ag_sage01', name: 'Sage' });
    expect(speakers.map((s) => s.name)).toEqual(['Shelly', 'Shelly', 'Sage', 'Sage']);
    // A log that says nothing: the chat's own agent throughout.
    expect(speakersAlong(events.slice(0, 2), { agentId: FIRST_AGENT_ID, name: 'Conch' })).toEqual([
      { agentId: FIRST_AGENT_ID, name: 'Conch' },
      { agentId: FIRST_AGENT_ID, name: 'Conch' },
    ]);
  });

  it('finds an agent by name or id: exact first, then the start of a name', () => {
    const agents = [
      { id: 'ag_sage01', name: 'Sage' },
      { id: 'ag_sagex1', name: 'Sagebrush' },
      { id: 'ag_milo01', name: 'Milo' },
    ];
    expect(findAgent(agents, 'sage')?.id).toBe('ag_sage01');
    expect(findAgent(agents, 'SAGEB')?.id).toBe('ag_sagex1');
    expect(findAgent(agents, 'ag_milo01')?.name).toBe('Milo');
    expect(findAgent(agents, 'mi')?.name).toBe('Milo');
    expect(findAgent(agents, '')).toBeUndefined();
    expect(findAgent(agents, 'nobody')).toBeUndefined();
  });
});

describe('how heavy instructions are (ADR 0101)', () => {
  it('lets a handbook of 30,000 characters and more through, up to 100,000', () => {
    const big = 'Rule: be kind. '.repeat(2_000);
    expect(big.length).toBe(30_000);
    expect(CreateAgentBody.safeParse({ name: 'A', instructions: big }).success).toBe(true);
    expect(AGENT_LIMITS.instructions).toBe(100_000);
  });

  it('counts about four characters a token, and one for anything else', () => {
    expect(roughTokens('abcd'.repeat(10))).toBe(10);
    expect(roughTokens('日本語')).toBe(3);
  });

  it('is fine for a few lines, long from ≈4k tokens, crowded past a tenth of the window', () => {
    expect(instructionsWeight('Use British spelling.').level).toBe('fine');
    expect(instructionsWeight('x'.repeat(15_996)).level).toBe('fine');
    expect(instructionsWeight('x'.repeat(16_000))).toEqual({ tokens: 4_000, level: 'long' });
    // A small model feels much less: ≈1k tokens is a tenth of an 8k window.
    expect(instructionsWeight('x'.repeat(4_000), 8_192).level).toBe('crowded');
    expect(instructionsWeight('x'.repeat(3_200), 8_192).level).toBe('fine');
    // A big window: only long when they're long.
    expect(instructionsWeight('x'.repeat(40_000), 200_000).level).toBe('long');
    expect(instructionsWeight('x'.repeat(100_000), 200_000).level).toBe('crowded');
  });

  it('says a size a person can picture', () => {
    expect(aboutTokens(9_200)).toBe('≈9k tokens');
    expect(aboutTokens(812)).toBe('≈810 tokens');
    expect(aboutTokens(3)).toBe('≈10 tokens');
  });
});
