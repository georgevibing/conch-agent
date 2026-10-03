/**
 * Someone else's words, made safe to hand a model (ADR 0061, ADR 0028): a
 * stranger's app names itself, describes its tools and tells the assistant
 * how to use it, and none of that may read as an instruction from the user
 * or from Conch.
 */
import type { ConchAppSource } from '@conch/protocol';

/**
 * One short line of text: no control characters or line breaks (so never a
 * heading or a second line), no backticks (never a fence), quotes and angle
 * brackets turned into ones that can't close a quote or open a tag, and a cap.
 */
export function plainLine(text: string, max = 160): string {
  const plain = [...text]
    .map((c) => {
      const code = c.charCodeAt(0);
      if (code < 32 || code === 127 || c === '`') return ' ';
      if (c === '"' || c === '“' || c === '”') return '″';
      if (c === '<') return '‹';
      if (c === '>') return '›';
      return c;
    })
    .join('');
  const line = plain.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Someone else's words, as one quoted line of data. */
export const quoted = (text: string, max = 160): string => `“${plainLine(text, max)}”`;

/** Where an app came from, in a few words: "github.com/bea/weather", "example.com", "weather.conchapp". */
export function sourceName(source: ConchAppSource): string {
  switch (source.kind) {
    case 'made':
      return 'this Conch';
    case 'github':
      return plainLine(`github.com/${source.owner}/${source.repo}`, 120);
    case 'link': {
      const host = /^https?:\/\/(?:[^@/?#]*@)?([^:/?#\s]+)/i.exec(source.url)?.[1];
      return host ? plainLine(host.toLowerCase(), 120) : 'a link';
    }
    case 'file':
      return plainLine(source.name, 120);
  }
}
