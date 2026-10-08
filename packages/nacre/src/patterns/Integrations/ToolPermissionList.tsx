import { Eye, Pencil } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { SegmentedControl } from '../../components/SegmentedControl';
import { cx } from '../../utils/cx';
import styles from './ToolPermissionList.module.css';

export type ToolPermission = 'allow' | 'ask' | 'off';
export type IntegrationPolicyValue = 'ask' | 'ask-writes' | 'trust';

export interface PermissionTool {
  name: string;
  title?: string;
  description?: string;
  access: 'read' | 'write';
  destructive?: boolean;
  /**
   * Asks every time whatever the policy says (a calendar event, a Slack
   * message): only Ask or Off can be chosen, and the row says so.
   */
  alwaysAsks?: boolean;
  /**
   * Speaks for you (sending an email, saving a draft): Ask unless you choose
   * Allow on this one tool, whatever the policy says. Allow still asks once
   * the chat has read something from outside, and the row says so.
   */
  asksFirst?: boolean;
  /** Said when you choose Allow on an `asksFirst` tool, with Undo: "Conch will send without showing you first." */
  allowWarning?: string;
  /** Your override; unset follows the integration's policy. */
  policy?: ToolPermission;
}

export interface ToolPermissionListProps extends Omit<ComponentProps<'div'>, 'onChange'> {
  tools: PermissionTool[];
  policy: IntegrationPolicyValue;
  /** `null` goes back to following the policy. */
  onChange?: (tool: string, permission: ToolPermission | null) => void;
  /** Rows shown per group before "Show all". */
  collapseAfter?: number;
  disabled?: boolean;
  /** Who uses the tools, for "Conch can’t use it". */
  assistant?: string;
}

/** What a tool does when you haven't chosen: mirrors `toolDecision` in the protocol. */
export function defaultPermission(
  tool: Pick<PermissionTool, 'access' | 'destructive' | 'alwaysAsks' | 'asksFirst'>,
  policy: IntegrationPolicyValue,
): ToolPermission {
  if (tool.alwaysAsks || tool.asksFirst) return 'ask';
  if (policy === 'trust') return 'allow';
  if (policy === 'ask-writes' && tool.access === 'read' && !tool.destructive) return 'allow';
  return 'ask';
}

