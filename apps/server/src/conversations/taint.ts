/**
 * Read something untrusted, then check before acting (ADR 0028).
 *
 * An assistant that can read the web, your email and chat apps, and can also
 * run commands and send things, is one prompt injection away from doing what
 * a stranger wrote (Greshake et al. 2023; Willison's "lethal trifecta":
 * private data, untrusted content, a way out). Conch can't tell a hostile
 * page from a friendly one, so it doesn't try. Once a chat has *read*
 * something from outside — a web page, an email, a message from someone who
 * isn't you — anything that could send your things out or change your
 * computer asks you first, and the card says why in a sentence. Reading on
 * stays free. Full trust, in a chat you're in, is the exception you chose
 * (and "Always allow" on the card, per tool); a routine, a chat app, or
 * someone else's words still ask.
 *
 * Pure functions: the manager keeps the state (a `taint` event in the chat's
 * log, so it survives restarts) and asks; engines only call `guard`.
 */
import { isAbsolute, relative, resolve } from 'node:path';

import type { ConversationEvent, TaintSource } from '@conch/protocol';

/** Built-in tools that bring the outside in. */
const WEB_READERS = new Set([
  'WebFetch',
  'WebSearch',
  'web_fetch',
  'web_search',
  'mcp__conch__web_fetch',
  'mcp__conch__web_search',
  'video_search',
  'video_details',
  'mcp__conch__video_search',
  'mcp__conch__video_details',
]);
/** Conch's cards of what's known (ADR 0060 §7): someone else's words, like a page. */
const CARDS = /^(?:mcp__conch__)?(knowledge_card|link_preview|book_search|show_search)$/;
const CARD_SOURCES: Record<string, string> = {
  knowledge_card: 'Wikipedia',
  book_search: 'Open Library',
  show_search: 'TVmaze',
};
/** The sites a link preview opened: one by name, several together. */
const linksLabel = (urls: unknown): string => {
  const hosts = [...new Set((Array.isArray(urls) ? urls : []).flatMap((u) => hostOf(u) ?? []))];
  return hosts.length === 1 && hosts[0] ? hosts[0] : 'web pages';
};
/** Conch's browser: every look at a page is the outside coming in. */
const BROWSER =
  /^(?:mcp__conch__)?browser_(?:open|read|screenshot|click|click_at|back|scroll|wait|select|press|type|tabs|upload)$/;
const DOWNLOADS =
  /\b(?:curl|wget|http(?:ie)?|aria2c|fetch|Invoke-WebRequest|iwr|irm)\b|https?:\/\//i;
/**
 * Subcommands that only share a downloader's name (`git fetch`, `pnpm fetch`),
 * taken out before `DOWNLOADS` looks. Narrow on purpose, so it fails closed:
 * only where a command starts, only plain spaces, and for git only `-C` with a
 * plain path. Anything else (`x=a\ git fetch`, `git -C x&& fetch`, `sudo git
 * fetch`) still counts, and a mark checked again later (`heldTaints`) only
 * ever comes free for exactly these.
 */
const NOT_DOWNLOADS =
  /(^|[;&|(\n][ \t]*)(?:git(?:[ \t]+-C[ \t]+[\w./~:@%+,-]+)?|npm|pnpm|yarn)[ \t]+fetch\b/g;
const INTEGRATION = /^mcp__([a-z0-9_-]+?)__(.+)$/;

const hostOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return /https?:\/\/([^/\s"']+)/i.exec(value)?.[1]?.replace(/^www\./, '');
  }
};

/**
 * What a finished tool call brought in from outside, if anything.
 * `app`: an integration's name, for `mcp__<server>__*` calls.
 */
export function taintFrom(toolName: string, input: unknown, app?: string): TaintSource | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (
    /^(?:mcp__conch__)?google_(?:mail_(?:search|read)|calendar_briefing|drive_(?:search|read))$/.test(
      toolName,
    )
  )
    return { kind: 'app', label: 'Google account content' };
  if (/^(?:mcp__conch__)?slack_(?:channels|search|read_channel)$/.test(toolName))
    return { kind: 'app', label: 'Slack messages' };
  // Not `image_models` or `image_generate`: Conch's own catalog of picture routes and model
  // names, and Conch's own note of a picture it made from the assistant's words. Neither
  // brings anyone else's words into the chat, so neither marks it (ADR 0028, ADR 0100).
  if (/^(?:mcp__conch__)?task_status$/.test(toolName))
    return { kind: 'app', label: 'task results' };
  if (/^(?:mcp__conch__)?read_document$/.test(toolName))
    return { kind: 'download', label: 'document content' };
  // Recipe pages (the recipe card): someone else's page, as web_fetch's is.
  if (/^(?:mcp__conch__)?recipe$/.test(toolName))
    return {
      kind: 'web',
      label: hostOf(Array.isArray(args.urls) ? args.urls[0] : undefined) ?? 'a recipe page',
    };
  // Places found in OpenStreetMap: names, hours and links anyone can write.
  if (/^(?:mcp__conch__)?places$/.test(toolName))
    return { kind: 'web', label: 'OpenStreetMap places' };
  if (WEB_READERS.has(toolName))
    return {
      kind: 'web',
      label: /(?:WebSearch|web_search)$/.test(toolName)
        ? 'web search results'
        : /video_(?:search|details)$/.test(toolName)
          ? 'video titles from YouTube and Vimeo'
          : (hostOf(args.url) ?? 'a web page'),
    };
  if (BROWSER.test(toolName))
    return { kind: 'web', label: hostOf(args.url) ?? 'pages in the browser' };
  // Your screen (ADR 0110): an email, a page or a message on it is someone else's words.
  if (/^(?:mcp__conch__)?computer$/.test(toolName))
    return { kind: 'app', label: 'what was on your screen' };
  // Shop pages read for their products: someone else's words, like web_fetch.
  if (/^(?:mcp__conch__)?product_details$/.test(toolName))
    return {
      kind: 'web',
      label: (Array.isArray(args.urls) ? hostOf(args.urls[0]) : undefined) ?? 'shop pages',
    };
  const card = CARDS.exec(toolName)?.[1];
  if (card)
    return {
      kind: 'web',
      label:
        card === 'link_preview'
          ? linksLabel(args.urls)
          : card === 'show_search' && args.kind === 'movie'
            ? 'Wikipedia'
            : (CARD_SOURCES[card] ?? 'web pages'),
    };
  if (
    (toolName === 'Bash' || /^(?:mcp__conch__)?process_(?:start|read)$/.test(toolName)) &&
    typeof args.command === 'string' &&
    DOWNLOADS.test(args.command.replace(NOT_DOWNLOADS, '$1 '))
  )
    return { kind: 'download', label: hostOf(args.command) ?? 'something downloaded' };
  const integration = INTEGRATION.exec(toolName);
  if (integration && integration[1] !== 'conch')
    return { kind: 'app', label: app ?? integration[1] ?? 'an app' };
  return undefined;
}

