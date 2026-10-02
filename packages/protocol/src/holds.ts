/**
 * What a chat is held to (ADR 0047). Once a skill's instructions are in a
 * chat (`skill.used`), they stay in its context, so the chat is held to that
 * skill's list in every later turn, not just the one it came in, until you
 * say otherwise (`skill.hold.ended`). Several are held together: a call must
 * be on every list (the strictest). Read from the chat's own log, so a
 * restart, a reload and every device agree.
 */
import type { ConversationEvent } from './index';
import type { SkillPermissions } from './skills';

export interface SkillHold {
  skillId: string;
  name: string;
  title: string;
  /** Its list as it came into the chat; unset in chats from before ADR 0047 (ask the skill). */
  permissions?: SkillPermissions;
  /** Where in the log its instructions came in. */
  seq: number;
  /** Came with a task from another chat, or back from a helper: that chat's id. */
  from?: string;
}

/** What's held after one more event: the gateway and the web fold the log the same way. */
export function foldHolds(
  holds: readonly SkillHold[],
  event: ConversationEvent,
): readonly SkillHold[] {
  if (event.type === 'skill.hold.ended') return holds.filter((h) => h.skillId !== event.skillId);
  if (event.type !== 'skill.used') return holds;
  // The same list again changes nothing; a changed one is held as well.
  const same = JSON.stringify(event.permissions ?? null);
  if (
    holds.some((h) => h.skillId === event.skillId && JSON.stringify(h.permissions ?? null) === same)
  )
    return holds;
  return [
    ...holds,
    {
      skillId: event.skillId,
      name: event.name,
      title: event.title,
      ...(event.permissions && { permissions: event.permissions }),
      seq: event.seq,
      ...(event.from && { from: event.from }),
    },
  ];
}

export function skillHolds(events: readonly ConversationEvent[]): readonly SkillHold[] {
  return events.reduce<readonly SkillHold[]>(foldHolds, []);
}
