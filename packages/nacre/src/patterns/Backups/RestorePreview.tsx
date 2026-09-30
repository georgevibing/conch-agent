import { KeyRound, ShieldCheck } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { cx } from '../../utils/cx';
import { BackupContents } from './BackupContents';
import { BackupPowers } from './BackupPowers';
import styles from './Backups.module.css';
import type { BackupContentsInfo, BackupPowerInfo } from './format';

export interface RestorePreviewProps extends Omit<ComponentProps<'div'>, 'children'> {
  contents: BackupContentsInfo;
  /** What in it can act for you (read from its files), shown before anyone confirms. */
  powers?: BackupPowerInfo[];
  /** More of them than `powers` lists. */
  morePowers?: number;
  /**
   * This Conch has sign-in set up, so its password and keys stay: the
   * backup's other keys and sign-ins come back, not those.
   */
  signInStays?: boolean;
  passphrase?: string;
  onPassphraseChange?: (passphrase: string) => void;
  /** Leave the keys and sign-ins out (a forgotten passphrase). */
  skipSecrets?: boolean;
  onSkipSecretsChange?: (skip: boolean) => void;
  /** “That passphrase doesn't open this backup.” */
  passphraseError?: string;
  /** The reassurance under it. */
  note?: ReactNode;
}

/**
 * The body of “Restore this backup?”: what comes back, in plain words; what
 * in it can act for you, before you say yes; the passphrase when the keys
 * are locked in it, with a way on without it; and the promises that your
 * password and keys stay, and that what's here now is kept, so the restore
 * can be undone.
 */
export function RestorePreview({
  contents,
  powers = [],
  morePowers = 0,
  signInStays = false,
  passphrase = '',
  onPassphraseChange,
  skipSecrets = false,
  onSkipSecretsChange,
  passphraseError,
  note = 'What’s in your Conch now is kept first, so you can undo this.',
  className,
  ...props
}: RestorePreviewProps) {
  const locked = contents.secrets === 'passphrase';
  return (
    <div className={cx(styles.preview, className)} {...props}>
      <BackupContents contents={contents} withSecrets={Boolean(contents.secrets) && !skipSecrets} />
      <BackupPowers powers={powers} more={morePowers} />
      {locked &&
        (skipSecrets ? (
          <Button
            variant="ghost"
            size="sm"
            className={styles.forgot}
            onClick={() => onSkipSecretsChange?.(false)}
          >
            Unlock them with the passphrase after all
          </Button>
        ) : (
          <Field invalid={Boolean(passphraseError)}>
            <Field.Label>Passphrase</Field.Label>
            <PasswordInput
              autoComplete="off"
              value={passphrase}
              onChange={(e) => onPassphraseChange?.(e.target.value)}
            />
            {passphraseError ? (
              <Field.Error>{passphraseError}</Field.Error>
            ) : (
              <Field.Description>
                The one you chose for this backup’s keys and sign-ins.
              </Field.Description>
            )}
            <Button
              variant="ghost"
              size="sm"
              className={styles.forgot}
              onClick={() => onSkipSecretsChange?.(true)}
            >
              Forgot it? Restore without keys and sign-ins
            </Button>
          </Field>
        ))}
      {((signInStays && contents.secrets && !skipSecrets) || note != null) && (
        <div className={styles.notes}>
          {signInStays && contents.secrets && !skipSecrets && (
            <p className={styles.note}>
              <KeyRound aria-hidden />
              <span>Your current password and keys stay.</span>
            </p>
          )}
          {note != null && (
            <p className={styles.note}>
              <ShieldCheck aria-hidden />
              <span>{note}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
