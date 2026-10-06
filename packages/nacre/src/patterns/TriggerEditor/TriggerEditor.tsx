import {
  CalendarClock,
  CircleCheckBig,
  FolderOpen,
  Globe,
  Mail,
  Plus,
  Repeat,
  Webhook,
  X,
  Zap,
} from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Collapsible } from '../../components/Collapsible';
import { Input } from '../../components/Input';
import { RadioGroup } from '../../components/RadioGroup';
import { Select } from '../../components/Select';
import { Skeleton } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { PathPicker } from '../PathPicker';
import type { TriggerKind, TriggerPreviewValue, TriggerValue } from '../Routines/types';
import styles from './TriggerEditor.module.css';

export interface TriggerPerson {
  address: string;
  name?: string;
}

const CHOICES: { kind: TriggerKind; label: string; description: string; icon: ReactNode }[] = [
  {
    kind: 'mail',
    label: 'An email arrives',
    description: 'From someone, or about something',
    icon: <Mail />,
  },
  {
    kind: 'calendar',
    label: 'Before a meeting',
    description: 'A few minutes before events in your calendar',
    icon: <CalendarClock />,
  },
  { kind: 'page', label: 'A page changes', description: 'Its words, not its ads', icon: <Globe /> },
  {
    kind: 'folder',
    label: 'A folder changes',
    description: 'Files added or changed on this computer',
    icon: <FolderOpen />,
  },
  {
    kind: 'task',
    label: 'A task finishes',
    description: 'One you sent off to work in the background',
    icon: <CircleCheckBig />,
  },
  {
    kind: 'routine',
    label: 'Another routine runs',
    description: 'Right after it’s done',
    icon: <Repeat />,
  },
];

const LEADS = [5, 10, 15, 30, 60, 120, 1440];
const leadText = (n: number) =>
  n >= 1440 ? 'A day' : n >= 60 ? `${n / 60} hour${n === 60 ? '' : 's'}` : `${n} minutes`;
const PACES = [15, 30, 60, 360, 1440];
const paceText = (n: number) =>
  n >= 1440
    ? 'Once a day'
    : n >= 60
      ? n === 60
        ? 'Every hour'
        : `Every ${n / 60} hours`
      : `Every ${n} minutes`;

/** A fresh trigger of a kind, keeping what still fits from the one before. */
export function defaultTrigger(kind: TriggerKind, from?: TriggerValue): TriggerValue {
  const words = from && 'words' in from ? from.words : [];
  switch (kind) {
    case 'mail':
      return { kind, from: [], words };
    case 'calendar':
      return { kind, minutesBefore: 15, withOthers: true, words };
    case 'page':
      return { kind, url: '', every: 60 };
    case 'folder':
      return { kind, path: '' };
    case 'task':
      return { kind };
    case 'routine':
      return { kind, routineId: '' };
    case 'hook':
      return { kind };
  }
}

