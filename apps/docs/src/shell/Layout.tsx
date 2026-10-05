import {
  Badge,
  Stack,
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
import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';

import { DEVELOPMENT, REPO_URL, REPO_BRANCH, VERSION_LABEL } from '../site/config';
import styles from './Layout.module.css';

// Search and the contents know every page, so they come with the guides, not with the front page.
const Search = lazy(() => import('./Search').then((module) => ({ default: module.Search })));
const SiteNav = lazy(() => import('./SiteNav').then((module) => ({ default: module.SiteNav })));

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
  const [wantsSearch, setWantsSearch] = useState(false);
  const [menu, setMenu] = useState(false);
  useScrollToPlace();
  const dark = theme.resolvedMode === 'dark';

  const openSearch = () => {
    setWantsSearch(true);
    setSearching(true);
  };
  // Until search has loaded, nothing is listening for its shortcut: this does.
  useEffect(() => {
    if (wantsSearch) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setWantsSearch(true);
      setSearching(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [wantsSearch]);

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
                <Suspense fallback={null}>
                  <SiteNav onNavigate={() => setMenu(false)} />
                </Suspense>
              </ScrollArea>
            </Sheet.Content>
          </Sheet.Root>

          <Link to="/" className={styles.brand} aria-label="Conch, home">
            <Pearl size="sm" label={null} />
            <Heading level={2} display size="2xl" asChild>
              <span>Conch</span>
            </Heading>
          </Link>

          <div className={styles.actions}>
            <Button variant="ghost" tone="neutral" asChild>
              <Link to="/docs">Docs</Link>
            </Button>
            <Button
              variant="surface"
              tone="neutral"
              leadingIcon={<SearchIcon />}
              className={styles.search}
              aria-label="Search"
              onClick={openSearch}
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

      <Stack
        direction="row"
        wrap
        align="center"
        justify="between"
        className={styles.version}
        as="nav"
        aria-label="Documentation versions"
      >
        <Stack direction="row" wrap align="center" gap={2}>
          <Badge tone="neutral">{VERSION_LABEL}</Badge>
          <Button variant="ghost" tone="neutral" size="sm" asChild>
            <a href={`${REPO_URL}/tree/${REPO_BRANCH}`}>Source</a>
          </Button>
        </Stack>
        <Stack direction="row" wrap gap={1}>
          <Button variant="ghost" tone="neutral" size="sm" asChild>
            <a href={DEVELOPMENT ? '/docs/' : '/docs/next/'}>
              {DEVELOPMENT ? 'Default docs' : 'Development docs'}
            </a>
          </Button>
          <Button variant="ghost" tone="neutral" size="sm" asChild>
            <a href="/releases/">Release notes</a>
          </Button>
        </Stack>
      </Stack>
      <Outlet />

      {/* Loaded the first time it's asked for: by the button, or by ⌘K. */}
      {wantsSearch && (
        <Suspense fallback={null}>
          <Search open={searching} onOpenChange={setSearching} />
        </Suspense>
      )}
    </div>
  );
}
