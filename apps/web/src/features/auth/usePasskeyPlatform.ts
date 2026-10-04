import { passkeyPlatform, type PasskeyPlatform } from '@conch/nacre';
import { useEffect, useState } from 'react';

import { passkeySupport, type PasskeySupport } from './passkey';

/**
 * What this device can use for a passkey, named for the person (ADR 0065):
 * Touch ID on a Mac, Windows Hello on a PC, Face ID on an iPhone, a phone
 * nearby, or nothing (`undefined`: don't offer passkeys here). `undefined`
 * too while the browser is still being asked.
 */
export function usePasskeyPlatform(): {
  platform: PasskeyPlatform | undefined;
  support: PasskeySupport | undefined;
} {
  const [support, setSupport] = useState<PasskeySupport>();
  useEffect(() => {
    let live = true;
    void passkeySupport().then((found) => {
      if (live) setSupport(found);
    });
    return () => {
      live = false;
    };
  }, []);
  const platform = support
    ? passkeyPlatform(
        navigator.userAgent,
        support.platform,
        support.supported,
        navigator.maxTouchPoints,
      )
    : undefined;
  return { platform, support };
}
