import { Badge, Button, Callout, DocsHero, Heading, Prose, Stack, Tabs, Text } from '@conch/nacre';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import publication from 'virtual:conch-publication';

import type { PublishedRelease } from '../../publishing/schema';
import styles from '../home/Home.module.css';
import { REPO_URL } from '../site/config';
import { RELEASES_HEAD, useHead } from '../site/head';

function noteUrl(href: string | undefined, tag: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, `${REPO_URL}/blob/${tag}/`);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const FILTERS = ['All', 'Stable', 'Beta', 'Alpha'] as const;

/** Public release text is Markdown data, never raw HTML or site embeds. */
export function ReleaseHistory({ releases }: { releases: readonly PublishedRelease[] }) {
  return (
    <Tabs defaultValue="All">
      <Tabs.List aria-label="Release channel">
        {FILTERS.map((filter) => (
          <Tabs.Trigger key={filter} value={filter}>
            {filter}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      {FILTERS.map((filter) => {
        const shown = releases.filter(
          (release) => filter === 'All' || release.channel === filter.toLowerCase(),
        );
        return (
          <Tabs.Content key={filter} value={filter}>
            <Stack gap={10}>
              {shown.length === 0 && (
                <Callout
                  tone="neutral"
                  title={
                    releases.length ? `No ${filter.toLowerCase()} releases yet` : 'No releases yet'
                  }
                >
                  {releases.length
                    ? 'Published releases in this channel will appear here.'
                    : 'Conch currently follows main. The landing page and documentation describe the latest development version that passed its checks.'}
                </Callout>
              )}
              {shown.map((release) => (
                <Stack key={release.tag} as="section" gap={4} aria-label={release.name}>
                  <Stack direction="row" align="center" wrap>
                    <Heading level={2} size="2xl">
                      {release.name}
                    </Heading>
                    <Badge tone={release.channel === 'stable' ? 'accent' : 'neutral'}>
                      {release.channel}
                    </Badge>
                    <Text size="sm" tone="muted">
                      <time dateTime={release.published}>{release.published.slice(0, 10)}</time>
                    </Text>
                  </Stack>
                  <Prose>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      skipHtml
                      components={{
                        h1: ({ children }) => <h3>{children}</h3>,
                        h2: ({ children }) => <h3>{children}</h3>,
                        img: () => null,
                        a: ({ href, children }) => {
                          const url = noteUrl(href, release.tag);
                          return url && /^https?:\/\//.test(url) ? (
                            <a href={url} rel="noreferrer">
                              {children}
                            </a>
                          ) : (
                            <span>{children}</span>
                          );
                        },
                      }}
                    >
                      {release.notes}
                    </ReactMarkdown>
                  </Prose>
                  <Stack direction="row" wrap>
                    <Button variant="surface" tone="neutral" asChild>
                      <a href={`${REPO_URL}/releases/tag/${release.tag}`}>
                        {release.downloads ? 'Release and downloads' : 'View release'}
                      </a>
                    </Button>
                    <Button variant="ghost" tone="neutral" asChild>
                      <a href={`${REPO_URL}/tree/${release.commit}`}>Source at {release.tag}</a>
                    </Button>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Tabs.Content>
        );
      })}
    </Tabs>
  );
}

export function Releases() {
  useHead(RELEASES_HEAD);
  return (
    <main id="content" className={styles.home}>
      <DocsHero
        title="What’s new in Conch"
        lede="Published releases, from early alphas to stable versions. Choose a channel to see its notes."
      />
      <ReleaseHistory releases={publication.releases} />
    </main>
  );
}
