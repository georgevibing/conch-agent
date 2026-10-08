/**
 * Every tool call in plain words (ADR 0103), by rules: instant, free, the same
 * for every provider. The server writes these onto `tool.started` and
 * `tool.finished`; the chat works them out here for chats logged before then.
 *
 * Without a result the words are for a call still running (`done` is still
 * filled, for the moment it ends). With one, the output refines them: what the
 * tests came to, where the push went, why it failed, what it changed.
 */
import type { ActivityChip, ActivityEffect, ActivityFamily, ToolLabel } from './activity';
import { APP_TOOL_WORDS, type AppToolName } from './app-tools';
import type { ToolApproval, ToolStatus } from './index';
import { PAST_CHATS_TOOLS } from './past-chats';
import {
  exitCode,
  failureLine,
  plain,
  readOutput,
  refused,
  testSummary,
  type ReadKind,
} from './activity-describe/output';
import {
  commandSubject,
  describeCommand,
  pushAct,
  siteChip,
  type Act,
} from './activity-describe/shell';
import {
  article,
  baseName,
  baseOfIng,
  cap,
  clip,
  count,
  folderName,
  fromPhrase,
  hostOf,
  humanize,
  isLocal,
  notDone,
  oneLine,
  plural,
  quote,
  say,
  shortPath,
  trimEnd,
  words,
  type Words,
} from './activity-describe/words';

/** How a call ended, for the words that say what it found. */
export interface ToolResult {
  status: ToolStatus;
  output?: string;
  /** The `kind` of the `ToolView` it returned, when it returned one. */
  viewKind?: string;
  /**
   * It asked first, or a rule stopped it: how that went. `declined`, `refused`
   * and `expired` mean it never ran, whatever `status` the tool reported.
   */
  approval?: ToolApproval;
}

/** Answers that mean a call never ran, and what its line says about why. */
const NOT_RUN: Partial<Record<ToolApproval, string>> = {
  declined: 'You said no',
  refused: 'Not allowed',
  expired: 'Not answered',
};

/** A label on its way: the words, and how to read the output when it comes. */
interface Draft {
  family: ActivityFamily;
  words: Words;
  subject?: string;
  outcome?: string;
  read?: ReadKind;
  effects?: ActivityEffect[];
  chips?: ActivityChip[];
  /** The words came from the call's own description: keep them over ours. */
  described?: boolean;
  push?: Act['push'];
  commit?: Act['commit'];
  /** Reads the output its own way; what it returns wins, and `handled` skips the usual reading. */
  finish?: (output: string, result: ToolResult) => Finish | undefined;
}

interface Finish {
  words?: Words;
  family?: ActivityFamily;
  subject?: string;
  outcome?: string;
  failed?: boolean;
  effects?: ActivityEffect[] | undefined;
  chips?: ActivityChip[];
  read?: ReadKind;
  /** The finish said everything: no further reading of the output. */
  handled?: boolean;
}

type Input = Record<string, unknown>;

const record = (value: unknown): Input =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Input) : {};

