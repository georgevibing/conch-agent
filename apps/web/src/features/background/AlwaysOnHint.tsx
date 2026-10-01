import { Button, Callout } from '@conch/nacre';
import { Power } from 'lucide-react';

import { useAlwaysOnActions, useBackground } from './AlwaysOnSection';

/**
 * Beside something that only works while Conch runs (a routine that's on, a
 * chat app), when Conch runs in a Terminal window: says so once, with the
 * one press that fixes it. Nothing at all when Always on is on, or can't be.
 */
export function AlwaysOnHint({ what }: { what: string }) {
  const { data: status } = useBackground();
  const { change, busy, dialog } = useAlwaysOnActions();
  if (!status?.supported || status.on || status.running !== 'window') return null;
  return (
    <>
      <Callout
        tone="info"
        icon={<Power />}
        action={
          <Button size="sm" variant="surface" loading={busy} onClick={() => void change(true)}>
            Keep Conch running
          </Button>
        }
      >
        {what} only while Conch is running, and closing its Terminal window stops it.
      </Callout>
      {dialog}
    </>
  );
}
