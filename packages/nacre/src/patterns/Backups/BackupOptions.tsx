import type { ComponentProps } from 'react';

import { Field } from '../../components/Field';
import { PasswordInput } from '../../components/PasswordInput';
import { StrengthMeter, type StrengthMeterProps } from '../../components/StrengthMeter';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import styles from './Backups.module.css';

export interface BackupOptionsProps extends Omit<ComponentProps<'div'>, 'children'> {
  chats: boolean;
  onChatsChange?: (chats: boolean) => void;
  /** How much the chats take: “240 chats and their files · 48 MB”. */
  chatsDetail?: string;
  secrets: boolean;
  onSecretsChange?: (secrets: boolean) => void;
  passphrase?: string;
  onPassphraseChange?: (passphrase: string) => void;
  confirm?: string;
  onConfirmChange?: (confirm: string) => void;
  /** How strong the passphrase is (the app checks it, like a password). */
  strength?: Pick<StrengthMeterProps, 'score' | 'label' | 'message'>;
}

/**
 * The choices in “Back up now”: chats in or out (with what they take), and
 * keys and sign-ins — only ever locked with a passphrase, typed twice, with
 * its strength shown. Conch can't recover a forgotten passphrase, and says so.
 */
export function BackupOptions({
  chats,
  onChatsChange,
  chatsDetail,
  secrets,
  onSecretsChange,
  passphrase = '',
  onPassphraseChange,
  confirm = '',
  onConfirmChange,
  strength,
  className,
  ...props
}: BackupOptionsProps) {
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  return (
    <div className={cx(styles.options, className)} {...props}>
      <Switch
        checked={chats}
        onCheckedChange={onChatsChange}
        label="Include chats"
        description={chatsDetail ?? 'Every chat, with the files and pictures sent in it.'}
      />
      <Switch
        checked={secrets}
        onCheckedChange={onSecretsChange}
        label="Include keys and sign-ins"
        description="Provider keys, integration sign-ins and how you sign in to Conch, locked with a passphrase. Without them, you sign in again after restoring."
      />
      {secrets && (
        <div className={styles.passphrase}>
          <Field>
            <Field.Label>Passphrase</Field.Label>
            <PasswordInput
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => onPassphraseChange?.(e.target.value)}
            />
            <StrengthMeter
              score={strength?.score ?? 0}
              label={strength?.label ?? ''}
              message={strength?.message}
              empty={!passphrase}
              meterLabel="Passphrase strength"
            />
          </Field>
          <Field invalid={mismatch}>
            <Field.Label>Passphrase again</Field.Label>
            <PasswordInput
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => onConfirmChange?.(e.target.value)}
            />
            {mismatch && <Field.Error>The two don’t match yet.</Field.Error>}
          </Field>
          <p className={styles.caution}>
            Conch can’t recover a forgotten passphrase. Without it, everything else still restores.
          </p>
        </div>
      )}
    </div>
  );
}
