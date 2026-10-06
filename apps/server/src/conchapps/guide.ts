/**
 * The maker's guide (`app_guide`, ADR 0061 §4): what a Conch app is, how its
 * tools and pages work, the quality bar, and how to make one that feels like
 * Conch — for whichever model is building one. Read before building; the
 * prompt says so. What the code can list (glyphs, colours, the page kit's
 * classes, the limits) is read from the code, never typed here.
 */
import { APP_COLORS, APP_GLYPHS, APP_LIMITS, APP_PICTURES } from '@conch/protocol';

import { PAGE_KIT_CSS } from './pagekit.generated';

/** What each of the page kit's classes is for. `guide.test.ts` holds this to the kit itself. */
export const PAGE_KIT_CLASSES: Record<string, string> = {
  'nc-page-head':
    'the top of the page: its icon, its title (with one quiet line under it) and its buttons, all on one middle',
  'nc-page-icon': 'the class for a page head’s icon when it isn’t an `<svg>` or an `<img>`',
  'nc-card': 'a raised surface for a group of things',
  'nc-stack': 'a column with even gaps',
  'nc-row': 'a row that wraps, centred',
  'nc-grid': 'tiles that fill the width',
  'nc-toolbar': 'a title with its buttons at the end',
  'nc-list': '`<ul class="nc-list">`: rows with dividers',
  'nc-stat': '`<div class="nc-stat"><b>12</b> plants</div>`: a big number and what it counts',
  'nc-badge': 'a small label; add `ok` or `warn` to colour it',
  'nc-muted': 'quieter, smaller words',
  'nc-empty': 'nothing here yet: a sentence, and what to do',
};

/** The page kit's own classes, read from the kit. */
export const pageKitClasses = (): string[] =>
  [...new Set([...PAGE_KIT_CSS.matchAll(/\.(nc-[a-z-]+)/g)].map((m) => m[1] as string))].sort();

/** The maker's tools, in the order they're used: `guide.test.ts` holds this to `tools.ts`. */
export const MAKER_TOOLS = [
  'app_guide',
  'app_new',
  'app_write',
  'app_icon',
  'app_read',
  'app_check',
  'app_try',
  'app_present',
  'app_edit',
  'app_find',
  'app_get',
  'app_share',
] as const;

/** What `app` gives a tool: `guide.test.ts` holds this to the runtime's contract in `host.mjs`. */
export const APP_API = [
  'app.data.get',
  'app.data.set',
  'app.data.update',
  'app.data.delete',
  'app.data.keys',
  'app.fetch',
  'app.settings',
  'app.now',
  'app.log',
] as const;

const mb = (bytes: number) => `${bytes / 1024 / 1024} MB`;
const kb = (bytes: number) => `${bytes / 1024} KB`;
const pictureNames = Object.keys(APP_PICTURES)
  .map((name) => `\`${name}\``)
  .join(', ');

const EXAMPLE_MANIFEST = `{
  "conch": 1,
  "id": "plant-diary",
  "name": "Plant diary",
  "tagline": "Remembers when you water your plants",
  "description": "Logs each watering and says which plants are due, from a chat or from its page.",
  "version": "1.0.0",
  "icon": { "glyph": "sprout", "color": "green" },
  "kind": "home",
  "tools": "tools.mjs",
  "pages": [{ "id": "main", "title": "Plants", "file": "pages/main.html" }],
  "reaches": [],
  "settings": [],
  "instructions": "Use Plant diary when the person says they watered a plant or asks which plants need water. Log with log_watering; answer with due. A plant's name is whatever the person calls it.",
  "examples": ["I watered the fern", "Which plants need water?", "I water the cactus every 14 days"]
}`;

