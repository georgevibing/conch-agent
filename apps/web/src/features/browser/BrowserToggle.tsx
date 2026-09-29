import { IconButton, Pearl } from '@conch/nacre';
import { Globe } from 'lucide-react';

import { useUi } from '../../app/ui';
import { useLiveStore } from '../../live/store';

/** The header's browser button. A pearl stands in for the globe while the assistant browses. */
export function BrowserToggle({ conversationId }: { conversationId: string }) {
  const open = useUi((s) => s.browserFor === conversationId);
  const openBrowser = useUi((s) => s.openBrowser);
  const closeBrowser = useUi((s) => s.closeBrowser);
  const browsing = useLiveStore((s) => {
    const items = s.views[conversationId]?.items ?? [];
    const last = items.findLast((i) => i.kind === 'browser');
    return last?.kind === 'browser' && last.step.status === 'running';
  });
  return (
    <IconButton
      label={open ? 'Hide the browser' : browsing ? 'Watch the browser' : 'Show the browser'}
      shortcut="mod+shift+b"
      aria-pressed={open}
      onClick={() => (open ? closeBrowser() : openBrowser(conversationId))}
    >
      {browsing && !open ? <Pearl size="xs" state="thinking" label={null} /> : <Globe />}
    </IconButton>
  );
}
