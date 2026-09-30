import {
  excerpt,
  type ConversationSummary,
  type SearchGroup,
  type SearchHit,
  type SearchRole,
  type TextRange,
} from '@conch/protocol';
import {
  Button,
  CommandPalette,
  EmptyState,
  Highlight,
  Kbd,
  SearchPreview,
  Stack,
  useNacreTheme,
  type SearchPreviewMessage,
} from '@conch/nacre';
import {
  Brain,
  CornerDownRight,
  Gauge,
  MessageSquare,
  Moon,
  PanelLeft,
  Search,
  Settings,
  SquarePen,
  Sun,
  TextSearch,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';

import { useAppState, useConversations } from '../../api/queries';
import { useUi } from '../../app/ui';
import { relativeTime } from '../../lib/time';
import { fuzzyFilter } from '../search/fuzzy';
import { useSearchPreview, useSearchResults } from '../search/useSearch';
import { useFindables } from './findables';
import styles from './Palette.module.css';

interface Action {
  id: string;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  keywords?: string;
  run: () => void;
}

type Selection =
  | { kind: 'chat'; conversationId: string }
  | { kind: 'hit'; conversationId: string; anchor: string }
  | { kind: 'other' };

/** Item values encode what they point at, so the preview can follow the selection. */
const value = {
  chat: (id: string) => `chat|${id}`,
  hit: (id: string, anchor: string) => `hit|${id}|${anchor}`,
  action: (id: string) => `action|${id}`,
};

function parse(selected: string): Selection {
  const [kind, id, anchor] = selected.split('|');
  if (kind === 'chat' && id) return { kind: 'chat', conversationId: id };
  if (kind === 'hit' && id && anchor) return { kind: 'hit', conversationId: id, anchor };
  return { kind: 'other' };
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function Preview({ selection, query }: { selection: Selection; query: string }) {
  const { data: app } = useAppState();
  const target =
    selection.kind === 'other'
      ? undefined
      : {
          conversationId: selection.conversationId,
          anchor: selection.kind === 'hit' ? selection.anchor : undefined,
        };
  const { data, isPending, isError } = useSearchPreview(
    target,
    selection.kind === 'hit' ? query : '',
  );

  if (!target || isError) {
    return (
      <div className={styles.tips}>
        <EmptyState
          size="sm"
          icon={<Search />}
          title="Find anything you’ve talked about"
          description={
            <>
              Search every chat by title or by what was said. Typos are fine, and{' '}
              <span className={styles.nowrap}>“quotes”</span> match an exact phrase.
            </>
          }
        />
        <ul className={styles.tipList}>
          <li>
            <Kbd keys="mod+k" size="sm" /> search all chats
          </li>
          <li>
            <Kbd keys="mod+f" size="sm" /> find in the open chat
          </li>
          <li>
            <Kbd keys="mod+g" size="sm" /> next match
          </li>
        </ul>
      </div>
    );
  }

  const name = app?.persona.name ?? 'Conch';
  const author: Record<SearchRole, string> = { user: 'You', assistant: name, tool: 'Tool' };
  const loading = isPending || data?.conversationId !== target.conversationId;
  const messages: SearchPreviewMessage[] = loading
    ? []
    : (data?.messages ?? []).map((m) => ({
        id: m.anchor,
        from: m.role,
        author: author[m.role],
        time: relativeTime(m.at),
        text: m.text,
        ranges: m.ranges,
        focus: m.focus,
      }));

  return (
    <SearchPreview
      loading={loading}
      title={loading ? '…' : data.title}
      meta={
        !loading &&
        `${dateFormat.format(data.updatedAt)} · ${data.messageCount} ${
          data.messageCount === 1 ? 'message' : 'messages'
        }`
      }
      messages={messages}
      footer={
        <>
          <Kbd keys="enter" size="sm" />
          {selection.kind === 'hit' ? 'Open at this message' : 'Open chat'}
        </>
      }
    />
  );
}

/** A one-line cut of a snippet, centred on its match. */
function Snippet({ text, ranges, width }: { text: string; ranges: TextRange[]; width: number }) {
  const cut = excerpt(text, ranges, width);
  return <Highlight text={cut.text} ranges={cut.ranges} />;
}

function roleIcon(role: SearchRole) {
  return role === 'tool' ? <TextSearch /> : <MessageSquare />;
}

/**
 * ⌘K — one box for everything. Type and you get, instantly: matching chat
 * titles (fuzzy), matching messages from every conversation (full-text,
 * typo-tolerant), and everything else worth finding by name — skills, models
 * from every provider, integrations, routines, pages and settings — and actions. A live preview shows the hit in context;
 * Enter opens the chat scrolled to that exact message, with every match lit.
 */
export function Palette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPalette);
  const openSettings = useUi((s) => s.openSettings);
  const setUsageOpen = useUi((s) => s.setUsageOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const openFind = useUi((s) => s.openFind);
  const theme = useNacreTheme();
  const navigate = useNavigate();
  const { conversationId: currentId } = useParams();
  const { data: conversations } = useConversations();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  /** Whether the user moved the selection since they last typed. */
  const [navigated, setNavigated] = useState(false);

  const q = query.trim();
  const search = useSearchResults(q, open);
  const findables = useFindables(open ? q : '', currentId);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setQuery('');
      setSelected('');
      setNavigated(false);
    }
  };

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  const actions: Action[] = [
    {
      id: 'new',
      label: 'New chat',
      icon: <SquarePen />,
      shortcut: 'mod+shift+o',
      keywords: 'start conversation',
      run: () => void navigate('/'),
    },
    {
      id: 'new-skill',
      label: 'New skill',
      icon: <WandSparkles />,
      keywords: 'new skill create',
      run: () => void navigate('/skills/new'),
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings />,
      shortcut: 'mod+,',
      keywords: 'preferences options',
      run: () => openSettings(),
    },
    {
      id: 'memory',
      label: 'What do you remember about me?',
      icon: <Brain />,
      keywords: 'memory memories',
      run: () => openSettings('memory'),
    },
    {
      id: 'usage',
      label: 'How much usage do I have left?',
      icon: <Gauge />,
      keywords: 'limits quota plan',
      run: () => setUsageOpen(true),
    },
    {
      id: 'theme',
      label: theme.resolvedMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
      icon: theme.resolvedMode === 'dark' ? <Sun /> : <Moon />,
      keywords: 'theme appearance dark light',
      run: () => theme.setTheme({ mode: theme.resolvedMode === 'dark' ? 'light' : 'dark' }),
    },
    {
      id: 'sidebar',
      label: 'Toggle sidebar',
      icon: <PanelLeft />,
      shortcut: 'mod+b',
      run: toggleSidebar,
    },
  ];

  const titles = useMemo(
    () => (q ? fuzzyFilter(conversations ?? [], q, (c) => c.title, 6) : []),
    [conversations, q],
  );
  const matchedActions = q
    ? fuzzyFilter(actions, q, (a) => `${a.label} ${a.keywords ?? ''}`, 4)
        // Keywords help find an action, but only highlight what's visible.
        .map(({ item }) => item)
    : actions;
  const recent = q ? [] : (conversations ?? []).slice(0, 6);
  const groups: SearchGroup[] = search.data?.groups ?? [];
  const fuzzy = search.data?.mode === 'fuzzy';
  const titleById = new Map((conversations ?? []).map((c) => [c.id, c]));

  const openChat = (id: string) => run(() => void navigate(`/c/${id}`));
  const openHit = (hit: SearchHit) =>
    run(() => {
      // A close (typo) match lands on what was actually matched, not what was typed.
      const [start, end] = hit.ranges[0] ?? [0, 0];
      const find = fuzzy && end > start ? hit.snippet.slice(start, end) : q;
      openFind(hit.conversationId, find, `[data-anchor="${CSS.escape(hit.anchor)}"]`);
      void navigate(`/c/${hit.conversationId}`);
    });

  // Results arrive while you type; until you move the selection yourself it
  // stays on the best result rather than whatever rendered first.
  const firstHit = groups[0]?.hits[0];
  const firstFound = findables[0]?.items[0];
  const first = recent[0]
    ? value.chat(recent[0].id)
    : titles[0]
      ? value.chat(titles[0].item.id)
      : firstFound
        ? value.action(firstFound.id)
        : firstHit
          ? value.hit(firstHit.conversationId, firstHit.anchor)
          : q && currentId
            ? value.action('find-here')
            : matchedActions[0]
              ? value.action(matchedActions[0].id)
              : '';
  const active = navigated && selected ? selected : first;

  const nothing =
    q.length > 0 &&
    !search.pending &&
    !titles.length &&
    !groups.length &&
    !matchedActions.length &&
    !findables.length;
  const messageCount = search.data?.total ?? 0;
  const found = `${messageCount}${search.data?.capped ? '+' : ''} ${
    messageCount === 1 ? 'message' : 'messages'
  } in ${groups.length}${groups.length >= 12 ? '+' : ''} ${groups.length === 1 ? 'chat' : 'chats'}`;
  const status =
    q.length > 0 && q.length < 3 && !titles.length
      ? 'Keep typing to search messages'
      : q.length < 3
        ? ''
        : search.unavailable
          ? 'Search isn’t working right now'
          : !search.data
            ? ''
            : search.catchingUp
              ? groups.length
                ? `${found} so far, still catching up…`
                : 'Search is catching up…'
              : fuzzy && groups.length
                ? `No exact matches — showing close ones`
                : groups.length
                  ? found
                  : '';
  const repair = (
    <Button
      size="sm"
      variant="surface"
      leadingIcon={<Wrench />}
      loading={search.repairing}
      onClick={search.repair}
    >
      Repair search
    </Button>
  );

  return (
    <CommandPalette
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      placeholder="Search chats, skills, models, apps…"
      search={query}
      onSearchChange={(next) => {
        setQuery(next);
        setNavigated(false);
      }}
      shouldFilter={false}
      loading={search.pending && !search.data && titles.length === 0}
      size="lg"
      value={active}
      onValueChange={(next) => {
        setSelected(next);
        setNavigated(next !== first);
      }}
      aside={<Preview selection={parse(active)} query={q} />}
      empty={
        !nothing ? null : search.unavailable ? (
          // One next step, never a dead end: rebuild it from the chats.
          <Stack gap={3} align="center" className={styles.empty}>
            <span>
              Search isn’t working right now.
              <br />
              Repair rebuilds it from your chats.
            </span>
            {repair}
          </Stack>
        ) : search.catchingUp ? (
          <span className={styles.empty}>
            Search is catching up on your chats.
            <br />
            Results will appear in a moment.
          </span>
        ) : (
          <span className={styles.empty}>
            Nothing matches “{q}”.
            <br />
            Try fewer words, or part of a word.
          </span>
        )
      }
      footer={
        <>
          <span className={styles.status} role="status" aria-live="polite">
            {status}
          </span>
          {search.unavailable && !nothing && repair}
          <span aria-hidden className={styles.keys}>
            <Kbd keys={['up']} size="sm" />
            <Kbd keys={['down']} size="sm" />
          </span>
          <span aria-hidden className={styles.keys}>
            <Kbd keys="enter" size="sm" /> open
          </span>
          <span aria-hidden className={styles.keys}>
            <Kbd keys="esc" size="sm" /> close
          </span>
        </>
      }
    >
      {recent.length > 0 && (
        <CommandPalette.Group heading="Recent">
          {recent.map((c) => (
            <CommandPalette.Item
              key={c.id}
              value={value.chat(c.id)}
              icon={<MessageSquare />}
              hint={relativeTime(c.updatedAt)}
              onSelect={openChat(c.id)}
            >
              {c.title}
            </CommandPalette.Item>
          ))}
        </CommandPalette.Group>
      )}

      {titles.length > 0 && (
        <CommandPalette.Group heading="Chats">
          {titles.map(({ item: c, match }) => (
            <CommandPalette.Item
              key={c.id}
              value={value.chat(c.id)}
              icon={<MessageSquare />}
              hint={relativeTime(c.updatedAt)}
              onSelect={openChat(c.id)}
            >
              <Highlight text={c.title} ranges={match.ranges} />
            </CommandPalette.Item>
          ))}
        </CommandPalette.Group>
      )}

      {findables.map((group) => (
        <CommandPalette.Group key={group.heading} heading={group.heading}>
          {group.items.map((item) => (
            <CommandPalette.Item
              key={item.id}
              value={value.action(item.id)}
              icon={item.icon}
              hint={item.hint}
              description={item.description}
              onSelect={run(item.run)}
            >
              {item.ranges ? <Highlight text={item.label} ranges={item.ranges} /> : item.label}
            </CommandPalette.Item>
          ))}
        </CommandPalette.Group>
      ))}

      {groups.length > 0 && (
        <CommandPalette.Group heading={fuzzy ? 'Close matches' : 'Messages'}>
          {groups.map((group) => {
            const summary: ConversationSummary | undefined = titleById.get(group.conversationId);
            return group.hits.map((hit, i) =>
              i === 0 ? (
                <CommandPalette.Item
                  key={`${group.conversationId}|${hit.anchor}`}
                  value={value.hit(group.conversationId, hit.anchor)}
                  icon={roleIcon(hit.role)}
                  hint={
                    group.matches > 1
                      ? `${group.matches} matches · ${relativeTime(hit.at)}`
                      : relativeTime(hit.at)
                  }
                  description={<Highlight text={hit.snippet} ranges={hit.ranges} />}
                  onSelect={openHit(hit)}
                >
                  {summary?.title ?? group.title}
                </CommandPalette.Item>
              ) : (
                <CommandPalette.Item
                  key={`${group.conversationId}|${hit.anchor}`}
                  value={value.hit(group.conversationId, hit.anchor)}
                  icon={<CornerDownRight />}
                  inset
                  onSelect={openHit(hit)}
                >
                  <Snippet text={hit.snippet} ranges={hit.ranges} width={54} />
                </CommandPalette.Item>
              ),
            );
          })}
        </CommandPalette.Group>
      )}

      {q && currentId && (
        <CommandPalette.Group heading="This chat">
          <CommandPalette.Item
            value={value.action('find-here')}
            icon={<TextSearch />}
            shortcut="mod+f"
            onSelect={run(() => openFind(currentId, q))}
          >
            Find “{q}” in this chat
          </CommandPalette.Item>
        </CommandPalette.Group>
      )}

      {matchedActions.length > 0 && (
        <CommandPalette.Group heading="Actions">
          {matchedActions.map((a) => (
            <CommandPalette.Item
              key={a.id}
              value={value.action(a.id)}
              icon={a.icon}
              shortcut={a.shortcut}
              onSelect={run(a.run)}
            >
              {a.label}
            </CommandPalette.Item>
          ))}
        </CommandPalette.Group>
      )}
    </CommandPalette>
  );
}
