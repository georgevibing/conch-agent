import { Check, KeyRound } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './KeyCatcher.module.css';

/** A provider a key could belong to. */
export interface KeyCandidate {
  id: string;
  name: string;
  /** For the logo. */
  brand?: string;
  color?: string;
}

/** Whose a pasted value could be. */
export interface KeyMatch {
  /** None means Conch doesn't know it. */
  candidates: KeyCandidate[];
  /**
   * Only one provider's keys start like this: checked with it straight away.
   * Otherwise Conch asks first, even when one provider fits the shape.
   */
  sure: boolean;
}

export interface KeyCatcherProps extends Omit<ComponentProps<'section'>, 'children'> {
  recognise: (value: string) => KeyMatch;
  /** Everyone a key connects, to choose from when nothing recognises it. */
  all?: KeyCandidate[];
  /** Connect it. Rejects with a sentence a person can read when the provider refused. */
  onConnect: (id: string, value: string) => Promise<void>;
  /** Also take a key pasted anywhere on the page, outside another field. On by default. */
  catchPaste?: boolean;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'choose'; candidates: KeyCandidate[]; known: boolean }
  | { kind: 'checking'; who: KeyCandidate }
  | { kind: 'connected'; who: KeyCandidate }
  | { kind: 'failed'; who: KeyCandidate; message: string };

/** One token, the length keys are. Prose, a URL or a password manager reference isn't a key. */
export function looksLikeKey(value: string): boolean {
  return /^[A-Za-z0-9._~+/=:-]{16,512}$/.test(value) && !/^https?:/i.test(value);
}

/** The start and the last four, never the middle: `gsk_••••4f2c`. */
export function maskKey(value: string): string {
  const head = /^[A-Za-z]+[-_]/.exec(value)?.[0] ?? '';
  return `${head}••••${value.slice(-4)}`;
}

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * Have a key? Paste it — here, or anywhere on the page. When it starts with
 * one provider's own prefix, Conch checks it with that provider straight away;
 * when it could be someone else's (plenty of keys start `sk-`), it asks whose
 * it is rather than send it to the wrong company. The key is never shown back:
 * only its start and its last four characters.
 */
