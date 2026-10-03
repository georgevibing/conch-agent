import type {
  CreateRoutineBody,
  Routine,
  RoutineTrust,
  Schedule,
  TurnOptions,
} from '@conch/protocol';
import {
  Button,
  Field,
  Input,
  ModelPicker,
  RadioGroup,
  ScheduleEditor,
  Sheet,
  Stack,
  Switch,
  Text,
  Textarea,
  toast,
  type ScheduleValue,
} from '@conch/nacre';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { z } from 'zod';

import { ApiError } from '../../api/client';
import { useAppState, useModels } from '../../api/queries';
import { pickerProviders } from '../models/catalog';
import { findModel, modelKey, parseModelKey } from '../models/useTurnOptions';
import { fuzzyMatch } from '../search/fuzzy';
import { browserTimezone, routinesApi } from './api';
import { routineKeys } from './queries';
import { runLimitText } from './spendWords';
import styles from './Routines.module.css';
import { useSchedulePreview } from './useSchedulePreview';

export type RoutineDraft = Partial<Omit<z.input<typeof CreateRoutineBody>, 'status'>>;

const trustOptions: { value: RoutineTrust; label: string; description: string }[] = [
  {
    value: 'ask',
    label: 'Ask me first',
    description: 'The run pauses and you’ll be asked. Safest — recommended.',
  },
  {
    value: 'edits',
    label: 'Allow file changes',
    description: 'It can create and edit files without asking. Commands still wait for you.',
  },
  {
    value: 'full',
    label: 'Allow everything',
    description:
      'It can run commands and change anything, with nobody watching. Anything it reads could steer it — only for tasks you fully trust.',
  },
];

const defaultSchedule: Schedule = { type: 'daily', time: '09:00' };

/** `null` = Conch's own limit; `undefined` = not a valid amount (yet). */
function parseLimit(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const amount = Number(text.replace(/[$,\s]/g, ''));
  return Number.isFinite(amount) && amount > 0 && amount <= 1000 ? amount : undefined;
}

/**
 * Which model runs it: the person's default unless they pick one. Every
 * connected provider's models, so a simple job can go to a smaller, cheaper
 * one (ADR 0057).
 */
function ModelField({
  options,
  onChange,
}: {
  options: TurnOptions;
  onChange: (options: TurnOptions) => void;
}) {
  const { data: app } = useAppState();
  const { data: catalog } = useModels(Boolean(app));
  const [open, setOpen] = useState(false);
  const providers = catalog?.providers ?? [];
  const engine = options.engine ?? catalog?.default;
  const provider = providers.find((p) => p.engine === engine);
  const chosen =
    options.model ?? (engine === catalog?.default ? app?.preferences.model : undefined);
  const model = findModel(provider, chosen);
  return (
    <Field>
      <Field.Label id="routine-model">Model</Field.Label>
      <Stack direction="row" gap={2} align="center" wrap>
        <ModelPicker
          modelOnly
          side="bottom"
          providers={pickerProviders(providers, catalog?.default, modelKey)}
          model={provider && model ? modelKey(provider.engine, model.id) : ''}
          onModelChange={(key) => {
            const choice = parseModelKey(key);
            if (choice) onChange({ ...options, engine: choice.engine, model: choice.model });
            setOpen(false);
          }}
          match={fuzzyMatch}
          open={open}
          onOpenChange={setOpen}
          loading={!catalog}
          effort="auto"
          efforts={[]}
          onEffortChange={() => {}}
          fastMode={false}
          fastModeAvailable={false}
          onFastModeChange={() => {}}
          isDefault={!options.model}
        />
        {options.model && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const { engine: _engine, model: _model, ...rest } = options;
              onChange(rest);
            }}
          >
            Use my default
          </Button>
        )}
      </Stack>
      <Field.Description>
        {options.model
          ? 'This routine always uses this model.'
          : 'Your default model. Something simple, like a reminder, can use a smaller, cheaper one.'}
      </Field.Description>
    </Field>
  );
}

/**
 * Create or edit a routine. Everything a person needs is up front in plain
 * words; the exact instruction and schedule are right there too, never hidden.
 */
