import type { FirstJobKind, Task, GoogleCapability, EngineId } from '@conch/protocol';
import {
  Button,
  Callout,
  Collapsible,
  Field,
  Heading,
  Input,
  RadioGroup,
  Select,
  Stack,
  Text,
  Textarea,
  toast,
} from '@conch/nacre';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useAppState, useModels } from '../../api/queries';
import { useLive } from '../../live/LiveProvider';
import { emptyView } from '../../live/reducer';
import { useLiveStore } from '../../live/store';
import { ArtifactView } from '../artifacts/ArtifactView';
import { PermissionCard } from '../chat/TranscriptItems';
import { Markdown } from '../chat/Markdown';
import { GoogleConnect } from '../integrations/GoogleConnect';
import { ConnectProviderDialog } from '../providers/ConnectProviderDialog';
import { useProviders } from '../providers/queries';
import { modelKey, parseModelKey } from '../models/useTurnOptions';
import { tasksApi } from '../tasks/api';
import { firstJobApi, firstJobKey } from './first-job';

export const JOBS: {
  id: FirstJobKind;
  title: string;
  description: string;
  needs: GoogleCapability[];
}[] = [
  {
    id: 'document',
    title: 'Make a useful brief',
    description:
      'Turn your notes or a text document into a brief you can keep. No account connection needed.',
    needs: [],
  },
  {
    id: 'today',
    title: 'Prepare me for today',
    description: 'A briefing from your Google email and calendar, with links to the sources.',
    needs: ['mail-read', 'calendar-read'],
  },
  {
    id: 'followups',
    title: 'Draft my follow-ups',
    description: 'Review up to three follow-up drafts in Gmail. Nothing is sent.',
    needs: ['mail-read', 'mail-draft'],
  },
];

export interface FirstJobDraft {
  source: string;
  instruction: string;
  chosen: string;
  accountId?: string;
  requestId: string;
}
export const newFirstJobDraft = (): FirstJobDraft => ({
  source: '',
  instruction: '',
  chosen: '',
  requestId: crypto.randomUUID(),
});

export function ChooseFirstJob({
  value,
  onChange,
  onNext,
  onSkip,
}: {
  value: FirstJobKind;
  onChange: (kind: FirstJobKind) => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <Stack gap={5}>
      <RadioGroup
        variant="card"
        aria-label="Your first job"
        value={value}
        onValueChange={(value) => onChange(value as FirstJobKind)}
      >
        {JOBS.map((job) => (
          <RadioGroup.Item
            key={job.id}
            value={job.id}
            label={job.title}
            description={job.description}
          />
        ))}
      </RadioGroup>
      <Button size="lg" onClick={onNext}>
        Continue
      </Button>
      <Button variant="ghost" onClick={onSkip}>
        Explore on my own
      </Button>
    </Stack>
  );
}

