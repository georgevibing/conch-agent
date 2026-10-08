/**
 * A document as plain blocks: what every maker draws (PDF, Word, slides,
 * HTML, text). Markdown is read once into these, with no raw HTML ever
 * carried through: a tag the model wrote is shown as its text.
 */
import { Lexer, type Token, type Tokens } from 'marked';

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  /** Only http(s) and mailto links are kept. */
  link?: string;
  /** A picture inline: `att_…` (one of the chat's pictures) or a data URI. */
  image?: { src: string; alt: string };
  /** A line break inside the paragraph. */
  br?: boolean;
}

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  runs: Run[];
  checked?: boolean;
  children: Block[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Run[] }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'table'; header: Run[][]; rows: Run[][][]; align: Align[] }
  | { type: 'rule' }
  | { type: 'pagebreak' };

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: '\u00a0',
};

/** marked keeps `&amp;` and friends as written; documents want the characters. */
export function unescape(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()];
    if (known) return known;
    const code = name.startsWith('#x')
      ? Number.parseInt(name.slice(2), 16)
      : name.startsWith('#')
        ? Number(name.slice(1))
        : NaN;
    return Number.isFinite(code) && code > 0 && code < 0x110000
      ? String.fromCodePoint(code)
      : whole;
  });
}

export function safeLink(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const trimmed = href.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed) && trimmed.length <= 2000 ? trimmed : undefined;
}

