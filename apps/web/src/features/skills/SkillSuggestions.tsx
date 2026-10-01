import type { SkillSuggestions as Suggestions } from '@conch/protocol';
import { Button, SkillSuggestionCard, Stack, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { memoryApi } from '../memory/api';
import { memoryKeys, useSkillSuggestions } from '../memory/queries';

/**
 * Skills you keep asking for (ADR 0032): an offer, with a draft to read and
 * change. Nothing is saved, or used, until you save it.
 */
export function SkillSuggestions() {
  const { data } = useSkillSuggestions();
  const client = useQueryClient();
  const navigate = useNavigate();
  const suggestions = data?.suggestions ?? [];
  if (!suggestions.length) return null;

  const dismiss = async (id: string, forever: boolean) => {
    client.setQueryData<Suggestions>(memoryKeys.suggestions, (list) =>
      list ? { suggestions: list.suggestions.filter((s) => s.id !== id) } : list,
    );
    try {
      await memoryApi.dismissSuggestion(id, forever);
      if (forever) toast('Conch won’t suggest that again');
    } catch (e) {
      toast.error((e as Error).message);
      void client.invalidateQueries({ queryKey: memoryKeys.suggestions });
    }
  };

  return (
    <Stack gap={3} aria-label="Suggested skills" role="group">
      {suggestions.slice(0, 2).map((s) => (
        <SkillSuggestionCard
          key={s.id}
          title={s.title}
          times={s.times}
          examples={s.examples.map((e) => e.text)}
          actions={
            <>
              <Button
                size="sm"
                variant="soft"
                onClick={() =>
                  void navigate('/skills/new', {
                    state: { ...s.draft, suggested: s.times },
                  })
                }
              >
                Look at the draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                onClick={() => void dismiss(s.id, false)}
              >
                Not now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                onClick={() => void dismiss(s.id, true)}
              >
                Don’t suggest this
              </Button>
            </>
          }
        />
      ))}
    </Stack>
  );
}
