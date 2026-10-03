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
</html>
`,
    'README.md': '# Tally\n\nCounts things for you, one tap at a time. A Conch app.\n',
  };
}