/** The first of these keys that holds a non-empty string. */
function str(input: Input, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

const fileChip = (path: string): ActivityChip => ({
  kind: 'file',
  label: baseName(path),
  href: path.slice(0, 2000),
});

const textChip = (text: string): ActivityChip => ({
  kind: 'text',
  label: clip(oneLine(text), 120),
});

function lowerFirst(text: string): string {
  // "Explore the parser", but "API" and "README" keep their capitals.
  return /^[A-Z][a-z]/.test(text) ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

function parseJson(output: string): unknown {
  const text = output.trim();
  if (!text || text.length > 400_000 || !/^[{[]/.test(text)) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Sites a search found, once each, as chips. */
function siteChips(output: string, most = 6): { chips: ActivityChip[]; found: number } {
  const seen = new Set<string>();
  const chips: ActivityChip[] = [];
  let found = 0;
  const text = output.slice(0, 200_000);
  for (const m of text.matchAll(/"(?:url|link|href)"\s*:\s*"(https?:\/\/[^"\s]{1,1900})"/g)) {
    const url = m[1] ?? '';
    found++;
    const host = hostOf(url);
    if (!host || seen.has(host) || chips.length >= most) continue;
    seen.add(host);
    chips.push(siteChip(url, host));
  }
  return { chips, found };
}

// ---------------------------------------------------------------- the shell

function commandOf(input: Input): string {
  const command = input.command ?? input.cmd;
  if (typeof command === 'string') return command;
  // Codex's older shell tool: ["bash", "-lc", "…"].
  if (Array.isArray(command)) {
    const parts = command.filter((p): p is string => typeof p === 'string');
    const flag = parts.findIndex((p) => /^-[a-z]*c[a-z]*$/.test(p));
    if (flag >= 0 && parts[flag + 1] !== undefined && /sh$/.test(parts[0] ?? ''))
      return parts[flag + 1] ?? '';
    return parts.map((p) => (/[\s"'$]/.test(p) ? `'${p.replace(/'/g, `'\\''`)}'` : p)).join(' ');
  }
  return '';
}

function fromAct(a: Act, subject?: string): Draft {
  return {
    family: a.family,
    words: a.words,
    ...(subject && { subject }),
    ...(a.read && { read: a.read }),
    ...(a.effects?.length && { effects: a.effects }),
    ...(a.chips?.length && { chips: a.chips }),
    ...(a.push && { push: a.push }),
    ...(a.commit && { commit: a.commit }),
  };
}

function bash(input: Input): Draft {
  const command = commandOf(input);
  const a = describeCommand(command);
  const draft = fromAct(a, command.trim() ? commandSubject(command) : undefined);
  const description = str(input, 'description');
  const own = description ? fromPhrase(description) : undefined;
  if (input.run_in_background === true) {
    return {
      ...draft,
      words: words(`Starting ${a.noun}`, `Started ${a.noun}`, `Couldn’t start ${a.noun}`),
      effects: undefined,
      finish: () => ({ handled: true }),
    };
  }
  return own ? { ...draft, words: own, described: true } : draft;
}

interface ProcessView {
  command?: string;
  status?: string;
  exitCode?: number | null;
  output?: string;
  reason?: string;
}

function processView(output: string): ProcessView | ProcessView[] | undefined {
  const value = parseJson(output);
  if (Array.isArray(value)) return value.map(record) as ProcessView[];
  const view = record(value);
  return typeof view.command === 'string' || typeof view.status === 'string'
    ? (view as ProcessView)
    : undefined;
}

/** A managed command's progress (ADR 0072), read from what `process_*` returns. */
function processFinish(view: ProcessView, how: 'start' | 'read' | 'stop'): Finish {
  const command = typeof view.command === 'string' ? view.command : '';
  const a = describeCommand(command);
  const subject = command ? commandSubject(command) : undefined;
  const base = { family: a.family, ...(subject && { subject }), handled: true, effects: undefined };
  const started = words(`Starting ${a.noun}`, `Started ${a.noun}`, `Couldn’t start ${a.noun}`);
  const checked = words(
    `Checking on ${a.noun}`,
    `Checked on ${a.noun}`,
    `Couldn’t check on ${a.noun}`,
  );
  const stopped = words(`Stopping ${a.noun}`, `Stopped ${a.noun}`, `Couldn’t stop ${a.noun}`);
  const waiting = how === 'stop' ? stopped : how === 'start' ? started : checked;
  switch (view.status) {
    case 'queued':
      return { ...base, words: waiting, outcome: 'Waiting to start' };
    case 'running': {
      const sum =
        typeof view.output === 'string' && a.read === 'tests'
          ? testSummary(plain(view.output))
          : undefined;
      return {
        ...base,
        words: how === 'stop' ? stopped : how === 'start' ? started : checked,
        outcome:
          sum && how === 'read' ? `Still running · ${count(sum.passed)} passed` : 'Still running',
      };
    }
    case 'stopped':
      return { ...base, words: stopped, ...(how !== 'stop' && { outcome: 'Stopped' }) };
    case 'timed-out':
      return { ...base, words: a.words, outcome: 'Time limit reached', failed: true };
    case 'exited': {
      const out = typeof view.output === 'string' ? view.output : '';
      const code = typeof view.exitCode === 'number' ? view.exitCode : 0;
      const reading = readOutput(a.read, out, code === 0);
      const failed = (code !== 0 && !reading.fine) || !!reading.failed;
      return {
        ...base,
        words: failed && a.family !== 'verify' ? { ...a.words, done: a.words.tried } : a.words,
        ...((reading.outcome ?? (failed ? failureOutcome(out, code) : undefined)) && {
          outcome: reading.outcome ?? failureOutcome(out, code),
        }),
        ...(failed && { failed: true }),
        ...(!failed && !reading.nothing && a.effects?.length && { effects: a.effects }),
      };
    }
    default:
      return { ...base, words: how === 'stop' ? stopped : how === 'start' ? started : checked };
  }
}

/** A file's name with the extension of what it's made as: `Q3 report` + `pdf` → `Q3 report.pdf`. */
function withFormat(name: string, format: string | undefined): string {
  const clean = oneLine(name).trim();
  if (!format || !/^[a-z0-9]{1,6}$/.test(format)) return clean;
  return clean.toLowerCase().endsWith(`.${format}`) ? clean : `${clean}.${format}`;
}

/** A source by its name: a chat's file (`att_…`) has none worth saying. */
const sourceName = (source: string | undefined) =>
  source && !/^att_/i.test(source) ? baseName(source) : undefined;

/**
 * A file Conch made, converted, combined or unpacked (the `file_*` tools):
 * shown as its card, offered to download, so What changed says it.
 */
function fileDraft(said: Words): Draft {
  return {
    family: 'make',
    words: said,
    effects: [{ kind: 'publish', text: said.done }],
    finish: (output, result) => {
      if (result.status === 'error') return undefined;
      const made = record(parseJson(output));
      const n = (key: string) => (typeof made[key] === 'number' ? (made[key] as number) : 0);
      const files = Array.isArray(made.files) ? made.files.length : 0;
      const outcome = n('pages')
        ? plural(n('pages'), 'page')
        : n('sheets')
          ? plural(n('sheets'), 'sheet')
          : n('slides')
            ? plural(n('slides'), 'slide')
            : files
              ? plural(files + n('more'), 'file')
              : undefined;
      return outcome ? { outcome, handled: true } : { handled: true };
    },
  };
}

function processDraft(how: 'start' | 'read' | 'write' | 'stop', input: Input): Draft {
  if (how === 'start') {
    const command = str(input, 'command') ?? '';
    const a = describeCommand(command);
    return {
      family: a.family,
      words: words(`Starting ${a.noun}`, `Started ${a.noun}`, `Couldn’t start ${a.noun}`),
      ...(command && { subject: commandSubject(command) }),
      ...(a.chips?.length && { chips: a.chips }),
      finish: (output) => {
        const view = processView(output);
        return view && !Array.isArray(view) ? processFinish(view, 'start') : { handled: true };
      },
    };
  }
  if (how === 'write')
    return {
      family: 'run',
      words: say('type', 'into a command'),
      finish: () => ({ handled: true }),
    };
  const generic =
    how === 'stop'
      ? say('stop', 'a command')
      : words('Checking on a command', 'Checked on a command', 'Couldn’t check on a command');
  return {
    family: 'run',
    words: generic,
    finish: (output) => {
      const view = processView(output);
      if (Array.isArray(view))
        return {
          handled: true,
          words: say('check', 'the commands'),
          outcome: plural(view.length, 'command'),
        };
      return view ? processFinish(view, how) : { handled: true };
    },
  };
}

/** Claude Code's BashOutput: `<status>running</status>`, `<exit_code>0</exit_code>`, `<stdout>…</stdout>`. */
function backgroundOutput(): Draft {
  return {
    family: 'run',
    words: words('Checking on a command', 'Checked on a command', 'Couldn’t check on a command'),
    finish: (output) => {
      const status = /<status>(\w+)<\/status>/.exec(output.slice(0, 2000))?.[1];
      const code = /<exit_code>(-?\d+)<\/exit_code>/.exec(output.slice(0, 4000))?.[1];
      const stdout = /<stdout>([\s\S]*?)<\/stdout>/.exec(output)?.[1] ?? output;
      const sum = testSummary(plain(stdout));
      if (status === 'running')
        return {
          handled: true,
          outcome: sum ? `Still running · ${count(sum.passed)} passed` : 'Still running',
        };
      const failedRun = (code !== undefined && code !== '0') || status === 'failed';
      if (sum) {
        const reading = readOutput('tests', stdout, !failedRun);
        return {
          handled: true,
          ...(reading.outcome && { outcome: reading.outcome }),
          ...((reading.failed || failedRun) && { failed: true }),
        };
      }
      if (failedRun)
        return { handled: true, failed: true, outcome: failureOutcome(stdout, Number(code ?? 1)) };
      return { handled: true, ...(status === 'killed' && { outcome: 'Stopped' }) };
    },
  };
}

// ---------------------------------------------------------------- files

const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg|bmp|ico|heic|avif|tiff?)$/i;

function readDraft(input: Input, what = 'file'): Draft {
  const path = str(input, 'file_path', 'path', 'notebook_path', 'file', 'filename');
  const name = path ? baseName(path) : `a ${what}`;
  return {
    family: 'explore',
    words: path && IMAGE_FILE.test(path) ? say('look', `at ${name}`) : say('read', name),
    ...(path && { subject: shortPath(path), chips: [fileChip(path)] }),
  };
}

/** Lines added and taken away between two texts, roughly as a diff would count them. */
function lineChange(before: string, after: string): { added: number; removed: number } {
  const old = before.slice(0, 200_000).split('\n').slice(0, 3_000);
  const now = after.slice(0, 200_000).split('\n').slice(0, 3_000);
  const left = new Map<string, number>();
  for (const line of old) left.set(line, (left.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of now) {
    const n = left.get(line) ?? 0;
    if (n > 0) left.set(line, n - 1);
    else added++;
  }
  let removed = 0;
  for (const n of left.values()) removed += n;
  if (!before) removed = 0;
  return { added, removed };
}

function changeOutcome(added: number, removed: number): string | undefined {
  if (!added && !removed) return undefined;
  if (!removed) return `+${count(added)}`;
  if (!added) return `−${count(removed)}`;
  return `+${count(added)} −${count(removed)}`;
}

function editDraft(name: string, input: Input): Draft {
  const listed = Array.isArray(input.paths)
    ? input.paths.filter((p): p is string => typeof p === 'string')
    : [];
  const path = str(input, 'file_path', 'path', 'notebook_path');
  const paths = listed.length ? listed : path ? [path] : [];
  const what =
    paths.length === 1
      ? baseName(paths[0] ?? '')
      : paths.length > 1
        ? plural(paths.length, 'file')
        : 'a file';
  let outcome: string | undefined;
  if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    let added = 0;
    let removed = 0;
    for (const edit of input.edits.slice(0, 200)) {
      const e = record(edit);
      const change = lineChange(str(e, 'old_string') ?? '', str(e, 'new_string') ?? '');
      added += change.added;
      removed += change.removed;
    }
    outcome = changeOutcome(added, removed);
  } else if (typeof input.old_string === 'string' || typeof input.new_string === 'string') {
    const change = lineChange(
      typeof input.old_string === 'string' ? input.old_string : '',
      typeof input.new_string === 'string' ? input.new_string : '',
    );
    outcome = changeOutcome(change.added, change.removed);
  }
  const notebook = name === 'NotebookEdit';
  const mode = str(input, 'edit_mode');
  const said =
    notebook && mode === 'insert'
      ? say('add', `a cell to ${what}`)
      : notebook && mode === 'delete'
        ? say('delete', `a cell in ${what}`)
        : say('edit', what);
  return {
    family: 'edit',
    words: said,
    ...(paths.length === 1 && { subject: shortPath(paths[0] ?? '') }),
    ...(outcome && { outcome }),
    effects: (paths.length ? paths.slice(0, 20) : ['']).map((p) => ({
      kind: 'file' as const,
      text: `Changed ${p ? baseName(p) : 'a file'}`,
      ...(p && { target: p.slice(0, 300) }),
    })),
    ...(paths.length && { chips: paths.slice(0, 6).map(fileChip) }),
    finish: (output, result) => {
      // Codex: a change it wasn't allowed to make.
      if (result.status === 'success' && /^Not changed/.test(output))
        return { effects: undefined, outcome: 'Not changed' };
      return undefined;
    },
  };
}

function writeDraft(input: Input): Draft {
  const path = str(input, 'file_path', 'path');
  const name = path ? baseName(path) : 'a file';
  const content = typeof input.content === 'string' ? input.content : undefined;
  const lines = content ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0) : 0;
  return {
    family: 'edit',
    words: say('write', name),
    ...(path && { subject: shortPath(path), chips: [fileChip(path)] }),
    ...(lines > 0 && { outcome: plural(lines, 'line') }),
    effects: [
      { kind: 'file', text: `Changed ${name}`, ...(path && { target: path.slice(0, 300) }) },
    ],
    finish: (output) => {
      if (/File created successfully|^Created /i.test(output.slice(0, 300)))
        return {
          words: { ...say('create', name), doing: `Writing ${name}` },
          effects: [
            { kind: 'file', text: `Created ${name}`, ...(path && { target: path.slice(0, 300) }) },
          ],
        };
      return undefined;
    },
  };
}

function globDraft(input: Input): Draft {
  const pattern = str(input, 'pattern', 'glob') ?? '';
  const path = str(input, 'path');
  const ext = /^(?:\*\*\/)?\*\.(\w{1,8})$/.exec(pattern)?.[1];
  const what = ext
    ? `for .${ext} files`
    : pattern
      ? `for files matching ${quote(pattern)}`
      : 'for files';
  const where = path && path !== '.' ? ` in ${folderName(path)}` : '';
  return {
    family: 'explore',
    words: say('look', `${what}${where}`),
    read: 'files',
    ...(pattern && { subject: clip(pattern, 200) }),
  };
}

function grepDraft(input: Input): Draft {
  const pattern = str(input, 'pattern', 'query', 'regex') ?? '';
  const path = str(input, 'path');
  const filePath = path && /\.\w{1,6}$/.test(path) ? path : undefined;
  const place = filePath
    ? baseName(filePath)
    : path && path !== '.'
      ? folderName(path)
      : 'the code';
  return {
    family: 'explore',
    words: say('search', `${place} for ${quote(pattern.replace(/\\([^\w\s])/g, '$1'))}`),
    read: input.output_mode === 'count' ? 'match-counts' : 'matches',
    ...(pattern && { subject: clip(pattern, 200) }),
    ...(filePath && { chips: [fileChip(filePath)] }),
  };
}

function listDraft(input: Input): Draft {
  const path = str(input, 'path', 'dir', 'directory');
  return {
    family: 'explore',
    words: say('look', `through ${folderName(path)}`),
    read: 'entries',
    ...(path && { subject: shortPath(path) }),
  };
}

// ---------------------------------------------------------------- the web

function fetchDraft(input: Input): Draft {
  const url = str(input, 'url', 'href', 'link') ?? '';
  const host = hostOf(url);
  const where = host ?? 'a page';
  return {
    family: 'research',
    words: say('read', where),
    ...(url && { subject: clip(url, 300) }),
    ...(host && url && !isLocal(host) && { chips: [siteChip(url, host)] }),
    finish: (output) => {
      const page = record(parseJson(output));
      const title = typeof page.title === 'string' ? oneLine(page.title) : '';
      const final = typeof page.url === 'string' ? page.url : undefined;
      const finalHost = final ? hostOf(final) : undefined;
      return {
        ...(title && { outcome: clip(title, 60) }),
        ...(final &&
          finalHost &&
          finalHost !== host &&
          !isLocal(finalHost) && { chips: [siteChip(final, finalHost)] }),
      };
    },
  };
}

/** `recipe`: one to three recipe pages, read for the recipe card. */
function recipeDraft(input: Input): Draft {
  const urls = Array.isArray(input.urls)
    ? input.urls.filter((u): u is string => typeof u === 'string')
    : [];
  const sites = urls.flatMap((url) => {
    const host = hostOf(url);
    return host && !isLocal(host) ? [siteChip(url, host)] : [];
  });
  const host = urls[0] ? hostOf(urls[0]) : undefined;
  return {
    family: 'research',
    words: say(
      'find',
      urls.length > 1 ? `${urls.length} recipes` : host ? `a recipe on ${host}` : 'a recipe',
    ),
    ...(sites.length && { chips: sites }),
    finish: (output) => {
      const recipes = record(parseJson(output)).recipes;
      const first = Array.isArray(recipes) ? record(recipes[0]).title : undefined;
      return typeof first === 'string' && first ? { outcome: clip(oneLine(first), 60) } : {};
    },
  };
}

function searchWebDraft(input: Input): Draft {
  const query = str(input, 'query', 'q', 'search_query') ?? '';
  return {
    family: 'research',
    words: say('search', query ? `the web for ${quote(query)}` : 'the web'),
    ...(query && { subject: clip(oneLine(query), 300), chips: [textChip(query)] }),
    finish: (output) => {
      const { chips, found } = siteChips(output);
      return {
        ...(chips.length && { chips: [...(query ? [textChip(query)] : []), ...chips] }),
        ...(found && { outcome: plural(found, 'result') }),
      };
    },
  };
}

// ---------------------------------------------------------------- plans and helpers

function planOutcome(
  items: unknown,
  doneWords: readonly string[],
): { outcome?: string; started: boolean } {
  const list = Array.isArray(items) ? items.slice(0, 200).map(record) : [];
  if (!list.length) return { started: false };
  const finished = list.filter((t) => doneWords.includes(String(t.status))).length;
  const active = list.some((t) => t.status === 'in_progress' || t.status === 'active');
  return { outcome: `${finished} of ${list.length} done`, started: finished > 0 || active };
}

function todoDraft(items: unknown, doneWords: readonly string[]): Draft {
  const { outcome, started } = planOutcome(items, doneWords);
  return {
    family: 'plan',
    words: started || !outcome ? say('update', 'the plan') : say('make', 'a plan'),
    ...(outcome && { outcome }),
  };
}

function helperDraft(description: string | undefined): Draft {
  const task = description ? lowerFirst(clip(trimEnd(oneLine(description), '.!'), 70)) : undefined;
  return {
    family: 'delegate',
    words: say('ask', task ? `a helper to ${task}` : 'a helper'),
    ...(description && { subject: clip(oneLine(description), 300) }),
  };
}

// ---------------------------------------------------------------- apps and servers

const APP_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  'google-calendar': 'Google Calendar',
  'google-drive': 'Google Drive',
  slack: 'Slack',
};

function appDraft(name: AppToolName, input: Input): Draft {
  const w = APP_TOOL_WORDS[name];
  const query = str(input, 'query');
  const to = str(input, 'to', 'recipient', 'channel', 'channel_name');
  const title = str(input, 'summary', 'title', 'subject', 'name');
  const said: Words = { doing: w.doing, done: w.done, tried: triedOf(w.doing, w.done) };
  const effect: ActivityEffect | undefined =
    name === 'google_mail_send'
      ? {
          kind: 'send',
          text: to ? `Sent an email to ${clip(to, 60)}` : 'Sent an email',
          ...(to && { target: clip(to, 300) }),
        }
      : name === 'slack_send_message'
        ? { kind: 'send', text: 'Sent a message in Slack', ...(to && { target: clip(to, 300) }) }
        : name === 'google_calendar_create_event'
          ? {
              kind: 'schedule',
              text: title
                ? `Added ${quote(title, 60)} to your calendar`
                : 'Added an event to your calendar',
              ...(title && { target: clip(title, 300) }),
            }
          : name === 'google_calendar_update_event'
            ? { kind: 'schedule', text: title ? `Changed ${quote(title, 60)}` : 'Changed an event' }
            : name === 'google_calendar_delete_event'
              ? { kind: 'delete', text: 'Deleted an event' }
              : name === 'google_drive_create_file'
                ? {
                    kind: 'file',
                    text: title ? `Made ${quote(title, 60)} in Drive` : 'Made a file in Drive',
                  }
                : name === 'google_mail_create_draft'
                  ? { kind: 'other', text: 'Saved a draft' }
                  : undefined;
  return {
    family: 'connect',
    words: said,
    ...(query ? { subject: quote(query, 80) } : title ? { subject: clip(title, 300) } : {}),
    chips: [{ kind: 'app', label: APP_NAMES[w.app] ?? humanize(w.app) }],
    ...(effect && { effects: [effect] }),
  };
}

/** "Couldn’t send an email", from "Sending an email". */
function triedOf(doing: string, done: string): string {
  const m = /^(\w+ing)\b(.*)$/.exec(doing);
  return m?.[1] ? `Couldn’t ${baseOfIng(m[1])}${m[2] ?? ''}` : done;
}

const SERVER_NAMES: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  notion: 'Notion',
  slack: 'Slack',
  google: 'Google',
  gmail: 'Gmail',
  jira: 'Jira',
  atlassian: 'Atlassian',
  confluence: 'Confluence',
  figma: 'Figma',
  asana: 'Asana',
  sentry: 'Sentry',
  stripe: 'Stripe',
  postgres: 'Postgres',
  supabase: 'Supabase',
  vercel: 'Vercel',
  cloudflare: 'Cloudflare',
  playwright: 'Playwright',
  puppeteer: 'Puppeteer',
  context7: 'Context7',
  aws: 'AWS',
  outlook: 'Outlook',
  'aws-outlook': 'Outlook',
  filesystem: 'Files',
  fetch: 'the web',
  memory: 'Memory',
  datadog: 'Datadog',
  pagerduty: 'PagerDuty',
  hubspot: 'HubSpot',
  salesforce: 'Salesforce',
  zapier: 'Zapier',
  todoist: 'Todoist',
  airtable: 'Airtable',
  dropbox: 'Dropbox',
  discord: 'Discord',
  telegram: 'Telegram',
  whatsapp: 'WhatsApp',
  youtube: 'YouTube',
  spotify: 'Spotify',
  shopify: 'Shopify',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

/** A server's name the way people say it: `plugin_x_builder-mcp` → "Builder". */
function serverName(raw: string): string {
  const last = raw.includes('_') ? (raw.split('_').filter(Boolean).pop() ?? raw) : raw;
  const bare =
    last
      .replace(/^mcp[-_]|[-_]mcp$|[-_]server$|^server[-_]/gi, '')
      .replace(/^enterprise[-_]/i, '') || last;
  const known = SERVER_NAMES[bare.toLowerCase()];
  if (known) return known;
  const tail = SERVER_NAMES[bare.toLowerCase().split(/[-_]/).pop() ?? ''];
  if (tail) return tail;
  return humanize(bare)
    .split(' ')
    .map((w) =>
      w.length <= 3 && /^[a-z]+$/.test(w) && !['the', 'and', 'for', 'app'].includes(w)
        ? w.toUpperCase()
        : w,
    )
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase());
}

const LOOK_VERBS = new Set([
  'get',
  'read',
  'fetch',
  'view',
  'show',
  'describe',
  'retrieve',
  'lookup',
  'load',
  'open',
  'inspect',
  'peek',
  'batch',
]);
const SEARCH_VERBS = new Set(['search', 'find', 'query', 'lookup', 'grep', 'explore']);
const LIST_VERBS = new Set(['list', 'browse', 'enumerate']);
const SEND_VERBS = new Set([
  'send',
  'post',
  'reply',
  'comment',
  'message',
  'invite',
  'share',
  'publish',
  'notify',
  'email',
  'tweet',
  'broadcast',
  'forward',
]);
const SCHEDULE_HINT = /calendar|event|meeting|reminder|schedule|booking|appointment/i;
const MAKE_VERBS = new Set([
  'create',
  'add',
  'new',
  'make',
  'write',
  'insert',
  'upload',
  'schedule',
  'book',
  'draft',
  'save',
  'append',
  'generate',
  'start',
  'open',
]);
const CHANGE_VERBS = new Set([
  'update',
  'edit',
  'set',
  'patch',
  'modify',
  'change',
  'rename',
  'move',
  'mark',
  'pin',
  'assign',
  'archive',
  'complete',
  'close',
  'resolve',
  'merge',
  'approve',
  'toggle',
  'mute',
  'unmute',
  'react',
  'label',
  'tag',
  'restore',
  'rollback',
  'fork',
  'copy',
  'subscribe',
  'unsubscribe',
  'reorder',
  'bulk',
]);
const DELETE_VERBS = new Set([
  'delete',
  'remove',
  'cancel',
  'unpin',
  'revoke',
  'destroy',
  'drop',
  'clear',
  'purge',
  'trash',
  'leave',
]);

function articled(rest: string): string {
  if (!rest) return 'something';
  const first = rest.split(' ')[0] ?? '';
  if (/s$/.test(first) && !/ss$/.test(first)) return rest;
  if (/^(?:a|an|the|my|your|some|all)$/.test(first) || rest.includes(' ')) return rest;
  return `${article(rest)} ${rest}`;
}

/** A tool on someone else's server: "Searched issues in Linear", "Sent a message in Slack". */
function serverTool(server: string | undefined, tool: string): Draft {
  const where = server ? ` in ${server}` : '';
  const human = humanize(tool.replace(/^[a-z0-9-]+_{2,}/i, '')).toLowerCase();
  const [verb = '', ...restWords] = human.split(' ');
  let rest = restWords.join(' ');
  if (verb === 'batch' && restWords[0]) rest = restWords.slice(1).join(' ');
  const plain = (
    said: Words,
    family: ActivityFamily = 'connect',
    effect?: ActivityEffect['kind'],
  ): Draft => ({
    family,
    words: said,
    ...(effect && { effects: [{ kind: effect, text: said.done }] }),
  });
  if (verb === 'lookup') return plain(say('look', `up ${rest || 'something'}${where}`));
  if (LIST_VERBS.has(verb)) return plain(say('list', `${rest || 'things'}${where}`));
  if (SEARCH_VERBS.has(verb)) return plain(say('search', `${rest || ''}${where}`.trim() || 'it'));
  if (LOOK_VERBS.has(verb)) return plain(say('look', `at ${articled(rest)}${where}`));
  if (SEND_VERBS.has(verb)) {
    const said = say(
      verb === 'message' || verb === 'email' ? 'send' : verb,
      `${articled(rest || (verb === 'email' ? 'email' : 'message'))}${where}`,
    );
    return plain(said, 'connect', 'send');
  }
  if (MAKE_VERBS.has(verb) || CHANGE_VERBS.has(verb)) {
    const verbWord = verb === 'new' ? 'create' : verb === 'bulk' ? 'update' : verb;
    const said = say(verbWord, `${articled(rest)}${where}`);
    return plain(said, 'connect', SCHEDULE_HINT.test(human) ? 'schedule' : 'other');
  }
  if (DELETE_VERBS.has(verb))
    return plain(say(verb, `${articled(rest)}${where}`), 'connect', 'delete');
  return plain(say('use', `${human || 'a tool'}${where}`));
}

// ---------------------------------------------------------------- Conch's own tools

const CONCH: Record<string, (input: Input) => Draft> = {
  web_search: searchWebDraft,
  web_fetch: fetchDraft,
  recipe: recipeDraft,
  read_file: (input) => readDraft(input),
  read_document: (input) => readDraft(input, 'document'),
  search_files: (input) => {
    const text = str(input, 'text');
    const name = str(input, 'name');
    const path = str(input, 'path');
    const place = path && path !== '.' ? folderName(path) : 'the files';
    return {
      family: 'explore',
      words: text
        ? say('search', `${place} for ${quote(text)}`)
        : name
          ? say('look', `for files named ${quote(name)}`)
          : say('look', `through ${place}`),
      ...((text ?? name) && { subject: clip(text ?? name ?? '', 200) }),
      finish: (output) => {
        const found = record(parseJson(output));
        const matches = Array.isArray(found.matches) ? found.matches.length : undefined;
        const total = typeof found.total === 'number' ? found.total : matches;
        if (total === undefined) return undefined;
        return {
          outcome: total
            ? plural(total, text ? 'match' : 'file', text ? 'matches' : 'files')
            : text
              ? 'No matches'
              : 'No files',
          handled: true,
        };
      },
    };
  },
  list_attachments: () => ({ family: 'explore', words: say('look', 'at the attachments') }),
  publish_file: (input) => {
    const path = str(input, 'file_path', 'path');
    const name = str(input, 'name') ?? (path ? baseName(path) : 'a file');
    const said = say('offer', `${clip(name, 60)} to download`);
    return {
      family: 'make',
      words: said,
      ...(path && { subject: shortPath(path), chips: [fileChip(path)] }),
      effects: [{ kind: 'publish', text: said.done, ...(path && { target: path.slice(0, 300) }) }],
    };
  },
  file_make: (input) => {
    const named = str(input, 'name') ?? str(input, 'title');
    const format = str(input, 'format')?.replace(/^\./, '').toLowerCase();
    const name = named
      ? withFormat(named, format)
      : format
        ? `a ${format.toUpperCase()}`
        : 'a file';
    return fileDraft(say('make', clip(name, 60)));
  },
  file_convert: (input) => {
    const to = str(input, 'to')?.replace(/^\./, '').toLowerCase();
    const named = str(input, 'name');
    const source = sourceName(str(input, 'source'));
    const rest = named
      ? `${source ?? 'a file'} to ${clip(withFormat(named, to), 60)}`
      : `${source ?? 'a file'}${to ? ` to ${to.toUpperCase()}` : ''}`;
    return fileDraft(say('convert', rest));
  },
  file_combine: (input) => {
    const sources = Array.isArray(input.sources) ? input.sources.length : 0;
    const to = str(input, 'to')?.toLowerCase();
    const named = str(input, 'name');
    const into = named ? clip(withFormat(named, to), 60) : to === 'zip' ? 'a ZIP' : 'one PDF';
    const what = sources ? plural(sources, 'file', 'files') : 'files';
    return fileDraft(say(to === 'zip' ? 'pack' : 'combine', `${what} into ${into}`));
  },
  file_unzip: (input) =>
    fileDraft(say('unpack', clip(sourceName(str(input, 'source')) ?? 'an archive', 60))),
  process_start: (input) => processDraft('start', input),
  process_read: (input) => processDraft('read', input),
  process_write: (input) => processDraft('write', input),
  process_stop: (input) => processDraft('stop', input),
  task_status: () => ({ family: 'delegate', words: say('check', 'on a task') }),
  task_control: (input) => {
    const action = str(input, 'action');
    const verb =
      action === 'stop' || action === 'retry' || action === 'continue' ? action : 'update';
    return { family: 'delegate', words: say(verb, 'a task') };
  },
  delegate: (input) => {
    const parts = Array.isArray(input.parts) ? input.parts.map(record) : [];
    if (parts.length === 1) return helperDraft(str(parts[0] ?? {}, 'title'));
    const titles = parts
      .map((p) => str(p, 'title'))
      .filter(Boolean)
      .join(', ');
    return {
      family: 'delegate',
      words: parts.length ? say('ask', `${count(parts.length)} helpers`) : say('ask', 'helpers'),
      ...(titles && { subject: clip(titles, 300) }),
    };
  },
  start_background_task: (input) => {
    const title = str(input, 'title');
    return {
      family: 'delegate',
      words: say('start', `${title ? quote(title, 50) : 'a task'} in the background`),
      ...(title && { subject: clip(title, 300) }),
    };
  },
  report_result: () => ({ family: 'delegate', words: say('report', 'back') }),
  remember: (input) => {
    const content = str(input, 'content', 'text');
    return {
      family: 'remember',
      words: say('save', 'a memory'),
      ...(content && { subject: clip(oneLine(content), 300) }),
    };
  },
  forget: () => ({ family: 'remember', words: say('forget', 'a memory') }),
  recall: (input) => memorySearch(input),
  search_memory: (input) => memorySearch(input),
  suggest_memory: () => ({ family: 'remember', words: say('suggest', 'a memory') }),
  [PAST_CHATS_TOOLS.search]: (input) => {
    const query = str(input, 'query');
    return {
      family: 'remember',
      words: say('search', query ? `past chats for ${quote(query)}` : 'past chats'),
      ...(query && { subject: clip(query, 300) }),
    };
  },
  [PAST_CHATS_TOOLS.read]: () => ({ family: 'remember', words: say('read', 'a past chat') }),
  update_plan: (input) => todoDraft(input.steps ?? input.plan, ['done', 'completed']),
  exit_plan_mode: () => ({
    family: 'plan',
    words: words('Sharing the plan', 'Shared the plan', 'Couldn’t share the plan'),
  }),
  image_generate: (input) => {
    const prompt = str(input, 'prompt');
    const editing = !!str(input, 'source');
    return {
      family: 'make',
      words: say(editing ? 'edit' : 'make', 'a picture'),
      ...(prompt && { subject: clip(oneLine(prompt), 300) }),
      effects: [{ kind: 'file', text: editing ? 'Edited a picture' : 'Made a picture' }],
      finish: (output) => {
        const made = record(parseJson(output));
        const url = /(https?:\/\/[^\s"')]+\.(?:png|jpe?g|webp|gif)(?:\?[^\s"')]*)?)/i.exec(
          output.slice(0, 20_000),
        )?.[1];
        const name = typeof made.name === 'string' ? made.name : undefined;
        if (/declined|No image request was sent/.test(output.slice(0, 300)))
          return { effects: undefined, outcome: 'Not made' };
        const path = typeof made.path === 'string' ? made.path : undefined;
        return {
          ...(url && {
            chips: [
              {
                kind: 'image' as const,
                label: clip(name ?? 'Picture', 120),
                href: url.slice(0, 2000),
                image: url.slice(0, 2000),
              },
            ],
          }),
          ...(name && {
            effects: [
              {
                kind: 'file' as const,
                text: `${editing ? 'Edited' : 'Made'} ${clip(name, 80)}`,
                ...(path && { target: path.slice(0, 300) }),
              },
            ],
          }),
        };
      },
    };
  },
  image_models: () => ({ family: 'make', words: say('find', 'image models') }),
  artifact_create: (input) => {
    const title = str(input, 'title');
    return {
      family: 'make',
      words: say('make', title ? quote(title, 60) : 'a document'),
      ...(title && { subject: clip(title, 300) }),
    };
  },
  artifact_update: (input) => {
    const note = str(input, 'note');
    return {
      family: 'make',
      words: words('Making changes', 'Made changes', 'Couldn’t make the changes'),
      ...(note && { subject: clip(note, 300) }),
    };
  },
  passwords_find: () => ({ family: 'other', words: say('look', 'in your passwords') }),
  passwords_read: () => ({ family: 'other', words: say('use', 'a saved password') }),
  passwords_request: () => ({ family: 'other', words: say('ask', 'you for a password') }),
  ask: () => ({ family: 'other', words: say('ask', 'you a question') }),
  message_user: () => ({ family: 'connect', words: say('send', 'you a message') }),
  suggest_replies: () => ({ family: 'other', words: say('suggest', 'replies') }),
  offer: (input) => {
    const target = str(input, 'target');
    return {
      family: 'other',
      words: say('suggest', target ? clip(oneLine(target), 40) : 'something'),
    };
  },
  current_time: () => ({ family: 'other', words: say('check', 'the time') }),
  use_skill: (input) => skillDraft(str(input, 'name')),
  list_skills: () => ({ family: 'other', words: say('look', 'at the skills') }),
  find_skills: (input) => {
    const want = str(input, 'words');
    return {
      family: 'other',
      words: say('look', want ? `for skills for ${quote(want)}` : 'for skills'),
    };
  },
  create_routine: (input) => {
    const title = str(input, 'title');
    const said = say('set', `up ${title ? quote(title, 50) : 'a routine'}`);
    return {
      family: 'plan',
      words: said,
      effects: [{ kind: 'schedule', text: said.done, ...(title && { target: clip(title, 300) }) }],
    };
  },
  update_routine: (input) => {
    const paused = str(input, 'status') === 'paused';
    const said = paused ? say('pause', 'a routine') : say('change', 'a routine');
    return { family: 'plan', words: said, effects: [{ kind: 'schedule', text: said.done }] };
  },
  delete_routine: () => ({
    family: 'plan',
    words: say('delete', 'a routine'),
    effects: [{ kind: 'delete', text: 'Deleted a routine' }],
  }),
  list_routines: () => ({ family: 'plan', words: say('look', 'at your routines') }),
  report_outcome: (input) => {
    const summary = str(input, 'summary');
    return {
      family: 'other',
      words: say('report', 'how it went'),
      ...(summary && { subject: clip(oneLine(summary), 300) }),
    };
  },
  google_accounts: () => ({ family: 'connect', words: say('check', 'your Google accounts') }),
  // Making an app (ADR 0061).
  app_guide: () => ({ family: 'make', words: say('read', 'how apps are made') }),
  app_new: (input) => {
    const name = str(input, 'name');
    return {
      family: 'make',
      words: say('start', `${name ? `the ${quote(name, 40)} app` : 'a new app'}`),
    };
  },
  app_write: (input) => {
    const path = str(input, 'path');
    const name = path ? baseName(path) : 'a file';
    if (input.delete === true)
      return { family: 'make', words: say('delete', name), ...(path && { subject: path }) };
    return { family: 'make', words: say('write', name), ...(path && { subject: clip(path, 300) }) };
  },
  app_change: () => ({ family: 'make', words: say('change', 'the app') }),
  app_icon: (input) => ({
    family: 'make',
    words:
      input.remove === true
        ? say('remove', 'the app’s picture')
        : say('choose', 'the app’s picture'),
  }),
  app_read: (input) => {
    const path = str(input, 'path');
    return {
      family: 'make',
      words: path ? say('read', baseName(path)) : say('look', 'at the app’s files'),
    };
  },
  app_check: () => ({ family: 'verify', words: say('check', 'the app') }),
  app_try: (input) => {
    const tool = str(input, 'tool');
    return { family: 'verify', words: say('try', tool ? quote(humanize(tool), 40) : 'the app') };
  },
  app_present: () => ({ family: 'make', words: say('show', 'you the app') }),
  app_edit: () => ({ family: 'make', words: say('open', 'the app to change it') }),
  app_find: (input) => {
    const query = str(input, 'query');
    return {
      family: 'make',
      words: say('look', query ? `for an app for ${quote(query)}` : 'for an app'),
    };
  },
  app_get: (input) => {
    const link = str(input, 'link');
    const host = link ? hostOf(link) : undefined;
    return {
      family: 'make',
      words: say('get', host ? `an app from ${host}` : 'an app'),
      ...(link && { subject: clip(link, 300) }),
    };
  },
  app_share: () => {
    const said = say('share', 'the app');
    return { family: 'make', words: said, effects: [{ kind: 'publish', text: said.done }] };
  },
};

function memorySearch(input: Input): Draft {
  const query = str(input, 'query');
  return {
    family: 'remember',
    words: say('look', query ? `through memories for ${quote(query)}` : 'through memories'),
    ...(query && { subject: clip(query, 300) }),
  };
}

function skillDraft(name: string | undefined): Draft {
  return {
    family: 'other',
    words: say('use', name ? `the ${clip(oneLine(name), 40)} skill` : 'a skill'),
  };
}

const CLICKS: Record<string, [string, string]> = {
  click: ['Clicking', 'Clicked'],
  double: ['Double-clicking', 'Double-clicked'],
  right: ['Right-clicking', 'Right-clicked'],
  hover: ['Pointing at', 'Pointed at'],
  drag: ['Dragging', 'Dragged'],
};

/** The browser's steps (ADR 0014). The server writes their own words; these match them. */
function browserDraft(tool: string, input: Input): Draft | undefined {
  const element = str(input, 'element');
  const el = element ? quote(element, 50) : 'it';
  const b = (said: Words, extra: Partial<Draft> = {}): Draft => ({
    family: 'browse',
    words: said,
    ...extra,
  });
  switch (tool) {
    case 'browser_open': {
      const raw = str(input, 'url') ?? '';
      const looksLikeUrl =
        /^(?:https?:\/\/|www\.)|^[\w-]+(?:\.[\w-]+)+(?:[/:?#]|$)/i.test(raw.trim()) &&
        !/\s/.test(raw.trim());
      if (!looksLikeUrl && raw.trim())
        return b(say('search', `for ${quote(raw)}`), { subject: clip(raw, 300) });
      const host = hostOf(/^\w+:\/\//.test(raw) ? raw : `https://${raw}`);
      const url = /^\w+:\/\//.test(raw) ? raw : `https://${raw}`;
      return b(say('open', host ?? 'a page'), {
        ...(raw && { subject: clip(raw, 300) }),
        ...(host && !isLocal(host) && { chips: [siteChip(url, host)] }),
      });
    }
    case 'browser_read': {
      const find = str(input, 'find');
      return b(
        find
          ? words(`Looking for ${quote(find)}`, `Looked for ${quote(find)}`)
          : words('Reading the page', 'Read the page'),
      );
    }
    case 'browser_click': {
      const [doing, done] = CLICKS[str(input, 'how') ?? 'click'] ??
        CLICKS.click ?? ['Clicking', 'Clicked'];
      return b(words(`${doing} ${el}`, `${done} ${el}`, `Couldn’t click ${el}`));
    }
    case 'browser_click_at':
      return b(words('Clicking on the page', 'Clicked on the page', 'Couldn’t click on the page'));
    case 'browser_type':
      return b(words(`Typing in ${el}`, `Typed in ${el}`, `Couldn’t type in ${el}`));
    case 'browser_press': {
      const key = str(input, 'key');
      return b(say('press', key ? clip(key, 30) : 'a key'));
    }
    case 'browser_select': {
      const option = str(input, 'option');
      return b(say('choose', option ? quote(option, 40) : 'an option'));
    }
    case 'browser_scroll': {
      const direction = str(input, 'direction');
      return b(say('scroll', direction ? clip(direction, 10) : 'the page'));
    }
    case 'browser_back':
      return b(words('Going back', 'Went back', 'Couldn’t go back'));
    case 'browser_screenshot':
      return b(words('Looking at the page', 'Looked at the page', 'Couldn’t look at the page'));
    case 'browser_wait': {
      const text = str(input, 'text');
      return b(text ? say('wait', `for ${quote(text)}`) : say('wait', 'a moment'));
    }
    case 'browser_handoff':
      return b(say('hand', 'the browser to you'), {
        ...(str(input, 'reason') && { subject: clip(str(input, 'reason') ?? '', 300) }),
      });
    case 'browser_passkey':
      return b(
        str(input, 'action') === 'save'
          ? say('save', 'a passkey')
          : say('sign', 'in with a passkey'),
      );
    case 'browser_tabs':
      return b(say('check', 'the tabs'));
    case 'browser_upload': {
      const said = say('upload', 'a file');
      return b(said, { effects: [{ kind: 'send', text: said.done }] });
    }
    default:
      return tool.startsWith('browser_') ? b(say('use', 'the browser')) : undefined;
  }
}

// ---------------------------------------------------------------- the engines' own tools

const ENGINE: Record<string, (input: Input) => Draft> = {
  Bash: bash,
  shell: bash,
  local_shell: bash,
  exec_command: bash,
  run_shell_command: bash,
  execute_command: bash,
  BashOutput: backgroundOutput,
  TaskOutput: backgroundOutput,
  KillShell: () => ({ family: 'run', words: say('stop', 'a command') }),
  KillBash: () => ({ family: 'run', words: say('stop', 'a command') }),
  Read: (input) => readDraft(input),
  NotebookRead: (input) => readDraft(input, 'notebook'),
  read_file: (input) => readDraft(input),
  Write: writeDraft,
  write_file: writeDraft,
  Edit: (input) => editDraft('Edit', input),
  MultiEdit: (input) => editDraft('MultiEdit', input),
  NotebookEdit: (input) => editDraft('NotebookEdit', input),
  apply_patch: (input) => editDraft('Edit', input),
  replace: (input) => editDraft('Edit', input),
  Glob: globDraft,
  glob: globDraft,
  Grep: grepDraft,
  grep: grepDraft,
  search_file_content: grepDraft,
  LS: listDraft,
  list_directory: listDraft,
  WebFetch: fetchDraft,
  web_fetch: fetchDraft,
  WebSearch: searchWebDraft,
  google_web_search: searchWebDraft,
  Task: (input) => helperDraft(str(input, 'description')),
  Agent: (input) => helperDraft(str(input, 'description')),
  TodoWrite: (input) => todoDraft(input.todos, ['completed']),
  TaskCreate: (input) => {
    const subject = str(input, 'subject', 'title');
    return {
      family: 'plan',
      words: say('add', subject ? `${quote(subject, 50)} to the plan` : 'a step to the plan'),
    };
  },
  TaskUpdate: () => ({ family: 'plan', words: say('update', 'the plan') }),
  TaskList: () => ({ family: 'plan', words: say('check', 'the plan') }),
  TaskGet: () => ({ family: 'plan', words: say('check', 'the plan') }),
  ExitPlanMode: () => ({
    family: 'plan',
    words: words('Sharing the plan', 'Shared the plan', 'Couldn’t share the plan'),
  }),
  EnterPlanMode: () => ({ family: 'plan', words: say('start', 'planning') }),
  Skill: (input) => skillDraft(str(input, 'skill', 'command', 'name')),
  SlashCommand: (input) => {
    const command = str(input, 'command');
    return {
      family: 'other',
      words: say('run', command ? clip(oneLine(command), 40) : 'a command'),
    };
  },
  AskUserQuestion: () => ({ family: 'other', words: say('ask', 'you a question') }),
  ToolSearch: () => ({ family: 'other', words: say('look', 'for the right tool') }),
  ListMcpResourcesTool: () => ({ family: 'explore', words: say('list', 'the resources') }),
  ReadMcpResourceTool: (input) => {
    const server = str(input, 'server');
    return {
      family: 'explore',
      words: say('read', server ? `a resource from ${serverName(server)}` : 'a resource'),
    };
  },
  compact: () => ({
    family: 'other',
    words: words('Tidying up the chat so far', 'Tidied up the chat so far'),
  }),
};

const IDE: Record<string, () => Draft> = {
  getDiagnostics: () => ({ family: 'verify', words: say('check', 'for problems') }),
  executeCode: () => ({ family: 'run', words: say('run', 'code in the notebook') }),
};

function draftFor(name: string, input: Input): Draft {
  if (Object.hasOwn(ENGINE, name)) return (ENGINE[name] as (i: Input) => Draft)(input);
  const conch = name.replace(/^mcp__conch__/, '');
  if (Object.hasOwn(APP_TOOL_WORDS, conch)) return appDraft(conch as AppToolName, input);
  if (Object.hasOwn(CONCH, conch)) return (CONCH[conch] as (i: Input) => Draft)(input);
  const browser = browserDraft(conch, input);
  if (browser) return browser;
  if (name.startsWith('mcp__conch__')) return serverTool(undefined, conch);
  const ide = /^mcp__ide__(\w+)$/.exec(name)?.[1];
  if (ide && Object.hasOwn(IDE, ide)) return (IDE[ide] as () => Draft)();
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (mcp) return serverTool(serverName(mcp[1] ?? ''), mcp[2] ?? '');
  const provider = /^provider__(.+?)__(.+)$/.exec(name);
  if (provider)
    return serverTool(
      provider[1] === 'native' ? undefined : serverName(provider[1] ?? ''),
      provider[2] ?? '',
    );
  // ACP names a call by its title ("Read package.json", "Running tests").
  if (/\s/.test(name.trim())) {
    const title = oneLine(name);
    const said = fromPhrase(title) ?? words(clip(title, 90), clip(title, 90));
    return { family: guessFamily(title), words: said };
  }
  const human = humanize(name).toLowerCase();
  return { family: 'other', words: say('use', clip(human || 'a tool', 60)) };
}

/** A family for a free-text title, from its first word. */
function guessFamily(title: string): ActivityFamily {
  const first = (title.split(' ')[0] ?? '').toLowerCase();
  if (
    /^(?:read|reading|list|listing|search|searching|find|finding|look|looking|view|viewing|grep|glob)$/.test(
      first,
    )
  )
    return 'explore';
  if (
    /^(?:edit|editing|write|writing|create|creating|update|updating|delete|deleting|move|moving)$/.test(
      first,
    )
  )
    return 'edit';
  if (/^(?:test|testing|build|building|lint|linting|check|checking)$/.test(first)) return 'verify';
  if (/^(?:fetch|fetching|browse|browsing)$/.test(first)) return 'research';
  if (/^(?:run|running|execute|executing)$/.test(first)) return 'run';
  return 'other';
}

// ---------------------------------------------------------------- the output

function failureOutcome(output: string, code?: number): string {
  const line = failureLine(output);
  if (line) return `Failed: ${line}`;
  const exit = code ?? exitCode(output);
  return exit !== undefined && exit !== 0 ? `Exit code ${exit}` : 'Failed';
}

function finishDraft(draft: Draft, result: ToolResult | undefined): ToolLabel {
  let { words: said, outcome, effects, chips, family, subject } = draft;
  let failed: boolean | undefined;
  // It never ran: said as not done, never as a failure, and it changed nothing.
  const notRun = result?.approval && NOT_RUN[result.approval];
  if (notRun)
    return finalize({
      family,
      words: { ...said, done: notDone(said) },
      outcome: notRun,
      failed: false,
      ...(subject && { subject }),
      ...(chips && { chips }),
    });
  const ended = result && (result.status === 'success' || result.status === 'error');
  if (!ended) effects = undefined;
  if (ended && result) {
    const ok = result.status === 'success';
    const output = typeof result.output === 'string' ? result.output : '';
    const refusal = ok ? undefined : refused(output);
    const own = draft.finish?.(output, result);
    if (own) {
      if (own.words) said = own.words;
      if (own.family) family = own.family;
      if (own.subject) subject = own.subject;
      if (own.outcome) outcome = own.outcome;
      if (own.chips) chips = own.chips;
      if ('effects' in own) effects = own.effects;
      if (own.failed !== undefined) failed = own.failed;
    }
    if (refusal) {
      return finalize({
        family,
        words: { ...said, done: refusal === 'declined' ? notDone(said) : said.tried },
        outcome: refusal === 'declined' ? 'Not allowed' : 'Stopped',
        failed: false,
        ...(subject && { subject }),
        ...(chips && { chips }),
      });
    }
    if (!own?.handled) {
      const reading = readOutput(own?.read ?? draft.read, output, ok);
      // Where the push went and what the commit said, when only the output knew.
      if (draft.push && !draft.push.branch && reading.branch && !draft.described) {
        const pushed = pushAct(reading.branch, !!draft.push.force);
        said =
          draft.read === 'commit-push' || draft.commit
            ? words(
                `Committing and pushing to ${clip(reading.branch, 50)}`,
                `Committed and pushed to ${clip(reading.branch, 50)}`,
                `Couldn’t commit and push to ${clip(reading.branch, 50)}`,
              )
            : pushed.words;
        effects = effects?.map((e) =>
          e.kind === 'push' ? { ...e, text: pushed.words.done, target: reading.branch } : e,
        );
      }
      if (draft.commit && !draft.commit.message && reading.message) {
        const message = reading.message;
        if (!draft.described && !draft.push)
          said = { ...said, done: `Committed ${quote(message, 50)}` };
        effects = effects?.map((e) =>
          e.kind === 'commit'
            ? { ...e, text: `Committed ${quote(message, 80)}`, target: clip(message, 300) }
            : e,
        );
      }
      const wrong = (!ok && !reading.fine) || !!reading.failed;
      failed = failed ?? (wrong ? true : !ok ? false : undefined);
      outcome = reading.outcome ?? (wrong ? failureOutcome(output) : outcome);
      if (wrong || reading.nothing) effects = undefined;
    } else if (!ok) {
      failed = failed ?? true;
      outcome ??= failureOutcome(output);
      effects = undefined;
    }
    if (failed && family !== 'verify') said = { ...said, done: said.tried };
    if (!ok && failed === undefined) failed = true;
  }
  return finalize({
    family,
    words: said,
    ...(outcome && { outcome }),
    ...(subject && { subject }),
    ...(failed !== undefined && { failed }),
    ...(effects?.length && { effects }),
    ...(chips?.length && { chips }),
  });
}

/** Within the wire's limits, every time: short, one line, sentence case, no trailing period. */
function finalize(label: {
  family: ActivityFamily;
  words: Words;
  outcome?: string;
  subject?: string;
  failed?: boolean;
  effects?: ActivityEffect[];
  chips?: ActivityChip[];
}): ToolLabel {
  const line = (text: string, max: number) => clip(oneLine(text).replace(/(?<!\.)\.$/, ''), max);
  const doing = cap(line(label.words.doing, 120)) || 'Working';
  const done = cap(line(label.words.done, 120)) || 'Done';
  const effects = (label.effects ?? []).slice(0, 20).map((e) => ({
    kind: e.kind,
    text: cap(line(e.text, 200)) || 'Changed something',
    ...(e.target && { target: clip(e.target, 300) }),
    ...(e.undo && { undo: e.undo }),
  }));
  const chips = (label.chips ?? []).slice(0, 12).flatMap((c) => {
    const text = line(c.label, 120);
    if (!text) return [];
    return [
      {
        kind: c.kind,
        label: text,
        ...(c.href && { href: c.href.slice(0, 2000) }),
        ...(c.image && c.image.length <= 200_000 && { image: c.image }),
      },
    ];
  });
  return {
    family: label.family,
    doing,
    done,
    ...(label.outcome && line(label.outcome, 100) && { outcome: cap(line(label.outcome, 100)) }),
    ...(label.subject && oneLine(label.subject) && { subject: clip(oneLine(label.subject), 300) }),
    ...(label.failed !== undefined && { failed: label.failed }),
    ...(effects.length && { effects }),
    ...(chips.length && { chips }),
  };
}

/**
 * One tool call in plain words. `input` as the engine reported it; `result`
 * once it has ended (or a snapshot while it runs). Pure, and never throws.
 */
export function describeTool(name: string, input: unknown, result?: ToolResult): ToolLabel {
  const toolName = typeof name === 'string' ? name.slice(0, 300) : '';
  try {
    return finishDraft(draftFor(toolName, record(input)), result);
  } catch {
    const human = clip(humanize(toolName).toLowerCase() || 'a tool', 60);
    return {
      family: 'other',
      doing: `Using ${human}`,
      done: `Used ${human}`,
      ...(result?.status === 'error' && { failed: true }),
    };
  }
}
