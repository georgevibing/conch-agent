import { Download, ExternalLink, KeyRound } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { PasswordInput } from '../../components/PasswordInput';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Text } from '../../components/Text';
import { CopyButton } from '../CopyButton';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './SecretField.module.css';

/** Mirrors `SecretSource` in `@conch/protocol`. */
export type SecretSourceValue = 'conch' | '1password';

export interface SecretFieldProps {
  /** "OpenRouter key" */
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  source: SecretSourceValue;
  onSourceChange: (source: SecretSourceValue) => void;
  placeholder?: string;
  /** One plain sentence on where to find it. */
  help?: ReactNode;
  /** The page that makes one. */
  url?: string;
  urlLabel?: string;
  error?: string;
  /** Whether 1Password can be reached here; when it can't, the option says why. */
  onePassword?: {
    available: boolean;
    message?: string;
    installCommand?: string;
    docsUrl?: string;
  };
  /** What's already saved, described without revealing it. */
  saved?: { source: SecretSourceValue; hint: string; problem?: string };
  disabled?: boolean;
  id?: string;
}

const OP_PLACEHOLDER = 'op://Private/OpenRouter/credential';

/**
 * One field, two places to keep a secret: here on this computer, or in
 * 1Password. Choosing 1Password stores a reference rather than the secret, and
 * Conch asks for the value only when a message needs it.
 *
 * The choice is always visible, even when 1Password isn't installed — a person
 * who keeps their keys there should find out that Conch can use it, and be told
 * exactly what's missing.
 */
export function SecretField({
  label,
  value,
  onValueChange,
  source,
  onSourceChange,
  placeholder,
  help,
  url,
  urlLabel = 'Get a key',
  error,
  onePassword,
  saved,
  disabled,
  id,
}: SecretFieldProps) {
  const fieldId = useId();
  const controlId = id ?? fieldId;
  const inOnePassword = source === '1password';
  const opAvailable = onePassword?.available ?? false;
  const blocked = inOnePassword && !opAvailable;

  return (
    <Field invalid={Boolean(error)} className={styles.root}>
      <div className={styles.header}>
        <Field.Label htmlFor={controlId}>{label}</Field.Label>
        <SegmentedControl
          size="sm"
          value={source}
          onValueChange={(next) => onSourceChange(next as SecretSourceValue)}
          aria-label="Where to keep it"
          className={styles.where}
        >
          <SegmentedControl.Item value="conch">On this computer</SegmentedControl.Item>
          <SegmentedControl.Item value="1password">1Password</SegmentedControl.Item>
        </SegmentedControl>
      </div>

      {inOnePassword ? (
        <Input
          id={controlId}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={OP_PLACEHOLDER}
          spellCheck={false}
          autoCapitalize="none"
          autoComplete="off"
          disabled={disabled}
          className={styles.reference}
          leading={<IntegrationLogo brand="1password" name="1Password" size="xs" decorative />}
        />
      ) : (
        <PasswordInput
          id={controlId}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          leading={<KeyRound />}
        />
      )}

      {error ? (
        <Field.Error>{error}</Field.Error>
      ) : blocked ? (
        <Field.Description>
          <span className={styles.blocked}>
            <Download aria-hidden />
            <span>
              {onePassword?.message ??
                'Install the 1Password command line tool to keep keys in 1Password.'}
            </span>
          </span>
        </Field.Description>
      ) : inOnePassword ? (
        <Field.Description>
          Conch keeps the reference, not the key, and asks 1Password when it needs it. In 1Password,
          right-click a field and choose “Copy Secret Reference”.
        </Field.Description>
      ) : (
        help && <Field.Description>{help}</Field.Description>
      )}

      {(url ?? (blocked && onePassword?.installCommand)) && (
        <div className={styles.aside}>
          {blocked && onePassword?.installCommand ? (
            <>
              <code className={styles.command}>{onePassword.installCommand}</code>
              <CopyButton value={onePassword.installCommand} label="Copy install command" />
              {onePassword.docsUrl && (
                <Button asChild variant="ghost" size="sm">
                  <a href={onePassword.docsUrl} target="_blank" rel="noreferrer">
                    How it works <ExternalLink aria-hidden className={styles.linkIcon} />
                  </a>
                </Button>
              )}
            </>
          ) : (
            url && (
              <Button asChild variant="ghost" size="sm">
                <a href={url} target="_blank" rel="noreferrer">
                  {urlLabel} <ExternalLink aria-hidden className={styles.linkIcon} />
                </a>
              </Button>
            )
          )}
        </div>
      )}

      {saved && !value && (
        <Text size="xs" tone={saved.problem ? 'danger' : 'subtle'} className={styles.saved}>
          {saved.problem ??
            (saved.source === '1password'
              ? `Reading it from ${saved.hint}`
              : `Saved on this computer, ending ${saved.hint.replace(/^…/, '')}`)}
        </Text>
      )}
    </Field>
  );
}
