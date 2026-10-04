import { Bot, LayoutGrid } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import styles from './ComeHome.module.css';
import { importGroups, IMPORT_ORDER, type ImportPreviewItem } from './ImportPreview';

/** What the list shows: everything, one kind (`memories`), or one other agent (`agent:<id>`). */
export type ImportView = 'all' | string;

export interface ImportOverviewProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  items: ImportPreviewItem[];
  selected: string[];
  view: ImportView;
  onViewChange: (view: ImportView) => void;
}

interface Tile {
  view: ImportView;
  label: string;
  icon: ReactNode;
  total: number;
  ticked: number;
}

/**
 * Everything that could come over, at a glance: a tile for each kind of
 * thing (and each other agent), with how many are ticked. A tile shows just
 * that kind below; Everything shows it all.
 */
export function ImportOverview({
  items,
  selected,
  view,
  onViewChange,
  className,
  ...props
}: ImportOverviewProps) {
  const on = new Set(selected);
  const count = (list: ImportPreviewItem[]) => ({
    total: list.length,
    ticked: list.filter((i) => on.has(i.id)).length,
  });
  const tiles: Tile[] = [
    { view: 'all', label: 'Everything', icon: <LayoutGrid />, ...count(items) },
    ...IMPORT_ORDER.flatMap((g) => {
      const list = items.filter((i) => i.group === g && !i.agent);
      return list.length
        ? [{ view: g, label: importGroups[g].label, icon: importGroups[g].icon, ...count(list) }]
        : [];
    }),
    ...[
      ...new Map(items.flatMap((i) => (i.agent ? [[i.agent.id, i.agent] as const] : []))).values(),
    ].map((agent) => ({
      view: `agent:${agent.id}`,
      label: agent.name,
      icon: <Bot />,
      ...count(items.filter((i) => i.agent?.id === agent.id)),
    })),
  ];
  return (
    <div
      role="group"
      aria-label="What there is to bring"
      className={cx(styles.overview, className)}
      {...props}
    >
      {tiles.map((tile) => (
        <button
          key={tile.view}
          type="button"
          className={styles.tile}
          data-lustre=""
          aria-pressed={view === tile.view}
          data-none={tile.ticked === 0 || undefined}
          onClick={() => onViewChange(tile.view)}
        >
          <span className={styles.tileIcon} aria-hidden>
            {tile.icon}
          </span>
          <span className={styles.tileLabel}>{tile.label}</span>
          <span className={styles.tileCount}>
            <strong>{tile.ticked}</strong>
            <span>of {tile.total}</span>
          </span>
          <span className={styles.tileBar} aria-hidden>
            <span style={{ inlineSize: `${tile.total ? (tile.ticked / tile.total) * 100 : 0}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
}
