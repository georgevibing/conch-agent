import { Check, CircleAlert, MessageCircleQuestion, SkipForward } from 'lucide-react';
import { Checkbox as CheckboxPrimitive, RadioGroup as RadioPrimitive, ToggleGroup } from 'radix-ui';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
} from 'react';

import { Button } from '../../components/Button';
import { DatePicker } from '../../components/DatePicker';
import { localToday, toUtc } from '../../components/DatePicker/calendar';
import { Input } from '../../components/Input';
import { NumberField } from '../../components/NumberField';
import { Textarea } from '../../components/Textarea';
import { TimePicker } from '../../components/TimePicker';
import { cx } from '../../utils/cx';
import styles from './QuestionCard.module.css';
import { dateOf, dayStrip, timeOf, timeSlots } from './when';

export interface QuestionCardOption {
  id: string;
  label: string;
  /** A few words under the label, when the label alone isn't enough. */
  description?: string;
}

interface Base {
  id: string;
  /** The question itself, short: "Which day suits you?" */
  label: string;
  optional?: boolean;
}

/** One thing a question asks for (mirrors `QuestionField` in `@conch/protocol`). */
export type QuestionCardField =
  | (Base & {
      kind: 'choice';
      options: readonly QuestionCardOption[];
      multiple?: boolean;
      /** Offer "Something else…" with a line to type in. */
      other?: boolean;
    })
  | (Base & { kind: 'date' | 'time' | 'datetime'; min?: string; max?: string; suggested?: string })
  | (Base & { kind: 'text'; placeholder?: string; multiline?: boolean })
  | (Base & {
      kind: 'number';
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      suggested?: number;
    });

/** A question the assistant asks mid-reply (mirrors `Question` in `@conch/protocol`). */
export interface QuestionCardQuestion {
  questionId: string;
  /** A heading when there's more than one field. */
  title?: string;
  fields: readonly QuestionCardField[];
}

/**
 * What the card answers, per field: an option's id (or the words typed for
 * "Something else"), several of them, `YYYY-MM-DD`, `HH:MM`,
 * `YYYY-MM-DDTHH:MM`, a number, or text.
 */
export type QuestionCardValue = string | string[] | number;
export type QuestionCardValues = Record<string, QuestionCardValue>;

export interface QuestionCardProps extends Omit<ComponentProps<'div'>, 'children' | 'onSubmit'> {
  question: QuestionCardQuestion;
  /** open: waiting; sending: posted, waiting for Conch; answered / skipped: folded to one quiet line. */
  state?: 'open' | 'sending' | 'answered' | 'skipped';
  /** The answer as a sentence ("Thursday 9 Oct, 10:00 · Video call"), for the folded line. */
  answer?: string;
  /** Answered by typing in the chat instead of on the card: the fold says "Answered in your message". */
  answeredInMessage?: boolean;
  onAnswer?: (values: QuestionCardValues) => void;
  onSkip?: () => void;
  /** Can't be answered from here any more (e.g. the reply ended): controls locked. */
  disabled?: boolean;
  /** One plain sentence when sending failed; the card stays open. */
  error?: string;
  /** Today as YYYY-MM-DD (stories/tests); defaults to the device's day. */
  today?: string;
  locale?: string;
  /** The assistant's name, for the accessible name ("Conch asks: …"). */
  assistant?: string;
}

const OTHER = '\u0000other';

type Draft =
  | { kind: 'choice'; picked: string[]; other: boolean; otherText: string }
  | { kind: 'when'; date?: string; time?: string }
  | { kind: 'text'; text: string }
  | { kind: 'number'; value?: number };

function initial(field: QuestionCardField): Draft {
  switch (field.kind) {
    case 'choice':
      return { kind: 'choice', picked: [], other: false, otherText: '' };
    case 'text':
      return { kind: 'text', text: '' };
    case 'number':
      return { kind: 'number', value: field.suggested };
    default:
      return {
        kind: 'when',
        ...(field.kind !== 'time' && { date: dateOf(field.suggested) }),
        ...(field.kind !== 'date' && { time: timeOf(field.suggested) }),
      };
  }
}

