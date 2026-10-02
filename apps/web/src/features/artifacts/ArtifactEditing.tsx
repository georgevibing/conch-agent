import { artifactProblem, type Artifact, type ArtifactDraft } from '@conch/protocol';
import {
  AlertDialog,
  ArtifactEditor,
  Button,
  Callout,
  Skeleton,
  toast,
  useNacreTheme,
} from '@conch/nacre';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { artifactsApi, draftFrameUrl } from './api';
import { ArtifactPreview, LivePage } from './ArtifactPreview';
import styles from './Artifacts.module.css';
import { isDirty, useEdits } from './edits';
import { artifactKeys } from './queries';

/** How long typing settles before the preview redraws. */
const SETTLE_MS = 300;

/**
 * Editing one thing by hand (ADR 0046). The preview follows what you type a
 * moment later; a page's preview is served by the gateway, sealed exactly
 * like a saved version. Saving makes a new version marked as yours.
 */
export function ArtifactEditing({
  artifact,
  restored,
  onSaved,
}: {
  artifact: Artifact;
  /** The edit was waiting from before (you closed the panel, or went elsewhere). */
  restored?: boolean;
  onSaved: (version: number) => void;
}) {
  const client = useQueryClient();
  const { resolvedMode } = useNacreTheme();
  const edit = useEdits((s) => s.edits[artifact.id]);
  const change = useEdits((s) => s.change);
  const stop = useEdits((s) => s.stop);
  const start = edit?.content ?? '';
  // What the preview shows: the last text that settled, and the last one that worked.
  const [settled, setSettled] = useState(() => {
    const problem = artifactProblem(artifact.kind, start);
    return { content: start, problem, good: problem ? (edit?.original ?? start) : start };
  });
  const [draft, setDraft] = useState<ArtifactDraft>();
  const [scripts, setScripts] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [conflict, setConflict] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const page = artifact.kind === 'html';

  // A page's preview starts from what's being edited, served sealed by the gateway.
  useEffect(() => {
    if (!page) return;
    let live = true;
    artifactsApi.draft(artifact.id, useEdits.getState().edits[artifact.id]?.content ?? '').then(
      (d) => live && setDraft(d),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [page, artifact.id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onChange = (content: string) => {
    change(artifact.id, content);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const problem = artifactProblem(artifact.kind, content);
      setSettled((s) => ({ content, problem, good: problem ? s.good : content }));
      if (page)
        artifactsApi.draft(artifact.id, content).then(
          (d) => setDraft(d),
          () => undefined,
        );
    }, SETTLE_MS);
  };

  const save = useMutation({
    mutationFn: (force: boolean) =>
      artifactsApi.save(artifact.id, {
        content: useEdits.getState().edits[artifact.id]?.content ?? '',
        base: edit?.base ?? 1,
        ...(force && { force }),
      }),
    onSuccess: (saved) => {
      stop(artifact.id);
      client.setQueryData(artifactKeys.detail(saved.id), saved);
      void client.invalidateQueries({ queryKey: artifactKeys.all });
      const n = saved.versions.at(-1)?.n ?? 1;
      onSaved(n);
      toast.success(`Saved as version ${n}`, {
        description: 'Marked as yours. Your assistant builds on it from here.',
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) setConflict(true);
      else toast.error('That didn’t save', { description: error.message });
    },
  });

  if (!edit) return null;
  const dirty = isDirty(edit);
  const latest = artifact.versions.at(-1)?.n ?? 1;
  const newer = conflict || latest > edit.base;
  // The problem as it stands once typing settles; Save waits for the newest text.
  const problem = settled.content === edit.content ? settled.problem : undefined;

  const cancel = () => (dirty ? setConfirm(true) : stop(artifact.id));
  const theme = resolvedMode === 'dark' ? 'dark' : 'light';

  const preview = page ? (
    draft ? (
      <LivePage
        artifact={artifact}
        version="draft"
        src={draftFrameUrl(artifact.id, draft.rev, theme)}
        navigates={draft.navigates}
        allowScripts={scripts}
        onAllowScripts={() => setScripts(true)}
      />
    ) : (
      <Skeleton className={styles.loading} />
    )
  ) : (
    <ArtifactPreview artifact={artifact} version={edit.base} content={settled.good} />
  );

  return (
    <>
      <ArtifactEditor
        kind={artifact.kind}
        title={artifact.title}
        value={edit.content}
        onChange={onChange}
        preview={preview}
        problem={problem}
        dirty={dirty}
        saving={save.isPending}
        onSave={() => {
          // Typing that hasn't settled is checked now, not after.
          const now = artifactProblem(artifact.kind, edit.content);
          if (now) {
            clearTimeout(timer.current);
            setSettled((s) => ({ content: edit.content, problem: now, good: s.good }));
            return;
          }
          save.mutate(false);
        }}
        onCancel={cancel}
        notice={
          newer ? (
            <Callout
              tone="info"
              title={`A newer version came in while you were editing`}
              action={
                <Button
                  size="sm"
                  variant="surface"
                  disabled={!dirty || Boolean(problem)}
                  loading={save.isPending}
                  onClick={() => save.mutate(true)}
                >
                  Save mine as the newest
                </Button>
              }
            >
              Your edit is still here. Save it over version {latest}, or cancel and start from it.
            </Callout>
          ) : restored && dirty ? (
            <Callout tone="info">Your unsaved edit is back, just as you left it.</Callout>
          ) : undefined
        }
      />
      <AlertDialog.Root open={confirm} onOpenChange={setConfirm}>
        <AlertDialog.Content tone="danger">
          <AlertDialog.Header>
            <AlertDialog.Title>Discard your changes to “{artifact.title}”?</AlertDialog.Title>
            <AlertDialog.Description>
              They aren’t saved. If you discard them, they’re gone.
            </AlertDialog.Description>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <AlertDialog.Cancel>Keep editing</AlertDialog.Cancel>
            <AlertDialog.Action tone="danger" onClick={() => stop(artifact.id)}>
              Discard
            </AlertDialog.Action>
          </AlertDialog.Footer>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
