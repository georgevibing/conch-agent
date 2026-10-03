/**
 * The maker's guide (`app_guide`, ADR 0061 §4): what a Conch app is, how
 * its tools and pages work, the quality bar, and the steps — for whichever
 * model is building one. Read before building; the prompt says so.
 */

const EXAMPLE_MANIFEST = `{
  "conch": 1,
  "id": "tally",
  "name": "Tally",
  "tagline": "Counts things for you, one tap at a time",
  "description": "A counter you can add to from a chat or from its page.",
  "version": "1.0.0",
  "icon": { "glyph": "calculator", "color": "teal" },
  "kind": "personal",
  "tools": "tools.mjs",
  "pages": [{ "id": "main", "title": "Tally", "file": "pages/main.html" }],
  "reaches": [],
  "settings": [],
  "instructions": "Use Tally when the person wants to count something or asks how many. Add with count; read with read_count.",
  "examples": ["Count one more coffee", "How many is the tally at?"]
}`;

const EXAMPLE_TOOLS = `export const tools = {
  count: {
    title: 'Count one more',
    description: 'Adds to the tally. Use when the person wants to count something.',
    input: {
      type: 'object',
      properties: { by: { type: 'integer', description: 'How many to add; 1 when unsaid', minimum: 1 } },
    },
    changes: true,
    async run({ by = 1 }, app) {
      await app.data.update('total', (n) => (n ?? 0) + by);
      const total = await app.data.get('total');
      return { total, text: \`The tally is at \${total}.\` };
    },
  },
  read_count: {
    title: 'Read the tally',
    description: 'Says what the tally is at. Use when the person asks how many.',
    input: { type: 'object', properties: {} },
    changes: false,
    async run(_input, app) {
      return { total: (await app.data.get('total')) ?? 0 };
    },
  },
};`;

const EXAMPLE_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tally</title>
  <style>.big { font-size: 4rem; font-weight: 600; text-align: center; }</style>
</head>
<body>
  <main class="nc-stack">
    <p class="big" id="total" aria-live="polite">0</p>
    <button class="primary" id="add" type="button">Count one more</button>
    <p class="nc-muted" id="status" role="status"></p>
  </main>
  <script>
    const total = document.getElementById('total');
    const status = document.getElementById('status');
    async function show() {
      const r = await conch.call('read_count', {});
      if (r.ok) total.textContent = r.json.total;
      else status.textContent = r.message;
    }
    document.getElementById('add').addEventListener('click', async () => {
      const r = await conch.call('count', { by: 1 });
      status.textContent = r.ok ? '' : r.message;
      await show();
    });
    show();
  </script>
</body>
</html>`;

export function makerGuide(): string {
  return `# Making a Conch app

A Conch app gives the assistant a new ability that every model can use, and often a page of its own. You build it in this chat with the app_* tools; the person adds it by pressing the card you present. Nothing you do installs anything.

## The steps

1. app_new with a name (and a tagline): you get a draft that already works — a manifest, a tools module with two tools and a page.
2. Change it with app_write (whole files; app_read to look). Keep what the person asked for, and nothing they didn't.
3. app_check: the quality bar. Fix every problem it lists, and the warnings you can.
4. app_try every tool at least once, with realistic input. Each runs on the draft's own scratch data, never the person's.
5. app_check again if you changed anything, then app_present with one sentence on what you made.
6. Tell the person the card is under your reply. Never say it's added until the card says so.

Build first and ask only what you can't sensibly assume. To change an app the person has, start with app_edit.

## The folder

- conch-app.json — what it is (required).
- tools.mjs — what the assistant can do with it (optional).
- pages/<name>.html — up to 4 pages of its own (optional).
- skills/<name>/SKILL.md — longer know-how for the assistant (optional).
- README.md — for people who find it on GitHub.

At most 2 MB and 200 files, text only: .json .mjs .js .html .css .md .txt .svg .csv. Paths are inside the folder, like pages/main.html; never a dot-file.

## conch-app.json

