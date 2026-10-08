import {
  REDACTION_WORDS,
  TRAJECTORY_FORMATS,
  TrajectoryFormat,
  type AgentId,
  type EngineId,
  type Removed,
  type TrajectoryExportBody,
  type TrajectoryExportResult,
  type TrajectoryFilter,
} from '@conch/protocol';
import { Dialog, Field, RunSave, Select, Switch, type RunSaveRemoved } from '@conch/nacre';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import { useModels } from '../../api/queries';
import { useAgents } from '../agents/api';
import { chooseOnComputer } from '../folders/FolderChooser';
import { trajectoryApi, trajectoryKeys, useHowItDidIt } from './api';
import styles from './Trajectory.module.css';

const FORMAT_KEY = 'conch.trajectory.format';
const ALL = 'all';
const DAY = 86_400_000;

const WHEN = {
  week: { title: 'The last 7 days', days: 7 },
  month: { title: 'The last 30 days', days: 30 },
  year: { title: 'The last year', days: 365 },
  all: { title: 'Any time', days: undefined },
} as const;
type When = keyof typeof WHEN;

const FORMATS = TrajectoryFormat.options.map((id) => ({ id, ...TRAJECTORY_FORMATS[id] }));

function storedFormat(): TrajectoryFormat {
  try {
    const parsed = TrajectoryFormat.safeParse(localStorage.getItem(FORMAT_KEY));
    return parsed.success ? parsed.data : 'report';
  } catch {
    return 'report';
  }
}

/** "3 keys and tokens", "your name", for each kind taken out. */
export function removedLabels(removed: readonly Removed[]): RunSaveRemoved[] {
  return removed.map((r) => ({
    kind: r.kind,
    label: `${r.count} ${r.count === 1 ? REDACTION_WORDS[r.kind].one : REDACTION_WORDS[r.kind].many}`,
    examples: r.examples,
  }));
}

/** Waits a moment after the last change, so a preview isn't worked out per click. */
function useSettled<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Saving how it did it (ADR 0113): one chat from its timeline, or a batch
 * from Activity or ⌘K. What would be taken out is worked out first and shown;
 * the file goes to Downloads unless another folder is chosen, and never
 * anywhere off this computer.
 */
