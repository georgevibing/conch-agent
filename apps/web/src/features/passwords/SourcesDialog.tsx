import type { KeePassDatabase, VaultSource } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  Field,
  PasswordInput,
  PathPicker,
  Skeleton,
  Switch,
  Stack,
  Text,
  toast,
  VaultSourceRow,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';

import { errorText } from '../integrations/queries';
import { chooseOnComputer } from '../folders/FolderChooser';
import { GetIt } from '../setup/GetIt';
import { vaultApi } from './api';
import { ago } from './filter';
import { vaultKeys } from './queries';
import { TransferDialog } from './TransferDialog';

/** What unlocking each password-typed manager means, in a sentence. */
const UNLOCK_WORDS: Partial<Record<VaultSource['id'], string>> = {
  bitwarden:
    'Your Bitwarden master password. Conch passes it to Bitwarden and keeps only the unlocked session, in memory, until Conch stops.',
  keepassxc: 'Your database’s password. Conch keeps it in memory only, until Conch stops.',
  dashlane:
    'Your Dashlane master password. Conch hands it to Dashlane’s own program in its environment (never on a command line) and keeps it in memory only, until Conch stops.',
  keeper:
    'Your Keeper master password. Conch hands it to Keeper Commander in its environment (never on a command line) and keeps it in memory only. Persistent login (“this-device persistent-login on”) means you won’t need it here.',
};

/**
 * The password managers Passwords can show alongside Conch's own: one row
 * each, with the one thing that gets it working. Their items are read through
 * their own app and stay there; Conch keeps nothing but the list in memory.
 */