function inline(tokens: readonly Token[] | undefined, style: Omit<Run, 'text'> = {}): Run[] {
  const out: Run[] = [];
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'strong':
        out.push(...inline((token as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...inline((token as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case 'del':
        out.push(...inline((token as Tokens.Del).tokens, { ...style, strike: true }));
        break;
      case 'codespan':
        out.push({ ...style, code: true, text: unescape((token as Tokens.Codespan).text) });
        break;
      case 'br':
        out.push({ ...style, text: '', br: true });
        break;
      case 'link': {
        const link = token as Tokens.Link;
        const href = safeLink(link.href);
        out.push(...inline(link.tokens, { ...style, ...(href && { link: href }) }));
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        out.push({ ...style, text: '', image: { src: image.href, alt: unescape(image.text) } });
        break;
      }
      case 'text': {
        const text = token as Tokens.Text;
        if (text.tokens?.length) out.push(...inline(text.tokens, style));
        else out.push({ ...style, text: unescape(text.text) });
        break;
      }
      case 'escape':
        out.push({ ...style, text: unescape((token as Tokens.Escape).text) });
        break;
      case 'html':
      case 'tag':
        // Raw HTML is shown as written, never interpreted.
        out.push({ ...style, text: (token as Tokens.HTML).text });
        break;
      default:
        if ('text' in token && typeof token.text === 'string')
          out.push({ ...style, text: unescape(token.text) });
    }
  }
  return out;
}

function blocks(tokens: readonly Token[]): Block[] {
  const out: Block[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading;
        const level = Math.min(6, Math.max(1, heading.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
        out.push({ type: 'heading', level, runs: inline(heading.tokens) });
        break;
      }
      case 'paragraph':
        out.push({ type: 'paragraph', runs: inline((token as Tokens.Paragraph).tokens) });
        break;
      case 'text': {
        // Loose text at block level (inside a list item).
        const text = token as Tokens.Text;
        out.push({
          type: 'paragraph',
          runs: text.tokens?.length ? inline(text.tokens) : [{ text: unescape(text.text) }],
        });
        break;
      }
      case 'list': {
        const list = token as Tokens.List;
        out.push({
          type: 'list',
          ordered: list.ordered,
          start: typeof list.start === 'number' ? list.start : 1,
          items: list.items.map((item) => {
            const inner = blocks(item.tokens.filter((t) => t.type !== 'checkbox'));
            const first = inner[0]?.type === 'paragraph' ? inner.shift() : undefined;
            return {
              runs: first?.type === 'paragraph' ? first.runs : [],
              ...(item.task && { checked: Boolean(item.checked) }),
              children: inner,
            };
          }),
        });
        break;
      }
      case 'code': {
        const code = token as Tokens.Code;
        out.push({ type: 'code', text: code.text, ...(code.lang && { lang: code.lang }) });
        break;
      }
      case 'blockquote':
        out.push({ type: 'quote', blocks: blocks((token as Tokens.Blockquote).tokens) });
        break;
      case 'table': {
        const table = token as Tokens.Table;
        out.push({
          type: 'table',
          header: table.header.map((cell) => inline(cell.tokens)),
          rows: table.rows.map((row) => row.map((cell) => inline(cell.tokens))),
          align: table.align,
        });
        break;
      }
      case 'hr':
        out.push({ type: 'rule' });
        break;
      case 'html': {
        const html = (token as Tokens.HTML).text.trim();
        // The one tag that means something on paper: a page break.
        if (/^<div[^>]*page-break[^>]*>\s*<\/div>$|^<!--\s*pagebreak\s*-->$/i.test(html))
          out.push({ type: 'pagebreak' });
        else if (html) out.push({ type: 'paragraph', runs: [{ text: html }] });
        break;
      }
      case 'space':
      case 'def':
        break;
      default:
        if ('text' in token && typeof token.text === 'string' && token.text.trim())
          out.push({ type: 'paragraph', runs: [{ text: unescape(token.text) }] });
    }
  }
  return out;
}

/** Markdown (GitHub's flavour: tables, task lists, strikethrough) as blocks. */
export function fromMarkdown(markdown: string): Block[] {
  return blocks(new Lexer({ gfm: true }).lex(markdown.replace(/\r\n?/g, '\n')));
}

/** Plain text as blocks: a paragraph per blank-line-separated chunk, line breaks kept. */
export function fromText(text: string): Block[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .filter((chunk) => chunk.trim())
    .map((chunk) => ({
      type: 'paragraph' as const,
      runs: chunk
        .split('\n')
        .flatMap((line, i) => (i ? [{ text: '', br: true }, { text: line }] : [{ text: line }])),
    }));
}

export function runsText(runs: readonly Run[]): string {
  return runs
    .map((r) => (r.br ? '\n' : r.image ? (r.image.alt ? `[${r.image.alt}]` : '') : r.text))
    .join('');
}

/** The first heading's words, for a title nobody gave. */
export function firstHeading(doc: readonly Block[]): string | undefined {
  const heading = doc.find((b) => b.type === 'heading');
  return heading?.type === 'heading' ? runsText(heading.runs).trim() || undefined : undefined;
}

/** Every picture a document asks for, in order. */
export function imagesIn(doc: readonly Block[]): string[] {
  const found: string[] = [];
  const fromRuns = (runs: readonly Run[]) => {
    for (const run of runs) if (run.image) found.push(run.image.src);
  };
  const walk = (list: readonly Block[]) => {
    for (const block of list) {
      if (block.type === 'heading' || block.type === 'paragraph') fromRuns(block.runs);
      else if (block.type === 'quote') walk(block.blocks);
      else if (block.type === 'list')
        for (const item of block.items) {
          fromRuns(item.runs);
          walk(item.children);
        }
      else if (block.type === 'table') {
        block.header.forEach(fromRuns);
        block.rows.forEach((row) => row.forEach(fromRuns));
      }
    }
  };
  walk(doc);
  return found;
}

/** The document as Markdown again (for .md made from blocks, e.g. a converted Word file). */
export function toMarkdown(doc: readonly Block[]): string {
  const md = (runs: readonly Run[]) =>
    runs
      .map((r) => {
        if (r.br) return '  \n';
        if (r.image) return `![${r.image.alt}](${r.image.src})`;
        let text = r.code ? `\`${r.text}\`` : r.text.replace(/([*_`[\]\\])/g, '\\$1');
        if (!text) return '';
        if (r.bold) text = `**${text}**`;
        if (r.italic) text = `*${text}*`;
        if (r.strike) text = `~~${text}~~`;
        if (r.link) text = `[${text}](${r.link})`;
        return text;
      })
      .join('');
  const out: string[] = [];
  const write = (list: readonly Block[], indent = '') => {
    for (const block of list) {
      switch (block.type) {
        case 'heading':
          out.push(`${'#'.repeat(block.level)} ${md(block.runs)}`, '');
          break;
        case 'paragraph':
          out.push(indent + md(block.runs), '');
          break;
        case 'list':
          block.items.forEach((item, i) => {
            const mark = block.ordered ? `${block.start + i}.` : '-';
            const box = item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] ';
            out.push(`${indent}${mark} ${box}${md(item.runs)}`);
            if (item.children.length) write(item.children, `${indent}   `);
          });
          out.push('');
          break;
        case 'code':
          out.push(`\`\`\`${block.lang ?? ''}`, block.text, '```', '');
          break;
        case 'quote': {
          const start = out.length;
          write(block.blocks);
          for (let i = start; i < out.length; i++) out[i] = `> ${out[i]}`.trimEnd();
          out.push('');
          break;
        }
        case 'table': {
          const cell = (runs: Run[]) => md(runs).replaceAll('|', '\\|').replaceAll('\n', ' ');
          out.push(`| ${block.header.map(cell).join(' | ')} |`);
          out.push(
            `| ${block.header.map((_, i) => (block.align[i] === 'center' ? ':---:' : block.align[i] === 'right' ? '---:' : '---')).join(' | ')} |`,
          );
          for (const row of block.rows) out.push(`| ${row.map(cell).join(' | ')} |`);
          out.push('');
          break;
        }
        case 'rule':
          out.push('---', '');
          break;
        case 'pagebreak':
          out.push('<!-- pagebreak -->', '');
          break;
      }
    }
  };
  write(doc);
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}

/** The document as plain text. */
export function toText(doc: readonly Block[]): string {
  const out: string[] = [];
  const write = (list: readonly Block[], indent = '') => {
    for (const block of list) {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          out.push(indent + runsText(block.runs), '');
          break;
        case 'list':
          block.items.forEach((item, i) => {
            out.push(
              `${indent}${block.ordered ? `${block.start + i}.` : '•'} ${runsText(item.runs)}`,
            );
            write(item.children, `${indent}   `);
          });
          out.push('');
          break;
        case 'code':
          out.push(block.text, '');
          break;
        case 'quote':
          write(block.blocks, `${indent}  `);
          break;
        case 'table':
          out.push(block.header.map(runsText).join('\t'));
          for (const row of block.rows) out.push(row.map(runsText).join('\t'));
          out.push('');
          break;
        case 'rule':
        case 'pagebreak':
          out.push('');
          break;
      }
    }
  };
  write(doc);
  return `${out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`;
}
