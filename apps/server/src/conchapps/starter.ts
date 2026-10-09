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
  /**
   * What it is (ADR 0119): an app with tools and a page (the default), a
   * provider (declared: an address, its key and models), or a chat app (its
   * `channel` functions). Each starts from a draft that already reads.
   */
  kind?: 'app' | 'provider' | 'channel';
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

/**
 * A provider, declared (ADR 0119): an address that speaks OpenAI's chat, how
 * its key is sent, and its models read live. The maker changes the address,
 * the host in `reaches`, the key's words and, when the company says, its
 * models and their prices.
 */
function providerStarter(name: string, id: string, seed: StarterSeed): Map<string, string> {
  const manifest: ConchAppManifest = {
    conch: 1,
    id,
    name,
    tagline: (seed.tagline?.trim() || `${name}’s models, in every chat`).slice(0, 80),
    description: (seed.description?.trim() ?? '').slice(0, 600),
    version: '0.1.0',
    icon: { glyph: 'sparkles', color: 'violet' },
    kind: 'developer',
    pages: [],
    reaches: ['api.example.com'],
    settings: [],
    instructions: '',
    examples: [],
    provider: {
      speaks: 'openai',
      address: 'https://api.example.com/v1',
      auth: 'bearer',
      key: {
        label: `${name} API key`,
        help: `Make one on ${name}’s API keys page.`,
        link: 'https://api.example.com/keys',
        optional: false,
      },
      models: [],
    },
  };
  return new Map([
    ['conch-app.json', `${JSON.stringify(manifest, null, 2)}\n`],
    [
      'README.md',
      `# ${name}\n\n${manifest.tagline}\n\nA provider for Conch. To add it, paste this repository's address into **Settings → Providers → Add your own → From a link**.\n`,
    ],
  ]);
}

/**
 * A chat app (ADR 0119): `channel.identify`, `poll` and `send` against its
 * bot API with `app.fetch`, and the token the person types (`app.keys`). The
 * maker changes the address, the paths and the shapes to the app's own.
 */
function channelStarter(name: string, id: string, seed: StarterSeed): Map<string, string> {
  const manifest: ConchAppManifest = {
    conch: 1,
    id,
    name,
    tagline: (seed.tagline?.trim() || `Talk to your assistant on ${name}`).slice(0, 80),
    description: (seed.description?.trim() ?? '').slice(0, 600),
    version: '0.1.0',
    icon: { glyph: 'message-circle', color: 'teal' },
    kind: 'personal',
    tools: 'channel.mjs',
    pages: [],
    reaches: ['chat.example.com'],
    settings: [],
    instructions: '',
    examples: [],
    channel: {
      name,
      receives: 'poll',
      fields: [
        {
          key: 'token',
          label: `${name} bot token`,
          help: `${name} shows it once, when you make the bot.`,
          link: 'https://chat.example.com/bots',
          secret: true,
          optional: false,
        },
      ],
      steps: [`In ${name}, make a bot for your assistant.`, 'Copy its token.'],
      buttons: false,
    },
  };
  const code = `// ${name}, as a chat app for Conch. Conch keeps the token (app.keys.token) and calls these.
const API = 'https://chat.example.com/api';

async function ask(app, path, init = {}) {
  const res = await app.fetch(API + path, {
    ...init,
    headers: { authorization: 'Bearer ' + app.keys.token, 'content-type': 'application/json' },
  });
  if (res.status === 401) throw new Error('${name} refused the token: make a new one and paste it again.');
  if (!res.ok) throw new Error('${name} said ' + res.status + '.');
  return res.json();
}

export const channel = {
  /** Who the bot is. */
  async identify(app) {
    const me = await ask(app, '/me');
    return { id: me.id, name: me.name, username: me.username };
  },
  /** New messages since \`cursor\`; Conch calls this again and again. */
  async poll({ cursor }, app) {
    const { messages } = await ask(app, '/updates?after=' + encodeURIComponent(cursor ?? '0'));
    return {
      messages: messages.map((m) => ({
        chatId: m.chat,
        messageId: String(m.id),
        user: { id: m.from.id, name: m.from.name },
        text: m.text,
      })),
      cursor: messages.length ? String(messages.at(-1).id) : cursor ?? undefined,
    };
  },
  /** One message out, in Markdown. */
  async send({ chatId, text }, app) {
    const sent = await ask(app, '/messages', { method: 'POST', body: JSON.stringify({ chat: chatId, text }) });
    return { messageId: sent.id };
  },
};
`;
  return new Map([
    ['conch-app.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['channel.mjs', code],
    [
      'README.md',
      `# ${name}\n\n${manifest.tagline}\n\nA chat app for Conch. To add it, paste this repository's address into **Apps → Talk to me here → Add your own → From a link**.\n`,
    ],
  ]);
}

export function starterFiles(seed: StarterSeed): Map<string, string> {
  const name = seed.name.trim().slice(0, 40) || 'My app';
  const id = seed.id && AppId.safeParse(seed.id).success ? seed.id : idFrom(name);
  if (seed.kind === 'provider') return providerStarter(name, id, seed);
  if (seed.kind === 'channel') return channelStarter(name, id, seed);
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
      properties: { text: { type: 'string', minLength: 1, maxLength: 4000, description: 'The note, in the person’s words' } },
      required: ['text'],
    },
    changes: true,
    async run({ text }, app) {
      const note = String(text ?? '').trim();
      if (!note) throw new Error('The note is empty. Ask the person what to write down.');
      await app.data.update('notes', (notes = []) => [...notes, { text: note, at: app.now() }]);
      return \`Added: \${note}\`;
    },
  },
  list_notes: {
    title: 'List the notes',
    description: 'Lists the notes in ${name}, newest first. Use when the person asks what they wrote down.',
    input: { type: 'object', properties: {} },
    changes: false,
    cache: { maxAge: 30 },
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
    function show(result) {
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
      status.textContent = result.error || (result.refreshing ? 'Updating…' : result.stale ? 'Showing saved notes.' : 'Up to date.');
    }
    const notesView = conch.observe('list_notes', {}, { every: 30 }, show);
    const field = document.getElementById('note');
    const addButton = document.getElementById('add');
    async function add() {
      if (addButton.disabled || !field.value.trim()) return;
      addButton.disabled = true;
      let result;
      try { result = await conch.call('add_note', { text: field.value }); }
      catch { status.textContent = 'The note could not be saved. Try again.'; return; }
      finally { addButton.disabled = false; }
      status.textContent = result.ok ? '' : result.message;
      if (result.ok) field.value = '';
      if (result.ok) notesView.refresh();
    }
    document.getElementById('add').addEventListener('click', add);
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add();
    });

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
