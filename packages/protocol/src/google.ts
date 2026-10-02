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
  callbackUrl: z.string().optional(),
  accounts: z.array(GoogleAccount),
});
export type GoogleStatus = z.infer<typeof GoogleStatus>;
export const GoogleConfigure = z.object({
  clientId: z.string().min(10).max(300).endsWith('.apps.googleusercontent.com'),
  clientSecret: z.string().min(8).max(500),
  redirectUrl: z.url().max(2000),
});
export const GoogleConnect = z.object({
  capabilities: z.array(GoogleCapability).min(1).max(4),
  accountId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,128}$/)
    .optional(),
});
export const GoogleConnectResult = z.object({ url: z.url(), flowId: z.string() });
export const GoogleFlowStatus = z.object({
  state: z.enum(['pending', 'ready', 'failed']),
  accountId: z.string().optional(),
});
