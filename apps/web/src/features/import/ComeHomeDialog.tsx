import type { ImportPlan, ImportResult, ImportSourceId } from '@conch/protocol';
import {
  Button,
  Callout,
  Dialog,
  ImportPreview,
  ImportProgress,
  ImportSummary,
  Progress,
  SkillReview,
  Stack,
  toast,
  type ImportPreviewItem,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { ApiError } from '../../api/client';
import { finishSlackPath, importApi, useImportProgress } from './api';
import styles from './ComeHomePage.module.css';

type Guard = (task: () => Promise<unknown>) => Promise<boolean>;

type Step =
  | { kind: 'looking' }
  | { kind: 'failed'; message: string }
  | { kind: 'preview'; plan: ImportPlan }
  | { kind: 'bringing'; plan: ImportPlan }
  | { kind: 'done'; plan: ImportPlan; result: ImportResult; undone?: boolean };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What to do next, a sentence each: say hello to a bot, turn a skill on, get Slack's other key. */
function nextSteps(result: ImportResult, onClose: () => void): ReactNode[] {
  const next: ReactNode[] = result.outcomes
    .filter(
      (o) =>
        o.ok && o.message && (o.group === 'channels' || o.group === 'keys' || o.group === 'model'),
    )
    .map((o) =>
      o.finish === 'slack-key' ? (
        <>
          {o.message}{' '}
          <Link
            to={finishSlackPath(result.source)}
            // Settings may be open around Come home: the Slack setup is a page of its
            // own, and going there leaves Settings.
            onClick={onClose}
          >
            Finish connecting Slack
          </Link>
        </>
      ) : (
        o.message
      ),
    );
  if (result.counts.skills)
    next.push(
      result.counts.skills === 1
        ? 'The skill is off for now: turn it on in Skills when you’re ready.'
        : 'The skills are off for now: turn them on in Skills when you’re ready.',
    );
  if (result.counts.routines)
    next.push(
      result.counts.routines === 1
        ? 'The routine is a draft: turn it on in Routines when you’re ready.'
        : 'The routines are drafts: turn them on in Routines when you’re ready.',
    );
  return next;
}

/**
 * Come home (ADR 0035), in one dialog: Conch reads the other agent's folder
 * and shows exactly what would come over, each with a tick; the person says
 * which; it backs up, brings them over one at a time, and says what came,
 * what didn't, what's next, with Undo right there.
 */
export { nextSteps };

export function ComeHomeDialog({
  source,
  onClose,
  guard,
  onImported,
}: {
  source: ImportSourceId | undefined;
  onClose: () => void;
  guard: Guard;
  /** Things came over (onboarding moves on). */
  onImported?: (result: ImportResult) => void;
}) {
  return (
    <Dialog.Root open={Boolean(source)} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content size="md">
        {source && (
          <ComeHomeFlow
            key={source}
            source={source}
            onClose={onClose}
            guard={guard}
            onImported={onImported}
          />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Markdown a memory was written in (`**Name:**`, backticks) read as plain words. */
export function plain(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/^#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Come home's state, for the page in Settings and the dialog in onboarding:
 * Conch reads the other agent's folder, the person ticks what to bring, it
 * backs up and brings them over, then says what came, with Undo.
 */
export function useComeHome({
  source,
  onClose,
  guard,
  onImported,
}: {
  source: ImportSourceId;
  onClose: () => void;
  guard: Guard;
  onImported?: (result: ImportResult) => void;
}) {
  const client = useQueryClient();
  const [step, setStep] = useState<Step>({ kind: 'looking' });
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const progress = useImportProgress();

  useEffect(() => {
    let current = true;
    importApi.plan(source).then(
      (plan) => {
        if (!current) return;
        setSelected(plan.items.filter((i) => i.checked).map((i) => i.id));
        setStep({ kind: 'preview', plan });
      },
      (failure: unknown) =>
        current &&
        setStep({
          kind: 'failed',
          message: failure instanceof ApiError ? failure.message : 'Couldn’t look in that folder.',
        }),
    );
    return () => {
      current = false;
    };
  }, [source]);

  const plan = step.kind === 'failed' || step.kind === 'looking' ? undefined : step.plan;
  const label = plan?.source.label ?? (source === 'openclaw' ? 'OpenClaw' : 'Hermes');
  const items = useMemo<ImportPreviewItem[]>(
    () =>
      (plan?.items ?? []).map((i) => ({
        id: i.id,
        group: i.group,
        title: plain(i.title),
        detail: i.detail,
        preview: i.preview,
        warning: i.warning,
        duplicate: i.duplicate,
        review: i.review && <SkillReview verdict={i.review.verdict} findings={i.review.findings} />,
        ...(i.agent && { agent: i.agent }),
      })),
    [plan],
  );

  const bring = async () => {
    if (!plan) return;
    setBusy(true);
    setError(undefined);
    useImportProgress.setState({ done: 0, total: selected.length, current: 'Backing up first' });
    try {
      let result: ImportResult | undefined;
      setStep({ kind: 'bringing', plan });
      const ok = await guard(async () => {
        result = await importApi.run(source, selected);
      });
      if (!ok || !result) {
        setStep({ kind: 'preview', plan });
        return;
      }
      setStep({ kind: 'done', plan, result });
      onImported?.(result);
      // Memories, skills, routines, bots, keys, your persona: all of it may have changed.
      void client.invalidateQueries();
    } catch (failure) {
      setStep({ kind: 'preview', plan });
      setError(failure instanceof ApiError ? failure.message : 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (step.kind !== 'done') return;
    setBusy(true);
    try {
      let removed = 0;
      const ok = await guard(async () => {
        removed = (await importApi.undo()).removed;
      });
      if (!ok) return;
      void client.invalidateQueries();
      toast.success(`Took back what came from ${label}`, {
        description: `${plural(removed, 'thing')} removed, and what it changed is as it was.`,
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Couldn’t undo it. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return {
    step,
    selected,
    setSelected,
    items,
    label,
    bring,
    undo,
    busy,
    error,
    progress,
    count: selected.length,
  };
}

function ComeHomeFlow(props: {
  source: ImportSourceId;
  onClose: () => void;
  guard: Guard;
  onImported?: (result: ImportResult) => void;
}) {
  const { onClose } = props;
  const { step, selected, setSelected, items, label, bring, undo, busy, error, progress, count } =
    useComeHome(props);
  return (
    <form
      // Between the dialog and its body: the body can only scroll if this passes its layout on.
      className={styles.dialogForm}
      onSubmit={(e) => {
        e.preventDefault();
        if (step.kind === 'preview' && count) void bring();
      }}
    >
      <Dialog.Header>
        <Dialog.Title>
          {step.kind === 'done' ? 'Welcome home' : `Bring your things from ${label}`}
        </Dialog.Title>
        {step.kind === 'preview' && (
          <Dialog.Description>
            From {step.plan.source.path}. Tick what to bring over: {label}’s folder isn’t changed,
            and you can undo it all.
          </Dialog.Description>
        )}
      </Dialog.Header>
      <Dialog.Body>
        <Stack gap={4}>
          {step.kind === 'looking' && <Progress label={`Looking in ${label}’s folder…`} />}
          {step.kind === 'failed' && (
            <Callout tone="danger" title={step.message} live="assertive" />
          )}
          {step.kind === 'preview' &&
            (items.length ? (
              <ImportPreview
                items={items}
                selected={selected}
                onSelectedChange={setSelected}
                problems={step.plan.problems}
                disabled={busy}
              />
            ) : (
              <Callout tone="info" title={`${label} has nothing to bring over yet`}>
                When it has memories, skills or routines, they’ll be here.
              </Callout>
            ))}
          {step.kind === 'bringing' && (
            <ImportProgress
              done={progress.done}
              total={progress.total || count}
              current={progress.current}
            />
          )}
          {step.kind === 'done' && (
            <ImportSummary
              from={label}
              counts={step.result.counts}
              failed={step.result.outcomes
                .filter((o) => !o.ok)
                .map((o) => ({ title: o.title, message: o.message ?? 'It didn’t come over.' }))}
              next={nextSteps(step.result, onClose)}
              backedUp={Boolean(step.result.backupId)}
              action={
                step.result.undoable && (
                  <Button variant="surface" size="sm" loading={busy} onClick={() => void undo()}>
                    Undo
                  </Button>
                )
              }
            />
          )}
          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        {step.kind === 'done' ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Dialog.Close asChild>
              <Button variant="ghost" disabled={step.kind === 'bringing'}>
                Cancel
              </Button>
            </Dialog.Close>
            {step.kind !== 'failed' && (
              <Button type="submit" loading={busy} disabled={step.kind !== 'preview' || !count}>
                {count ? `Bring ${plural(count, 'thing')} over` : 'Bring over'}
              </Button>
            )}
          </>
        )}
      </Dialog.Footer>
    </form>
  );
}
