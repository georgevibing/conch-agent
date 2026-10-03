/**
 * Apps you make, share and add (ADR 0061). A Conch app is a small folder:
 * `conch-app.json` (what it is), `tools.mjs` (what the assistant can do with
 * it, run sealed off), pages that look like Conch, and skills. The assistant
 * builds one in a chat and offers it as a card; the person adds it.
 */
import { z } from 'zod';

import { SkillSignature } from './skills';

// ── Pictures ────────────────────────────────────────────────────────────────

/**
 * The glyphs an app's icon may use: Lucide's names, drawn by Nacre
 * (`AppGlyph`). A fixed list, so nothing is ever fetched and every icon
 * looks like Conch's own.
 */
export const APP_GLYPHS = [
  'sparkles',
  'leaf',
  'sprout',
  'flower',
  'trees',
  'mountain',
  'waves',
  'book-open',
  'notebook',
  'list-checks',
  'circle-check',
  'calendar',
  'clock',
  'alarm-clock',
  'timer',
  'bell',
  'plane',
  'train-front',
  'car',
  'bike',
  'map',
  'map-pin',
  'globe',
  'cloud-sun',
  'umbrella',
  'thermometer',
  'sun',
  'moon',
  'house',
  'lamp',
  'plug',
  'sofa',
  'wallet',
  'piggy-bank',
  'receipt',
  'credit-card',
  'chart-line',
  'chart-column',
  'trending-up',
  'shopping-cart',
  'gift',
  'ticket',
  'utensils',
  'coffee',
  'wine',
  'dumbbell',
  'heart-pulse',
  'heart',
  'activity',
  'pill',
  'baby',
  'dog',
  'cat',
  'fish',
  'bird',
  'music',
  'headphones',
  'mic',
  'film',
  'video',
  'tv',
  'gamepad',
  'camera',
  'image',
  'palette',
  'paintbrush',
  'pen-tool',
  'scissors',
  'shirt',
  'code',
  'terminal',
  'bug',
  'git-branch',
  'database',
  'server',
  'mail',
  'message-circle',
  'users',
  'user',
  'smile',
  'briefcase',
  'graduation-cap',
  'lightbulb',
  'search',
  'bookmark',
  'tag',
  'hash',
  'folder',
  'file-text',
  'link',
  'star',
  'award',
  'trophy',
  'target',
  'flag',
  'zap',
  'rocket',
  'puzzle',
  'shield',
  'key',
  'lock',
  'wrench',
  'hammer',
  'package',
  'box',
  'truck',
  'newspaper',
  'rss',
  'languages',
  'calculator',
  'ruler',
  'scale',
] as const;
export const AppGlyph = z.enum(APP_GLYPHS);
export type AppGlyph = z.infer<typeof AppGlyph>;

/** The colours an app's icon tile may take: Nacre's, in light and dark. */
export const APP_COLORS = [
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'pink',
  'slate',
] as const;
export const AppColor = z.enum(APP_COLORS);
export type AppColor = z.infer<typeof AppColor>;

// ── The manifest ────────────────────────────────────────────────────────────

/** An app's id: also its tools' prefix, so short (`app_<id>__<tool>` fits every provider). */
export const AppId = z
  .string()
  .min(2)
  .max(24)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters and numbers, with single dashes between words.',
  );
export type AppId = z.infer<typeof AppId>;

/** A tool's own name inside its app. */
export const AppToolName = z
  .string()
  .min(1)
  .max(20)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers and underscores.');

/** A file inside the app's folder: no `..`, no absolute path, no hidden file. */
export const AppFilePath = z
  .string()
  .min(1)
  .max(200)
  .regex(
    /^(?!.*(?:^|\/)\.)(?!\/)[A-Za-z0-9 _.\-/]+$/,
    'Use a path inside the app’s folder, like pages/main.html.',
  )
  .refine((p) => !p.split('/').includes('..'), 'Use a path inside the app’s folder.');

