import {
  Bot,
  Check,
  ChevronRight,
  FilePen,
  FilePlus2,
  FileText,
  Globe,
  ListTodo,
  Minus,
  Search,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Collapsible } from 'radix-ui';
import { createElement, type ComponentProps, type ReactNode } from 'react';

import { Spinner } from '../../components/Spinner';
import { cx } from '../../utils/cx';
import { CodeBlock } from '../CodeBlock';
import styles from './ToolCall.module.css';

export type ToolCallStatus = 'pending' | 'running' | 'success' | 'error' | 'cancelled';

export interface ToolCallProps extends Omit<
  ComponentProps<'div'>,
  'children' | 'defaultValue' | 'onChange'
> {
  /** Tool name as reported by the agent (`Bash`, `Read`, `Edit`, `mcp__github__…`). */
  name: string;
  /** One-line description: the command, file path, query… */
  summary?: ReactNode;
  status?: ToolCallStatus;
  /** Duration in milliseconds. */
  duration?: number;
  /** Tool input. Strings render as a code block in `inputLanguage`. */
  input?: ReactNode;
  inputLanguage?: string;
  /** Tool result. Strings render as a code block in `outputLanguage`. */
  output?: ReactNode;
  outputLanguage?: string;
  /** Custom body (e.g. a `<Diff>`), rendered after input/output. */
  children?: ReactNode;
  /**
   * What the tool found, drawn as it is (an agenda, emails, files): always
   * shown under the row. Input and output stay behind the disclosure.
   */
  view?: ReactNode;
  /** Override the icon inferred from `name`. */
  icon?: LucideIcon;
  /** Replaces the icon and server name — e.g. an integration's logo and name. */
  leading?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const toolIcons: [RegExp, LucideIcon][] = [
  [/^(bash|shell|exec|run)/i, SquareTerminal],
  [/^(read|view|cat)/i, FileText],
  [/^(edit|multiedit|str_replace|notebookedit)/i, FilePen],
  [/^write/i, FilePlus2],
  [/^(grep|glob|search|find|ls)/i, Search],
  [/^(webfetch|websearch|fetch|browse)/i, Globe],
  [/^(task|agent)/i, Bot],
  [/^todo/i, ListTodo],
];

export function toolIcon(name: string): LucideIcon {
  const bare = name.replace(/^mcp__[^_]+__/, '');
  return toolIcons.find(([re]) => re.test(bare))?.[1] ?? Wrench;
}

/** `mcp__github__create_pull_request` → `{ server: 'github', tool: 'create pull request' }`. */
export function parseToolName(name: string): { server?: string; tool: string } {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  if (!mcp) return { tool: name };
  return { server: mcp[1], tool: (mcp[2] ?? '').replace(/_/g, ' ') };
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms % 60_000) / 1000)}s`;
}

const statusLabel: Record<ToolCallStatus, string> = {
  pending: 'Waiting',
  running: 'Running',
  success: 'Completed',
  error: 'Failed',
  cancelled: 'Cancelled',
};

function StatusGlyph({ status }: { status: ToolCallStatus }) {
  return (
    // Keyed so each status change re-mounts and plays the "settle" animation.
    <span key={status} className={styles.status} data-status={status} aria-hidden>
      {status === 'running' && <Spinner size="xs" label={null} />}
      {status === 'success' && <Check />}
      {status === 'error' && <X />}
      {status === 'cancelled' && <Minus />}
    </span>
  );
}

function Section({
  label,
  children,
  language,
}: {
  label: string;
  children: ReactNode;
  language?: string;
}) {
  return (
    <section className={styles.section} aria-label={label}>
      <span className={styles.sectionLabel} aria-hidden>
        {label}
      </span>
      {typeof children === 'string' ? (
        <CodeBlock
          variant="bare"
          code={children}
          language={language}
          maxLines={14}
          className={styles.code}
        />
      ) : (
        children
      )}
    </section>
  );
}

/**
 * A single agent tool invocation. Collapsed it is a calm one-line row; expand
 * it to inspect input and output. Status changes animate in place.
 */
export function ToolCall({
  name,
  summary,
  status = 'success',
  duration,
  input,
  inputLanguage = 'json',
  output,
  outputLanguage = 'text',
  children,
  view,
  icon,
  leading,
  open,
  defaultOpen,
  onOpenChange,
  className,
  ...props
}: ToolCallProps) {
  const { server, tool } = parseToolName(name);
  const hasBody = input != null || output != null || children != null;

  const header = (
    <>
      <StatusGlyph status={status} />
      <span className={styles.tool}>
        {leading ?? (
          <>
            {createElement(icon ?? toolIcon(name), {
              'aria-hidden': true,
              className: styles.toolIcon,
            })}
            {server && <span className={styles.server}>{server}</span>}
          </>
        )}
        <span className={styles.name}>{tool}</span>
      </span>
      {summary != null && <span className={styles.summary}>{summary}</span>}
      <span className={styles.trailing}>
        <span className="nc-visually-hidden">, {statusLabel[status]}</span>
        {duration !== undefined && status !== 'running' && (
          <span className={styles.duration}>{formatDuration(duration)}</span>
        )}
        {hasBody && <ChevronRight aria-hidden className={styles.chevron} />}
      </span>
    </>
  );

  return (
    <Collapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      disabled={!hasBody}
      asChild
    >
      <div
        data-status={status}
        data-view={view != null || undefined}
        className={cx(styles.root, className)}
        {...props}
      >
        {hasBody ? (
          <Collapsible.Trigger className={styles.header} data-lustre="">
            {header}
          </Collapsible.Trigger>
        ) : (
          <div className={styles.header}>{header}</div>
        )}
        {view != null && <div className={styles.view}>{view}</div>}
        {hasBody && (
          <Collapsible.Content className={styles.content}>
            <div className={styles.body}>
              {input != null && (
                <Section label="Input" language={inputLanguage}>
                  {input}
                </Section>
              )}
              {output != null && (
                <Section label={status === 'error' ? 'Error' : 'Output'} language={outputLanguage}>
                  {output}
                </Section>
              )}
              {children}
            </div>
          </Collapsible.Content>
        )}
      </div>
    </Collapsible.Root>
  );
}