export function KeyCatcher({
  recognise,
  all = [],
  onConnect,
  catchPaste = true,
  className,
  ...props
}: KeyCatcherProps) {
  const titleId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const latest = useRef({ recognise, onConnect });
  latest.current = { recognise, onConnect };

  const connect = async (who: KeyCandidate, key: string) => {
    setPhase({ kind: 'checking', who });
    try {
      await latest.current.onConnect(who.id, key);
      setValue('');
      setPhase({ kind: 'connected', who });
    } catch (error) {
      setPhase({
        kind: 'failed',
        who,
        message: error instanceof Error && error.message ? error.message : 'That key didn’t work.',
      });
    }
  };

  const take = (raw: string) => {
    const key = raw.trim();
    setValue(key);
    if (!looksLikeKey(key)) {
      setPhase({ kind: 'idle' });
      return;
    }
    const { candidates, sure } = latest.current.recognise(key);
    const only = candidates.length === 1 ? candidates[0] : undefined;
    if (only && sure) void connect(only, key);
    else setPhase({ kind: 'choose', candidates, known: candidates.length > 0 });
  };

  // A key pasted anywhere on the page lands here — but only one Conch knows,
  // so pasting something else somewhere harmless never takes over the page.
  useEffect(() => {
    if (!catchPaste) return;
    const onPaste = (event: ClipboardEvent) => {
      if (editable(event.target)) return;
      const text = event.clipboardData?.getData('text/plain').trim() ?? '';
      if (!looksLikeKey(text) || !latest.current.recognise(text).candidates.length) return;
      event.preventDefault();
      inputRef.current?.focus({ preventScroll: true });
      take(text);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // `take` reads the latest props through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catchPaste]);

  // Said, then out of the way: the new provider's card is the lasting proof.
  useEffect(() => {
    if (phase.kind !== 'connected') return;
    const timer = setTimeout(() => setPhase({ kind: 'idle' }), 4000);
    return () => clearTimeout(timer);
  }, [phase]);

  const typed = value.trim();
  const choices = phase.kind === 'choose' ? (phase.known ? phase.candidates : all) : [];
  const shape = typed.length > 3 && !looksLikeKey(typed);

  return (
    <section
      aria-labelledby={titleId}
      data-phase={phase.kind}
      data-lustre=""
      className={cx(styles.root, className)}
      {...props}
    >
      <span className={styles.icon} aria-hidden>
        <KeyRound />
      </span>
      <div className={styles.body}>
        <div className={styles.heading}>
          <h3 id={titleId} className={styles.title}>
            Have a key?
          </h3>
          <p className={styles.lead}>
            Paste it here, or anywhere on this page. Conch works out whose it is and checks it.
          </p>
        </div>

        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            take(value);
          }}
        >
          <Input
            ref={inputRef}
            type="password"
            size="md"
            aria-label="Paste a key"
            placeholder="Paste a key"
            autoComplete="off"
            spellCheck={false}
            value={value}
            invalid={shape}
            disabled={phase.kind === 'checking'}
            onChange={(event) => {
              setValue(event.target.value);
              if (phase.kind !== 'checking') setPhase({ kind: 'idle' });
            }}
            onPaste={(event) => {
              event.preventDefault();
              take(event.clipboardData.getData('text/plain'));
            }}
            rootClassName={styles.input}
          />
          <Button
            type="submit"
            variant="surface"
            disabled={!looksLikeKey(typed) || phase.kind === 'checking'}
          >
            Connect
          </Button>
        </form>

        <div className={styles.outcome} aria-live="polite">
          {shape && phase.kind === 'idle' && (
            <p className={styles.note}>A key is one long word, with no spaces in it.</p>
          )}
          {phase.kind === 'checking' && (
            <p className={styles.line}>
              <IntegrationLogo
                brand={phase.who.brand}
                name={phase.who.name}
                color={phase.who.color}
                size="xs"
                decorative
              />
              <span>
                Checking {maskKey(typed)} with {phase.who.name}…
              </span>
              <Spinner size="xs" label={null} />
            </p>
          )}
          {phase.kind === 'connected' && (
            <p className={styles.line} data-tone="success">
              <span className={styles.tick} aria-hidden>
                <Check />
              </span>
              <span>{phase.who.name} is connected. Its models are in the picker now.</span>
            </p>
          )}
          {phase.kind === 'failed' && (
            <p className={styles.line} data-tone="danger">
              <span>
                {phase.who.name} didn’t take it. {phase.message}
              </span>
            </p>
          )}
          {phase.kind === 'choose' && (
            <div className={styles.choose}>
              <p className={styles.note}>
                {phase.known && phase.candidates.length === 1
                  ? `This looks like a ${phase.candidates[0]?.name} key. Is it?`
                  : phase.known
                    ? 'Keys like this one come from more than one place. Whose is it?'
                    : choices.length
                      ? 'Conch doesn’t recognise this key. Whose is it?'
                      : 'Conch doesn’t recognise this key. Open the provider it’s from and paste it there.'}
              </p>
              {choices.length > 0 && (
                <ul className={styles.choices}>
                  {choices.map((who) => (
                    <li key={who.id}>
                      <button
                        type="button"
                        className={styles.choice}
                        data-lustre=""
                        onClick={() => void connect(who, typed)}
                      >
                        <IntegrationLogo
                          brand={who.brand}
                          name={who.name}
                          color={who.color}
                          size="xs"
                          decorative
                        />
                        {who.name}
                      </button>
                    </li>
                  ))}
                  {phase.known && all.length > choices.length && (
                    <li>
                      <button
                        type="button"
                        className={styles.choice}
                        data-quiet=""
                        onClick={() => setPhase({ kind: 'choose', candidates: [], known: false })}
                      >
                        Someone else’s
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
