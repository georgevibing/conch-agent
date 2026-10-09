import {
  CalendarPlus,
  ChevronRight,
  CloudUpload,
  FilePen,
  GitCommitHorizontal,
  Globe,
  PackagePlus,
  Redo2,
  Send,
  ShoppingBag,
  Sparkle,
  Trash,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { useId, useState, type ComponentProps, type CSSProperties } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { continuing } from '../Story/format';
import type { StoryEffect, StoryEffectKind } from '../Story/types';
import styles from './WhatChanged.module.css';
import { META_SEP } from '../../components/MetaList';

export interface WhatChangedGroup {
  kind: StoryEffectKind;
  /** The group in a few words: "Changed 4 files", "Committed", "Pushed to main". */
  text: string;
  items: StoryEffect[];
}

export interface WhatChangedProps extends Omit<ComponentProps<'section'>, 'children'> {
  groups: WhatChangedGroup[];
  /** Put a change set back. Undo shows on every item whose `undo` names one. */
  onUndo?: (changeSetId: string) => Promise<void>;
  /** Make an undone change set again. Redo shows once it's undone, when given. */
  onRedo?: (changeSetId: string) => Promise<void>;
  /** The change sets already put back. */
  undone?: ReadonlySet<string>;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** What the card is called, for assistive tech. Default "What changed". */
  label?: string;
}

const ICONS: Record<StoryEffectKind, LucideIcon> = {
  send: Send,
  purchase: ShoppingBag,
  delete: Trash,
  push: CloudUpload,
  publish: Globe,
  schedule: CalendarPlus,
  commit: GitCommitHorizontal,
  install: PackagePlus,
  file: FilePen,
  other: Sparkle,
};

/**
 * Consequential first: what other people see, money, what's gone, what left
 * this computer. Then what stays here.
 */
const ORDER: StoryEffectKind[] = [
  'send',
  'purchase',
  'delete',
  'push',
  'publish',
  'schedule',
  'commit',
  'install',
  'file',
  'other',
];

const WEIGHTY = new Set<StoryEffectKind>(['send', 'purchase', 'delete', 'push', 'publish']);

/** The groups, consequential first, keeping their order within a kind. */
export function orderChanges(groups: WhatChangedGroup[]): WhatChangedGroup[] {
  return groups
    .map((group, i) => ({ group, i }))
    .sort((a, b) => ORDER.indexOf(a.group.kind) - ORDER.indexOf(b.group.kind) || a.i - b.i)
    .map(({ group }) => group);
}

/** "Changed 4 files · committed · pushed to main". */
export function changesSaid(groups: WhatChangedGroup[]): string {
  return groups.map((g, i) => (i === 0 ? g.text : continuing(g.text))).join(META_SEP);
}

type Pending = Record<string, 'undo' | 'redo' | 'failed' | undefined>;

/**
 * What the turn changed in the world, at the end of the reply (ADR 0103):
 * one quiet line — "Changed 4 files · committed · pushed to main" — that
 * opens to each change, the ones others can see or that cost money first,
 * with Undo where a change can be put back. Undone, an item says so and
 * offers Redo.
 */
export function WhatChanged({
  groups,
  onUndo,
  onRedo,
  undone,
  open,
  defaultOpen,
  onOpenChange,
  label = 'What changed',
  className,
  ...props
}: WhatChangedProps) {
  const [pending, setPending] = useState<Pending>({});
  const given = groups.filter((g) => g.items.length > 0 || g.text);
  // Said in the order it happened; listed with the consequential first.
  const ordered = orderChanges(given);
  const isUndone = (id: string) => undone?.has(id) ?? false;

  const run = (id: string, what: 'undo' | 'redo') => {
    const act = what === 'undo' ? onUndo : onRedo;
    if (!act) return;
    setPending((p) => ({ ...p, [id]: what }));
    act(id).then(
      () => setPending((p) => ({ ...p, [id]: undefined })),
      () => setPending((p) => ({ ...p, [id]: 'failed' })),
    );
  };

  const sets = [...new Set(ordered.flatMap((g) => g.items.map((i) => i.undo)))].filter(
    (id): id is string => id !== undefined,
  );
  const open_ = sets.filter((id) => !isUndone(id));
  const allUndone = sets.length > 0 && open_.length === 0;
  const kinds = [...new Set(ordered.map((g) => g.kind))].slice(0, 3);
  const count = ordered.reduce((n, g) => n + g.items.length, 0);
  const baseId = useId();

  const renderItem = (item: StoryEffect) => {
    const id = item.undo;
    const state = id ? pending[id] : undefined;
    const done = id ? isUndone(id) : false;
    return (
      <>
        <span className={styles.itemText} data-undone={done || undefined}>
          <span className={styles.itemWhat}>
            {done && (
              <>
                <span className={styles.undoneTag}>Undone ·</span>{' '}
              </>
            )}
            {item.text}
          </span>
          {item.target && (
            <>
              {' '}
              <span className={styles.target}>{item.target}</span>
            </>
          )}
          {state === 'failed' && (
            <span className={styles.failed} role="status">
              That didn’t go back. Try again in a moment.
            </span>
          )}
        </span>
        {id && !done && onUndo && (
          <Button
            size="sm"
            variant="ghost"
            tone="neutral"
            leadingIcon={<Undo2 />}
            loading={state === 'undo'}
            onClick={() => run(id, 'undo')}
            aria-label={`Undo: ${item.text}`}
          >
            Undo
          </Button>
        )}
        {id && done && onRedo && (
          <Button
            size="sm"
            variant="ghost"
            tone="neutral"
            leadingIcon={<Redo2 />}
            loading={state === 'redo'}
            onClick={() => run(id, 'redo')}
            aria-label={`Redo: ${item.text}`}
          >
            Redo
          </Button>
        )}
      </>
    );
  };

  return (
    <Collapsible.Root open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange} asChild>
      <section
        className={cx(styles.card, className)}
        aria-label={label}
        data-undone={allUndone || undefined}
        {...props}
      >
        <Collapsible.Trigger className={styles.header} data-lustre="">
          <span className={styles.marks} aria-hidden>
            {kinds.map((kind, i) => {
              const Icon = ICONS[kind];
              return (
                <span
                  key={kind}
                  className={styles.mark}
                  data-weighty={WEIGHTY.has(kind) || undefined}
                  style={{ '--i': i } as CSSProperties}
                >
                  <Icon />
                </span>
              );
            })}
          </span>
          <span className={styles.summary}>
            {allUndone && (
              <>
                <span className={styles.undoneTag}>Undone ·</span>{' '}
              </>
            )}
            {changesSaid(given)}
          </span>
          <span className="nc-visually-hidden">
            , {count} {count === 1 ? 'change' : 'changes'}
          </span>
          <ChevronRight className={styles.chevron} aria-hidden />
        </Collapsible.Trigger>
        <Collapsible.Content className={styles.content}>
          <div className={styles.body}>
            <ul className={styles.list}>
              {ordered.map((group, gi) => {
                const Icon = ICONS[group.kind];
                const weighty = WEIGHTY.has(group.kind) || undefined;
                const [only] = group.items;
                if (group.items.length <= 1)
                  return (
                    <li key={`${group.kind}:${gi}`} className={styles.row} data-weighty={weighty}>
                      <Icon aria-hidden className={styles.rowIcon} />
                      {renderItem(only ?? { kind: group.kind, text: group.text })}
                    </li>
                  );
                return (
                  <li key={`${group.kind}:${gi}`} className={styles.group} data-weighty={weighty}>
                    <div className={styles.row}>
                      <Icon aria-hidden className={styles.rowIcon} />
                      <span className={styles.itemText}>
                        <span className={styles.itemWhat} id={`${baseId}-${gi}`}>
                          {group.text}
                        </span>
                      </span>
                    </div>
                    <ul className={styles.sub} aria-labelledby={`${baseId}-${gi}`}>
                      {group.items.map((item, ii) => (
                        <li key={`${item.text}:${ii}`} className={styles.row} data-sub="">
                          {renderItem(item)}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
            {onUndo && open_.length > 1 && (
              <div className={styles.foot}>
                <Button
                  size="sm"
                  variant="soft"
                  tone="neutral"
                  leadingIcon={<Undo2 />}
                  loading={open_.some((id) => pending[id] === 'undo')}
                  onClick={() => open_.forEach((id) => run(id, 'undo'))}
                >
                  Undo all {open_.length} changes
                </Button>
              </div>
            )}
          </div>
        </Collapsible.Content>
      </section>
    </Collapsible.Root>
  );
}