export function SaveDialog() {
  const saving = useHowItDidIt((s) => s.saving);
  const close = useHowItDidIt((s) => s.closeSave);
  const [shown, setShown] = useState(saving);
  if (saving && saving !== shown) setShown(saving);
  return (
    <Dialog.Root open={Boolean(saving)} onOpenChange={(open) => !open && close()}>
      <Dialog.Content size="md" aria-describedby={undefined}>
        {shown && (
          <SaveFlow key={shown.conversationId ?? 'batch'} conversationId={shown.conversationId} />
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SaveFlow({ conversationId }: { conversationId?: string }) {
  const [format, setFormat] = useState<TrajectoryFormat>(storedFormat);
  const [redact, setRedact] = useState(true);
  const [folder, setFolder] = useState<string>();
  const [when, setWhen] = useState<When>('month');
  const [agentId, setAgentId] = useState<string>(ALL);
  const [engine, setEngine] = useState<string>(ALL);
  const [automatic, setAutomatic] = useState(true);
  const [saved, setSaved] = useState<TrajectoryExportResult>();
  const batch = !conversationId;
  const agents = useAgents().data;
  const providers = useModels(batch).data?.providers ?? [];
  // Opened when it opens, so "the last 7 days" means the same thing until you change it.
  const [openedAt] = useState(() => Date.now());

  const filter = useMemo((): TrajectoryFilter => {
    if (conversationId) return { conversationId };
    const days = WHEN[when].days;
    return {
      ...(days && { from: openedAt - days * DAY }),
      ...(agentId !== ALL && { agentId: agentId as AgentId }),
      ...(engine !== ALL && { engine: engine as EngineId }),
      ...(!automatic && { automatic: false }),
    };
  }, [conversationId, when, agentId, engine, automatic, openedAt]);
  const body: TrajectoryExportBody = { format, filter, redact, ...(folder && { folder }) };
  const settled = useSettled(body);

  const preview = useQuery({
    queryKey: trajectoryKeys.preview(settled),
    queryFn: ({ signal }) => trajectoryApi.preview(settled, signal),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => trajectoryApi.save(body),
    onSuccess: (result) => {
      setSaved(result);
      try {
        localStorage.setItem(FORMAT_KEY, format);
      } catch {
        // A private window: the format isn't remembered, nothing lost.
      }
    },
  });

  const problem = [save.error, preview.error].find((e) => e instanceof ApiError)?.message;
  const stale = preview.isPlaceholderData || JSON.stringify(settled) !== JSON.stringify(body);
  const counts =
    preview.data && !preview.isError
      ? `${preview.data.chats === 1 ? '1 chat' : `${preview.data.chats} chats`} · ${preview.data.steps} steps${preview.data.capped ? ' (the newest)' : ''}`
      : undefined;

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>{batch ? 'Save chats as a file' : 'Save how it did it'}</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body>
        <RunSave
          className={styles.save}
          formats={FORMATS}
          format={format}
          onFormatChange={(id) => {
            const parsed = TrajectoryFormat.safeParse(id);
            if (parsed.success) setFormat(parsed.data);
          }}
          redact={redact}
          onRedactChange={setRedact}
          removed={preview.data && !stale ? removedLabels(preview.data.removed) : undefined}
          summary={counts}
          folder={preview.data?.folder.shown}
          onChooseFolder={() =>
            void chooseOnComputer({
              purpose: 'export-folder',
              ...((folder ?? preview.data?.folder.path) && {
                current: folder ?? preview.data?.folder.path,
              }),
            }).then((path) => path && setFolder(path))
          }
          onSave={() => save.mutate()}
          saving={save.isPending}
          {...(saved && { saved: { name: saved.name, folder: saved.folder.shown } })}
          {...(problem && !saved && { problem })}
          filters={
            batch && (
              <>
                <Field className={styles.filter}>
                  <Field.Label id="save-when">From</Field.Label>
                  <Select
                    aria-labelledby="save-when"
                    value={when}
                    onValueChange={(v) => setWhen(v as When)}
                  >
                    {Object.entries(WHEN).map(([id, w]) => (
                      <Select.Item key={id} value={id}>
                        {w.title}
                      </Select.Item>
                    ))}
                  </Select>
                </Field>
                {agents && agents.agents.length > 1 && (
                  <Field className={styles.filter}>
                    <Field.Label id="save-agent">Agent</Field.Label>
                    <Select aria-labelledby="save-agent" value={agentId} onValueChange={setAgentId}>
                      <Select.Item value={ALL}>Every agent</Select.Item>
                      {agents.agents.map((a) => (
                        <Select.Item key={a.id} value={a.id}>
                          {a.name}
                        </Select.Item>
                      ))}
                    </Select>
                  </Field>
                )}
                {providers.length > 1 && (
                  <Field className={styles.filter}>
                    <Field.Label id="save-provider">Provider</Field.Label>
                    <Select
                      aria-labelledby="save-provider"
                      value={engine}
                      onValueChange={setEngine}
                    >
                      <Select.Item value={ALL}>Every provider</Select.Item>
                      {providers.map((p) => (
                        <Select.Item key={p.engine} value={p.engine}>
                          {p.label}
                        </Select.Item>
                      ))}
                    </Select>
                  </Field>
                )}
                <Switch
                  className={styles.filterSwitch}
                  checked={automatic}
                  onCheckedChange={setAutomatic}
                  label="Routines and tasks too"
                />
              </>
            )
          }
        />
      </Dialog.Body>
    </>
  );
}
