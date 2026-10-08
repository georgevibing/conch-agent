/** One-line, human description of what a tool wants to do, for permission prompts. */
export function summarizeToolUse(toolName: string, input: Record<string, unknown>): string {
  const str = (key: string) =>
    typeof input[key] === 'string' ? (input[key] as string) : undefined;
  const file = str('file_path') ?? str('path') ?? str('notebook_path');
  const conch = toolName.replace(/^mcp__conch__/, '');
  const labels: Record<string, string> = {
    read_file: `Read ${file ?? 'a text file'}`,
    read_document: `Read ${file ?? 'a document'}`,
    search_files: `Find files${str('text') ? ` containing “${str('text')}”` : str('name') ? ` named “${str('name')}”` : ''}`,
    web_search: `Search the web for “${str('query') ?? ''}”`,
    web_fetch: `Read ${str('url') ?? 'a web page'}`,
    process_start: `Start “${(str('command') ?? '').slice(0, 160)}”`,
    process_read: 'Read command progress',
    process_write: 'Send input to a command',
    process_stop: 'Stop a command',
    task_status: 'Read task progress',
    task_control: `${str('action') ?? 'Update'} a task`,
    publish_file: `Offer ${str('name') ?? file ?? 'a finished file'} to download`,
    image_models: 'Find image models',
    file_make: `Make ${str('name') ?? 'a file'}${str('format') ? ` (${String(str('format')).toUpperCase()})` : ''}`,
    file_convert: `Convert ${str('source')?.startsWith('att_') ? 'a file' : (str('source') ?? 'a file')} to ${String(str('to') ?? 'another format').toUpperCase()}`,
    file_combine: `Combine files into ${str('name') ?? `one ${String(str('to') ?? 'file').toUpperCase()}`}`,
    file_unzip: `Unpack ${str('source')?.startsWith('att_') ? 'an archive' : (str('source') ?? 'an archive')}`,
    image_generate: str('source') ? 'Edit a picture' : 'Create a picture',
  };
  if (labels[conch]) return labels[conch];
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
