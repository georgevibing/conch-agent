import {
  GoogleFlowStatus,
  GoogleConfigure,
  GoogleImport,
  GoogleComplete,
  GoogleConnect,
  GoogleConnectResult,
  GoogleStatus,
  GmailPasswordConnect,
  GmailReusable,
  type GoogleAppId,
} from '@conch/protocol';
import { z } from 'zod';
import { request } from '../../api/client';
export const googleApi = {
  flow: (id: string) => request(GoogleFlowStatus, `/api/google/flows/${encodeURIComponent(id)}`),
  status: () => request(GoogleStatus, '/api/google'),
  importCredentials: (credentials: string) =>
    request(GoogleStatus, '/api/google/import', {
      method: 'POST',
      body: GoogleImport.parse({ credentials }),
    }),
  complete: (id: string, redirectUrl: string) =>
    request(GoogleFlowStatus, `/api/google/flows/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: GoogleComplete.parse({ redirectUrl }),
    }),
  cancel: (id: string) =>
    request(z.object({ ok: z.boolean() }), `/api/google/flows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  configure: (body: z.input<typeof GoogleConfigure>) =>
    request(GoogleStatus, '/api/google/configure', {
      method: 'POST',
      body: GoogleConfigure.parse(body),
    }),
  connect: (body: z.infer<typeof GoogleConnect>) =>
    request(GoogleConnectResult, '/api/google/connect', {
      method: 'POST',
      body: GoogleConnect.parse(body),
    }),
  check: (id: string) =>
    request(GoogleStatus, `/api/google/accounts/${encodeURIComponent(id)}/check`, {
      method: 'POST',
      body: {},
    }),
  /** Gmail with an app password: checked by signing in before it's kept (ADR 0048). */
  connectPassword: (body: z.input<typeof GmailPasswordConnect>) =>
    request(GoogleStatus, '/api/google/mail/password', {
      method: 'POST',
      body: GmailPasswordConnect.parse(body),
    }),
  /** Whether the email channel already signs in to Gmail (only its address). */
  reusable: () => request(GmailReusable, '/api/google/mail/reusable'),
  /** Use the email channel's Gmail sign-in for Gmail too, after a person said yes. */
  reuse: () => request(GoogleStatus, '/api/google/mail/reuse', { method: 'POST', body: {} }),
  /** An account already connected, used for this app again. */
  useApp: (app: GoogleAppId) =>
    request(z.object({ ok: z.boolean() }), `/api/google/apps/${encodeURIComponent(app)}/use`, {
      method: 'POST',
      body: {},
    }),
  disconnect: (id: string) =>
    request(z.object({ ok: z.boolean() }), `/api/google/accounts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
