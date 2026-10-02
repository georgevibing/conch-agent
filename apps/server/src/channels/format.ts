/**
 * The assistant writes Markdown; each chat app reads its own dialect. These
 * turn one into the other, and cut long answers where a person would.
 *
 * Every function here is total: odd Markdown comes out as readable text, never
 * an exception. When an app still refuses what we made (Telegram is strict
 * about HTML), the sender falls back to `plain()`.
 */

/** A piece of an answer: prose, or a fenced code block. */
export type Block = { kind: 'text'; text: string } | { kind: 'code'; lang: string; text: string };

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;

/** Split Markdown into prose and fenced code, keeping an unclosed fence as code. */
export function blocks(markdown: string): Block[] {
  const out: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  let prose: string[] = [];
  let code: { fence: string; lang: string; lines: string[] } | undefined;
  const flush = () => {
    if (prose.length) out.push({ kind: 'text', text: prose.join('\n') });
    prose = [];
  };
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (code) {
      if (fence && fence[1]?.startsWith(code.fence[0] ?? '`') && !fence[2]) {
        out.push({ kind: 'code', lang: code.lang, text: code.lines.join('\n') });
        code = undefined;
      } else code.lines.push(line);
    } else if (fence) {
      flush();
      code = { fence: fence[1] ?? '```', lang: fence[2] ?? '', lines: [] };
    } else prose.push(line);
  }
  if (code) out.push({ kind: 'code', lang: code.lang, text: code.lines.join('\n') });
  flush();
  return out;
}

const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Inline Markdown → markup, with code spans kept verbatim. `wrap` says how
 * each style is written in the target dialect; `escape` makes plain text safe.
 */
export function inline(
  text: string,
  style: {
    escape: (s: string) => string;
    code: (s: string) => string;
    bold: (s: string) => string;
    italic: (s: string) => string;
    strike: (s: string) => string;
    link: (label: string, url: string) => string;
  },
): string {
  const kept: string[] = [];
  const keep = (s: string) => `\u0000${kept.push(s) - 1}\u0000`;
  let out = text.replace(/`([^`\n]+)`/g, (_, code: string) => keep(style.code(code)));
  // Links before escaping, so the address stays whole; the label is escaped on its own.
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label: string, url: string) =>
    keep(style.link(label, url)),
  );
  out = style.escape(out);
  // Italic first: its pattern can't match `**`, and Slack writes bold with one `*`.
  out = out
    .replace(
      /(^|[^\w*])\*(?=\S)([^*\n]+?)(?<=\S)\*(?![\w*])/g,
      (_, pre: string, s: string) => `${pre}${style.italic(s)}`,
    )
    .replace(
      /(^|[^\w_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\w_])/g,
      (_, pre: string, s: string) => `${pre}${style.italic(s)}`,
    )
    .replace(/\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*/g, (_, s: string) => style.bold(s))
    .replace(/__(?=\S)([^_\n]+?)(?<=\S)__/g, (_, s: string) => style.bold(s))
    .replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/g, (_, s: string) => style.strike(s));
  // eslint-disable-next-line no-control-regex -- the placeholders are NULs on purpose
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => kept[Number(i)] ?? '');
}

/** Prose line by line: headings, quotes, lists and tables in the target's terms. */
export function prose(
  text: string,
  render: {
    line: (s: string) => string;
    heading: (s: string) => string;
    quote: (lines: string[]) => string;
    table: (rows: string) => string;
    bullet: string;
  },
): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // A table reads best as monospace text, whatever the app.
    if (TABLE_ROW.test(line) && TABLE_RULE.test(lines[i + 1] ?? '')) {
      const rows: string[] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? '')) {
        const row = lines[i] ?? '';
        if (!TABLE_RULE.test(row)) rows.push(row);
        i++;
      }
      i--;
      out.push(render.table(alignTable(rows)));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? '')) {
        quoted.push(render.line((lines[i] ?? '').replace(/^\s*>\s?/, '')));
        i++;
      }
      i--;
      out.push(render.quote(quoted));
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push(render.heading(render.line(heading[1] ?? '')));
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('———');
      continue;
    }
    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = Math.floor((bullet[1]?.length ?? 0) / 2);
      out.push(`${'  '.repeat(depth)}${render.bullet} ${render.line(bullet[2] ?? '')}`);
      continue;
    }
    out.push(render.line(line));
  }
  return out.join('\n');
}

/** Pads a Markdown table's cells so its columns line up in monospace. */
function alignTable(rows: string[]): string {
  const cells = rows.map((row) =>
    row
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim()),
  );
  const widths: number[] = [];
  for (const row of cells)
    row.forEach((c, i) => (widths[i] = Math.max(widths[i] ?? 0, [...c].length)));
  return cells
    .map((row) =>
      row
        .map((c, i) => c.padEnd(widths[i] ?? 0))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

/** Telegram's HTML (the parse mode with the fewest escaping traps). */
export function toTelegramHtml(markdown: string): string {
  const style = {
    escape: escapeHtml,
    code: (s: string) => `<code>${escapeHtml(s)}</code>`,
    bold: (s: string) => `<b>${s}</b>`,
    italic: (s: string) => `<i>${s}</i>`,
    strike: (s: string) => `<s>${s}</s>`,
    link: (label: string, url: string) =>
      `<a href="${escapeHtml(url).replaceAll('"', '&quot;')}">${escapeHtml(label)}</a>`,
  };
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `<pre>${block.lang ? `<code class="language-${escapeHtml(block.lang)}">` : '<code>'}${escapeHtml(block.text)}</code></pre>`
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => `<b>${s}</b>`,
            quote: (lines) => `<blockquote>${lines.join('\n')}</blockquote>`,
            table: (rows) => `<pre>${escapeHtml(rows)}</pre>`,
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();
}

