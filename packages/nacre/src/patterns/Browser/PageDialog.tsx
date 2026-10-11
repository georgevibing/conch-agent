import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import styles from './Browser.module.css';

/** A page's own dialog: a message, a question, a box for text, or "Leave this page?". */
export interface BrowserWindowDialog {
  id: string;
  kind: 'alert' | 'confirm' | 'prompt' | 'leave';
  /** The site's words, drawn as plain text. */
  message: string;
  /** A text box's starting text. */
  value?: string;
  /** Whose question it is: the page's host. */
  site: string;
}

/**
 * The page asks you something while you drive (ADR 0131): drawn by Conch over
 * the page, which waits for the answer, under the site's name, so its words
 * can't pass for Conch's own. Enter is OK, Escape is Cancel.
 */
export function PageDialog({
  dialog,
  onAnswer,
}: {
  dialog: BrowserWindowDialog;
  onAnswer: (accept: boolean, text?: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(dialog.value ?? '');
  const leave = dialog.kind === 'leave';
  const box = useRef<HTMLDivElement | null>(null);
  const answer = useRef(onAnswer);
  useEffect(() => {
    answer.current = onAnswer;
  }, [onAnswer]);
  // Escape anywhere in it is the page's Cancel, not the panel's: nothing behind it closes.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      answer.current(dialog.kind === 'alert');
    };
    el.addEventListener('keydown', onKeyDown);
    return () => el.removeEventListener('keydown', onKeyDown);
  }, [dialog.kind]);
  return (
    <div
      ref={box}
      className={styles.pageDialog}
      role="alertdialog"
      aria-labelledby={`${id}-site`}
      aria-describedby={`${id}-message`}
    >
      <form
        className={styles.pageDialogForm}
        onSubmit={(event) => {
          event.preventDefault();
          onAnswer(true, dialog.kind === 'prompt' ? text : undefined);
        }}
      >
        <p id={`${id}-site`} className={styles.pageDialogSite}>
          {leave ? `Leave ${dialog.site}?` : `${dialog.site} says`}
        </p>
        <p id={`${id}-message`} className={styles.pageDialogMessage}>
          {leave ? 'Changes you made may not be saved.' : dialog.message}
        </p>
        {dialog.kind === 'prompt' && (
          <Input
            size="sm"
            aria-label="Your answer"
            value={text}
            onChange={(event) => setText(event.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the page is waiting for this answer
            autoFocus
          />
        )}
        <div className={styles.pageDialogActions}>
          {dialog.kind !== 'alert' && (
            <Button type="button" size="sm" variant="ghost" onClick={() => onAnswer(false)}>
              {leave ? 'Stay' : 'Cancel'}
            </Button>
          )}
          {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the page is waiting for this answer */}
          <Button type="submit" size="sm" autoFocus={dialog.kind !== 'prompt'}>
            {leave ? 'Leave' : 'OK'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** What find on page found: how many, and which one shows (1-based; 0: none). */
export interface BrowserWindowFound {
  text: string;
  matches: number;
  current: number;
}

/**
 * Find on page (ADR 0131), as in any browser: the words are looked for as you
 * type, Enter goes to the next one (Shift+Enter the one before), Escape closes.
 */
export function FindBar({
  found,
  onFind,
  onClose,
}: {
  found?: BrowserWindowFound;
  onFind: (text: string, direction?: 'next' | 'previous') => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const latest = useRef(onFind);
  useEffect(() => {
    latest.current = onFind;
  }, [onFind]);
  const said = useRef('');
  // Looked for as you type, once you pause.
  useEffect(() => {
    if (text === said.current) return;
    const timer = setTimeout(() => {
      said.current = text;
      latest.current(text);
    }, 160);
    return () => clearTimeout(timer);
  }, [text]);
  const current = found && text && found.text === text ? found : undefined;
  const count = current
    ? current.matches
      ? `${current.current} of ${current.matches}`
      : 'None'
    : '';
  const move = (direction: 'next' | 'previous') => {
    if (!text) return;
    if (text !== said.current) {
      said.current = text;
      latest.current(text);
    } else latest.current(text, direction);
  };
  return (
    <div className={styles.findBar} role="search" aria-label="Find on page">
      <Input
        size="sm"
        aria-label="Find on page"
        placeholder="Find on page"
        value={text}
        rootClassName={styles.findInput}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setText(event.target.value)}
        // eslint-disable-next-line jsx-a11y/no-autofocus -- opened on purpose to type
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            move(event.shiftKey ? 'previous' : 'next');
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
        trailing={
          <span className={styles.findCount} aria-live="polite">
            {count}
          </span>
        }
      />
      <IconButton
        size="sm"
        variant="ghost"
        label="Previous match"
        disabled={!current?.matches}
        onClick={() => move('previous')}
      >
        <ChevronUp />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        label="Next match"
        disabled={!current?.matches}
        onClick={() => move('next')}
      >
        <ChevronDown />
      </IconButton>
      <IconButton size="sm" variant="ghost" label="Close find" onClick={onClose}>
        <X />
      </IconButton>
    </div>
  );
}
