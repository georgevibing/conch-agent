/**
 * Google accounts in a person's words: the three products, what each level
 * lets the assistant do there, and which way of connecting is simplest for
 * what someone wants (ADR 0048, Apps → a Google app → Accounts).
 */
import {
  capabilitiesFor,
  GOOGLE_APP_PRODUCT,
  levelRank,
  type GoogleAccessMap,
  type GoogleAccount,
  type GoogleAppId,
  type GoogleCapability,
  type GoogleLevel,
  type GoogleProduct,
} from '@conch/protocol';
import type { AccessService } from '@conch/nacre';

export interface ProductInfo {
  id: GoogleProduct;
  /** Its app in Apps. */
  app: GoogleAppId;
  name: string;
  color: string;
  describe: Record<GoogleLevel, string>;
}

export const PRODUCTS: ProductInfo[] = [
  {
    id: 'gmail',
    app: 'gmail',
    name: 'Gmail',
    color: '#EA4335',
    describe: {
      off: 'Not used with this account.',
      read: 'Search and read your mail.',
      write: 'Also save drafts and send email. It asks you every time.',
    },
  },
  {
    id: 'calendar',
    app: 'google-calendar',
    name: 'Google Calendar',
    color: '#4285F4',
    describe: {
      off: 'Not used with this account.',
      read: 'See your events.',
      write: 'Also add, move and delete events. It asks you every time.',
    },
  },
  {
    id: 'drive',
    app: 'google-drive',
    name: 'Google Drive',
    color: '#0F9D58',
    describe: {
      off: 'Not used with this account.',
      read: 'Find files and read their details.',
      write: 'Also make new Docs. It never changes your other files, and asks every time.',
    },
  },
];
export const productInfo = (id: GoogleProduct) =>
  PRODUCTS.find((p) => p.id === id) ?? (PRODUCTS[0] as ProductInfo);
export const productOfApp = (app: GoogleAppId) => GOOGLE_APP_PRODUCT[app];

export const levelOf = (account: GoogleAccount, product: GoogleProduct): GoogleLevel =>
  account.access?.[product] ?? 'off';
export const grantedOf = (account: GoogleAccount, product: GoogleProduct): GoogleLevel =>
  account.granted?.[product] ??
  (account.via === 'app-password' && product === 'gmail' ? 'write' : 'off');

/** Choosing this needs Google's consent again (a sign-in), not just a switch. */
export const needsConsent = (account: GoogleAccount, product: GoogleProduct, level: GoogleLevel) =>
  levelRank(level) > levelRank(grantedOf(account, product));

/** An app password reaches Gmail and nothing else. */
export const reachable = (account: GoogleAccount, product: GoogleProduct) =>
  account.via !== 'app-password' || product === 'gmail';

/**
 * What to ask Google for so the account ends up with `want` in one product
 * and keeps everything else it has: Desktop clients can't add to a grant, so
 * the whole set is asked for each time.
 */
export function capabilitiesWith(
  account: GoogleAccount | undefined,
  product: GoogleProduct,
  level: GoogleLevel,
): GoogleCapability[] {
  const levels: Partial<Record<GoogleProduct, GoogleLevel>> = {
    ...account?.access,
    [product]: level,
  };
  const access: GoogleAccessMap = Object.fromEntries(
    Object.entries(levels).filter(([, l]) => l !== 'off'),
  );
  return capabilitiesFor(access);
}

/** Levels as chosen in the add flow: off means left out. */
export type Wanted = Partial<Record<GoogleProduct, GoogleLevel>>;
export const wantedAccess = (wanted: Wanted): GoogleAccessMap =>
  Object.fromEntries(
    Object.entries(wanted).filter(([, level]) => level && level !== 'off'),
  ) as GoogleAccessMap;

/**
 * The simplest way to connect for what's wanted: an app password when it's
 * only Gmail and there's no Google app yet (two minutes, nothing to set up);
 * Google sign-in for Calendar or Drive, or when the Google app is ready
 * (then it's one press).
 */
export function simplest(wanted: Wanted, configured: boolean): 'password' | 'google' {
  const only = Object.keys(wantedAccess(wanted));
  return only.length && only.every((p) => p === 'gmail') && !configured ? 'password' : 'google';
}

/** The rows of an account's card, from what it may do and what its sign-in allows. */
export function serviceRows(
  account: GoogleAccount,
  options: {
    focus?: GoogleProduct;
    only?: GoogleProduct[];
    busy?: GoogleProduct;
    onSwitch?: (product: GoogleProduct) => void;
  } = {},
): AccessService[] {
  return PRODUCTS.filter((p) => !options.only || options.only.includes(p.id)).map((p) => {
    const level = levelOf(account, p.id);
    const granted = grantedOf(account, p.id);
    const base: AccessService = {
      id: p.id,
      name: p.name,
      brand: p.app,
      color: p.color,
      level,
      describe: p.describe,
      current: options.focus === p.id,
      busy: options.busy === p.id,
    };
    if (!reachable(account, p.id))
      return {
        ...base,
        level: 'off',
        unavailable: {
          reason: 'Needs Google sign-in: an app password only reaches Gmail.',
          ...(options.onSwitch && {
            action: { label: 'Use Google sign-in', onClick: () => options.onSwitch?.(p.id) },
          }),
        },
      };
    if (account.via === 'google' && levelRank(granted) < 2)
      return {
        ...base,
        note:
          granted === 'off'
            ? 'Choosing Read or Read & write asks Google once.'
            : 'Read & write asks Google once.',
      };
    return base;
  });
}
