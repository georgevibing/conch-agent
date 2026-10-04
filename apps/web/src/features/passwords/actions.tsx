import type { VaultFieldView, VaultItemSummary, VaultSource, VaultSourceId } from '@conch/protocol';
import { AlertDialog, Button, toast, vaultSourceName } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import { copyPlain, copySecret } from './clipboard';
import { vaultItemQuery, vaultKeys } from './queries';

type Guard = <T>(task: () => Promise<T>) => Promise<T | undefined>;

/** Where Conch can copy its own items to (ADR 0062): a manager that's on, ready and takes them. */
export interface CopyTarget {
  id: VaultSourceId;
  name: string;
  places: { id: string; name: string }[];
}

/** How many Copy to sends in one request, so the toast can say how far it got. */
const COPY_CHUNK = 10;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "“Mail”" for one item, "3 items" for several. */
function named(items: VaultItemSummary[]): string {
  return items.length === 1 ? `“${items[0]?.title ?? ''}”` : plural(items.length, 'item');
}

export function copyTargets(sources: VaultSource[]): CopyTarget[] {
  return sources
    .filter((s) => s.accepts && s.state === 'ready')
    .map((s) => ({ id: s.id, name: s.name, places: s.places ?? [] }));
}

/** Can an item's one-time code be asked for? 1Password's list doesn't say, so its logins may. */
export function mayHaveCode(item: VaultItemSummary): boolean {
  return item.totp || (item.source === '1password' && item.type === 'login');
}

function passwordField(fields: VaultFieldView[]) {
  return (
    fields.find((f) => f.role === 'password') ??
    fields.find((f) => f.kind === 'secret' && f.role !== 'totp')
  );
}

function usernameField(fields: VaultFieldView[]) {
  return (
    fields.find((f) => f.role === 'username') ??
    fields.find((f) => f.role === 'email') ??
    fields.find((f) => f.kind === 'email')
  );
}

/**
 * Everything a person can do to one item or several, from wherever they are:
 * the right-click menu, the bar over chosen items, the keyboard, an item's
 * own page. Each says what it did in a toast, and deleting can be undone.
 */
