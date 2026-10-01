import {
  Brain,
  CalendarClock,
  KeyRound,
  MessageCircle,
  Puzzle,
  Sparkles,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Collapsible } from '../../components/Collapsible';
import { cx } from '../../utils/cx';
import styles from './ComeHome.module.css';

export type ImportGroupId =
  'persona' | 'about' | 'memories' | 'skills' | 'routines' | 'channels' | 'keys';

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
}

export const importGroups: Record<
  ImportGroupId,
  { label: string; note?: string; icon: ReactNode }
> = {
  persona: { label: 'Personality', icon: <Sparkles /> },
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

const ORDER: ImportGroupId[] = [
  'persona',
  'about',
  'memories',
  'skills',
  'routines',
  'channels',
  'keys',
];

/** How many of a long group show before “Show all”. */
const FOLD = 6;

export interface ImportPreviewProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  items: ImportPreviewItem[];
  /** The ticked ids. */
  selected: string[];
  onSelectedChange: (selected: string[]) => void;
  /** What couldn't be read, in sentences. */
  problems?: string[];
  disabled?: boolean;
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
  items,
  selected,
  toggle,
  setMany,
  disabled,
}: {
  id: ImportGroupId;
  items: ImportPreviewItem[];
  selected: Set<string>;
  toggle: (id: string, on: boolean) => void;
  setMany: (ids: string[], on: boolean) => void;
  disabled?: boolean;
}) {
  const headId = useId();
  const [all, setAll] = useState(false);
  const group = importGroups[id];
  const ticked = items.filter((i) => selected.has(i.id)).length;
  const state = ticked === 0 ? false : ticked === items.length ? true : 'indeterminate';
  const shown = all ? items : items.slice(0, FOLD);
  return (
    <section className={styles.group} aria-labelledby={headId} data-group={id}>
      <header className={styles.groupHead}>
        <span className={styles.groupIcon} aria-hidden>
          {group.icon}
        </span>
        <h3 className={styles.groupTitle} id={headId}>
          {group.label}
        </h3>
        <span className={styles.groupCount}>
          {ticked} of {items.length}
        </span>
        {items.length > 1 && (
          <Checkbox
            size="sm"
            className={styles.groupAll}
            aria-label={`All ${group.label.toLowerCase()}`}
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
      {group.note && <p className={styles.groupNote}>{group.note}</p>}
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
      {items.length > FOLD && (
        <Button variant="ghost" size="sm" className={styles.more} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </Button>
      )}
    </section>
  );
}

/**
 * Exactly what would come over from another agent (ADR 0035), grouped, each
 * with a tick and its words. What could surprise — a worrying skill, a bot,
 * a key — says why it starts unticked, right beside it.
 */
export function ImportPreview({
  items,
  selected,
  onSelectedChange,
  problems = [],
  disabled,
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
  return (
    <div className={cx(styles.preview, className)} {...props}>
      {ORDER.map((g) => {
        const inGroup = items.filter((i) => i.group === g);
        return inGroup.length ? (
          <Group
            key={g}
            id={g}
            items={inGroup}
            selected={set}
            toggle={toggle}
            setMany={setMany}
            disabled={disabled}
          />
        ) : null;
      })}
      {problems.length > 0 && (
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
