/**
 * The quality bar (ADR 0061 §4): the gate a draft passes before it can be
 * offered, and the safety half a package from anyone else passes before it
 * can be added. Problems block; warnings don't.
 *
 * - **Safety** (every package): it reads; its tools load and list in the
 *   sealed runtime; it imports only its own files and reaches only the
 *   hosts on its card; its pages load nothing from the web and never send
 *   the page elsewhere; its skills pass the skill scan; nothing the vault
 *   would hide is written in it; its picture, if any, is the still PNG, JPEG
 *   or WebP its name says (read with the package, `picture.ts`, ADR 0090).
 * - **Quality** (what Conch makes): every tool has a title, a description
 *   that says when to use it, an object input schema, an honest `changes`,
 *   and has been tried; pages have a language, a title, a viewport, labels,
 *   the page kit's colours and fit a phone.
 *
 * Every message names the file (and the line where it can) and says what to
 * change, so the model that wrote the app can fix it.
 */
import { ConchAppToolName, ConchAppTool, isAppPicture, type AppCheckItem } from '@conch/protocol';

import { navigates } from '../artifacts/frame';
import { scanText } from '../skills/scan';
import { appHash, readFiles } from './package';
import { pictureOf } from './picture';
import type { AppPackage, AppRuntime, AppToolDefinition, CheckApp } from './types';

const MAX_TOOLS = 24;
const WRITE_WORDS = new Set(['add', 'set', 'delete', 'update', 'log', 'create', 'send', 'remove']);

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

const quote = (text: string) => `“${text.slice(0, 80)}”`;

// ── Reading code ──────────────────────────────────────────────────────────