const EXAMPLE_TOOLS = `// Plant diary: what the assistant can do with it. No imports; \`app\` is everything a tool can reach.
const DAY = 24 * 60 * 60 * 1000;
const key = (name) => name.trim().toLowerCase();

export const tools = {
  log_watering: {
    title: 'Log watering',
    description: 'Records that a plant was watered now. Use when the person says they watered a plant.',
    input: {
      type: 'object',
      properties: {
        plant: { type: 'string', minLength: 1, maxLength: 60, description: 'The plant, as the person calls it' },
        every: { type: 'integer', minimum: 1, maximum: 60, description: 'How many days between waterings, when they say' },
      },
      required: ['plant'],
    },
    changes: true,
    async run({ plant, every }, app) {
      const name = plant.trim();
      const plants = await app.data.update('plants', (all) => ({
        ...all,
        [key(name)]: { name, every: every ?? all?.[key(name)]?.every ?? 7, last: app.now() },
      }));
      const p = plants[key(name)];
      return \`Logged: \${p.name} watered. Next in \${p.every} days.\`;
    },
  },
  due: {
    title: 'Plants due',
    description: 'Lists the plants due for water, most overdue first. Use when the person asks what needs watering.',
    input: { type: 'object', properties: {} },
    async run(_input, app) {
      const plants = Object.values((await app.data.get('plants')) ?? {});
      if (!plants.length) return { due: [], total: 0, text: 'No plants yet. Say “I watered the fern” to start.' };
      const now = Date.parse(app.now());
      const due = plants
        .map((p) => ({ name: p.name, overdue: Math.floor((now - Date.parse(p.last)) / DAY) - p.every }))
        .filter((p) => p.overdue >= 0)
        .sort((a, b) => b.overdue - a.overdue);
      return { due, total: plants.length };
    },
  },
};
`;

const EXAMPLE_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Plants</title>
</head>
<body>
  <header class="nc-page-head">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M12 21v-7M12 14c0-4 3-7 7-7 0 4-3 7-7 7ZM12 14c0-4-3-7-7-7 0 4 3 7 7 7Z"/>
    </svg>
    <div>
      <h1>Plants</h1>
      <p class="nc-muted">Who needs water, and when you last watered</p>
    </div>
    <button class="quiet" id="refresh" type="button">Refresh</button>
  </header>
  <main class="nc-stack">
    <div class="nc-stat"><b id="count">–</b> due for water</div>
    <section class="nc-card nc-stack" aria-labelledby="log-title">
      <h2 id="log-title">Watered one?</h2>
      <div class="nc-row">
        <label>Plant <input id="plant" autocomplete="off"></label>
        <label>Every
          <select id="every">
            <option value="3">3 days</option>
            <option value="7" selected>7 days</option>
            <option value="14">14 days</option>
          </select>
        </label>
        <button class="primary" id="log" type="button">Log watering</button>
      </div>
    </section>
    <ul class="nc-list" id="due" aria-label="Due for water"></ul>
    <p class="nc-empty" id="empty" hidden>Nothing needs water. Log a watering above, or tell your assistant.</p>
    <p class="nc-muted" id="status" role="status"></p>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    async function show() {
      const r = await conch.call('due', {});
      if (!r.ok) return ($('status').textContent = r.message);
      const due = (r.json && r.json.due) || [];
      $('count').textContent = due.length;
      $('due').replaceChildren(...due.map((p) => {
        const li = document.createElement('li');
        li.textContent = p.overdue ? p.name + ' · ' + p.overdue + ' days late' : p.name + ' · today';
        return li;
      }));
      $('empty').hidden = due.length > 0;
    }
    $('refresh').addEventListener('click', show);
    $('log').addEventListener('click', async () => {
      const plant = $('plant').value.trim();
      if (!plant) return ($('status').textContent = 'Type the plant’s name first.');
      $('log').disabled = true;
      const r = await conch.call('log_watering', { plant, every: Number($('every').value) });
      $('log').disabled = false;
      $('status').textContent = r.ok ? r.text : r.message;
      if (r.ok) $('plant').value = '';
      await show();
    });
    show();
  </script>