/** A website an app reaches: a host name, never an address or a port. */
export const AppHost = z
  .string()
  .max(253)
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Use a website’s name, like api.example.com.',
  );

const WebLink = z
  .string()
  .max(2000)
  .regex(/^https:\/\//i, 'Use an https:// address.');

/** What an app needs from the person: an API key, a city, an account name. */
export const AppSetting = z
  .object({
    key: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/),
    label: z.string().trim().min(1).max(60),
    /** One sentence: where to find it. */
    help: z.string().max(200).optional(),
    /** Where to get it, opened beside the field. */
    link: WebLink.optional(),
    /** Kept sealed, never shown again, never seen by the assistant. */
    secret: z.boolean().default(false),
    optional: z.boolean().default(false),
  })
  .strict();
export type AppSetting = z.infer<typeof AppSetting>;

export const AppPage = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,32}$/),
    title: z.string().trim().min(1).max(40),
    file: AppFilePath.refine((p) => p.endsWith('.html'), 'A page is an .html file.'),
  })
  .strict();
export type AppPage = z.infer<typeof AppPage>;

/** Where an app sits in the gallery: the gallery's kinds, or one of your own. */
export const ConchAppKind = z.enum([
  'productivity',
  'developer',
  'files',
  'design',
  'business',
  'home',
  'personal',
]);
export type ConchAppKind = z.infer<typeof ConchAppKind>;

export const ConchAppManifest = z
  .object({
    conch: z.literal(1),
    id: AppId,
    name: z.string().trim().min(1).max(40),
    tagline: z.string().trim().min(1).max(80),
    description: z.string().trim().max(600).default(''),
    version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,6}$/, 'Use a version like 1.0.0.'),
    icon: z.object({ glyph: AppGlyph, color: AppColor }).strict(),
    kind: ConchAppKind.default('personal'),
    /** The tools module, run sealed off. */
    tools: AppFilePath.refine((p) => /\.m?js$/.test(p), 'The tools are a .mjs file.').optional(),
    pages: z.array(AppPage).max(4).default([]),
    /** The websites its tools may reach. Empty: none. */
    reaches: z.array(AppHost).max(10).default([]),
    settings: z.array(AppSetting).max(8).default([]),
    /** For the assistant: when to use it, and how. */
    instructions: z.string().trim().max(1500).default(''),
    /** Things a person might say to use it. */
    examples: z.array(z.string().trim().min(1).max(120)).max(6).default([]),
    author: z
      .object({ name: z.string().trim().min(1).max(80), url: WebLink.optional() })
      .strict()
      .optional(),
    /** Where it's published; set by Conch when it publishes. */
    repository: WebLink.optional(),
  })
  .strict();
export type ConchAppManifest = z.infer<typeof ConchAppManifest>;

/** The limits on a package, the same wherever it came from. */
export const APP_LIMITS = {
  /** Unpacked, per app. */
  bytes: 2 * 1024 * 1024,
  files: 200,
  /** A download or a file, packed. */
  download: 10 * 1024 * 1024,
  /** What its data folder may hold. */
  data: 50 * 1024 * 1024,
  /** One tool call. */
  callMs: 30_000,
  /** A request `app.fetch` makes: out, back, and how long. */
  fetchOut: 1024 * 1024,
  fetchBack: 5 * 1024 * 1024,
  fetchMs: 20_000,
  fetchPerHour: 600,
  /** Earlier versions kept for Go back. */
  keep: 3,
  extensions: ['.json', '.mjs', '.js', '.html', '.css', '.md', '.txt', '.svg', '.csv'],
} as const;

/** The host tool name of an app's tool: short enough for every provider. */
export const appToolName = (app: string, tool: string) =>
  `app_${app.replaceAll('-', '_')}__${tool}`;

// ── What Conch knows about one ──────────────────────────────────────────────

