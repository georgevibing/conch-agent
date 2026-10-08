import { Lock, X } from 'lucide-react';
import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

import { Avatar } from '../../components/Avatar';
import wellStyles from '../../components/Input/Input.module.css';
import { cx } from '../../utils/cx';
import styles from './Mail.module.css';
import { isAddress, nameOf, type MailPerson } from './people';

/**
 * Someone the email goes to, as a chip: their initials, their name when the
 * thread gave one, and always their address — on an approval nobody should
 * have to guess where words are going.
 */
export function RecipientChip({ person, onRemove }: { person: MailPerson; onRemove?: () => void }) {
  const named = person.name && person.name !== person.address;
  return (
    <li className={styles.chip} data-removable={onRemove ? '' : undefined}>
      <Avatar name={nameOf(person)} size="xs" className={styles.chipFace} aria-hidden />
      {named && <span className={styles.chipName}>{person.name}</span>}
      <span className={named ? styles.chipAddress : styles.chipName}>{person.address}</span>
      {onRemove && (
        <button
          type="button"
          className={styles.chipRemove}
          onClick={onRemove}
          aria-label={`Remove ${person.address}`}
        >
          <X aria-hidden />
        </button>
      )}
    </li>
  );
}

export interface RecipientFieldProps {
  /** "To", "Cc": the row's label, and its name for screen readers. */
  label: string;
  people: readonly MailPerson[];
  /** Editing: add with Enter, a comma or a space, remove with × or Backspace. */
  onChange?: (people: MailPerson[]) => void;
  /** A reply's people are the thread's: shown, never changed. */
  locked?: string;
  /** Say so when nobody is left (To needs someone). */
  required?: boolean;
}

/** Split what was typed or pasted into addresses: commas, semicolons, spaces, `<…>`. */
const split = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((part) => part.replace(/^<|>$/g, '').trim())
    .filter(Boolean);

/**
 * Who it goes to, one row: chips to read, or, while editing, chips with ×
 * and a line to add someone. An address that isn't one stays in the line
 * with a word about it, so nothing typed is lost.
 */
export function RecipientField({ label, people, onChange, locked, required }: RecipientFieldProps) {
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const hint = useId();
  const editing = Boolean(onChange) && !locked;

  /** Adds what was typed; keeps whatever isn't an address in the line, and says why. */
  const commit = (text = draft) => {
    const parts = split(text);
    if (!parts.length) {
      setDraft('');
      setProblem(undefined);
      return true;
    }
    const good = parts.filter(isAddress);
    const bad = parts.filter((p) => !isAddress(p));
    const known = new Set(people.map((p) => p.address.toLowerCase()));
    const added = good.filter((a, i) => !known.has(a.toLowerCase()) && good.indexOf(a) === i);
    if (added.length) onChange?.([...people, ...added.map((address) => ({ address }))]);
    setDraft(bad.join(' '));
    setProblem(bad.length ? `“${bad[0]}” isn’t an email address.` : undefined);
    return bad.length === 0;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === ';' || event.key === ' ') {
      if (!draft.trim()) {
        if (event.key !== 'Enter') event.preventDefault();
        return;
      }
      // ⌘/Ctrl+Enter is the card's (Send): add what's there first, and let it through.
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        commit();
        return;
      }
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && !draft && people.length) {
      event.preventDefault();
      onChange?.(people.slice(0, -1));
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!/[\s,;]/.test(text.trim())) return;
    event.preventDefault();
    commit(`${draft} ${text}`);
  };

  const empty = required && editing && people.length === 0 && !draft;
  return (
    <div className={styles.field} data-editing={editing || undefined}>
      <span className={styles.fieldLabel} id={`${hint}-label`}>
        {label}
      </span>
      <div className={styles.fieldValue}>
        {editing ? (
          // The line to add someone fills the rest of the well, so a press on it lands there.
          <div
            className={cx(wellStyles.well, styles.recipientWell)}
            data-size="sm"
            data-invalid={problem || empty ? '' : undefined}
          >
            <ul className={styles.chips} aria-labelledby={`${hint}-label`}>
              {people.map((person, i) => (
                <RecipientChip
                  key={person.address}
                  person={person}
                  onRemove={() => {
                    onChange?.(people.filter((_, j) => j !== i));
                    input.current?.focus();
                  }}
                />
              ))}
            </ul>
            <input
              ref={input}
              className={styles.recipientInput}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (problem) setProblem(undefined);
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onBlur={() => commit()}
              placeholder={people.length ? 'Add someone' : 'Add an email address'}
              aria-label={`Add someone to ${label}`}
              aria-invalid={problem || empty ? true : undefined}
              aria-describedby={problem || empty ? `${hint}-problem` : undefined}
              autoComplete="email"
              inputMode="email"
              spellCheck={false}
            />
          </div>
        ) : (
          <ul className={styles.chips} aria-label={label}>
            {people.map((person) => (
              <RecipientChip key={person.address} person={person} />
            ))}
          </ul>
        )}
        {locked && onChange && (
          <p className={styles.fieldNote}>
            <Lock aria-hidden />
            {locked}
          </p>
        )}
        {(problem || empty) && (
          <p className={styles.fieldProblem} id={`${hint}-problem`} role="status">
            {problem ?? 'Add who it goes to.'}
          </p>
        )}
      </div>
    </div>
  );
}
