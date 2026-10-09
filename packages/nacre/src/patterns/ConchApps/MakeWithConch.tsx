import { Sparkles } from 'lucide-react';
import { useId, useState, type ComponentProps, type FormEvent } from 'react';

import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { cx } from '../../utils/cx';
import styles from './MakeWithConch.module.css';

export interface MakeWithConchProps extends Omit<ComponentProps<'form'>, 'children' | 'onSubmit'> {
  /** The question, as a label: “Which provider?”, “Which chat app?”. */
  question: string;
  /** One sentence on what happens next, under the box. */
  note: string;
  placeholder?: string;
  /** A few names that fill the box, as chips. */
  examples?: readonly string[];
  /** The button's words: “Make it with Conch”. */
  action?: string;
  /** Starts the chat that makes it, with what was typed. */
  onMake: (text: string) => void;
  busy?: boolean;
}

/**
 * **Make one with Conch** (ADR 0122): a provider or a chat app nobody has
 * added yet, from its name. Conch reads its own documentation, writes it,
 * tests it with your key, and shows a card; nothing is added until the
 * person presses **Add**. One line, a few names to tap, one button.
 */
export function MakeWithConch({
  question,
  note,
  placeholder,
  examples = [],
  action = 'Make it with Conch',
  onMake,
  busy,
  className,
  ...props
}: MakeWithConchProps) {
  const boxId = useId();
  const noteId = useId();
  const [value, setValue] = useState('');
  const text = value.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text && !busy) onMake(text);
  };
  return (
    <form className={cx(styles.maker, className)} onSubmit={submit} data-lustre="" {...props}>
      <div className={styles.head}>
        <span className={styles.mark} aria-hidden>
          <Sparkles />
        </span>
        <label htmlFor={boxId} className={styles.question}>
          {question}
        </label>
      </div>
      <div className={styles.row}>
        <Input
          id={boxId}
          size="md"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          maxLength={200}
          autoComplete="off"
          aria-describedby={noteId}
          className={styles.box}
        />
        <Button type="submit" leadingIcon={<Sparkles />} disabled={!text} loading={busy}>
          {action}
        </Button>
      </div>
      {examples.length > 0 && (
        <div role="group" aria-label="For example" className={styles.examples}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className={styles.example}
              aria-pressed={value === example}
              onClick={() => setValue(example)}
              disabled={busy}
            >
              {example}
            </button>
          ))}
        </div>
      )}
      <p id={noteId} className={styles.note}>
        {note}
      </p>
    </form>
  );
}
