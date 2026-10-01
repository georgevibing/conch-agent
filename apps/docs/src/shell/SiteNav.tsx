import { DocsNav } from '@conch/nacre';
import { Link, useLocation } from 'react-router';

import { SECTIONS } from '../site/config';
import { pageAt, pagesIn } from '../site/pages';

/** The sidebar: every section and its pages, straight from the content folder. */
export function SiteNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  const current = pageAt(pathname);
  return (
    <DocsNav label="Documentation">
      {SECTIONS.map((section) => {
        const pages = pagesIn(section.id);
        if (!pages.length) return null;
        return (
          <DocsNav.Section key={section.id} title={section.title}>
            {pages.map((page) => (
              <DocsNav.Link key={page.path} active={page === current} asChild>
                <Link to={page.path} onClick={onNavigate}>
                  {page.nav}
                </Link>
              </DocsNav.Link>
            ))}
          </DocsNav.Section>
        );
      })}
    </DocsNav>
  );
}