/** The label `image_models` and `image_generate` once marked a chat with. */
const OLD_PICTURE_MARK = 'OpenRouter image service';

/**
 * What a chat's log says it read. A mark a command made is looked at again by
 * today's rule, so one an older rule got wrong (`git fetch` read as a download)
 * stops holding the chat. Pages, apps, people, and marks carried in from
 * another chat stay as they are.
 */
export function heldTaints(events: readonly ConversationEvent[]): TaintSource[] {
  return events.flatMap((e, i) => {
    if (e.type !== 'taint') return [];
    // Conch's own picture tools marked chats under this label before they stopped marking.
    if (e.source.kind === 'app' && e.source.label === OLD_PICTURE_MARK) return [];
    if (e.source.kind !== 'download') return [e.source];
    // The command that made it: named on the mark, or (older logs) the call finishing next.
    const next = events[i + 1];
    const id = e.toolUseId ?? (next?.type === 'tool.finished' ? next.toolUseId : undefined);
    // The call started last before the mark: ids can repeat across turns and providers.
    const call = id
      ? events.findLast((c, j) => j < i && c.type === 'tool.started' && c.toolUseId === id)
      : undefined;
    if (call?.type !== 'tool.started' || call.name !== 'Bash') return [e.source];
    return taintFrom(call.name, call.input) ? [e.source] : [];
  });
}

export interface SinkContext {
  /** The chat's work folder: changing files there is the work. */
  workspace: string;
  /** For an integration's tool: `read` when it only reads (its page in Apps). */
  access?: 'read' | 'write';
  app?: string;
}

const inside = (dir: string, path: string) => {
  const rel = relative(resolve(dir), resolve(dir, path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** A URL that could carry what was read: a long query, a long opaque path segment. */
const carries = (url: string) => {
  try {
    const u = new URL(url);
    return (
      u.search.length > 80 ||
      u.hash.length > 80 ||
      u.pathname.split('/').some((segment) => segment.length > 60) ||
      /[?&](?:q|data|d|payload|text|content|body|msg|token|key)=[^&]{24,}/i.test(u.search)
    );
  } catch {
    return false;
  }
};

/**
 * A web address that looks like it carries data rather than asks for a page
 * (ADR 0117): a long encoded blob (base64, hex) anywhere in it, a long text in
 * one value, or a great deal of query. Words, filters and slugs — a shop's
 * search for "gant t-shirt herren", sorted by price — don't.
 */
export function carriesData(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.search.length + u.hash.length > 400) return true;
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part.replace(/\+/g, ' '));
    } catch {
      return part;
    }
  };
  const values = [
    ...u.pathname.split('/'),
    ...[...u.searchParams.values()],
    ...u.hash.replace(/^#/, '').split(/[&=]/),
  ].map(decode);
  return values.some(
    (value) =>
      value.length > 120 ||
      value
        .split(/[\s\-_.,;:/&=]+/)
        .some(
          (token) =>
            (token.length >= 24 &&
              /^[A-Za-z0-9+/=]+$/.test(token) &&
              /\d/.test(token) &&
              /[A-Za-z]/.test(token) &&
              /[A-Z]/.test(token) &&
              /[a-z]/.test(token)) ||
            /^[0-9a-f]{32,}$/i.test(token),
        ),
  );
}

