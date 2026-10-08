/* Story/test fixtures — not exported from the package. The screen is drawn as SVG: nothing is fetched. */

const text = (x: number, y: number, size: number, value: string, fill = '#2b2420', weight = 400) =>
  `<text x="${x}" y="${y}" font-family="system-ui, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}">${value}</text>`;

/** A Mac's screen: Notes with a list in it, and 1Password beside it, covered over. */
export const notesScreen = (() => {
  const body = [
    '<rect width="1280" height="800" fill="#c9b8d8"/>',
    '<rect width="1280" height="26" fill="#f4f0ec"/>',
    text(20, 18, 13, ' Notes   File   Edit   Format   View   Window', '#2b2420', 500),
    '<rect x="40" y="60" width="820" height="680" rx="12" fill="#ffffff"/>',
    '<rect x="40" y="60" width="240" height="680" rx="12" fill="#f6f2ee"/>',
    text(64, 110, 15, 'Shopping', '#2b2420', 600),
    text(64, 140, 15, 'Trip to Lisbon', '#6f6660'),
    text(64, 170, 15, 'Book club', '#6f6660'),
    text(320, 120, 28, 'Shopping', '#2b2420', 700),
    ...['Oat milk', 'Lemons', 'Coffee beans', 'Basil'].map((item, i) =>
      [
        `<circle cx="332" cy="${172 + i * 40}" r="8" fill="none" stroke="#c7bdb5" stroke-width="2"/>`,
        text(352, 178 + i * 40, 18, item, '#2b2420'),
      ].join(''),
    ),
    '<rect x="890" y="60" width="350" height="420" rx="12" fill="#29262b"/>',
  ].join('');
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
})();