/**
 * HTML for apps that read it (Matrix's `formatted_body`, Teams messages):
 * the tags both render, with line breaks kept, since HTML would fold them.
 */
export function toChatHtml(markdown: string): string {
  const style = {
    escape: escapeHtml,
    code: (s: string) => `<code>${escapeHtml(s)}</code>`,
    bold: (s: string) => `<strong>${s}</strong>`,
    italic: (s: string) => `<em>${s}</em>`,
    strike: (s: string) => `<del>${s}</del>`,
    link: (label: string, url: string) =>
      `<a href="${escapeHtml(url).replaceAll('"', '&quot;')}">${escapeHtml(label)}</a>`,
  };
  const breaks = (html: string) =>
    html
      .split(/(<pre>[\s\S]*?<\/pre>)/)
      .map((part, i) => (i % 2 ? part : part.replaceAll('\n', '<br>')))
      .join('');
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `<pre><code${block.lang ? ` class="language-${escapeHtml(block.lang)}"` : ''}>${escapeHtml(block.text)}</code></pre>`
        : breaks(
            prose(block.text.replace(/^\n+|\n+$/g, ''), {
              line: (s) => inline(s, style),
              heading: (s) => `<strong>${s}</strong>`,
              quote: (lines) => `<blockquote>${lines.join('\n')}</blockquote>`,
              table: (rows) => `<pre>${escapeHtml(rows)}</pre>`,
              bullet: '•',
            }),
          ),
    )
    .filter(Boolean)
    .join('<br>')
    .trim();
}

/** Slack's mrkdwn. */
export function toSlackMrkdwn(markdown: string): string {
  const escape = (s: string) => escapeHtml(s);
  const style = {
    escape,
    code: (s: string) => `\`${escape(s)}\``,
    bold: (s: string) => `*${s}*`,
    italic: (s: string) => `_${s}_`,
    strike: (s: string) => `~${s}~`,
    link: (label: string, url: string) => `<${url.replaceAll('|', '%7C')}|${escape(label)}>`,
  };
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `\`\`\`\n${escape(block.text)}\n\`\`\``
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => `*${s}*`,
            quote: (lines) => lines.map((l) => `> ${l}`).join('\n'),
            table: (rows) => `\`\`\`\n${escape(rows)}\n\`\`\``,
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();
}

