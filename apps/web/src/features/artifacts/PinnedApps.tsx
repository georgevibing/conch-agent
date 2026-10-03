import { appGlyphIcon, ARTIFACT_KINDS, Button, Text } from '@conch/nacre';
import { createElement } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useConchApps } from '../conchapps/queries';
import { conchPagePath } from '../conchapps/words';
import styles from '../sidebar/Sidebar.module.css';
import { usePinnedApps } from './queries';

/**
 * Pinned things, in the sidebar (ADR 0034): one press, from anywhere. Called
 * "Pinned" since the apps you connect are Apps (ADR 0052).
 */
export function PinnedApps({ onNavigate }: { onNavigate?: () => void }) {
  const apps = usePinnedApps();
  const { data: conchApps } = useConchApps();
  const navigate = useNavigate();
  const path = useLocation().pathname;
  // Conch apps' pages (ADR 0061): each pinned app's pages, with its own icon.
  const pages = (conchApps ?? [])
    .filter((a) => a.pinned && a.manifest.pages.length > 0)
    .sort((a, b) => a.addedAt - b.addedAt)
    .flatMap((a) =>
      a.manifest.pages.map((page) => ({
        key: `${a.id}/${page.id}`,
        to: conchPagePath(a.id, page.id),
        label: a.manifest.pages.length > 1 ? `${a.manifest.name} — ${page.title}` : page.title,
        icon: a.manifest.icon,
      })),
    );
  if (!apps.length && !pages.length) return null;
  return (
    <section className={styles.group} aria-label="Pinned">
      <Text as="span" size="xs" weight="medium" tone="subtle" className={styles.groupLabel}>
        Pinned
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
        {pages.map((p) => {
          const active = path === p.to;
          return (
            <li key={p.key}>
              <Button
                variant={active ? 'soft' : 'ghost'}
                tone="neutral"
                size="sm"
                block
                // Its glyph, the size of the others here.
                leadingIcon={createElement(appGlyphIcon(p.icon.glyph))}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  void navigate(p.to);
                  onNavigate?.();
                }}
                style={{ justifyContent: 'flex-start' }}
              >
                {p.label}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
