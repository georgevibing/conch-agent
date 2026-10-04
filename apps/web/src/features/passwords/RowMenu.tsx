import type { VaultItemSummary } from '@conch/protocol';
import { ContextMenu, VaultSourceBadge, vaultSourceName } from '@conch/nacre';
import {
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  ListChecks,
  Pencil,
  RotateCcw,
  Star,
  Timer,
  Trash2,
  UserRound,
} from 'lucide-react';

import { type CopyTarget, type ItemActions, mayHaveCode } from './actions';

const plural = (n: number) => `${n} ${n === 1 ? 'item' : 'items'}`;

/**
 * What a right-click (or a long press) on a row offers: the item's own
 * things to copy and open, then what can be done with it — or, on one of
 * several chosen, what can be done with all of them. Every action here is
 * also somewhere else on the page; this is the short way.
 */
export function RowMenu({
  item,
  chosen,
  actions,
  targets,
  onOpen,
  onEdit,
  onSelect,
  onClearSelection,
}: {
  item: VaultItemSummary;
  /** The chosen items, when the row is one of several chosen: the menu acts on them all. */
  chosen?: VaultItemSummary[];
  actions: ItemActions;
  targets: CopyTarget[];
  onOpen: (id: string) => void;
  onEdit: (id: string) => void;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
}) {
  const many = chosen && chosen.length > 1 ? chosen : undefined;
  const items = many ?? [item];
  const mine = items.filter((i) => i.source === 'conch' && !i.deletedAt);
  const theirs = items.filter((i) => i.readOnly && i.source !== 'system' && i.source !== 'conch');
  const deleted = items.filter((i) => i.deletedAt);
  const unfavourite = mine.length > 0 && mine.every((i) => i.favorite);

  const copyTo = targets.map((t) =>
    t.places.length > 1 ? (
      <ContextMenu.Sub key={t.id}>
        <ContextMenu.SubTrigger icon={<VaultSourceBadge source={t.id} />}>
          {`Copy ${many ? `${plural(mine.length)} ` : ''}to ${t.name}`}
        </ContextMenu.SubTrigger>
        <ContextMenu.SubContent>
          {t.places.map((p) => (
            <ContextMenu.Item key={p.id} onSelect={() => void actions.copyTo(mine, t, p)}>
              {p.name}
            </ContextMenu.Item>
          ))}
        </ContextMenu.SubContent>
      </ContextMenu.Sub>
    ) : (
      <ContextMenu.Item
        key={t.id}
        icon={<VaultSourceBadge source={t.id} />}
        onSelect={() => void actions.copyTo(mine, t, t.places[0])}
      >
        {`Copy ${many ? `${plural(mine.length)} ` : ''}to ${t.name}`}
      </ContextMenu.Item>
    ),
  );

  return (
    <ContextMenu.Content>
      {many ? (
        <ContextMenu.Label>{plural(many.length)} chosen</ContextMenu.Label>
      ) : (
        <>
          <ContextMenu.Item
            icon={<ExternalLink />}
            shortcut="enter"
            onSelect={() => onOpen(item.id)}
          >
            Open
          </ContextMenu.Item>
          {!item.deletedAt && (
            <>
              <ContextMenu.Separator />
              {(item.type === 'login' || item.subtitle) && (
                <ContextMenu.Item
                  icon={<UserRound />}
                  shortcut="mod+shift+c"
                  onSelect={() => void actions.copyUsername(item)}
                >
                  Copy username
                </ContextMenu.Item>
              )}
              {item.type === 'login' && (
                <ContextMenu.Item
                  icon={<KeyRound />}
                  shortcut="mod+c"
                  onSelect={() => void actions.copyPassword(item)}
                >
                  Copy password
                </ContextMenu.Item>
              )}
              {mayHaveCode(item) && (
                <ContextMenu.Item
                  icon={<Timer />}
                  shortcut="mod+alt+c"
                  onSelect={() => void actions.copyCode(item)}
                >
                  Copy one-time code
                </ContextMenu.Item>
              )}
              {item.domains[0] && (
                <>
                  <ContextMenu.Item icon={<Copy />} onSelect={() => actions.copySite(item)}>
                    Copy website
                  </ContextMenu.Item>
                  <ContextMenu.Item icon={<Globe />} onSelect={() => actions.openSite(item)}>
                    Open {item.domains[0]}
                  </ContextMenu.Item>
                </>
              )}
            </>
          )}
        </>
      )}

      {(mine.length > 0 || theirs.length > 0) && <ContextMenu.Separator />}
      {mine.length > 0 && (
        <ContextMenu.Item
          icon={<Star />}
          onSelect={() => void actions.favorite(mine, !unfavourite)}
        >
          {unfavourite ? 'Remove from Favourites' : 'Add to Favourites'}
        </ContextMenu.Item>
      )}
      {!many && mine.length === 1 && (
        <ContextMenu.Item icon={<Pencil />} onSelect={() => onEdit(item.id)}>
          Edit
        </ContextMenu.Item>
      )}
      {theirs.length > 0 && (
        <ContextMenu.Item
          icon={<VaultSourceBadge source="conch" />}
          onSelect={() => void actions.copyIntoConch(theirs)}
        >
          {`Copy ${many ? `${plural(theirs.length)} ` : ''}into Conch`}
        </ContextMenu.Item>
      )}
      {mine.length > 0 && copyTo}

      <ContextMenu.Separator />
      {many ? (
        <ContextMenu.Item icon={<ListChecks />} shortcut="escape" onSelect={onClearSelection}>
          Clear the choice
        </ContextMenu.Item>
      ) : (
        <ContextMenu.Item icon={<ListChecks />} onSelect={() => onSelect(item.id)}>
          Select
        </ContextMenu.Item>
      )}
      {deleted.length > 0 && (
        <>
          <ContextMenu.Item icon={<RotateCcw />} onSelect={() => void actions.restore(deleted)}>
            {many ? `Restore ${plural(deleted.length)}` : 'Restore'}
          </ContextMenu.Item>
          <ContextMenu.Item icon={<Trash2 />} tone="danger" onSelect={() => actions.purge(deleted)}>
            {many ? `Delete ${plural(deleted.length)} for good` : 'Delete for good'}
          </ContextMenu.Item>
        </>
      )}
      {mine.length > 0 && (
        <ContextMenu.Item
          icon={<Trash2 />}
          tone="danger"
          shortcut="delete"
          onSelect={() => void actions.trash(mine)}
        >
          {many ? `Delete ${plural(mine.length)}` : 'Delete'}
        </ContextMenu.Item>
      )}
      {theirs.length > 0 && mine.length === 0 && deleted.length === 0 && (
        <ContextMenu.Label>
          {theirs.length === 1 ? 'Delete it' : 'Delete them'} in{' '}
          {[...new Set(theirs.map((i) => vaultSourceName(i.source)))].join(' or ')}
        </ContextMenu.Label>
      )}
    </ContextMenu.Content>
  );
}
