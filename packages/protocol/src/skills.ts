/**
 * Skills — things the assistant knows how to do, in the Agent Skills format
 * (agentskills.io) that Claude Code, Codex, OpenClaw and Hermes Agent share:
 * a folder with a `SKILL.md` whose front matter has a `name` and a
 * `description`, and whose body holds the instructions. See ADR 0013.
 */
import { z } from 'zod';

import { Id } from './common';
import { SkillOrigin } from './market-basics';

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
  /** A Conch app's own skills (ADR 0061): `conch-apps/<id>/current/skills`, read-only. */
  'app',
  /** Added from Discover (ADR 0081): `skills-market/<source>/<name>`, pinned, read-only. */
  'market',
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
  /** Signed, but what's in it isn't what was signed: off (ADR 0031). */
  'bad-signature',
]);

/** What a skill may do while it's in use (ADR 0031). Reading is never limited. */
export const SkillCapability = z.enum([
  'commands',
  'files',
  'files-anywhere',
  'web',
  'browser',
  'apps',
  'passwords',
]);
export type SkillCapability = z.infer<typeof SkillCapability>;

/** A program a skill may run (`git`, `npm`): one plain word, nothing a shell would read. */
export const SkillCommandPrefix = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/);
/** An app a skill may use, by its integration server's name (`notion`, `google`). */
export const SkillAppName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

export const SkillPermissions = z.object({
  /** The skill said (`allowed-tools` or `permissions`); otherwise these are the defaults. */
  declared: z.boolean(),
  capabilities: z.array(SkillCapability),
  /** Only these commands (prefixes: `git`, `npm test`), when it named them. */
  commands: z.array(z.string()).optional(),
  /** Only these apps (integration servers), when it named them. */
  apps: z.array(z.string()).optional(),
  /** The list in plain words: "run commands (only `git`)". */
  words: z.array(z.string()),
});
export type SkillPermissions = z.infer<typeof SkillPermissions>;

/** Who signed a skill, and whether that holds (ADR 0031). */
export const SkillSignature = z.object({
  state: z.enum([
    /** No `SKILL.sig`: reviewed like any other skill. */
    'unsigned',
    /** Signed, the signature holds, and you trust who signed it. */
    'verified',
    /** Signed and it holds, by someone you haven't said you trust. */
    'untrusted',
    /** Signed, and what's in it isn't what was signed: off. */
    'invalid',
  ]),
  /** The name the signer gave; only the key says who it really is. */
  publisher: z.string().max(80).optional(),
  /** The key's fingerprint, grouped for reading: "3F9A 21C0 7B44 E1D2". */
  fingerprint: z.string().optional(),
  /** Why it's invalid, in a sentence. */
  problem: z.string().optional(),
  /**
   * Untrusted, but it gives the name of a publisher you trust: another key
   * using a name you know. Someone may be pretending.
   */
  lookalike: z.boolean().optional(),
});
export type SkillSignature = z.infer<typeof SkillSignature>;

export const TrustedPublisher = z.object({
  fingerprint: z.string(),
  name: z.string(),
  trustedAt: z.number(),
  /** It's your own key (`pnpm conch skills sign`). */
  you: z.boolean().optional(),
});
export type TrustedPublisher = z.infer<typeof TrustedPublisher>;

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
    /** What the registry it came from says about it (ADR 0081). */
    'registry',
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
  /** What it may do while it's in use (ADR 0031). */
  permissions: SkillPermissions.optional(),
  signature: SkillSignature.optional(),
  /** Where it came from, when it was added from Discover (ADR 0081). */
  origin: SkillOrigin.optional(),
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

/** At most this much of an idea or rough notes goes to the model that writes the skill. */
export const SKILL_IDEA_MAX = 4_000;

/** Ask Conch to write a whole skill from an idea or rough notes: the steps, a title, a description. */
export const WriteSkillBody = z
  .object({
    idea: z
      .string()
      .trim()
      .min(3, 'Say a little about what it should do.')
      .max(SKILL_IDEA_MAX, 'That’s already a lot — write the rest yourself, or shorten it.'),
  })
  .strict();
export type WriteSkillBody = z.infer<typeof WriteSkillBody>;

/** A whole skill, written for you to read and change before it's saved. */
export const SkillWritten = z.object({
  instructions: z.string(),
  title: z.string(),
  name: SkillName,
  description: z.string(),
  /** Written by a model (true), or nothing could write it and your words are kept (false). */
  generated: z.boolean(),
  /** No connected provider can write, so connecting one is the way to have it written. */
  noModel: z.boolean(),
});
export type SkillWritten = z.infer<typeof SkillWritten>;

export const CreateSkillBody = z.object({
  instructions: Instructions,
  /** Missing parts are written for you, as in `DraftSkillBody`. */
  title: Title.optional(),
  description: Description.optional(),
  name: SkillName.optional(),
  mode: SkillMode.default('auto'),
  /**
   * What it says it may do (ADR 0031), written into its front matter. A
   * draft Conch wrote from work in a chat says only what that work needed
   * (ADR 0058). Unset: it says nothing, and gets the usual list.
   */
  permissions: z
    .object({
      capabilities: z.array(SkillCapability).max(7),
      commands: z.array(SkillCommandPrefix).max(12).optional(),
      apps: z.array(SkillAppName).max(12).optional(),
    })
    .optional(),
  /** The suggestion it was saved from (ADR 0032, ADR 0058): it's settled, and Conch knows it put it here. */
  suggestion: z
    .string()
    .regex(/^(?:hs|ws)_[A-Za-z0-9_-]{1,60}$/)
    .optional(),
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
