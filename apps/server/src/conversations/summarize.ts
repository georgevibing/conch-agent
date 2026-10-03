/** One-line, human description of what a tool wants to do, for permission prompts. */
export function summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
  const str = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string) : undefined;
  const file = str('file_path') ?? str('path') ?? str('notebook_path');
  switch (toolName) {
    case 'Bash':
      return `Run \`${(str('command') ?? '').slice(0, 200)}\``;
    case 'Write':
      return `Create ${file ?? 'a file'}`;
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return `Edit ${file ?? 'a file'}`;
    case 'Read':
      return `Read ${file ?? 'a file'}`;
    case 'WebFetch':
      return `Open ${str('url') ?? 'a web page'}`;
    case 'WebSearch':
      return `Search the web for “${str('query') ?? ''}”`;
    // Plan mode's question (ADR 0060): the card shows the plan, with Start and Keep planning.
    case 'ExitPlanMode':
      return 'Start on the plan';
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
      if (mcp) return `Use ${mcp[2]} from ${mcp[1]}`;
      return `Use ${toolName}`;
    }
  }
}

/** A short title from the first message: first line, at a word boundary. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line.length <= 48) return line;
  const cut = line.slice(0, 48);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 24 ? cut.lastIndexOf(' ') : 48)}…`;
}
