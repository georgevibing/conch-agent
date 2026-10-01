import { CommandPalette } from '@conch/nacre';
import { BookOpen, Hash, TextSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { SECTIONS } from '../site/config';
import { BROWSABLE, FINDABLES, type Findable } from '../site/search';

const ICONS = { page: <BookOpen />, heading: <Hash />, reference: <TextSearch /> } as const;

/** How many of each kind are worth showing while someone types. */
const MOST = { page: 12, reference: 12, heading: 16 } as const;

/** Every word typed appears somewhere in what the thing is called or about. */
function matches(item: Findable, words: string[]): number {
  const title = item.title.toLowerCase();
  const rest = `${item.where} ${item.description ?? ''} ${item.keywords.join(' ')}`.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (title.startsWith(word)) score += 4;
    else if (title.includes(word)) score += 3;
    else if (rest.includes(word)) score += 1;
    else return 0;
  }
  return score;
}

export interface SearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * ⌘K for the documentation: the pages before you type, and everything with a
 * name once you do (pages, headings, commands, settings, apps).
 */
export function Search({ open, onOpenChange }: SearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length)
      return SECTIONS.map((section) => ({
        title: section.title,
        items: BROWSABLE.filter((item) => item.where === section.title),
      }));
    const found = FINDABLES.map((item) => ({ item, score: matches(item, words) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score);
    const of = (kind: Findable['kind']) =>
      found
        .filter((hit) => hit.item.kind === kind)
        .slice(0, MOST[kind])
        .map((hit) => hit.item);
    return [
      { title: 'Pages', items: of('page') },
      { title: 'Reference', items: of('reference') },
      { title: 'On a page', items: of('heading') },
    ];
  }, [query]);

  const go = (item: Findable) => {
    onOpenChange(false);
    setQuery('');
    void navigate(item.to);
  };

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      title="Search the documentation"
      placeholder="Search pages, commands, settings…"
      search={query}
      onSearchChange={setQuery}
      // Ranked here, by where the words were found: cmdk's own filter is for short lists.
      shouldFilter={false}
      empty="Nothing by that name. Try fewer words."
    >
      {groups
        .filter((group) => group.items.length)
        .map((group) => (
          <CommandPalette.Group key={group.title} heading={group.title}>
            {group.items.map((item) => (
              <CommandPalette.Item
                key={item.id}
                value={item.id}
                icon={ICONS[item.kind]}
                hint={query ? item.where : undefined}
                description={item.kind === 'heading' ? undefined : item.description}
                onSelect={() => go(item)}
              >
                {item.title}
              </CommandPalette.Item>
            ))}
          </CommandPalette.Group>
        ))}
    </CommandPalette>
  );
}
