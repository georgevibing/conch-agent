import type { ImportPreview } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  Stack,
  Switch,
  Text,
  toast,
  useFileDrop,
  VaultItemIcon,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { useRef, useState } from 'react';

import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import styles from './Passwords.module.css';
import { vaultKeys } from './queries';

/** Where each app hides its export, in a line. */
const GUIDES: { app: string; steps: string }[] = [
  { app: 'Chrome, Edge, Brave', steps: 'Settings › Passwords › Export passwords' },
  { app: 'Safari & Apple Passwords', steps: 'Passwords app › File › Export All Passwords to File' },
  { app: 'Firefox', steps: 'about:logins › ⋯ › Export Passwords' },
  { app: '1Password', steps: 'File › Export › choose CSV' },
  { app: 'Bitwarden', steps: 'Tools › Export vault › .json (not encrypted)' },
  { app: 'LastPass', steps: 'Advanced options › Export' },
  { app: 'KeePassXC', steps: 'Database › Export › CSV file' },
  { app: 'Proton Pass', steps: 'Settings › Export › CSV' },
  { app: 'Dashlane', steps: 'Settings › Export data › CSV' },
];

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Bring passwords in from another app: pick or drop its export, see what's in
 * it (and what's already here), then import. The file is read in this tab and
 * sent once; nothing is kept but the encrypted items.
 */
export function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState<string>();
  const [name, setName] = useState<string>();
  const [preview, setPreview] = useState<ImportPreview>();
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText(undefined);
    setName(undefined);
    setPreview(undefined);
    setError(undefined);
  };

  const take = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    if (file.size > MAX_BYTES)
      return setError('That file is over 10 MB. Export just your passwords, or split it.');
    const content = await file.text();
    setText(content);
    setName(file.name);
    setBusy(true);
    try {
      setPreview(
        await vaultApi.importFile({ format: 'auto', text: content, commit: false, skipDuplicates }),
      );
    } catch (e) {
      setPreview(undefined);
      setError(errorText(e, 'That file couldn’t be read.'));
    } finally {
      setBusy(false);
    }
  };

  const drop = useFileDrop({ onDrop: ({ files }) => void take(files[0]) });

  const commit = async () => {
    if (!text) return;
    setBusy(true);
    try {
      const done = await vaultApi.importFile({
        format: 'auto',
        text,
        commit: true,
        skipDuplicates,
      });
      void client.invalidateQueries({ queryKey: vaultKeys.all });
      toast.success(
        `Imported ${done.imported ?? 0} ${done.imported === 1 ? 'item' : 'items'} from ${done.formatName}`,
        {
          description: `Now delete “${name ?? 'the export'}”: it holds every password in plain text.`,
          duration: 12_000,
        },
      );
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(errorText(e, 'Couldn’t import it.'));
    } finally {
      setBusy(false);
    }
  };

  const fresh = preview ? preview.found - (skipDuplicates ? preview.duplicates : 0) : 0;
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Dialog.Title>Import passwords</Dialog.Title>
          <Dialog.Description>
            From a browser or another password manager. Duplicates are left out.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {!preview ? (
            <Stack gap={4}>
              <div
                className={styles.dropzone}
                data-dragging={drop.dragging || undefined}
                {...drop.props}
              >
                <FileUp aria-hidden />
                <Text weight="medium">Drop the export file here</Text>
                <Button
                  size="sm"
                  variant="surface"
                  loading={busy}
                  onClick={() => picker.current?.click()}
                >
                  Choose a file…
                </Button>
                <input
                  ref={picker}
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  hidden
                  onChange={(e) => {
                    void take(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
              {error && (
                <Callout tone="warning" role="alert">
                  {error}
                </Callout>
              )}
              <details className={styles.guides}>
                <summary>Where to find the export</summary>
                <dl>
                  {GUIDES.map((g) => (
                    <div key={g.app}>
                      <dt>{g.app}</dt>
                      <dd>{g.steps}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </Stack>
          ) : (
            <Stack gap={4}>
              <Text>
                <strong>{preview.found}</strong> {preview.found === 1 ? 'item' : 'items'} from{' '}
                <strong>{preview.formatName}</strong>
                {preview.duplicates > 0 && <> · {preview.duplicates} already here</>}
                {preview.skipped > 0 && <> · {preview.skipped} empty rows left out</>}
              </Text>
              <div className={styles.card}>
                {preview.sample.map((s, i) => (
                  <div key={i} className={styles.sampleRow}>
                    <VaultItemIcon kind={s.type} title={s.title} size="sm" />
                    <span>
                      <Text as="span" weight="medium">
                        {s.title}
                      </Text>
                      {s.subtitle && (
                        <Text as="span" size="sm" tone="subtle">
                          {' '}
                          · {s.subtitle}
                        </Text>
                      )}
                    </span>
                  </div>
                ))}
                {preview.found > preview.sample.length && (
                  <div className={styles.sampleRow}>
                    <Text size="sm" tone="subtle">
                      and {preview.found - preview.sample.length} more
                    </Text>
                  </div>
                )}
              </div>
              {preview.duplicates > 0 && (
                <Switch
                  label="Leave out the ones already here"
                  checked={skipDuplicates}
                  onCheckedChange={setSkipDuplicates}
                />
              )}
              {error && (
                <Callout tone="warning" role="alert">
                  {error}
                </Callout>
              )}
            </Stack>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          {preview ? (
            <>
              <Button variant="ghost" onClick={reset}>
                Choose another file
              </Button>
              <Button loading={busy} disabled={fresh === 0} onClick={() => void commit()}>
                {fresh === 0
                  ? 'Nothing new to import'
                  : `Import ${fresh} ${fresh === 1 ? 'item' : 'items'}`}
              </Button>
            </>
          ) : (
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
