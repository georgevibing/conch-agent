import type { SkillHold as Hold } from '@conch/protocol';
import { SkillHold, toast, type SkillHoldEntry } from '@conch/nacre';

import { api } from '../../api/client';
import { useUi } from '../../app/ui';
import { useSkills } from './queries';

/** The list a hold is held to: the one it came in with, or (older chats) the skill's own. */
function entryOf(hold: Hold, fallback?: SkillHoldEntry): SkillHoldEntry {
  const permissions = hold.permissions;
  if (!permissions && fallback) return { ...fallback, skillId: hold.skillId, title: hold.title };
  return {
    skillId: hold.skillId,
    title: hold.title,
    declared: permissions?.declared ?? false,
    capabilities: permissions?.capabilities ?? ['files', 'web'],
    words: permissions?.words ?? ['change files in your work folder', 'read the web'],
  };
}

/** One per skill (the newest list it came in with), for the line above the composer. */
export function holdEntries(
  holds: readonly Hold[],
  known: (skillId: string) => SkillHoldEntry | undefined = () => undefined,
): SkillHoldEntry[] {
  const bySkill = new Map<string, SkillHoldEntry>();
  for (const hold of holds) bySkill.set(hold.skillId, entryOf(hold, known(hold.skillId)));
  return [...bySkill.values()];
}

/**
 * What this chat is held to (ADR 0047), above the composer. Stopping is a
 * person's choice: it asks once, and the chat and Activity say it happened.
 */
export function ChatHolds({
  conversationId,
  holds,
  running,
}: {
  conversationId: string;
  holds: readonly Hold[];
  running: boolean;
}) {
  const { data: skills } = useSkills();
  const asking = useUi((s) =>
    s.stopHolding?.conversationId === conversationId ? s.stopHolding.skillId : undefined,
  );
  const entries = holdEntries(holds, (skillId) => {
    const skill = skills?.skills.find((s) => s.id === skillId);
    return skill?.permissions
      ? {
          skillId,
          title: skill.title,
          declared: skill.permissions.declared,
          capabilities: skill.permissions.capabilities,
          words: skill.permissions.words,
        }
      : undefined;
  });
  return (
    <SkillHold
      holds={entries}
      busy={running}
      asking={asking}
      onAskingChange={(skillId) =>
        useUi.setState({ stopHolding: skillId ? { conversationId, skillId } : undefined })
      }
      onStop={async (skillId) => {
        try {
          await api.stopHolding(conversationId, skillId);
        } catch (error) {
          toast.error((error as Error).message);
          throw error;
        }
      }}
    />
  );
}
