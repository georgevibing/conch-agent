/**
 * When… — routines that start because something happened (ADR 0056).
 *
 * A routine starts either at a time (`Schedule`, ADR 0006) or when something
 * happens (`Trigger`). Triggers are structured, like schedules, so Conch can
 * check them cheaply without a model and describe them in its own words.
 */
import { z } from 'zod';

/** An id that becomes part of a file name or an address. */
const SafeId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** A word or phrase to look for: short, one line. */
export const TriggerWord = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^\r\n"]+$/, 'One word or phrase, without quotes.');

/** Someone whose mail starts it: an address, a name as Gmail shows it, or both. */
export const MailSender = z
  .object({
    address: z.string().trim().toLowerCase().max(254).pipe(z.email()).optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\r\n"()]+$/)
      .optional(),
  })
  .refine((s) => s.address || s.name, { error: 'Say who: a name or an address.' });
export type MailSender = z.infer<typeof MailSender>;

/** Shortest wait between two looks at a page. */
export const MIN_PAGE_MINUTES = 15;

export const Trigger = z.discriminatedUnion('kind', [
  /** An email arrives (Gmail), from someone and/or with some words. */
  z.object({
    kind: z.literal('mail'),
    from: z.array(MailSender).max(10).default([]),
    words: z.array(TriggerWord).max(10).default([]),
    /** One Google account; every connected one when left out. */
    account: SafeId.optional(),
  }),
  /** Some minutes before a calendar event starts (Google Calendar). */
  z.object({
    kind: z.literal('calendar'),
    minutesBefore: z.number().int().min(1).max(1440).default(15),
    /** Only events with someone else in them (meetings, not reminders to yourself). */
    withOthers: z.boolean().default(false),
    words: z.array(TriggerWord).max(10).default([]),
    account: SafeId.optional(),
  }),
  /** A web page's readable text changes. */
  z.object({
    kind: z.literal('page'),
    url: z.url({ protocol: /^https?$/ }).max(2000),
    /** Minutes between looks. */
    every: z.number().int().min(MIN_PAGE_MINUTES).max(10_080).default(60),
  }),
  /** Something in a folder on this computer changes. */
  z.object({ kind: z.literal('folder'), path: z.string().min(1).max(1000) }),
  /** A background task finishes (ADR 0033). */
  z.object({ kind: z.literal('task') }),
  /** Another routine runs (and finishes well). */
  z.object({ kind: z.literal('routine'), routineId: SafeId }),
  /**
   * Another app sends a message to an address on the public door (ADR 0045).
   * The id is made by Conch, never chosen by anyone.
   */
  z.object({
    kind: z.literal('hook'),
    hookId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,64}$/)
      .optional(),
  }),
]);
export type Trigger = z.infer<typeof Trigger>;
export type TriggerKind = Trigger['kind'];

/** "Only if it's about the invoice": checked by a small model before a run (ADR 0056). */
export const OnlyIf = z.string().trim().max(300);

/**
 * The schedule a When-routine's file keeps for Conch versions that don't know
 * triggers: a one-off that already passed, so they never run it (ADR 0051).
 */
export const WHEN_SCHEDULE = { type: 'once', at: '2000-01-01T00:00:00Z' } as const;

/** How a When-routine's source is doing, for its card and Repair everything. */
export const WatchState = z.object({
  state: z.enum([
    /** Looking, and fine. */
    'watching',
    /** Something only a person can fix (signed out, a folder gone, the door off). */
    'needs-you',
    /** Failing for a while; Conch keeps trying. */
    'trouble',
    /** Paused or a draft: not looking. */
    'off',
  ]),
  message: z.string().max(300).optional(),
  /** One next step for `needs-you`: open a settings place. */
  fix: z
    .object({ label: z.string().max(40), place: z.string().max(40), focus: z.string().optional() })
    .optional(),
  /** Things noticed, and runs started, since it was turned on. */
  noticed: z.number().int().nonnegative().default(0),
  woke: z.number().int().nonnegative().default(0),
  /** Passed over by its "only if". */
  passed: z.number().int().nonnegative().default(0),
  lastNoticedAt: z.number().optional(),
  checkedAt: z.number().optional(),
  /** Waiting to go in the next run (a burst, or the hour's runs are used). */
  waiting: z.number().int().nonnegative().default(0),
  /** Another app's address, while the public door is on. */
  address: z.string().optional(),
  /** Whether that address checks a signature. */
  signed: z.boolean().optional(),
});
export type WatchState = z.infer<typeof WatchState>;

/** What started an event run, for its history line and its link. */
export const RunEvent = z.object({
  /** "Anna Smith’s email", "the page’s changes", "Weekly sync". */
  label: z.string().max(160),
  /** Where it is (Gmail, the calendar, the page), when it has an address. */
  link: z.url().max(2000).optional(),
  /** How many things this run saw together. */
  count: z.number().int().min(1).default(1),
  /** The condition was checked, or couldn't be (and it ran anyway). */
  onlyIf: z.enum(['matched', 'unchecked']).optional(),
  /** The routines whose runs led to this one, oldest first (a chain stops at five). */
  chain: z.array(z.string().max(128)).max(10).optional(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const WhenPreviewBody = z.object({ when: Trigger, onlyIf: OnlyIf.optional() });
export const WhenPreview = z.object({
  valid: z.boolean(),
  /** "When Anna Smith emails you". */
  text: z.string(),
  /** How it looks, in a sentence: "Conch looks every 2 minutes." */
  note: z.string().optional(),
  error: z.string().optional(),
});
export type WhenPreview = z.infer<typeof WhenPreview>;

/** People you write to, for picking whose mail starts a routine. */
export const MailPeople = z.object({
  people: z.array(z.object({ address: z.string(), name: z.string().optional() })),
  /** Why there's nobody to pick from (no Gmail yet), in a sentence. */
  note: z.string().optional(),
});
export type MailPeople = z.infer<typeof MailPeople>;

/** A new secret for another app's address: shown once, here, and never again. */
export const HookSecret = z.object({ secret: z.string() });
export type HookSecret = z.infer<typeof HookSecret>;
