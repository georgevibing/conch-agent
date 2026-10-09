import { z } from 'zod';

/**
 * What one Google account lets Conch do, one job at a time. Reading comes
 * first; each write is its own capability so a tool needs exactly one.
 * `mail-draft` and `mail-send` both come with Gmail's write access: Google's
 * compose permission allows either, and Conch asks before every one.
 */
export const GoogleCapability = z.enum([
  'mail-read',
  'mail-draft',
  'mail-send',
  'calendar-read',
  'calendar-write',
  'drive-read',
  'drive-write',
]);
export type GoogleCapability = z.infer<typeof GoogleCapability>;

/** The three Google products an account can reach. */
export const GoogleProduct = z.enum(['gmail', 'calendar', 'drive']);
export type GoogleProduct = z.infer<typeof GoogleProduct>;
/** How far Conch may go in one product: look, or look and change. */
export const GoogleAccess = z.enum(['read', 'write']);
export type GoogleAccess = z.infer<typeof GoogleAccess>;
/** A person's choice for one product of one account: off is a level too. */
export const GoogleLevel = z.enum(['off', 'read', 'write']);
export type GoogleLevel = z.infer<typeof GoogleLevel>;
/** Each product's level, where it has one. A product left out is off. */
export const GoogleAccessMap = z.partialRecord(GoogleProduct, GoogleAccess);
export type GoogleAccessMap = z.infer<typeof GoogleAccessMap>;

/** The capabilities each level of each product brings. Write includes read. */
export const GOOGLE_LEVEL_CAPABILITIES: Record<
  GoogleProduct,
  Record<GoogleAccess, GoogleCapability[]>
> = {
  gmail: { read: ['mail-read'], write: ['mail-read', 'mail-draft', 'mail-send'] },
  calendar: { read: ['calendar-read'], write: ['calendar-read', 'calendar-write'] },
  drive: { read: ['drive-read'], write: ['drive-read', 'drive-write'] },
};
/** Which product a capability belongs to. */
export const productOf = (capability: GoogleCapability): GoogleProduct =>
  capability.startsWith('mail-')
    ? 'gmail'
    : capability.startsWith('calendar-')
      ? 'calendar'
      : 'drive';
const RANK: Record<GoogleLevel, number> = { off: 0, read: 1, write: 2 };
/** Compare levels: off < read < write. */
export const levelRank = (level: GoogleLevel | undefined) => RANK[level ?? 'off'];
/** The lower of two levels. */
export const lowerLevel = (a: GoogleLevel | undefined, b: GoogleLevel | undefined): GoogleLevel =>
  levelRank(a) <= levelRank(b) ? (a ?? 'off') : (b ?? 'off');
/** The capabilities an access map brings, in a stable order. */
export function capabilitiesFor(access: GoogleAccessMap): GoogleCapability[] {
  const wanted = new Set(
    GoogleProduct.options.flatMap((p) => {
      const level = access[p];
      return level ? GOOGLE_LEVEL_CAPABILITIES[p][level] : [];
    }),
  );
  return GoogleCapability.options.filter((c) => wanted.has(c));
}
/**
 * The access a set of capabilities amounts to: a product is `write` when any
 * of its write capabilities is there (an older Gmail that could only save
 * drafts counts as write), `read` when it can read.
 */
export function accessOf(capabilities: readonly GoogleCapability[]): GoogleAccessMap {
  const out: GoogleAccessMap = {};
  for (const product of GoogleProduct.options) {
    const { read, write } = GOOGLE_LEVEL_CAPABILITIES[product];
    if (write.some((c) => !read.includes(c) && capabilities.includes(c))) out[product] = 'write';
    else if (read.every((c) => capabilities.includes(c))) out[product] = 'read';
  }
  return out;
}

export const GoogleAccount = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  /** What Conch may do with it now: what it allows, held to what the person chose. */
  capabilities: z.array(GoogleCapability),
  state: z.enum(['ready', 'needs-auth', 'unavailable']),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
  /**
   * How it's signed in: Google's own sign-in through your Google Cloud app, or
   * an app password, which only reaches Gmail (IMAP and SMTP) (ADR 0048).
   */
  via: z.enum(['google', 'app-password']).default('google'),
  /** Per product, what Conch may do now (`capabilities`, by product). */
  access: GoogleAccessMap.optional(),
  /** Per product, the most the sign-in allows. Going higher needs Google's consent again. */
  granted: GoogleAccessMap.optional(),
});
export type GoogleAccount = z.infer<typeof GoogleAccount>;
export const GoogleStatus = z.object({
  configured: z.boolean(),
  clientType: z.enum(['desktop', 'web']).optional(),
  projectId: z.string().optional(),
  callbackUrl: z.string().optional(),
  accounts: z.array(GoogleAccount),
});
export type GoogleStatus = z.infer<typeof GoogleStatus>;
export const GoogleConfigure = z.object({
  clientType: z.enum(['desktop', 'web']).default('web'),
  clientId: z.string().min(10).max(300).endsWith('.apps.googleusercontent.com'),
  clientSecret: z.string().min(8).max(500),
  redirectUrl: z.url().max(2000).optional(),
  projectId: z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/)
    .optional(),
});
export const GOOGLE_CREDENTIAL_LIMIT = 32_768;
export const GoogleImport = z.object({
  credentials: z.string().min(1).max(GOOGLE_CREDENTIAL_LIMIT),
});
const DownloadedClient = z.object({
  client_id: GoogleConfigure.shape.clientId,
  client_secret: GoogleConfigure.shape.clientSecret,
  project_id: GoogleConfigure.shape.projectId,
  redirect_uris: z.array(z.url().max(2000)).max(100).optional(),
});
const DownloadedFile = z.object({
  installed: DownloadedClient.optional(),
  web: DownloadedClient.optional(),
  type: z.string().optional(),
});

