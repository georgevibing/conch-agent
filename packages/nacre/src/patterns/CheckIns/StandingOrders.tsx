import { Check, Pencil, Plus, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { cx } from '../../utils/cx';
import styles from './StandingOrders.module.css';

/*
 * Standing orders (ADR 0107): what you said once, in your own words, for every
 * chat and every check-in. "Tell me" ones are what the check-in watches for;
 * "You may" ones are what you welcome. Neither is a permission, and a line says
 * so beside any that reaches for one.
 */

export type StandingOrderKindName = 'tell' | 'may';

export const standingOrderKindLabels: Record<StandingOrderKindName, string> = {
  tell: 'Tell me',
  may: 'You may',
};

export interface StandingOrderItem {
  id: string;
  /** The person's words. */
  text: string;
  kind: StandingOrderKindName;
  /** `draft`: the assistant suggested it in a chat; Keep it or Not now. */
  state: 'on' | 'off' | 'draft';
  /** It reaches for a power an order can't give: `powerNote` shows beside it. */
  power?: boolean;
  /** “Told you 3 times · last yesterday”. */
  meta?: ReactNode;
}

/** The little label for what kind an order is. */
export function StandingOrderKind({
  kind,
  className,
  ...props
}: { kind: StandingOrderKindName } & ComponentProps<'span'>) {
  return (
    <span className={cx(styles.kind, className)} data-kind={kind} {...props}>
      {standingOrderKindLabels[kind]}
    </span>
  );
}

export interface StandingOrderListProps extends Omit<ComponentProps<'section'>, 'children'> {
  items: StandingOrderItem[];
  /** Add one in your words. A promise keeps the field busy until it settles. */
  onAdd?: (text: string) => unknown;
  /** Change one's words. */
  onSave?: (id: string, text: string) => unknown;
  onRemove?: (id: string) => void;
  /** Keep a suggestion from a chat. */
  onKeep?: (id: string) => void;
  /** The id being worked on. */
  busy?: string;
  /** What kind new words would be, shown as you type (Conch reads it from the words). */
  kindOf?: (text: string) => StandingOrderKindName;
  /** Whether new words reach for a power, shown as you type. */
  powerOf?: (text: string) => boolean;
  /** What's said beside one that reaches for a power. */
  powerNote: string;
  /** A refusal from the last add or save, in a sentence. */
  problem?: string;
  /** Ideas for the empty field, one at a time. */
  examples?: readonly string[];
}

const EXAMPLES = [
  'Always tell me if a flight changes',
  'Tell me when my parcel is out for delivery',
  'You may archive newsletters',
] as const;

/** Changing one's words: Enter saves, Escape leaves them as they were. */
function EditForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  onSave?: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  // The person pressed Edit: the words go where their hands are.
  useEffect(() => input.current?.focus(), []);
  const save = (event: FormEvent) => {
    event.preventDefault();
    const words = text.trim();
    if (!words || words === initial) return onCancel();
    onSave?.(words);
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <form className={styles.edit} onSubmit={save}>
      <Input
        ref={input}
        size="sm"
        value={text}
        maxLength={240}
        aria-label="Standing order"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={keys}
      />
      <Button size="sm" type="submit" loading={busy}>
        Save
      </Button>
      <Button size="sm" variant="ghost" tone="neutral" type="button" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function Row({
  item,
  editing,
  onEdit,
  onCancel,
  onSave,
  onRemove,
  onKeep,
  busy,
  powerNote,
}: {
  item: StandingOrderItem;
  editing: boolean;
  onEdit?: () => void;
  onCancel: () => void;
  onSave?: (text: string) => void;
  onRemove?: () => void;
  onKeep?: () => void;
  busy: boolean;
  powerNote: string;
}) {
  const noteId = useId();
  return (
    <li className={styles.row} data-state={item.state} aria-busy={busy || undefined}>
      <StandingOrderKind kind={item.kind} />
      {editing ? (
        <EditForm initial={item.text} busy={busy} onCancel={onCancel} {...(onSave && { onSave })} />
      ) : (
        <div className={styles.words}>
          <span className={styles.text} {...(item.power && { 'aria-describedby': noteId })}>
            {item.text}
          </span>
          {item.state === 'draft' && <span className={styles.meta}>Suggested in a chat</span>}
          {item.meta && item.state !== 'draft' && <span className={styles.meta}>{item.meta}</span>}
          {item.power && (
            <span id={noteId} className={styles.power}>
              {powerNote}
            </span>
          )}
        </div>
      )}
      {!editing && (
        <div className={styles.actions}>
          {item.state === 'draft' && onKeep && (
            <Button
              size="sm"
              variant="soft"
              leadingIcon={<Check />}
              loading={busy}
              onClick={onKeep}
            >
              Keep it
            </Button>
          )}
          {onEdit && item.state !== 'draft' && (
            <IconButton
              label={`Change “${item.text}”`}
              size="sm"
              variant="ghost"
              tone="neutral"
              onClick={onEdit}
            >
              <Pencil />
            </IconButton>
          )}
          {onRemove && (
            <IconButton
              label={item.state === 'draft' ? `Not now: “${item.text}”` : `Remove “${item.text}”`}
              size="sm"
              variant="ghost"
              tone="neutral"
              onClick={onRemove}
            >
              <X />
            </IconButton>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Your standing orders, in your words: add one by typing it, change or remove
 * any, keep one a chat suggested. As you type, a label says whether Conch reads
 * it as something to tell you or something you welcome, and a line says so
 * when the words reach for a permission an order can't give.
 */
export function StandingOrderList({
  items,
  onAdd,
  onSave,
  onRemove,
  onKeep,
  busy,
  kindOf,
  powerOf,
  powerNote,
  problem,
  examples = EXAMPLES,
  className,
  ...props
}: StandingOrderListProps) {
  const [text, setText] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string>();
  const [example, setExample] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const words = text.trim();
  const kind = words && kindOf ? kindOf(words) : undefined;
  const reaches = Boolean(words && powerOf?.(words));

  // A new idea in the empty field now and then, never while someone types.
  useEffect(() => {
    if (text || examples.length < 2) return;
    const timer = setInterval(() => setExample((i) => (i + 1) % examples.length), 4_000);
    return () => clearInterval(timer);
  }, [text, examples.length]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!words || !onAdd) return;
    setAdding(true);
    try {
      await onAdd(words);
      setText('');
    } catch {
      // The refusal is the caller's `problem`; the words stay to change.
    } finally {
      setAdding(false);
      field.current?.focus();
    }
  };

  return (
    <section className={cx(styles.list, className)} aria-label="Standing orders" {...props}>
      {items.length > 0 && (
        <ul className={styles.rows}>
          {items.map((item) => (
            <Row
              key={item.id}
              item={item}
              editing={editing === item.id}
              {...(onSave && { onEdit: () => setEditing(item.id) })}
              onCancel={() => setEditing(undefined)}
              {...(onSave && {
                onSave: (t: string) => {
                  void Promise.resolve(onSave(item.id, t)).then(() => setEditing(undefined));
                },
              })}
              {...(onRemove && { onRemove: () => onRemove(item.id) })}
              {...(onKeep && { onKeep: () => onKeep(item.id) })}
              busy={busy === item.id}
              powerNote={powerNote}
            />
          ))}
        </ul>
      )}
      {onAdd && (
        <form className={styles.add} onSubmit={(e) => void add(e)}>
          <Input
            ref={field}
            value={text}
            maxLength={240}
            aria-label="A new standing order, in your words"
            aria-describedby={hintId}
            placeholder={examples[example] ?? ''}
            leading={<Plus aria-hidden />}
            trailing={kind ? <StandingOrderKind kind={kind} aria-hidden /> : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          <Button type="submit" variant="soft" disabled={!words} loading={adding}>
            Add
          </Button>
        </form>
      )}
      <p id={hintId} className={styles.hint} aria-live="polite">
        {problem ??
          (reaches
            ? powerNote
            : kind === 'may'
              ? 'Conch reads this as something you welcome. It still asks where your permission mode does.'
              : kind === 'tell'
                ? 'Conch reads this as something to tell you about. The check-in watches for it.'
                : 'Say it the way you would to a person. Every chat keeps it in mind.')}
      </p>
    </section>
  );
}

export interface StandingOrderOfferProps extends Omit<ComponentProps<'section'>, 'children'> {
  text: string;
  kind: StandingOrderKindName;
  power?: boolean;
  powerNote: string;
  /** `offered`: Keep it / Not now. Then a quiet line. */
  state: 'offered' | 'kept' | 'dismissed';
  onKeep?: () => void;
  onDismiss?: () => void;
  /** See every standing order. */
  onOpen?: () => void;
  busy?: boolean;
}

/**
 * The card the assistant's suggestion leaves in a chat: your words in quotes,
 * what kind they are, Keep it and Not now. Kept, it settles into one quiet
 * line with a check that draws itself; nothing is kept until you press.
 */
export function StandingOrderOffer({
  text,
  kind,
  power,
  powerNote,
  state,
  onKeep,
  onDismiss,
  onOpen,
  busy,
  className,
  ...props
}: StandingOrderOfferProps) {
  if (state !== 'offered')
    return (
      <section
        className={cx(styles.settled, className)}
        data-state={state}
        aria-label="Standing order"
        {...props}
      >
        {state === 'kept' ? (
          <svg className={styles.tick} viewBox="0 0 16 16" aria-hidden>
            <path d="M3.5 8.5l3 3 6-7" />
          </svg>
        ) : (
          <X aria-hidden className={styles.cross} />
        )}
        <span className={styles.settledText}>
          {state === 'kept' ? 'Kept as a standing order: ' : 'Not kept: '}
          <q>{text}</q>
        </span>
        {onOpen && state === 'kept' && (
          <Button size="sm" variant="ghost" tone="neutral" onClick={onOpen}>
            See all
          </Button>
        )}
      </section>
    );
  return (
    <section
      className={cx(styles.offer, className)}
      aria-label="Keep this as a standing order?"
      {...props}
    >
      <header className={styles.offerHead}>
        <span className={styles.eyebrow}>Keep this as a standing order?</span>
        <StandingOrderKind kind={kind} />
      </header>
      <blockquote className={styles.quote}>{text}</blockquote>
      <p className={styles.offerNote}>
        {power
          ? powerNote
          : kind === 'tell'
            ? 'Every chat keeps it in mind, and the check-in tells you when it sees one.'
            : 'Every chat keeps it in mind. It still asks where your permission mode does.'}
      </p>
      <div className={styles.offerActions}>
        <Button size="sm" leadingIcon={<Check />} loading={busy} onClick={onKeep}>
          Keep it
        </Button>
        <Button size="sm" variant="ghost" tone="neutral" disabled={busy} onClick={onDismiss}>
          Not now
        </Button>
      </div>
    </section>
  );
}