/** `create_pull_request` → "Create pull request". */
export function humanizeTool(name: string): string {
  const words = name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The selected choice in words, under the control, so "Off" can't be read as "don't ask". */
function hintFor(tool: PermissionTool, value: ToolPermission, assistant: string): string {
  if (value === 'off')
    return tool.policy === 'off'
      ? `You turned this off. ${assistant} can’t use it.`
      : `${assistant} can’t use it.`;
  if (value === 'ask') return 'Asks you each time.';
  return tool.asksFirst
    ? 'Doesn’t ask. Still asks if the chat read something from outside.'
    : 'Uses it without asking.';
}

function ToolRow({
  tool,
  policy,
  onChange,
  disabled,
  assistant,
}: {
  tool: PermissionTool;
  policy: IntegrationPolicyValue;
  onChange?: ToolPermissionListProps['onChange'];
  disabled?: boolean;
  assistant: string;
}) {
  const [expanded, setExpanded] = useState(false);
  /** The description runs past its two lines: only then is there more to show. */
  const [clamped, setClamped] = useState(false);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  /** Just allowed to speak for you: what that means, and the way back. */
  const [undo, setUndo] = useState<ToolPermission>();
  const labelId = useId();
  const hintId = useId();
  const fallback = defaultPermission(tool, policy);
  const value = tool.policy ?? fallback;
  const title = tool.title ?? humanizeTool(tool.name);
  const descriptionId = useId();

  useLayoutEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    // Measured folded only: open, the box is as tall as the words.
    const measure = () => {
      if (!el.dataset.expanded) setClamped(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    // A web font arriving rewraps the words without resizing the folded box.
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    fonts?.addEventListener?.('loadingdone', measure);
    const watch = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    watch?.observe(el);
    return () => {
      fonts?.removeEventListener?.('loadingdone', measure);
      watch?.disconnect();
    };
  }, [tool.description, expanded]);
  const choose = (choice: ToolPermission) =>
    onChange?.(tool.name, choice === fallback ? null : choice);
  return (
    <li className={styles.row} data-off={value === 'off' || undefined}>
      <div className={styles.about}>
        <p className={styles.name}>
          <span id={labelId}>{title}</span>
          {tool.destructive && (
            <Badge tone="danger" size="sm" variant="outline">
              Can delete
            </Badge>
          )}
          {tool.alwaysAsks && (
            <Badge tone="neutral" size="sm" variant="outline">
              Always asks
            </Badge>
          )}
        </p>
        {tool.description && (
          <p
            ref={descriptionRef}
            id={descriptionId}
            className={styles.description}
            data-expanded={expanded || undefined}
          >
            {tool.description}
          </p>
        )}
        {(clamped || expanded) && (
          <button
            type="button"
            className={styles.more}
            aria-expanded={expanded}
            aria-controls={descriptionId}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'Less' : 'More'}
          </button>
        )}
      </div>
      <div className={styles.choice}>
        <SegmentedControl
          size="sm"
          value={value}
          aria-labelledby={labelId}
          aria-describedby={hintId}
          disabled={disabled}
          onValueChange={(next) => {
            const choice = next as ToolPermission;
            setUndo(tool.asksFirst && choice === 'allow' ? value : undefined);
            choose(choice);
          }}
          className={styles.control}
        >
          {!tool.alwaysAsks && <SegmentedControl.Item value="allow">Allow</SegmentedControl.Item>}
          <SegmentedControl.Item value="ask">Ask</SegmentedControl.Item>
          <SegmentedControl.Item value="off">Off</SegmentedControl.Item>
        </SegmentedControl>
        <p id={hintId} className={styles.hint}>
          {hintFor(tool, value, assistant)}
        </p>
        {value === 'off' && tool.policy === 'off' && onChange && (
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange(tool.name, null)}
            aria-label={`Turn on ${title}`}
          >
            Turn on
          </Button>
        )}
      </div>
      <div role="status" className={styles.notice}>
        {undo && value === 'allow' && (
          <>
            <span>
              {tool.allowWarning ?? `${assistant} will do this without showing you first.`}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                choose(undo);
                setUndo(undefined);
              }}
            >
              Undo
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Every tool an integration offers, split into what only looks and what
 * changes things, each with Allow · Ask · Off. A description folds at two
 * lines, and only one that runs longer offers More — it comes from the
 * integration, so you should be able to read exactly what it claims a tool
 * does, and a More that shows nothing new is noise.
 */
export function ToolPermissionList({
  tools,
  policy,
  onChange,
  collapseAfter = 6,
  disabled,
  assistant = 'The assistant',
  className,
  ...props
}: ToolPermissionListProps) {
  const groups = [
    {
      id: 'read',
      title: 'Looks things up',
      hint: 'Reads without changing anything.',
      icon: <Eye />,
      tools: tools.filter((t) => t.access === 'read'),
    },
    {
      id: 'write',
      title: 'Makes changes',
      hint: 'Creates, sends, edits or deletes.',
      icon: <Pencil />,
      tools: tools.filter((t) => t.access === 'write'),
    },
  ].filter((g) => g.tools.length);
  const [showAll, setShowAll] = useState<Record<string, boolean>>({});
  const custom = tools.filter((t) => t.policy !== undefined).length;

  return (
    <div className={cx(styles.root, className)} {...props}>
      {groups.map((group) => {
        const visible = showAll[group.id] ? group.tools : group.tools.slice(0, collapseAfter);
        const hidden = group.tools.length - visible.length;
        return (
          <section key={group.id} className={styles.group} aria-labelledby={`tools-${group.id}`}>
            <header className={styles.groupHeader}>
              <span className={styles.groupIcon} aria-hidden>
                {group.icon}
              </span>
              <h4 id={`tools-${group.id}`} className={styles.groupTitle}>
                {group.title} <span className={styles.count}>{group.tools.length}</span>
              </h4>
              <span className={styles.hint}>{group.hint}</span>
            </header>
            <ul className={styles.rows}>
              {visible.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  policy={policy}
                  onChange={onChange}
                  disabled={disabled}
                  assistant={assistant}
                />
              ))}
            </ul>
            {hidden > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAll((s) => ({ ...s, [group.id]: true }))}
              >
                Show {hidden} more
              </Button>
            )}
          </section>
        );
      })}
      {custom > 0 && onChange && (
        <div className={styles.reset}>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              for (const tool of tools) if (tool.policy !== undefined) onChange(tool.name, null);
            }}
          >
            Reset {custom === 1 ? 'the tool you changed' : `${custom} tools you changed`}
          </Button>
        </div>
      )}
    </div>
  );
}
