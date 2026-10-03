/**
 * What `app_new` starts from: a small app that already has the shape the
 * quality bar asks for (ADR 0061 §4) — a manifest, a tools module with one
 * tool that keeps a note, and a page made of the page kit's classes — so
 * the assistant changes something that works instead of starting blank.
 */
import { AppId, type ConchAppManifest } from '@conch/protocol';

export interface StarterSeed {
  /** "Plant diary" */
  name: string;
  /** `plant-diary`; made from the name when it isn't given. */
  id?: string;
  /** What it does, in a line. */
  tagline?: string;
  description?: string;
}

/** An id from a name: "Plant diary" → `plant-diary`. */
export function idFrom(name: string): string {
  const id = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return AppId.safeParse(id).success ? id : 'my-app';
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function starterFiles(seed: StarterSeed): Map<string, string> {
  const name = seed.name.trim().slice(0, 40) || 'My app';
  const id = seed.id && AppId.safeParse(seed.id).success ? seed.id : idFrom(name);
  const manifest: ConchAppManifest = {
    conch: 1,
    id,
    name,
    tagline: (seed.tagline?.trim() || `Keeps notes for ${name}`).slice(0, 80),
    description: (seed.description?.trim() ?? '').slice(0, 600),
    version: '0.1.0',
    icon: { glyph: 'sparkles', color: 'blue' },
    kind: 'personal',
    tools: 'tools.mjs',
    pages: [{ id: 'main', title: name, file: 'pages/main.html' }],
    reaches: [],
    settings: [],
    instructions: `Use ${name} when the person wants to add a note or see their notes. Add one with add_note; read them with list_notes.`,
    examples: ['Add a note: buy more soil', 'What are my notes?'],
  };
  const tools = `// ${name}: what the assistant can do with it. No imports; \`app\` is everything a tool can reach.
export const tools = {
  add_note: {
    title: 'Add a note',
    description: 'Adds a note to ${name}. Use when the person wants something written down here.',
    input: {
      type: 'object',
      properties: { text: { type: 'string', description: 'The note, in the person’s words' } },
      required: ['text'],
    },
    changes: true,
    async run({ text }, app) {
      const note = String(text ?? '').trim();
      if (!note) throw new Error('The note is empty. Ask the person what to write down.');
      const notes = (await app.data.get('notes')) ?? [];
      notes.push({ text: note, at: app.now() });
      await app.data.set('notes', notes);
      return \`Added: \${note}\`;
    },
  },
  list_notes: {
    title: 'List the notes',
    description: 'Lists the notes in ${name}, newest first. Use when the person asks what they wrote down.',
    input: { type: 'object', properties: {} },
    changes: false,
    async run(_input, app) {
      const notes = (await app.data.get('notes')) ?? [];
      return { notes: [...notes].reverse() };
    },
  },
};
`;
  const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(name)}</title>
</head>
<body>
  <main class="nc-stack">
    <h1>${escapeHtml(name)}</h1>
    <div class="nc-row">
      <label for="note">New note</label>
      <input id="note" autocomplete="off">
      <button class="primary" id="add" type="button">Add</button>
    </div>
    <p class="nc-muted" id="status" role="status"></p>
    <ul class="nc-stack" id="notes"></ul>
    <p class="nc-empty" id="empty" hidden>No notes yet. Add one above, or ask your assistant.</p>
  </main>
  <script>
    const list = document.getElementById('notes');
    const empty = document.getElementById('empty');
    const status = document.getElementById('status');
    async function show() {
      const result = await conch.call('list_notes', {});
      if (!result.ok) {
        status.textContent = result.message;
        return;
      }
      const notes = result.json?.notes ?? [];
      list.replaceChildren(
        ...notes.map((n) => {
          const item = document.createElement('li');
          item.className = 'nc-card';
          item.textContent = n.text;
          return item;
        }),
      );
      empty.hidden = notes.length > 0;
    }
    const field = document.getElementById('note');
    async function add() {
      if (!field.value.trim()) return;
      const result = await conch.call('add_note', { text: field.value });
      status.textContent = result.ok ? '' : result.message;
      if (result.ok) field.value = '';
      await show();
    }
    document.getElementById('add').addEventListener('click', add);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add();
    });
    show();
  </script>
</body>
</html>
`;
  const readme = `# ${name}

${manifest.tagline}

A Conch app. To add it, paste this repository's address into **Apps → Add your own → From a link** in Conch.
`;
  return new Map([
    ['conch-app.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['tools.mjs', tools],
    ['pages/main.html', page],
    ['README.md', readme],
  ]);
}