</body>
</html>
`;

export function makerGuide(): string {
  const kit = pageKitClasses()
    .map((name) => `- \`.${name}\`: ${PAGE_KIT_CLASSES[name] ?? ''}`)
    .join('\n');
  return `# Making a Conch app

A Conch app gives the assistant a new ability that every model can use, and often a page of its own. You build it in this chat with the app_* tools; the person adds it by pressing the card you present. Nothing you do installs anything, and nothing is added until they press.

## The steps

1. **app_new** with a name and a tagline. You get a draft that already passes: a manifest, a tools module and a page. Change it rather than starting blank.
2. **app_write** whole files (app_read to look). Build what the person asked for, done well, and nothing they didn't ask for.
3. **app_check**: the quality bar. Fix every problem it lists, and the warnings too.
4. **app_try** every tool at least once, with realistic input, and once with input that should fail (an unknown name, an empty field) to see that its error reads well. Tries run on the draft's own scratch data, never the person's.
5. **app_check** again after any change, then **app_present** with one sentence on what you made.
6. Tell the person, in a sentence, what it does and that the card under your reply adds it. Never say it's added until the card says so.

Build first. Ask only what you can't sensibly assume (a key only they have, a choice that changes everything), and say what you assumed. To change an app the person has, start with **app_edit**, raise its version, and keep the data it already holds readable. **app_find** looks for an app that already does it, among theirs and the community's; **app_get** shows one from a link as a card; **app_share** shows the buttons to publish one they made. Publishing and adding are always their press.

## The folder

- \`conch-app.json\`: what it is (required).
- \`tools.mjs\`: what the assistant can do with it.
- \`pages/<name>.html\`: up to 4 pages of its own.
- \`skills/<name>/SKILL.md\`: longer know-how, with front matter \`name\` (the folder's name) and \`description\` ("Does X. Use when Y.").
- \`README.md\`: for people who find it on GitHub.
- ${pictureNames}: its picture, when it has one (see **Its icon**). Only **app_icon** writes it.

At most ${mb(APP_LIMITS.bytes)} and ${APP_LIMITS.files} files, text only (${APP_LIMITS.extensions.join(' ')}) but for that one picture. Paths stay inside the folder (\`pages/main.html\`), never a dot-file.

## conch-app.json

- \`conch\`: 1. \`id\`: lowercase letters, numbers and single dashes, 2–24 characters; its tools are named after it. \`name\`: sentence case, at most 40 characters.
- \`tagline\`: what it does for the person, at most 80 characters ("Remembers when you water your plants", not "A plant app"). \`description\`: at most 600.
- \`version\`: major.minor.patch. Raise it with every change to an app the person has.
- \`icon\`: \`{ "glyph", "color" }\`. Glyphs: ${APP_GLYPHS.join(', ')}. Colours: ${APP_COLORS.join(', ')}. Pick the glyph a person would recognise at a glance. Always set it, even when the app has a picture: it's what shows where the picture can't.
- \`kind\`: productivity, developer, files, design, business, home or personal.
- \`tools\`: "tools.mjs". \`pages\`: \`[{ "id", "title", "file" }]\`.
- \`reaches\`: the websites its tools fetch from, exact host names, https only, at most 10. Empty means none. Ask for as few as you can: the card shows every one to the person. Prefer services that need no key.
- \`settings\`: \`[{ "key", "label", "help", "link", "secret", "optional" }]\`, at most 8: what only the person has, like an API key or their city. They type it into the card; you never see it. Put where to get it in \`link\` (an https page) and one sentence in \`help\`.
- \`instructions\`: for the assistant, at most 1,500 characters: when to use it, which tool for what, and what words mean. \`examples\`: up to 6 things a person would really say.

## Its icon

The glyph on its colour is the icon, unless the app has a picture: a logo or a photo, drawn in the same rounded tile everywhere the app shows. Give it one when the person asks for a logo or a picture, or when the app is about one brand or service and its own mark says it best.

- **app_icon** with \`url\`: the https address of the picture itself, never a page. For a service's logo, try its \`https://<its site>/apple-touch-icon.png\` first (most sites keep a 180 × 180 one there); otherwise open the site in the browser, find the logo's own picture and pass its address. If one is refused, app_icon says why: try the next.
- **app_icon** with \`file\`: a picture in the work folder, or one the person attached in this chat. With \`base64\`: the bytes themselves. With \`remove: true\`: back to the glyph.
- PNG, JPEG or WebP, read from its bytes: at most ${kb(APP_LIMITS.picture.bytes)}, from ${APP_LIMITS.picture.minSide} to ${APP_LIMITS.picture.maxSide} pixels a side, still (not animated). Square and about 256 × 256 looks best. SVG is never drawn: find a PNG of it instead (Wikimedia gives one at any width, like \`…/256px-Logo.svg.png\`).
- It's kept as ${pictureNames} by its kind; conch-app.json doesn't name it, and the glyph stays. Changing only the picture keeps the tools you tried: app_check, then app_present.
- Use a logo only for the service the app is for, as that service shows it.

## tools.mjs

Export plain tool definitions, with no imports and no dependencies (other files of the app may be imported as \`./lib.mjs\`):

    export const tools = { name: { title, description, input, changes, async run(input, app) { … } } }

- **name**: lowercase letters, numbers and underscores, at most 20 characters. A verb: \`log_watering\`, \`due\`, \`find_trains\`.
- **title**: a few words for people. **description**: what it does, then "Use when …", so a model picks it at the right moment.
- **input**: a JSON Schema object, a \`description\` on every property, \`required\`, and bounds (\`minLength\`, \`maximum\`, \`enum\`). Conch checks what the model sends against it before \`run\` sees it.
- **changes**: \`true\` when it keeps durable app records, sends or deletes anything; leave it out when it only looks. Be honest: the person's choices (Ask before changes) rely on it.
- **run** returns text, or JSON (an object or array; the model gets it as pretty JSON, a page gets it as \`json\`), or nothing ("Done."). Throw an Error whose message says what went wrong and what to do next: "The city wasn't found. Ask the person for a nearby town." The model reads it.
- Few tools that each do one clear thing beat many. Make changing tools safe to repeat where you can.

What a tool can reach is only \`app\`:

- \`app.data.get(key)\`, \`app.data.set(key, value)\`, \`app.data.update(key, (now) => next)\` (returns the new value; the safe way to change something), \`app.data.delete(key)\`, \`app.data.keys()\`: JSON kept on this computer for this app, written atomically, ${mb(APP_LIMITS.data)} in all. Keys are 1–64 letters, numbers, \`_\` or \`-\`. Keep a \`v\` in what you store when its shape may change, and read old shapes after an update.
- \`await app.fetch(url, { method, headers, body })\`: answers like \`fetch\`, with \`ok\`, \`status\`, \`headers.get(name)\`, \`text()\`, \`json()\` and \`arrayBuffer()\`. Only hosts in \`reaches\`, over https, made by Conch for the app: ${mb(APP_LIMITS.fetchOut)} out, ${mb(APP_LIMITS.fetchBack)} back, ${APP_LIMITS.fetchMs / 1000} seconds, ${APP_LIMITS.fetchPerHour} an hour. A refusal throws an Error that says why. Check \`ok\`, and turn a service's error into a sentence. Keep what you fetched in \`app.data\` when it doesn't change often.
- \`app.settings\`: what the person typed, secrets included. Never return, log or send a secret anywhere but the service it's for. When one is missing, throw "Add your API key in Plant diary's settings in Apps." rather than failing strangely.
- \`app.now()\`: the time now, as an ISO string. Format dates for people with \`Intl.DateTimeFormat\`.
- \`app.log(...)\`: a line in the app's log, for working out what went wrong.

Tools run sealed off: no files of the person's, no programs, no network of their own, no \`eval\`, and built-in objects are frozen. A call has ${APP_LIMITS.callMs / 1000} seconds.

## Pages

A page is HTML that runs in a sealed frame, already drawn by the Nacre page kit: type, colour, links, buttons, every kind of field, tables, lists, code, details, progress — all of it looks like Conch in the person's light or dark and accent, **with no CSS of your own**. Write plain, semantic HTML; the kit does the rest. Pages people like all have the same shape, and it's the shape below. Follow it, and the app looks like Conch made it.

### The shape of a page

1. **Its head**: \`<header class="nc-page-head">\` — an \`<svg>\` icon, then a \`<div>\` with an \`<h1>\` and one quiet line (\`<p class="nc-muted">\`), then the one main button. The kit lines the icon up with the title, on phones too. Never lay a head out by hand.
2. **The number that matters**, right under it: \`.nc-stat\` tiles in a \`.nc-grid\`.
3. **What there is**: a \`.nc-list\` of rows, or a \`<table>\`, inside a \`.nc-card\`. Nothing yet? \`.nc-empty\` with a sentence and what to do.
4. **The thing to do**: a \`.nc-card\` with a \`.nc-stack\`, its fields in a \`.nc-row\`, and one \`<button class="primary">\`.
5. **What just happened**: one \`<p class="nc-muted" role="status">\`, at the end.

Sections live in one \`<main class="nc-stack">\`: one column, top to bottom, at any width.

### What the kit gives you

${kit}
- buttons: \`<button class="primary">\` for the one main action, \`class="danger"\` to delete, \`class="quiet"\` for the rest.
- fields: write the plain element and the kit draws it — \`<input>\` (text, number, date, time, search, email), \`<textarea>\`, \`<select>\`, \`<input type="checkbox">\`, \`type="radio"\`, \`type="range"\`, \`type="color"\`, \`type="file"\`, \`<progress>\`, \`<meter>\`, \`<fieldset>\`. A select's chevron, a file's button, a colour's swatch, a slider's track: Conch draws each one. Label every field: \`<label>Minutes <input type="number"></label>\` stacks the words above it; \`<label><input type="checkbox"> Done</label>\` sits them side by side.
- spacing: the gaps come from \`.nc-stack\`, \`.nc-row\` and \`.nc-grid\`, and headings and paragraphs bring their own. Don't write margins or padding of your own.
- colours, when you truly need one: \`var(--nc-text)\`, \`--nc-text-muted\`, \`--nc-text-accent\`, \`--nc-surface\`, \`--nc-canvas\`, \`--nc-border\`, \`--nc-accent-9\`. Never type a colour.

### Don't, and do instead

| Don't | Do |
| --- | --- |
| \`<div class="dropdown" onclick="…">\` or \`role="listbox"\` | \`<select>\`: the kit draws it, and the keyboard, a screen reader and a phone's wheel come free |
| \`<style>select{appearance:none;background:#222}\` | nothing: the kit already took the system's look off and drew Conch's |
| \`<style>button{border-radius:6px;padding:8px}\` | nothing; \`class="primary"\`, \`"danger"\` or \`"quiet"\` when it's not the plain one |
| \`<div style="display:flex;gap:12px">\` | \`<div class="nc-row">\` (or \`.nc-stack\`, \`.nc-grid\`) |
| \`<img src="…" width="700">\` or \`width: 700px\` | nothing fixed: a width in % or nothing at all, so it fits a phone |
| \`<h1><svg width="48" height="48">…</svg> Fitness diary</h1>\` | \`<header class="nc-page-head">\` with the icon beside the title |
| \`<span class="pill" style="background:#e5ffe5">Done</span>\` | \`<span class="nc-badge ok">Done</span>\` |
| \`<p>No workouts.</p>\` | \`<div class="nc-empty"><strong>Nothing logged yet</strong><p>Log a workout above, or tell your assistant.</p></div>\` |
| \`<form>\` with a submit | a \`<button type="button">\` with a click handler: a sealed page has nowhere to send a form |

### Calling your tools

\`await conch.call(tool, input)\` → \`{ ok: true, text, json }\` or \`{ ok: false, reason, message }\`. It reaches only this app's own tools. A change goes through when the person pressed something in the page; otherwise Conch asks them first. Show \`message\` when \`ok\` is false.

- No network, no forms (buttons with click handlers instead), no links that leave the page, no new windows, no frames, no outside fonts, pictures or scripts.
- Each page has \`lang\`, a \`<title>\`, a viewport meta tag, and a label for every field.
- Show something useful at once: the number that matters at the top, then the list, then the action. While a call is out, disable its button; after it, say what happened in a \`role="status"\` line and show the new state.

## Pages that remember and refresh

- Declare \`pageState: true\` in the manifest for small local page preferences. Use \`await conch.state.get(key)\`, \`set(key, value)\` or \`delete(key)\`. Each preference is at most 64 KB; preferences and saved queries share 2 MB. No secrets. Settings changes clear page data.
- A read tool may declare \`cache: { maxAge: 60 }\` (seconds, 15–86400). It must not change anything or write \`app.data\`; Conch saves its successful result. \`conch.query(tool, input, { mode: 'read' })\` returns the usual result with \`at\` (milliseconds) and \`stale\`. Modes: read, peek (saved only), refresh.
- Prefer \`conch.observe(tool, input, { every: 60 }, render)\`: it shows saved data, refreshes stale results, pauses when hidden, wakes on return, and updates when a changing tool runs through chat or the page. It returns \`refresh()\` and \`stop()\`. Results include \`refreshing\`; a failed refresh keeps data and adds \`error\`. Stop the old observer when inputs change. Use explicit dates and handle the local calendar day changing.
- Load useful data automatically. Show freshness, keep values while updating, and give a manual refresh button. Disable action buttons during calls. Durable records and external edits still use honest \`changes: true\` tools.

## Scratch service fixtures

Write \`fixtures.json\`: \`{ "fixtures": { "today": { "settings": { "api_key": "pretend" }, "responses": [{ "url": "https://api.example.com/day", "method": "GET", "status": 200, "json": { "energy": 357 } }] } } }\` (use a host already in reaches). Call \`app_try\` with \`fixture: "today"\`. The runtime uses fresh scratch data, only fake settings, and exact responses, with no network. An unmatched URL, method or optional body fails. Test successes, service errors and invalid input. Setup-required answers do not count as successful tries. Never put real credentials in fixtures.

## The quality bar

app_check refuses until: the manifest reads; the tools module loads sealed off, and every tool has a title, a description that says when to use it, an input schema and an honest \`changes\`; nothing reaches a host outside \`reaches\` or imports anything; pages don't fetch anything or navigate; skills pass the skill check; nothing secret is written in; and every tool was tried. It warns about descriptions without "Use when", missing examples or instructions, pages without \`lang\`, a title, a viewport or labels, typed colours, fixed widths, controls built out of divs, and a page styling a button, a field or a select the kit already draws. Fix the warnings too: they're what makes a page look like Conch rather than like a web page from 2009.

## Make it feel like Conch

- **For this person.** Use their words for things, their units, their language. A good default beats a question.
- **Plain words.** Sentence case, no jargon, no exclamation marks. Say what happened, then one next step.
- **Never a blank.** Empty states say what to do ("Nothing needs water. Log a watering above, or tell your assistant."). Errors say what went wrong and what to try.
- **Light and dark** come from the page kit. **Phone width first**: one column, nothing wider than the screen.
- **Accessible**: a label for every field, buttons that say what they do, \`role="status"\` for messages, headings in order, focus you can see.
- **Calm.** No animation for its own sake, nothing that moves under the pointer, nothing that asks twice.

## A small, complete app

conch-app.json:

${EXAMPLE_MANIFEST}

tools.mjs:

${EXAMPLE_TOOLS}
pages/main.html:

${EXAMPLE_PAGE}`;
}

/** The guide's example app, as files: `guide.test.ts` proves it passes the quality bar. */
export const guideExample = (): Record<string, string> => ({
  'conch-app.json': EXAMPLE_MANIFEST,
  'tools.mjs': EXAMPLE_TOOLS,
  'pages/main.html': EXAMPLE_PAGE,
});
