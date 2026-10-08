/**
 * What a tool found, drawn as it is (ADR 0060 §7). Conch's own tools (Google,
 * Slack) may return a `view` beside the text the model reads. Host tools
 * otherwise draw no row of their own, so one that found something to show
 * gets a row when it finishes, carrying its view.
 *
 * Everything in a view came from outside: it's checked against `ToolView`
 * before it's logged, links that aren't web links are dropped, and a saved
 * password that turns up in it is redacted like any tool output.
 */
import { ToolView, type ConversationEventInput, type ToolStatus } from '@conch/protocol';

/** The most rows each kind may carry, as the protocol caps them. */
const CAPS: Record<ToolView['kind'], number> = {
  agenda: 60,
  mail: 30,
  files: 30,
  messages: 30,
  sources: 10,
  downloads: 10,
  // No rows of its own: its hours and days are capped by the protocol.
  weather: 0,
  recipe: 3,
};

/** A web link worth opening: `http(s)`, parseable, and with no sign-in tucked into it. */
function webUrl(value: string): string | undefined {
  const url = value.trim();
  if (!/^https?:\/\//i.test(url)) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

/** A view as it may be logged and drawn, or nothing when it isn't one. */
export function cleanView(view: unknown, redact?: (text: string) => string): ToolView | undefined {
  if (!view || typeof view !== 'object' || Array.isArray(view)) return undefined;
  const scrub = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      if (key === 'url') return webUrl(value);
      return redact && key !== 'kind' ? redact(value) : value;
    }
    if (Array.isArray(value)) return value.map((v) => scrub(v));
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).flatMap(([k, v]) => {
          const kept = scrub(v, k);
          return kept === undefined ? [] : [[k, kept]];
        }),
      );
    return value;
  };
  const scrubbed = scrub(view) as { kind?: unknown; items?: unknown };
  const cap = typeof scrubbed.kind === 'string' ? CAPS[scrubbed.kind as ToolView['kind']] : 0;
  if (cap && Array.isArray(scrubbed.items)) scrubbed.items = scrubbed.items.slice(0, cap);
  const parsed = ToolView.safeParse(scrubbed);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Conch's own tool calls in one turn. They stay out of the transcript (memory
 * and the rest show through their own events) unless they found something to
 * show: then the call gets its row, with its view, when it finishes.
 */
export class HostToolRows {
  readonly #open = new Map<string, { name: string; input: unknown; at: number; shown: boolean }>();

  constructor(
    private readonly redact?: (text: string) => string,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * A call begins. A tool that asked for a row (`HostTool.row`: an app's
   * own tools, the maker's steps) shows at once, running; any other shows
   * only if it ends with something to show.
   */
  start(
    call: { toolUseId: string; name: string; input: unknown },
    row = false,
  ): ConversationEventInput[] {
    this.#open.set(call.toolUseId, {
      name: call.name,
      input: call.input,
      at: this.now(),
      shown: row,
    });
    return row
      ? [{ type: 'tool.started', toolUseId: call.toolUseId, name: call.name, input: call.input }]
      : [];
  }

  owns(toolUseId: string): boolean {
    return this.#open.has(toolUseId);
  }

  /**
   * The one call of this tool still running (`image_generate` or its
   * `mcp__conch__` name), when there's exactly one: whose question a host
   * tool's `ask` is. Two at once can't be told apart, so neither is named.
   */
  running(toolName: string): string | undefined {
    const bare = toolName.replace(/^mcp__conch__/, '');
    const ids = [...this.#open].flatMap(([id, call]) =>
      call.name.replace(/^mcp__conch__/, '') === bare ? [id] : [],
    );
    return ids.length === 1 ? ids[0] : undefined;
  }

  /** The events that draw it, if it found something to show; none otherwise. */
  end(call: {
    toolUseId: string;
    status: ToolStatus;
    output?: string;
    view?: unknown;
  }): ConversationEventInput[] {
    const open = this.#open.get(call.toolUseId);
    this.#open.delete(call.toolUseId);
    if (!open) return [];
    const view = call.status === 'success' ? cleanView(call.view, this.redact) : undefined;
    const finished: ConversationEventInput = {
      type: 'tool.finished',
      toolUseId: call.toolUseId,
      status: call.status,
      output: call.output,
      durationMs: Math.max(0, this.now() - open.at),
      ...(view && { view }),
    };
    if (open.shown) return [finished];
    if (call.status !== 'success' || !view) return [];
    return [
      { type: 'tool.started', toolUseId: call.toolUseId, name: open.name, input: open.input },
      finished,
    ];
  }
}
