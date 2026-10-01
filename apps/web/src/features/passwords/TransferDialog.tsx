import type { VaultSource, VaultTransferJob, VaultTransferPreview } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  Skeleton,
  Stack,
  Switch,
  Text,
  toast,
  VaultRow,
  VaultTransferProgress,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';

import { errorText } from '../integrations/queries';
import { vaultApi } from './api';
import { vaultKeys } from './queries';

type ExternalId = Exclude<VaultSource['id'], 'conch' | 'system'>;

/**
 * Moving in (ADR 0025 § Moving in): copy what's in another password manager
 * into Conch's own vault. First what would come in (names only, nothing read
 * yet), then the copy as it goes, then what happened, with anything that
 * couldn't be read named. Values travel through the manager's own program,
 * one item at a time, straight into the encrypted vault: no export file.
 */
export function TransferDialog({
  source,
  onOpenChange,
  guard,
}: {
  source?: VaultSource;
  onOpenChange: (open: boolean) => void;
  guard: <T>(task: () => Promise<T>) => Promise<T | undefined>;
}) {
  const client = useQueryClient();
  const [preview, setPreview] = useState<VaultTransferPreview>();
  const [job, setJob] = useState<VaultTransferJob>();
  const [error, setError] = useState<string>();
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [keepSynced, setKeepSynced] = useState(false);
  const [starting, setStarting] = useState(false);
  const [shownFor, setShownFor] = useState<string>();

  // A new source: start again (state follows the prop, React's render-phase pattern).
  if (source?.id !== shownFor) {
    setShownFor(source?.id);
    setPreview(undefined);
    setJob(undefined);
    setError(undefined);
    setKeepSynced(source?.sync?.enabled ?? false);
  }

  useEffect(() => {
    if (!source) return;
    let live = true;
    vaultApi.transferPreview(source.id).then(
      (p) => live && setPreview(p),
      (e: unknown) => live && setError(errorText(e, `Couldn’t read ${source.name}.`)),
    );
    return () => {
      live = false;
    };
  }, [source]);

  // Follow the copy as it goes.
  const running = job?.state === 'running';
  const jobId = job?.jobId;
  useEffect(() => {
    if (!running || !jobId) return;
    const timer = setInterval(() => {
      vaultApi.transferJob(jobId).then(
        (next) => {
          setJob(next);
          if (next.state !== 'running') void client.invalidateQueries({ queryKey: vaultKeys.all });
        },
        () => undefined,
      );
    }, 700);
    return () => clearInterval(timer);
  }, [running, jobId, client]);

  if (!source || source.id === 'conch' || source.id === 'system') return null;
  const id = source.id as ExternalId;
  const toCopy = preview
    ? preview.found - preview.copiedBefore - (skipDuplicates ? preview.duplicates : 0)
    : 0;

  const start = async () => {
    setStarting(true);
    setError(undefined);
    try {
      const started = await guard(() => vaultApi.transfer(id, { skipDuplicates, keepSynced }));
      if (started) setJob(started);
    } catch (e) {
      setError(errorText(e, 'The copy didn’t start.'));
    } finally {
      setStarting(false);
    }
  };

  const close = () => {
    if (job?.state === 'done' && job.copied + job.updated > 0)
      toast.success(
        `${job.copied + job.updated} ${job.copied + job.updated === 1 ? 'item' : 'items'} from ${source.name} are in Conch now`,
      );
    onOpenChange(false);
  };

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Content size="md">
        <Dialog.Header>
          <Dialog.Title>Copy from {source.name} into Conch</Dialog.Title>
          <Dialog.Description>
            Your items become Conch’s own: in your encrypted vault and your backups, there even when{' '}
            {source.name} isn’t.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            {job ? (
              <VaultTransferProgress
                source={id}
                state={job.state}
                total={job.total}
                done={job.done}
                copied={job.copied}
                updated={job.updated}
                skipped={job.skipped}
                failed={job.failed}
                message={job.message}
              />
            ) : error ? (
              <Callout tone="warning" role="alert">
                {error}
              </Callout>
            ) : !preview ? (
              <Skeleton style={{ blockSize: '9rem' }} />
            ) : (
              <>
                <Text>
                  {preview.found === 0
                    ? `There’s nothing in ${source.name} to copy.`
                    : `${preview.found} ${preview.found === 1 ? 'item' : 'items'} in ${source.name}.`}
                  {preview.duplicates > 0 &&
                    ` ${preview.duplicates} look${preview.duplicates === 1 ? 's' : ''} like ${preview.duplicates === 1 ? 'one' : 'ones'} already here.`}
                  {preview.copiedBefore > 0 &&
                    ` ${preview.copiedBefore} ${preview.copiedBefore === 1 ? 'was' : 'were'} copied before and will be brought up to date.`}
                </Text>
                {preview.sample.length > 0 && (
                  <div role="list" aria-label={`Some of what’s in ${source.name}`}>
                    {preview.sample.map((s, i) => (
                      <div role="listitem" key={`${s.title}-${i}`}>
                        <VaultRow
                          kind={s.type}
                          title={s.title}
                          subtitle={s.subtitle}
                          source={id}
                          tabIndex={-1}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {preview.duplicates > 0 && (
                  <Switch
                    checked={skipDuplicates}
                    onCheckedChange={setSkipDuplicates}
                    label="Leave out ones already here"
                    description="The same site, account and password as an item you have."
                  />
                )}
                <Switch
                  checked={keepSynced}
                  onCheckedChange={setKeepSynced}
                  label={`Keep them up to date from ${source.name}`}
                  description={`One way, every 30 minutes: changes in ${source.name} come into Conch, and items deleted there go to Recently deleted. Change one here and Conch leaves it alone.`}
                />
                <Callout tone="info" icon={<ShieldCheck />}>
                  Conch reads each item through {source.name}’s own app and puts it straight into
                  your encrypted vault. No export file is ever made, and your assistant sees none of
                  it.
                </Callout>
              </>
            )}
          </Stack>
        </Dialog.Body>
        <Dialog.Footer>
          {job ? (
            job.state === 'running' ? (
              <Button variant="ghost" onClick={() => void vaultApi.cancelTransfer(job.jobId)}>
                Stop
              </Button>
            ) : (
              <Button onClick={close}>Done</Button>
            )
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                loading={starting}
                disabled={!preview || (toCopy <= 0 && !keepSynced && preview.copiedBefore === 0)}
                onClick={() => void start()}
              >
                {toCopy > 0
                  ? `Copy ${toCopy} ${toCopy === 1 ? 'item' : 'items'}`
                  : preview?.copiedBefore
                    ? 'Bring copies up to date'
                    : 'Copy'}
              </Button>
            </>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
