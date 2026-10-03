import type { Provider, ProviderGroup } from '@conch/protocol';
import {
  Button,
  Heading,
  Input,
  IntegrationCard,
  SegmentedControl,
  Stack,
  Text,
} from '@conch/nacre';
import { Plus, Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import styles from './Providers.module.css';
import { brandOf, GROUP_ORDER, GROUP_WORDS, noteOf, searchWords, SERVER_TILE } from './words';

export interface ProviderGalleryProps {
  /** The providers not yet yours. */
  providers: Provider[];
  onOpen: (id: string) => void;
  /** Offer "Another server" (Settings has room for it; first run doesn't). */
  onAddServer?: () => void;
  /** First run: the featured few, with the rest a press away. */
  featuredFirst?: boolean;
  /** Heading: "Add a provider" once you have one, "Choose a provider" before. */
  title: string;
}

type Filter = 'all' | ProviderGroup;

/**
 * Every provider you could connect, as tiles like the Apps gallery: sorted
 * by what connecting takes (a plan you have, a model on this computer, a key),
 * searchable by name or by what it's good at. Tap one to set it up.
 */
export function ProviderGallery({
  providers,
  onOpen,
  onAddServer,
  featuredFirst,
  title,
}: ProviderGalleryProps) {
  const headingId = useId();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [everyone, setEveryone] = useState(!featuredFirst);
  const needle = query.trim().toLowerCase();

  const groups = useMemo(() => {
    const present = GROUP_ORDER.filter(
      (g) => providers.some((p) => p.group === g) || (g === 'local' && onAddServer),
    );
    return present;
  }, [providers, onAddServer]);

  const shown = providers.filter(
    (p) =>
      (filter === 'all' || p.group === filter) &&
      (!needle || needle.split(/\s+/).every((word) => searchWords(p).includes(word))),
  );
  const serverMatches =
    onAddServer &&
    (filter === 'all' || filter === 'local') &&
    (!needle ||
      `${SERVER_TILE.name} ${SERVER_TILE.tagline} llama vllm jan litellm server`
        .toLowerCase()
        .includes(needle));

  const tile = (provider: Provider, index: number) => (
    <li key={provider.id}>
      <IntegrationCard
        variant="catalog"
        index={index}
        name={provider.name}
        brand={brandOf(provider)}
        color={provider.color}
        tagline={provider.tagline}
        local={provider.group === 'local'}
        note={noteOf(provider)}
        connected={false}
        onOpen={() => onOpen(provider.id)}
      />
    </li>
  );
  const serverTile = (index: number) => (
    <li key={SERVER_TILE.id}>
      <IntegrationCard
        variant="catalog"
        index={index}
        name={SERVER_TILE.name}
        brand="server"
        tagline={SERVER_TILE.tagline}
        note="Yours, on your network"
        connected={false}
        onOpen={onAddServer}
      />
    </li>
  );

  // First run opens on the featured few; the rest are one press away.
  if (!everyone && !needle) {
    const featured = providers.filter((p) => p.featured);
    return (
      <section aria-labelledby={headingId} className={styles.section}>
        <Heading level={3} size="sm" tone="muted" id={headingId}>
          {title}
        </Heading>
        <ul className={styles.tiles}>{featured.map(tile)}</ul>
        <div>
          <Button variant="ghost" size="sm" onClick={() => setEveryone(true)}>
            Show all {providers.length} providers
          </Button>
        </div>
      </section>
    );
  }

  const grouped = filter === 'all' && !needle;
  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <div className={styles.catalogHeader}>
        <Heading level={3} size="sm" tone="muted" id={headingId}>
          {title}
        </Heading>
        <div className={styles.filters}>
          {groups.length > 2 && (
            <SegmentedControl
              size="sm"
              value={filter}
              onValueChange={(value) => value && setFilter(value as Filter)}
              aria-label="Show"
            >
              <SegmentedControl.Item value="all">All</SegmentedControl.Item>
              {groups
                .filter((g) => g !== 'server')
                .map((g) => (
                  <SegmentedControl.Item key={g} value={g}>
                    {GROUP_WORDS[g]}
                  </SegmentedControl.Item>
                ))}
            </SegmentedControl>
          )}
          <Input
            size="sm"
            type="search"
            aria-label="Find a provider"
            placeholder="Find a provider"
            leading={<Search />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.search}
          />
        </div>
      </div>
      {grouped ? (
        <div className={styles.kinds}>
          {groups.map((group) => {
            const inGroup = shown.filter((p) => p.group === group);
            const withServer = group === 'local' && serverMatches;
            if (!inGroup.length && !withServer) return null;
            return (
              <section
                key={group}
                aria-labelledby={`${headingId}-${group}`}
                className={styles.kind}
              >
                <Heading level={4} size="xs" tone="subtle" id={`${headingId}-${group}`}>
                  {GROUP_WORDS[group]}
                </Heading>
                <ul className={styles.tiles}>
                  {inGroup.map(tile)}
                  {withServer && serverTile(inGroup.length)}
                </ul>
              </section>
            );
          })}
        </div>
      ) : shown.length || serverMatches ? (
        <ul className={styles.tiles}>
          {shown.map(tile)}
          {serverMatches && serverTile(shown.length)}
        </ul>
      ) : (
        <Stack gap={2} align="start" className={styles.noMatch}>
          <Text tone="muted">{`Nothing called “${query}” here yet.`}</Text>
          {onAddServer && (
            <Button variant="surface" size="sm" leadingIcon={<Plus />} onClick={onAddServer}>
              Add it as a server
            </Button>
          )}
        </Stack>
      )}
    </section>
  );
}
