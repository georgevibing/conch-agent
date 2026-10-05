import { ContextMeter } from '@conch/nacre';
import { useState } from 'react';

import type { ConversationView } from '../../live/reducer';

/**
 * The composer's context meter for this chat: how full it is, what the running
 * turn has used as it goes, and Compact now (the same as `/compact`).
 */
export function ChatContext({
  view,
  window,
  running,
  onCompact,
}: {
  view: ConversationView;
  /** The model's window, when the engine hasn't said yet. */
  window?: number;
  running: boolean;
  onCompact?: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const working = view.working ? view.working.inputTokens + view.working.outputTokens : undefined;
  return (
    <ContextMeter
      used={view.context?.used}
      window={view.context?.window ?? window}
      working={working}
      written={view.working?.outputTokens}
      running={running}
      open={open}
      onOpenChange={setOpen}
      compacting={compacting}
      {...(onCompact && {
        onCompact: () => {
          setCompacting(true);
          void Promise.resolve(onCompact()).finally(() => {
            setCompacting(false);
            setOpen(false);
          });
        },
      })}
    />
  );
}
