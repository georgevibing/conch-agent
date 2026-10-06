import { ClearedDivider, GoalNote } from '@conch/nacre';
import { useState } from 'react';

import type { TranscriptItem } from '../../live/reducer';
import { restoreChat } from './context';

type Of<K extends TranscriptItem['kind']> = Extract<TranscriptItem, { kind: K }>;

/** Where `/clear` happened, with Undo while nothing new was sent. */
export function ClearedItem({
  item,
  name,
  conversationId,
  undoable,
  className,
}: {
  item: Of<'cleared'>;
  name: string;
  conversationId?: string;
  undoable: boolean;
  className?: string;
}) {
  const [undoing, setUndoing] = useState(false);
  return (
    <ClearedDivider
      data-anchor={item.id}
      name={name}
      undoing={undoing}
      className={className}
      {...(undoable &&
        conversationId && {
          onUndo: () => {
            setUndoing(true);
            void restoreChat(conversationId).finally(() => setUndoing(false));
          },
        })}
    />
  );
}

/** Where the chat's goal was set or cleared. */
export function GoalItem({ item, className }: { item: Of<'goal-note'>; className?: string }) {
  return (
    <GoalNote data-anchor={item.id} className={className} {...(item.goal && { goal: item.goal })} />
  );
}