export function RoutineEditor({
  open,
  onOpenChange,
  routine,
  draft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing routine… */
  routine?: Routine;
  /** …or starting from a template. */
  draft?: RoutineDraft;
}) {
  const initial = routine ?? draft ?? {};
  const [title, setTitle] = useState(initial.title ?? '');
  const [summary, setSummary] = useState(initial.summary ?? '');
  const [prompt, setPrompt] = useState(initial.prompt ?? '');
  const [schedule, setSchedule] = useState<Schedule>(initial.schedule ?? defaultSchedule);
  const [trust, setTrust] = useState<RoutineTrust>(initial.trust ?? 'ask');
  const [catchUp, setCatchUp] = useState(initial.catchUp ?? true);
  const [options, setOptions] = useState<TurnOptions>(initial.options ?? {});
  const [limitText, setLimitText] = useState(
    routine?.runLimitUsd ? String(routine.runLimitUsd) : '',
  );
  const limit = parseLimit(limitText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const timezone = routine?.timezone ?? browserTimezone();
  const { preview, loading } = useSchedulePreview(schedule, timezone);
  const client = useQueryClient();
  const navigate = useNavigate();
  const nameRef = useRef<HTMLInputElement>(null);

  const missing = !title.trim()
    ? 'Give it a name.'
    : !prompt.trim()
      ? 'Tell Conch what to do.'
      : undefined;
  const canSave = !missing && preview?.valid !== false && limit !== undefined && !saving;
  const spend = routine?.spend;
  const conchLimit =
    spend?.runLimit && !spend.runLimit.custom ? runLimitText(spend.runLimit) : undefined;

  const save = async (status: 'active' | 'paused') => {
    setSaving(true);
    setError(undefined);
    try {
      const body = { title, summary, prompt, schedule, timezone, trust, catchUp, options };
      const saved = routine
        ? await routinesApi.update(routine.id, {
            ...body,
            // What a run may spend is a person's choice, made here (ADR 0057).
            ...(limit !== undefined && { runLimitUsd: limit }),
            ...(routine.status === 'draft' && { status }),
          })
        : await routinesApi.create({ ...body, ...(limit && { runLimitUsd: limit }), status });
      await client.invalidateQueries({ queryKey: routineKeys.all });
      client.setQueryData(routineKeys.detail(saved.id), (d: unknown) =>
        d ? { ...(d as object), routine: saved } : d,
      );
      toast.success(
        routine
          ? 'Saved'
          : status === 'active'
            ? `“${saved.title}” is on`
            : `“${saved.title}” saved`,
        {
          description: saved.nextRunAt ? `${saved.scheduleText}.` : saved.scheduleText,
        },
      );
      onOpenChange(false);
      if (!routine) void navigate(`/routines/${saved.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Couldn’t save this routine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content
        side="right"
        size="lg"
        className={styles.editor}
        onOpenAutoFocus={(e) => {
          // New routines start at the name; edits keep focus on the sheet itself.
          if (routine) return;
          e.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <Sheet.Header>
          <Sheet.Title>{routine ? 'Edit routine' : 'New routine'}</Sheet.Title>
          <Sheet.Description>Something Conch does for you, on a schedule.</Sheet.Description>
        </Sheet.Header>
        <Sheet.Body>
          <Stack gap={6}>
            <Field>
              <Field.Label>Name</Field.Label>
              <Input
                ref={nameRef}
                value={title}
                maxLength={60}
                placeholder="Morning briefing"
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field>
              <Field.Label optional>What you’ll get</Field.Label>
              <Input
                value={summary}
                maxLength={200}
                placeholder="A short summary of today’s calendar and the weather."
                onChange={(e) => setSummary(e.target.value)}
              />
              <Field.Description>
                One short sentence. It’s shown on the routine’s card.
              </Field.Description>
            </Field>
            <Field>
              <Field.Label>What should Conch do?</Field.Label>
              <Textarea
                autosize
                minRows={4}
                maxRows={14}
                value={prompt}
                placeholder="Check the weather where I am and my calendar for today, then write me a short, friendly briefing."
                onChange={(e) => setPrompt(e.target.value)}
              />
              <Field.Description>
                Write it like you’d brief a helpful assistant. Each run starts fresh, so include
                everything it needs to know.
              </Field.Description>
            </Field>

            <ScheduleEditor
              label="When should it run?"
              value={schedule as ScheduleValue}
              onChange={(v) => setSchedule(v as Schedule)}
              timezone={timezone}
              preview={preview}
              loading={loading}
            />

            <ModelField options={options} onChange={setOptions} />

            {spend?.billing !== 'free' && (
              <Field invalid={limit === undefined}>
                <Field.Label optional>Most one run may spend</Field.Label>
                <Input
                  inputMode="decimal"
                  leading="$"
                  value={limitText}
                  placeholder={conchLimit?.replace(/^\$/, '') ?? 'Conch decides'}
                  onChange={(e) => setLimitText(e.target.value)}
                />
                {limit === undefined ? (
                  <Field.Error>
                    Enter an amount between $0.01 and $1,000, or leave it empty.
                  </Field.Error>
                ) : (
                  <Field.Description>
                    {spend?.text ? `${spend.text}. ` : ''}
                    Leave it empty and a run stops if it uses about three times its usual
                    {conchLimit ? ` (${conchLimit} now)` : ''}.
                  </Field.Description>
                )}
              </Field>
            )}

            <Stack gap={2}>
              <Text as="span" size="sm" weight="medium" id="routine-trust">
                If it needs permission while you’re away
              </Text>
              <RadioGroup
                variant="card"
                aria-labelledby="routine-trust"
                value={trust}
                onValueChange={(v) => setTrust(v as RoutineTrust)}
              >
                {trustOptions.map((o) => (
                  <RadioGroup.Item
                    key={o.value}
                    value={o.value}
                    label={o.label}
                    description={o.description}
                  />
                ))}
              </RadioGroup>
            </Stack>

            <Switch
              checked={catchUp}
              onCheckedChange={setCatchUp}
              label="Catch up if Conch was off"
              description="If Conch wasn’t running at the scheduled time, run it once as soon as it’s back."
            />
            {error && (
              <Text tone="danger" size="sm" role="alert">
                {error}
              </Text>
            )}
          </Stack>
        </Sheet.Body>
        <Sheet.Footer>
          <Text size="xs" tone="subtle" className={styles.footerNote}>
            {missing ?? (preview?.valid === false ? preview.error : preview?.text)}
          </Text>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {routine && routine.status !== 'draft' ? (
            <Button onClick={() => void save('active')} disabled={!canSave} loading={saving}>
              Save
            </Button>
          ) : (
            <>
              <Button variant="surface" onClick={() => void save('paused')} disabled={!canSave}>
                Save paused
              </Button>
              <Button onClick={() => void save('active')} disabled={!canSave} loading={saving}>
                Turn on
              </Button>
            </>
          )}
        </Sheet.Footer>
      </Sheet.Content>
    </Sheet.Root>
  );
}
