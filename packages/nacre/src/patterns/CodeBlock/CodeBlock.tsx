import { ChevronDown, FileCode2, Terminal, WrapText } from 'lucide-react';
import {
  useEffect,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from 'react';

import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import { highlightLines, normalizeLanguage, type HighlightedLine } from './highlight';
import styles from './CodeBlock.module.css';

export interface CodeBlockProps extends Omit<ComponentProps<'figure'>, 'children'> {
  code: string;
  /** Language id or alias (`ts`, `python`, `sh`…). Unknown languages render as plain text. */
  language?: string;
  /** Shown in the header instead of the language label. */
  filename?: string;
  /** Show a line-number gutter. */
  lineNumbers?: boolean;
  /** First line number (e.g. when showing an excerpt of a file). */
  startLine?: number;
  /** Lines to emphasise: `[3, 4]` or `"3-5,9"` (1-based, relative to `startLine`). */
  highlight?: number[] | string;
  /** Soft-wrap long lines. Users can toggle this from the header. */
  defaultWrap?: boolean;
  /** Collapse blocks longer than this many lines behind a "Show more" control. */
  maxLines?: number;
  /**
   * - `card`  standalone block with header (default)
   * - `bare`  no chrome — for embedding inside other surfaces (e.g. ToolCall)
   */
  variant?: 'card' | 'bare';
  /** Hide the header (language, copy, wrap). Defaults to hidden for `bare`. */
  header?: boolean;
  /** Extra header actions rendered before the copy button. */
  actions?: ReactNode;
}

const shellLanguages = new Set(['bash', 'powershell', 'fish', 'nushell', 'bat']);

const languageLabels: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  tsx: 'TSX',
  jsx: 'JSX',
  python: 'Python',
  bash: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  css: 'CSS',
  html: 'HTML',
  markdown: 'Markdown',
  rust: 'Rust',
  go: 'Go',
  sql: 'SQL',
  diff: 'Diff',
  text: 'Plain text',
};

export function parseLineRanges(input: number[] | string | undefined): Set<number> {
  if (!input) return new Set();
  if (Array.isArray(input)) return new Set(input);
  const result = new Set<number>();
  for (const part of input.split(',')) {
    const [a, b] = part.split('-').map((n) => Number.parseInt(n.trim(), 10));
    if (a === undefined || Number.isNaN(a)) continue;
    const end = b === undefined || Number.isNaN(b) ? a : b;
    for (let i = Math.min(a, end); i <= Math.max(a, end); i++) result.add(i);
  }
  return result;
}

function useHighlighted(code: string, language: string) {
  const [state, setState] = useState<{ key: string; lines: HighlightedLine[] | null }>({
    key: '',
    lines: null,
  });
  const key = `${language}\u0000${code}`;
  useEffect(() => {
    let cancelled = false;
    void highlightLines(code, language).then((lines) => {
      if (!cancelled) setState({ key, lines });
    });
    return () => {
      cancelled = true;
    };
  }, [code, language, key]);
  // Keep showing the previous tokens while re-highlighting streamed code, as
  // long as the old tokens are a prefix of the new code (avoids flicker).
  return state.key === key || code.startsWith(state.key.split('\u0000')[1] ?? '\u0001')
    ? state.lines
    : null;
}

/**
 * Syntax-highlighted code with copy, wrap toggle, line numbers, line
 * emphasis and a collapsible long-form mode. Highlighting loads lazily and
 * the plain text renders immediately, so there is never a layout shift.
 */
export function CodeBlock({
  code,
  language,
  filename,
  lineNumbers = false,
  startLine = 1,
  highlight,
  defaultWrap = false,
  maxLines,
  variant = 'card',
  header = variant === 'card',
  actions,
  className,
  ...props
}: CodeBlockProps) {
  const lang = normalizeLanguage(language);
  const trimmed = code.replace(/\n$/, '');
  const plainLines = useMemo(() => trimmed.split('\n'), [trimmed]);
  const tokens = useHighlighted(trimmed, lang);
  const emphasised = useMemo(() => parseLineRanges(highlight), [highlight]);
  const [wrap, setWrap] = useState(defaultWrap);
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();

  const collapsible = maxLines !== undefined && plainLines.length > maxLines + 2;
  const collapsed = collapsible && !expanded;
  const label = filename ?? languageLabels[lang] ?? lang;
  const HeaderIcon = shellLanguages.has(lang) ? Terminal : FileCode2;

  return (
    <figure
      data-variant={variant}
      data-wrap={wrap || undefined}
      data-collapsed={collapsed || undefined}
      data-line-numbers={lineNumbers || undefined}
      className={cx(styles.root, className)}
      style={
        {
          '--gutter': `${String(startLine + plainLines.length - 1).length}ch`,
          ...(collapsed && { '--visible-lines': maxLines }),
        } as CSSProperties
      }
      {...props}
    >
      {header && (
        <figcaption className={styles.header}>
          <span className={styles.label}>
            <HeaderIcon aria-hidden className={styles.labelIcon} />
            <span className={filename ? styles.filename : undefined}>{label}</span>
          </span>
          <span className={styles.actions}>
            {actions}
            <IconButton
              size="sm"
              label={wrap ? 'Disable line wrap' : 'Wrap lines'}
              aria-pressed={wrap}
              data-active={wrap || undefined}
              className={styles.wrapToggle}
              onClick={() => setWrap((w) => !w)}
            >
              <WrapText />
            </IconButton>
            <CopyButton value={trimmed} label="Copy code" />
          </span>
        </figcaption>
      )}
      <div
        id={bodyId}
        className={styles.viewport}
        // Scrollable regions must be keyboard-focusable (WCAG 2.1.1).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label={filename ? `Code: ${filename}` : `${label} code`}
      >
        <pre className={styles.pre} data-language={lang}>
          <code className={styles.code} style={{ counterReset: `nc-line ${startLine - 1}` }}>
            {plainLines.map((plain, i) => {
              const candidate = tokens?.[i];
              // Tokens may be stale for the last line of streamed code.
              const line =
                candidate && candidate.map((t) => t.content).join('') === plain ? candidate : null;
              return (
                <span
                  key={i}
                  className={styles.line}
                  data-highlighted={emphasised.has(i + startLine) || undefined}
                >
                  {line
                    ? line.map((token, j) => (
                        <span
                          key={j}
                          style={{
                            color: token.color,
                            fontStyle: token.fontStyle === 1 ? 'italic' : undefined,
                          }}
                        >
                          {token.content}
                        </span>
                      ))
                    : plain}
                  {'\n'}
                </span>
              );
            })}
          </code>
        </pre>
      </div>
      {collapsible && (
        <div className={styles.expander}>
          <button
            type="button"
            className={styles.expandButton}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((e) => !e)}
          >
            <span>
              {expanded ? 'Show less' : `Show ${plainLines.length - (maxLines ?? 0)} more lines`}
            </span>
            <ChevronDown aria-hidden className={styles.expandIcon} />
          </button>
        </div>
      )}
    </figure>
  );
}

export type InlineCodeProps = ComponentProps<'code'>;

/** Inline `code` span for use in running text. */
export function InlineCode({ className, ...props }: InlineCodeProps) {
  return <code className={cx(styles.inline, className)} {...props} />;
}
