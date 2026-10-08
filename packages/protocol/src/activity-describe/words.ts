/**
 * The small word tools the rules write with (ADR 0103): verbs turned into
 * "Running" and "Ran", text cut short at a word, paths and addresses said
 * the short way. Pure, and safe on anything.
 */

/** What a step says while it runs, once it's done, and when it couldn't. */
export interface Words {
  doing: string;
  done: string;
  tried: string;
}

/** Past tenses English doesn't build with -ed. */
const PAST: Record<string, string> = {
  be: 'was',
  become: 'became',
  begin: 'began',
  bind: 'bound',
  break: 'broke',
  bring: 'brought',
  build: 'built',
  buy: 'bought',
  cast: 'cast',
  catch: 'caught',
  choose: 'chose',
  come: 'came',
  cost: 'cost',
  cut: 'cut',
  deal: 'dealt',
  dig: 'dug',
  do: 'did',
  draw: 'drew',
  drive: 'drove',
  eat: 'ate',
  fall: 'fell',
  feed: 'fed',
  feel: 'felt',
  fight: 'fought',
  find: 'found',
  fit: 'fit',
  fly: 'flew',
  forget: 'forgot',
  freeze: 'froze',
  get: 'got',
  give: 'gave',
  go: 'went',
  grow: 'grew',
  have: 'had',
  hear: 'heard',
  hide: 'hid',
  hit: 'hit',
  hold: 'held',
  hurt: 'hurt',
  keep: 'kept',
  know: 'knew',
  lay: 'laid',
  lead: 'led',
  leave: 'left',
  lend: 'lent',
  let: 'let',
  light: 'lit',
  lose: 'lost',
  make: 'made',
  mean: 'meant',
  meet: 'met',
  pay: 'paid',
  put: 'put',
  quit: 'quit',
  read: 'read',
  ride: 'rode',
  ring: 'rang',
  rise: 'rose',
  run: 'ran',
  say: 'said',
  see: 'saw',
  seek: 'sought',
  sell: 'sold',
  send: 'sent',
  set: 'set',
  shake: 'shook',
  shoot: 'shot',
  show: 'showed',
  shut: 'shut',
  sing: 'sang',
  sink: 'sank',
  sit: 'sat',
  sleep: 'slept',
  slide: 'slid',
  speak: 'spoke',
  spend: 'spent',
  spin: 'spun',
  split: 'split',
  spread: 'spread',
  stand: 'stood',
  steal: 'stole',
  stick: 'stuck',
  strike: 'struck',
  swim: 'swam',
  swing: 'swung',
  take: 'took',
  teach: 'taught',
  tear: 'tore',
  tell: 'told',
  think: 'thought',
  throw: 'threw',
  understand: 'understood',
  wake: 'woke',
  wear: 'wore',
  win: 'won',
  wind: 'wound',
  write: 'wrote',
};

/** Prefixes that keep the verb's own past: rebuild, rewrite, undo, overwrite. */
const PREFIXES = ['re', 'un', 'over', 'under', 'out', 'pre', 'with'];
/** Words that look prefixed but aren't: relay is relayed, not "relaid". */
const NOT_PREFIXED = new Set(['relay', 'delay', 'outlay', 'undergo', 'reset', 'preset']);

/** Longer verbs whose stress falls last, so their last letter doubles. */
const DOUBLES = new Set([
  'admit',
  'begin',
  'commit',
  'compel',
  'control',
  'debug',
  'emit',
  'equip',
  'expel',
  'format',
  'forget',
  'input',
  'kidnap',
  'occur',
  'omit',
  'output',
  'overlap',
  'patrol',
  'permit',
  'prefer',
  'program',
  'propel',
  'quit',
  'rebut',
  'recur',
  'refer',
  'reformat',
  'regret',
  'rerun',
  'submit',
  'transmit',
  'unpin',
  'unplug',
  'untag',
  'unwrap',
  'unzip',
  'upset',
]);

const VOWEL = /[aeiou]/;

