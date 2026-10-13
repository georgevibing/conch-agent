import type {
  VaultFieldView,
  VaultItemDetail,
  VaultItemSummary,
  VaultSignIn,
} from '@conch/protocol';
import { isConcealed, siteOf } from '@conch/protocol';
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
  VaultItemHeader,
  VaultItemIcon,
  VaultPasskeyRow,
  VaultSignInRow,
  VaultSourceBadge,
  VaultSourceStrip,
  joinMeta,
  toast,
  vaultSourceName,
  META_SEP,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, History, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { useNavigate } from 'react-router';

import { usePageTrail } from '../../app/trail';
import { useUi, type SettingsTab } from '../../app/ui';
import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import type { CopyTarget, ItemActions } from './actions';
import { copyPlain, copySecret } from './clipboard';
import { ago, signInShape, TYPE_NAMES } from './filter';
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

/**
 * The fields worth a row. A concealed one with nothing in it is left out
 * (dots over nothing would pass for a password that isn't there: an item
 * that signs in with Google has none), and so is an empty line, and the
 * username a sign-in row already shows.
 */
export function shownFields(fields: VaultFieldView[], signIn?: VaultSignIn): VaultFieldView[] {
  return fields.filter((f) => {
    if (isConcealed(f.kind)) return f.filled || f.value !== undefined;
    if (!f.value?.trim()) return false;
    return !(signIn?.account && f.value.trim() === signIn.account);
  });
}

