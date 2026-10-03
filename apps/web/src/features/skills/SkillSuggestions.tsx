import type {
  SkillDraftPermissions,
  SkillSuggestion,
  SkillSuggestions as Suggestions,
} from '@conch/protocol';
import { Button, SkillSuggestionCard, Stack, toast } from '@conch/nacre';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { memoryApi } from '../memory/api';
import { memoryKeys, useSkillSuggestions } from '../memory/queries';
import { skillKeys, useWorkSuggestions } from './queries';

/** What New skill opens with, from a suggestion: the draft, and where it came from. */
export interface SuggestedDraft {
  instructions: string;
  title: string;
  description: string;
  /** The suggestion it's from: saving it settles it, and Conch knows it put it here. */
  suggestion: string;
  /** Something you keep asking for: in how many chats (ADR 0032). */
  suggested?: number;
  /** How work went in one chat (ADR 0058). */
  learned?: { chat: string; steps?: number; untrusted?: string };
  /** What it would say it may do: only what the work needed. */
  permissions?: SkillDraftPermissions;
}

export function draftFrom(s: SkillSuggestion): SuggestedDraft {
  const { permissions, ...draft } = s.draft;
  return {
    ...draft,
    suggestion: s.id,
    ...(s.from === 'work'
      ? {
          learned: {
            chat: s.chat?.title ?? 'a chat',
            ...(s.steps !== undefined && { steps: s.steps }),
            ...(s.untrusted && { untrusted: s.untrusted }),
          },
          ...(permissions && { permissions }),
        }
      : { suggested: s.times }),
  };
}

/** Put a suggestion away here at once, then tell the gateway (Not now, or never). */
export async function dismissSuggestion(client: QueryClient, id: string, forever: boolean) {
  const without = (list: Suggestions | undefined) =>
    list ? { suggestions: list.suggestions.filter((s) => s.id !== id) } : list;
  client.setQueryData<Suggestions>(memoryKeys.suggestions, without);
  client.setQueryData<Suggestions>(skillKeys.fromWork, without);
  try {
    await memoryApi.dismissSuggestion(id, forever);
    if (forever) toast('Conch won’t suggest that again');
  } catch (e) {
    toast.error((e as Error).message);
    void client.invalidateQueries({ queryKey: memoryKeys.suggestions });
  }
}

/**
 * Skills Conch could keep for you (ADR 0032, ADR 0058): what you keep asking
 * for, and how work went well in a chat. An offer, with a draft to read and
 * change. Nothing is saved, or used, until you save it.
 */
export function SkillSuggestions() {
  const { data: habits } = useSkillSuggestions();
  const { data: work } = useWorkSuggestions();
  const client = useQueryClient();
  const navigate = useNavigate();
  // From your work first (it's fresh), then habits; a few at most.
  const suggestions = [...(work?.suggestions ?? []), ...(habits?.suggestions ?? [])].slice(0, 3);
  if (!suggestions.length) return null;

  return (
    <Stack gap={3} aria-label="Suggested skills" role="group">
      {suggestions.map((s) => (
        <SkillSuggestionCard
          key={s.id}
          title={s.title}
          times={s.times}
          examples={s.examples.map((e) => e.text)}
          {...(s.from === 'work' && {
            fromChat: {
              title: s.chat?.title ?? 'a chat',
              ...(s.steps !== undefined && { steps: s.steps }),
            },
          })}
          {...(s.untrusted && { untrusted: s.untrusted })}
          actions={
            <>
              <Button
                size="sm"
                variant="soft"
                onClick={() => void navigate('/skills/new', { state: draftFrom(s) })}
              >
                Look at the draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                onClick={() => void dismissSuggestion(client, s.id, false)}
              >
                Not now
              </Button>
              <Button
                size="sm"
                variant="ghost"
                tone="neutral"
                onClick={() => void dismissSuggestion(client, s.id, true)}
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
