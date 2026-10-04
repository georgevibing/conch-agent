/**
 * Which passkey this device can offer, named for what the person has (ADR 0065):
 *
 * - `mac` — Touch ID; `windows` — Windows Hello; `ios` — Face ID;
 *   `android` — the fingerprint (or the screen lock behind it);
 * - `phone` — no built-in authenticator, but the browser can use a phone
 *   nearby (it shows a QR code);
 * - `undefined` — passkeys don't work here at all, so don't offer them.
 */
export type PasskeyPlatform = 'mac' | 'windows' | 'ios' | 'android' | 'phone';

/**
 * Pick the platform from what the browser says about itself.
 *
 * @param userAgent `navigator.userAgent`.
 * @param platformAuthenticatorAvailable
 *   `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`.
 * @param passkeysSupported WebAuthn exists and the page is a secure context.
 * @param maxTouchPoints `navigator.maxTouchPoints`: iPadOS sends a Mac's user
 *   agent, and touch is how it gives itself away.
 */
export function passkeyPlatform(
  userAgent: string,
  platformAuthenticatorAvailable: boolean,
  passkeysSupported: boolean,
  maxTouchPoints = 0,
): PasskeyPlatform | undefined {
  if (!passkeysSupported) return undefined;
  const ua = userAgent;
  const ios = /\b(iPhone|iPad|iPod)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1);
  if (!platformAuthenticatorAvailable) return 'phone';
  if (ios) return 'ios';
  if (/\bAndroid\b/.test(ua)) return 'android';
  if (/\bWindows\b/.test(ua)) return 'windows';
  if (/\bMac OS X\b|\bMacintosh\b/.test(ua)) return 'mac';
  // A built-in authenticator we can't name (ChromeOS, Linux with a key):
  // the browser's own sheet offers it alongside a phone, so say "phone".
  return 'phone';
}

/** What the person has, in words: "Touch ID", "your phone". */
export function passkeyName(platform: PasskeyPlatform): string {
  switch (platform) {
    case 'mac':
      return 'Touch ID';
    case 'windows':
      return 'Windows Hello';
    case 'ios':
      return 'Face ID';
    case 'android':
      return 'your fingerprint';
    case 'phone':
      return 'your phone';
  }
}

export type PasskeyAction = 'create' | 'sign-in' | 'confirm';

/** The button's words: "Use Touch ID", "Sign in with Windows Hello", "Confirm with Face ID". */
export function passkeyLabel(platform: PasskeyPlatform, action: PasskeyAction): string {
  const name = passkeyName(platform);
  if (action === 'sign-in') return `Sign in with ${name}`;
  if (action === 'confirm') return `Confirm with ${name}`;
  return `Use ${name}`;
}
