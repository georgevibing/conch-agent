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

import type { DescribeImages, Picture } from '../types';
import type { Callable } from './engine';

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
