/**
 * Check-ins and standing orders (ADR 0107).
 *
 * A standing order is something the person said once, in their own words, for
 * every chat and every check-in: "always tell me if a flight changes", "you
 * may archive newsletters". Only the person keeps one (in Routines, or with
 * Keep it on a card the assistant offered). It says what they want and what
 * they welcome; it never grants a permission: every action still goes through
 * the permission mode (ADR 0100), as memories never grant tool authority
 * (ADR 0097).
 *
 * The check-in looks at what's new (mail, the next meetings) every half hour
 * outside quiet hours, with no model until something new is there, then asks
 * the provider's cheapest model whether any of it is what a standing order
 * asks to hear about. It tells the person only then, and says why.
 */
import { z } from 'zod';

import { ClockTime } from './routines';

// ── Standing orders ─────────────────────────────────────────────────────────

/**
 * `tell`: what's worth hearing about ("tell me if…"); the check-in watches for
 * it. `may`: what the person welcomes the assistant to do ("you may…"). Never a
 * permission: the permission mode still decides what asks.
 */
export const StandingOrderKind = z.enum(['tell', 'may']);
export type StandingOrderKind = z.infer<typeof StandingOrderKind>;

/** At most this many: a short list a person can read in a glance. */
export const MAX_STANDING_ORDERS = 20;

/** One line in the person's words. */
export const StandingOrderText = z
  .string()
  .trim()
  .min(3, 'Say a little more.')
  .max(240, 'Keep it to a sentence.')
  .regex(/^[^\r\n]+$/, 'One line, please.');

export const StandingOrder = z.object({
  id: z.string(),
  /** The person's own words, as they kept them. */
  text: z.string().max(240),
  kind: StandingOrderKind,
  /**
   * `on`: every chat and the check-in keep it in mind. `off`: kept, not used.
   * `draft`: the assistant suggested it in a chat; nothing uses it until the
   * person presses Keep it.
   */
  state: z.enum(['on', 'off', 'draft']),
  /** `you`: typed in Routines; `chat`: suggested in a chat and kept from its card. */
  from: z.enum(['you', 'chat']),
  /** The chat it was suggested in. */
  conversationId: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /**
   * It asks for something only the permission mode can give ("without
   * asking"): Conch says so beside it, and nothing changes what asks.
   */
  power: z.boolean().optional(),
  /** How many times the check-in told you something because of it. */
  told: z.number().int().nonnegative().default(0),
  lastToldAt: z.number().optional(),
});
export type StandingOrder = z.infer<typeof StandingOrder>;

export const StandingOrders = z.object({ orders: z.array(StandingOrder) });
export type StandingOrders = z.infer<typeof StandingOrders>;

/** A person adds one in Routines. Without `kind`, Conch reads it from the words. */
export const CreateStandingOrderBody = z
  .object({ text: StandingOrderText, kind: StandingOrderKind.optional() })
  .strict();
export type CreateStandingOrderBody = z.infer<typeof CreateStandingOrderBody>;

