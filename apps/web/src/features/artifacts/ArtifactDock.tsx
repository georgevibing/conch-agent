import { ResizeHandle, Sheet, useMediaQuery } from '@conch/nacre';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useUi } from '../../app/ui';
import type { ConversationView } from '../../live/reducer';
import styles from '../browser/BrowserDock.module.css';
import { ArtifactView } from './ArtifactView';

const MIN_WIDTH = 360;

/**
 * The chat with what the assistant made beside it (ADR 0034), resizable like
 * the browser. It opens by itself when something new is made or changed
 * (unless you closed it since); on a phone it slides over the chat.
 */
export function ArtifactDock({
  conversationId,
  view,
  children,
}: {
  conversationId: string;
  view: ConversationView;
  children: ReactNode;
}) {
  const open = useUi((s) =>
    s.artifactOpen?.conversationId === conversationId ? s.artifactOpen : null,
  );
  const openArtifact = useUi((s) => s.openArtifact);
  const closeArtifact = useUi((s) => s.closeArtifact);
  const width = useUi((s) => s.artifactWidth);
  const setWidth = useUi((s) => s.setArtifactWidth);
  const dismissedAt = useUi((s) => s.artifactDismissed[conversationId] ?? 0);
  const narrow = useMediaQuery('(max-width: 1100px)');
  const row = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(960);
  // Only news opens the panel: history replayed when the chat opens doesn't.
  const [openedAt] = useState(() => Date.now());
  const newest = view.items.findLast((i) => i.kind === 'artifact');
  const shown = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (newest?.kind !== 'artifact' || shown.current === newest.id) return;
    shown.current = newest.id;
    const fresh = newest.at >= openedAt - 1_500 && newest.at > dismissedAt;
    // Never over the browser while it's in use; the card is there to open it.
    if (fresh && !useUi.getState().browserFor) openArtifact(conversationId, newest.artifactId);
  }, [newest, openedAt, dismissedAt, conversationId, openArtifact]);

  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setMax(Math.max(MIN_WIDTH, Math.round(entry.contentRect.width * 0.7)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const panel = open && (
    <ArtifactView
      key={`${open.artifactId}:${open.version ?? 'latest'}`}
      artifactId={open.artifactId}
      version={open.version}
      onClose={closeArtifact}
    />
  );

  if (narrow) {
    return (
      <>
        {children}
        <Sheet.Root open={Boolean(open)} onOpenChange={(next) => !next && closeArtifact()}>
          <Sheet.Content
            side="right"
            size="lg"
            hideClose
            aria-label="Made for you"
            className={styles.sheet}
            // Esc while editing cancels the edit (ADR 0039); it doesn't close the sheet.
            onEscapeKeyDown={(event) => {
              if ((event.target as Element | null)?.closest?.('[data-editing]'))
                event.preventDefault();
            }}
          >
            <Sheet.Title className={styles.srOnly}>Made for you</Sheet.Title>
            {panel}
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
            label="Resize the panel"
            value={size}
            min={MIN_WIDTH}
            max={max}
            onValueChange={setWidth}
            className={styles.handle}
          />
          <aside className={styles.pane} style={{ inlineSize: size }} aria-label="Made for you">
            {panel}
          </aside>
        </>
      )}
    </div>
  );
}