function vowelGroups(word: string): number {
  return (word.match(/[aeiou]+/g) ?? []).length || (word.includes('y') ? 1 : 0);
}

/** stop → stopp-, commit → committ-, but edit → edit-, fix → fix-. */
function doubles(word: string): boolean {
  if (DOUBLES.has(word)) return true;
  if (word.length < 3 || vowelGroups(word) !== 1) return false;
  const [a, b, c] = word.slice(-3);
  return !!a && !!b && !!c && !VOWEL.test(a) && VOWEL.test(b) && !/[aeiouwxy]/.test(c);
}

function irregularPast(word: string): string | undefined {
  if (Object.hasOwn(PAST, word)) return PAST[word];
  if (NOT_PREFIXED.has(word)) return undefined;
  for (const prefix of PREFIXES) {
    const rest = word.slice(prefix.length);
    if (word.startsWith(prefix) && rest.length > 1 && Object.hasOwn(PAST, rest))
      return prefix + PAST[rest];
  }
  return undefined;
}

function ingOf(word: string): string {
  if (word === 'be') return 'being';
  if (word.endsWith('ie')) return `${word.slice(0, -2)}ying`;
  if (/(?:ee|ye|oe)$/.test(word)) return `${word}ing`;
  if (word.endsWith('e') && word.length > 2) return `${word.slice(0, -1)}ing`;
  if (word.endsWith('ic')) return `${word}king`;
  if (doubles(word)) return `${word}${word.at(-1)}ing`;
  return `${word}ing`;
}

