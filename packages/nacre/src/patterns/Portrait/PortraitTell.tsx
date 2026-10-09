import { Check, ChevronDown, MessageCircleHeart } from 'lucide-react';
import { useEffect, useState, type FormEvent, type Ref } from 'react';

import { DropdownMenu } from '../../components/DropdownMenu';
import { Input } from '../../components/Input';
import { cx } from '../../utils/cx';
import styles from './Portrait.module.css';

export interface PortraitTellProps {
  /** Where a fact can go: each group's kind and name. */
  groups: { kind: string; title: string }[];
  /** The group the words sound like they belong to, read as they're typed. */
  guess: (text: string) => string;
  /** Enter: the words become a fact in that group. */
  onTell: (text: string, kind: string) => void;
  /** Who's listening, by name. */
  assistant?: string;
  ref?: Ref<HTMLInputElement>;
  className?: string;
}

/** How long “Added to People” stays before the line is quiet again. */
const SAID_MS = 4000;

/**
 * One line to tell the assistant something about you, the way you'd say it.
 * As you type, the group it'll go in shows at the end of the field — pressed,
 * it's a choice of the others — and Enter turns the words into a fact there,
 * with a quiet “Added to People” under it. Nothing to fill in first.
 */
export function PortraitTell({
  groups,
  guess,
  onTell,
  assistant = 'Conch',
  ref,
  className,
}: PortraitTellProps) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const typed = text.trim();
  const kind = chosen ?? (typed ? guess(typed) : undefined);
  const group = groups.find((g) => g.kind === kind) ?? groups[0];

  useEffect(() => {
    if (!said) return;
    const timer = setTimeout(() => setSaid(''), SAID_MS);
    return () => clearTimeout(timer);
  }, [said]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!typed || !group) return;
    onTell(typed, group.kind);
    setSaid(`Added to ${group.title}.`);
    setText('');
    setChosen(null);
  };

  const label = `Tell ${assistant} something about you`;
  return (
    <form className={cx(styles.tell, className)} onSubmit={submit} aria-label={label}>
      <Input
        ref={ref}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (!e.target.value.trim()) setChosen(null);
        }}
        placeholder={`${label}…`}
        aria-label={label}
        maxLength={160}
        enterKeyHint="done"
        leading={<MessageCircleHeart />}
        trailing={
          typed && group ? (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className={styles.destination}
                  aria-label={`Goes in ${group.title}. Put it somewhere else`}
                >
                  <span className={styles.destinationName}>{group.title}</span>
                  <ChevronDown aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                <DropdownMenu.Label>Put it in</DropdownMenu.Label>
                <DropdownMenu.RadioGroup value={group.kind} onValueChange={setChosen}>
                  {groups.map((g) => (
                    <DropdownMenu.RadioItem key={g.kind} value={g.kind}>
                      {g.title}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          ) : undefined
        }
      />
      <p className={styles.said} aria-live="polite">
        {said && (
          <>
            <Check aria-hidden />
            {said}
          </>
        )}
      </p>
    </form>
  );
}