/** The field's value, or nothing yet. */
function valueOf(field: QuestionCardField, draft: Draft): QuestionCardValue | undefined {
  if (field.kind === 'choice' && draft.kind === 'choice') {
    const typed = draft.other ? draft.otherText.trim() : '';
    if (field.multiple) {
      const all = [...draft.picked, ...(typed ? [typed] : [])];
      return all.length ? all : undefined;
    }
    return draft.other ? typed || undefined : draft.picked[0];
  }
  if (draft.kind === 'when') {
    if (field.kind === 'date') return draft.date;
    if (field.kind === 'time') return draft.time;
    return draft.date && draft.time ? `${draft.date}T${draft.time}` : undefined;
  }
  if (draft.kind === 'text') return draft.text.trim() || undefined;
  if (draft.kind === 'number') return draft.value;
  return undefined;
}

function collect(
  fields: readonly QuestionCardField[],
  drafts: Record<string, Draft>,
): { values: QuestionCardValues; complete: boolean } {
  const values: QuestionCardValues = {};
  let complete = true;
  for (const field of fields) {
    const draft = drafts[field.id];
    const value = draft ? valueOf(field, draft) : undefined;
    if (value === undefined) {
      if (!field.optional) complete = false;
    } else values[field.id] = value;
  }
  return { values, complete };
}

const capitalise = (s: string) => s.charAt(0).toLocaleUpperCase() + s.slice(1);

function useWords(locale: string | undefined, today: string) {
  return useMemo(() => {
    const f = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
    const weekday = f({ weekday: 'short' });
    const day = f({ day: 'numeric' });
    const full = f({ weekday: 'long', day: 'numeric', month: 'long' });
    const time = f({ hour: 'numeric', minute: '2-digit' });
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return {
      /** "Today", "Tomorrow", or "Thu". */
      dayName: (date: string) => {
        const diff = Math.round((toUtc(date) - toUtc(today)) / 86_400_000);
        return diff === 0 || diff === 1
          ? capitalise(relative.format(diff, 'day'))
          : weekday.format(toUtc(date));
      },
      dayNumber: (date: string) => day.format(toUtc(date)),
      fullDay: (date: string) => full.format(toUtc(date)),
      time: (value: string) => {
        const [h = 0, m = 0] = value.split(':').map(Number);
        return time.format(Date.UTC(2000, 0, 1, h, m));
      },
    };
  }, [locale, today]);
}

type Words = ReturnType<typeof useWords>;

/** Something to type in: the field takes the keys, not the card's shortcuts. */
const TYPING = 'input, textarea, [contenteditable="true"], [role="spinbutton"]';

/**
 * Keys heard on an element, natively: before the controls inside it see
 * them, and never from a calendar or clock face portalled elsewhere.
 */
function useKeys(ref: RefObject<HTMLElement | null>, onKey: (event: KeyboardEvent) => void) {
  const latest = useRef(onKey);
  useEffect(() => {
    latest.current = onKey;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const listener = (event: KeyboardEvent) => latest.current(event);
    node.addEventListener('keydown', listener);
    return () => node.removeEventListener('keydown', listener);
  }, [ref]);
}

/**
 * A question the assistant asks in the middle of a reply (ADR 0060), answered
 * with a tap instead of a typed paragraph: options, a day and a time, a number,
 * a few words. It sits in the flow of the chat, calm, and wears the pearl rim
 * while it waits for you. A single choice goes the moment you tap it; anything
 * more has one **Send**. **Skip** is always there, quietly. Once answered it
 * folds to one line: the question, and what you said.
 *
 * Keys: 1–6 pick an option, arrows move between them, Enter sends.
 */
