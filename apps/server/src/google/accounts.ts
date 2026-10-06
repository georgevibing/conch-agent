/**
 * What every Google tool shares: which account a call means, and an email
 * in Conch's own plain shape (drafts and sending both).
 */
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
  throw new GoogleError(
    'scope',
    accounts.length
      ? `None of the connected Google accounts may ${DOING[capability]}. The person can allow it in Apps; offer that instead of trying again.`
      : 'No Google account is connected. Offer to connect one in Apps.',
  );
}

/** A whole email in Conch's own plain shape: only checked addresses, an encoded subject, a base64 body. */
export function composeRaw(
  args: { to: string[]; cc?: string[]; subject: string; body: string },
  envelope: { messageId: string; from?: string; reply?: ReplyEnvelope },
): string {
  const subject = (
    Array.from(args.subject)
      .join('')
      .match(/.{1,12}/gu) ?? ['']
  )
    .map((part) => `=?UTF-8?B?${Buffer.from(part).toString('base64')}?=`)
    .join('\r\n ');
  const { reply } = envelope;
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
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: base64`,
    '',
    Buffer.from(args.body)
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') ?? '',
  ].join('\r\n');
}