export function useItemActions({
  guard,
  onOpen,
  onShowConch,
}: {
  guard: Guard;
  /** Open an item, or none: after deleting one for good. */
  onOpen?: (id: string | undefined) => void;
  /** Show Conch's own items: after copying some in. */
  onShowConch?: () => void;
}) {
  const client = useQueryClient();
  const [purging, setPurging] = useState<VaultItemSummary[]>();
  const refresh = () => void client.invalidateQueries({ queryKey: vaultKeys.all });

  const fields = async (item: VaultItemSummary) =>
    (await client.fetchQuery(vaultItemQuery(item.id))).fields;

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof Error && e.message === 'Not confirmed') return;
    toast.error(errorText(e, fallback));
  };

  const revealCopy = async (item: VaultItemSummary, field: VaultFieldView, what: string) => {
    if (field.value !== undefined) return copyPlain(field.value, what);
    const result = await guard(() => vaultApi.reveal(item.id, field.id, true));
    if (!result) return;
    await copySecret(result.value, what);
  };

  const actions = {
    async copyUsername(item: VaultItemSummary) {
      try {
        const field = usernameField(await fields(item));
        if (field) return await revealCopy(item, field, 'Username');
        if (item.subtitle && item.type === 'login')
          return await copyPlain(item.subtitle, 'Username');
        toast(`“${item.title}” has no username`);
      } catch (e) {
        fail(e, 'Couldn’t copy the username.');
      }
    },

    async copyPassword(item: VaultItemSummary) {
      try {
        const field = passwordField(await fields(item));
        if (!field) return void toast(`“${item.title}” has no password`);
        await revealCopy(item, field, 'Password');
      } catch (e) {
        fail(e, 'Couldn’t copy the password.');
      }
    },

    async copyCode(item: VaultItemSummary) {
      try {
        const code = await guard(() => vaultApi.totp(item.id));
        if (code) await copySecret(code.code, 'Code');
      } catch (e) {
        fail(e, 'Couldn’t get the code.');
      }
    },

    copySite(item: VaultItemSummary) {
      const site = item.domains[0];
      if (site) void copyPlain(site, 'Address');
    },

    openSite(item: VaultItemSummary) {
      const site = item.domains[0];
      if (site) window.open(`https://${site}`, '_blank', 'noopener,noreferrer');
    },

    async favorite(items: VaultItemSummary[], on: boolean) {
      const mine = items.filter((i) => i.source === 'conch' && !i.deletedAt);
      if (!mine.length) return;
      try {
        await Promise.all(mine.map((i) => vaultApi.patch(i.id, { favorite: on })));
        refresh();
        if (mine.length > 1)
          toast(
            on ? `${plural(mine.length, 'item')} added to Favourites` : 'Removed from Favourites',
          );
      } catch (e) {
        fail(e, 'Couldn’t change that.');
      }
    },

    /** To Recently deleted, with Undo. Only Conch's own: a manager's items are deleted there. */
    async trash(items: VaultItemSummary[]) {
      const mine = items.filter((i) => i.source === 'conch' && !i.deletedAt);
      if (!mine.length) return;
      const ids = mine.map((i) => i.id);
      try {
        await vaultApi.trash(ids);
        refresh();
        toast(`${named(mine)} moved to Recently deleted`, {
          description: 'Kept there for 30 days.',
          action: {
            label: 'Undo',
            onClick: () => void vaultApi.restore(ids).then(refresh),
          },
        });
      } catch (e) {
        fail(e, 'Couldn’t delete that.');
      }
    },

    async restore(items: VaultItemSummary[]) {
      const ids = items.filter((i) => i.deletedAt).map((i) => i.id);
      if (!ids.length) return;
      try {
        await vaultApi.restore(ids);
        refresh();
        toast.success(
          `${named(items.filter((i) => i.deletedAt))} ${ids.length === 1 ? 'is' : 'are'} back`,
        );
      } catch (e) {
        fail(e, 'Couldn’t bring that back.');
      }
    },

    /** Deleting for good asks first: it can't be undone. */
    purge(items: VaultItemSummary[]) {
      const gone = items.filter((i) => i.deletedAt);
      if (gone.length) setPurging(gone);
    },

    /** Copy into Conch, from each item's own manager, one way. */
    async copyIntoConch(items: VaultItemSummary[]) {
      const bySource = new Map<VaultSourceId, VaultItemSummary[]>();
      for (const i of items)
        if (i.readOnly && i.source !== 'conch' && i.source !== 'system')
          bySource.set(i.source, [...(bySource.get(i.source) ?? []), i]);
      for (const [source, group] of bySource) {
        const name = vaultSourceName(source);
        const id = toast.loading(`Copying ${named(group)} from ${name} into Conch…`);
        try {
          const started = await guard(() =>
            vaultApi.transfer(source, {
              ids: group.map((i) => i.id),
              skipDuplicates: true,
              keepSynced: false,
            }),
          );
          if (!started) {
            toast.dismiss(id);
            continue;
          }
          let job = started;
          while (job.state === 'running') {
            await new Promise((r) => setTimeout(r, 600));
            job = await vaultApi.transferJob(job.jobId);
            if (job.state === 'running' && job.total > 1)
              toast.loading(`Copying from ${name} into Conch… ${job.done} of ${job.total}`, { id });
          }
          refresh();
          const made = job.copied + job.updated;
          if (job.state !== 'done' || job.failed.length)
            toast.error(job.failed[0]?.message ?? job.message ?? `Couldn’t copy from ${name}.`, {
              id,
              description: made ? `${plural(made, 'item')} did come in.` : undefined,
            });
          else if (made === 0)
            toast(`Already in Conch`, {
              id,
              description: `${group.length === 1 ? 'It looks' : 'They look'} like ${group.length === 1 ? 'an item' : 'items'} you have.`,
            });
          else
            toast.success(
              `${made === 1 && group.length === 1 ? named(group) : plural(made, 'item')} copied into Conch`,
              {
                id,
                description: job.skipped
                  ? `${job.skipped} already there.`
                  : 'It’s Conch’s own now, in your encrypted vault.',
                ...(onShowConch && {
                  action: { label: 'Show in Conch', onClick: onShowConch },
                }),
              },
            );
        } catch (e) {
          toast.error(errorText(e, `Couldn’t copy from ${name}.`), { id });
        }
      }
    },

    /** Copy to (ADR 0062): Conch's own items, made as new items in another manager. */
    async copyTo(
      items: VaultItemSummary[],
      target: CopyTarget,
      place?: { id: string; name: string },
    ) {
      const mine = items.filter((i) => i.source === 'conch' && !i.deletedAt);
      if (!mine.length) return;
      const where = place ? `${target.name} (${place.name})` : target.name;
      const id = toast.loading(`Copying ${named(mine)} to ${where}…`);
      const total = { copied: 0, skipped: 0, failed: [] as { title: string; message: string }[] };
      let stopped = false;
      try {
        for (let at = 0; at < mine.length; at += COPY_CHUNK) {
          const chunk = mine.slice(at, at + COPY_CHUNK);
          const result = await guard(() =>
            vaultApi.copyOut(target.id, {
              ids: chunk.map((i) => i.id),
              ...(place && { place: place.id }),
              skipDuplicates: true,
            }),
          );
          if (!result) {
            // Not confirmed part way: say what already went across.
            if (!total.copied && !total.skipped) return void toast.dismiss(id);
            stopped = true;
            break;
          }
          total.copied += result.copied;
          total.skipped += result.skipped;
          total.failed.push(...result.failed);
          if (mine.length > COPY_CHUNK)
            toast.loading(
              `Copying to ${where}… ${Math.min(at + COPY_CHUNK, mine.length)} of ${mine.length}`,
              { id },
            );
          if (result.failed.length && /locked|unlock/i.test(result.failed[0]?.message ?? '')) break;
        }
        refresh();
        if (total.failed.length)
          toast.error(total.failed[0]?.message ?? `Couldn’t copy to ${target.name}.`, {
            id,
            description: total.copied ? `${plural(total.copied, 'item')} did go in.` : undefined,
          });
        else if (!total.copied)
          toast(`Already in ${target.name}`, {
            id,
            description: 'The same site and account is there already.',
          });
        else
          toast.success(
            `${total.copied === 1 && mine.length === 1 ? named(mine) : plural(total.copied, 'item')} copied to ${where}`,
            {
              id,
              description: stopped
                ? `Stopped before the other ${mine.length - total.copied - total.skipped}.`
                : total.skipped
                  ? `${total.skipped} already there.`
                  : `Change ${total.copied === 1 ? 'it' : 'them'} in either place: they’re separate now.`,
            },
          );
      } catch (e) {
        toast.error(errorText(e, `Couldn’t copy to ${target.name}.`), { id });
      }
    },
  };

  const dialogs: ReactNode = (
    <AlertDialog.Root
      open={Boolean(purging)}
      onOpenChange={(open) => !open && setPurging(undefined)}
    >
      <AlertDialog.Content tone="danger" icon={<Trash2 />}>
        <AlertDialog.Title>
          {purging?.length === 1
            ? `Delete “${purging[0]?.title ?? ''}” for good?`
            : `Delete ${purging?.length ?? 0} items for good?`}
        </AlertDialog.Title>
        <AlertDialog.Description>They can’t be brought back after this.</AlertDialog.Description>
        <AlertDialog.Footer>
          <AlertDialog.Cancel asChild>
            <Button variant="ghost">Cancel</Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <Button
              tone="danger"
              onClick={() => {
                const ids = (purging ?? []).map((i) => i.id);
                void guard(() => vaultApi.purge(ids)).then(
                  (r) => {
                    if (!r) return;
                    refresh();
                    onOpen?.(undefined);
                  },
                  (e: unknown) => fail(e, 'Couldn’t delete that.'),
                );
              }}
            >
              Delete
            </Button>
          </AlertDialog.Action>
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );

  return { ...actions, dialogs };
}

export type ItemActions = ReturnType<typeof useItemActions>;