/** Discord reads Markdown itself; only tables need help. */
export function toDiscordMarkdown(markdown: string): string {
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? `\`\`\`${block.lang}\n${block.text}\n\`\`\``
        : prose(block.text, {
            line: (s) => s,
            // Discord renders #, ## and ### headings; deeper ones become bold.
            heading: (s) => `**${s}**`,
            quote: (lines) => lines.map((l) => `> ${l}`).join('\n'),
            table: (rows) => `\`\`\`\n${rows}\n\`\`\``,
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();
}

/**
 * Simple HTML for an email (ADR 0044): what every mail app shows the same
 * way, inline styles only, nothing loaded from anywhere. The plain-text part
 * beside it is `plain()`.
 */
export function toEmailHtml(markdown: string): string {
  const style = {
    escape: (s: string) => escapeHtml(s).replaceAll('"', '&quot;'),
    code: (s: string) =>
      `<code style="font-family:ui-monospace,Menlo,monospace;background:#f3f3f3;padding:0 3px">${escapeHtml(s)}</code>`,
    bold: (s: string) => `<b>${s}</b>`,
    italic: (s: string) => `<i>${s}</i>`,
    strike: (s: string) => `<s>${s}</s>`,
    link: (label: string, url: string) =>
      `<a href="${escapeHtml(url).replaceAll('"', '&quot;')}">${escapeHtml(label)}</a>`,
  };
  const pre = (text: string) =>
    `<pre style="font-family:ui-monospace,Menlo,monospace;background:#f6f6f6;padding:8px;border-radius:6px;white-space:pre-wrap">${escapeHtml(text)}</pre>`;
  const body = blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? pre(block.text)
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => `<b style="font-size:1.1em">${s}</b>`,
            quote: (lines) =>
              `<blockquote style="margin:0;padding-left:10px;border-left:3px solid #ccc;color:#555">${lines.join('<br>')}</blockquote>`,
            // A table's own line breaks stay as they are inside its <pre>.
            table: (rows) => pre(rows).replaceAll('\n', '\u0001'),
            bullet: '•',
          })
            .replaceAll('\n', '<br>\n')
            .replaceAll('\u0001', '\n'),
    )
    .join('\n')
    .trim();
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5">${body}</div>`;
}

/** Markdown with the markup taken out, for when an app refuses the formatted version. */
export function plain(markdown: string): string {
  const style = {
    escape: (s: string) => s,
    code: (s: string) => s,
    bold: (s: string) => s,
    italic: (s: string) => s,
    strike: (s: string) => s,
    link: (label: string, url: string) => (label === url ? url : `${label} (${url})`),
  };
  return blocks(markdown)
    .map((block) =>
      block.kind === 'code'
        ? block.text
        : prose(block.text, {
            line: (s) => inline(s, style),
            heading: (s) => s,
            quote: (lines) => lines.map((l) => `│ ${l}`).join('\n'),
            table: (rows) => rows,
            bullet: '•',
          }),
    )
    .join('\n')
    .trim();
}

/**
 * Cut an answer into parts that each fit an app's limit *once formatted*
 * (`measure` says how long a part will be as the app counts it). A table's
 * padding can make a part several times longer than its Markdown, so a part
 * that doesn't fit is cut again, smaller, until it does.
 */
export function fit(markdown: string, max: number, measure: (part: string) => number): string[] {
  const out: string[] = [];
  const place = (part: string, depth: number) => {
    const size = measure(part);
    if (size <= max || part.length < 200 || depth > 6) {
      out.push(part);
      return;
    }
    const smaller = Math.max(200, Math.floor((part.length * max * 0.9) / size));
    for (const piece of split(part, smaller)) place(piece, depth + 1);
  };
  for (const part of split(markdown, max)) place(part, 0);
  return out;
}

/**
 * Cut an answer into messages of at most `max` characters of Markdown, where a
 * person would: between paragraphs, then lines, then words. A code block that
 * has to be cut is closed at the end of one message and reopened in the next,
 * so each part still reads as code.
 */
export function split(markdown: string, max: number): string[] {
  const text = markdown.replace(/\r\n?/g, '\n').trim();
  if (!text) return [];
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  // Room to close and reopen a code fence around a cut.
  const budget = Math.max(max - 24, Math.ceil(max / 2));
  while (rest.length > max) {
    const window = rest.slice(0, budget);
    const cut =
      lastBreak(window, '\n\n', budget * 0.4) ??
      lastBreak(window, '\n', budget * 0.4) ??
      lastBreak(window, ' ', budget * 0.6) ??
      budget;
    let head = rest.slice(0, cut).trimEnd();
    let tail = rest.slice(cut).replace(/^\s+/, '');
    // Inside an open fence? Close it here and reopen it in the next part.
    const open = openFence(head);
    if (open !== undefined) {
      head = `${head}\n\`\`\``;
      tail = `\`\`\`${open}\n${tail}`;
    }
    parts.push(head);
    // Guard against a part that can't shrink (a fence reopened into a tiny window).
    if (tail.length >= rest.length) {
      parts.push(...hardSplit(tail, max));
      return parts;
    }
    rest = tail;
  }
  if (rest) parts.push(rest);
  return parts;
}

function lastBreak(window: string, token: string, min: number): number | undefined {
  const at = window.lastIndexOf(token);
  return at >= min ? at : undefined;
}

/** The language of a fence left open at the end of `text`, or undefined. */
function openFence(text: string): string | undefined {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    const fence = FENCE.exec(line);
    if (!fence) continue;
    open = open === undefined ? (fence[2] ?? '') : undefined;
  }
  return open;
}

function hardSplit(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}
