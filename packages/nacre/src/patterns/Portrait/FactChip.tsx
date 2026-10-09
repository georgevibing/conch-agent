import { Sparkle } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';

import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { cx } from '../../utils/cx';
import styles from './Portrait.module.css';

/** How long a chip takes to fold away (`--nc-panel-out-duration`), before it's gone. */
export const FACT_LEAVE_MS = 200;

export interface FactEditorProps {
  /** What the words are, as a field's name: the group they go in ("People"). */
  label: string;
  placeholder?: string;
  /** A second field for a detail (people: "Who they are to you"). */
  detailLabel?: string;
  detailExample?: string;
  /** The fact being corrected; nothing, for a new one. */
  initial?: { text: string; detail?: string };
  submitLabel: string;
  /** The longest the words may be. */
  maxLength?: number;
  onSubmit: (text: string, detail: string | undefined) => void;
  onCancel: () => void;
  /** With this, a quiet Remove sits at the start of the row. */
  onRemove?: () => void;
  className?: string;
}

/**
 * The words of a fact, open to change, in place: one field (two for a
 * person), Enter keeps it, Escape leaves it as it was. Its first field has the
 * focus the moment it opens, since a press just asked for it.
 */
export function FactEditor({
  label,
  placeholder,
  detailLabel,
  detailExample,
  initial,
  submitLabel,
  maxLength = 160,
  onSubmit,
  onCancel,
  onRemove,
  className,
}: FactEditorProps) {
  const [text, setText] = useState(initial?.text ?? '');
  const [detail, setDetail] = useState(initial?.detail ?? '');
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const escape = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSubmit(t, detail.trim() || undefined);
  };
  return (
    <form
      className={cx(styles.form, className)}
      onSubmit={submit}
      aria-label={initial ? `Change “${initial.text}”` : `Add to ${label}`}
    >
      <div className={styles.fields}>
        <Input
          ref={first}
          size="sm"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={escape}
          placeholder={placeholder}
          aria-label={label}
          maxLength={maxLength}
          rootClassName={styles.field}
        />
        {detailLabel && (
          <Input
            size="sm"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onKeyDown={escape}
            placeholder={detailExample}
            aria-label={detailLabel}
            maxLength={160}
            rootClassName={styles.field}
          />
        )}
      </div>
      <div className={styles.formActions}>
        {onRemove && (
          <Button size="sm" variant="ghost" tone="danger" onClick={onRemove}>
            Remove
          </Button>
        )}
        <span className={styles.spacer} />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!text.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export interface FactChipProps {
  text: string;
  /** Beside it, quieter: who a person is to you, a date. */
  detail?: string;
  /**
   * Learned from a chat rather than told: a small spark before the words, and
   * said in words to a screen reader — never colour alone.
   */
  learned?: boolean;
  /** Where it came from, shown while it's open: “Learned from a chat on 3 May”. */
  source?: ReactNode;
  /** Beside where it came from, one way there: “Open the chat”. */
  sourceAction?: { label: string; onSelect: () => void };
  /** It just arrived (told, kept, added): it surfaces, and one band of pearl light crosses it. */
  arriving?: boolean;
  /** The group it's in, as the field's name when it opens ("People"). */
  label: string;
  placeholder?: string;
  detailLabel?: string;
  detailExample?: string;
  /** The longest its words may be (a memory may run longer than a card's fact). */
  maxLength?: number;
  onSave: (text: string, detail: string | undefined) => void;
  /** Called once it has folded away. */
  onRemove: () => void;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
}

/**
 * One thing about you, as a chip you can press. Pressed, it opens where it is
 * into its own words, ready to correct, with where it came from underneath and
 * a quiet Remove; Escape closes it as it was, and the focus comes back to it.
 * Removed, it folds away before it goes. A chip that just arrived surfaces with
 * a glint, the same light a panel carries; reduced motion just shows it.
 */
export function FactChip({
  text,
  detail,
  learned = false,
  source,
  sourceAction,
  arriving = false,
  label,
  placeholder,
  detailLabel,
  detailExample,
  maxLength,
  onSave,
  onRemove,
  ref,
  className,
}: FactChipProps) {
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const chip = useRef<HTMLButtonElement | null>(null);
  const comeBack = useRef(false);
  const fold = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(fold.current), []);

  // Closing the words puts the focus back on the chip they came from.
  useEffect(() => {
    if (editing || !comeBack.current) return;
    comeBack.current = false;
    chip.current?.focus();
  }, [editing]);

  const close = () => {
    comeBack.current = true;
    setEditing(false);
  };

  if (editing)
    return (
      <div className={cx(styles.opened, className)} data-learned={learned || undefined}>
        <FactEditor
          label={label}
          placeholder={placeholder}
          detailLabel={detailLabel}
          detailExample={detailExample}
          maxLength={maxLength}
          initial={{ text, ...(detail && { detail }) }}
          submitLabel="Save"
          onSubmit={(t, d) => {
            onSave(t, d);
            close();
          }}
          onCancel={close}
          onRemove={() => {
            setEditing(false);
            setLeaving(true);
            // The fold plays first; then it's gone.
            fold.current = setTimeout(onRemove, FACT_LEAVE_MS);
          }}
        />
        {source && (
          <p className={styles.source}>
            {learned && <Sparkle aria-hidden />}
            <span>{source}</span>
            {sourceAction && (
              <Button
                size="sm"
                variant="ghost"
                className={styles.sourceAction}
                onClick={sourceAction.onSelect}
              >
                {sourceAction.label}
              </Button>
            )}
          </p>
        )}
      </div>
    );

  const name = [text, detail, learned && 'learned from your chats'].filter(Boolean).join(', ');
  return (
    <button
      ref={(el) => {
        chip.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      type="button"
      className={cx(styles.chip, className)}
      data-lustre=""
      data-learned={learned || undefined}
      data-arriving={arriving || undefined}
      data-leaving={leaving || undefined}
      aria-label={name}
      disabled={leaving}
      onClick={() => setEditing(true)}
    >
      {learned && <Sparkle className={styles.spark} aria-hidden />}
      <span className={styles.chipText}>
        <span className={styles.chipWords}>{text}</span>
        {detail && <span className={styles.chipDetail}>{detail}</span>}
      </span>
      {arriving && <span className={styles.glint} aria-hidden />}
    </button>
  );
}
