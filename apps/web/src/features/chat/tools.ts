import type { DiffLine } from '@conch/nacre';

type Input = Record<string, unknown>;

const str = (input: Input, key: string) =>
  typeof input[key] === 'string' ? (input[key] as string) : undefined;

/** One-line summary for a tool call row. */
export function toolSummary(name: string, raw: unknown): string | undefined {
  const input = (raw ?? {}) as Input;
  const file = str(input, 'file_path') ?? str(input, 'path') ?? str(input, 'notebook_path');
  switch (name) {
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
    case 'WebFetch':
      return str(input, 'url');
    case 'WebSearch':
      return str(input, 'query');
    case 'Task':
    case 'Agent':
      return str(input, 'description');
    // Drawn as the plan's own card now (ADR 0055); older chats still have the rows.
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as Input[]) : [];
      const done = todos.filter((t) => t.status === 'completed').length;
      return todos.length ? `Plan · ${done} of ${todos.length} done` : 'Plan';
    }
    case 'TaskCreate':
    case 'TaskUpdate':
      return str(input, 'subject') ?? 'Plan';
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
