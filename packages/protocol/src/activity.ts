/**
 * How the chat tells what the assistant is doing (ADR 0103): each tool call
 * said in plain words, runs of them told as one story, and what the work
 * changed in the world. The raw calls stay one tap away.
 */
import { z } from 'zod';

/**
 * What kind of work a step is, for grouping steps into stories and choosing
 * their icon and words. `other` is anything Conch can't tell.
 */
export const ActivityFamily = z.enum([
  'explore', // reading, listing, searching files and code
  'edit', // creating and changing files
  'run', // running a command that isn't one of the below
  'verify', // tests, type checks, linting, builds
  'ship', // commits, pushes, releases, deploys
  'research', // searching the web, reading pages
  'browse', // driving the browser
  'connect', // apps: mail, calendar, Slack, …
  'make', // pictures, documents, files to download
  'plan', // plans and to-do lists
  'delegate', // helpers and tasks sent away
  'remember', // memory and past chats
  'other',
]);
export type ActivityFamily = z.infer<typeof ActivityFamily>;

/**
 * Something a step changed outside the chat, kept for the turn's "What changed"
 * list. `undo` names the change set that puts it back, when one does.
 */
export const ActivityEffect = z.object({
  kind: z.enum([
    'file', // created, changed or deleted a file
    'commit',
    'push',
    'install', // added a package or program
    'send', // an email, a message, a post: something other people see
    'schedule', // a calendar event, a reminder
    'purchase',
    'delete',
    'publish', // a file offered to download, a page put online
    'other',
  ]),
  /** In plain words: "Pushed 2 commits to main", "Sent an email to Ana". */
  text: z.string().max(200),
  /** The file, branch, person or place it's about, when there's one. */
  target: z.string().max(300).optional(),
  undo: z.string().optional(),
});
export type ActivityEffect = z.infer<typeof ActivityEffect>;

/** A small thing to point at: a site, a file, a picture, what a step found. */
export const ActivityChip = z.object({
  kind: z.enum(['site', 'file', 'image', 'person', 'app', 'text']),
  label: z.string().max(120),
  /** A link to open (sites), a path to show (files). */
  href: z.string().max(2000).optional(),
  /** A small picture: a favicon, a product photo, an app logo (URL or data URL). */
  image: z.string().max(200_000).optional(),
});
export type ActivityChip = z.infer<typeof ActivityChip>;

/**
 * One tool call in plain words. `doing` while it runs ("Running the tests"),
 * `done` once it ends ("Ran the tests"), `outcome` for what it found
 * ("241 passed", "3 matches", "exit 1"). Written by rules, never a model.
 */
export const ToolLabel = z.object({
  family: ActivityFamily,
  doing: z.string().max(160),
  done: z.string().max(160),
  outcome: z.string().max(160).optional(),
  /** The file, page, query or command it's about, short: shown as a chip or quietly after. */
  subject: z.string().max(300).optional(),
  /** Whether it went wrong in a way worth saying, beyond its status (a test that failed). */
  failed: z.boolean().optional(),
  effects: z.array(ActivityEffect).max(20).optional(),
  chips: z.array(ActivityChip).max(12).optional(),
});
export type ToolLabel = z.infer<typeof ToolLabel>;

/** Where a story's or a line's words came from: rules, the provider, or a small model. */
export const NarrationSource = z.enum(['rule', 'provider', 'model']);
export type NarrationSource = z.infer<typeof NarrationSource>;

/**
 * A story's headline, written once it ends (by a small model when one is
 * connected and allowed, else not at all: the rules' headline stands). Keyed
 * by the story's first tool call, which never changes.
 */
export const StoryTitle = z.object({
  storyId: z.string(),
  /** "Pushed the fixes to main". Past tense, no more than about eight words. */
  headline: z.string().min(1).max(90),
  /** What it came to, when there's a result worth a second phrase: "7,388 passed". */
  outcome: z.string().max(90).optional(),
  source: NarrationSource,
});
export type StoryTitle = z.infer<typeof StoryTitle>;

/** "Why?" on a step: answered from the chat's log by a small model, without stopping the work. */
export const ExplainStepBody = z.object({ toolUseId: z.string().min(1).max(200) }).strict();
export type ExplainStepBody = z.infer<typeof ExplainStepBody>;
export const ExplainStepResult = z.object({
  /** One to three short sentences, or unset when there was no one to ask. */
  answer: z.string().max(600).optional(),
  /** Why there's no answer, said plainly: no provider can do this, the budget's spent. */
  unavailable: z.string().max(200).optional(),
});
export type ExplainStepResult = z.infer<typeof ExplainStepResult>;