/** One of an app's tools, as its sealed runtime listed it. */
export const ConchAppTool = z.object({
  name: AppToolName,
  title: z.string().max(80),
  description: z.string().max(1000),
  /** It changes something (else it only looks). */
  changes: z.boolean(),
});
export type ConchAppTool = z.infer<typeof ConchAppTool>;

/** Where an app came from. */
export const ConchAppSource = z.discriminatedUnion('kind', [
  /** Made in this Conch, in that chat. */
  z.object({ kind: z.literal('made'), conversationId: z.string().optional() }),
  z.object({
    kind: z.literal('github'),
    owner: z.string().max(100),
    repo: z.string().max(100),
    /** A folder in the repository, for a collection. */
    path: z.string().max(300).optional(),
    /** The tag or branch asked for; unset: the newest release, or the default branch. */
    ref: z.string().max(200).optional(),
    /** The commit it came from. */
    commit: z.string().max(64).optional(),
    url: WebLink,
  }),
  z.object({ kind: z.literal('link'), url: WebLink }),
  z.object({ kind: z.literal('file'), name: z.string().max(200) }),
]);
export type ConchAppSource = z.infer<typeof ConchAppSource>;

/** One thing the check found, in words a person (and a model) can act on. */
export const AppCheckItem = z.object({
  message: z.string().max(500),
  file: z.string().max(200).optional(),
  line: z.number().int().positive().optional(),
});
export type AppCheckItem = z.infer<typeof AppCheckItem>;

/** The quality bar, as it stood for one exact set of files (`hash`). */
export const ConchAppCheck = z.object({
  ok: z.boolean(),
  hash: z.string(),
  at: z.number(),
  problems: z.array(AppCheckItem).default([]),
  warnings: z.array(AppCheckItem).default([]),
  tools: z.array(ConchAppTool).default([]),
  /** Tools `app_try` ran without throwing, for these files. */
  tried: z.array(z.string()).default([]),
});
export type ConchAppCheck = z.infer<typeof ConchAppCheck>;

/** How one version differs from the one before, newest reach first. */
export const ConchAppChanges = z.object({
  from: z.string(),
  to: z.string(),
  reachesAdded: z.array(z.string()).default([]),
  reachesRemoved: z.array(z.string()).default([]),
  settingsAdded: z.array(z.string()).default([]),
  toolsAdded: z.array(z.string()).default([]),
  toolsRemoved: z.array(z.string()).default([]),
  /** A tool that only looked now changes things. */
  toolsNowChange: z.array(z.string()).default([]),
  pagesAdded: z.array(z.string()).default([]),
});
export type ConchAppChanges = z.infer<typeof ConchAppChanges>;

/** A newer version, waiting to be pressed. */
export const ConchAppUpdate = z.object({
  version: z.string(),
  foundAt: z.number(),
  signature: SkillSignature,
  /** Signed by the key it was added with: one press. */
  sameSigner: z.boolean(),
  changes: ConchAppChanges,
});
export type ConchAppUpdate = z.infer<typeof ConchAppUpdate>;

export const ConchAppVersion = z.object({
  version: z.string(),
  at: z.number(),
  hash: z.string(),
});
export type ConchAppVersion = z.infer<typeof ConchAppVersion>;

/** An app in your Conch. Its switch, policy and tools are its integration's (`integrationId`). */
export const ConchApp = z.object({
  id: AppId,
  /** Its card in Apps: `capp_<id>`. */
  integrationId: z.string(),
  manifest: ConchAppManifest,
  tools: z.array(ConchAppTool).default([]),
  source: ConchAppSource,
  signature: SkillSignature,
  hash: z.string(),
  addedAt: z.number(),
  updatedAt: z.number(),
  /** Earlier versions kept for Go back, newest first. */
  versions: z.array(ConchAppVersion).default([]),
  update: ConchAppUpdate.optional(),
  /** Settings that have a value; secret ones are never sent back. */
  saved: z.array(z.string()).default([]),
  /** The non-secret settings' values. */
  values: z.record(z.string(), z.string()).default({}),
  /** Settings it needs that have no value yet: it says so instead of failing. */
  missing: z.array(z.string()).default([]),
  /** Bytes in its data folder. */
  dataBytes: z.number().int().nonnegative().default(0),
  /** The chat it was made or last changed in. */
  conversationId: z.string().optional(),
  /** A draft of a change waiting in a chat. */
  draftId: z.string().optional(),
  /** Its pages are in the sidebar (**Pinned**); on by itself when it has one. */
  pinned: z.boolean().default(false),
  /** Where it was published on GitHub, when you published it. */
  published: z.string().optional(),
});
export type ConchApp = z.infer<typeof ConchApp>;

