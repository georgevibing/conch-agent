/**
 * Reading a `Question`'s answer (ADR 0060): what each kind of field takes,
 * and how an answer reads as a sentence. The gateway checks every answer
 * with these and writes its `text` itself, so the chat says what was really
 * chosen; the web uses the same words to fold the card before the gateway
 * replies.
 */
import type { Question, QuestionField, QuestionValue } from './chat-cards';

/** `YYYY-MM-DD`, `HH:MM` (24-hour) and `YYYY-MM-DDTHH:MM`: wall-clock, no zone. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/;

type TimeKind = 'date' | 'time' | 'datetime';

const realDate = (value: string): boolean => {
  const m = DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
};

/**
 * A date or time as a field of `kind` takes it, from whatever the assistant
 * wrote (`2026-10-09`, `2026-10-09T10:00:00+02:00`, `10:00`): the wall-clock
 * parts, or `undefined` when there's nothing usable.
 */
export function normaliseWhen(kind: TimeKind, raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = raw.trim();
  const date = /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
  const time = /(?:^|T|\s)(\d{2}):(\d{2})/.exec(text);
  const hhmm = time ? `${time[1]}:${time[2]}` : undefined;
  if (kind === 'date') return date && realDate(date) ? date : undefined;
  if (kind === 'time') return hhmm && TIME.test(hhmm) ? hhmm : undefined;
  if (!date || !realDate(date)) return undefined;
  return `${date}T${hhmm && TIME.test(hhmm) ? hhmm : '09:00'}`;
}

function validWhen(kind: TimeKind, value: string): boolean {
  if (kind === 'date') return realDate(value);
  if (kind === 'time') return TIME.test(value);
  const m = DATETIME.exec(value);
  return Boolean(m?.[1] && realDate(m[1]));
}

/** Monday 9 Oct, in the gateway's and the web's words alike (English, as the app is). */
function dayWords(value: string, now: Date): string {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  const words = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    ...(y !== now.getFullYear() && { year: 'numeric' }),
  }).format(at);
  // en-GB writes "Thursday 9 Oct" (and "Thursday, 9 Oct" in some versions): keep it plain.
  return words.replace(',', '');
}

const optionLabel = (field: Extract<QuestionField, { kind: 'choice' }>, value: string) =>
  field.options.find((o) => o.id === value)?.label ?? value;

/** One field's value as words: "Video call", "Thursday 9 Oct, 10:00", "3 people". */
export function valueText(field: QuestionField, value: QuestionValue, now = new Date()): string {
  switch (field.kind) {
    case 'choice':
      return (Array.isArray(value) ? value : [String(value)])
        .map((v) => optionLabel(field, v))
        .join(', ');
    case 'date':
      return dayWords(String(value), now);
    case 'time':
      return String(value);
    case 'datetime': {
      const [day, time] = String(value).split('T');
      return `${dayWords(day ?? '', now)}, ${time ?? ''}`;
    }
    case 'number':
      return `${String(value)}${field.unit ? ` ${field.unit}` : ''}`;
    case 'text':
      return String(value).trim();
  }
}

/** The whole answer as one sentence, fields in the question's order: "Thursday 9 Oct, 10:00 · Video call". */
export function answerText(
  question: Pick<Question, 'fields'>,
  values: Readonly<Record<string, QuestionValue>>,
  now = new Date(),
): string {
  return question.fields
    .flatMap((field) => {
      const value = values[field.id];
      return value === undefined ? [] : [valueText(field, value, now)];
    })
    .filter(Boolean)
    .join(' · ')
    .slice(0, 4000);
}

const empty = (value: QuestionValue | undefined) =>
  value === undefined ||
  (typeof value === 'string' && !value.trim()) ||
  (Array.isArray(value) && value.length === 0);

export type AnswerCheck =
  { ok: true; values: Record<string, QuestionValue> } | { ok: false; message: string };

/**
 * Whether `values` answers `question`: every value fits its field's kind
 * (an option that exists, several only where several are allowed, a date
 * that parses, a number in range), and nothing required is missing. The
 * values come back tidied (trimmed text, one choice as a string).
 */
export function checkAnswer(
  question: Pick<Question, 'fields'>,
  values: Readonly<Record<string, QuestionValue>>,
): AnswerCheck {
  const fail = (message: string): AnswerCheck => ({ ok: false, message });
  const fields = new Map(question.fields.map((f) => [f.id, f]));
  for (const key of Object.keys(values))
    if (!fields.has(key)) return fail(`“${key}” isn’t part of this question.`);
  const out: Record<string, QuestionValue> = {};
  for (const field of question.fields) {
    const value = values[field.id];
    if (empty(value)) {
      if (!field.optional) return fail(`“${field.label}” needs an answer.`);
      continue;
    }
    const v = value as QuestionValue;
    switch (field.kind) {
      case 'choice': {
        const picked = Array.isArray(v) ? v : typeof v === 'string' ? [v] : undefined;
        if (!picked) return fail(`Choose an option for “${field.label}”.`);
        if (picked.length > 1 && !field.multiple)
          return fail(`Choose one option for “${field.label}”.`);
        const ids = new Set(field.options.map((o) => o.id));
        const tidy = [...new Set(picked.map((p) => (ids.has(p) ? p : p.trim())))].filter(Boolean);
        const typed = tidy.filter((p) => !ids.has(p));
        if (typed.length && !field.other)
          return fail(`That isn’t one of the options for “${field.label}”.`);
        if (typed.length > 1) return fail(`Write one other answer for “${field.label}”.`);
        if (typed.some((t) => t.length > 200))
          return fail(`Keep the answer for “${field.label}” shorter.`);
        if (!tidy.length) return fail(`Choose an option for “${field.label}”.`);
        out[field.id] = field.multiple ? tidy : (tidy[0] as string);
        break;
      }
      case 'date':
      case 'time':
      case 'datetime': {
        if (typeof v !== 'string' || !validWhen(field.kind, v))
          return fail(`“${field.label}” needs a ${field.kind === 'time' ? 'time' : 'date'}.`);
        const min = normaliseWhen(field.kind, field.min);
        const max = normaliseWhen(field.kind, field.max);
        if (min && v < min) return fail(`“${field.label}” is too early.`);
        if (max && v > max) return fail(`“${field.label}” is too late.`);
        out[field.id] = v;
        break;
      }
      case 'number': {
        if (typeof v !== 'number' || !Number.isFinite(v))
          return fail(`“${field.label}” needs a number.`);
        if (field.min !== undefined && v < field.min)
          return fail(`“${field.label}” must be at least ${field.min}.`);
        if (field.max !== undefined && v > field.max)
          return fail(`“${field.label}” must be at most ${field.max}.`);
        out[field.id] = v;
        break;
      }
      case 'text': {
        if (typeof v !== 'string') return fail(`“${field.label}” needs words.`);
        const text = field.multiline ? v.trim() : v.replace(/\s+/g, ' ').trim();
        if (text.length > 4000) return fail(`Keep the answer for “${field.label}” shorter.`);
        out[field.id] = text;
        break;
      }
    }
  }
  return { ok: true, values: out };
}
