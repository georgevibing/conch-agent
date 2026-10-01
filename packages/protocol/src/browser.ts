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
});
export type BrowserHandoff = z.infer<typeof BrowserHandoff>;

/** Extra detail on a `permission.requested` for the browser, so the prompt can show the site and the control. */
export const BrowserPermission = z.object({
  /** `fill`: Conch types a saved password into the page (ADR 0025); the agent never sees it. */
  kind: z.enum(['site', 'high-stakes', 'download', 'fill']),
  site: z.string(),
  url: z.string(),
  title: z.string(),
  /** "Click “Place order”", "Download invoice.pdf". */
  action: z.string(),
  /** The control, if any, as a box on the page (for the highlight). */
  box: BrowserBox.optional(),
  /** Thumbnail of the page with the control, same store as steps. */
  shot: z.string().optional(),
});
export type BrowserPermission = z.infer<typeof BrowserPermission>;

// ── Live view: its own WebSocket, /api/browser/live?conversationId=… ─────────

/** Who's driving: the agent, you (after a takeover), or nobody right now. */
export const BrowserControl = z.enum(['agent', 'user', 'idle']);
export type BrowserControl = z.infer<typeof BrowserControl>;

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
});
export type BrowserTab = z.infer<typeof BrowserTab>;

/**
 * Server → client, as text frames. The picture itself arrives as binary
 * frames: one JPEG each, latest wins.
 */
export const BrowserLiveEvent = z.discriminatedUnion('type', [
  /** The tab changed (address, title, loading, who's driving). `null`: no tab yet. */
  z.object({ type: z.literal('tab'), tab: BrowserTab.nullable() }),
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
  z.object({ type: z.literal('history'), action: z.enum(['back', 'forward', 'reload']) }),
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
]);
export type BrowserLiveCommand = z.infer<typeof BrowserLiveCommand>;
