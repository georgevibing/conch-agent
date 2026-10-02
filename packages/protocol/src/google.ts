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
