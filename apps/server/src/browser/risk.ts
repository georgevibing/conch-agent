/**
 * Which browser actions are worth a question (ADR 0014, "Permissions").
 *
 * Two kinds of thing are special:
 * - **Secrets** — passwords, one-time codes, payment and identity numbers. The
 *   agent never types them, and they're masked in everything the model sees.
 *   You type them yourself after a handoff.
 * - **High stakes** — buying, sending, publishing, deleting, moving money. Always
 *   confirmed, whatever the mode, with the control's own words shown.
 */

export type SecretKind = 'password' | 'payment' | 'identity';

/** The attribute the page script sets on secret fields, for masks and checks. */
export const SECRET_ATTR = 'data-conch-secret';

/**
 * Marks every secret field in a frame with `SECRET_ATTR`. Runs in the page, so
 * it must stay self-contained (it's serialised, not bundled). Returns how many
 * it found.
 */
export function markSecretsInPage(attr: string): number {
  // The gateway has no DOM types; this is the little of the DOM the script touches.
  interface PageElement {
    id: string;
    textContent: string | null;
    labels?: ArrayLike<PageElement> | null;
    getAttribute(name: string): string | null;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    hasAttribute(name: string): boolean;
  }
  const doc = (
    globalThis as unknown as {
      document: {
        getElementById(id: string): PageElement | null;
        querySelectorAll(selector: string): ArrayLike<PageElement>;
      };
    }
  ).document;
  const labelOf = (el: PageElement): string => {
    const parts: (string | null | undefined)[] = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-testid'),
    ];
    const labelled = el.getAttribute('aria-labelledby');
    if (labelled) {
      for (const id of labelled.split(/\s+/)) parts.push(doc.getElementById(id)?.textContent);
    }
    for (const label of Array.from(el.labels ?? [])) parts.push(label.textContent);
    return parts.filter(Boolean).join(' ').toLowerCase();
  };
  let found = 0;
  for (const el of Array.from(doc.querySelectorAll('input, textarea, [contenteditable]'))) {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    const auto = (el.getAttribute('autocomplete') ?? '').toLowerCase();
    const label = labelOf(el);
    let kind: string | undefined;
    if (
      type === 'password' ||
      /\b(current-password|new-password|one-time-code)\b/.test(auto) ||
      /\b(password|passcode|passwort|contraseña|mot de passe|one[- ]time code|verification code|2fa|otp)\b/.test(
        label,
      )
    ) {
      kind = 'password';
    } else if (
      /\bcc-/.test(auto) ||
      /card.?number|credit.?card|debit.?card|\bcvc\b|\bcvv\b|\bcsc\b|security code|expir|\biban\b|routing number|account number|sort code/.test(
        label,
      )
    ) {
      kind = 'payment';
    } else if (/\bssn\b|social security|passport number|national id|tax id/.test(label)) {
      kind = 'identity';
    }
    if (kind) {
      el.setAttribute(attr, kind);
      found++;
    } else if (el.hasAttribute(attr)) {
      el.removeAttribute(attr);
    }
  }
  return found;
}

/**
 * Words on a control that make clicking it a significant, often irreversible
 * act, in English and the languages shops most often speak (German,
 * French, Spanish, Portuguese, Italian, Dutch). Others fall back to the
 * per-site question outside Auto. Plain "Submit" is left out on purpose —
 * it's every search box.
 */
const HIGH_STAKES = new RegExp(
  [
    'buy',
    'buy now',
    'purchase',
    'pay',
    'pay now',
    'checkout',
    'check out',
    'place (?:your )?order',
    'order now',
    'complete (?:order|purchase|payment|booking)',
    'confirm (?:order|purchase|payment|booking|transfer)',
    'submit (?:order|payment|application)',
    'subscribe',
    'start (?:subscription|trial)',
    'donate',
    'send',
    'send (?:message|email|money|payment)',
    'reply',
    'post',
    'publish',
    'tweet',
    'share',
    'delete',
    'delete (?:account|forever|permanently)',
    'remove account',
    'close account',
    'cancel (?:subscription|account|order|booking)',
    'transfer',
    'withdraw',
    'book',
    'book now',
    'reserve',
    'sign(?: and)? submit',
    'accept (?:offer|terms and pay)',
    'merge',
    // The same acts in the languages shops most often speak (ADR 0117): with these, Auto
    // can act on a shop's site after reading it and still stop before the order.
    // German
    '(?:jetzt )?kaufen',
    '(?:jetzt |kostenpflichtig |zahlungspflichtig )?bestellen',
    '(?:jetzt )?(?:bezahlen|zahlen)',
    'zur kasse',
    'kaufen und bezahlen',
    'abonnieren',
    'spenden',
    'überweisen',
    '(?:jetzt )?buchen',
    'reservieren',
    '(?:ab)?senden',
    'abschicken',
    'antworten',
    'veröffentlichen',
    'teilen',
    'löschen',
    'endgültig löschen',
    'konto löschen',
    // French
    'acheter',
    'payer',
    'commander',
    'valider (?:la |ma )?commande',
    'passer (?:la )?commande',
    "s'abonner",
    'réserver',
    'envoyer',
    'publier',
    'partager',
    'supprimer',
    // Spanish and Portuguese
    'comprar',
    'pagar',
    'realizar pedido',
    'finalizar (?:compra|pedido)',
    'tramitar pedido',
    'suscribirse',
    'reservar',
    'enviar',
    'publicar',
    'compartir',
    'eliminar',
    'borrar',
    'excluir',
    // Italian
    'acquista(?: ora)?',
    'paga(?: ora)?',
    'ordina',
    'conferma ordine',
    'prenota',
    'invia',
    'pubblica',
    'elimina',
    // Dutch
    'kopen',
    'betalen',
    'nu kopen',
    'afrekenen',
    'verzenden',
    'verwijderen',
  ]
    .map((p) => `^\\s*${p}\\b`)
    .join('|'),
  'i',
);

/** Is clicking a control with this accessible name a significant act? */
export function isHighStakes(name: string | undefined): boolean {
  if (!name) return false;
  // Control names can carry prices and icons: "Place order · $42.10".
  return HIGH_STAKES.test(name.replace(/[^\p{L}\p{N}\s'’-]+/gu, ' ').trim());
}

/** Plain words for a secret kind, for the message that asks you to take over. */
export function secretLabel(kind: SecretKind): string {
  switch (kind) {
    case 'password':
      return 'a password or sign-in code';
    case 'payment':
      return 'payment details';
    case 'identity':
      return 'an identity number';
  }
}
