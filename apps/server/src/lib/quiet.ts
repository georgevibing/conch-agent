/**
 * The passkey and certificate libraries (`@simplewebauthn/server`,
 * `@peculiar/x509`) ask Web Crypto which algorithms it has, and Node answers
 * the first time with an "experimental feature" warning (`SubtleCrypto.supports`,
 * ML-DSA). That isn't news to anyone reading Conch's log or its terminal, so
 * those two are left unsaid. Every other warning still prints as Node prints it.
 */
const QUIET = [/\bsupports Web Crypto API method\b/i, /\bML-(?:DSA|KEM)\b/];

export function quietCryptoWarnings(target: NodeJS.Process = process): void {
  const printers = target.listeners('warning');
  target.removeAllListeners('warning');
  target.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && QUIET.some((r) => r.test(warning.message)))
      return;
    for (const print of printers) print(warning);
  });
}
