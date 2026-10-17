import { SkillUpdate, Text } from '@conch/nacre';
import type { ToolView } from '@conch/protocol';
import { useState } from 'react';

import { errorText, useSkill, useUpdateSkill } from './queries';

/** The proposal replays with the tool result; the saved skill is the source of truth. */
export function SkillUpdateInChat({ view }: { view: Extract<ToolView, { kind: 'skill-update' }> }) {
  const { data: skill, isPending, isError, refetch } = useSkill(view.skillId);
  const update = useUpdateSkill();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return <Text>Skill update put aside</Text>;
  if (isPending) return <Text role="status">Loading skill update…</Text>;
  const saved = skill?.instructions === view.instructions;
  const state = saved
    ? 'saved'
    : update.isPending
      ? 'saving'
      : isError || !skill?.editable
        ? 'unavailable'
        : skill.review?.hash !== view.expectedHash
          ? 'stale'
          : 'ready';
  return (
    <SkillUpdate
      title={skill?.title ?? view.title}
      summary={view.summary}
      before={view.before}
      instructions={view.instructions}
      warnings={view.warnings}
      state={state}
      error={
        update.isError ? errorText(update.error, 'Couldn’t save the update. Try again.') : undefined
      }
      onDismiss={() => setDismissed(true)}
      onUpdate={() =>
        update.mutate(
          {
            id: view.skillId,
            patch: { instructions: view.instructions, expectedHash: view.expectedHash },
          },
          {
            onError: () => {
              void refetch();
            },
          },
        )
      }
    />
  );
}