/** Change the words, the kind, or turn it on or off; `on` on a draft is Keep it. */
export const UpdateStandingOrderBody = z
  .object({
    text: StandingOrderText,
    kind: StandingOrderKind,
    state: z.enum(['on', 'off']),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change.' });
export type UpdateStandingOrderBody = z.infer<typeof UpdateStandingOrderBody>;

/** "You may…", "feel free to…", "go ahead and…": what's welcome rather than what to say. */
const MAY =
  /^(?:(?:you|conch)\s+(?:may|can|are\s+allowed\s+to|have\s+my\s+ok\s+to)|feel\s+free\s+to|go\s+ahead\s+and|it'?s\s+(?:fine|ok(?:ay)?)\s+(?:to|if\s+you)|(?:please\s+)?(?:always\s+)?(?:archive|delete|unsubscribe|file|label|mark|move|reply|decline|accept|tidy|clean))\b/i;

/** Words that ask for a power only the permission mode gives. */
const POWER =
  /\b(?:without\s+(?:asking|checking|confirm\w*|my\s+ok|permission|approval)|don'?t\s+(?:ask|check\s+with\s+me)|never\s+ask|no\s+need\s+to\s+ask|auto[-\s]?approv\w*|full\s+trust|bypass|skip\s+(?:the\s+)?(?:approval|check)s?|any\s+command|sudo|admin(?:istrator)?\s+rights?|my\s+password|spend\s+(?:any|whatever))\b/i;

/** What kind an order is, read from the words: `may` for what's welcome, else `tell`. */
export function standingOrderKind(text: string): StandingOrderKind {
  return MAY.test(text.trim()) ? 'may' : 'tell';
}

/** It reaches for a power a standing order can't give (ADR 0107): Conch says so. */
export function standingOrderPower(text: string): boolean {
  return POWER.test(text);
}

/** What Conch says beside one that reaches for a power. */
export const STANDING_ORDER_POWER_NOTE =
  'A standing order can’t change what Conch asks about. It still asks first wherever your permission mode does.';

/** How each kind is said on its chip. */
export const STANDING_ORDER_KIND_WORDS: Record<StandingOrderKind, string> = {
  tell: 'Tell me',
  may: 'You may',
};

// ── The check-in ────────────────────────────────────────────────────────────

/** No check-ins between these times (the person's own clock). */
export const QuietHours = z.object({ from: ClockTime, to: ClockTime });
export type QuietHours = z.infer<typeof QuietHours>;

export const QUIET_HOURS_DEFAULT: QuietHours = { from: '22:00', to: '07:00' };
/** How often it looks, in minutes (OpenClaw's heartbeat is every 30). */
export const CHECK_IN_EVERY_DEFAULT = 30;

/** Something the check-in told you, and why. */
export const ToldThing = z.object({
  id: z.string(),
  at: z.number(),
  source: z.enum(['mail', 'calendar']),
  /** Conch's words for what it is: "Anna Smith’s email “Flight LH 452 changed”". */
  label: z.string().max(200),
  /** What matters about it, in a few words (a small model's, cleaned by Conch). */
  note: z.string().max(160).optional(),
  /** Why you're hearing this, in Conch's words around yours: "You asked: “…”". */
  why: z.string().max(300),
  /** The standing order it was about. */
  orderId: z.string().optional(),
  /** Where it is (Gmail, the calendar). */
  link: z.url().max(2000).optional(),
  /** Over the look's or the day's few: listed here, without a notification. */
  quiet: z.boolean().optional(),
});
export type ToldThing = z.infer<typeof ToldThing>;

export const CheckInState = z.enum([
  /** Looking now and then, and fine. */
  'watching',
  /** Inside quiet hours: it looks again once they end. */
  'quiet',
  /** No standing order asks to hear about anything: nothing to look for, nothing spent. */
  'resting',
  /** Only a person can fix what it reads (Gmail signed out, nothing connected). */
  'needs-you',
  /** Waiting on spending (the month's limit, a plan nearly used). */
  'held',
  /** Turned off. */
  'off',
]);
export type CheckInState = z.infer<typeof CheckInState>;

export const CheckInStatus = z.object({
  on: z.boolean(),
  quiet: QuietHours,
  everyMinutes: z.number().int().min(15).max(240),
  state: CheckInState,
  /** One sentence for the state, in Conch's words. */
  message: z.string().max(300).optional(),
  /** One next step for `needs-you`: open a settings place. */
  fix: z
    .object({ label: z.string().max(40), place: z.string().max(40), focus: z.string().optional() })
    .optional(),
  lastLookAt: z.number().optional(),
  nextLookAt: z.number().optional(),
  /** This month: looks, the few that needed a model, and what those cost (USD). */
  month: z.object({
    looks: z.number().int().nonnegative(),
    woke: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
  }),
  /** What it told you lately, newest first. */
  told: z.array(ToldThing).max(50),
});
export type CheckInStatus = z.infer<typeof CheckInStatus>;

/** A person's choices: on or off, quiet hours, how often. Never the assistant's. */
export const CheckInBody = z
  .object({
    on: z.boolean(),
    quiet: QuietHours,
    everyMinutes: z.number().int().min(15).max(240),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change.' });
export type CheckInBody = z.infer<typeof CheckInBody>;

/** Whether `minutes` past midnight falls inside quiet hours that may cross midnight. */
export function inQuietHours(minutes: number, quiet: QuietHours): boolean {
  const at = (t: string) => {
    const [h = '0', m = '0'] = t.split(':');
    return Number(h) * 60 + Number(m);
  };
  const from = at(quiet.from);
  const to = at(quiet.to);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}
