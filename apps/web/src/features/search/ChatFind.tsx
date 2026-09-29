import { FindBar, FindRail, useFind } from '@conch/nacre';
import type { RefObject } from 'react';

import { useUi } from '../../app/ui';
import { useHotkey } from '../../app/useHotkey';
import styles from './ChatFind.module.css';

function FindHotkeys({ next, prev }: { next: () => void; prev: () => void }) {
  useHotkey('mod+g', next);
  useHotkey('mod+shift+g', prev);
  return null;
}

/**
 * ⌘F inside a conversation: the find bar, its match rail, and ⌘G / ⇧⌘G.
 * Opened from the header, the keyboard, or a search result (which also says
 * which message to land on).
 */
export function ChatFind({
  conversationId,
  root,
  onClose,
}: {
  conversationId: string;
  root: RefObject<HTMLElement | null>;
  onClose?: () => void;
}) {
  const find = useUi((s) => (s.find?.conversationId === conversationId ? s.find : null));
  const setQuery = useUi((s) => s.setFindQuery);
  const closeFind = useUi((s) => s.closeFind);
  const result = useFind(root, {
    query: find?.query ?? '',
    enabled: Boolean(find),
    target: find?.target,
  });

  if (!find) return null;
  const perTick = result.positions.length ? Math.ceil(result.count / result.positions.length) : 1;
  const close = () => {
    closeFind();
    onClose?.();
  };

  return (
    <>
      <FindHotkeys next={result.next} prev={result.prev} />
      <div className={styles.dock}>
        <FindBar
          query={find.query}
          onQueryChange={setQuery}
          count={result.count}
          current={result.current}
          capped={result.capped}
          onNext={result.next}
          onPrev={result.prev}
          onClose={close}
          focusKey={find.key}
        />
      </div>
      <FindRail
        positions={result.positions}
        current={result.current === -1 ? -1 : Math.floor(result.current / perTick)}
      />
    </>
  );
}