export function SourcesDialog({
  open,
  onOpenChange,
  sources,
  guard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sources: VaultSource[];
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
}) {
  const client = useQueryClient();
  const [unlocking, setUnlocking] = useState<VaultSource>();
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(false);
  const [database, setDatabase] = useState('');
  const [found, setFound] = useState<KeePassDatabase[]>();
  const [keyFile, setKeyFile] = useState<string>();
  const [askKey, setAskKey] = useState(false);

  // KeePassXC: find its databases, so nobody types a path; the one chosen before comes first.
  const forKeePass = unlocking?.id === 'keepassxc' ? unlocking : undefined;
  useEffect(() => {
    if (!forKeePass) return;
    let live = true;
    vaultApi.keepassDatabases().then(
      (list) => {
        if (!live) return;
        setFound(list);
        setDatabase((now) => now || forKeePass.database || list[0]?.path || '');
        setKeyFile((now) => now ?? forKeePass.keyFile);
      },
      () => live && setFound([]),
    );
    return () => {
      live = false;
    };
  }, [forKeePass]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [copying, setCopying] = useState<VaultSource>();

  const refresh = () => void client.invalidateQueries({ queryKey: vaultKeys.all });
  const run = async (id: string, task: () => Promise<unknown>) => {
    setBusy(id);
    setError(undefined);
    try {
      await task();
      refresh();
    } catch (e) {
      setError(errorText(e, 'That didn’t work.'));
    } finally {
      setBusy(undefined);
    }
  };

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!unlocking || unlocking.id === 'conch') return;
    const id = unlocking.id;
    await run(id, async () => {
      if (id === 'keepassxc' && database)
        await vaultApi.setSource(id, { database, keyFile: keyFile ?? '' });
      const done = await guard(() => vaultApi.unlockSource(id, password, keep));
      if (done) {
        toast.success(`${unlocking.name} is unlocked`);
        setUnlocking(undefined);
        setPassword('');
      }
    });
  };

  const action = (s: VaultSource) => {
    if (s.id === 'conch') return undefined;
    const id = s.id;
    if (s.state === 'off')
      return (
        <Button
          size="sm"
          variant="surface"
          loading={busy === id}
          onClick={() =>
            void run(id, async () => {
              const next = await vaultApi.setSource(id, { enabled: true });
              // A manager that needs its password (or KeePassXC its file): ask right away.
              const now = next.find((x) => x.id === id);
              if (now?.state === 'locked' && now.unlock === 'password') setUnlocking(now);
            })
          }
        >
          Turn on
        </Button>
      );
    if (s.state === 'locked' && s.unlock === 'password')
      return (
        <Button size="sm" onClick={() => setUnlocking(s)}>
          Unlock
        </Button>
      );
    return (
      <Stack direction="row" gap={1}>
        {s.state === 'ready' && (
          <Button size="sm" variant="surface" onClick={() => setCopying(s)}>
            Copy into Conch
          </Button>
        )}
        {s.state === 'ready' && s.unlock === 'password' && (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === `lock:${id}`}
            onClick={() =>
              void run(`lock:${id}`, async () => {
                await vaultApi.lockSource(id);
                toast(`${s.name} is locked`, {
                  description: s.keptUnlocked ? 'Conch no longer keeps it unlocked.' : undefined,
                });
              })
            }
          >
            Lock
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          loading={busy === id}
          onClick={() => void run(id, () => vaultApi.setSource(id, { enabled: false }))}
        >
          Turn off
        </Button>
      </Stack>
    );
  };

  /** Under a manager whose copies are kept up to date: bring them now, or stop. */
  const syncControls = (s: VaultSource) => {
    if (s.id === 'conch' || s.id === 'system' || !s.sync?.enabled) return undefined;
    const id = s.id;
    return (
      <Stack direction="row" gap={1} style={{ paddingInlineStart: 56, paddingBlockEnd: 12 }}>
        <Button
          size="sm"
          variant="ghost"
          disabled={s.state !== 'ready'}
          loading={busy === `sync:${id}`}
          onClick={() =>
            void run(`sync:${id}`, async () => {
              await vaultApi.syncNow(id);
              toast(`Bringing your copies from ${s.name} up to date`);
            })
          }
        >
          Update now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          loading={busy === `stop:${id}`}
          onClick={() =>
            void run(`stop:${id}`, async () => {
              await vaultApi.setSync(id, false);
              toast(`Stopped keeping copies from ${s.name} up to date`, {
                description: 'The copies stay in Conch, as your own.',
              });
            })
          }
        >
          Stop keeping up to date
        </Button>
      </Stack>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Dialog.Title>Password managers</Dialog.Title>
          <Dialog.Description>
            Show what’s in your other password manager here, next to Conch’s own. Items stay where
            they are: Conch reads them when you open them, and your assistant can fill them in the
            same way, with your OK. Or copy them into Conch, once or kept up to date.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            <div>
              {/* One this computer can't have (the macOS Keychain off a Mac) isn't offered. */}
              {sources
                .filter((s) => s.available !== false)
                .map((s) => (
                  <div key={s.id}>
                    <VaultSourceRow
                      source={s.id}
                      state={s.state}
                      message={s.message}
                      count={s.count}
                      keptUnlocked={s.keptUnlocked}
                      action={action(s)}
                      sync={
                        s.sync && {
                          enabled: s.sync.enabled,
                          copies: s.sync.copies,
                          ...(s.sync.at && { when: `up to date ${ago(s.sync.at)}` }),
                          ...(s.sync.problem && { problem: s.sync.problem }),
                        }
                      }
                    />
                    {syncControls(s)}
                    {s.state === 'missing' && s.need && (
                      <div style={{ paddingInlineStart: 56, paddingBlockEnd: 12 }}>
                        <GetIt needId={s.need} />
                      </div>
                    )}
                  </div>
                ))}
            </div>
            {error && !unlocking && (
              <Callout tone="warning" role="alert">
                {error}
              </Callout>
            )}
            <Text size="xs" tone="subtle">
              Apple Passwords (Safari, iCloud Keychain), Chrome and the others don’t let other apps
              read them, so import from them instead, once. The macOS Keychain here is your login
              keychain; macOS asks you before it shares each password.
            </Text>
          </Stack>
        </Dialog.Body>
      </Dialog.Content>

      <Dialog.Root
        open={unlocking !== undefined}
        onOpenChange={(o) => {
          if (o) return;
          setUnlocking(undefined);
          setError(undefined);
        }}
      >
        <Dialog.Content size="sm">
          <form onSubmit={(e) => void unlock(e)}>
            <Dialog.Header>
              <Dialog.Title>
                {unlocking?.id === 'keepassxc'
                  ? 'Open your KeePassXC database'
                  : `Unlock ${unlocking?.name}`}
              </Dialog.Title>
              <Dialog.Description>
                {(unlocking && UNLOCK_WORDS[unlocking.id]) ??
                  'Its password. Conch keeps it in memory only, until Conch stops.'}
              </Dialog.Description>
            </Dialog.Header>
            <Dialog.Body>
              <Stack gap={3}>
                {unlocking?.id === 'keepassxc' && (
                  <Field>
                    <Field.Label size="sm">Database</Field.Label>
                    {found === undefined ? (
                      <Skeleton style={{ blockSize: '3.5rem' }} />
                    ) : (
                      <PathPicker
                        label="KeePassXC database"
                        value={database || undefined}
                        onChange={setDatabase}
                        suggestions={found.map((d) => ({
                          path: d.path,
                          title: d.name,
                          detail: [d.where, d.recent ? 'opened lately in KeePassXC' : undefined]
                            .filter(Boolean)
                            .join(' · '),
                        }))}
                        onChoose={() =>
                          chooseOnComputer({
                            purpose: 'keepassxc-database',
                            ...(database && { current: database }),
                          })
                        }
                        canType={false}
                        hint={
                          found.length === 0 && !database
                            ? 'Conch didn’t find a .kdbx file in your usual folders. Choose yours.'
                            : undefined
                        }
                      />
                    )}
                  </Field>
                )}
                {unlocking?.id === 'keepassxc' &&
                  (askKey || keyFile || /key file/i.test(error ?? '') ? (
                    <Field>
                      <Field.Label size="sm">Key file</Field.Label>
                      <PathPicker
                        label="Key file"
                        value={keyFile}
                        onChange={(path) => {
                          setKeyFile(path);
                          setAskKey(true);
                        }}
                        onChoose={() =>
                          chooseOnComputer({
                            purpose: 'keepassxc-keyfile',
                            ...(keyFile && { current: keyFile }),
                          })
                        }
                        canType={false}
                        chooseLabel={keyFile ? 'Choose another key file…' : 'Choose the key file…'}
                        hint="Only if your database also needs one. Conch keeps where it is, never what’s in it."
                      />
                    </Field>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAskKey(true)}
                      style={{ alignSelf: 'flex-start' }}
                    >
                      This database also uses a key file
                    </Button>
                  ))}
                <Field>
                  <Field.Label size="sm">Password</Field.Label>
                  <PasswordInput
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="off"
                  />
                </Field>
                <Switch
                  checked={keep}
                  onCheckedChange={setKeep}
                  label="Keep unlocked on this computer"
                  description={`${unlocking?.name ?? 'It'} opens by itself whenever Conch starts. Its password is sealed with this computer’s key and never leaves it, but anyone who can use this computer as you could open it too.`}
                />
                {error && (
                  <Text tone="danger" size="sm" role="alert">
                    {error}
                  </Text>
                )}
              </Stack>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                type="submit"
                loading={busy !== undefined}
                disabled={!password || (unlocking?.id === 'keepassxc' && !database)}
              >
                {unlocking?.id === 'keepassxc' ? 'Open' : 'Unlock'}
              </Button>
            </Dialog.Footer>
          </form>
        </Dialog.Content>
      </Dialog.Root>

      <TransferDialog
        source={copying}
        guard={guard}
        onOpenChange={(o) => !o && setCopying(undefined)}
      />
    </Dialog.Root>
  );
}
