/**
 * The browser — Conch's own, driven by the agent and watchable (and
 * takeable) from the chat. See ADR 0014.
 *
 * Three channels:
 * - REST `/api/browser…` for status, settings and sites you trust;
 * - the main WebSocket for `browser.status` and the conversation log's
 *   `browser.step` / `browser.handoff` events and `permission.requested.browser`;
 * - its own WebSocket, `/api/browser/live`, for the picture (binary JPEG frames)
 *   and your mouse and keyboard when you take over.
 */
import { z } from 'zod';

import { Id } from './common';

// ── Which browser ───────────────────────────────────────────────────────────

export const BrowserCandidate = z.object({
  id: z.enum(['chrome', 'edge', 'brave', 'chromium', 'downloaded']),
  name: z.string(),
  path: z.string(),
});
export type BrowserCandidate = z.infer<typeof BrowserCandidate>;

/**
 * Where the browser runs (ADR 0080). `local`: Conch's own, on this computer
 * (the default). `chrome`: the person's own signed-in Chrome, attached with
 * Chrome's own consent. `browserbase`, `steel`: a browser in the cloud.
 * `cdp`: any other browser at an address that speaks the DevTools protocol.
 * Whatever runs, it falls back to `local` when it can't be reached.
 */
export const BrowserBackendKind = z.enum(['local', 'chrome', 'browserbase', 'steel', 'cdp']);
export type BrowserBackendKind = z.infer<typeof BrowserBackendKind>;

export const BrowserSettings = z.object({
  /** Let the agent use the browser at all. */
  enabled: z.boolean().default(true),
  /** A candidate id, or `auto` for the first one found. */
  preferred: z.string().max(40).default('auto'),
  /** Open pages on this computer and your network (localhost apps, a router). Off by default. */
  allowLocal: z.boolean().default(false),
  /** Decline cookie banners (reject / necessary only) before the agent reads a page. */
  declineCookies: z.boolean().default(true),
  /** Slide the browser panel open when the agent starts browsing. */
  autoOpen: z.boolean().default(true),
  /** Where it runs. Changed only through `PUT /api/browser/backend`, after a recent sign-in. */
  backend: BrowserBackendKind.default('local'),
});
export type BrowserSettings = z.infer<typeof BrowserSettings>;

/** Patch bodies must not re-apply defaults, so fields are re-declared without them. */
export const UpdateBrowserSettingsBody = z
  .object({
    enabled: z.boolean(),
    preferred: z.string().max(40),
    allowLocal: z.boolean(),
    declineCookies: z.boolean(),
    autoOpen: z.boolean(),
  })
  .partial();
export type UpdateBrowserSettingsBody = z.infer<typeof UpdateBrowserSettingsBody>;

/**
 * Choosing where the browser runs. A key or an address is only ever sent
 * here, kept sealed (`browser.secrets.json`), and never sent back.
 */
export const SetBrowserBackendBody = z.object({
  kind: BrowserBackendKind,
  /** Browserbase or Steel: the API key. Left out: keep the one saved. */
  key: z.string().trim().min(8).max(400).optional(),
  /** Browserbase: the project id (optional on newer accounts). */
  project: z.string().trim().max(120).optional(),
  /** `cdp`: a `ws(s)://` or `http(s)://` DevTools address. Left out: keep the one saved. */
  address: z.string().trim().max(2000).optional(),
});
export type SetBrowserBackendBody = z.infer<typeof SetBrowserBackendBody>;

/** What the settings page shows about where the browser runs (never a key). */
export const BrowserBackendStatus = z.object({
  /** What was chosen. */
  chosen: BrowserBackendKind,
  /** What runs now: `local` while the chosen one can't be reached. */
  using: BrowserBackendKind,
  /** Why it isn't the chosen one, in a sentence. */
  fellBack: z.string().optional(),
  /** Which cloud keys and addresses are saved (only the host, for an address). */
  saved: z.object({
    browserbase: z.boolean(),
    steel: z.boolean(),
    cdp: z.string().optional(),
  }),
  /**
   * Your Chrome: `ready` (open, and it allows Conch to ask), `closed` (not
   * running, or remote debugging isn't allowed in it yet), `missing` (no
   * Chrome on this computer).
   */
  chrome: z.enum(['ready', 'closed', 'missing']).optional(),
});
export type BrowserBackendStatus = z.infer<typeof BrowserBackendStatus>;