- conch: 1. id: lowercase letters, numbers and single dashes, 2–24 characters (its tools are named after it). name: sentence case, at most 40 characters.
- tagline: what it does in at most 80 characters; description: at most 600.
- version: major.minor.patch. Raise it when you change an app the person has.
- icon: { glyph, color } — a glyph from Nacre's app glyphs (sparkles, leaf, calendar, wallet, plane, book-open, calculator, …) on one of red, orange, amber, yellow, lime, green, teal, cyan, blue, indigo, violet, pink, slate.
- kind: productivity, developer, files, design, business, home or personal.
- tools: "tools.mjs". pages: [{ id, title, file }].
- reaches: the websites its tools may fetch, exact host names, https only, at most 10. Empty means none. Ask for as few as you can: the card shows each one.
- settings: [{ key, label, help?, link?, secret?, optional? }], at most 8 — what it needs from the person, like an API key. The person types them into the card; you never see them. Put where to get one in link and help.
- instructions: for the assistant, at most 1,500 characters: when to use it and how. examples: up to 6 things a person might say.

## tools.mjs

Export plain tool definitions, with no imports and no dependencies:

    export const tools = { name: { title, description, input, changes, async run(input, app) { … } } }

- name: lowercase letters, numbers and underscores, at most 20 characters.
- description: says what it does and when to use it, so a model picks it at the right moment.
- input: a JSON Schema object for its arguments, with a description on each.
- changes: true when it changes anything (writes data, sends, posts); false when it only looks. Be honest: the person's choices (Ask before changes) rely on it.
- run returns text, or JSON (an object or array). Throw an Error with a sentence that says what went wrong and what to do next ("The city wasn't found. Ask the person for a nearby town."): the model gets the message.

What a tool can reach is only \`app\`:

- app.data.get(key), app.data.set(key, value), app.data.update(key, (old) => next), app.data.delete(key), app.data.keys(): JSON values kept on this computer for this app, written safely, 50 MB in all.
- await app.fetch(url, { method, headers, body }): answers with ok, status, headers and the body as text (JSON.parse it for JSON). Only to hosts in reaches, https, through Conch (1 MB out, 5 MB back, 20 seconds, 600 an hour). Anything else is refused in words.
- app.settings: what the person typed, secrets included. Never return or log a secret.
- app.now(): the time in milliseconds. app.log(...): a line for the app's log.

Tools run sealed off: no files, no programs, no network of their own, no eval. Each call has 30 seconds. A setting that's missing: throw "Add your API key in the app's settings in Apps." rather than failing strangely.

## Pages

A page is HTML that runs in a sealed frame, styled by the Nacre page kit: type, colour, buttons, fields, lists, tables and cards look like Conch in light and dark with no CSS of your own. See the page kit classes: nc-card, nc-row, nc-stack, nc-muted, nc-badge, nc-empty, and primary and danger on buttons.

- await conch.call(tool, input) → { ok: true, text, json } or { ok: false, reason, message }. It reaches only this app's own tools. A change goes when the person pressed something in the page; otherwise Conch asks them. Show message when ok is false.
- No network, no forms, no links that leave, no new windows, no frames. Use buttons with click handlers, never <form>.
- Each page needs lang on <html>, a <title>, a viewport meta tag, and a label for every field. Use the page kit's colours, not your own.

## The quality bar

app_check refuses until the manifest reads, the tools module loads sealed off, and every tool has a title, a description that says when to use it, an input schema and an honest changes; nothing reaches a host outside reaches or imports anything; pages have lang, a title, labels, a viewport, read at phone width and don't navigate; skills pass the skill check; nothing secret is written in; and every tool was tried.

## Make it feel like Conch

- Plain words, sentence case, no jargon. Say what happened and one next step.
- Empty states that say what to do ("No notes yet. Add one above, or ask your assistant.").
- Errors with a next step, from tools and pages alike.
- Light and dark: the page kit does it; don't type colours.
- Phone width first: one column, nothing wider than the screen.
- Accessible: a label for every field, buttons that say what they do, role="status" for messages, focus you can see.

## A small complete app

conch-app.json:

${EXAMPLE_MANIFEST}

tools.mjs:

${EXAMPLE_TOOLS}

pages/main.html:

${EXAMPLE_PAGE}
`;
}
