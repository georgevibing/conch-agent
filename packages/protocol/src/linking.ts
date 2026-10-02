/**
 * Linking a chat account by QR code (ADR 0043): WhatsApp and Signal have no
 * bots you can make, so Conch joins your own account as a linked device,
 * the way WhatsApp Web and Signal Desktop do.
 *
 * - `POST /api/channels/link` starts one (or links an existing channel again);
 * - `GET /api/channels/link/:id` says how it's going, `DELETE` stops it;
 * - `channel.link` on the main socket carries every change, codes included.
 *
 * The code is shown only to someone signed in to Conch, and only while it
 * waits to be scanned: whoever scans it links their account.
 */
import { z } from 'zod';

import { Id } from './common';

/** The apps that link by QR code. */
export const LinkableKind = z.enum(['whatsapp', 'signal']);
export type LinkableKind = z.infer<typeof LinkableKind>;

/**
 * Where a link is.
 *
 * - `starting`: asking the app for a code;
 * - `showing`: a code is on screen (it changes by itself every minute or two);
 * - `finishing`: scanned; the phone and Conch are setting it up;
 * - `linked`: done, and the channel is connected (`channelId`);
 * - `expired`: nobody scanned it in time; show a new one;
 * - `failed`: something went wrong (`message`), or it's another number than the one being relinked;
 * - `needs-install`: a program has to be installed first (`need`).
 */
export const ChannelLinkState = z.enum([
  'starting',
  'showing',
  'finishing',
  'linked',
  'expired',
  'failed',
  'needs-install',
]);
export type ChannelLinkState = z.infer<typeof ChannelLinkState>;

export const ChannelLink = z.object({
  id: Id,
  kind: LinkableKind,
  state: ChannelLinkState,
  /** What the QR code says, while `showing`. Never logged. */
  qr: z.string().max(4000).optional(),
  /** When this code is replaced (epoch ms). */
  refreshAt: z.number().optional(),
  /** When linking gives up if nobody scans (epoch ms). */
  expiresAt: z.number().optional(),
  /** One plain sentence, for `failed`. */
  message: z.string().max(500).optional(),
  /** For `needs-install`: what to get (a need id, ADR 0016). */
  need: z.string().max(64).optional(),
  /** Set when `linked`, and when relinking a channel that exists. */
  channelId: Id.optional(),
  /** Set when `linked`: the number it's linked to. */
  phone: z.string().max(32).optional(),
});
export type ChannelLink = z.infer<typeof ChannelLink>;

/** `POST /api/channels/link`: show a code for a new channel, or to link `channelId` again. */
export const StartChannelLinkBody = z.object({
  kind: LinkableKind,
  channelId: Id.optional(),
});
export type StartChannelLinkBody = z.infer<typeof StartChannelLinkBody>;
