import { Button } from '@conch/nacre';
import { Cable } from 'lucide-react';

import { useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { OTHER_APPS_FOCUS } from '../settings/paths';
import styles from './OtherApps.module.css';

/**
 * At the top of what another app did through Conch (ADR 0073): whose log it
 * is, that nobody writes in it, and where to change what that app may use.
 */
export function ClientBanner({ conversationId }: { conversationId?: string }) {
  const { data: conversations } = useConversations();
  const openSettings = useUi((s) => s.openSettings);
  const origin = conversations?.find((c) => c.id === conversationId)?.origin;
  if (origin?.kind !== 'client') return null;
  return (
    <div className={styles.banner} role="note">
      <Cable size={14} aria-hidden />
      <span>
        What {origin.name} did through Conch, and what it asked you. Questions it asks wait here.
      </span>
      <Button size="sm" variant="ghost" onClick={() => openSettings('access', OTHER_APPS_FOCUS)}>
        What it may use
      </Button>
    </div>
  );
}