/** A site (registrable domain) you told Conch it may always act on. */
export const BrowserSite = z.object({
  site: z.string(),
  grantedAt: z.number(),
});
export type BrowserSite = z.infer<typeof BrowserSite>;

/**
 * Where the browser is in its life. `off`: not started (it starts on demand);
 * `installing`: fetching Chromium because none was found; `starting`,
 * `running`; `repairing`: fixing itself; `problem`: it couldn't, and `problem`
 * says why and what would help.
 */
export const BrowserPhase = z.enum([
  'off',
  'installing',
  'starting',
  'running',
  'repairing',
  'problem',
]);
export type BrowserPhase = z.infer<typeof BrowserPhase>;

export const BrowserProblem = z.object({
  /** One plain sentence: what happened. */
  message: z.string(),
  /** What would fix it, when the user can: a button in the UI. */
  action: z.enum(['repair', 'install', 'retry', 'settings']).optional(),
  /** A command to run yourself (only when Conch can't: e.g. system libraries on Linux). */
  command: z.string().optional(),
});
export type BrowserProblem = z.infer<typeof BrowserProblem>;

export const BrowserStatus = z.object({
  phase: BrowserPhase,
  settings: BrowserSettings,
  /** The browser that runs (or will): your pick, else the first found. */
  browser: z
    .object({ name: z.string(), id: z.string(), version: z.string().optional() })
    .optional(),
  candidates: z.array(BrowserCandidate),
  install: z
    .object({
      /** 0–100. */
      percent: z.number().min(0).max(100),
      /** e.g. "Downloading Chromium · 42 of 170 MB". */
      label: z.string(),
    })
    .optional(),
  problem: BrowserProblem.optional(),
  /** Conversations with a tab open. */
  tabs: z.array(Id).default([]),
  sites: z.array(BrowserSite).default([]),
  /** Where it runs (ADR 0080). Missing from an older gateway: Conch's own, here. */
  backend: BrowserBackendStatus.optional(),
});
export type BrowserStatus = z.infer<typeof BrowserStatus>;

// ── What the agent did (conversation log) ───────────────────────────────────

export const BrowserActionKind = z.enum([
  'open',
  'read',
  'click',
  'type',
  'press',
  'select',
  'scroll',
  'back',
  'screenshot',
  'wait',
  'handoff',
  'hover',
  'drag',
  'upload',
  'tab',
]);
export type BrowserActionKind = z.infer<typeof BrowserActionKind>;

/** A normalised box on the page, 0–1 of the viewport, for highlights and the agent's cursor. */
export const BrowserBox = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BrowserBox = z.infer<typeof BrowserBox>;

/**
 * A step in a conversation's browsing, with a thumbnail of the page after it.
 * Logged twice: `running` as it starts, then `done` or `error` with the same
 * `stepId`, which replaces it in the transcript.
 */
export const BrowserStep = z.object({
  stepId: z.string(),
  status: z.enum(['running', 'waiting', 'done', 'error']).default('done'),
  action: BrowserActionKind,
  /** "Clicked “Sign in”", "Opened booking.com". */
  label: z.string(),
  url: z.string(),
  title: z.string(),
  /** Thumbnail id, served by `GET /api/browser/shots/:conversationId/:shot`. */
  shot: z.string().optional(),
  /** Who did it: the agent, or you while you had the wheel. */
  by: z.enum(['agent', 'user']).default('agent'),
});
export type BrowserStep = z.infer<typeof BrowserStep>;

/** The agent asked you to take over (sign in, a captcha, payment) and is waiting. */
export const BrowserHandoff = z.object({
  handoffId: z.string(),
  state: z.enum(['waiting', 'done', 'cancelled']),
  /** In the agent's words, shown on the card: "Sign in to your Google account". */
  reason: z.string(),
  url: z.string(),
  /** Done because Conch saw the sign-in or captcha go through, not because you pressed "I’m done". */
  auto: z.boolean().optional(),
});
export type BrowserHandoff = z.infer<typeof BrowserHandoff>;

/** A saved item to pick on a card or in the live view: names only, never a value (ADR 0130). */
export const BrowserFillAccount = z.object({
  id: z.string().min(1).max(300),
  /** The item's name: "Google". */
  title: z.string().max(200),
  /** The account it signs in as, or a card's last four: "ada@example.com", "•••• 4242". */
  account: z.string().max(200).optional(),
  /** Another password manager it lives in. */
  source: z.string().max(40).optional(),
});
export type BrowserFillAccount = z.infer<typeof BrowserFillAccount>;

