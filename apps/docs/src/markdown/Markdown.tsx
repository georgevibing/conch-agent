import {
  Callout,
  CodeBlock,
  CommandLine,
  formatKey,
  Prose,
  Steps,
  type CalloutTone,
} from '@conch/nacre';
import { Link2 } from 'lucide-react';
import {
  Children,
  isValidElement,
  memo,
  useMemo,
  type ComponentProps,
  type ElementType,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';

import { Embed } from '../embeds/Embed';
import { resolveLink } from '../site/pages';
import { segments } from '../site/text';
import styles from './Markdown.module.css';
import { remarkConch } from './remarkConch';

/** The words inside some rendered Markdown, for a label. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

const SHELLS = new Set(['bash', 'sh', 'shell', 'zsh', 'powershell', 'ps1']);

const CALLOUTS: Record<string, { tone: CalloutTone; title: string }> = {
  note: { tone: 'neutral', title: 'Note' },
  tip: { tone: 'accent', title: 'Tip' },
  important: { tone: 'info', title: 'Important' },
  warning: { tone: 'warning', title: 'Careful' },
  caution: { tone: 'danger', title: 'Careful' },
};

/** `mod+k`, `esc`: a key chord written to be drawn, not the words on a keycap. */
const CHORD = /^[a-z0-9`,./\\[\]'-]+(\+[a-z0-9`,./\\[\]'-]+)*$/;

const heading = (Tag: 'h2' | 'h3' | 'h4') =>
  function Heading({ id, children }: ComponentProps<'h2'>) {
    return (
      <Tag id={id} className={styles.heading}>
        {children}
        {id && (
          <a href={`#${id}`} className={styles.anchor} aria-label={`Link to “${textOf(children)}”`}>
            <Link2 aria-hidden />
          </a>
        )}
      </Tag>
    );
  };

/** How each piece of Markdown is drawn, for a page whose links are relative to `file`. */
function components(file: string): Components {
  const map: Components = {
    // A page's top heading is its title, drawn by the page: one in the words is a section.
    h1: heading('h2'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    a({ href = '', children }) {
      const link = resolveLink(file, href);
      if (link.kind === 'page') return <Link to={link.to}>{children}</Link>;
      if (link.kind === 'anchor') return <a href={link.to}>{children}</a>;
      return (
        <a href={link.href} target="_blank" rel="noreferrer">
          {children}
        </a>
      );
    },
    pre({ children }) {
      const block = Children.toArray(children).find((child) =>
        isValidElement<{ className?: string; children?: ReactNode }>(child),
      );
      if (!isValidElement<{ className?: string; children?: ReactNode }>(block))
        return <pre>{children}</pre>;
      const language = /language-([\w-]+)/.exec(block.props.className ?? '')?.[1];
      const code = textOf(block.props.children).replace(/\n$/, '');
      // One line for a terminal, with nothing to explain: ready to paste.
      if (language && SHELLS.has(language) && !code.includes('\n') && !/\s#\s/.test(code))
        return <CommandLine command={code} prompt={language.startsWith('p') ? '>' : '$'} />;
      return <CodeBlock code={code} language={language} />;
    },
    ol({ children, node: _node, ...props }) {
      if ('data-steps' in props) return <Steps>{children}</Steps>;
      return <ol {...props}>{children}</ol>;
    },
    li({ children, node: _node, ...props }) {
      if ('data-step' in props) return <Steps.Step>{children}</Steps.Step>;
      return <li {...props}>{children}</li>;
    },
    // A checklist in a guide is something to read: each box says in words whether it's ticked.
    input({ type, checked }) {
      if (type !== 'checkbox') return null;
      return (
        <input
          type="checkbox"
          checked={Boolean(checked)}
          disabled
          readOnly
          aria-label={checked ? 'Done' : 'To do'}
        />
      );
    },
    kbd({ children }) {
      const keys = textOf(children);
      if (!CHORD.test(keys)) return <kbd>{children}</kbd>;
      // `mod+k` is ⌘K on a Mac and Ctrl K elsewhere: one keycap per key.
      return (
        <span className={styles.chord}>
          {keys.split('+').map((key, i) => (
            <kbd key={i}>{formatKey(key)}</kbd>
          ))}
        </span>
      );
    },
  };

  const extra: Record<string, ElementType> = {
    'conch-callout': ({ kind, children }: { kind: string; children?: ReactNode }) => {
      const callout = CALLOUTS[kind] ?? { tone: 'neutral' as const, title: 'Note' };
      return (
        <Callout tone={callout.tone} title={callout.title}>
          {children}
        </Callout>
      );
    },
  };

  return { ...map, ...extra } as Components;
}

export interface MarkdownProps {
  /** The Markdown to draw. */
  source: string;
  /** The file it came from, from the top of the repository: its links are relative to it. */
  file: string;
}

/**
 * A page's words, drawn with Nacre: prose, code with copy, one-line commands
 * ready to paste, steps on a thread, callouts, and the generated parts
 * (`<!-- conch:… -->`) in their place between them.
 */
export const Markdown = memo(function Markdown({ source, file }: MarkdownProps) {
  const parts = useMemo(() => segments(source), [source]);
  const map = useMemo(() => components(file), [file]);
  return (
    <div className={styles.flow}>
      {parts.map((part, i) =>
        part.kind === 'embed' ? (
          <Embed key={i} name={part.name} args={part.args} />
        ) : (
          <Prose key={i} size="lg">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, [remarkConch, { seen: part.seen }]]}
              components={map}
            >
              {part.text}
            </ReactMarkdown>
          </Prose>
        ),
      )}
    </div>
  );
});
