import { describe, expect, it } from 'vitest';

import {
  ClientCommand,
  ConversationEvent,
  DescribeSkillBody,
  Persona,
  Preferences,
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

  it('reads preferences saved before limits could be put away, and keeps the field optional', () => {
    expect(Preferences.parse({}).limitsPutAway).toEqual([]);
    const put = { engine: 'claude-code', window: 'weekly', resetsAt: 1 };
    expect(UpdateSettingsBody.parse({ preferences: { limitsPutAway: [put] } }).preferences).toEqual(
      { limitsPutAway: [put] },
    );
  });

  it('accepts partial settings updates', () => {
    expect(UpdateSettingsBody.parse({ persona: { tone: 'playful' } })).toEqual({
      persona: { tone: 'playful' },
    });
  });
});

describe('connect from chat', () => {
  const logged = { conversationId: 'c1', seq: 4, at: 1 };

  it('carries what the card needs, and nothing that could become a path', () => {
    const offer = {
      ...logged,
      type: 'integration.suggestion',
      catalogId: 'linear',
      name: 'Linear',
      description: 'Find, create and update issues and projects.',
      color: '#5E6AD2',
    };
    expect(ConversationEvent.parse(offer)).toEqual(offer);
    // An offer logged before ADR 0049 still reads; the old Zapier detour is just left out.
    expect(ConversationEvent.parse({ ...offer, via: 'zapier' })).toEqual(offer);
    for (const catalogId of ['../linear', 'Linear', '', 'linear/1'])
      expect(ConversationEvent.safeParse({ ...offer, catalogId }).success).toBe(false);
    expect(ConversationEvent.safeParse({ ...offer, color: 'red; x' }).success).toBe(false);
    expect(
      ConversationEvent.parse({
        ...logged,
        type: 'integration.suggestion.dismissed',
        catalogId: 'linear',
      }),
    ).toMatchObject({ catalogId: 'linear' });
  });

  it('remembers each muted app once', () => {
    expect(
      UpdateSettingsBody.parse({
        preferences: { mutedSuggestions: ['linear', 'notion', 'linear'] },
      }).preferences?.mutedSuggestions,
    ).toEqual(['linear', 'notion']);
    expect(
      UpdateSettingsBody.safeParse({ preferences: { mutedSuggestions: ['../etc'] } }).success,
    ).toBe(false);
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
