import type { EngineEvent } from '../types';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const name = (value: unknown) =>
  typeof value === 'string' && /^[\w.-]{1,200}$/.test(value) ? value : undefined;

/** Standard app-server events for tools which are not Conch dynamic calls.
 * An MCP annotation never proves that a tool is read-only or that a write succeeded.
 */
export class CodexToolEvents {
  readonly #started = new Set<string>();
  readonly #finished = new Set<string>();
  constructor(private readonly hostNames: ReadonlySet<string> = new Set()) {}

  read(
    method: string | undefined,
    params: Record<string, unknown>,
    invoked: ReadonlySet<string>,
  ): EngineEvent[] {
    if (method !== 'item/started' && method !== 'item/completed') return [];
    const item = object(params.item);
    const id = typeof item.id === 'string' && item.id.length <= 200 ? item.id : '';
    if (
      !id ||
      invoked.has(id) ||
      this.#finished.has(id) ||
      (!this.#started.has(id) && this.#started.size >= 512)
    )
      return [];
    let tool: string;
    let input: unknown = item.arguments ?? {};
    if (item.type === 'mcpToolCall') {
      const server = name(item.server),
        called = name(item.tool);
      if (!server || !called) return [];
      tool = `mcp__${server}__${called}`;
    } else if (item.type === 'dynamicToolCall') {
      const called = name(item.tool),
        namespace = name(item.namespace);
      if (
        !called ||
        this.hostNames.has(called) ||
        (namespace && this.hostNames.has(`${namespace}__${called}`))
      )
        return [];
      tool = `provider__${namespace ?? 'native'}__${called}`;
    } else if (item.type === 'webSearch') {
      tool = 'WebSearch';
      input = { query: typeof item.query === 'string' ? item.query : '', action: item.action };
    } else return [];
    const events: EngineEvent[] = [];
    if (!this.#started.has(id)) {
      this.#started.add(id);
      events.push({ type: 'tool-start', toolUseId: id, name: tool, input });
    }
    if (method === 'item/completed') {
      this.#finished.add(id);
      const result = object(item.result),
        error = object(item.error);
      const ok =
        item.type === 'webSearch'
          ? item.status !== 'failed' && !item.error
          : item.status === 'completed' &&
            item.success !== false &&
            result.isError !== true &&
            !item.error;
      const content = item.type === 'dynamicToolCall' ? item.contentItems : result.content;
      const texts = Array.isArray(content)
        ? content.flatMap((part) => {
            const block = object(part);
            return typeof block.text === 'string' ? [block.text] : [];
          })
        : [];
      const output = (
        texts.join('\n') ||
        (typeof error.message === 'string'
          ? error.message
          : ok
            ? 'Provider tool completed.'
            : 'Provider tool failed.')
      ).slice(0, 8000);
      events.push({ type: 'tool-end', toolUseId: id, status: ok ? 'success' : 'error', output });
    }
    return events;
  }
}
