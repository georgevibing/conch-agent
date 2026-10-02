import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { CodeEditor, type EditorLanguage } from './CodeEditor';

const samples: Record<EditorLanguage, string> = {
  html: `<h1>Tip calculator</h1>
<label>Bill <input id="bill" type="number" value="40"></label>
<p id="out"></p>
<script>
  const bill = document.getElementById('bill');
  bill.oninput = () => (out.textContent = 'Tip: ' + (bill.value * 0.15).toFixed(2));
</script>`,
  markdown: `# Trip plan

- **Day 1**: arrive, walk the old town
- **Day 2**: museum, dinner by the [river](https://example.com)
`,
  json: `{
  "type": "bar",
  "labels": ["Mon", "Tue", "Wed"],
  "series": [{ "name": "Visitors", "values": [120, 180, 150] }]
}`,
  csv: `Item,Cost,Note
Rent,1200,"Paid on the 1st"
Food,400,
Travel,150,"Trains, mostly"`,
  xml: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
  <circle cx="20" cy="20" r="16" fill="currentColor" />
</svg>`,
  mermaid: `flowchart LR
  %% How a question becomes an answer
  A[You ask] --> B{Conch thinks}
  B -->|tools| C[It looks things up]
  B --> D[You see it]`,
  text: 'Just words.',
};

function Editable({ language }: { language: EditorLanguage }) {
  const [value, setValue] = useState(samples[language]);
  return (
    <CodeEditor
      value={value}
      onChange={setValue}
      language={language}
      label={`A ${language} example`}
      style={{ blockSize: 260 }}
    />
  );
}

const meta = {
  title: 'Patterns/Show me/CodeEditor',
  component: CodeEditor,
  parameters: {
    docs: {
      description: {
        component:
          'CodeMirror 6 in Nacre’s colours (ADR 0039), loaded the first time an editor opens. Line numbers, undo and redo, ⌘S and Esc; Tab moves on, so the keyboard is never trapped. If it can’t load, a plain text box takes its place.',
      },
    },
  },
  args: {
    value: samples.json,
    onChange: () => {},
    language: 'json',
    label: 'Code',
  },
} satisfies Meta<typeof CodeEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return <CodeEditor {...args} value={value} onChange={setValue} style={{ blockSize: 320 }} />;
  },
};

export const EveryKind: Story = {
  name: 'Every kind',
  render: () => (
    <div style={{ display: 'grid', gap: 16, maxInlineSize: 640 }}>
      {(['html', 'markdown', 'json', 'csv', 'xml', 'mermaid'] as const).map((language) => (
        <Editable key={language} language={language} />
      ))}
    </div>
  ),
};
