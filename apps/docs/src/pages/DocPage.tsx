import { Button, Callout, DocsPager, DocsToc, Heading, ScrollArea, Text } from '@conch/nacre';
import { PencilLine } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { ChannelFacts } from '../embeds/channels';
import { ProviderFacts } from '../embeds/providers';
import { Markdown } from '../markdown/Markdown';
import { SiteNav } from '../shell/SiteNav';
import { SECTIONS } from '../site/config';
import { useHead } from '../site/head';
import { fileUrl, headOf, neighbours, pageAt, type Page } from '../site/pages';
import type { Heading as PageHeading } from '../site/text';
import styles from './DocPage.module.css';
import { NotFound } from './NotFound';

/** The heading being read: the last one to pass the top third of the window. */
function useHeadingInView(headings: readonly PageHeading[]): string | undefined {
  const [inView, setInView] = useState<string>();

  useEffect(() => {
    if (!headings.length) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let current = headings[0]?.id;
      for (const heading of headings) {
        const top = document.getElementById(heading.id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= line) current = heading.id;
      }
      setInView(current);
    };
    const later = () => {
      frame ||= requestAnimationFrame(read);
    };
    later();
    window.addEventListener('scroll', later, { passive: true });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', later);
      window.removeEventListener('resize', later);
    };
  }, [headings]);

  return inView ?? headings[0]?.id;
}

/** One page: its title, what the code says about it, its words, and where to go next. */
function Article({ page }: { page: Page }) {
  const inView = useHeadingInView(page.headings);
  const { previous, next } = neighbours(page);
  const section = SECTIONS.find((s) => s.id === page.section);

  useHead(useMemo(() => headOf(page), [page]));

  return (
    <>
      <main id="content" className={styles.main}>
        <article className={styles.article}>
          <header className={styles.head}>
            <Text size="sm" tone="accent" weight="medium">
              {section ? (
                section.title
              ) : (
                <Link to="/project/decisions" className={styles.crumb}>
                  Decisions
                </Link>
              )}
            </Text>
            <Heading level={1} display size="5xl">
              {page.title}
            </Heading>
            {page.description && (
              <Text size="xl" tone="muted">
                {page.description}
              </Text>
            )}
          </header>

          {page.provider && <ProviderFacts id={page.provider} />}
          {page.channel && <ChannelFacts id={page.channel} />}

          {page.body ? (
            <Markdown source={page.body} file={page.file} />
          ) : (
            <Callout tone="neutral" title="The guide for this isn’t written yet">
              Everything above comes straight from the code. The words go in {page.file}.
            </Callout>
          )}

          <footer className={styles.foot}>
            <Button variant="ghost" tone="neutral" size="sm" leadingIcon={<PencilLine />} asChild>
              <a href={fileUrl(page.file)} target="_blank" rel="noreferrer">
                Edit this page
              </a>
            </Button>
            <DocsPager>
              {previous && (
                <DocsPager.Link direction="previous" title={previous.title} asChild>
                  <Link to={previous.path} />
                </DocsPager.Link>
              )}
              {next && (
                <DocsPager.Link direction="next" title={next.title} asChild>
                  <Link to={next.path} />
                </DocsPager.Link>
              )}
            </DocsPager>
          </footer>
        </article>
      </main>

      {/* The lists inside are the landmarks; the columns around them are only layout. */}
      <div className={styles.toc}>
        <DocsToc items={page.headings} activeId={inView} />
      </div>
    </>
  );
}

/** The page at this address beside the contents, or a way back when there isn't one. */
export function DocPage() {
  const { pathname } = useLocation();
  const page = pageAt(pathname);
  if (!page) return <NotFound />;
  return (
    <div className={styles.frame}>
      <div className={styles.sidebar}>
        <ScrollArea className={styles.sidebarScroll}>
          <SiteNav />
        </ScrollArea>
      </div>
      {/* Keyed by address: each page starts fresh and surfaces as it opens; the contents stay put. */}
      <Article key={page.path} page={page} />
    </div>
  );
}
