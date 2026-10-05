import type { DiffLine } from '@conch/nacre';

type Input = Record<string, unknown>;

const str = (input: Input, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string) : undefined;

/** One-line summary for a tool call row. */
export function toolSummary(name: string, raw: unknown): string | undefined {
  const input = (raw ?? {}) as Input;
  const file = str(input, 'file_path') ?? str(input, 'path') ?? str(input, 'notebook_path');
  switch (name) {
    case 'mcp__conch__process_start':
    case 'Bash':
      return str(input, 'command');
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return file;
    case 'Grep':
      return str(input, 'pattern') && `“${str(input, 'pattern')}”${file ? ` in ${file}` : ''}`;
    case 'Glob':
      return str(input, 'pattern');
    case 'mcp__conch__web_fetch':
    case 'WebFetch':
      return str(input, 'url');
    case 'mcp__conch__web_search':
    case 'WebSearch':
      return str(input, 'query');
    case 'mcp__conch__image_generate':
      return str(input, 'prompt');
    case 'mcp__conch__search_files':
      return str(input, 'text') ?? str(input, 'name') ?? file;
    case 'Task':
    case 'Agent':
      return str(input, 'description');
    // Drawn as the plan's own card now (ADR 0060); older chats still have the rows.
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as Input[]) : [];
      const done = todos.filter((t) => t.status === 'completed').length;
      return todos.length ? `Plan · ${done} of ${todos.length} done` : 'Plan';
    }
    case 'TaskCreate':
    case 'TaskUpdate':
      return str(input, 'subject') ?? 'Plan';
    // The steps of making an app (ADR 0061): what each is about, in a few words.
    case 'mcp__conch__app_new':
      return str(input, 'name');
    case 'mcp__conch__app_try':
      return str(input, 'tool');
    case 'mcp__conch__app_find':
      return str(input, 'query');
    case 'mcp__conch__app_get':
      return str(input, 'link');
    // Where its picture came from; never the bytes themselves.
    case 'mcp__conch__app_icon':
      return str(input, 'url') ?? str(input, 'file');
    case 'mcp__conch__app_check':
    case 'mcp__conch__app_present':
    case 'mcp__conch__app_share':
    case 'mcp__conch__app_edit':
      return undefined;
    default:
      return str(input, 'description') ?? file;
  }
}

/** Old/new strings from Edit/MultiEdit/Write become a readable diff. */
export function toolDiff(name: string, raw: unknown): DiffLine[] | undefined {
  const input = (raw ?? {}) as Input;
  const lines = (text: string | undefined, kind: 'add' | 'del'): DiffLine[] =>
    (text ?? '').split('\n').map((t) => ({ kind, text: t }));
  if (name === 'Edit') {
    return [...lines(str(input, 'old_string'), 'del'), ...lines(str(input, 'new_string'), 'add')];
  }
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    return (input.edits as Input[]).flatMap((edit, i) => [
      ...(i > 0 ? [{ kind: 'hunk' as const, text: '…' }] : []),
      ...lines(str(edit, 'old_string'), 'del'),
      ...lines(str(edit, 'new_string'), 'add'),
    ]);
  }
  if (name === 'Write') return lines(str(input, 'content'), 'add').slice(0, 400);
  return undefined;
}

export function formatInput(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object' && Object.keys(raw).length === 0) return undefined;
  return JSON.stringify(raw, null, 2);
}
