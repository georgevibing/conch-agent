/**
 * Every tool call's words on the wire (ADR 0103): `describeTool`'s label,
 * written onto `tool.started` and `tool.finished` as the log is kept. Never
 * throws, and never puts anything on the wire the protocol would refuse: a
 * label that can't be made is left off, and the chat works one out itself.
 */
import { describeTool, ToolLabel, type ToolResult } from '@conch/protocol';

/** A picture on a chip is a link or a small icon; a big inline one stays out of the log. */
const MAX_CHIP_IMAGE = 4_000;

export function toolLabel(
  name: string,
  input: unknown,
  result?: ToolResult,
): ToolLabel | undefined {
  try {
    const parsed = ToolLabel.safeParse(describeTool(name, input, result));
    if (!parsed.success) return undefined;
    const label = parsed.data;
    if (!label.chips?.some((chip) => (chip.image?.length ?? 0) > MAX_CHIP_IMAGE)) return label;
    return {
      ...label,
      chips: label.chips.map(({ image, ...chip }) =>
        image && image.length > MAX_CHIP_IMAGE ? chip : { ...chip, ...(image && { image }) },
      ),
    };
  } catch {
    return undefined;
  }
}

/**
 * A label with a saved password nowhere in its words: what it's about, what
 * it did and came to, its effects and chips. Labels are worked out from a
 * call's input, which isn't redacted, so each is passed through `redact` as
 * it's logged, and kept within the protocol's lengths after.
 */
export function redactLabel(label: ToolLabel, redact: (text: string) => string): ToolLabel {
  const r = (text: string, max: number) => redact(text).slice(0, max);
  return {
    ...label,
    doing: r(label.doing, 160),
    done: r(label.done, 160),
    ...(label.outcome !== undefined && { outcome: r(label.outcome, 160) }),
    ...(label.subject !== undefined && { subject: r(label.subject, 300) }),
    ...(label.effects && {
      effects: label.effects.map((effect) => ({
        ...effect,
        text: r(effect.text, 200),
        ...(effect.target !== undefined && { target: r(effect.target, 300) }),
      })),
    }),
    ...(label.chips && {
      chips: label.chips.map((chip) => ({
        ...chip,
        label: r(chip.label, 120),
        ...(chip.href !== undefined && { href: r(chip.href, 2000) }),
      })),
    }),
  };
}
