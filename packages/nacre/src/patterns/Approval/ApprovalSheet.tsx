import { Ban, Check, Clock, Fingerprint, ShieldAlert } from 'lucide-react';
import type { ReactNode, Ref } from 'react';

import { Button } from '../../components/Button';
import { Sheet } from '../../components/Sheet';
import { ApprovalCommand } from './ApprovalCommand';
import styles from './ApprovalSheet.module.css';

/** How an approval sheet's question ended: allowed, denied, or answered somewhere else first. */
export type ApprovalSheetOutcome = 'allow' | 'deny' | 'gone';

export interface ApprovalSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Who asks: the assistant's name ("Pearl"), or an app's ("Claude Desktop"). */
  name: string;
  /** Their face, beside the name (an `AgentAvatar`). */
  face?: ReactNode;
  /** The chat it's in, in a few words. */
  where?: ReactNode;
  /**
   * What will happen, in a few plain words: "Run the tests in conch-agent".
   * Never the command itself (that's `command`): at most two lines.
   */
  title: ReactNode;
  /** Where things go, in a few words. */
  detail?: ReactNode;
  /** What it costs, when it costs money. Said first. */
  cost?: ReactNode;
  /** Why to look twice, as one quiet line. */
  caution?: ReactNode;
  /** The command it would run, exactly: at code size, a few lines and then "Show all". */
  command?: string;
  /** Exactly what it would do, when it isn't a command: the file, the address, a draft. */
  children?: ReactNode;
  /** When nobody answering becomes a no: "No answer by 14:32 is a no." */
  until?: ReactNode;
  /**
   * Allowing asks you to confirm it's you first (a passkey or your
   * password), and why, in a few words: "It would delete files."
   */
  confirm?: ReactNode;
  /** The answer on its way: the buttons wait, and the one pressed spins. */
  sent?: 'allow' | 'deny';
  /** It's over: the sheet says how, and offers the way back to the chat. */
  outcome?: ApprovalSheetOutcome;
  onDecide: (decision: 'allow' | 'deny') => void;
  allowRef?: Ref<HTMLButtonElement>;
}

const OUTCOME: Record<ApprovalSheetOutcome, { words: string; more: string }> = {
  allow: { words: 'Allowed', more: 'It carries on.' },
  deny: { words: 'Denied', more: 'It won’t do that, and carries on without it.' },
  gone: { words: 'Already answered', more: 'Nothing more to do here.' },
};

/**
 * One question, on a phone, within reach of a thumb (ADR 0108): what will
 * happen in a few plain words as its title (never the command: that goes
 * under it, at code size) and exactly what it would do under it, the facts in
 * a quiet line, and two big answers at the bottom of the screen. A step that
 * matters asks for your passkey first, and says why. Once answered, a pearl
 * seal closes over the answer, and the sheet offers the way back.
 */
export function ApprovalSheet({
  open,
  onOpenChange,
  name,
  face,
  where,
  title,
  detail,
  cost,
  caution,
  command,
  children,
  until,
  confirm,
  sent,
  outcome,
  onDecide,
  allowRef,
}: ApprovalSheetProps) {
  const busy = sent !== undefined;
  return (
    <Sheet.Root open={open} onOpenChange={onOpenChange}>
      <Sheet.Content side="bottom" size="lg" className={styles.sheet} hideClose={!outcome}>
        {outcome ? (
          <div className={styles.done} data-outcome={outcome} role="status">
            <span className={styles.seal} aria-hidden>
              <svg viewBox="0 0 48 48" className={styles.ring}>
                <circle cx="24" cy="24" r="22" />
              </svg>
              {outcome === 'deny' ? <Ban /> : <Check />}
            </span>
            <Sheet.Title className={styles.doneWords}>{OUTCOME[outcome].words}</Sheet.Title>
            <Sheet.Description className={styles.doneMore}>
              {OUTCOME[outcome].more}
            </Sheet.Description>
            <Sheet.Close asChild>
              <Button size="lg" variant="surface" className={styles.back}>
                Back to the chat
              </Button>
            </Sheet.Close>
          </div>
        ) : (
          <>
            <div className={styles.who}>
              {face}
              <Sheet.Description className={styles.asks}>
                <span className={styles.name}>{name}</span> asks first
                {where && (
                  <>
                    <span className={styles.dot} aria-hidden>
                      {' · '}
                    </span>
                    <span className={styles.where}>{where}</span>
                  </>
                )}
              </Sheet.Description>
            </div>
            <div className={styles.card} data-lustre="">
              <Sheet.Title className={styles.title}>{title}</Sheet.Title>
              {(cost || detail) && (
                <p className={styles.facts}>
                  {cost && <span className={styles.cost}>{cost}</span>}
                  {cost && detail && (
                    <span className={styles.dot} aria-hidden>
                      ·
                    </span>
                  )}
                  {detail && <span>{detail}</span>}
                </p>
              )}
              {command && <ApprovalCommand>{command}</ApprovalCommand>}
              {children != null && <div className={styles.preview}>{children}</div>}
              {caution && (
                <p className={styles.line}>
                  <ShieldAlert aria-hidden className={styles.warn} />
                  <span>{caution}</span>
                </p>
              )}
            </div>
            {confirm && (
              <p className={styles.line}>
                <Fingerprint aria-hidden />
                <span>{confirm} So it asks for your passkey or password first.</span>
              </p>
            )}
            {until && (
              <p className={styles.line}>
                <Clock aria-hidden />
                <span>{until}</span>
              </p>
            )}
            <div className={styles.answers}>
              <Button
                size="lg"
                variant="surface"
                disabled={busy}
                loading={sent === 'deny'}
                onClick={() => onDecide('deny')}
              >
                Deny
              </Button>
              <Button
                ref={allowRef}
                size="lg"
                disabled={busy}
                loading={sent === 'allow'}
                leadingIcon={confirm ? <Fingerprint /> : undefined}
                onClick={() => onDecide('allow')}
              >
                {confirm ? 'Confirm and allow' : 'Allow'}
              </Button>
            </div>
          </>
        )}
      </Sheet.Content>
    </Sheet.Root>
  );
}
