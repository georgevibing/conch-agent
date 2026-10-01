import type { UndoPreview as Preview } from '@conch/protocol';
import { Button, Callout, Dialog, Skeleton, UndoPreview, toast } from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { ApiError } from '../../api/client';
import { useUi } from '../../app/ui';
import { undoApi } from './api';

/** Open Undo's preview for these change sets (from the chat, Activity or ⌘K). */
export function askUndo(ids: string[], direction: 'undo' | 'redo' = 'undo') {
  if (ids.length) useUi.setState({ undoing: { ids, direction } });
}

/** ⌘K's "Undo the last change": the newest change Undo still has. */
export async function undoLast() {
  try {
    const latest = await undoApi.latest();
    if (latest.changeSetId) askUndo([latest.changeSetId]);
    else
      toast('Nothing to undo', { description: 'The assistant hasn’t changed any files lately.' });
  } catch {
    toast.error('Conch couldn’t check for changes. Try again.');
  }
}

/**
 * The one place Undo and Redo happen (ADR 0030): what will change, file by
 * file, with anything in the way said plainly; then one press. A file you
 * changed since is left alone unless you choose to replace it too.
 */
export function UndoHost() {
  const undoing = useUi((s) => s.undoing);
  const client = useQueryClient();
  const [preview, setPreview] = useState<Preview>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!undoing) return;
    let gone = false;
    void undoApi.preview(undoing.ids, undoing.direction).then(
      (p) => !gone && setPreview(p),
      (e: unknown) =>
        !gone &&
        setFailure(e instanceof ApiError ? e.message : 'Conch couldn’t look at those files.'),
    );
    return () => {
      gone = true;
      setPreview(undefined);
      setFailure(undefined);
    };
  }, [undoing]);

  const close = () => useUi.setState({ undoing: undefined });
  const run = async (force: boolean) => {
    if (!undoing) return;
    setBusy(true);
    try {
      const result = await undoApi.apply(undoing.ids, undoing.direction, force);
      const done = result.restored.length;
      const verb = undoing.direction === 'undo' ? 'Undone' : 'Redone';
      if (result.skipped.length)
        toast(
          `${verb}, except ${result.skipped.length === 1 ? 'one file' : `${result.skipped.length} files`}`,
          {
            description: result.skipped.map((s) => `${s.path}: ${s.reason}`).join(' '),
          },
        );
      else
        toast.success(
          done === 1 ? `${verb}: ${result.restored[0]?.path}` : `${verb}: ${done} files`,
        );
      void client.invalidateQueries({ queryKey: ['activity'] });
      close();
    } catch (e) {
      setFailure(e instanceof ApiError ? e.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const direction = undoing?.direction ?? 'undo';
  const files = preview?.files ?? [];
  const usable = files.filter((f) => !f.blocked);
  const conflicts = usable.filter((f) => f.conflict).length;
  const verb = direction === 'undo' ? 'Undo' : 'Redo';
  return (
    <Dialog.Root open={Boolean(undoing)} onOpenChange={(o) => !o && close()}>
      <Dialog.Content size="lg">
        <Dialog.Header>
          <Dialog.Title>
            {verb}{' '}
            {files.length === 1
              ? 'this change'
              : files.length
                ? `changes to ${files.length} files`
                : 'changes'}
          </Dialog.Title>
          <Dialog.Description>
            {direction === 'undo'
              ? 'Each file goes back to how it was before the assistant changed it.'
              : 'Each file is changed again, the way the assistant left it.'}
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          {failure ? (
            <Callout tone="danger">{failure}</Callout>
          ) : !preview ? (
            <Skeleton lines={4} />
          ) : files.length === 0 ? (
            <Callout tone="info">Nothing to {verb.toLowerCase()}: it’s already that way.</Callout>
          ) : (
            <UndoPreview files={files} direction={direction} />
          )}
        </Dialog.Body>
        <Dialog.Footer>
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          {conflicts > 0 && (
            <Button variant="surface" tone="danger" loading={busy} onClick={() => void run(true)}>
              {verb} all, replacing later changes
            </Button>
          )}
          <Button
            loading={busy}
            disabled={!preview || usable.length === conflicts}
            onClick={() => void run(false)}
          >
            {conflicts ? `${verb} the others` : verb}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
