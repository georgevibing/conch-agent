import { describe, expect, it } from 'vitest';

import { skillHolds } from './holds';
import type { ConversationEvent } from './index';

const at = { conversationId: 'c1', at: 0 };
const git = {
  declared: true,
  capabilities: ['commands' as const],
  commands: ['git'],
  words: ['run commands (only `git`)'],
};
const used = (seq: number, skillId: string, extra: Partial<ConversationEvent> = {}) =>
  ({
    ...at,
    seq,
    type: 'skill.used',
    skillId,
    name: skillId,
    title: skillId,
    by: 'user',
    permissions: git,
    ...extra,
  }) as ConversationEvent;
const ended = (seq: number, skillId: string) =>
  ({ ...at, seq, type: 'skill.hold.ended', skillId, title: skillId, reason: 'you' }) as const;

describe('what a chat is held to', () => {
  it('holds every skill used, in every later turn, until you end it', () => {
    const events = [
      used(0, 'setup'),
      { ...at, seq: 1, type: 'turn.completed', outcome: 'success' } as const,
      used(2, 'weekly'),
    ];
    expect(skillHolds(events).map((h) => h.skillId)).toEqual(['setup', 'weekly']);
    expect(skillHolds([...events, ended(3, 'setup')]).map((h) => h.skillId)).toEqual(['weekly']);
  });

  it('a skill used again after you ended it is held again', () => {
    expect(skillHolds([used(0, 'setup'), ended(1, 'setup'), used(2, 'setup')])).toHaveLength(1);
  });

  it('the same list twice is one hold; a changed list is held as well', () => {
    expect(skillHolds([used(0, 'setup'), used(1, 'setup')])).toHaveLength(1);
    const wider = { ...git, commands: undefined, words: ['run commands'] };
    expect(skillHolds([used(0, 'setup'), used(1, 'setup', { permissions: wider })])).toHaveLength(
      2,
    );
  });

  it('says where a carried one came from', () => {
    expect(skillHolds([used(0, 'setup', { by: 'carried', from: 'c0' })])).toMatchObject([
      { skillId: 'setup', from: 'c0', permissions: git },
    ]);
  });
});
