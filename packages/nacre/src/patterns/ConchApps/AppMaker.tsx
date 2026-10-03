import { Sparkles } from 'lucide-react';
import { useReducedMotionConfig } from 'motion/react';
import { useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';

import { Button } from '../../components/Button';
import { Kbd } from '../../components/Kbd';
import { Textarea } from '../../components/Textarea';
import { cx } from '../../utils/cx';
import styles from './AppMaker.module.css';

/** What the chips offer: everyday wishes, each one a small app. */
export const APP_MAKER_EXAMPLES = [
  'Remember when I water my plants',
  'Track what I spend on coffee',
  'Check if my train is late',
  'Keep a reading list',
  'Log my runs and show my week',
] as const;

/** The box's hint, taking turns: believable, a little specific, never a demo. */
const HINTS = [
  'Keep track of the books I lend to friends, and remind me who has which',
  'Tell me if the pool is open before I go swimming',
  'Log my blood pressure in the morning and show me the month',
  'Count down to our trip and keep the packing list',
  'Note what the kids owe me for pocket money',
  'Check the surf at my beach every morning',
];

/** How long each hint stays. */
const HINT_MS = 4200;

export interface AppMakerProps extends Omit<ComponentProps<'div'>, 'children' | 'onChange'> {
  /** What it should do, controlled. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** **Build it**: starts a chat with these words and opens it. */
  onBuild: (text: string) => void;
  /** The chat is being started. */
  busy?: boolean;
  /** The chips; four to six read best. */
  examples?: readonly string[];
}

/**
 * **Describe it** (ADR 0061): the first tab of **Add your own**. One big,
 * friendly box — “What should it do?” — whose hint takes turns through
 * things people really want, a few chips that fill it, and **Build it**
 * (⌘/Ctrl+Enter). Conch builds it in a chat, shows it, and adds it only
 * when the person says so.
 */
export function AppMaker({
  value: valueProp,
  defaultValue = '',
  onValueChange,
  onBuild,
  busy,
  examples = APP_MAKER_EXAMPLES,
  className,
  ...props
}: AppMakerProps) {
  const labelId = useId();
  const noteId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const [own, setOwn] = useState(defaultValue);
  const value = valueProp ?? own;
  const set = (next: string) => {
    if (valueProp === undefined) setOwn(next);
    onValueChange?.(next);
  };
  const text = value.trim();

  // The hint takes turns only while the box is empty; with reduced motion it stays.
  const reduced = useReducedMotionConfig() === true;
  const [hint, setHint] = useState(0);
  const empty = value.length === 0;
  useEffect(() => {
    if (reduced || !empty) return;
    const timer = setInterval(() => setHint((h) => (h + 1) % HINTS.length), HINT_MS);
    return () => clearInterval(timer);
  }, [reduced, empty]);

  const build = () => {
    if (!text || busy) return;
    onBuild(text);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      (event.metaKey || event.ctrlKey) &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      build();
    }
  };

  return (
    <div className={cx(styles.maker, className)} {...props}>
      <label id={labelId} htmlFor={`${labelId}-box`} className={styles.question}>
        What should it do?
      </label>
      <Textarea
        ref={box}
        id={`${labelId}-box`}
        size="lg"
        minRows={4}
        maxRows={10}
        value={value}
        onChange={(e) => set(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={HINTS[hint]}
        disabled={busy}
        maxLength={2000}
        aria-describedby={noteId}
        rootClassName={styles.box}
        footer={
          <div className={styles.footer}>
            <Button
              size="sm"
              onClick={build}
              disabled={!text}
              loading={busy}
              leadingIcon={<Sparkles />}
              trailing={<Kbd keys={['mod', 'enter']} size="sm" inverse />}
              aria-keyshortcuts="Meta+Enter Control+Enter"
              className={styles.build}
            >
              Build it
            </Button>
          </div>
        }
      />
      {examples.length > 0 && (
        <div role="group" aria-label="Ideas" className={styles.examples}>
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className={styles.example}
              data-lustre=""
              disabled={busy}
              onClick={() => {
                set(example);
                box.current?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      )}
      <p id={noteId} className={styles.note}>
        Conch builds it in a chat, shows it to you, and adds it when you say so.
      </p>
    </div>
  );
}