function pastOf(word: string): string {
  const irregular = irregularPast(word);
  if (irregular) return irregular;
  if (word.endsWith('e')) return `${word}d`;
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ied`;
  if (word.endsWith('ic')) return `${word}ked`;
  if (doubles(word)) return `${word}${word.at(-1)}ed`;
  return `${word}ed`;
}

/** Inflects the last part of a hyphenated verb: force-push → force-pushing. */
function inflect(verb: string, how: (word: string) => string): string {
  const lower = verb.toLowerCase();
  const cut = lower.lastIndexOf('-');
  const head = cut >= 0 ? verb.slice(0, cut + 1) : '';
  const word = cut >= 0 ? lower.slice(cut + 1) : lower;
  const made = how(word);
  // Keep the writer's capital: "Run" → "Running".
  const capital = verb.charAt(head.length) !== verb.charAt(head.length).toLowerCase();
  return head + (capital ? made.charAt(0).toUpperCase() + made.slice(1) : made);
}

/** "run" → "running". */
export function ing(verb: string): string {
  return inflect(verb, ingOf);
}

/** "run" → "ran". */
export function past(verb: string): string {
  return inflect(verb, pastOf);
}

/** "running" → "run", "making" → "make", "writing" → "write". */
export function baseOfIng(word: string): string {
  const lower = word.toLowerCase();
  const stem = lower.slice(0, -3);
  if (/(.)\1$/.test(stem) && ingOf(stem.slice(0, -1)) === lower) return stem.slice(0, -1);
  if (stem.endsWith('y') && ingOf(`${stem.slice(0, -1)}ie`) === lower && stem.length <= 2)
    return `${stem.slice(0, -1)}ie`;
  if (ingOf(stem) === lower) return stem;
  if (ingOf(`${stem}e`) === lower) return `${stem}e`;
  return stem;
}

/** Sentence case: the first letter up, the rest as written. */
export function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Read" + "Transcript.tsx": the three ways to say it. */
export function say(verb: string, rest = ''): Words {
  const tail = rest ? ` ${rest}` : '';
  return {
    doing: cap(`${ing(verb)}${tail}`),
    done: cap(`${past(verb)}${tail}`),
    tried: `Couldn’t ${verb.toLowerCase()}${tail}`,
  };
}

/**
 * What a step says when it never ran (you said no, a rule did, or nobody
 * answered): the verb negated, "Didn’t run the tests", "Didn’t send an email",
 * read from the words it would have said.
 */
export function notDone(said: Words): string {
  const couldnt = /^Couldn[’']t\s+(.+)$/.exec(said.tried);
  if (couldnt?.[1]) return `Didn’t ${couldnt[1]}`;
  const doing = said.doing.trim();
  const verb = /^(\S+ing)\b(.*)$/i.exec(doing);
  if (verb?.[1] && !NOT_ING.has(verb[1].toLowerCase()))
    return `Didn’t ${inflect(verb[1], baseOfIng).toLowerCase()}${verb[2] ?? ''}`;
  return `Didn’t go ahead: ${said.done.charAt(0).toLowerCase()}${said.done.slice(1)}`;
}

/** Words written out already, for what a verb can't say. */
export function words(doing: string, done: string, tried?: string): Words {
  return { doing, done, tried: tried ?? done };
}

/** Words that never start a command's own description, so it isn't one. */
const NOT_VERBS = new Set([
  'a',
  'an',
  'the',
  'this',
  'that',
  'these',
  'those',
  'my',
  'your',
  'our',
  'its',
  'all',
  'some',
  'new',
  'quick',
  'final',
  'simple',
  'full',
  'main',
  'current',
  'next',
  'last',
  'first',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'node',
  'python',
  'python3',
  'docker',
  'cargo',
  'need',
  'project',
  'file',
  'code',
  'command',
  'script',
  'shell',
  'bash',
  'to',
  'for',
  'with',
  'and',
  'or',
  'if',
  'not',
  'no',
  'because',
]);

const NOT_ING = new Set(['thing', 'string', 'something', 'nothing', 'everything', 'anything']);

/**
 * A command's own description ("Run unit tests", the way Claude Code writes
 * them) said both ways, or undefined when it doesn't start with a verb.
 */
export function fromPhrase(text: string, max = 90): Words | undefined {
  const phrase = clip(trimEnd(oneLine(text), '.:;!'), max);
  const match = /^([A-Za-z][A-Za-z'-]*)(\s+.*)?$/.exec(phrase);
  if (!match?.[1]) return undefined;
  const first = match[1];
  const rest = (match[2] ?? '').trim();
  const lower = first.toLowerCase();
  if (NOT_VERBS.has(lower)) return undefined;
  if (lower.endsWith('ing') && lower.length > 4 && !NOT_ING.has(lower)) {
    const base = baseOfIng(lower);
    return {
      doing: cap(phrase),
      done: cap(`${pastOf(base)}${rest ? ` ${rest}` : ''}`),
      tried: `Couldn’t ${base}${rest ? ` ${rest}` : ''}`,
    };
  }
  // "Tests the parser", "Changes": a noun or a third person, not an instruction.
  if (/[^s]s$/.test(lower) && lower !== 'focus' && lower !== 'process') return undefined;
  if (
    /ed$/.test(lower) &&
    lower.length > 4 &&
    !['embed', 'need', 'feed', 'seed', 'speed', 'shred'].includes(lower)
  ) {
    // Already past: "Updated the config". Say it running the best we can.
    return undefined;
  }
  return say(lower, rest);
}

/** All on one line, spaces squeezed, no control characters. */
export function oneLine(text: string): string {
  return (
    text
      .slice(0, 4000)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Cut at a word near `max`, with an ellipsis; never splits a surrogate pair. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(' ');
  if (space > max * 0.6) cut = cut.slice(0, space);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return `${trimEnd(cut, ',;:.-', true)}…`;
}

/**
 * Path-ish text is cut to this before anything looks at it: a path, a
 * folder or a quoted word is never longer, and nothing here grows with it.
 */
export const PATH_MAX = 4_096;

/**
 * `text` without any of `chars` (and white space, with `space`) at its end.
 * An index loop, not `/[…]+$/`: a regex anchored at the end only by `$`
 * tries every start, quadratic on a long run that isn't at the end.
 */
export function trimEnd(text: string, chars: string, space = false): string {
  let end = text.length;
  while (end > 0) {
    const ch = text.charAt(end - 1);
    if (!chars.includes(ch) && !(space && /\s/.test(ch))) break;
    end--;
  }
  return text.slice(0, end);
}

/** `text` without any of `chars` at its start. */
export function trimStart(text: string, chars: string): string {
  let start = 0;
  while (start < text.length && chars.includes(text.charAt(start))) start++;
  return text.slice(start);
}

/** “like this”, one line, short. */
export function quote(text: string, max = 40): string {
  const marks = `"'“”‘’\``;
  return `“${clip(trimEnd(trimStart(oneLine(text), marks), marks), max)}”`;
}

