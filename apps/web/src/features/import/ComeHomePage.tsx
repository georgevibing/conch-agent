import type { ImportSourceId } from '@conch/protocol';
import {
  Button,
  Callout,
  ComeHomeHero,
  ImportOverview,
  ImportPreview,
  ImportProgress,
  ImportSummary,
  Progress,
  Stack,
  Text,
  type ImportView,
} from '@conch/nacre';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';

import { useUi } from '../../app/ui';
import { useAuth } from '../auth/useAuth';
import { useVerify } from '../auth/useVerify';
import { nextSteps, useComeHome } from './ComeHomeDialog';
import styles from './ComeHomePage.module.css';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const FOLDERS: Record<ImportSourceId, string> = { openclaw: '~/.openclaw', hermes: '~/.hermes' };

/**
 * Come home (ADR 0035) as a place inside Settings → Memory
 * (`/settings/memory/from-openclaw`): the journey at the top, everything
 * there is at a glance as tiles, the list one kind at a time (searchable
 * when long), and the one button always in reach at the bottom. Then it
 * brings them over in place and says what came, with Undo.
 */
export function ComeHomePage({ source }: { source: ImportSourceId }) {
  const auth = useAuth();
  const { guard, dialog } = useVerify(auth.data?.method ?? 'none');
  const openSettings = useUi((s) => s.openSettings);
  const back = () => openSettings('memory');
  const flow = useComeHome({ source, onClose: back, guard });
  const [view, setView] = useState<ImportView>('all');
  const { step, items, selected, setSelected, label, busy, error, progress, count } = flow;
  const plan = step.kind === 'looking' || step.kind === 'failed' ? undefined : step.plan;

  return (
    <Stack gap={5} className={styles.page}>
      <div>
        <Button variant="ghost" size="sm" leadingIcon={<ChevronLeft />} onClick={back}>
          Memory
        </Button>
      </div>
      <ComeHomeHero
        from={label}
        path={plan?.source.path ?? FOLDERS[source]}
        title={step.kind === 'done' ? 'Welcome home' : undefined}
      />
      {step.kind === 'looking' && <Progress label={`Looking in ${label}’s folder…`} />}
      {step.kind === 'failed' && <Callout tone="danger" title={step.message} live="assertive" />}
      {step.kind === 'preview' &&
        (items.length ? (
          <>
            <ImportOverview items={items} selected={selected} view={view} onViewChange={setView} />
            <ImportPreview
              items={items}
              selected={selected}
              onSelectedChange={setSelected}
              problems={step.plan.problems}
              disabled={busy}
              view={view}
            />
          </>
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
          next={nextSteps(step.result, back)}
          backedUp={Boolean(step.result.backupId)}
          action={
            step.result.undoable && (
              <Button variant="surface" size="sm" loading={busy} onClick={() => void flow.undo()}>
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
      {(step.kind === 'preview' || step.kind === 'bringing') && items.length > 0 && (
        <div className={styles.bar}>
          <Text size="sm" tone="muted" className={styles.barCount}>
            {count ? `${count} of ${items.length} ticked` : 'Nothing ticked yet'}
          </Text>
          <Button variant="ghost" onClick={back} disabled={step.kind === 'bringing'}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={step.kind !== 'preview' || !count}
            onClick={() => void flow.bring()}
          >
            {count ? `Bring ${plural(count, 'thing')} over` : 'Bring over'}
          </Button>
        </div>
      )}
      {step.kind === 'done' && (
        <div className={styles.bar}>
          <span className={styles.barCount} />
          <Button onClick={back}>Done</Button>
        </div>
      )}
      {dialog}
    </Stack>
  );
}
