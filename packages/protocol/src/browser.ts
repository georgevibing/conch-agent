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
  /** What Conch fixed on its own lately, newest first (shown as reassurance, not alarm). */
  healed: z.array(z.object({ at: z.number(), message: z.string() })).default([]),
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
  status: z.enum(['running', 'done', 'error']).default('done'),
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
]);
export type BrowserLiveCommand = z.infer<typeof BrowserLiveCommand>;
