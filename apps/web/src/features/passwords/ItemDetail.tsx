import type { VaultFieldView, VaultItemDetail, VaultItemSummary } from '@conch/protocol';
import { siteOf } from '@conch/protocol';
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Dialog,
  DropdownMenu,
  Heading,
  IconButton,
  Skeleton,
  Stack,
  Text,
  TotpCode,
  VaultFavoriteButton,
  VaultFieldRow,
  VaultFieldsSkeleton,
  VaultItemIcon,
  VaultPasskeyRow,
  VaultSourceBadge,
  toast,
  vaultSourceName,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useNavigate } from 'react-router';

import { useUi, type SettingsTab } from '../../app/ui';
import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import type { CopyTarget, ItemActions } from './actions';
import { copyPlain, copySecret } from './clipboard';
import { ago, TYPE_NAMES } from './filter';
import styles from './Passwords.module.css';
import { useVaultItem, vaultKeys } from './queries';

const ACCESS_WORDS: Record<VaultItemDetail['agentAccess'], string> = {
  ask: 'Asks you each time',
  allow: 'Fills it on its sites without asking',
  never: 'Never uses it',
};

function isLink(field: VaultFieldView) {
  return field.kind === 'url' && field.value && siteOf(field.value);
}

/** How many fields an item like this usually has, to hold their place while they're fetched. */
function likelyFields(item: VaultItemSummary): number {
  if (item.type === 'login') return 2 + Math.min(item.domains.length, 2);
  return item.type === 'note' ? 1 : 3;
}

