/**
 * Markdown for WhatsApp and Signal (ADR 0043), built on the same pieces as
 * the other dialects (`format.ts`), and as total: odd Markdown comes out as
 * readable text, never an exception.
 *
 * - WhatsApp writes its styles inline: `*bold*`, `_italic_`, `~strike~`,
 *   `` `code` `` and ``` blocks.
 * - Signal sends plain text with style ranges beside it (`start:length:STYLE`,
 *   counted in UTF-16 units, as signal-cli's `textStyle` takes them).
 */
import { blocks, inline, prose } from './format';

/** WhatsApp's own formatting. Links read as "label (address)": WhatsApp has no link markup. */
export function toWhatsApp(markdown: string): string {
  const style = {
    escape: (s: string) => s,
    code: (s: string) => `\`${s}\``,
    bold: (s: string) => `*${s}*`,
    italic: (s: string) => `_${s}_`,
    strike: (s: string) => `~${s}~`,
    link: (label: string, url: string) => (label === url ? url : `${label} (${url})`),
  };
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `\`\`\`\n${block.text}\n\`\`\``
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => `*${s}*`,
            quote: (lines) => lines.map((l) => `> ${l}`).join('\n'),
            table: (rows) => `\`\`\`\n${rows}\n\`\`\``,
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();
}

export type SignalStyle = 'BOLD' | 'ITALIC' | 'STRIKETHROUGH' | 'MONOSPACE';

// Private-use characters mark where a style opens and closes while the text
// is built; they are taken out again, and never reach Signal.
const MARK: Record<SignalStyle, [string, string]> = {
  BOLD: ['\uE000', '\uE001'],
  ITALIC: ['\uE002', '\uE003'],
  STRIKETHROUGH: ['\uE004', '\uE005'],
  MONOSPACE: ['\uE006', '\uE007'],
};
const OPEN = new Map(Object.entries(MARK).map(([style, [open]]) => [open, style as SignalStyle]));
const CLOSE = new Map(
  Object.entries(MARK).map(([style, [, close]]) => [close, style as SignalStyle]),
);
const wrap = (style: SignalStyle, text: string) => `${MARK[style][0]}${text}${MARK[style][1]}`;

/** Signal: the words, and which of them are styled. */
export function toSignal(markdown: string): { text: string; styles: string[] } {
  // Text that already holds one of the marks loses it, so nothing can forge a style.
  const clean = markdown.replace(/[\uE000-\uE007]/g, '');
  const style = {
    escape: (s: string) => s,
    code: (s: string) => wrap('MONOSPACE', s),
    bold: (s: string) => wrap('BOLD', s),
    italic: (s: string) => wrap('ITALIC', s),
    strike: (s: string) => wrap('STRIKETHROUGH', s),
    link: (label: string, url: string) => (label === url ? url : `${label} (${url})`),
  };
  const marked = blocks(clean)
    .map((block) =>
      block.kind === 'code'
        ? wrap('MONOSPACE', block.text)
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => wrap('BOLD', s),
            quote: (lines) => lines.map((l) => `│ ${l}`).join('\n'),
            table: (rows) => wrap('MONOSPACE', rows),
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();

  let text = '';
  const styles: string[] = [];
  const open: { style: SignalStyle; at: number }[] = [];
  for (const char of marked) {
    const opens = OPEN.get(char);
    if (opens) {
      open.push({ style: opens, at: text.length });
      continue;
    }
    const closes = CLOSE.get(char);
    if (closes) {
      const index = open.findLastIndex((o) => o.style === closes);
      const started = index >= 0 ? open.splice(index, 1)[0] : undefined;
      if (started && text.length > started.at)
        styles.push(`${started.at}:${text.length - started.at}:${closes}`);
      continue;
    }
    text += char;
  }
  return { text, styles };
}
