/**
 * What every Google tool shares: which account a call means, and an email
 * in Conch's own plain shape (drafts and sending both).
 */
import { randomBytes } from 'node:crypto';

import type { GoogleAccount, GoogleCapability } from '@conch/protocol';
import { z } from 'zod';

import type { ReplyEnvelope } from './mail';
import { DOING, GoogleError, notAllowed, type GoogleService } from './service';

/**
 * Which Google account: its id or its email address, as `google_accounts`
 * lists them. Left out, the one account that can do the job is used; with
 * several, the tool says which and asks for a choice.
 */
export const accountRef = z
  .string()
  .trim()
  .min(1)
  .max(254)
  .optional()
  .describe(
    'The Google account: its email address or id from google_accounts. Leave it out when only one account can do this.',
  );

/**
 * The account a call means, checked against what the person lets it do.
 * Every account argument goes through here: an unknown one, one that isn't
 * allowed, or a choice between several is an error the model can act on.
 */
export async function pickAccount(
  service: GoogleService,
  ref: string | undefined,
  capability: GoogleCapability,
): Promise<GoogleAccount> {
  const accounts = (await service.status()).accounts;
  if (ref) {
    const wanted = ref.trim().toLowerCase();
    const matches = accounts.filter((a) => a.id === ref.trim() || a.email.toLowerCase() === wanted);
    const able = matches.find((a) => a.capabilities.includes(capability));
    if (able) return able;
    const first = matches[0];
    if (first) throw notAllowed(first, capability);
    throw new GoogleError(
      'invalid',
      `No Google account “${ref.slice(0, 100)}” is connected. Call google_accounts to see the ones that are.`,
    );
  }
  const able = accounts.filter((a) => a.capabilities.includes(capability));
  const only = able.length === 1 ? able[0] : undefined;
  if (only) return only;
  if (able.length)
    throw new GoogleError(
      'invalid',
      `Several Google accounts can ${DOING[capability]}: ${able.map((a) => a.email).join(', ')}. Pass accountId as one of those addresses; ask the person which one if it isn’t clear.`,
    );
  const lone = accounts.length === 1 ? accounts[0] : undefined;
  if (lone) throw notAllowed(lone, capability);
  throw new GoogleError(
    'scope',
    accounts.length
      ? `None of the connected Google accounts may ${DOING[capability]}. The person can allow it in Apps; offer that instead of trying again.`
      : 'No Google account is connected. Offer to connect one in Apps.',
  );
}

/**
 * The account an email goes from: the one named, or — when none is named and
 * several could send — the first that can (Google sign-in accounts first,
 * then app passwords, each in the order they were connected). `guessed` says
 * Conch chose it, so the person is shown it before anything goes.
 */
export async function pickSender(
  service: GoogleService,
  ref: string | undefined,
): Promise<{ account: GoogleAccount; guessed: boolean }> {
  if (ref) return { account: await pickAccount(service, ref, 'mail-send'), guessed: false };
  const able = (await service.status()).accounts.filter((a) =>
    a.capabilities.includes('mail-send'),
  );
  const first = able[0];
  if (first && able.length > 1) return { account: first, guessed: true };
  return { account: await pickAccount(service, undefined, 'mail-send'), guessed: false };
}

/** A file an email carries: from the chat's own files, never a path. */
export interface MailFile {
  name: string;
  mimeType: string;
  bytes: Buffer;
}

/** The most an email's files may come to: Gmail takes 25 MB, and base64 makes them a third bigger. */
export const MAIL_FILES_MAX_BYTES = 18 * 1024 * 1024;

const base64Lines = (bytes: Buffer) =>
  bytes
    .toString('base64')
    .match(/.{1,76}/g)
    ?.join('\r\n') ?? '';
/** A media type as it may go in a header: `type/subtype` and nothing else. */
const safeType = (type: string) =>
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,63}$/i.test(type)
    ? type.toLowerCase()
    : 'application/octet-stream';
/**
 * A file's name as it may go in headers: a plain-letters fallback in quotes,
 * and the real name encoded (RFC 2231, RFC 6266), so no name can break out.
 */
function fileNames(name: string): { ascii: string; encoded: string } {
  const clean =
    // eslint-disable-next-line no-control-regex -- a file name's control characters are what's taken out
    Array.from(name.replace(/[\u0000-\u001f\u007f/\\]/g, '_'))
      .slice(0, 200)
      .join('') || 'file';
  return {
    ascii: clean.replace(/[^A-Za-z0-9._ -]/g, '_'),
    encoded: Array.from(Buffer.from(clean, 'utf8'))
      .map((b) =>
        /[A-Za-z0-9._-]/.test(String.fromCharCode(b))
          ? String.fromCharCode(b)
          : `%${b.toString(16).toUpperCase().padStart(2, '0')}`,
      )
      .join(''),
  };
}

/** A whole email in Conch's own plain shape: only checked addresses, an encoded subject, a base64 body. */
export function composeRaw(
  args: { to: string[]; cc?: string[]; subject: string; body: string },
  envelope: {
    messageId: string;
    from?: string;
    reply?: ReplyEnvelope;
    /** Files it carries: then it's multipart/mixed, with a boundary no body can hold. */
    files?: readonly MailFile[];
  },
): string {
  const subject = (
    Array.from(args.subject)
      .join('')
      .match(/.{1,12}/gu) ?? ['']
  )
    .map((part) => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`)
    .join('\r\n ');
  const { reply, files } = envelope;
  // Base64 parts never hold "=_", so no part can end the message early.
  const boundary = `=_conch_${randomBytes(18).toString('base64url')}`;
  return [
    ...(envelope.from ? [`From: ${envelope.from}`] : []),
    `To: ${args.to.join(',\r\n ')}`,
    ...(args.cc?.length ? [`Cc: ${args.cc.join(',\r\n ')}`] : []),
    `Subject: ${subject}`,
    `Message-ID: ${envelope.messageId}`,
    ...(reply
      ? [
          `In-Reply-To: ${reply.inReplyTo}`,
          `References: ${reply.references.split(' ').join('\r\n ')}`,
        ]
      : []),
    `MIME-Version: 1.0`,
    ...(files?.length
      ? [
          `Content-Type: multipart/mixed; boundary="${boundary}"`,
          '',
          `--${boundary}`,
          `Content-Type: text/plain; charset=UTF-8`,
          `Content-Transfer-Encoding: base64`,
          '',
          base64Lines(Buffer.from(args.body)),
          ...files.flatMap((file) => {
            const { ascii, encoded } = fileNames(file.name);
            return [
              `--${boundary}`,
              `Content-Type: ${safeType(file.mimeType)}; name="${ascii}"`,
              `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
              `Content-Transfer-Encoding: base64`,
              '',
              base64Lines(file.bytes),
            ];
          }),
          `--${boundary}--`,
          '',
        ]
      : [
          `Content-Type: text/plain; charset=UTF-8`,
          `Content-Transfer-Encoding: base64`,
          '',
          base64Lines(Buffer.from(args.body)),
        ]),
  ].join('\r\n');
}