/** 7388 → "7,388". */
export function count(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "3 files", "1 file". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** The last part of a path: `/home/x/repo/src/Transcript.tsx` → `Transcript.tsx`. */
export function baseName(path: string): string {
  const trimmed = trimEnd(unquote(path), '/\\');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return clip((cut >= 0 ? trimmed.slice(cut + 1) : trimmed) || trimmed || path, 60);
}

function unquote(path: string): string {
  return trimEnd(trimStart(path.slice(0, PATH_MAX).trim(), `"'\``), `"'\``);
}

/**
 * A path the short way, for a subject: the last few parts, without the home
 * folder or the project's long road to it. `.` and empty are the folder itself.
 */
export function shortPath(path: string, keep = 3): string {
  const clean = trimEnd(unquote(path).replace(/\\/g, '/'), '/');
  if (!clean || clean === '.') return '.';
  if (clean === '~') return '~';
  const parts = clean.replace(/^\.\//, '').split('/').filter(Boolean);
  if (parts.length <= keep) return clip(clean.replace(/^\.\//, ''), 120);
  return clip(parts.slice(-keep).join('/'), 120);
}

/** A folder said in words: "src", "the folder", "your home folder". */
export function folderName(path: string | undefined): string {
  const bare = unquote(path ?? '');
  const clean = trimEnd(bare, '/');
  if (bare && !clean) return 'the whole computer';
  if (!clean || clean === '.' || clean === './') return 'the folder';
  if (clean === '..') return 'the folder above';
  if (clean === '~' || /^(?:\/Users|\/home)\/[^/]+$/.test(clean)) return 'your home folder';
  if (clean === '/' || clean === '') return 'the whole computer';
  if (/[*?{[]/.test(clean)) return quote(clean, 40);
  return baseName(clean);
}

/** The host of an address, without `www.`, or undefined when it isn't one. */
export function hostOf(url: string): string | undefined {
  const match =
    /^(?:[a-z][a-z0-9+.-]*:)?\/\/(?:[^@/?#\s]*@)?(\[[^\]\s]+\]|[^/:?#\s]+)(?::(\d+))?/i.exec(
      url.trim(),
    );
  const host = match?.[1]
    ?.toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (!host) return undefined;
  const local = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])$/.test(host);
  return local && match?.[2] ? `${host}:${match[2]}` : host;
}

/** Whether a host is this computer. */
export function isLocal(host: string): boolean {
  return /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?$/.test(host);
}

/**
 * A site's small picture, from the gateway (`GET /api/favicon`), which asks
 * the site itself: a third-party favicon service would learn every site the
 * assistant visits. Undefined for this computer, addresses and ports, which
 * have no public icon (the chip shows a monogram).
 */
export function favicon(host: string): string | undefined {
  if (isLocal(host) || /[:[\]]/.test(host) || /^[\d.]+$/.test(host)) return undefined;
  return `/api/favicon?host=${encodeURIComponent(host)}`;
}

/** search_issues, searchIssues, search-issues → "Search issues". */
export function humanize(name: string): string {
  const spaced = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return cap(spaced);
}

/** "a" or "an", for a word. */
export function article(word: string): string {
  return /^(?:[aeio]|u(?![sn]i|ni))/i.test(word) && !/^(?:one|eu)/i.test(word) ? 'an' : 'a';
}