/** What a fill does: sign in (username, password, a code), make a new password, or pay. */
export const BrowserFillKind = z.enum(['sign-in', 'code', 'new-password', 'card']);
export type BrowserFillKind = z.infer<typeof BrowserFillKind>;

/**
 * How the item saved for a page signs in when it isn't a password (ADR 0133),
 * for the live view: names only, never a value.
 */
export const BrowserSignInOffer = z.object({
  via: z.enum(['provider', 'passkey', 'sso', 'link']),
  /** For a provider Conch knows: its id ("google"), for its mark. */
  provider: z.string().max(40).optional(),
  /** Who: "Google", "Acme SSO"; for a passkey or a link, the item's name. */
  name: z.string().max(80),
  /** The account it signs in as, usually an email. */
  account: z.string().max(200).optional(),
  /** The page's own button for it, which Conch found and can press ("Continue with Google"). */
  button: z.string().max(120).optional(),
  /**
   * Saved as "another account" without saying whose (1Password's "Sign in with"
   * often doesn't): the page's provider buttons, for the person to choose.
   */
  buttons: z.array(z.string().max(120)).max(4).optional(),
  /** For a provider: the saved login Conch fills on the provider's pages. */
  with: BrowserFillAccount.optional(),
  /** For a passkey: Conch holds it, so it can sign in with it here. */
  usable: z.boolean().optional(),
  /** For a passkey Conch can't use: where it's kept ("1Password"). */
  keptIn: z.string().max(40).optional(),
});
export type BrowserSignInOffer = z.infer<typeof BrowserSignInOffer>;

/**
 * You're in a box Passwords can fill (ADR 0130): the live view offers it.
 * `lookalike` is the saved site this page only pretends to be; `blocked`
 * says why nothing is offered (not https, a box from another site).
 */
export const BrowserFillOffer = z.object({
  /** `sign-in`: no box, the page's own sign-in ("Continue with Google"): see `signIn`. */
  field: z.enum(['username', 'password', 'new-password', 'code', 'card', 'sign-in']),
  /** The page's host, as shown. */
  site: z.string().max(253),
  items: z.array(BrowserFillAccount).max(8).default([]),
  lookalike: z.string().max(253).optional(),
  blocked: z.enum(['insecure', 'frame']).optional(),
  /** Passwords is locked: unlock it first. */
  locked: z.boolean().optional(),
  /**
   * The item saved for this site signs in some other way than a password (ADR
   * 0133): through Google, a company's SSO, a passkey, a link by email. `items`
   * holds that one item.
   */
  signIn: BrowserSignInOffer.optional(),
  /** On a provider's page: the sign-in it's for ("Product Hunt"), its item first in `items`. */
  for: z.string().max(200).optional(),
});
export type BrowserFillOffer = z.infer<typeof BrowserFillOffer>;

/** Extra detail on a `permission.requested` for the browser, so the prompt can show the site and the control. */
export const BrowserPermission = z.object({
  /** `fill`: Conch types a saved password into the page (ADR 0025); the agent never sees it. */
  /** `upload`: files from this computer go to the site; asked every time. */
  kind: z.enum(['site', 'high-stakes', 'download', 'fill', 'upload']),
  site: z.string(),
  url: z.string(),
  title: z.string(),
  /** "Click “Place order”", "Download invoice.pdf". */
  action: z.string(),
  /** The control, if any, as a box on the page (for the highlight). */
  box: BrowserBox.optional(),
  /** Thumbnail of the page with the control, same store as steps. */
  shot: z.string().optional(),
  /** It's the person's own signed-in Chrome (ADR 0080): said, and a site is never allowed for good. */
  ownChrome: z.boolean().optional(),
  /**
   * It's an errand's own browser (ADR 0141): allowing the site also lends it
   * the person's sign-in there, copied from their main browser, until it ends.
   */
  lendsSignIn: z.boolean().optional(),
  /** For `fill`: what it does, for the card's words (ADR 0130). */
  fill: BrowserFillKind.optional(),
  /**
   * For `fill` with more than one saved account: each is a button, and the
   * answer carries the one chosen (`permission.respond` `choice`).
   */
  accounts: z.array(BrowserFillAccount).max(8).optional(),
  /** For `fill`: the item is saved for another part of this site ("accounts.google.com"). */
  savedFor: z.string().max(253).optional(),
  /**
   * For `fill` on a provider's page (ADR 0133): the sign-in it's for, "Product
   * Hunt" when Product Hunt signs in with Google. One answer covers the whole of it.
   */
  for: z.string().max(200).optional(),
});
export type BrowserPermission = z.infer<typeof BrowserPermission>;