export function QuestionCard({
  question,
  state = 'open',
  answer,
  answeredInMessage,
  onAnswer,
  onSkip,
  disabled,
  error,
  today: todayProp,
  locale,
  assistant = 'Conch',
  className,
  ...props
}: QuestionCardProps) {
  const { fields, title } = question;
  const today = todayProp ?? localToday();
  const words = useWords(locale, today);
  const headingId = useId();
  const errorId = useId();
  const folded = state === 'answered' || state === 'skipped';
  // A card that was already answered when it arrived (history, a reload) is only its line.
  const [wasOpen] = useState(!folded);
  const sending = state === 'sending';
  const locked = Boolean(disabled) || sending || folded;
  const heading = title ?? (fields.length === 1 ? fields[0]?.label : undefined) ?? 'A question';
  const showLabels = Boolean(title) || fields.length > 1;
  const only = fields.length === 1 ? fields[0] : undefined;
  /** One choice, one field: a tap is the answer. */
  const tapSends = only?.kind === 'choice' && !only.multiple;

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(fields.map((f) => [f.id, initial(f)])),
  );
  // What's typed but only committed on Enter (a number) must count when Enter sends.
  const latest = useRef(drafts);
  const setDraft = (id: string, draft: Draft) => {
    latest.current = { ...latest.current, [id]: draft };
    setDrafts(latest.current);
  };
  const { complete } = collect(fields, drafts);

  const send = (values?: QuestionCardValues) => {
    if (locked) return;
    const now = collect(fields, latest.current);
    if (!values && !now.complete) return;
    onAnswer?.(values ?? now.values);
  };

  const root = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLParagraphElement>(null);
  // Focus that was on the card follows it into its folded line.
  useEffect(() => {
    if (!folded) return;
    const card = root.current?.querySelector('[data-question-card]');
    if (card?.contains(document.activeElement)) line.current?.focus();
  }, [folded]);

  /** Pick the nth option of a choice field, as a tap would. */
  const pickNth = (field: Extract<QuestionCardField, { kind: 'choice' }>, n: number) => {
    const option = field.options[n];
    const draft = latest.current[field.id];
    if (!option || draft?.kind !== 'choice') return;
    root.current
      ?.querySelector<HTMLElement>(`[data-field="${CSS.escape(field.id)}"] [data-index="${n}"]`)
      ?.focus();
    if (field.multiple) {
      const picked = draft.picked.includes(option.id)
        ? draft.picked.filter((id) => id !== option.id)
        : [...draft.picked, option.id];
      setDraft(field.id, { ...draft, picked });
      return;
    }
    setDraft(field.id, { ...draft, picked: [option.id], other: false });
    if (tapSends) send({ [field.id]: option.id });
  };

  const card = useRef<HTMLDivElement>(null);
  useKeys(card, (event) => {
    const target = event.target as HTMLElement;
    if (locked || event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^[1-6]$/.test(event.key) && !target.closest(TYPING)) {
      const holder = target.closest<HTMLElement>('[data-field]')?.dataset.field;
      const choices = fields.filter((f) => f.kind === 'choice');
      const field =
        choices.find((f) => f.id === holder) ?? (choices.length === 1 ? choices[0] : undefined);
      if (field?.kind !== 'choice') return;
      event.preventDefault();
      pickNth(field, Number(event.key) - 1);
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    if (target.closest('textarea')) return;
    // Buttons press themselves; only a choice sends on Enter.
    const row = target.closest<HTMLElement>('[data-option]');
    if (target.closest('button') && !row) return;
    event.preventDefault();
    // Enter on an option you've only moved to chooses it, then sends.
    const holder = row?.closest<HTMLElement>('[data-field]')?.dataset.field;
    const field = fields.find((f) => f.id === holder);
    if (
      row?.getAttribute('role') === 'radio' &&
      row.getAttribute('aria-checked') !== 'true' &&
      row.dataset.index !== undefined &&
      field?.kind === 'choice'
    ) {
      const option = field.options[Number(row.dataset.index)];
      if (option) {
        setDraft(field.id, { kind: 'choice', picked: [option.id], other: false, otherText: '' });
        if (tapSends) return send({ [field.id]: option.id });
      }
    }
    // After the control has had the key too: a number typed in commits on Enter.
    queueMicrotask(() => send());
  });

  const draftOf = (field: QuestionCardField) => drafts[field.id] ?? initial(field);
  const onlyDraft = only ? draftOf(only) : undefined;
  // A single choice sends on a tap, unless it's "Something else", which needs its words first.
  const showSend = !tapSends || (onlyDraft?.kind === 'choice' && onlyDraft.other);

  return (
    <div ref={root} className={cx(styles.shell, className)} data-state={state} {...props}>
      {wasOpen && (
        <div className={styles.fold} aria-hidden={folded || undefined} inert={folded || undefined}>
          <div
            role="group"
            aria-label={`${assistant} asks: ${heading}`}
            aria-describedby={error ? errorId : undefined}
            aria-busy={sending || undefined}
            data-question-card=""
            data-state={state}
            data-disabled={disabled || undefined}
            data-lustre=""
            data-lustre-ambient={state === 'open' && !disabled ? '' : undefined}
            className={styles.card}
            ref={card}
          >
            <div className={styles.header}>
              <span className={styles.mark} aria-hidden>
                <MessageCircleQuestion />
              </span>
              <p id={headingId} className={styles.heading}>
                {heading}
              </p>
            </div>
            <div className={styles.fields}>
              {fields.map((field) => {
                const labelId = `${headingId}-${field.id}`;
                return (
                  <div key={field.id} className={styles.field} data-field={field.id}>
                    {showLabels && (
                      <p id={labelId} className={styles.label}>
                        {field.label}
                        {field.optional && <span className={styles.optional}> · optional</span>}
                      </p>
                    )}
                    <FieldControl
                      field={field}
                      draft={draftOf(field)}
                      setDraft={(d) => setDraft(field.id, d)}
                      labelledBy={showLabels ? labelId : headingId}
                      disabled={locked}
                      tapSends={tapSends}
                      onTap={(id) => send({ [field.id]: id })}
                      today={today}
                      words={words}
                      locale={locale}
                    />
                  </div>
                );
              })}
            </div>
            {(showSend || onSkip) && (
              <div className={styles.actions}>
                {showSend && (
                  <Button
                    size="sm"
                    loading={sending}
                    disabled={!complete || (locked && !sending)}
                    onClick={() => send()}
                  >
                    Send
                  </Button>
                )}
                {onSkip && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={locked}
                    onClick={onSkip}
                    className={styles.skip}
                  >
                    Skip
                  </Button>
                )}
              </div>
            )}
            {error && (
              <p id={errorId} role="alert" className={styles.error}>
                <CircleAlert aria-hidden />
                {error}
              </p>
            )}
          </div>
        </div>
      )}
      {folded && (
        <p ref={line} role="note" tabIndex={-1} className={styles.line} data-state={state}>
          {state === 'answered' ? (
            <>
              <Check aria-hidden className={styles.lineIcon} />
              <span className={styles.lineQuestion}>{heading}</span>
              <span
                className={styles.lineAnswer}
                data-in-message={answeredInMessage || !answer ? '' : undefined}
              >
                {answeredInMessage || !answer ? 'Answered in your message' : answer}
              </span>
            </>
          ) : (
            <>
              <SkipForward aria-hidden className={styles.lineIcon} />
              <span className={styles.lineAnswer} data-in-message="">
                Skipped
              </span>
              <span className={styles.lineQuestion}>{heading}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

interface ControlProps {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  labelledBy: string;
  disabled: boolean;
  today: string;
  words: Words;
  locale?: string;
}

function FieldControl({
  field,
  tapSends,
  onTap,
  ...props
}: ControlProps & {
  field: QuestionCardField;
  tapSends: boolean;
  onTap: (optionId: string) => void;
}) {
  const { draft, setDraft, labelledBy, disabled } = props;
  switch (field.kind) {
    case 'choice':
      return draft.kind === 'choice' ? (
        <ChoiceControl field={field} tapSends={tapSends} onTap={onTap} {...props} draft={draft} />
      ) : null;
    case 'text':
      return field.multiline ? (
        <Textarea
          aria-labelledby={labelledBy}
          placeholder={field.placeholder}
          value={draft.kind === 'text' ? draft.text : ''}
          onChange={(e) => setDraft({ kind: 'text', text: e.target.value })}
          autosize
          minRows={2}
          maxRows={6}
          disabled={disabled}
          maxLength={4000}
        />
      ) : (
        <Input
          aria-labelledby={labelledBy}
          placeholder={field.placeholder}
          value={draft.kind === 'text' ? draft.text : ''}
          onChange={(e) => setDraft({ kind: 'text', text: e.target.value })}
          disabled={disabled}
          maxLength={4000}
        />
      );
    case 'number':
      return (
        <NumberField
          aria-labelledby={labelledBy}
          value={draft.kind === 'number' ? (draft.value ?? field.min ?? 0) : 0}
          onValueChange={(value) => setDraft({ kind: 'number', value })}
          min={field.min}
          max={field.max}
          step={field.step}
          unit={field.unit}
          disabled={disabled}
          rootClassName={styles.number}
        />
      );
    default:
      return draft.kind === 'when' ? <WhenControl field={field} {...props} draft={draft} /> : null;
  }
}

function ChoiceControl({
  field,
  draft,
  setDraft,
  labelledBy,
  disabled,
  tapSends,
  onTap,
}: ControlProps & {
  field: Extract<QuestionCardField, { kind: 'choice' }>;
  draft: Extract<Draft, { kind: 'choice' }>;
  tapSends: boolean;
  onTap: (optionId: string) => void;
}) {
  const id = useId();
  const otherInput = useRef<HTMLInputElement>(null);
  const arrowing = useRef(false);
  // Choosing "Something else" puts you straight in its line.
  const [revealed, setRevealed] = useState(0);
  useEffect(() => {
    if (revealed) otherInput.current?.focus();
  }, [revealed]);

  const rows = [
    ...field.options.map((option, index) => ({ ...option, index })),
    ...(field.other ? [{ id: OTHER, label: 'Something else…', index: -1 }] : []),
  ];
  const content = (row: (typeof rows)[number]) => (
    <>
      {row.index >= 0 && (
        <span className={styles.key} aria-hidden>
          {row.index + 1}
        </span>
      )}
      <span className={styles.optionText}>
        <span id={`${id}-${row.index}`} className={styles.optionLabel}>
          {row.label}
        </span>
        {'description' in row && row.description && (
          <span id={`${id}-${row.index}-d`} className={styles.optionDescription}>
            {row.description}
          </span>
        )}
      </span>
    </>
  );
  const described = (row: (typeof rows)[number]) =>
    'description' in row && row.description ? `${id}-${row.index}-d` : undefined;

  const other = draft.other && (
    <Input
      ref={otherInput}
      aria-label="Something else"
      placeholder="In your own words"
      value={draft.otherText}
      onChange={(e) => setDraft({ ...draft, otherText: e.target.value })}
      disabled={disabled}
      maxLength={200}
      rootClassName={styles.otherInput}
    />
  );

  /** Arrows walk the boxes, as they do in a radio group. */
  const group = useRef<HTMLDivElement>(null);
  useKeys(group, (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
    if (!step || !group.current) return;
    const boxes = [...group.current.querySelectorAll<HTMLElement>('[role="checkbox"]')];
    const at = boxes.indexOf(document.activeElement as HTMLElement);
    if (at === -1) return;
    event.preventDefault();
    boxes[(at + step + boxes.length) % boxes.length]?.focus();
  });

  if (!field.multiple) {
    const value = draft.other ? OTHER : (draft.picked[0] ?? '');
    return (
      <>
        <RadioPrimitive.Root
          aria-labelledby={labelledBy}
          value={value}
          onValueChange={(next) => {
            if (next === OTHER) {
              setDraft({ ...draft, picked: [], other: true });
              setRevealed((n) => n + 1);
              return;
            }
            setDraft({ ...draft, picked: [next], other: false });
            // Arrows move the choice; a tap, Space or a number is the answer.
            if (tapSends && !arrowing.current) onTap(next);
          }}
          onKeyDownCapture={(e) => {
            arrowing.current = e.key.startsWith('Arrow');
          }}
          onKeyUpCapture={() => {
            arrowing.current = false;
          }}
          disabled={disabled}
          loop
          className={styles.options}
        >
          {rows.map((row) => (
            <RadioPrimitive.Item
              key={row.id}
              value={row.id}
              data-option=""
              data-index={row.index >= 0 ? row.index : undefined}
              data-other={row.index < 0 ? '' : undefined}
              data-lustre=""
              aria-labelledby={`${id}-${row.index}`}
              aria-describedby={described(row)}
              className={styles.option}
            >
              {content(row)}
              <span className={styles.radio} aria-hidden>
                <RadioPrimitive.Indicator forceMount className={styles.dot} />
              </span>
            </RadioPrimitive.Item>
          ))}
        </RadioPrimitive.Root>
        {other}
      </>
    );
  }

  return (
    <>
      <div role="group" aria-labelledby={labelledBy} className={styles.options} ref={group}>
        {rows.map((row) => {
          const checked = row.index < 0 ? draft.other : draft.picked.includes(row.id);
          return (
            <CheckboxPrimitive.Root
              key={row.id}
              checked={checked}
              onCheckedChange={(on) => {
                if (row.index < 0) {
                  setDraft({ ...draft, other: on === true });
                  if (on === true) setRevealed((n) => n + 1);
                  return;
                }
                setDraft({
                  ...draft,
                  picked:
                    on === true
                      ? [...draft.picked, row.id]
                      : draft.picked.filter((p) => p !== row.id),
                });
              }}
              disabled={disabled}
              data-option=""
              data-index={row.index >= 0 ? row.index : undefined}
              data-other={row.index < 0 ? '' : undefined}
              data-lustre=""
              aria-labelledby={`${id}-${row.index}`}
              aria-describedby={described(row)}
              className={styles.option}
            >
              {content(row)}
              <span className={styles.box} aria-hidden>
                <CheckboxPrimitive.Indicator forceMount className={styles.tick}>
                  <svg viewBox="0 0 16 16">
                    <path d="M3.75 8.4 6.6 11.1 12.25 5.25" pathLength={1} />
                  </svg>
                </CheckboxPrimitive.Indicator>
              </span>
            </CheckboxPrimitive.Root>
          );
        })}
      </div>
      {other}
    </>
  );
}

function WhenControl({
  field,
  draft,
  setDraft,
  labelledBy,
  disabled,
  today,
  words,
  locale,
}: ControlProps & {
  field: Extract<QuestionCardField, { kind: 'date' | 'time' | 'datetime' }>;
  draft: Extract<Draft, { kind: 'when' }>;
}) {
  const id = useId();
  const minDate = dateOf(field.min);
  const maxDate = dateOf(field.max);
  const days = dayStrip(today, { min: minDate, max: maxDate, suggested: dateOf(field.suggested) });
  const inStrip = draft.date !== undefined && days.includes(draft.date);
  // The day's own limits only bind on the first and last days allowed.
  const slots = timeSlots({
    min: field.kind === 'time' || draft.date === minDate ? timeOf(field.min) : undefined,
    max: field.kind === 'time' || draft.date === maxDate ? timeOf(field.max) : undefined,
    suggested: timeOf(field.suggested),
  });

  return (
    <div className={styles.when}>
      {field.kind !== 'time' && (
        <div className={styles.dayRow}>
          <ToggleGroup.Root
            type="single"
            aria-label="Day"
            aria-describedby={labelledBy}
            value={draft.date ?? ''}
            onValueChange={(date) => {
              if (date) setDraft({ ...draft, date });
            }}
            disabled={disabled}
            loop
            className={styles.strip}
          >
            {days.map((date) => (
              <ToggleGroup.Item
                key={date}
                value={date}
                aria-label={words.fullDay(date)}
                data-lustre=""
                className={styles.day}
              >
                <span className={styles.dayName}>{words.dayName(date)}</span>
                <span className={styles.dayNumber}>{words.dayNumber(date)}</span>
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
          <DatePicker
            size="sm"
            aria-label="Pick another day"
            placeholder="Pick a date"
            value={inStrip ? '' : (draft.date ?? '')}
            onValueChange={(date) => setDraft({ ...draft, date })}
            min={minDate}
            max={maxDate}
            today={today}
            locale={locale}
            quickPicks={false}
            disabled={disabled}
            className={styles.picker}
          />
        </div>
      )}
      {field.kind !== 'date' && (
        <div className={styles.timeRow}>
          {slots.length > 0 && (
            <ToggleGroup.Root
              type="single"
              aria-label="Time"
              aria-describedby={labelledBy}
              value={draft.time ?? ''}
              onValueChange={(time) => {
                if (time) setDraft({ ...draft, time });
              }}
              disabled={disabled}
              loop
              className={styles.slots}
            >
              {slots.map((time) => (
                <ToggleGroup.Item key={time} value={time} data-lustre="" className={styles.slot}>
                  {words.time(time)}
                </ToggleGroup.Item>
              ))}
            </ToggleGroup.Root>
          )}
          <span id={`${id}-exact`} className={styles.srOnly}>
            Another time
          </span>
          <TimePicker
            size="sm"
            aria-labelledby={`${id}-exact`}
            value={draft.time ?? timeOf(field.suggested) ?? slots[0] ?? '09:00'}
            onValueChange={(time) => setDraft({ ...draft, time })}
            minuteStep={15}
            locale={locale}
            disabled={disabled}
            className={styles.picker}
          />
        </div>
      )}
    </div>
  );
}