/**
 * What this call could do with what was read, in the words of the card
 * ("run a command"), when it's something that should ask. Undefined: let it be.
 */
export function sinkReason(
  toolName: string,
  input: unknown,
  context: SinkContext,
): string | undefined {
  const args = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (/^(?:mcp__conch__)?google_mail_create_draft$/.test(toolName)) return 'save a Gmail draft';
  if (/^(?:mcp__conch__)?google_mail_send$/.test(toolName)) return 'send an email';
  if (/^(?:mcp__conch__)?google_calendar_(?:create|update|delete)_event$/.test(toolName))
    return 'change your Google Calendar';
  if (/^(?:mcp__conch__)?google_drive_create_file$/.test(toolName))
    return 'make a file in your Google Drive';
  if (/^(?:mcp__conch__)?slack_send_message$/.test(toolName)) return 'send a Slack message';
  if (/^(?:mcp__conch__)?image_generate$/.test(toolName))
    return 'send a prompt or source picture to an image service';
  if (/^(?:mcp__conch__)?process_(?:start|write)$/.test(toolName))
    return 'run or send input to a command';
  if (/^(?:mcp__conch__)?task_control$/.test(toolName) && args.action !== 'stop')
    return 'restart a task';
  if (toolName === 'Bash' || toolName === 'BashOutput' || toolName === 'KillShell')
    return toolName === 'Bash' ? 'run a command' : undefined;
  if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName)) {
    const path = String(args.file_path ?? args.notebook_path ?? '');
    return path && !inside(context.workspace, path)
      ? 'change a file outside your work folder'
      : undefined;
  }
  if (/(?:WebSearch|web_search)$/.test(toolName)) return 'send a search query to the web';
  if (/^(?:mcp__conch__)?video_search$/.test(toolName)) return 'send a search query to YouTube';
  if (/(?:WebFetch|web_fetch)$/.test(toolName) && typeof args.url === 'string' && carries(args.url))
    return 'open a web address that could carry what it read';
  if (
    /^(?:mcp__conch__)?recipe$/.test(toolName) &&
    Array.isArray(args.urls) &&
    args.urls.some((u) => typeof u === 'string' && carries(u))
  )
    return 'open a web address that could carry what it read';
  if (
    /^(?:mcp__conch__)?product_details$/.test(toolName) &&
    Array.isArray(args.urls) &&
    args.urls.some((url) => typeof url === 'string' && carries(url))
  )
    return 'open a web address that could carry what it read';
  // A place search is short words to OpenStreetMap; long ones could carry what was read, as a URL can.
  if (
    /^(?:mcp__conch__)?places$/.test(toolName) &&
    [args.what, args.near, args.from].map((v) => (typeof v === 'string' ? v : '')).join(' ')
      .length > 120
  )
    return 'send a long place search to OpenStreetMap';
  // A card's lookup: the pages a preview opens, like web_fetch; a name sent to look up is
  // research, unless it's long enough to carry what was read.
  const card = CARDS.exec(toolName)?.[1];
  if (card === 'link_preview')
    return Array.isArray(args.urls) && args.urls.some((u) => typeof u === 'string' && carries(u))
      ? 'open a web address that could carry what it read'
      : undefined;
  if (card && String(args.query ?? '').length > 120) return 'send a search query to the web';
  // An app's picture fetched from an address (ADR 0090): the same way out as web_fetch.
  if (
    /^(?:mcp__conch__)?app_icon$/.test(toolName) &&
    typeof args.url === 'string' &&
    carries(args.url)
  )
    return 'fetch a picture from a web address that could carry what it read';
  const integration = INTEGRATION.exec(toolName);
  if (integration && integration[1] !== 'conch' && context.access !== 'read')
    return `act in ${context.app ?? integration[1] ?? 'an app'}`;
  return undefined;
}

/** Escaping the sealed box always asks: it's the box's whole point. */
export function leavesSandbox(toolName: string, input: unknown): boolean {
  return (
    toolName === 'Bash' &&
    Boolean(
      (input as { dangerouslyDisableSandbox?: unknown } | undefined)?.dangerouslyDisableSandbox,
    )
  );
}

const KIND_WORDS: Record<TaintSource['kind'], string> = {
  web: 'read',
  download: 'downloaded',
  app: 'read things in',
  person: 'got a message from',
};

/** "This chat read example.com and things in Gmail" — what the card says. */
export function describeTaint(sources: readonly TaintSource[]): string {
  const parts = sources.slice(0, 3).map((s) => `${KIND_WORDS[s.kind]} ${s.label}`);
  const more = sources.length > 3 ? ` and ${sources.length - 3} more` : '';
  const list =
    parts.length <= 1
      ? (parts[0] ?? 'read something from outside')
      : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `This chat ${list}${more}, which could be trying to steer me.`;
}