export const UpdateConchAppBody = z.object({ pinned: z.boolean() }).partial().strict();
export type UpdateConchAppBody = z.infer<typeof UpdateConchAppBody>;

export const ConchAppsList = z.object({ apps: z.array(ConchApp) });
export type ConchAppsList = z.infer<typeof ConchAppsList>;

// ── Making one ──────────────────────────────────────────────────────────────

/** An app being made in a chat (`CONCH_HOME/app-workshop/<id>/`). */
export const ConchAppDraft = z.object({
  id: z.string(),
  conversationId: z.string(),
  /** The app it changes, when it's a change to one you have. */
  appId: AppId.optional(),
  /** Its manifest as it reads now; absent while it doesn't. */
  manifest: ConchAppManifest.optional(),
  files: z.array(z.object({ path: z.string(), bytes: z.number().int() })),
  hash: z.string(),
  check: ConchAppCheck.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ConchAppDraft = z.infer<typeof ConchAppDraft>;

/**
 * The card under a reply: an app to add, or a new version of one you have.
 * The agent proposes (`app_present`, `app_get`); the person presses. A later
 * event with the same `offerId` replaces this one.
 */
export const ConchAppOffer = z.object({
  offerId: z.string().min(1).max(64),
  action: z.enum(['add', 'update']),
  /** Made in this chat, or fetched from a link, a file or GitHub. */
  from: z.enum(['draft', 'package']),
  draftId: z.string().optional(),
  packageId: z.string().optional(),
  /** The exact files on offer: pressing adds these or nothing. */
  hash: z.string(),
  manifest: ConchAppManifest,
  tools: z.array(ConchAppTool),
  source: ConchAppSource,
  signature: SkillSignature,
  /** For an update: what's different, new reach first. */
  changes: ConchAppChanges.optional(),
  /** In the assistant's words: one sentence on what it made. */
  summary: z.string().max(300).optional(),
  state: z.enum([
    /** Waiting for a press. */
    'ready',
    'added',
    'updated',
    /** Newer files were offered since; this card is history. */
    'stale',
    'declined',
    'failed',
  ]),
  /** Why it failed, in one sentence. */
  message: z.string().max(500).optional(),
});
export type ConchAppOffer = z.infer<typeof ConchAppOffer>;

/** Pressing the card: the settings it needs, typed by the person into the card. */
export const AcceptAppOfferBody = z
  .object({
    conversationId: z.string(),
    settings: z.record(z.string(), z.string().max(4096)).default({}),
  })
  .strict();
export type AcceptAppOfferBody = z.infer<typeof AcceptAppOfferBody>;

export const DeclineAppOfferBody = z.object({ conversationId: z.string() }).strict();

/** "Put it on GitHub": a card with the person's buttons (`app_share`). */
export const ConchAppShareCard = z.object({
  appId: AppId,
  name: z.string(),
});
export type ConchAppShareCard = z.infer<typeof ConchAppShareCard>;

// ── Adding one from somewhere ───────────────────────────────────────────────

/** A GitHub repository, a folder or release in one, or any https link to a `.conchapp`. */
export const PreviewAppBody = z.union([
  z.object({ link: z.string().trim().min(1).max(2000) }).strict(),
  /** A `.conchapp` file, base64, dropped on Apps. */
  z.object({ file: z.string().max(14_000_000), name: z.string().max(200) }).strict(),
]);
export type PreviewAppBody = z.infer<typeof PreviewAppBody>;

/** One app found in a package. */
export const ConchAppFound = z.object({
  manifest: ConchAppManifest,
  tools: z.array(ConchAppTool),
  signature: SkillSignature,
  hash: z.string(),
  /** Why it can't be added, in words; empty when it can. */
  problems: z.array(AppCheckItem).default([]),
  /** The version you have, when you have it. */
  installed: z.string().optional(),
  changes: ConchAppChanges.optional(),
});
export type ConchAppFound = z.infer<typeof ConchAppFound>;

/** What a link or a file holds, kept for half an hour (`packageId`). */
export const ConchAppPreview = z.object({
  packageId: z.string(),
  source: ConchAppSource,
  apps: z.array(ConchAppFound),
});
export type ConchAppPreview = z.infer<typeof ConchAppPreview>;

export const InstallAppBody = z
  .object({
    packageId: z.string(),
    appId: AppId,
    /** The files the person saw: a package that changed since is refused. */
    hash: z.string(),
    settings: z.record(z.string(), z.string().max(4096)).default({}),
  })
  .strict();
export type InstallAppBody = z.infer<typeof InstallAppBody>;

export const AppSettingsBody = z
  .object({ values: z.record(z.string(), z.string().max(4096)) })
  .strict();
export type AppSettingsBody = z.infer<typeof AppSettingsBody>;

export const RollbackAppBody = z.object({ version: z.string() }).strict();

/** A repository on GitHub with the topic `conch-app`. */
export const CommunityApp = z.object({
  owner: z.string(),
  repo: z.string(),
  description: z.string().max(400).default(''),
  stars: z.number().int().nonnegative().default(0),
  updatedAt: z.number().optional(),
  url: WebLink,
  /** You already have an app from it. */
  installed: z.boolean().default(false),
});
export type CommunityApp = z.infer<typeof CommunityApp>;

export const CommunityResults = z.object({
  apps: z.array(CommunityApp),
  /** GitHub asked us to wait; these are from before, or none. */
  limited: z.boolean().default(false),
  /** GitHub couldn't be reached. */
  offline: z.boolean().default(false),
});
export type CommunityResults = z.infer<typeof CommunityResults>;

// ── Sharing ─────────────────────────────────────────────────────────────────

/** Publishing on GitHub, one step at a time; the page asks again while it moves. */
export const PublishState = z.discriminatedUnion('state', [
  z.object({ state: z.literal('idle') }),
  /** GitHub's program isn't here: `need` installs it (ADR 0016). */
  z.object({ state: z.literal('needs-program'), need: z.string() }),
  /** GitHub's device sign-in: enter `code` at `url`; Conch carries on by itself. */
  z.object({ state: z.literal('needs-sign-in'), code: z.string().max(20), url: WebLink }),
  z.object({ state: z.literal('publishing'), step: z.string().max(200) }),
  z.object({ state: z.literal('published'), url: WebLink, version: z.string() }),
  z.object({ state: z.literal('failed'), message: z.string().max(500) }),
]);
export type PublishState = z.infer<typeof PublishState>;

// ── Pages ───────────────────────────────────────────────────────────────────

/** A page calling its own app's tool (`conch.call`), through the panel. */
export const AppCallBody = z
  .object({
    tool: AppToolName,
    input: z.record(z.string(), z.unknown()).default({}),
    /** The person pressed something in the page, or said yes: a change may go. */
    confirmed: z.boolean().default(false),
  })
  .strict();
export type AppCallBody = z.infer<typeof AppCallBody>;

export const AppCallResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string(), json: z.unknown().optional() }),
  z.object({
    ok: z.literal(false),
    /** `confirm`: a change, with no press; ask, then call again with `confirmed`. */
    reason: z.enum(['confirm', 'off', 'error', 'missing-settings']),
    message: z.string(),
  }),
]);
export type AppCallResult = z.infer<typeof AppCallResult>;
