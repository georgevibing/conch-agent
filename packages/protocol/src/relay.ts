/**
 * The always-on relay (ADR 0140): what the gateway and its relay say to each
 * other, and what the web app shows about it. The relay itself is a separate,
 * dependency-free program (`apps/relay`); the gateway validates everything it
 * hears from it with these, and everything it opens.
 */
import { z } from 'zod';

const B64URL = /^[A-Za-z0-9_-]+$/;

/** One sealed delivery, as `GET /relay/v1/next` hands it out. */
export const RelayItem = z.object({
  id: z.string().regex(B64URL).max(64),
  receivedAt: z.number().int().nonnegative(),
  enc: z.string().regex(B64URL).max(64),
  ct: z.string().regex(B64URL).max(2_000_000),
});
export type RelayItem = z.infer<typeof RelayItem>;

export const RelayNext = z.object({
  items: z.array(RelayItem).max(50),
  depth: z.number().int().nonnegative(),
});
export type RelayNext = z.infer<typeof RelayNext>;

/** `GET /relay/v1/status`. */
export const RelayWireStatus = z.object({
  protocol: z.literal(1),
  /** The relay seals to this key (`keyId` of the gateway's public key). */
  keyId: z.string().max(64),
  depth: z.number().int().nonnegative(),
  bytes: z.number().nonnegative(),
  oldestAt: z.number().optional(),
  hooks: z.number().int().nonnegative(),
  maxItems: z.number().int().positive(),
  ttlMs: z.number().int().positive(),
});
export type RelayWireStatus = z.infer<typeof RelayWireStatus>;

/**
 * What a sealed delivery opens to: the request as the sender made it, and
 * when it reached the relay. Every word of it is untrusted; the channel or
 * routine it's for checks the sender's own signature before reading it.
 */
export const RelayDelivery = z.object({
  v: z.literal(1),
  id: z.string().regex(B64URL).max(64),
  receivedAt: z.number().int().nonnegative(),
  hookId: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
  method: z.enum(['GET', 'POST']),
  query: z.record(z.string().max(200), z.string().max(4_000)),
  search: z.string().max(8_000).optional(),
  headers: z.record(z.string().max(200), z.string().max(16_000)),
  body: z.string().max(1024 * 1024),
});
export type RelayDelivery = z.infer<typeof RelayDelivery>;

/**
 * The relay as Settings shows it.
 *
 * - `off`: none set up;
 * - `pairing`: keys made, waiting for the person to deploy it and paste its address;
 * - `ready`: the public addresses Conch hands out lead to the relay, and it answers;
 * - `needs-you`: only a person can fix it (a key that doesn't match, set up on another computer);
 * - `error`: it was working and doesn't answer now (Repair tries again).
 */
export const RelayView = z.object({
  state: z.enum(['off', 'pairing', 'ready', 'needs-you', 'error']),
  /** The relay's HTTPS address, once it has one. */
  url: z.string().max(500).optional(),
  /** While pairing: what it's deployed with (no secret in it) and the commands that do it. */
  setup: z
    .object({
      code: z.string().max(200),
      /** Cloudflare Workers (free): run in `apps/relay` of a checkout. */
      worker: z.string().max(400),
      /** A Raspberry Pi or a Linux server with Node. */
      node: z.string().max(600),
      /** Docker (Fly.io, Render, a NAS). */
      docker: z.string().max(600),
    })
    .optional(),
  /** Deliveries waiting at the relay when last asked. */
  depth: z.number().int().nonnegative().optional(),
  oldestAt: z.number().optional(),
  /** When the gateway last heard from it. */
  checkedAt: z.number().optional(),
  /** Deliveries brought in since this gateway started. */
  drained: z.number().int().nonnegative().optional(),
  message: z.string().max(500).optional(),
});
export type RelayView = z.infer<typeof RelayView>;

/** `PUT /api/relay`: the address the relay answers at. */
export const SetRelayBody = z.object({ url: z.string().trim().min(1).max(500) });
export type SetRelayBody = z.infer<typeof SetRelayBody>;