/** `import './x'`, or `import … from` / `export … from` (never `export const … = …`). */
const STATIC_IMPORT =
  /^[ \t]*(?:import\s*(['"])([^'"\n]+)\1|(?:import|export)\b[^'"`;=()]*?\bfrom\s*(['"])([^'"\n]+)\3)/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*([^)]*?)\s*[,)]/g;
const URL_LITERAL = /(['"`])(https?):\/\/([^/'"`\s?#]*)/gi;

function codeProblems(
  file: string,
  text: string,
  reaches: ReadonlySet<string>,
  problems: AppCheckItem[],
  warnings: AppCheckItem[],
) {
  const at = (index: number) => ({ file, line: lineAt(text, index) });
  const local = (spec: string) => spec.startsWith('./') || spec.startsWith('../');
  for (const match of text.matchAll(STATIC_IMPORT)) {
    const spec = match[2] ?? match[4] ?? '';
    if (!local(spec))
      problems.push({
        message: `${file} imports ${quote(spec)}. A tools module only imports the app’s own files, like ./helpers.mjs: write what it needs there, and use app.fetch and app.data instead of Node’s modules.`,
        ...at(match.index),
      });
  }
  for (const match of text.matchAll(DYNAMIC_IMPORT)) {
    const arg = match[1] ?? '';
    const literal = /^(['"`])([^'"`$]*)\1$/.exec(arg);
    if (!literal || !local(literal[2] ?? ''))
      problems.push({
        message: literal
          ? `${file} imports ${quote(literal[2] ?? '')}. A tools module only imports the app’s own files, like ./helpers.mjs.`
          : `${file} imports something it works out while running. Import the app’s own files by name, like import('./helpers.mjs').`,
        ...at(match.index),
      });
  }
  const refused: [RegExp, string][] = [
    [
      /\brequire\s*\(/g,
      'uses require(), which tools modules don’t have: use import with ./ paths.',
    ],
    [
      /\bprocess\s*\.\s*(?:getBuiltinModule|binding|_linkedBinding|dlopen)\b/g,
      'reaches into Node’s internals, which the sealed runtime refuses: use app.data and app.fetch.',
    ],
    [/\beval\s*\(/g, 'uses eval(), which the sealed runtime refuses: write the code out.'],
    [
      /\bnew\s+Function\s*\(/g,
      'uses new Function(), which the sealed runtime refuses: write the code out.',
    ],
    [
      /(?<![.\w$])fetch\s*\(/g,
      'calls fetch(): use app.fetch(…) instead, which Conch makes for the app.',
    ],
    [/\b(?:WebSocket|EventSource)\b/g, 'uses a socket, which apps can’t open: use app.fetch.'],
  ];
  for (const [pattern, words] of refused) {
    const match = pattern.exec(text);
    if (match) problems.push({ message: `${file} ${words}`, ...at(match.index) });
  }
  for (const match of text.matchAll(URL_LITERAL)) {
    const scheme = (match[2] ?? '').toLowerCase();
    const host = (match[3] ?? '').toLowerCase();
    if (host.includes('${')) {
      warnings.push({
        message: `${file} builds a web address from parts. Write the host out (like https://${[...reaches][0] ?? 'api.example.com'}/…), so the check can see it’s one the app may reach.`,
        ...at(match.index),
      });
      continue;
    }
    const name = host.replace(/:\d+$/, '');
    if (scheme === 'http')
      problems.push({
        message: `${file} uses http://${host}. Apps only reach the web over https: use https://${name}.`,
        ...at(match.index),
      });
    else if (name && !reaches.has(name))
      problems.push({
        message: `${file} reaches ${name}, which isn’t in “reaches” in conch-app.json. Add it there (the person sees it on the card), or take it out.`,
        ...at(match.index),
      });
  }
}

// ── Reading pages ─────────────────────────────────────────────────────────

const TAG = /<\s*([a-z][a-z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const RESOURCE_ATTR =
  /\b(src|href|srcset|poster|data|action|formaction|background|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const EXTERNAL = /^\s*(?:https?:)?\/\//i;
const OUT_LINK = /<\s*a\b(?:[^>"']|"[^"]*"|'[^']*')*\bhref\s*=\s*["']?\s*(?:https?:|\/\/)[^>]*>/gi;

/** CSS a page writes: its `<style>` blocks and `style=""` attributes, with where each starts. */
function cssOf(html: string): { css: string; start: number }[] {
  const out: { css: string; start: number }[] = [];
  for (const m of html.matchAll(/<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi))
    out.push({ css: m[1] ?? '', start: m.index + m[0].indexOf(m[1] ?? '') });
  for (const m of html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const css = m[1] ?? m[2] ?? '';
    out.push({ css: `x{${css}}`, start: m.index });
  }
  return out;
}

/** `var(--…)` (and its fallback) taken out, so only colours typed outside the tokens are left. */
function withoutVars(css: string): string {
  let out = css;
  for (let i = 0; i < 5; i++) {
    const next = out.replace(/var\(\s*--[^()]*(?:\([^()]*\)[^()]*)*\)/gi, (m) =>
      ' '.repeat(m.length),
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

const DECLARATION = /([a-z-]+)\s*:\s*([^;{}]*)(?=[;}])/gi;

function pageProblems(
  file: string,
  html: string,
  quality: boolean,
  problems: AppCheckItem[],
  warnings: AppCheckItem[],
) {
  const at = (index: number) => ({ file, line: lineAt(html, index) });
  if (
    quality &&
    /conch\.call\s*\(/.test(html) &&
    !/conch\.observe\s*\(/.test(html) &&
    !/\b(?:show|load|refresh|render)\s*\(\s*\)\s*;/.test(html)
  )
    warnings.push({
      file,
      message:
        'Load useful read data when this page opens; prefer conch.observe for saved results, refresh and error states.',
    });
  let linksOut = false;
  for (const tag of html.matchAll(TAG)) {
    const name = (tag[1] ?? '').toLowerCase();
    for (const attr of (tag[2] ?? '').matchAll(RESOURCE_ATTR)) {
      const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
      const external =
        (attr[1] ?? '').toLowerCase() === 'srcset'
          ? value.split(',').some((part) => EXTERNAL.test(part))
          : EXTERNAL.test(value);
      if (!external) continue;
      if (name === 'a') linksOut = true;
      else
        problems.push({
          message: `${file} loads ${quote(value.trim())} from the web. Pages are sealed and can’t: put it in the app’s folder, or write it into the page.`,
          ...at(tag.index),
        });
    }
  }
  for (const { css, start } of cssOf(html)) {
    const external =
      /(?:url\(\s*["']?\s*(?:https?:)?\/\/|@import\s+(?:url\()?\s*["']?\s*(?:https?:)?\/\/)/i.exec(
        css,
      );
    if (external)
      problems.push({
        message: `${file} loads a style or picture from the web. Pages are sealed and can’t: write it into the page.`,
        ...at(start + external.index),
      });
  }
  // Links out are the panel's to ask about; anything else that moves the page is refused.
  const withoutLinks = html.replace(OUT_LINK, (m) => ' '.repeat(m.length));
  if (navigates(withoutLinks)) {
    const lines = withoutLinks.split('\n');
    const line = lines.findIndex((l) => navigates(l)) + 1;
    problems.push({
      message: `${file} sends the page somewhere else (a script that changes location, opens a window, a form or a frame). Pages are sealed and can’t: show links as <a href="https://…">, and the panel asks the person before opening one.`,
      file,
      ...(line > 0 && { line }),
    });
  }
  if (linksOut)
    warnings.push({
      message: `${file} links out to the web. That works, but the panel asks the person before opening each link.`,
      file,
    });
  if (!quality) return;

  if (!/<\s*html\b[^>]*\blang\s*=\s*["']?[a-z]/i.test(html))
    warnings.push({ message: `${file} has no language: start it with <html lang="en">.`, file });
  if (!/<\s*title\b[^>]*>\s*\S[\s\S]*?<\s*\/\s*title\s*>/i.test(html))
    warnings.push({ message: `${file} has no <title>: give it one, like the page’s name.`, file });
  if (!/<\s*meta\b[^>]*\bname\s*=\s*["']?viewport/i.test(html))
    warnings.push({
      message: `${file} has no viewport: add <meta name="viewport" content="width=device-width, initial-scale=1"> so it reads well on a phone.`,
      file,
    });

  const labelled = new Set(
    [...html.matchAll(/<\s*label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]),
  );
  const labelSpans = [...html.matchAll(/<\s*label\b[\s\S]*?<\s*\/\s*label\s*>/gi)].map((m) => [
    m.index,
    m.index + m[0].length,
  ]);
  for (const field of html.matchAll(
    /<\s*(input|select|textarea)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi,
  )) {
    const attrs = field[2] ?? '';
    const type = /\btype\s*=\s*["']?([a-z]+)/i.exec(attrs)?.[1]?.toLowerCase();
    if (
      field[1]?.toLowerCase() === 'input' &&
      type &&
      ['hidden', 'submit', 'button', 'reset', 'image'].includes(type)
    )
      continue;
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    const named =
      /\baria-label(?:ledby)?\s*=\s*["']?\s*[^"'\s>]/i.test(attrs) ||
      /\btitle\s*=\s*["']?\s*[^"'\s>]/i.test(attrs) ||
      (id !== undefined && labelled.has(id)) ||
      labelSpans.some(([from = 0, to = 0]) => field.index > from && field.index < to);
    if (!named)
      warnings.push({
        message: `${file} has a field with no label. Put it inside a <label>, or give it a <label for="…">, so everyone can tell what it’s for.`,
        ...at(field.index),
      });
  }

  let colour = false;
  let wide = false;
  for (const { css, start } of cssOf(html)) {
    const plain = withoutVars(css);
    for (const d of plain.matchAll(DECLARATION)) {
      const property = (d[1] ?? '').toLowerCase();
      const value = d[2] ?? '';
      if (!colour && /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\s*\(/i.test(value)) {
        colour = true;
        warnings.push({
          message: `${file} types its own colours (${value.trim().slice(0, 40)}). Use the page kit’s colours, like var(--nc-accent-9), so it follows light and dark.`,
          ...at(start + d.index),
        });
      }
      const px = /(?:^|\s)(\d+(?:\.\d+)?)px\b/.exec(value);
      if (!wide && /^(?:min-)?width$|^flex-basis$/.test(property) && px && Number(px[1]) > 480) {
        wide = true;
        warnings.push({
          message: `${file} is fixed at ${px[1]}px wide, wider than a phone. Use max-width or a percentage instead.`,
          ...at(start + d.index),
        });
      }
    }
  }
  const attrWidth = /<\s*(?:img|table|div|canvas|svg|video)\b[^>]*\bwidth\s*=\s*["']?(\d+)(?!%)/gi;
  for (const m of html.matchAll(attrWidth))
    if (!wide && Number(m[1]) > 480) {
      wide = true;
      warnings.push({
        message: `${file} is fixed at ${m[1]}px wide, wider than a phone. Use max-width or a percentage instead.`,
        ...at(m.index),
      });
    }
}

// ── The tools, as the sealed runtime read them ────────────────────────────

function toolProblems(
  definitions: AppToolDefinition[],
  quality: boolean,
  tried: ReadonlySet<string>,
  file: string,
  problems: AppCheckItem[],
  warnings: AppCheckItem[],
): ConchAppTool[] {
  const tools: ConchAppTool[] = [];
  if (quality && definitions.length > MAX_TOOLS)
    problems.push({
      message: `This app has ${definitions.length} tools; an app can have at most ${MAX_TOOLS}. Join the ones that do nearly the same thing.`,
      file,
    });
  for (const d of definitions) {
    const name = quote(d.name);
    const before = problems.length;
    if (!ConchAppToolName.safeParse(d.name).success)
      problems.push({
        message: `The tool ${name} has a name Conch can’t use: lowercase letters, numbers and underscores, starting with a letter, at most 20 characters (like log_watering).`,
        file,
      });
    if (!d.runs)
      problems.push({
        message: `The tool ${name} has no run function: add run(input, app).`,
        file,
      });
    if ((d.title ?? '').length > 80)
      problems.push({
        message: `The tool ${name} has a title over 80 characters: make it a few words.`,
        file,
      });
    if ((d.description ?? '').length > 1000)
      problems.push({
        message: `The tool ${name} has a description over 1,000 characters: shorten it.`,
        file,
      });
    if (
      d.cache !== undefined &&
      (d.changes === true || !ConchAppTool.shape.cache.safeParse(d.cache).success)
    )
      problems.push({
        file,
        message: `The tool ${name} needs cache: { maxAge: 15–86400 } and must be read-only. Changing tools cannot be cached.`,
      });
    if (quality) {
      if (!d.title?.trim())
        problems.push({
          message: `Give the tool ${name} a title: a few words for people, like “Log watering”.`,
          file,
        });
      if ((d.description ?? '').trim().length < 20)
        problems.push({
          message: `The tool ${name} needs a description of at least 20 characters: what it does, and “Use when …”.`,
          file,
        });
      const input = d.input as { type?: unknown } | null;
      if (!input || typeof input !== 'object' || Array.isArray(input) || input.type !== 'object')
        problems.push({
          message: `The tool ${name} needs an input schema with type: 'object' (for no input, { type: 'object', properties: {} }).`,
          file,
        });
      if (d.description && !/\buse (?:it )?when\b/i.test(d.description))
        warnings.push({
          message: `The tool ${name}’s description doesn’t say when to use it. Add “Use when …”, so the assistant reaches for it at the right time.`,
          file,
        });
      if (d.changes !== true && d.name.split('_').some((word) => WRITE_WORDS.has(word)))
        warnings.push({
          message: `The tool ${name} sounds like it changes something. If it does, add changes: true, so the person is asked before it runs.`,
          file,
        });
      if (problems.length === before && !tried.has(d.name))
        problems.push({
          message: `Try \`${d.name}\` with app_try before offering the app.`,
          file,
        });
    }
    const parsed = ConchAppTool.safeParse({
      name: d.name,
      title: d.title ?? '',
      description: d.description ?? '',
      changes: d.changes === true,
      ...(d.cache === undefined ? {} : { cache: d.cache }),
    });
    if (parsed.success && d.runs) tools.push(parsed.data);
  }
  return tools;
}

/** The tools module, loaded and listed in the sealed runtime: its definitions, or why it didn't. */
async function loadTools(
  app: AppPackage,
  runtime: (app: AppPackage) => AppRuntime,
): Promise<AppToolDefinition[] | string> {
  const sealed = runtime(app);
  try {
    if (sealed.definitions) return await sealed.definitions();
    return (await sealed.list()).map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      input: { type: 'object' },
      changes: t.changes,
      runs: true,
    }));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await sealed.stop().catch(() => undefined);
  }
}

export const checkApp: CheckApp = async (files, options) => {
  const at = options.now?.() ?? Date.now();
  const quality = !options.safetyOnly;
  const read = readFiles(files);
  const hash = appHash(files);
  const tried = [...(options.tried ?? [])];
  if (!read.ok)
    return { ok: false, hash, at, problems: read.problems, warnings: [], tools: [], tried };
  const { app } = read;
  const { manifest } = app;
  const problems: AppCheckItem[] = [];
  const warnings: AppCheckItem[] = [];
  const reaches = new Set(manifest.reaches);
  const pages = new Set(manifest.pages.map((p) => p.file));

  for (const [file, bytes] of app.files) {
    // The picture was read byte by byte with the package (`readFiles`); it isn't words.
    if (isAppPicture(file)) continue;
    const text = bytes.toString('utf8');
    if (/\.m?js$/i.test(file)) codeProblems(file, text, reaches, problems, warnings);
    if (/\.html$/i.test(file))
      pageProblems(file, text, quality && pages.has(file), problems, warnings);
    if (/^skills\/[^/]+\/SKILL\.md$/.test(file)) {
      const review = scanText(text, file);
      if (review.verdict === 'danger')
        for (const finding of review.findings.filter((f) => f.severity === 'danger').slice(0, 3))
          problems.push({
            message: `${file}: ${finding.message} Take it out: an app’s skills are read like anyone else’s.`,
            file,
          });
    }
    if (options.redact) {
      const hidden = options.redact(text);
      if (hidden !== text) {
        const before = text.split('\n');
        const after = hidden.split('\n');
        const line = before.findIndex((l, i) => l !== after[i]) + 1;
        problems.push({
          message: `${file} has a secret from Passwords written in it. Take it out: ask for it as a setting with secret: true, and read it from app.settings.`,
          file,
          ...(line > 0 && { line }),
        });
      }
    }
  }

  let tools: ConchAppTool[] = [];
  if (manifest.tools) {
    const loaded = await loadTools(app, options.runtime);
    if (typeof loaded === 'string')
      problems.push({
        message: `The tools didn’t load in the sealed runtime: ${loaded}`.slice(0, 500),
        file: manifest.tools,
      });
    else tools = toolProblems(loaded, quality, new Set(tried), manifest.tools, problems, warnings);
  }

  if (quality) {
    if (!manifest.tools && !manifest.pages.length)
      problems.push({
        message:
          'This app has no tools and no pages, so it can’t do anything yet. Add a tools.mjs, a page, or both.',
        file: 'conch-app.json',
      });
    if (!manifest.examples.length)
      warnings.push({
        message: 'Add a few examples to conch-app.json: things a person might say to use it.',
        file: 'conch-app.json',
      });
    if (!manifest.instructions)
      warnings.push({
        message:
          'Add instructions to conch-app.json: when the assistant should use the app, and how.',
        file: 'conch-app.json',
      });
    // Its picture (ADR 0090): drawn in a square tile, from 20 px to 72 px across.
    const picture = pictureOf(app.files);
    if (picture && picture.width !== picture.height)
      warnings.push({
        message: `${picture.name} is ${picture.width} × ${picture.height}, not square, so the tile shows only its middle. Use a square picture (app_icon).`,
        file: picture.name,
      });
    if (picture && Math.min(picture.width, picture.height) < 64)
      warnings.push({
        message: `${picture.name} is ${picture.width} × ${picture.height}, small enough to look soft on a big screen. Use one around 256 × 256 (app_icon).`,
        file: picture.name,
      });
    if (!picture && [...app.files.keys()].some((f) => /^(?:icon|logo)\.svg$/i.test(f)))
      warnings.push({
        message:
          'An SVG isn’t drawn as the app’s icon: Conch draws only a PNG, JPEG or WebP picture. Give it one with app_icon, or keep the glyph.',
        file: 'conch-app.json',
      });
  }

  const cap = (items: AppCheckItem[]) =>
    items.slice(0, 40).map((item) => ({ ...item, message: item.message.slice(0, 500) }));
  return {
    ok: problems.length === 0,
    hash,
    at,
    problems: cap(problems),
    warnings: cap(warnings),
    tools,
    tried: tried.filter((t) => tools.some((tool) => tool.name === t)),
  };
};
