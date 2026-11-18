import { PauseCircle } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Stack } from '../../components/Stack';

export interface RoutineRequestCardProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Who asked, in Conch's words: the name you gave the agent, or the chat's title. */
  from: string;
  /** `agent`: another agent you let in; `chat`: words in one of your chats. */
  via: 'agent' | 'chat';
  routines: readonly { id: string; title: string }[];
  /** Their reason, shown as their words. */
  reason?: string;
  /** Names they gave that match none of your routines. */
  unmatched?: readonly string[];
  onApprove?: () => void;
  onDecline?: () => void;
  busy?: boolean;
}

function list(titles: readonly string[]): string {
  const quoted = titles.map((t) => `“${t}”`);
  if (quoted.length < 2) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

/**
 * Someone else asks to pause your routines (ADR 0154): another agent that took
 * them over, or a message in a chat. Only **Pause them** here changes anything.
 */
export function RoutineRequestCard({
  from,
  via,
  routines,
  reason,
  unmatched,
  onApprove,
  onDecline,
  busy,
  ...props
}: RoutineRequestCardProps) {
  const which = list(routines.map((r) => r.title));
  const who = via === 'agent' ? from : `A message in “${from}”`;
  const many = routines.length > 1;
  return (
    <Callout
      tone="accent"
      icon={<PauseCircle />}
      title={`${who} asks to pause ${which}`}
      action={
        <Stack direction="row" gap={2}>
          <Button size="sm" onClick={onApprove} loading={busy}>
            {many ? 'Pause them' : 'Pause it'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
        </Stack>
      }
      {...props}
    >
      {reason ? (
        <>
          {via === 'agent' ? `${from} says: ` : 'It says: '}“{reason}”
        </>
      ) : null}
      {reason ? ' ' : null}
      {many
        ? 'Pause them? You can turn them back on any time.'
        : 'Pause it? You can turn it back on any time.'}
      {unmatched?.length
        ? ` It also named ${list(unmatched)}, which ${unmatched.length > 1 ? 'aren’t' : 'isn’t'} a routine that’s on.`
        : null}
    </Callout>
  );
}