// ── Live view: its own WebSocket, /api/browser/live?conversationId=… ─────────

/** Who's driving: the agent, you (after a takeover), or nobody right now. */
export const BrowserControl = z.enum(['agent', 'user', 'idle']);
export type BrowserControl = z.infer<typeof BrowserControl>;

/**
 * A site's icon, carried inline so the panel never loads anything from the
 * site itself. Only images, only small ones.
 */
export const BrowserTabIcon = z
  .string()
  .max(24_000)
  .regex(
    /^data:image\/(?:png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/,
  );

/** One of a chat's tabs, for the strip above the page. */
export const BrowserTabEntry = z.object({
  /** Short and stable while the tab lives: "t1", "t2"… */
  id: z.string().max(8),
  title: z.string(),
  url: z.string(),
  active: z.boolean(),
  /** The page is loading (the strip shows a spinner in place of its icon). */
  loading: z.boolean().optional(),
  /** The site's icon, as a small image the page itself fetched (never a link to load). */
  icon: BrowserTabIcon.optional(),
});
export type BrowserTabEntry = z.infer<typeof BrowserTabEntry>;

/**
 * A page's own dialog (ADR 0131): `alert`, `confirm`, `prompt`, or `leave`
 * ("Leave site? Changes may not be saved"). Shown in the panel while you drive;
 * the page is frozen until it's answered. Its words are the site's, drawn as
 * text only, under the site's name.
 */
export const BrowserPageDialog = z.object({
  id: z.string().max(16),
  kind: z.enum(['alert', 'confirm', 'prompt', 'leave']),
  /** What the page says, as it said it (untrusted). */
  message: z.string().max(1000),
  /** A `prompt`'s text to start with. */
  value: z.string().max(1000).optional(),
  /** Whose dialog: the page's host. */
  site: z.string().max(253),
});
export type BrowserPageDialog = z.infer<typeof BrowserPageDialog>;

/**
 * A browser of its own (ADR 0141): a task's (always), or a chat's the person
 * gave one. Its cookies, storage and tabs are nobody else's.
 */
export const BrowserSession = z.object({
  own: z.literal(true),
  /** `task`: a task or a helper, always on its own; `asked`: a chat the person gave one. */
  reason: z.enum(['task', 'asked']),
  /** Sites whose sign-in was lent to it from the main browser. Names only. */
  signedIn: z.array(z.string().max(253)).max(100).default([]),
});
export type BrowserSession = z.infer<typeof BrowserSession>;

export const BrowserTab = z.object({
  conversationId: Id,
  url: z.string(),
  title: z.string(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  control: BrowserControl,
  viewport: z.object({ width: z.number().int(), height: z.number().int() }),
  /** Set while the agent is waiting for you to finish something. */
  handoff: BrowserHandoff.optional(),
  /** Every tab in this chat, in order; the page shown is the `active` one. */
  tabs: z.array(BrowserTabEntry).default([]),
  /** Where it runs, when it isn't Conch's own browser here ("In your Chrome"). */
  backend: BrowserBackendKind.optional(),
  /** The page asks you something (ADR 0131): answer it with `{ type: 'dialog' }`. */
  dialog: BrowserPageDialog.optional(),
  /** Set when this chat or task has a browser of its own (ADR 0141); unset, the main one. */
  session: BrowserSession.optional(),
});
export type BrowserTab = z.infer<typeof BrowserTab>;

/**
 * Server → client, as text frames. The picture itself arrives as binary
 * frames: one JPEG each, latest wins.
 */
export const BrowserLiveEvent = z.discriminatedUnion('type', [
  /**
   * The tab changed (address, title, loading, who's driving). `null`: no tab
   * yet; with `restoring`, the chat's tabs from last time are opening again.
   */
  z.object({
    type: z.literal('tab'),
    tab: BrowserTab.nullable(),
    restoring: z.boolean().optional(),
  }),
  /** The agent is about to act: where its cursor goes and what it's doing. */
  z.object({
    type: z.literal('action'),
    action: BrowserActionKind,
    label: z.string(),
    box: BrowserBox.optional(),
    /** The page it happens on (a highlight never lands on the next page). */
    url: z.string().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  /**
   * After your click: whether the page's focus is now somewhere that takes
   * typing, so a phone's keyboard stays up only then. In a sign-in, sign-up,
   * code or card box, what Passwords can fill there (ADR 0130).
   */
  z.object({
    type: z.literal('typing'),
    editable: z.boolean(),
    fill: BrowserFillOffer.optional(),
  }),
  /** Find on page (ADR 0131): how many times the words are there, and which one is shown (1-based, 0: none). */
  z.object({
    type: z.literal('found'),
    text: z.string().max(200),
    matches: z.number().int().min(0),
    current: z.number().int().min(0),
  }),
]);
export type BrowserLiveEvent = z.infer<typeof BrowserLiveEvent>;

const Modifiers = z.object({
  alt: z.boolean().optional(),
  ctrl: z.boolean().optional(),
  meta: z.boolean().optional(),
  shift: z.boolean().optional(),
});

/** 0–1 of the viewport, so the client never needs to know the page's pixel size. */
const Point = { x: z.number().min(0).max(1), y: z.number().min(0).max(1) };

/** Client → server. Input only counts while you have the wheel (`control: user`). */
export const BrowserLiveCommand = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('mouse'),
    action: z.enum(['move', 'down', 'up', 'wheel']),
    ...Point,
    button: z.enum(['left', 'middle', 'right']).optional(),
    clickCount: z.number().int().min(0).max(3).optional(),
    deltaX: z.number().optional(),
    deltaY: z.number().optional(),
    modifiers: Modifiers.optional(),
  }),
  z.object({
    type: z.literal('key'),
    action: z.enum(['down', 'up']),
    key: z.string().max(40),
    code: z.string().max(40),
    /** The character it types, if any. */
    text: z.string().max(8).optional(),
    modifiers: Modifiers.optional(),
  }),
  /** Text from paste or an input method, inserted as-is. */
  z.object({ type: z.literal('text'), text: z.string().max(10_000) }),
  z.object({ type: z.literal('navigate'), url: z.string().min(1).max(4096) }),
  z.object({
    type: z.literal('history'),
    action: z.enum(['back', 'forward', 'reload', 'stop']),
  }),
  /** Take the wheel (`user`) or give it back (`agent`). Handing back also finishes a handoff. */
  z.object({ type: z.literal('control'), to: z.enum(['user', 'agent']) }),
  /**
   * The panel's screen size (CSS pixels). The page takes the panel's shape: a
   * desktop-width viewport as tall as the panel allows, so nothing is letterboxed.
   */
  z.object({
    type: z.literal('fit'),
    width: z.number().int().min(120).max(8000),
    height: z.number().int().min(120).max(8000),
  }),
  /** Frames only flow while someone looks: the panel says when it's visible. */
  z.object({ type: z.literal('watch'), visible: z.boolean() }),
  /**
   * Show another of the chat's tabs, close one, open a new one, close all but
   * one (`others`), or open again the one closed last (`reopen`).
   */
  z.object({
    type: z.literal('tab'),
    action: z.enum(['switch', 'close', 'new', 'others', 'reopen']),
    id: z.string().max(8).optional(),
  }),
  /** Answer the page's dialog (`BrowserTab.dialog`): OK (`accept`) or Cancel, with a prompt's text. */
  z.object({
    type: z.literal('dialog'),
    id: z.string().max(16),
    accept: z.boolean(),
    text: z.string().max(10_000).optional(),
  }),
  /**
   * Find on page: words to look for (from the top, the first one shown), then
   * `next` or `previous` to move between them. Empty words: stop finding.
   */
  z.object({
    type: z.literal('find'),
    text: z.string().max(200),
    direction: z.enum(['next', 'previous']).optional(),
  }),
  /**
   * Give this chat a browser of its own (`own`), or back to the main one
   * (ADR 0141). A person's press; a task always keeps its own.
   */
  z.object({ type: z.literal('session'), own: z.boolean() }),
  /**
   * Fill the box you're in from Passwords (ADR 0130): `item` is one of the
   * offer's, or `generate` makes a strong password and saves it. The gateway
   * finds the box itself and checks the site again; nothing comes back.
   * `signIn`: the item signs in another way (ADR 0133), and the press starts
   * it: the page's own "Continue with Google" (or the `button` chosen), or the
   * passkey Conch holds.
   */
  z.object({
    type: z.literal('fill'),
    item: z.string().max(300).optional(),
    generate: z.boolean().optional(),
    signIn: z.boolean().optional(),
    /** With `signIn`, for an item that doesn't say whose account: the button chosen, by its words. */
    button: z.string().max(120).optional(),
  }),
]);
export type BrowserLiveCommand = z.infer<typeof BrowserLiveCommand>;