/** A provider you could save a login for ("Google"), not "another account". */
function namedProvider(signIn: VaultSignIn): boolean {
  return signIn.via === 'provider' && (signIn.provider !== 'other' || Boolean(signIn.name));
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
  page = false,
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
  /**
   * A page of its own, the list out of sight (a narrow screen): the header
   * says Passwords › its name, and Passwords is the way back.
   */
  page?: boolean;
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
  usePageTrail(
    page && item ? [{ label: 'Passwords', to: '/passwords' }, { label: item.title }] : null,
  );
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
    if (place === 'passwords')
      return void navigate('/passwords', {
        state: focus === '1password' ? { manage: focus } : { sources: true },
      });
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
  const signIn = item.signIn;
  const shape = signIn && signInShape(signIn);
  const conchTwin = twins.find((t) => t.source === 'conch');
  const twinButtons = onOpenItem
    ? twins.map((t) => (
        <Button
          key={t.id}
          size="sm"
          variant="ghost"
          leadingIcon={<VaultSourceBadge source={t.source} />}
          onClick={() => onOpenItem(t.id)}
        >
          Also in {t.source === 'conch' ? 'Conch' : vaultSourceName(t.source)}
        </Button>
      ))
    : [];
  // Where it lives, in one line: whose it is and the one thing to do about it.
  const strip =
    item.source === 'system' ? (
      <VaultSourceStrip
        source="system"
        label={`Used by ${full?.usedBy[0] ?? 'Conch'}`}
        detail="works while locked"
        action={
          full?.manage && (
            <Button
              size="sm"
              variant="surface"
              onClick={() => openPlace(full.manage?.place ?? '', full.manage?.focus)}
            >
              {full.manage.label}
            </Button>
          )
        }
      />
    ) : external ? (
      <VaultSourceStrip
        source={item.source}
        label={`Stored in ${vaultSourceName(item.source)}`}
        detail={item.container}
        action={
          conchTwin || !actions ? (
            twinButtons.length > 0 && twinButtons
          ) : (
            <Button
              size="sm"
              variant="surface"
              leadingIcon={<VaultSourceBadge source="conch" />}
              onClick={() => void actions.copyIntoConch([item])}
            >
              Copy into Conch
            </Button>
          )
        }
      />
    ) : full?.origin ? (
      <VaultSourceStrip
        source="conch"
        label={
          full.origin.syncing
            ? `Kept up to date from ${vaultSourceName(full.origin.source)}`
            : `Copied from ${vaultSourceName(full.origin.source)}`
        }
        detail={full.origin.syncedAt ? ago(full.origin.syncedAt) : undefined}
        action={twinButtons.length > 0 && twinButtons}
      />
    ) : twinButtons.length > 0 ? (
      <VaultSourceStrip source="conch" label="In Conch" action={twinButtons} />
    ) : null;

  return (
    <div className={styles.detail} aria-busy={loading || undefined}>
      <VaultItemHeader
        icon={<VaultItemIcon kind={item.type} domain={site} title={item.title} size="lg" />}
        title={item.title}
        meta={[
          TYPE_NAMES[item.type].one,
          item.updatedAt ? `Edited ${ago(item.updatedAt)}` : undefined,
          item.usedAt ? `Used ${ago(item.usedAt)}` : undefined,
        ]}
        actions={
          full &&
          (!external || deleted) && (
            <>
              {!external && !deleted && (
                <VaultFavoriteButton
                  favorite={item.favorite}
                  onToggle={() =>
                    void vaultApi.patch(id, { favorite: !item.favorite }).then(refresh)
                  }
                />
              )}
              {!external && !deleted && (
                <Button size="sm" variant="surface" leadingIcon={<Pencil />} onClick={onEdit}>
                  Edit
                </Button>
              )}
              {deleted && (
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
              {!external && (
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
                            {p && t.places.length > 1 ? `${META_SEP}${p.name}` : ''}
                          </DropdownMenu.Item>
                        )),
                      )}
                    {!deleted && actions && targets.length > 0 && <DropdownMenu.Separator />}
                    {full.history > 0 && (
                      <DropdownMenu.Item
                        icon={<History />}
                        onSelect={() =>
                          void guard(() => vaultApi.history(id)).then(
                            (h) => h && setHistory(h.entries),
                          )
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
            </>
          )
        }
      />

      {strip}
      {problems.includes('compromised') && (
        <Callout
          tone="danger"
          title="This password was in a data breach"
          className={styles.detailNote}
          action={
            full &&
            !external && (
              <Button size="sm" variant="surface" onClick={onEdit}>
                Change password
              </Button>
            )
          }
        >
          Anyone could try it. Change it on {site ?? 'the site'}, then here.
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
        {signIn && shape && (
          <VaultSignInRow
            signIn={shape}
            keptIn={external ? vaultSourceName(item.source) : undefined}
            hint={
              signIn.via === 'provider' && !namedProvider(signIn)
                ? external
                  ? `Which one is set in ${vaultSourceName(item.source)}`
                  : undefined
                : full && !full.signInItem && namedProvider(signIn)
                  ? `No ${shape.name} login saved`
                  : undefined
            }
            action={
              full?.signInItem &&
              onOpenItem && (
                <Button
                  size="sm"
                  variant="ghost"
                  trailingIcon={<ChevronRight />}
                  aria-label={`Open your ${shape.name} login`}
                  onClick={() => full.signInItem && onOpenItem(full.signInItem)}
                >
                  Open
                </Button>
              )
            }
            onCopyAccount={
              signIn.account ? () => copyPlain(signIn.account ?? '', 'Account') : undefined
            }
          />
        )}
        {!full ? (
          <VaultFieldsSkeleton rows={Math.max(1, likelyFields(item) - (signIn ? 1 : 0))} />
        ) : (
          <>
            {shownFields(full.fields, signIn).map((field) =>
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
            {!signIn && !shownFields(full.fields).length && !full.urls.length && (
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
          {!external && (
            <Text size="xs" tone="subtle">
              Used in Conch’s browser on {full.passkeys[0]?.rpId} only, after asking. The key never
              leaves Conch.
            </Text>
          )}
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
              `${META_SEP}only on ${[...full.domains, ...full.allowedSites].join(', ')}`}
          </Text>
          {(!signIn || full.usedBy.length > 0) && (
            <Text size="xs" tone="subtle">
              {joinMeta([
                !signIn && 'It never sees the password',
                full.usedBy.length > 0 && `Used by ${full.usedBy.join(', ')}`,
              ])}
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