/** Pick only credentials, never endpoints supplied by the file. No raw JSON in errors. */
export function parseGoogleCredentials(
  text: string,
  callbackUrl: string,
): z.infer<typeof GoogleConfigure> {
  if (text.length > GOOGLE_CREDENTIAL_LIMIT)
    throw new Error(
      'This file is too large. Choose the small OAuth client JSON downloaded from Google.',
    );
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(
      'This is not a Google credential JSON file. In Google Auth Platform, open Clients and download the JSON.',
    );
  }
  const parsed = DownloadedFile.safeParse(raw);
  if (parsed.success && parsed.data.type === 'service_account')
    throw new Error('This is a service-account key. Create a Desktop app OAuth client instead.');
  if (!parsed.success || !!parsed.data.installed === !!parsed.data.web)
    throw new Error(
      'Choose one Desktop app or Web application OAuth client JSON, not an API key or service-account key.',
    );
  const client = parsed.data.installed ?? parsed.data.web;
  if (!client) throw new Error('Choose a Desktop app or Web application OAuth client JSON.');
  if (parsed.data.web && !client.redirect_uris?.includes(callbackUrl))
    throw new Error(
      'This Web client does not include this Conch callback. Add the callback shown below in Google Auth Platform → Clients, then download the JSON again.',
    );
  return GoogleConfigure.parse({
    clientType: parsed.data.installed ? 'desktop' : 'web',
    clientId: client.client_id,
    clientSecret: client.client_secret,
    projectId: client.project_id,
    ...(parsed.data.web ? { redirectUrl: callbackUrl } : {}),
  });
}
export const GoogleConnect = z.object({
  capabilities: z.array(GoogleCapability).min(1).max(GoogleCapability.options.length),
  accountId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export const GoogleConnectResult = z.object({
  url: z.url(),
  flowId: z.string(),
  mode: z.enum(['automatic', 'manual']).default('automatic'),
});
export const GoogleComplete = z.object({ redirectUrl: z.url().max(8192) });
export const GoogleFlowStatus = z.object({
  /**
   * `returned`: Google sent the person back to another browser (a phone's Conch app
   * opens Google in Safari); the window that started it presses Finish to connect.
   */
  state: z.enum(['pending', 'returned', 'ready', 'failed']),
  accountId: z.string().optional(),
  mode: z.enum(['automatic', 'manual']).optional(),
  expiresAt: z.number().optional(),
  message: z.string().optional(),
});

/** The Google apps Conch runs itself, by their catalog ids (ADR 0048). */
export const GoogleAppId = z.enum(['gmail', 'google-calendar', 'google-drive']);
export type GoogleAppId = z.infer<typeof GoogleAppId>;
/** What each app needs from an account: one capability is enough to show it. */
export const GOOGLE_APP_CAPABILITIES: Record<GoogleAppId, GoogleCapability[]> = {
  gmail: GOOGLE_LEVEL_CAPABILITIES.gmail.write,
  'google-calendar': GOOGLE_LEVEL_CAPABILITIES.calendar.write,
  'google-drive': GOOGLE_LEVEL_CAPABILITIES.drive.write,
};
/** Which product each Google app is. */
export const GOOGLE_APP_PRODUCT: Record<GoogleAppId, GoogleProduct> = {
  gmail: 'gmail',
  'google-calendar': 'calendar',
  'google-drive': 'drive',
};
/** One product's level for one account, as a person sets it (Apps → a Google app → Accounts). */
export const GoogleAccessChange = z.object({ product: GoogleProduct, level: GoogleLevel });
export type GoogleAccessChange = z.infer<typeof GoogleAccessChange>;

/** A Google app password: four groups of four letters, as Google shows it. */
export const GMAIL_APP_PASSWORD = /^[a-z]{16}$/i;
/** Gmail with an app password (IMAP): the address and the 16 letters, checked by signing in. */
export const GmailPasswordConnect = z.object({
  address: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z
    .string()
    .max(64)
    .transform((p) => p.replace(/\s+/g, ''))
    .refine((p) => GMAIL_APP_PASSWORD.test(p), {
      error: 'An app password is 16 letters, like “abcd efgh ijkl mnop”.',
    }),
  /** What Gmail may do: read only, or read and write (drafts and sending, each asked first). */
  access: GoogleAccess.optional(),
  /** Replace the password of the account already connected with this address. */
  accountId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export type GmailPasswordConnect = z.infer<typeof GmailPasswordConnect>;
/** The email channel's Gmail sign-in, offered for Gmail too (never shared without asking). */
export const GmailReusable = z.object({ address: z.string().optional() });
export type GmailReusable = z.infer<typeof GmailReusable>;
