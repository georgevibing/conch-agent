import type { Meta, StoryObj } from '@storybook/react-vite';

import tokens from '../styles/tokens.css?raw';
import { accents, type AccentName } from '../theme';
import kit from './pagekit.css?raw';

/**
 * A page as an assistant would write it for a plant diary: plain HTML, a
 * handful of the kit's classes, not one line of CSS of its own. (No form:
 * a sealed page has nowhere to send one.)
 */
const PLANT_DIARY = `
<header class="nc-page-head">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M12 21v-7M12 14c0-4 3-7 7-7 0 4-3 7-7 7ZM12 14c0-4-3-7-7-7 0 4 3 7 7 7Z"/>
  </svg>
  <div>
    <h1>My plants</h1>
    <p class="nc-muted">Who needs water, and when you last watered</p>
  </div>
  <button class="quiet">Refresh</button>
  <button class="primary">Log watering</button>
</header>

<div class="nc-grid">
  <div class="nc-card nc-stat"><b>12</b> plants</div>
  <div class="nc-card nc-stat"><b>3</b> need water today</div>
  <div class="nc-card nc-stat"><b>4 days</b> since it rained</div>
</div>

<h2>Thirsty first</h2>
<div class="nc-card">
  <ul class="nc-list">
    <li><span><strong>Fern</strong><br><span class="nc-muted">Living room · every 3 days</span></span><span class="nc-badge warn">Due today</span></li>
    <li><span><strong>Monstera</strong><br><span class="nc-muted">Hallway · every 7 days</span></span><span class="nc-badge warn">Due today</span></li>
    <li><span><strong>Orchid</strong><br><span class="nc-muted">Kitchen window · every 10 days</span></span><span class="nc-badge">In 2 days</span></li>
    <li><span><strong>Cactus</strong><br><span class="nc-muted">Desk · every 3 weeks</span></span><span class="nc-badge ok">Watered Sunday</span></li>
  </ul>
</div>

<h2>Log a watering</h2>
<div class="nc-card">
  <div class="nc-row">
    <label>Plant
      <select><option>Fern</option><option>Monstera</option><option>Orchid</option><option>Cactus</option></select>
    </label>
    <label>When <input type="text" value="Today, 9:10"></label>
  </div>
  <label>Note <textarea placeholder="Repotted, fed, moved to the window…"></textarea></label>
  <div class="nc-row">
    <label>How much water <input type="range" min="1" max="10" value="7"></label>
    <label>Its label’s colour <input type="color" value="#4f8a3d"></label>
    <label>A photo <input type="file"></label>
  </div>
  <label><input type="checkbox" checked> Fed it too</label>
  <div class="nc-row" style="margin-top: 12px">
    <button class="primary">Log it</button>
    <button class="quiet">Cancel</button>
  </div>
</div>

<h2>This week</h2>
<table>
  <thead><tr><th>Plant</th><th>Watered</th><th>Note</th></tr></thead>
  <tbody>
    <tr><td>Orchid</td><td>Mon 1 Oct</td><td>Bark mix, a little</td></tr>
    <tr><td>Fern</td><td>Sat 29 Sep</td><td>—</td></tr>
    <tr><td>Cactus</td><td>Sun 23 Sep</td><td>First time in a month</td></tr>
  </tbody>
</table>

<div class="nc-row">
  <label>Rain barrel <progress value="0.62">62%</progress></label>
  <label>Watered this week <meter min="0" max="7" value="4">4 of 7</meter></label>
</div>

<h2>Cuttings</h2>
<div class="nc-empty">
  <strong>No cuttings yet</strong>
  <p>Tell your assistant “I took a cutting from the pothos”, and they show up here.</p>
  <button>Add a cutting</button>
</div>

<details>
  <summary>How it decides what’s thirsty</summary>
  <p>Each plant has its own rhythm. Rain in the last two days counts as a watering for the plants outside; <code>api.open-meteo.com</code> says when it rained.</p>
</details>
`;

function page(mode: 'light' | 'dark', accent: AccentName) {
  const { hue, chroma } = accents[accent] ?? accents.coral;
  // What the gateway does for a real page: the kit, then the person's theme and accent.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>My plants</title>
<style>${tokens}\n${kit}</style>
<style>:root{color-scheme:${mode};--nc-accent-h:${hue};--nc-accent-c:${chroma}}</style>
</head><body>${PLANT_DIARY}</body></html>`;
}

interface Args {
  width: number;
  height: number;
}

const meta = {
  title: 'Foundations/Page kit',
  args: { width: 720, height: 1560 },
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The page kit (ADR 0061): Nacre’s tokens and a classless base, given to every page a Conch app ships, so plain HTML an assistant writes looks like Conch — type, buttons, every kind of field, lists, tables, cards, empty states — in the person’s light or dark and accent, with no CSS of its own. Conch draws what the system usually does: a select’s chevron (with room beside it), the button inside a file field, a colour’s swatch, a meter’s bar. A handful of classes (`nc-page-head` for the icon, title and buttons at the top; `nc-card`, `nc-stack`, `nc-row`, `nc-grid`, `nc-toolbar`, `nc-list`, `nc-stat`, `nc-badge`, `nc-muted`, `nc-empty`; `primary`, `danger`, `quiet` on buttons) cover the rest. It sits in a layer, so a page’s own styles always win. This sample is a plant diary’s page, in a sealed frame as Conch shows it.',
      },
    },
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

const frameStyle = (width: number, height: number) => ({
  inlineSize: width,
  maxInlineSize: '100%',
  blockSize: height,
  border: 0,
  borderRadius: 14,
  boxShadow: '0 0 0 1px var(--nc-border-subtle), var(--nc-elevation-2)',
  display: 'block',
});

/** Follows the toolbar's mode and accent. */
export const PlantDiary: Story = {
  render: ({ width, height }, { globals }) => {
    const mode = globals.mode === 'dark' ? 'dark' : 'light';
    const accent = (globals.accent as AccentName | undefined) ?? 'coral';
    return (
      <iframe
        title="My plants"
        sandbox=""
        srcDoc={page(mode, accent)}
        style={frameStyle(width, height)}
      />
    );
  },
};

/** At phone width. */
export const Phone: Story = {
  args: { width: 390, height: 1980 },
  render: PlantDiary.render,
};

/** Light and dark, side by side, in another accent. */
export const LightAndDark: Story = {
  args: { width: 520, height: 1680 },
  render: ({ width, height }) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
      <iframe
        title="My plants, light"
        sandbox=""
        srcDoc={page('light', 'kelp')}
        style={frameStyle(width, height)}
      />
      <iframe
        title="My plants, dark"
        sandbox=""
        srcDoc={page('dark', 'kelp')}
        style={frameStyle(width, height)}
      />
    </div>
  ),
};
