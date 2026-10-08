/**
 * The chat knows Conch (ADR 0060). What the assistant can put in a chat
 * besides words: an offer to turn on what it lacks, a question with answers
 * to tap, replies to send next, a plan that ticks itself off, and a view of
 * what a tool found. Each is a log event, so it replays on every device.
 */
import { z } from 'zod';

import { MarketTrust } from './market-basics';
import { Attachment } from './attachments';
import { WeatherView } from './views/weather';
import { RecipeView } from './views/recipe';
import { ProductsView } from './views/products';
import { PlacesView } from './views/places';
import { AudioView } from './views/audio';
import { VideosView } from './views/video';
import { BooksView, KnowledgeView, LinksView, ShowsView } from './views/knowledge';

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
/** An ISO 8601 date or date-time, as a tool read it. */
const When = z.string().min(4).max(40);
/** Only web links leave the chat; anything else is dropped before it's drawn. */
const WebUrl = z
  .string()
  .max(2000)
  .regex(/^https?:\/\//i, 'Only web links.');

// ── Offers ──────────────────────────────────────────────────────────────────

/** What can be offered: an app from the catalog, or a skill that's off or waits to be asked. */
/** An app to connect, a skill of yours to turn on, or one from Discover to add (ADR 0074). */
export const OfferKind = z.enum(['app', 'skill', 'market', 'provider']);
export type OfferKind = z.infer<typeof OfferKind>;

/**
 * An offer to turn on the one thing this request is missing, right where it
 * was asked. Pressing is the person's choice; nothing is turned on by the
 * assistant. When it's on, the chat carries on with `resume` by itself.
 */
export const Offer = z.object({
  offerId: z.string().min(1).max(64),
  kind: OfferKind,
  /** The catalog id for an app, the skill's id for a skill, the listing's id on Discover. */
  target: z.string().min(1).max(240),
  name: z.string().min(1).max(80),
  /** What it lets the assistant do: the catalog's or the skill's own line. */
  description: z.string().max(300),
  /** Why it helps with this request, in the assistant's words: one sentence. */
  why: z.string().max(200).optional(),
  /** Brand colour for an app's logo tile. */
  color: Hex.optional(),
  /** Who noticed: the person's words named it (`cue`), or the assistant asked (`assistant`). */
  by: z.enum(['cue', 'assistant']),
  /** For a skill: `off` needs turning on; `manual` only waits to be asked. */
  skillMode: z.enum(['off', 'manual']).optional(),
  /** For a skill from Discover: where it's from and what that place says, for the card. */
  market: z
    .object({
      sourceLabel: z.string().max(40),
      publisher: z.string().max(80),
      trust: MarketTrust,
      installs: z.number().int().nonnegative().optional(),
    })
    .optional(),
  /** The request to carry on with once it's on; absent when there's nothing to resume. */
  resume: z.object({ request: z.string().min(1).max(4000) }).optional(),
});
export type Offer = z.infer<typeof Offer>;

/** How an offer ended: turned on (and the chat carried on), put away, or overtaken. */
export const OfferOutcome = z.enum(['accepted', 'dismissed', 'expired']);
export type OfferOutcome = z.infer<typeof OfferOutcome>;

/**
 * Taking an offer (`POST /api/conversations/:id/offers/:offerId/accept`).
 * An app was connected by then, so there's nothing to say. A skill is turned
 * on for good (`on`: **Turn on**, **Always**) or used for this request only
 * (`once`: **Use it**); either way the request runs with it.
 */
export const AcceptOfferBody = z.object({ skill: z.enum(['on', 'once']).optional() }).strict();
export type AcceptOfferBody = z.infer<typeof AcceptOfferBody>;

/** “Not now” on an offer: nothing more to say. */
export const DismissOfferBody = z.object({}).strict();
export type DismissOfferBody = z.infer<typeof DismissOfferBody>;

/**
 * “Don’t suggest” for every skill from Discover (ADR 0074): one key, in the
 * shape older versions already accept for a skill.
 */
export const MUTED_MARKET = 'skill:market_discover';

/** A skill in “Don’t suggest” (`preferences.mutedSuggestions`), beside apps' catalog ids. */
export const MutedSkill = z
  .string()
  .regex(/^skill:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/, 'Unknown skill.');
export type MutedSkill = z.infer<typeof MutedSkill>;
export const MutedProvider = z.string().regex(/^provider:[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export type MutedProvider = z.infer<typeof MutedProvider>;

// ── Questions ───────────────────────────────────────────────────────────────

export const QuestionOption = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  /** A few words under the label, when the label alone isn't enough. */
  description: z.string().max(200).optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

const fieldBase = {
  id: z.string().min(1).max(64),
  /** The question itself, short: "Which day suits you?" */
  label: z.string().min(1).max(200),
  optional: z.boolean().default(false),
};

/** One thing a question asks for. Few, plain kinds, each with its own Nacre control. */
export const QuestionField = z.discriminatedUnion('kind', [
  z.object({
    ...fieldBase,
    kind: z.literal('choice'),
    options: z.array(QuestionOption).min(2).max(6),
    multiple: z.boolean().default(false),
    /** Offer "Something else…" with a line to type in. */
    other: z.boolean().default(true),
  }),
  z.object({
    ...fieldBase,
    kind: z.enum(['date', 'time', 'datetime']),
    min: When.optional(),
    max: When.optional(),
    /** Pre-filled, the assistant's best guess. */
    suggested: When.optional(),
  }),
  z.object({
    ...fieldBase,
    kind: z.literal('text'),
    placeholder: z.string().max(120).optional(),
    multiline: z.boolean().default(false),
  }),
  z.object({
    ...fieldBase,
    kind: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().positive().optional(),
    unit: z.string().max(24).optional(),
    suggested: z.number().optional(),
  }),
]);
export type QuestionField = z.infer<typeof QuestionField>;

/** A question the assistant asks mid-reply, answered with a tap; the reply carries on. */
export const Question = z.object({
  questionId: z.string().min(1).max(64),
  /** A heading when there's more than one field. */
  title: z.string().max(120).optional(),
  fields: z.array(QuestionField).min(1).max(4),
});
export type Question = z.infer<typeof Question>;

export const QuestionValue = z.union([
  z.string().max(4000),
  z.array(z.string().max(200)).max(6),
  z.number(),
]);
export type QuestionValue = z.infer<typeof QuestionValue>;

/** The person's answer: each field's value, and how it reads as a sentence. */
export const QuestionAnswer = z.object({
  values: z.record(z.string(), QuestionValue),
  /** "Thursday 9 Oct, 10:00 · Video call": what the chat shows and the assistant reads. */
  text: z.string().min(1).max(4000),
});
export type QuestionAnswer = z.infer<typeof QuestionAnswer>;

export const AnswerQuestionBody = z.object({
  answer: QuestionAnswer.nullable(),
});
export type AnswerQuestionBody = z.infer<typeof AnswerQuestionBody>;

// ── Replies ─────────────────────────────────────────────────────────────────

/**
 * Something the person might well say next, sent as it reads with one tap.
 * The words on the chip are the words sent: nothing hidden behind a label.
 */
export const ReplySuggestion = z.object({
  text: z.string().min(1).max(120),
});
export type ReplySuggestion = z.infer<typeof ReplySuggestion>;

// ── Plans ───────────────────────────────────────────────────────────────────

export const PlanStepStatus = z.enum(['pending', 'active', 'done']);
export type PlanStepStatus = z.infer<typeof PlanStepStatus>;

export const PlanStep = z.object({
  title: z.string().min(1).max(200),
  status: PlanStepStatus,
});
export type PlanStep = z.infer<typeof PlanStep>;

// ── Views of what a tool found ──────────────────────────────────────────────

export const AgendaItem = z.object({
  title: z.string().max(300),
  start: When,
  end: When.optional(),
  allDay: z.boolean().default(false),
  location: z.string().max(300).optional(),
  calendar: z.string().max(120).optional(),
  color: Hex.optional(),
  /** Has a video call link. */
  call: z.boolean().default(false),
  url: WebUrl.optional(),
});
export type AgendaItem = z.infer<typeof AgendaItem>;

export const MailItem = z.object({
  from: z.string().max(200),
  subject: z.string().max(300),
  snippet: z.string().max(400).optional(),
  date: When,
  unread: z.boolean().default(false),
  attachments: z.boolean().default(false),
  url: WebUrl.optional(),
});
export type MailItem = z.infer<typeof MailItem>;

export const FileItem = z.object({
  name: z.string().max(300),
  /** The file's type as the service names it, for its icon. */
  mime: z.string().max(120).optional(),
  modified: When.optional(),
  owner: z.string().max(200).optional(),
  url: WebUrl.optional(),
});
export type FileItem = z.infer<typeof FileItem>;

export const ChatMessageItem = z.object({
  author: z.string().max(200),
  text: z.string().max(2000),
  at: When,
  url: WebUrl.optional(),
});
export type ChatMessageItem = z.infer<typeof ChatMessageItem>;

/**
 * What a tool found, drawn as it is instead of as text: a day's agenda, a
 * list of emails, files, or messages. The assistant still gets the text.
 * Everything here came from outside, so it's drawn as plain text, never markup.
 */
export const ToolView = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('downloads'), items: z.array(Attachment).max(10) }),
  z.object({
    kind: z.literal('sources'),
    items: z
      .array(
        z.object({
          title: z.string().max(300),
          url: WebUrl,
          snippet: z.string().max(600).optional(),
        }),
      )
      .max(10),
  }),
  z.object({
    kind: z.literal('agenda'),
    items: z.array(AgendaItem).max(60),
    /** The days asked about, so an empty one still shows as free. */
    from: When.optional(),
    to: When.optional(),
  }),
  z.object({ kind: z.literal('mail'), items: z.array(MailItem).max(30) }),
  z.object({ kind: z.literal('files'), items: z.array(FileItem).max(30) }),
  z.object({
    kind: z.literal('messages'),
    /** Where they were said: "#design". */
    place: z.string().max(120).optional(),
    items: z.array(ChatMessageItem).max(30),
  }),
  WeatherView,
  RecipeView,
  ProductsView,
  PlacesView,
  AudioView,
  VideosView,
  KnowledgeView,
  LinksView,
  BooksView,
  ShowsView,
]);
export type ToolView = z.infer<typeof ToolView>;
