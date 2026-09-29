/**
 * Lazy syntax highlighting built on Shiki.
 *
 * - Shiki (and each grammar) is dynamically imported the first time it is
 *   needed, so pages without code never pay for it.
 * - Uses the JavaScript regex engine (no WASM download).
 * - Uses a CSS-variables theme: every token colour is `var(--shiki-token-*)`,
 *   which CodeBlock.module.css maps onto Nacre tokens. Highlighting therefore
 *   follows light/dark mode and the accent colour without re-highlighting.
 */
import type { HighlighterGeneric, ThemedToken } from 'shiki';

export type HighlightedLine = ThemedToken[];

type AnyHighlighter = HighlighterGeneric<string, string>;

const THEME = 'nacre';

const aliases: Record<string, string> = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
  kt: 'kotlin',
  'c++': 'cpp',
  txt: 'text',
  plaintext: 'text',
};

export function normalizeLanguage(lang: string | undefined): string {
  if (!lang) return 'text';
  const key = lang.trim().toLowerCase();
  return aliases[key] ?? key;
}

let highlighterPromise: Promise<AnyHighlighter> | null = null;
const failed = new Set<string>();

function getHighlighter(): Promise<AnyHighlighter> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighter, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/bundle/full'), import('shiki/engine/javascript')]);
    const theme = createCssVariablesTheme({
      name: THEME,
      variablePrefix: '--shiki-',
      fontStyle: true,
    });
    return (await createHighlighter({
      themes: [theme],
      langs: [],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })) as unknown as AnyHighlighter;
  })();
  return highlighterPromise;
}

/**
 * Tokenise `code`. Resolves to `null` for plain text or unknown languages so
 * callers can keep rendering the unhighlighted fallback.
 */
export async function highlightLines(
  code: string,
  language: string | undefined,
): Promise<HighlightedLine[] | null> {
  const lang = normalizeLanguage(language);
  if (lang === 'text' || failed.has(lang)) return null;
  try {
    const highlighter = await getHighlighter();
    if (!highlighter.getLoadedLanguages().includes(lang)) {
      await highlighter.loadLanguage(lang as never);
    }
    return highlighter.codeToTokensBase(code, { lang, theme: THEME });
  } catch {
    failed.add(lang);
    return null;
  }
}
