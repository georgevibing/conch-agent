import {
  Badge,
  Button,
  Heading,
  IconButton,
  Kbd,
  Pearl,
  ScrollArea,
  Sheet,
  Text,
  useNacreTheme,
} from '@conch/nacre';
import { ArrowUpRight, Menu, Moon, Search as SearchIcon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import reference from 'virtual:conch-reference';

import { REPO_URL } from '../site/config';
import styles from './Layout.module.css';
import { Search } from './Search';
import { SiteNav } from './SiteNav';

/** Goes to the top of a new page, or to the heading its address names. */
function useScrollToPlace() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (!hash) {
      window.scrollTo({ top: 0 });
      return;
    }
    // After the page has drawn: its headings get their anchors as they render.
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!target) return;
      target.scrollIntoView({ block: 'start' });
      target.setAttribute('data-nc-flash', '');
      target.addEventListener('animationend', () => target.removeAttribute('data-nc-flash'), {
        once: true,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
}

/** The frame every page sits in: the bar across the top, search, and the menu on small screens. */
export function Layout() {
  const theme = useNacreTheme();
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState(false);
  useScrollToPlace();
  const dark = theme.resolvedMode === 'dark';

  return (
    <div className={styles.page}>
      <a href="#content" className={styles.skip}>
        Skip to the page
      </a>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Sheet.Root open={menu} onOpenChange={setMenu}>
            <Sheet.Trigger asChild>
              <IconButton label="Contents" className={styles.menu}>
                <Menu />
              </IconButton>
            </Sheet.Trigger>
            <Sheet.Content side="left" size="sm">
              <Sheet.Header>
                <Sheet.Title>Contents</Sheet.Title>
              </Sheet.Header>
              <ScrollArea className={styles.sheetNav} label="Contents">
                <SiteNav onNavigate={() => setMenu(false)} />
              </ScrollArea>
            </Sheet.Content>
          </Sheet.Root>

          <Link to="/" className={styles.brand} aria-label="Conch documentation, home">
            <Pearl size="sm" label={null} />
            <Heading level={2} display size="2xl" asChild>
              <span>Conch</span>
            </Heading>
            <Badge tone="neutral" size="sm">
              {reference.version}
            </Badge>
          </Link>

          <div className={styles.actions}>
            <Button
              variant="surface"
              tone="neutral"
              leadingIcon={<SearchIcon />}
              className={styles.search}
              aria-label="Search"
              onClick={() => setSearching(true)}
            >
              <Text as="span" tone="muted" className={styles.searchLabel}>
                Search
              </Text>
              <Kbd keys="mod+k" size="sm" aria-hidden className={styles.searchKeys} />
            </Button>
            <IconButton
              label={dark ? 'Use the light look' : 'Use the dark look'}
              onClick={() => theme.setTheme({ mode: dark ? 'light' : 'dark' })}
            >
              {dark ? <Sun /> : <Moon />}
            </IconButton>
            <Button variant="ghost" tone="neutral" trailingIcon={<ArrowUpRight />} asChild>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className={styles.source}>
                GitHub
              </a>
            </Button>
          </div>
        </div>
      </header>

      <Outlet />

      <Search open={searching} onOpenChange={setSearching} />
    </div>
  );
}
