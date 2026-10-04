import {
  Bot,
  Brain,
  CalendarClock,
  Cpu,
  KeyRound,
  MessageCircle,
  Puzzle,
  Search,
  Sparkles,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Collapsible } from '../../components/Collapsible';
import { Input } from '../../components/Input';
import { cx } from '../../utils/cx';
import styles from './ComeHome.module.css';

export type ImportGroupId =
  'persona' | 'model' | 'about' | 'memories' | 'skills' | 'routines' | 'channels' | 'keys';

export interface ImportPreviewItem {
  id: string;
  group: ImportGroupId;
  title: ReactNode;
  /** Where it's from and what happens to it: “From MEMORY.md”. */
  detail?: ReactNode;
  /** Its words, behind “Show what it says”. */
  preview?: string;
  /** Why it starts unticked, or what it changes: shown beside it, never hidden. */
  warning?: ReactNode;
  /** Conch already has it. */
  duplicate?: boolean;
  /** What Conch saw reading it (a SkillReview). */
  review?: ReactNode;
  /**
   * Another of the person's agents it belongs to (ADR 0042): its things are
   * shown together under its name, after everything else, with one tick.
   */
  agent?: { id: string; name: string };
}

export const importGroups: Record<
  ImportGroupId,
  { label: string; note?: string; icon: ReactNode }
> = {
  persona: { label: 'Personality', icon: <Sparkles /> },
  model: {
    label: 'Model',
    note: 'For new chats. Chats you’ve already started keep theirs.',
    icon: <Cpu />,
  },
  about: { label: 'About you', icon: <User /> },
  memories: { label: 'Memories', icon: <Brain /> },
  skills: {
    label: 'Skills',
    note: 'Conch reads every one first. They come over off, for you to turn on.',
    icon: <Puzzle />,
  },
  routines: {
    label: 'Routines',
    note: 'They come over as drafts: nothing runs until you turn it on.',
    icon: <CalendarClock />,
  },
  channels: {
    label: 'Chat apps',
    note: 'Each bot is checked with its app, then waits for your hello: nobody else gets in.',
    icon: <MessageCircle />,
  },
  keys: {
    label: 'Keys',
    note: 'Into Conch’s encrypted key file. Never shown, never written to a log.',
    icon: <KeyRound />,
  },
};

export const IMPORT_ORDER: ImportGroupId[] = [
  'persona',
  'model',
  'about',
  'memories',
  'skills',
  'routines',
  'channels',
  'keys',
];

/** How many of a long group show before “Show all”: more when it's the one in view. */
const FOLD = 6;
const FOLD_ALONE = 40;
/** A group this long gets its own search. */
const SEARCH_FROM = 12;

/** The words a person would look for in an item. */
const wordsOf = (item: ImportPreviewItem) =>
  [item.title, item.detail, item.preview]
    .map((part) => (typeof part === 'string' ? part : ''))
    .join(' ')
    .toLowerCase();

export interface ImportPreviewProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  items: ImportPreviewItem[];
  /** The ticked ids. */
  selected: string[];
  onSelectedChange: (selected: string[]) => void;
  /** What couldn't be read, in sentences. */
  problems?: string[];
  disabled?: boolean;
  /** Show one kind (`memories`) or one other agent (`agent:<id>`); everything when unset. */
  view?: string;
}

function Row({
  item,
  checked,
  onChange,
  disabled,
}: {
  item: ImportPreviewItem;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.item} data-checked={checked || undefined}>
      <Checkbox
        size="sm"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
        label={
          <span className={styles.itemTitle}>
            {item.title}
            {item.duplicate && (
              <Badge size="sm" tone="neutral">
                Already in Conch
              </Badge>
            )}
          </span>
        }
        description={item.detail}
      />
      {(item.warning || item.preview || item.review) && (
        <div className={styles.itemMore}>
          {item.warning && (
            <p className={styles.warning}>
              <TriangleAlert aria-hidden />
              <span>{item.warning}</span>
            </p>
          )}
          {item.review}
          {item.preview && (
            <Collapsible open={open} onOpenChange={setOpen}>
              <Collapsible.Trigger className={styles.show}>
                {open ? 'Hide what it says' : 'Show what it says'}
              </Collapsible.Trigger>
              <Collapsible.Content>
                <blockquote className={styles.words}>{item.preview}</blockquote>
              </Collapsible.Content>
            </Collapsible>
          )}
        </div>
      )}
    </li>
  );
}

