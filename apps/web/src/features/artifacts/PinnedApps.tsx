import { ARTIFACT_KINDS, Button, Text } from '@conch/nacre';
import { useLocation, useNavigate } from 'react-router';

import styles from '../sidebar/Sidebar.module.css';
import { usePinnedApps } from './queries';

/** Pinned things, as apps in the sidebar (ADR 0034): one press, from anywhere. */
export function PinnedApps({ onNavigate }: { onNavigate?: () => void }) {
  const apps = usePinnedApps();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  if (!apps.length) return null;
  return (
    <section className={styles.group} aria-label="Apps">
      <Text as="span" size="xs" weight="medium" tone="subtle" className={styles.groupLabel}>
        Apps
      </Text>
      <ul className={styles.list}>
        {apps.map((a) => {
          const active = path === `/apps/${a.id}`;
          return (
            <li key={a.id}>
              <Button
                variant={active ? 'soft' : 'ghost'}
                tone="neutral"
                size="sm"
                block
                leadingIcon={ARTIFACT_KINDS[a.kind].icon}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  void navigate(`/apps/${a.id}`);
                  onNavigate?.();
                }}
                style={{ justifyContent: 'flex-start' }}
              >
                {a.title}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
