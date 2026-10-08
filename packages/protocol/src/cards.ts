/**
 * Doing something with a card in the chat (ADR 0105): save it as a picture,
 * copy it, or **send it to a chat app**. Only the last needs the gateway.
 *
 * The page draws the card as a PNG itself, uploads it like any other
 * attachment (`POST /api/attachments`) and then asks Conch to send *that
 * attachment* to this person's own chat in one of their apps. The request
 * never carries an address, a phone number or a handle: who it reaches is the
 * owner of this Conch, and nothing in the body can change that.
 */
import { z } from 'zod';

import { Id } from './common';
import { ChannelKind } from './channels';

/** What a person can write under the picture. A line or two, not an essay. */
export const CARD_CAPTION_MAX = 400;

/**
 * A chat app this person can be reached on right now, for a card's Send menu.
 * (Nacre's `ShareApp` is the same shape as a component's prop; this is the
 * wire's own, so the two names don't collide in one file.)
 */
export const SendableApp = z.object({
  /** The channel's id. */
  id: Id,
  kind: ChannelKind,
  /** What it's called, as a person says it: "Telegram". */
  name: z.string().min(1).max(60),
  /** Its brand colour, for the logo tile. */
  color: z.string().max(32).optional(),
});
export type SendableApp = z.infer<typeof SendableApp>;

/**
 * `GET /api/cards/apps` — the chat apps a card can be sent to, the one this
 * person wrote from last first (the one `message_user` would pick). Empty when
 * none is connected: then the card has no **Send** button at all.
 */
export const SendableApps = z.object({ apps: z.array(SendableApp).default([]) });
export type SendableApps = z.infer<typeof SendableApps>;

/**
 * `POST /api/cards/send` — send a picture of a card to a chat app. The
 * attachment must already belong to this conversation (the page claimed it
 * when it uploaded it), and `app` is a name or kind from `GET
 * /api/cards/apps`; without one, the app they wrote from last.
 */
export const SendCardBody = z.object({
  conversationId: Id,
  /** The PNG the page uploaded, claimed by this conversation. */
  attachmentId: Id,
  /** A line under the picture. */
  caption: z.string().trim().max(CARD_CAPTION_MAX).optional(),
  /** Which app, by name or kind ("Telegram", "telegram"). */
  app: z.string().trim().min(1).max(40).optional(),
});
export type SendCardBody = z.infer<typeof SendCardBody>;

/** What sending came to, in the words the person is shown. */
export const SentCard = z.object({
  /** The app it went to: "Telegram". */
  app: z.string().min(1).max(60),
  /** The files that went, by name. */
  sent: z.array(z.string()).default([]),
  /** Anything that couldn't go, and why. */
  missed: z.array(z.string()).default([]),
});
export type SentCard = z.infer<typeof SentCard>;