/** "invoice, the contract" → ["invoice", "the contract"]. */
const toWords = (text: string) =>
  [
    ...new Set(
      text
        .split(',')
        .map((w) => w.replace(/["\r\n]/g, '').trim())
        .filter(Boolean),
    ),
  ].slice(0, 10);

export interface TriggerEditorProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  value: TriggerValue;
  onChange: (value: TriggerValue) => void;
  /** "Only if…", checked by a small model before it starts (empty: every time). */
  onlyIf: string;
  onOnlyIfChange: (value: string) => void;
  /** The gateway's words for `value`, and whether it can be saved. */
  preview?: TriggerPreviewValue;
  loading?: boolean;
  /** People you write to, picked rather than typed. */
  people?: TriggerPerson[];
  /** Why there's nobody to pick from, in a sentence. */
  peopleNote?: string;
  /** Other routines one can follow. */
  routines?: { id: string; title: string }[];
  /** The system's Open dialog for a folder; left out where none can show. */
  onChooseFolder?: () => Promise<string | undefined>;
  label?: string;
}

/**
 * “What starts it?” — a routine that starts when something happens, in plain
 * choices: an email, a meeting, a page, a folder, a task, another routine,
 * and (behind Advanced) a message from another app. Each choice has its own
 * picker, an optional “only if…”, and the sentence Conch will show for it.
 */
export function TriggerEditor({
  value,
  onChange,
  onlyIf,
  onOnlyIfChange,
  preview,
  loading,
  people = [],
  peopleNote,
  routines = [],
  onChooseFolder,
  label = 'What starts it?',
  className,
  ...props
}: TriggerEditorProps) {
  const id = useId();
  const [advanced, setAdvanced] = useState(value.kind === 'hook');

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      className={cx(styles.editor, className)}
      {...props}
    >
      <div className={styles.head}>
        <Zap aria-hidden className={styles.headIcon} />
        <span id={`${id}-label`} className={styles.label}>
          {label}
        </span>
      </div>

      <RadioGroup
        variant="card"
        aria-label="Starts when"
        value={value.kind}
        onValueChange={(kind) => onChange(defaultTrigger(kind as TriggerKind, value))}
        className={styles.choices}
      >
        {CHOICES.map((c) => (
          <RadioGroup.Item
            key={c.kind}
            value={c.kind}
            label={c.label}
            description={c.description}
            icon={c.icon}
          />
        ))}
        <Collapsible open={advanced} onOpenChange={setAdvanced} className={styles.advanced}>
          <Collapsible.Trigger className={styles.advancedTrigger}>Advanced</Collapsible.Trigger>
          <Collapsible.Content>
            <RadioGroup.Item
              value="hook"
              label="Another app sends a message"
              description="It gets its own web address: for a shop, a form or a service like GitHub"
              icon={<Webhook />}
            />
          </Collapsible.Content>
        </Collapsible>
      </RadioGroup>

      <div className={styles.details}>
        <Details
          id={id}
          value={value}
          onChange={onChange}
          people={people}
          peopleNote={peopleNote}
          routines={routines}
          onChooseFolder={onChooseFolder}
        />
        <div className={styles.field}>
          <label htmlFor={`${id}-only`} className={styles.fieldLabel}>
            Only if… <span className={styles.optional}>(optional)</span>
          </label>
          <Input
            id={`${id}-only`}
            value={onlyIf}
            maxLength={300}
            placeholder="it’s about the invoice"
            aria-describedby={`${id}-only-note`}
            onChange={(e) => onOnlyIfChange(e.target.value)}
          />
          <p id={`${id}-only-note`} className={styles.note}>
            A small model checks each one first, for a fraction of a cent. Leave it empty to start
            every time.
          </p>
        </div>
      </div>

      <TriggerPreview preview={preview} loading={loading} />
    </div>
  );
}

function Details({
  id,
  value,
  onChange,
  people,
  peopleNote,
  routines,
  onChooseFolder,
}: {
  id: string;
  value: TriggerValue;
  onChange: (value: TriggerValue) => void;
  people: TriggerPerson[];
  peopleNote?: string;
  routines: { id: string; title: string }[];
  onChooseFolder?: () => Promise<string | undefined>;
}) {
  const [wordsText, setWordsText] = useState(() =>
    'words' in value ? value.words.join(', ') : '',
  );
  const words = (
    <div className={styles.field}>
      <label htmlFor={`${id}-words`} className={styles.fieldLabel}>
        About <span className={styles.optional}>(optional)</span>
      </label>
      <Input
        id={`${id}-words`}
        value={wordsText}
        placeholder="invoice, contract"
        onChange={(e) => {
          setWordsText(e.target.value);
          if ('words' in value) onChange({ ...value, words: toWords(e.target.value) });
        }}
      />
    </div>
  );

  switch (value.kind) {
    case 'mail':
      return (
        <>
          <People
            id={id}
            chosen={value.from}
            people={people}
            note={peopleNote}
            onChange={(from) => onChange({ ...value, from })}
          />
          {words}
        </>
      );
    case 'calendar':
      return (
        <>
          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor={`${id}-lead`} className={styles.fieldLabel}>
                How long before
              </label>
              <Select
                id={`${id}-lead`}
                value={String(value.minutesBefore)}
                onValueChange={(v) => onChange({ ...value, minutesBefore: Number(v) })}
              >
                {[...new Set([...LEADS, value.minutesBefore])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <Select.Item key={n} value={String(n)}>
                      {leadText(n)}
                    </Select.Item>
                  ))}
              </Select>
            </div>
            {words}
          </div>
          <Switch
            checked={value.withOthers}
            onCheckedChange={(withOthers) => onChange({ ...value, withOthers })}
            label="Only meetings with other people"
            description="Not reminders you set for yourself."
          />
        </>
      );
    case 'page':
      return (
        <div className={styles.row}>
          <div className={cx(styles.field, styles.grow)}>
            <label htmlFor={`${id}-url`} className={styles.fieldLabel}>
              Page address
            </label>
            <Input
              id={`${id}-url`}
              type="url"
              inputMode="url"
              value={value.url}
              placeholder="https://example.com/pricing"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => onChange({ ...value, url: e.target.value.trim() })}
            />
          </div>
          <div className={styles.field}>
            <label htmlFor={`${id}-pace`} className={styles.fieldLabel}>
              Look
            </label>
            <Select
              id={`${id}-pace`}
              value={String(value.every)}
              onValueChange={(v) => onChange({ ...value, every: Number(v) })}
            >
              {[...new Set([...PACES, value.every])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <Select.Item key={n} value={String(n)}>
                    {paceText(n)}
                  </Select.Item>
                ))}
            </Select>
          </div>
        </div>
      );
    case 'folder':
      return (
        <PathPicker
          kind="folder"
          label="Folder to watch"
          value={value.path || undefined}
          onChange={(path) => onChange({ ...value, path })}
          {...(onChooseFolder && { onChoose: onChooseFolder })}
          // A chooser brings its own way to type a path (Nacre `FolderBrowser`).
          canType={!onChooseFolder}
          chooseLabel="Choose a folder…"
          placeholder="~/Downloads"
          hint="Never where keys are kept. Conch ignores its own changes."
        />
      );
    case 'task':
      return (
        <p className={styles.note}>It starts as soon as one of your background tasks is done.</p>
      );
    case 'routine':
      return (
        <div className={styles.field}>
          <label htmlFor={`${id}-after`} className={styles.fieldLabel}>
            After
          </label>
          {routines.length ? (
            <Select
              id={`${id}-after`}
              value={value.routineId || undefined}
              placeholder="Choose a routine"
              onValueChange={(routineId) => onChange({ ...value, routineId })}
            >
              {routines.map((r) => (
                <Select.Item key={r.id} value={r.id}>
                  {r.title}
                </Select.Item>
              ))}
            </Select>
          ) : (
            <p className={styles.note}>Make another routine first; this one can follow it.</p>
          )}
        </div>
      );
    case 'hook':
      return (
        <p className={styles.note}>
          Conch gives this routine its own web address. Another app sends a message there, and the
          routine starts with what it said. You’ll see the address, and can make a secret for it,
          once it’s saved. Nothing else can reach Conch through it.
        </p>
      );
  }
}

