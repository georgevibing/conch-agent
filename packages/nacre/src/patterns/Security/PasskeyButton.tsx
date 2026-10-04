import { FingerprintPattern, KeyRound, ScanFace, Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button, type ButtonProps } from '../../components/Button';
import { passkeyLabel, type PasskeyAction, type PasskeyPlatform } from './passkeyPlatform';

export interface PasskeyButtonProps extends Omit<ButtonProps, 'leadingIcon' | 'asChild'> {
  /** What this device has (`passkeyPlatform`): it names the button and picks its icon. */
  platform: PasskeyPlatform;
  /** Make a passkey, sign in with one, or confirm it's you. */
  action?: PasskeyAction;
  /** Other words, e.g. "Add Touch ID". The icon still says which one. */
  children?: ReactNode;
}

export const passkeyIcons: Record<PasskeyPlatform, ReactNode> = {
  mac: <FingerprintPattern />,
  windows: <KeyRound />,
  ios: <ScanFace />,
  android: <FingerprintPattern />,
  phone: <Smartphone />,
};

/**
 * The passkey button, named for what this device has: "Use Touch ID" on a
 * Mac, "Use Windows Hello" on a PC, "Use Face ID" on an iPhone. Nobody has to
 * know the word "passkey" to use one. Large and solid by default, since it's
 * usually the easy way in.
 */
export function PasskeyButton({
  platform,
  action = 'create',
  size = 'lg',
  children,
  ...props
}: PasskeyButtonProps) {
  return (
    <Button size={size} leadingIcon={passkeyIcons[platform]} data-platform={platform} {...props}>
      {children ?? passkeyLabel(platform, action)}
    </Button>
  );
}
