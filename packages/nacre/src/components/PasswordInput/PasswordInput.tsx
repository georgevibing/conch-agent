import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '../IconButton';
import { Input, type InputProps } from '../Input';

export interface PasswordInputProps extends Omit<InputProps, 'type' | 'trailing'> {
  /** Controlled visibility. */
  revealed?: boolean;
  defaultRevealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
}

/**
 * Password field with a show/hide toggle (NIST SP 800-63B-4 recommends
 * offering one). Paste, autofill and password managers always work: pass
 * `autoComplete="current-password"` to sign in and `"new-password"` to set one.
 */
export function PasswordInput({
  revealed: revealedProp,
  defaultRevealed = false,
  onRevealedChange,
  autoComplete = 'current-password',
  ...props
}: PasswordInputProps) {
  const [uncontrolled, setUncontrolled] = useState(defaultRevealed);
  const revealed = revealedProp ?? uncontrolled;
  const toggle = () => {
    if (revealedProp === undefined) setUncontrolled(!revealed);
    onRevealedChange?.(!revealed);
  };
  return (
    <Input
      {...props}
      type={revealed ? 'text' : 'password'}
      autoComplete={autoComplete}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      data-revealed={revealed || undefined}
      trailing={
        <IconButton
          size="sm"
          label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          onClick={toggle}
          disabled={props.disabled}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </IconButton>
      }
    />
  );
}
