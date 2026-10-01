/**
 * Skills — things the assistant knows how to do, in the Agent Skills format
 * (agentskills.io) that Claude Code, Codex, OpenClaw and Hermes Agent share:
 * a folder with a `SKILL.md` whose front matter has a `name` and a
 * `description`, and whose body holds the instructions. See ADR 0013.
 */
import { z } from 'zod';

import { Id } from './common';

/**
 * A skill's name, which is also its folder and its slash command: 1–64
 * lowercase letters and digits in words joined by single hyphens.
 */
export const SkillName = z
  .string()
  .max(64, 'Keep the name to 64 characters.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters and numbers, with single dashes between words.',
  );
export type SkillName = z.infer<typeof SkillName>;

/** Where a skill lives: Conch's own folder, or another agent's (read-only here). */
export const SkillSource = z.enum([
  /** `~/.conch/skills` — yours to edit. */
  'conch',
  /** `~/.agents/skills` — the folder several agents share. */
  'agents',
  /** `~/.claude/skills` */
  'claude',
  /** `~/.openclaw/skills`, `~/.openclaw/workspace/skills` */
  'openclaw',
  /** `~/.hermes/skills` */
  'hermes',
]);
export type SkillSource = z.infer<typeof SkillSource>;

/**
 * When the assistant uses a skill: on its own when a request matches it, only
 * when you ask for it by name, or never.
 */
export const SkillMode = z.enum(['auto', 'manual', 'off']);
export type SkillMode = z.infer<typeof SkillMode>;

/** The longest description Conch writes: the strictest reader (OpenClaw) wants one line under 160. */
export const SKILL_DESCRIPTION_MAX = 160;

/**
 * What's wrong with a skill's file, so the page can offer the right fix:
 * write the missing description, or look again at a file Conch couldn't read.
 */
export const SkillProblemKind = z.enum([
  /** SKILL.md couldn't be read (too big, or not readable). */
  'unreadable',
  /** No front matter at all (no name, no description). */
  'no-front-matter',
  /** Front matter, but no usable description. */
  'no-description',
  /** Another app's skill changed since you turned it on: off until you look again (ADR 0028). */
  'changed',
  /** Conch found something worrying in it: off until you've looked and said yes (ADR 0028). */
  'needs-review',
]);

/** Something in a skill that could hurt you, in plain words (ADR 0028). */
export const SkillFinding = z.object({
  kind: z.enum([
    'download-run',
    'secrets',
    'exfiltration',
    'deception',
    'prerequisite',
    'hidden',
    'binary',
  ]),
  severity: z.enum(['danger', 'warning']),
  message: z.string(),
  /** Where, relative to the skill's folder. */
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
});
export type SkillFinding = z.infer<typeof SkillFinding>;

/** What Conch saw reading a skill: nothing worrying, worth a look, or dangerous. */
export const SkillReview = z.object({
  verdict: z.enum(['clean', 'caution', 'danger']),
  findings: z.array(SkillFinding),
  /** The fingerprint of everything in the folder that was read. */
  hash: z.string(),
  checkedAt: z.number(),
});
export type SkillReview = z.infer<typeof SkillReview>;
export type SkillProblemKind = z.infer<typeof SkillProblemKind>;

export const Skill = z.object({
  /** Conch's own skills use their name; others are `<source>_<name>`. */
  id: Id,
  name: z.string(),
  /** The body's first `# Heading`, else the name in words. */
  title: z.string(),
  description: z.string(),
  source: SkillSource,
  /** "Conch", "OpenClaw", "Hermes"… */
  sourceLabel: z.string(),
  /** Only Conch's own skills can be changed from here; the rest can be copied. */
  editable: z.boolean(),
  mode: SkillMode,
  /** The skill's folder on this computer. */
  path: z.string(),
  /** Other files in the folder (`scripts/…`, `references/…`), relative, capped. */
  files: z.array(z.string()).default([]),
  /** A provider that reads this folder by itself, so it doesn't need Conch to mention it. */
  loadedBy: z.string().optional(),
  /** What's wrong with the file, when something is (it's listed, but can't be used). */
  problem: z.string().optional(),
  problemKind: SkillProblemKind.optional(),
  updatedAt: z.number(),
  /** What Conch saw reading it (another app's skill, or one you were given). */
  review: SkillReview.optional(),
});
export type Skill = z.infer<typeof Skill>;

export const SkillDetail = Skill.extend({
  /** The body without its title heading. */
  instructions: z.string(),
});
export type SkillDetail = z.infer<typeof SkillDetail>;

export const SkillSourceInfo = z.object({
  id: SkillSource,
  label: z.string(),
  /** Where Conch looks. */
  path: z.string(),
  /** Whether the folder exists. */
  found: z.boolean(),
  count: z.number().int().nonnegative(),
});
export type SkillSourceInfo = z.infer<typeof SkillSourceInfo>;

export const SkillsList = z.object({
  skills: z.array(Skill),
  sources: z.array(SkillSourceInfo),
});
export type SkillsList = z.infer<typeof SkillsList>;

const Title = z.string().trim().min(1, 'Give it a title.').max(60);
const Description = z
  .string()
  .trim()
  .min(1, 'Say what it does and when to use it.')
  .max(1024)
  .regex(/^[^\r\n]*$/, 'Keep the description to one line.');
const Instructions = z
  .string()
  .trim()
  .min(1, 'Write what the skill should do.')
  .max(50_000, 'That’s longer than a skill should be — move detail into a file next to it.');

/** Ask Conch to write a title and description for these instructions. */
export const DraftSkillBody = z.object({ instructions: Instructions });
export type DraftSkillBody = z.infer<typeof DraftSkillBody>;

/** Write the missing description of one of your skills, from what it says. Nothing else to send. */
export const DescribeSkillBody = z.object({}).strict();

/** A description to look over before it's saved into the skill's SKILL.md. */
export const SkillDescriptionDraft = z.object({
  description: z.string().max(1024),
  /**
   * `model`: written by a model. `text`: the instructions' first sentence
   * (no model could write it). `none`: there was nothing to write it from.
   */
  from: z.enum(['model', 'text', 'none']),
  /** No connected provider can write one, so the person may prefer to type it. */
  noModel: z.boolean(),
});
export type SkillDescriptionDraft = z.infer<typeof SkillDescriptionDraft>;

export const SkillDraft = z.object({
  title: z.string(),
  name: SkillName,
  description: z.string(),
  /** Written by a model (true), or taken from the first line and sentence (false). */
  generated: z.boolean(),
});
export type SkillDraft = z.infer<typeof SkillDraft>;

export const CreateSkillBody = z.object({
  instructions: Instructions,
  /** Missing parts are written for you, as in `DraftSkillBody`. */
  title: Title.optional(),
  description: Description.optional(),
  name: SkillName.optional(),
  mode: SkillMode.default('auto'),
});
export type CreateSkillBody = z.infer<typeof CreateSkillBody>;

export const UpdateSkillBody = z
  .object({
    title: Title,
    description: Description,
    instructions: Instructions,
    /** Renames the folder and the slash command. */
    name: SkillName,
    mode: SkillMode,
    /**
     * Turning on a skill Conch found worrying: the review's `hash`, to say
     * you've seen what it does (ADR 0028). Ignored for anything else.
     */
    acknowledged: z.string().max(128),
  })
  .partial();
export type UpdateSkillBody = z.infer<typeof UpdateSkillBody>;
