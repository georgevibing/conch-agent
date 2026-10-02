import { z } from 'zod';

export const GoogleCapability = z.enum(['mail-read', 'mail-draft', 'calendar-read', 'drive-read']);
export type GoogleCapability = z.infer<typeof GoogleCapability>;
export const GoogleAccount = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  capabilities: z.array(GoogleCapability),
  state: z.enum(['ready', 'needs-auth', 'unavailable']),
  message: z.string().optional(),
  checkedAt: z.number().optional(),
  /**
   * How it's signed in: Google's own sign-in through your Google Cloud app, or
   * an app password, which only reaches Gmail (IMAP) and never sends (ADR 0048).
   */
  via: z.enum(['google', 'app-password']).default('google'),
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
  capabilities: z.array(GoogleCapability).min(1).max(4),
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
  state: z.enum(['pending', 'ready', 'failed']),
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
  gmail: ['mail-read', 'mail-draft'],
  'google-calendar': ['calendar-read'],
  'google-drive': ['drive-read'],
};

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
