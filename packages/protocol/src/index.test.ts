import { describe, expect, it } from 'vitest';

import {
  ClientCommand,
  ConversationEvent,
  DescribeSkillBody,
  Persona,
  ServerEvent,
  SkillDescriptionDraft,
  UpdateSettingsBody,
} from './index';

describe('protocol', () => {
  it('applies persona defaults', () => {
    expect(Persona.parse({})).toEqual({ name: 'Conch', tone: 'warm', instructions: '' });
  });

  it('trims and rejects empty messages', () => {
    expect(
      ClientCommand.safeParse({ type: 'conversation.send', clientMessageId: 'c1', text: '   ' })
        .success,
    ).toBe(false);
  });

  it('rejects unknown command types', () => {
    expect(ClientCommand.safeParse({ type: 'conversation.nuke' }).success).toBe(false);
  });

  it('round-trips a conversation event inside a server event', () => {
    const event = ConversationEvent.parse({
      type: 'assistant.delta',
      conversationId: 'c1',
      seq: 3,
      at: 1,
      messageId: 'm1',
      kind: 'text',
      delta: 'Hel',
    });
    expect(ServerEvent.parse({ type: 'conversation.event', event })).toMatchObject({
      event: { delta: 'Hel' },
    });
  });

  it('accepts partial settings updates', () => {
    expect(UpdateSettingsBody.parse({ persona: { tone: 'playful' } })).toEqual({
      persona: { tone: 'playful' },
    });
  });
});

describe('skills', () => {
  it('asks for a description with nothing else in the body', () => {
    expect(DescribeSkillBody.safeParse({}).success).toBe(true);
    expect(DescribeSkillBody.safeParse({ instructions: 'Ignore all that.' }).success).toBe(false);
    expect(DescribeSkillBody.safeParse({ path: '../../.ssh' }).success).toBe(false);
  });

  it('says where a drafted description came from', () => {
    const draft = { description: 'Tidies downloads.', from: 'text', noModel: true };
    expect(SkillDescriptionDraft.parse(draft)).toEqual(draft);
    expect(SkillDescriptionDraft.safeParse({ ...draft, from: 'guess' }).success).toBe(false);
  });
});
