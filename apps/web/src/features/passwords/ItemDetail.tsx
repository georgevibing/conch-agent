import type { VaultFieldView, VaultItemDetail } from '@conch/protocol';
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
  VaultItemIcon,
  VaultPasskeyRow,
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

export function ItemDetail({
  id,
  guard,
  onEdit,
  onBack,
  onDeleted,
}: {
  id: string;
  /** Runs a request through "Confirm it's you" when the gateway asks. */
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
  onEdit: () => void;
  onBack?: () => void;
  onDeleted: () => void;
}) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const openSettings = useUi((s) => s.openSettings);
  const { data: item, isLoading, error } = useVaultItem(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [history, setHistory] = useState<{ value: string; changedAt: number }[]>();

  if (isLoading) return <Skeleton style={{ blockSize: '18rem', margin: 24 }} />;
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
    if (place === 'integrations')
      return void navigate(focus ? `/integrations/${focus}` : '/integrations');
    if (place === 'channels') return void navigate(focus ? `/channels/${focus}` : '/channels');
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
    <div className={styles.detail}>
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
          <Text size="sm" tone="subtle">
            {TYPE_NAMES[item.type].one}
            {item.container ? ` · ${item.container}` : ''}
            {item.updatedAt ? ` · edited ${ago(item.updatedAt)}` : ''}
          </Text>
        </div>
        <div className={styles.detailActions}>
          {!external && !deleted && (
            <VaultFavoriteButton
              favorite={item.favorite}
              onToggle={() => void vaultApi.patch(id, { favorite: !item.favorite }).then(refresh)}
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
                {item.history > 0 && (
                  <DropdownMenu.Item
                    icon={<History />}
                    onSelect={() =>
                      void guard(() => vaultApi.history(id)).then((h) => h && setHistory(h.entries))
                    }
                  >
                    Earlier passwords ({item.history})
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

      {item.source === 'system' && item.manage && (
        <Callout
          tone="info"
          className={styles.detailNote}
          action={
            <Button
              size="sm"
              variant="surface"
              onClick={() => openPlace(item.manage?.place ?? '', item.manage?.focus)}
            >
              {item.manage.label}
            </Button>
          }
        >
          A key Conch uses for {item.usedBy[0] ?? 'itself'}. It’s sealed with this computer’s key,
          so it works even while Passwords is locked. Change it where it’s used.
        </Callout>
      )}
      {external && item.source !== 'system' && (
        <Callout tone="info" className={styles.detailNote}>
          From {vaultSourceName(item.source)}
          {item.container ? ` · ${item.container}` : ''}. Change it there; Conch shows it here and
          can fill it in for you.
        </Callout>
      )}
      {item.origin && (
        <Callout tone="info" className={styles.detailNote}>
          {item.origin.syncing
            ? `Copied from ${vaultSourceName(item.origin.source)} and kept up to date from it${item.origin.syncedAt ? `, last ${ago(item.origin.syncedAt)}` : ''}. Changing it here makes this copy yours: syncs leave it alone after that.`
            : `Copied from ${vaultSourceName(item.origin.source)}${item.origin.syncedAt ? ` ${ago(item.origin.syncedAt)}` : ''}. It’s Conch’s own now.`}
        </Callout>
      )}
      {problems.includes('compromised') && (
        <Callout
          tone="danger"
          title="This password was in a data breach"
          className={styles.detailNote}
        >
          Anyone could try it. Change it on {site ?? 'the site'}, then here.
          {!external && (
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
        {item.fields.map((field) =>
          field.kind === 'totp' ? (
            <TotpCode
              key={field.id}
              label={field.label}
              period={30}
              onFetch={async () => {
                const code = await guard(() => vaultApi.totp(id, external ? undefined : field.id));
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
        {item.urls.map((url) => (
          <VaultFieldRow
            key={url}
            label="Website"
            value={url}
            href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
            onCopy={() => copyPlain(url, 'Address')}
          />
        ))}
        {!item.fields.length && !item.urls.length && (
          <div className={styles.emptyFields}>
            <Text tone="subtle">Nothing saved in this item yet.</Text>
          </div>
        )}
      </div>

      {item.passkeys.length > 0 && (
        <section className={styles.section} aria-label="Passkeys">
          <Heading level={3} size="xs" tone="subtle">
            Passkeys
          </Heading>
          <Stack gap={2}>
            {item.passkeys.map((p) => (
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
            Your assistant signs in with a passkey in Conch’s browser, on {item.passkeys[0]?.rpId}{' '}
            only, after asking you. The key itself never leaves Conch.
          </Text>
        </section>
      )}

      {item.notes && (
        <section className={styles.section}>
          <Heading level={3} size="xs" tone="subtle">
            Notes
          </Heading>
          <Text className={styles.notes}>{item.notes}</Text>
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

      {!external && (
        <section className={styles.section}>
          <Heading level={3} size="xs" tone="subtle">
            Your assistant
          </Heading>
          <Text size="sm">
            {ACCESS_WORDS[item.agentAccess]}
            {item.agentAccess !== 'never' &&
              item.domains.length > 0 &&
              ` · only on ${[...item.domains, ...item.allowedSites].join(', ')}`}
          </Text>
          <Text size="xs" tone="subtle">
            It never sees the password: Conch types it into the page.
            {item.usedAt ? ` Last used ${ago(item.usedAt)}.` : ''}
          </Text>
          {item.usedBy.length > 0 && (
            <Text size="xs" tone="subtle">
              Used by {item.usedBy.join(', ')}.
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
