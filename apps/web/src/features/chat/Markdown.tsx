import { CodeBlock, InlineCode, Prose } from '@conch/nacre';
import { isValidElement, memo, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  pre({ children }) {
    const child = Array.isArray(children) ? children[0] : children;
    if (!isValidElement(child)) return <pre>{children}</pre>;
    const props = (child as ReactElement<{ className?: string; children?: ReactNode }>).props;
    const language = /language-([\w+-]+)/.exec(props.className ?? '')?.[1];
    const code = String(props.children ?? '').replace(/\n$/, '');
    return <CodeBlock code={code} language={language} maxLines={40} />;
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
