/**
 * The app the mock engine makes when asked (ADR 0061): Tally, a counter
 * with a tool to count, a tool to read the count, and a page with a big
 * number and a button. Small, complete, and written the way the guide says.
 */
export const TALLY_ID = 'tally';

export function tallyFiles(version = '1.0.0'): Record<string, string> {
  return {
    'conch-app.json': `${JSON.stringify(
      {
        conch: 1,
        id: TALLY_ID,
        name: 'Tally',
        tagline: 'Counts things for you, one tap at a time',
        description: 'A counter you can add to from a chat or from its page.',
        version,
        icon: { glyph: 'calculator', color: 'teal' },
        kind: 'personal',
        tools: 'tools.mjs',
        pages: [{ id: 'main', title: 'Tally', file: 'pages/main.html' }],
        reaches: [],
        settings: [],
        pageState: true,
        instructions:
          'Use Tally when the person wants to count something or asks how many. Add with count; read with read_count.',
        examples: ['Count one more coffee', 'How many is the tally at?'],
      },
      null,
      2,
    )}\n`,
    'tools.mjs': `export const tools = {
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
    cache: { maxAge: 30 },
    async run(_input, app) {
      return { total: (await app.data.get('total')) ?? 0 };
    },
  },
};
`,
    'pages/main.html': `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tally</title>
  <style>.big { font-size: 4rem; font-weight: 600; text-align: center; }</style>
</head>
<body>
  <header class="nc-page-head">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 13h3M8 17h3M15 13v4"/>
    </svg>
    <div>
      <h1>Tally</h1>
      <p class="nc-muted">What you’ve counted so far</p>
    </div>
  </header>
  <main class="nc-stack">
    <p class="big" id="total" aria-live="polite">0</p>
    <div class="nc-row">
      <label>Count by
        <select id="by">
          <option value="1">1</option>
          <option value="5">5</option>
          <option value="10">10</option>
        </select>
      </label>
      <button class="primary" id="add" type="button">Count one more</button>
    </div>
    <p class="nc-muted" id="status" role="status"></p>
  </main>
  <script>
    const total = document.getElementById('total');
    const status = document.getElementById('status');
    function show(r) {
      if (r.ok) total.textContent = r.json.total;
      else status.textContent = r.message;
    }
    const view = conch.observe('read_count', {}, { every: 30 }, show);
    const add = document.getElementById('add');
    const by = document.getElementById('by');
    add.addEventListener('click', async () => {
      add.disabled = true;
      let r;
      try { r = await conch.call('count', { by: Number(by.value) || 1 }); }
      finally { add.disabled = false; }
      status.textContent = r.ok ? '' : r.message;
      if (r.ok) view.refresh();
    });

  </script>
</body>
</html>
`,
    'README.md': '# Tally\n\nCounts things for you, one tap at a time. A Conch app.\n',
  };
}