/** Whose mail: people you write to, one tap each; anyone else, typed. */
function People({
  id,
  chosen,
  people,
  note,
  onChange,
}: {
  id: string;
  chosen: { address?: string; name?: string }[];
  people: TriggerPerson[];
  note?: string;
  onChange: (from: { address?: string; name?: string }[]) => void;
}) {
  const [other, setOther] = useState('');
  const key = (p: { address?: string; name?: string }) => (p.address ?? p.name ?? '').toLowerCase();
  const isChosen = (p: { address?: string; name?: string }) =>
    chosen.some((c) => key(c) === key(p));
  const toggle = (p: TriggerPerson) =>
    onChange(
      isChosen(p)
        ? chosen.filter((c) => key(c) !== key(p))
        : [...chosen, { address: p.address, ...(p.name && { name: p.name }) }].slice(0, 10),
    );
  const extra = chosen.filter((c) => !people.some((p) => key(p) === key(c)));
  const add = () => {
    const text = other.trim();
    if (!text) return;
    const person = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
      ? { address: text.toLowerCase() }
      : { name: text };
    if (!isChosen(person)) onChange([...chosen, person].slice(0, 10));
    setOther('');
  };
  return (
    <div className={styles.field}>
      <span id={`${id}-from`} className={styles.fieldLabel}>
        From <span className={styles.optional}>(anyone, if you choose no one)</span>
      </span>
      {(people.length > 0 || extra.length > 0) && (
        <div className={styles.people} role="group" aria-labelledby={`${id}-from`}>
          {people.slice(0, 12).map((p) => (
            <button
              key={p.address}
              type="button"
              className={styles.person}
              aria-pressed={isChosen(p)}
              data-on={isChosen(p) || undefined}
              title={p.address}
              onClick={() => toggle(p)}
            >
              {p.name ?? p.address}
            </button>
          ))}
          {extra.map((p) => (
            <span key={key(p)} className={styles.person} data-on="">
              {p.name ?? p.address}
              <button
                type="button"
                className={styles.remove}
                aria-label={`Remove ${p.name ?? p.address}`}
                onClick={() => onChange(chosen.filter((c) => key(c) !== key(p)))}
              >
                <X aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}
      {note && people.length === 0 && <p className={styles.note}>{note}</p>}
      <div className={styles.row}>
        <Input
          aria-label="Someone else: a name or an email address"
          value={other}
          placeholder="Someone else: a name or an address"
          rootClassName={styles.grow}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="surface" leadingIcon={<Plus />} onClick={add} disabled={!other.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

/** The sentence Conch will show for it, or why it can't be saved yet. */
export function TriggerPreview({
  preview,
  loading,
}: {
  preview?: TriggerPreviewValue;
  loading?: boolean;
}) {
  if (loading && !preview)
    return (
      <div className={styles.preview} aria-busy>
        <Skeleton width="60%" />
      </div>
    );
  if (!preview) return null;
  if (!preview.valid)
    return (
      <Callout tone="warning" title="Not quite yet" live="polite">
        {preview.error ?? 'Finish choosing what starts it.'}
      </Callout>
    );
  return (
    <div className={styles.preview} aria-live="polite" data-loading={loading || undefined}>
      <p className={styles.previewText}>{preview.text}</p>
      {preview.note && <p className={styles.note}>{preview.note}</p>}
      <p className={styles.free}>Free until something happens.</p>
    </div>
  );
}