/** Saved task state is the authority: a reload resumes the job, not its side effects. */
export function FirstJob({
  kind,
  task,
  draft,
  onDraft,
  onSaved,
  onFinished,
  onPersonalize,
  onBack,
  onProvider,
}: {
  kind: FirstJobKind;
  task?: Task | null;
  onSaved: (task: Task) => void;
  draft: FirstJobDraft;
  onDraft: (draft: FirstJobDraft) => void;
  onFinished: (conversationId?: string) => void;
  onPersonalize: () => void;
  onBack: () => void;
  onProvider: () => void;
}) {
  const { data: app } = useAppState();
  const client = useQueryClient();
  const models = useModels(!task);
  const { chosen, accountId, source, instruction, requestId } = draft;
  const change = (patch: Partial<FirstJobDraft>) =>
    onDraft({ ...draft, ...patch, requestId: crypto.randomUUID() });
  const fileInput = useRef<HTMLInputElement>(null);
  const choices = (models.data?.providers ?? []).flatMap((provider) =>
    provider.models
      .filter((model) => provider.tools?.host && model.tools !== false)
      .map((model) => ({
        key: modelKey(provider.engine, model.id),
        label: `${provider.label} · ${model.label}`,
      })),
  );
  const preferredEngine = models.data?.default ?? app?.preferences.engine ?? 'claude-code';
  const preferred = modelKey(preferredEngine, app?.preferences.model ?? 'default');
  const inProvider = choices.find(
    (choice) => parseModelKey(choice.key)?.engine === preferredEngine,
  );
  // Never silently move private notes or spend to a different account/provider.
  const selected =
    chosen || choices.find((choice) => choice.key === preferred)?.key || inProvider?.key || '';
  const selectedChoice = choices.some((choice) => choice.key === selected)
    ? parseModelKey(selected)
    : undefined;
  const job = JOBS.find((job) => job.id === kind);
  const start = useMutation({
    mutationFn: async () => {
      if (!selectedChoice) throw new Error('Choose a connected model that can complete this job.');
      return firstJobApi.start({
        kind,
        ...selectedChoice,
        accountId,
        source,
        instruction,
        requestId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    onSuccess: onSaved,
    onError: () => {
      void client.invalidateQueries({ queryKey: firstJobKey });
    },
  });
  if (!job) throw new Error('Unknown starter job');
  if (task)
    return <FirstJobResult task={task} onFinished={onFinished} onPersonalize={onPersonalize} />;
  return (
    <Stack gap={5}>
      {kind === 'document' ? (
        <>
          <Field>
            <Field.Label>Your notes or document</Field.Label>
            <Textarea
              value={source}
              maxLength={12_000}
              minRows={7}
              autosize
              disabled={start.isPending}
              placeholder="Paste the source material you want to turn into a useful brief."
              onChange={(event) => change({ source: event.target.value })}
            />
            <Field.Description>
              Up to 12,000 characters. Your original stays unchanged.
            </Field.Description>
          </Field>
          <input
            ref={fileInput}
            type="file"
            hidden
            accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              if (file.size > 48_000 || !/\.(txt|md|csv)$/i.test(file.name)) {
                toast.error(
                  'Choose a text, Markdown or CSV file up to 48 KB, or paste the relevant part.',
                );
                return;
              }
              void file
                .text()
                .then((text) => {
                  if (text.length > 12_000 || text.includes('\0'))
                    throw new Error('Paste a readable excerpt up to 12,000 characters.');
                  change({ source: text });
                })
                .catch((error: Error) => toast.error(error.message));
            }}
          />
          <Button
            variant="surface"
            disabled={start.isPending}
            onClick={() => fileInput.current?.click()}
          >
            Choose a text document
          </Button>
        </>
      ) : (
        <Stack gap={2}>
          <GoogleConnect
            capabilities={job.needs}
            accountId={accountId}
            onReady={(id) => {
              if (id !== accountId) change({ accountId: id });
            }}
          />
          {accountId && (
            <Button
              variant="ghost"
              disabled={start.isPending}
              onClick={() => change({ accountId: undefined })}
            >
              Choose another Google account
            </Button>
          )}
        </Stack>
      )}
      <Field>
        <Field.Label>
          Anything to focus on?{' '}
          <Text as="span" tone="muted">
            Optional
          </Text>
        </Field.Label>
        <Input
          value={instruction}
          maxLength={1_000}
          disabled={start.isPending}
          placeholder="For example: decisions I need to make."
          onChange={(event) => change({ instruction: event.target.value })}
        />
      </Field>
      {selectedChoice ? (
        <Text size="sm" tone="muted">
          Powered by {choices.find((choice) => choice.key === selected)?.label}.{' '}
          {kind === 'document'
            ? 'Your source material is shared with this provider.'
            : 'The selected account’s relevant content is shared with this provider.'}
        </Text>
      ) : (
        <Callout
          tone="warning"
          title={
            models.isPending
              ? 'Checking what your models can do…'
              : 'Choose a model that can do the job'
          }
          action={
            <Button size="sm" onClick={onProvider}>
              Connect a provider
            </Button>
          }
        >
          {models.isError
            ? 'The model list could not be loaded. Your notes are still here.'
            : 'This job needs Conch’s tools, not just chat.'}
        </Callout>
      )}
      {choices.length > 0 && (
        <Collapsible>
          <Collapsible.Trigger asChild>
            <Button variant="ghost" size="sm">
              Change model
            </Button>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Select
              aria-label="Model for this job"
              disabled={start.isPending}
              value={selected}
              placeholder="Choose a model"
              onValueChange={(key) => change({ chosen: key })}
            >
              {choices.map((choice) => (
                <Select.Item key={choice.key} value={choice.key}>
                  {choice.label}
                </Select.Item>
              ))}
            </Select>
          </Collapsible.Content>
        </Collapsible>
      )}
      {start.error && (
        <Callout tone="warning" live="polite" title="Couldn’t confirm the start">
          {start.error.message} Try again to recover the same request, without starting a duplicate.
        </Callout>
      )}
      <Text size="sm" tone="muted">
        {kind === 'followups'
          ? 'You review each draft before it is saved. This job cannot send mail.'
          : 'This job only reads its sources and saves a new document in Conch.'}
      </Text>
      <Button
        size="lg"
        loading={start.isPending}
        disabled={!selectedChoice || (kind === 'document' ? !source.trim() : !accountId)}
        onClick={() => start.mutate()}
      >
        {job.title}
      </Button>
      <Button variant="ghost" onClick={onBack} disabled={start.isPending}>
        Choose another job
      </Button>
    </Stack>
  );
}

function ProviderRepair({ engine }: { engine: EngineId }) {
  const providers = useProviders();
  const [open, setOpen] = useState(false);
  const provider = providers.data?.providers.find((item) => item.id === engine);
  if (!provider) return null;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Check {provider.name} connection
      </Button>
      <ConnectProviderDialog
        provider={open ? provider : undefined}
        onePassword={providers.data?.onePassword ?? { available: false }}
        onOpenChange={setOpen}
      />
    </>
  );
}

