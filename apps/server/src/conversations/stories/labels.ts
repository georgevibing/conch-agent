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
