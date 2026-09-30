import { CodeBlock, InlineCode, Prose, revealWords, type SmoothText } from '@conch/nacre';
import { isValidElement, memo, useMemo, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { isShellCode, RunInTerminal } from '../terminal/TerminalToggle';
import { closeOpenMarkdown, splitBlocks } from './stream';

const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (!isValidElement(child)) return <pre>{children}</pre>;
    const props = (child as ReactElement<{ className?: string; children?: ReactNode }>).props;
    const language = /language-([\w+-]+)/.exec(props.className ?? '')?.[1];
    const code = String(props.children ?? '').replace(/\n$/, '');
    // Commands can go straight into your terminal (typed, not run: Enter is yours).
    return (
      <CodeBlock
        code={code}
        language={language}
        maxLines={40}
        actions={isShellCode(language) ? <RunInTerminal code={code} /> : undefined}
      />
    );
  },
  code({ children }) {
    return <InlineCode>{children}</InlineCode>;
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  },
};

/** Agent Markdown → Nacre typography. Memoised: streaming only re-parses when text grows. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <Prose>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </Prose>
  );
});

/** One block of a streaming reply. Memoised: only the growing tail re-renders. */
const LiveBlock = memo(function LiveBlock({
  text,
  offset,
  freshFrom,
}: {
  text: string;
  offset: number;
  freshFrom: number | null;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[revealWords, { freshFrom, offset }]]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

/**
 * A reply as it's being written. Bursty deltas are paced (by `useSmoothText`,
 * whose result is passed in) into an even flow of whole words; each settles in
 * as it lands; half-arrived syntax is closed so it never flashes raw; and
 * finished blocks are memoised so long replies stay smooth. Replies that
 * arrive complete (history) render in one pass.
 */
export function StreamingMarkdown({ text, smooth }: { text: string; smooth: SmoothText }) {
  const shown = smooth.live ? closeOpenMarkdown(smooth.text) : smooth.text;
  const blocks = useMemo(() => splitBlocks(shown), [shown]);
  if (!smooth.live) return <Markdown text={text} />;
  return (
    <Prose>
      {blocks.map((block, i) => {
        const end = block.start + block.text.length;
        const fresh = smooth.freshFrom !== null && smooth.freshFrom < end ? smooth.freshFrom : null;
        return <LiveBlock key={i} text={block.text} offset={block.start} freshFrom={fresh} />;
      })}
    </Prose>
  );
}
