import { ResizeHandle, Sheet, toast, useMediaQuery } from '@conch/nacre';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { useUi } from '../../app/ui';
import { useHotkey } from '../../app/useHotkey';
import type { ConversationView } from '../../live/reducer';
import { BrowserPanel } from './BrowserPanel';
import styles from './BrowserDock.module.css';
import { useBrowserStatus } from './queries';

const MIN_WIDTH = 360;

/** The newest browser step and handoff in a chat's view. */
function browsing(view: ConversationView) {
  let step: Extract<ConversationView['items'][number], { kind: 'browser' }> | undefined;
  let handoff: Extract<ConversationView['items'][number], { kind: 'handoff' }> | undefined;
  for (let i = view.items.length - 1; i >= 0 && (!step || !handoff); i--) {
    const item = view.items[i];
    if (item?.kind === 'browser') step ??= item;
    if (item?.kind === 'handoff') handoff ??= item;
  }
  return { step, handoff };
}

/**
 * The chat with its browser beside it. The panel opens by itself when the
 * assistant starts browsing (unless you closed it since), always when it needs
 * you, and with ⌘⇧B. On narrow screens it slides over the chat instead.
 *
 * A new chat has no id until its first message is saved; it's wrapped all the
 * same (with nothing to open), so the chat inside isn't rebuilt, and nothing in
 * it replays, the moment the id arrives.
 */
export function BrowserDock({
  conversationId,
  view,
  children,
}: {
  conversationId: string | undefined;
  view: ConversationView;
  children: ReactNode;
}) {
  const open = useUi((s) => conversationId !== undefined && s.browserFor === conversationId);
  const openBrowser = useUi((s) => s.openBrowser);
  const closeBrowser = useUi((s) => s.closeBrowser);
  const width = useUi((s) => s.browserWidth);
  const setWidth = useUi((s) => s.setBrowserWidth);
  const dismissedAt = useUi((s) => (conversationId && s.browserDismissed[conversationId]) || 0);
  const { data: status } = useBrowserStatus();
  const narrow = useMediaQuery('(max-width: 1100px)');
  const row = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(960);
  // Only news opens the panel: history replayed when the chat opens doesn't.
  const [openedAt] = useState(() => Date.now());
  const { step, handoff } = browsing(view);
  const seenHandoff = useRef<string | undefined>(undefined);
  const [params, setParams] = useSearchParams();

  // Opened from a notification ("Take over"): straight to the page.
  useEffect(() => {
    if (!conversationId || params.get('browser') !== '1') return;
    openBrowser(conversationId);
    setParams(
      (next) => {
        next.delete('browser');
        return next;
      },
      { replace: true },
    );
  }, [conversationId, params, setParams, openBrowser]);

  useHotkey('mod+shift+b', () => {
    if (open) closeBrowser();
    else if (conversationId) openBrowser(conversationId);
  });

  useEffect(() => {
    if (!conversationId || !step || open || status?.settings.autoOpen === false) return;
    const fresh = step.at >= openedAt - 1_500 && step.at > dismissedAt;
    if (fresh && step.step.status === 'running') openBrowser(conversationId);
  }, [step, open, openedAt, dismissedAt, status?.settings.autoOpen, conversationId, openBrowser]);

  // The assistant needs you: open, whatever you closed before, and say so once.
  useEffect(() => {
    if (
      !conversationId ||
      handoff?.handoff.state !== 'waiting' ||
      seenHandoff.current === handoff.id
    )
      return;
    seenHandoff.current = handoff.id;
    openBrowser(conversationId);
    toast('Your turn in the browser', { description: handoff.handoff.reason });
  }, [handoff, conversationId, openBrowser]);

  // The panel may take up to 70% of the room (the chat keeps the rest).
  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMax(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width * 0.7)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (narrow) {
    return (
      <>
        {children}
        <Sheet.Root
          open={open}
          onOpenChange={(next) => {
            if (!next) closeBrowser();
            else if (conversationId) openBrowser(conversationId);
          }}
        >
          <Sheet.Content
            side="right"
            size="lg"
            hideClose
            aria-label="Browser"
            className={styles.sheet}
          >
            <Sheet.Title className={styles.srOnly}>Browser</Sheet.Title>
            {conversationId && (
              <BrowserPanel conversationId={conversationId} onClose={closeBrowser} />
            )}
          </Sheet.Content>
        </Sheet.Root>
      </>
    );
  }

  const size = Math.min(max, Math.max(MIN_WIDTH, width));
  return (
    <div ref={row} className={styles.row}>
      <div className={styles.chat}>{children}</div>
      {open && (
        <>
          <ResizeHandle
            label="Resize the browser"
            value={size}
            min={MIN_WIDTH}
            max={max}
            onValueChange={setWidth}
            className={styles.handle}
          />
          <aside className={styles.pane} style={{ inlineSize: size }} aria-label="Browser panel">
            {conversationId && (
              <BrowserPanel conversationId={conversationId} onClose={closeBrowser} />
            )}
          </aside>
        </>
      )}
    </div>
  );
}
