import { Button, SkillShelf, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { skillsApi } from './api';
import { errorText, skillKeys, useSkillShelf } from './queries';

const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });

/** “two months”, from the gateway's count of days. */
function period(days: number) {
  const months = Math.round(days / 30);
  if (months >= 2) {
    const words = ['two', 'three', 'four', 'five', 'six'];
    return `${words[months - 2] ?? months} months`;
  }
  return `${days} days`;
}

/**
 * A tidy shelf (ADR 0058): skills Conch put here that sit unused, offered to
 * turn off together. Turned off they stay listed (under **Off**), backed up,
 * and one switch away. Nothing changes until you press.
 */
export function SkillShelfCard() {
  const { data } = useSkillShelf();
  const client = useQueryClient();
  const [busy, setBusy] = useState<'off' | 'keep'>();
  const stale = data?.stale ?? [];
  if (!stale.length || !data) return null;
  const one = stale.length === 1;

  const answer = async (action: 'off' | 'keep') => {
    setBusy(action);
    try {
      const { changed } = await skillsApi.tidyShelf(
        action,
        stale.map((s) => s.id),
      );
      if (action === 'off' && changed)
        toast.success(changed === 1 ? 'Turned it off' : `Turned off ${changed} skills`, {
          description: `${changed === 1 ? 'It’s' : 'They’re'} under Off on this page. One switch brings ${changed === 1 ? 'it' : 'each'} back.`,
        });
      client.setQueryData(skillKeys.shelf, { ...data, stale: [] });
      void client.invalidateQueries({ queryKey: skillKeys.all });
    } catch (error) {
      toast.error(errorText(error, 'Couldn’t change those skills.'));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <SkillShelf
      period={period(data.days)}
      skills={stale.map((s) => ({
        id: s.id,
        name: s.name,
        title: s.title,
        idle: s.lastUsedAt ? `Last used ${day.format(s.lastUsedAt)}` : 'Never used',
      }))}
      actions={
        <>
          <Button
            size="sm"
            variant="soft"
            loading={busy === 'off'}
            disabled={Boolean(busy)}
            onClick={() => void answer('off')}
          >
            {one ? 'Turn it off' : 'Turn them off'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            tone="neutral"
            loading={busy === 'keep'}
            disabled={Boolean(busy)}
            onClick={() => void answer('keep')}
          >
            {one ? 'Keep it' : 'Keep them'}
          </Button>
        </>
      }
    />
  );
}