export function ItemDetail({
  id,
  summary,
  settle,
  guard,
  onEdit,
  onBack,
  onDeleted,
  actions,
  targets = [],
  twins = [],
  onOpenItem,
}: {
  /** Copying it into Conch or to another manager (the page's own, so its toasts follow). */
  actions?: ItemActions;
  /** Managers Conch can copy its own items to. */
  targets?: CopyTarget[];
  /** The same account in another place: Conch's copy of a 1Password item, or the other way. */
  twins?: VaultItemSummary[];
  onOpenItem?: (id: string) => void;
  id: string;
  /**
   * What the list already knows about it. Shown at once, so choosing an item
   * never waits on its fields (another app's vault can take a second).
   */
  summary?: VaultItemSummary;
  /** Reached with the arrow keys: ask for its fields once the selection rests. */
  settle?: boolean;
  /** Runs a request through "Confirm it's you" when the gateway asks. */
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
  onEdit: () => void;
  onBack?: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const openSettings = useUi((s) => s.openSettings);
  const { data: full, isPending, error } = useVaultItem(id, { settle });
  // What the list knew stands in until the fields arrive.
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<{ value: string; changedAt: number }[]>();

  const loading = !full && isPending && !error;
  const item: VaultItemSummary | undefined = full ?? (loading ? summary : undefined);
  if (loading && !item)
    return (
      <div className={styles.detail} aria-busy="true">
        <div className={styles.detailHead}>
          <Skeleton shape="block" width="3.25rem" height="3.25rem" />
          <div className={styles.detailTitle}>
            <Skeleton width="40%" />
            <Skeleton width="60%" />
          </div>
        </div>
        <div className={styles.card}>
          <VaultFieldsSkeleton />
        </div>
      </div>
    );
  if (error || !item)
    return (
      <div className={styles.detail}>
        <Callout tone="warning" title="That item couldn’t be opened">
          {error ? errorText(error, 'Try again in a moment.') : 'It may have been deleted.'}
        </Callout>
      </div>
    );

  const external = item.readOnly;
  const openPlace = (place: string, focus?: string) => {
    if (place === 'integrations') return void navigate(focus ? `/apps/${focus}` : '/apps');
    if (place === 'channels')
      return void navigate(focus ? `/channels/${focus}` : '/apps?show=talk');
    if (place === 'skills') return void navigate('/skills', { state: { focus: 'publishers' } });
    openSettings(place as SettingsTab, focus);
  };
  const refresh = () => {
    void client.invalidateQueries({ queryKey: vaultKeys.all });
  };
  const reveal = async (field: VaultFieldView, copy = false) => {
    const result = await guard(() => vaultApi.reveal(id, field.id, copy));
    if (!result) throw new Error('Not confirmed');
    return result.value;
  };
  const deleted = Boolean(item.deletedAt);

  const remove = async () => {
    try {
      await vaultApi.trash([id]);
      toast(`“${item.title}” moved to Recently deleted`, {
        description: `It’s kept for 30 days.`,
        action: { label: 'Undo', onClick: () => void vaultApi.restore([id]).then(refresh) },
      });
      refresh();
      onDeleted();
    } catch (e) {
      toast.error(errorText(e, 'Couldn’t delete it.'));
    }
  };

  const problems = item.problems;
  const site = item.domains[0];
  return (
    <div className={styles.detail} aria-busy={loading || undefined}>
      <div className={styles.detailHead}>
        {onBack && (
          <IconButton label="Back to the list" onClick={onBack}>
            <ArrowLeft />
          </IconButton>
        )}
        <VaultItemIcon kind={item.type} domain={site} title={item.title} size="lg" />
        <div className={styles.detailTitle}>
          <Heading level={2} size="xl">
            {item.title}
          </Heading>
          <Text size="sm" tone="subtle" className={styles.detailWhere}>
            <VaultSourceBadge source={item.source} />
            <span>
              {item.source === 'conch'
                ? 'In Conch'
                : `${vaultSourceName(item.source)}${item.container ? ` · ${item.container}` : ''}`}
              {` · ${TYPE_NAMES[item.type].one}`}
              {item.updatedAt ? ` · edited ${ago(item.updatedAt)}` : ''}
              {` · ${item.usedAt ? `used ${ago(item.usedAt)}` : 'not used yet'}`}
            </span>
          </Text>
        </div>
        <div className={styles.detailActions}>
          {external && item.source !== 'system' && actions && (
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<VaultSourceBadge source="conch" />}
              onClick={() => void actions.copyIntoConch([item])}
            >
              Copy into Conch
            </Button>
          )}
          {full && !external && !deleted && (
            <VaultFavoriteButton
              favorite={item.favorite}
              onToggle={() => void vaultApi.patch(id, { favorite: !item.favorite }).then(refresh)}
            />
          )}
          {full && !external && !deleted && (
            <Button size="sm" variant="surface" leadingIcon={<Pencil />} onClick={onEdit}>
              Edit
            </Button>
          )}
          {full && deleted && (
            <Button
              size="sm"
              leadingIcon={<RotateCcw />}
              onClick={() =>
                void vaultApi.restore([id]).then(() => {
                  refresh();
                  toast.success(`“${item.title}” is back`);
                })
              }
            >
              Restore
            </Button>
          )}
          {full && !external && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label="More">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                {!deleted &&
                  actions &&
                  targets.flatMap((t) =>
                    (t.places.length > 1 ? t.places : [undefined]).map((p) => (
                      <DropdownMenu.Item
                        key={`${t.id}:${p?.id ?? ''}`}
                        icon={<VaultSourceBadge source={t.id} />}
                        onSelect={() => void actions.copyTo([item], t, p ?? t.places[0])}
                      >
                        Copy to {t.name}
                        {p && t.places.length > 1 ? ` · ${p.name}` : ''}
                      </DropdownMenu.Item>
                    )),
                  )}
                {!deleted && actions && targets.length > 0 && <DropdownMenu.Separator />}
                {full.history > 0 && (
                  <DropdownMenu.Item
                    icon={<History />}
                    onSelect={() =>
                      void guard(() => vaultApi.history(id)).then((h) => h && setHistory(h.entries))
                    }
                  >
                    Earlier passwords ({full.history})
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item
                  icon={<Trash2 />}
                  tone="danger"
                  onSelect={() => setConfirmDelete(true)}
                >
                  {deleted ? 'Delete now' : 'Delete'}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
        </div>
      </div>

      {full?.source === 'system' && full.manage && (
        <Callout
          tone="info"
          className={styles.detailNote}
          action={
            <Button
              size="sm"
              variant="surface"
              onClick={() => openPlace(full.manage?.place ?? '', full.manage?.focus)}
            >
              {full.manage.label}
            </Button>
          }
        >
          A key Conch uses for {full.usedBy[0] ?? 'itself'}. It’s sealed with this computer’s key,
          so it works even while Passwords is locked. Change it where it’s used.
        </Callout>
      )}
      {external && item.source !== 'system' && (
        <Callout tone="info" className={styles.detailNote}>
          From {vaultSourceName(item.source)}
          {item.container ? ` · ${item.container}` : ''}. Change it there; Conch shows it here and
          can fill it in for you.
          {twins.every((t) => t.source !== 'conch') &&
            ' To keep it in Conch too, even when the app isn’t there, copy it into Conch.'}
        </Callout>
      )}
      {twins.length > 0 && onOpenItem && (
        <div className={styles.detailTwins}>
          <Text as="span" size="sm" tone="subtle">
            Also in
          </Text>
          {twins.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="ghost"
              leadingIcon={<VaultSourceBadge source={t.source} />}
              onClick={() => onOpenItem(t.id)}
            >
              {t.source === 'conch' ? 'Conch' : vaultSourceName(t.source)}
              {t.container ? ` · ${t.container}` : ''}
            </Button>
          ))}
        </div>
      )}
      {full?.origin && (
        <Callout tone="info" className={styles.detailNote}>
          {full.origin.syncing
            ? `Copied from ${vaultSourceName(full.origin.source)} and kept up to date from it${full.origin.syncedAt ? `, last ${ago(full.origin.syncedAt)}` : ''}. Changing it here makes this copy yours: syncs leave it alone after that.`
            : `Copied from ${vaultSourceName(full.origin.source)}${full.origin.syncedAt ? ` ${ago(full.origin.syncedAt)}` : ''}. It’s Conch’s own now.`}
        </Callout>
      )}
      {problems.includes('compromised') && (
        <Callout
          tone="danger"
          title="This password was in a data breach"
          className={styles.detailNote}
        >
          Anyone could try it. Change it on {site ?? 'the site'}, then here.
          {full && !external && (
            <Button size="sm" variant="surface" onClick={onEdit} style={{ marginInlineStart: 8 }}>
              Change password
            </Button>
          )}
        </Callout>
      )}
      {!problems.includes('compromised') && problems.includes('reused') && (
        <Callout
          tone="warning"
          title="You use this password somewhere else too"
          className={styles.detailNote}
        >
          If one site leaks it, the others are open. Give this one its own.
        </Callout>
      )}
      {problems.includes('weak') && !problems.includes('compromised') && (
        <Callout
          tone="warning"
          title="This password is easy to guess"
          className={styles.detailNote}
        >
          A long random one is safer, and Conch remembers it for you.
        </Callout>
      )}
      {problems.includes('expired') && (
        <Callout tone="warning" title="This has expired" className={styles.detailNote}>
          Update the date when you get a new one.
        </Callout>
      )}

      <div className={styles.card}>
        {!full ? (
          <VaultFieldsSkeleton rows={likelyFields(item)} />
        ) : (
          <>
            {full.fields.map((field) =>
              field.kind === 'totp' ? (
                <TotpCode
                  key={field.id}
                  label={field.label}
                  period={30}
                  onFetch={async () => {
                    const code = await guard(() =>
                      vaultApi.totp(id, external ? undefined : field.id),
                    );
                    if (!code) throw new Error('Confirm it’s you to see the code.');
                    return code;
                  }}
                  onCopy={(code) => copySecret(code, 'Code')}
                />
              ) : (
                <VaultFieldRow
                  key={field.id}
                  label={field.label}
                  value={field.value}
                  concealed={field.value === undefined}
                  mono={field.kind === 'secret' || field.kind === 'pin'}
                  multiline={field.kind === 'multiline' || field.kind === 'secretText'}
                  strength={field.strength}
                  href={isLink(field) ? field.value : undefined}
                  onReveal={field.value === undefined ? () => reveal(field) : undefined}
                  onCopy={async (shown) => {
                    if (field.value !== undefined) return copyPlain(field.value, field.label);
                    const value = shown ?? (await reveal(field, true));
                    await copySecret(value, field.label);
                  }}
                />
              ),
            )}
            {full.urls.map((url) => (
              <VaultFieldRow
                key={url}
                label="Website"
                value={url}
                href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
                onCopy={() => copyPlain(url, 'Address')}
              />
            ))}
            {!full.fields.length && !full.urls.length && (
              <div className={styles.emptyFields}>
                <Text tone="subtle">Nothing saved in this item yet.</Text>
              </div>
            )}
          </>
        )}
      </div>

      {full && full.passkeys.length > 0 && (
        <section className={styles.section} aria-label="Passkeys">
          <Heading level={3} size="xs" tone="subtle">
            Passkeys
          </Heading>
          <Stack gap={2}>
            {full.passkeys.map((p) => (
              <VaultPasskeyRow
                key={p.id}
                site={p.rpId}
                userName={p.userName}
                when={p.usedAt ? `Used ${ago(p.usedAt)}` : 'Not used yet'}
                action={
                  !external && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void guard(() => vaultApi.removePasskey(id, p.id)).then(
                          (done) => {
                            if (!done) return;
                            toast(`Removed the passkey for ${p.rpId}`, {
                              description: `Sign in to ${p.rpId} with the password, or make a new passkey there.`,
                            });
                            refresh();
                          },
                          (e: unknown) => toast.error(errorText(e, 'Couldn’t remove it.')),
                        )
                      }
                    >
                      Remove
                    </Button>
                  )
                }
              />
            ))}
          </Stack>
          <Text size="xs" tone="subtle">
            Your assistant signs in with a passkey in Conch’s browser, on {full.passkeys[0]?.rpId}{' '}
            only, after asking you. The key itself never leaves Conch.
          </Text>
        </section>
      )}

      {full?.notes && (
        <section className={styles.section}>
          <Heading level={3} size="xs" tone="subtle">
            Notes
          </Heading>
          <Text className={styles.notes}>{full.notes}</Text>
        </section>
      )}

      {item.tags.length > 0 && (
        <Stack direction="row" gap={1} wrap className={styles.section}>
          {item.tags.map((t) => (
            <Badge key={t} size="sm">
              {t}
            </Badge>
          ))}
        </Stack>
      )}

      {full && !external && (
        <section className={styles.section}>
          <Heading level={3} size="xs" tone="subtle">
            Your assistant
          </Heading>
          <Text size="sm">
            {ACCESS_WORDS[full.agentAccess]}
            {full.agentAccess !== 'never' &&
              full.domains.length > 0 &&
              ` · only on ${[...full.domains, ...full.allowedSites].join(', ')}`}
          </Text>
          <Text size="xs" tone="subtle">
            It never sees the password: Conch types it into the page.
            {item.usedAt ? ` Last used ${ago(item.usedAt)}.` : ''}
          </Text>
          {full.usedBy.length > 0 && (
            <Text size="xs" tone="subtle">
              Used by {full.usedBy.join(', ')}.
            </Text>
          )}
        </section>
      )}

      <AlertDialog.Root open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialog.Content tone="danger" icon={<Trash2 />}>
          <AlertDialog.Title>
            {deleted ? `Delete “${item.title}” for good?` : `Delete “${item.title}”?`}
          </AlertDialog.Title>
          <AlertDialog.Description>
            {deleted
              ? 'It can’t be brought back after this.'
              : 'It goes to Recently deleted, where you can bring it back for 30 days.'}
          </AlertDialog.Description>
          <AlertDialog.Footer>
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                tone="danger"
                onClick={() =>
                  void (deleted
                    ? guard(() => vaultApi.purge([id])).then((r) => {
                        if (!r) return;
                        refresh();
                        onDeleted();
                      })
                    : remove())
                }
              >
                Delete
              </Button>
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <Dialog.Root
        open={history !== undefined}
        onOpenChange={(open) => !open && setHistory(undefined)}
      >
        <Dialog.Content size="md">
          <Dialog.Header>
            <Dialog.Title>Earlier passwords</Dialog.Title>
            <Dialog.Description>What “{item.title}” used before, newest first.</Dialog.Description>
          </Dialog.Header>
          <Dialog.Body>
            <div className={styles.card}>
              {(history ?? []).map((h, i) => (
                <VaultFieldRow
                  key={i}
                  label={`Changed ${ago(h.changedAt)}`}
                  concealed
                  mono
                  onReveal={() => Promise.resolve(h.value)}
                  onCopy={() => copySecret(h.value)}
                />
              ))}
            </div>
          </Dialog.Body>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