function Group({
  id,
  head,
  items,
  selected,
  toggle,
  setMany,
  disabled,
  alone = false,
}: {
  /** What the section is: a kind of thing, or an agent. */
  id: string;
  /** The only group in view: shows more, and searches when long. */
  alone?: boolean;
  head: { label: string; note?: string; icon: ReactNode; all: string };
  items: ImportPreviewItem[];
  selected: Set<string>;
  toggle: (id: string, on: boolean) => void;
  setMany: (ids: string[], on: boolean) => void;
  disabled?: boolean;
}) {
  const headId = useId();
  const [all, setAll] = useState(false);
  const [query, setQuery] = useState('');
  const ticked = items.filter((i) => selected.has(i.id)).length;
  const state = ticked === 0 ? false : ticked === items.length ? true : 'indeterminate';
  const searchable = items.length >= SEARCH_FROM;
  const q = query.trim().toLowerCase();
  const found = q ? items.filter((i) => wordsOf(i).includes(q)) : items;
  const fold = alone ? FOLD_ALONE : FOLD;
  const shown = all || q ? found : found.slice(0, fold);
  return (
    <section className={styles.group} aria-labelledby={headId} data-group={id}>
      <header className={styles.groupHead}>
        <span className={styles.groupIcon} aria-hidden>
          {head.icon}
        </span>
        <h3 className={styles.groupTitle} id={headId}>
          {head.label}
        </h3>
        <span className={styles.groupCount}>
          {ticked} of {items.length}
        </span>
        {items.length > 1 && (
          <Checkbox
            size="sm"
            className={styles.groupAll}
            aria-label={head.all}
            checked={state}
            disabled={disabled}
            onCheckedChange={(c) =>
              setMany(
                items.map((i) => i.id),
                c === true,
              )
            }
          />
        )}
      </header>
      {head.note && <p className={styles.groupNote}>{head.note}</p>}
      {searchable && (
        <div className={styles.find}>
          <Input
            size="sm"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${items.length} ${head.label.toLowerCase()}`}
            aria-label={`Search ${head.label.toLowerCase()}`}
            leading={<Search aria-hidden />}
          />
          {q && (
            <span className={styles.findActions}>
              <span className={styles.findCount}>{found.length} found</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || !found.length}
                onClick={() =>
                  setMany(
                    found.map((i) => i.id),
                    true,
                  )
                }
              >
                Tick these
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || !found.length}
                onClick={() =>
                  setMany(
                    found.map((i) => i.id),
                    false,
                  )
                }
              >
                Untick these
              </Button>
            </span>
          )}
        </div>
      )}
      {q && !found.length && (
        <p className={styles.groupNote}>Nothing there says “{query.trim()}”.</p>
      )}
      <ul className={styles.items}>
        {shown.map((item) => (
          <Row
            key={item.id}
            item={item}
            checked={selected.has(item.id)}
            onChange={(on) => toggle(item.id, on)}
            disabled={disabled}
          />
        ))}
      </ul>
      {!q && items.length > fold && (
        <Button variant="ghost" size="sm" className={styles.more} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      )}
    </section>
  );
}

/**
 * Exactly what would come over from another agent (ADR 0035), grouped, each
 * with a tick and its words. The other agents it ran (ADR 0042) follow, one
 * section each. What could surprise — a worrying skill, a bot,
 * a key — says why it starts unticked, right beside it.
 */
export function ImportPreview({
  items,
  selected,
  onSelectedChange,
  problems = [],
  disabled,
  view = 'all',
  className,
  ...props
}: ImportPreviewProps) {
  const set = new Set(selected);
  const toggle = (id: string, on: boolean) => setMany([id], on);
  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(set);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    onSelectedChange(items.filter((i) => next.has(i.id)).map((i) => i.id));
  };
  // Another agent's things, together under its name, in the order they came.
  const agents = [
    ...new Map(items.flatMap((i) => (i.agent ? [[i.agent.id, i.agent] as const] : []))).values(),
  ];
  return (
    <div className={cx(styles.preview, className)} {...props}>
      {IMPORT_ORDER.map((g) => {
        if (view !== 'all' && view !== g) return null;
        const inGroup = items.filter((i) => i.group === g && !i.agent);
        const group = importGroups[g];
        return inGroup.length ? (
          <Group
            key={g}
            id={g}
            head={{ ...group, all: `All ${group.label.toLowerCase()}` }}
            items={inGroup}
            selected={set}
            toggle={toggle}
            setMany={setMany}
            disabled={disabled}
            alone={view === g}
          />
        ) : null;
      })}
      {agents
        .filter((agent) => view === 'all' || view === `agent:${agent.id}`)
        .map((agent) => (
          <Group
            key={`agent:${agent.id}`}
            id="agent"
            head={{
              label: agent.name,
              note: 'Another of your agents. Its personality comes over as a skill you pick in a chat; what it knew and did comes too.',
              icon: <Bot />,
              all: `All of ${agent.name}`,
            }}
            items={items.filter((i) => i.agent?.id === agent.id)}
            selected={set}
            toggle={toggle}
            setMany={setMany}
            disabled={disabled}
            alone={view === `agent:${agent.id}`}
          />
        ))}
      {problems.length > 0 && view === 'all' && (
        <section className={styles.problems} aria-label="What stays behind">
          {problems.map((p) => (
            <p key={p} className={styles.warning}>
              <TriangleAlert aria-hidden />
              <span>{p}</span>
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