function FirstJobResult({
  task,
  onFinished,
  onPersonalize,
}: {
  task: Task;
  onFinished: (conversationId?: string) => void;
  onPersonalize: () => void;
}) {
  const live = useLive();
  const client = useQueryClient();
  const view =
    useLiveStore((state) => (task.conversationId ? state.views[task.conversationId] : undefined)) ??
    emptyView;
  const { data: app } = useAppState();
  useEffect(
    () => (task.conversationId ? live.watch(task.conversationId) : undefined),
    [task.conversationId, live],
  );
  const action = useMutation({
    mutationFn: (kind: 'stop' | 'retry') =>
      kind === 'stop' ? tasksApi.stop(task.id) : tasksApi.retry(task.id),
    onSuccess: (task) => client.setQueryData(firstJobKey, { task }),
  });
  const busy = ['queued', 'running', 'needs-you'].includes(task.status);
  const verified = task.status === 'done' && task.verification === 'verified';
  const receipts = (task.operations ?? []).filter(
    (operation) => operation.state === 'confirmed' && operation.receipt,
  );
  const artifact = receipts.findLast((operation) => operation.tool === 'artifact_create')?.receipt;
  const drafts = receipts.filter((operation) => operation.tool === 'google_mail_create_draft');
  const permissions = view.items.filter((item) => item.kind === 'permission' && !item.decision);
  return (
    <Stack gap={5}>
      <Callout
        live="polite"
        tone={verified ? 'success' : busy ? 'info' : 'warning'}
        title={
          verified
            ? 'Ready to review'
            : task.status === 'needs-you'
              ? 'One decision needs you'
              : busy
                ? 'Working on your result'
                : 'Your work is kept'
        }
      >
        {task.current ??
          task.error ??
          (verified
            ? 'Conch checked the saved result. Review the content below.'
            : busy
              ? 'You can leave this page and come back. Your progress is saved.'
              : 'The job has not been verified as finished. Review the progress before continuing.')}
      </Callout>
      {permissions.map(
        (item) =>
          item.kind === 'permission' && (
            <PermissionCard
              key={item.id}
              item={item}
              allowAlways={false}
              name={app?.persona.name ?? 'Conch'}
              onRespond={(decision) => {
                if (task.conversationId)
                  live.respond(
                    task.conversationId,
                    item.id,
                    decision === 'allow-always' ? 'allow' : decision,
                  );
              }}
            />
          ),
      )}
      {artifact && <ArtifactView artifactId={artifact.id} standalone />}
      {task.summary && (
        <>
          <Heading level={2} size="lg">
            Summary
          </Heading>
          <Markdown text={task.summary} sealed />
        </>
      )}
      {task.workflow === 'followups' && (
        <Text weight="medium">
          {drafts.length
            ? `${drafts.length} verified saved draft${drafts.length === 1 ? '' : 's'}.`
            : 'No saved drafts verified.'}{' '}
          This job cannot send mail.
        </Text>
      )}
      {receipts.length > 0 && (
        <Stack gap={2} aria-label="Verified results">
          {receipts.map((operation) => (
            <Text key={operation.id} size="sm">
              {operation.receipt?.url ? (
                <a href={operation.receipt.url} target="_blank" rel="noreferrer">
                  {operation.receipt.label}
                </a>
              ) : (
                operation.receipt?.label
              )}
            </Text>
          ))}
        </Stack>
      )}
      {action.error && (
        <Callout tone="warning" live="polite">
          {action.error.message}
        </Callout>
      )}
      {!busy && !verified && task.options.engine && <ProviderRepair engine={task.options.engine} />}
      {!busy &&
        !verified &&
        task.toolScope?.accountId &&
        task.workflow &&
        task.workflow !== 'document' && (
          <Collapsible>
            <Collapsible.Trigger asChild>
              <Button variant="ghost">Reconnect this job’s Google account</Button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <GoogleConnect
                accountId={task.toolScope.accountId}
                capabilities={JOBS.find((job) => job.id === task.workflow)?.needs ?? []}
                onReady={() => {
                  /* Explicit Continue keeps resumption a deliberate action. */
                }}
              />
            </Collapsible.Content>
          </Collapsible>
        )}
      {busy ? (
        <Button variant="surface" loading={action.isPending} onClick={() => action.mutate('stop')}>
          Stop this job
        </Button>
      ) : (
        <>
          {!verified && (
            <Button loading={action.isPending} onClick={() => action.mutate('retry')}>
              Continue from saved progress
            </Button>
          )}
          <Button
            size="lg"
            variant={verified ? 'solid' : 'surface'}
            onClick={() => onFinished(task.conversationId)}
          >
            {verified ? 'Keep this result and open Conch' : 'Open this work in Conch'}
          </Button>
          {verified && (
            <Button variant="ghost" onClick={onPersonalize}>
              Make Conch yours
            </Button>
          )}
        </>
      )}
    </Stack>
  );
}
