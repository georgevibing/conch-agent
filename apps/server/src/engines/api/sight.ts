/**
 * What a tool's pictures become for the model answering (ADR 0070).
 *
 * A screenshot reaches a model that can see it as a picture, in the
 * provider's own shape (each wire's `toolResults`, Codex's `inputImage`, an
 * MCP `image`). A model that can't see gets words instead: what another model
 * saw in it, or — when none of the person's models can look — one plain
 * sentence that says so and what to use instead. Shared by every engine that
 * runs Conch's tools itself, so they all behave the same.
 */
import type { Usage } from '@conch/protocol';

import { MODEL_FIT } from '../../attachments/fit';
import type { DescribeImages, Picture } from '../types';
import type { Callable } from './engine';

/**
 * The most of a picture a model reads (ADR 0070). Past it the provider scales
 * the picture down itself, so the model reads its pixels in a space the tool
 * never told it about (and a computer-use tool's picture is refused): Conch
 * sends it at this size instead, and keeps the scale for coordinates.
 */
export interface PictureLimit {
  /** Longest edge, in pixels. */
  edge: number;
  /** Most of Claude's visual tokens: ⌈width ÷ 28⌉ × ⌈height ÷ 28⌉. */
  tokens?: number;
}

/** Claude before 4.7: 1568 px on the long edge, and 1568 visual tokens. */
export const STANDARD_SIGHT: PictureLimit = { edge: 1568, tokens: 1568 };

/**
 * Claude 4.7 and later read up to 2576 px and 4784 tokens; Conch keeps to
 * 2000 px, past which a request with more than 20 pictures is refused.
 */
export const HIGH_SIGHT: PictureLimit = { edge: MODEL_FIT.edge, tokens: 4784 };

/** Every other model: what they read at most (OpenAI 2048 px), the same 2000 px. */
export const OTHER_SIGHT: PictureLimit = { edge: MODEL_FIT.edge };

/** A Claude model's [major, minor] version from any provider's id for it; undefined for another model. */
export function claudeVersion(model: string): [number, number] | undefined {
  const id = model.toLowerCase();
  // claude-opus-4-7, anthropic/claude-opus-4.7, us.anthropic.claude-sonnet-4-5-20250929-v1:0
  const named = /claude-[a-z]+-(\d+)(?:[-.](\d{1,2})(?!\d))?/.exec(id);
  // claude-3-5-sonnet-20241022, claude-3-opus
  const old = /claude-(\d+)(?:[-.](\d)(?!\d))?-[a-z]/.exec(id);
  const found = named ?? old;
  if (!found) return undefined;
  return [Number(found[1]), Number(found[2] ?? 0)];
}

/** The most of a picture `model` reads; the newest Claude's when it isn't known which. */
export function pictureLimit(model: string | undefined): PictureLimit {
  if (!model) return HIGH_SIGHT;
  const version = claudeVersion(model);
  if (version) {
    const [major, minor] = version;
    return major < 4 || (major === 4 && minor < 7) ? STANDARD_SIGHT : HIGH_SIGHT;
  }
  // An alias (`opus`, `sonnet`, `default`) is a current Claude.
  return /^(?:opus|sonnet|haiku|fable|default)\b/i.test(model) ? HIGH_SIGHT : OTHER_SIGHT;
}

/** What a picture of `width`×`height` costs Claude, in visual tokens. */
export function pictureTokens(width: number, height: number): number {
  return Math.ceil(width / 28) * Math.ceil(height / 28);
}

/**
 * The size a `width`×`height` picture goes to a model at: as it is when it
 * fits `limit`, else scaled down (never up) until it does, its shape kept.
 */
export function fitPictureTo(
  width: number,
  height: number,
  limit: PictureLimit,
): { width: number; height: number } {
  const fits = (w: number, h: number) =>
    Math.max(w, h) <= limit.edge && (!limit.tokens || pictureTokens(w, h) <= limit.tokens);
  if (fits(width, height)) return { width, height };
  let scale = limit.edge / Math.max(width, height);
  if (limit.tokens) scale = Math.min(scale, Math.sqrt((limit.tokens * 28 * 28) / (width * height)));
  for (;;) {
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    if (fits(w, h) || (w === 1 && h === 1)) return { width: w, height: h };
    scale *= 0.99;
  }
}

/** When no model can look at a screenshot: say so, and what to use instead. */
export const NO_SIGHT =
  'This model can’t see pictures, and none of the models connected to Conch can look at it for you, so the screenshot isn’t shown. Use browser_read for the page’s text and controls; if only seeing will do (a captcha, a chart), use browser_handoff to ask the person.';

/** When no model can look at any other picture. */
export const NO_SIGHT_OTHER =
  'This model can’t see pictures, and none of the models connected to Conch can look at them for you.';

/** What the describer is told the pictures are, by the tool that made them. */
export function whatPictures(tool: string): string {
  return /browser_screenshot$/.test(tool)
    ? 'a screenshot of a web page in Conch’s browser'
    : `a picture the ${tool.replace(/^mcp__[^_]+__/, '')} tool returned`;
}

/** Pictures as words, by the turn's describer, or the plain sentence when there is none. */
export async function describeOrSay(
  images: readonly Picture[],
  options: {
    describe?: DescribeImages;
    what: string;
    signal: AbortSignal;
    spent?: (usage: Usage | undefined) => void;
  },
): Promise<string> {
  const none = /screenshot/.test(options.what) ? NO_SIGHT : NO_SIGHT_OTHER;
  if (!options.describe) return none;
  try {
    const { text, usage } = await options.describe(images, {
      what: options.what,
      signal: options.signal,
    });
    options.spent?.(usage);
    return text || none;
  } catch {
    return none;
  }
}

/**
 * The same tools, with each one's pictures kept for a model that sees them
 * (`sees()`, asked on every call: a model can turn out blind mid-turn) and put
 * into words for one that doesn't.
 */
export function withSight(
  tools: ReadonlyMap<string, Callable>,
  options: {
    sees: () => boolean;
    describe?: DescribeImages;
    signal: AbortSignal;
    spent?: (usage: Usage | undefined) => void;
  },
): Map<string, Callable> {
  const out = new Map<string, Callable>();
  for (const [name, tool] of tools)
    out.set(name, {
      ...tool,
      run: async (args, id) => {
        const result = await tool.run(args, id);
        if (!result.images?.length || options.sees()) return result;
        const { images, ...rest } = result;
        const words = await describeOrSay(images, {
          ...(options.describe && { describe: options.describe }),
          what: whatPictures(tool.display),
          signal: options.signal,
          ...(options.spent && { spent: options.spent }),
        });
        return { ...rest, text: `${rest.text}\n\n${words}` };
      },
    });
  return out;
}
