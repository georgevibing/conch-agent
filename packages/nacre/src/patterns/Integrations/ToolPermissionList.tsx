import { Eye, Pencil } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

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
}

/** What a tool does when you haven't chosen: mirrors `toolDecision` in the protocol. */
export function defaultPermission(
  tool: Pick<PermissionTool, 'access' | 'destructive'>,
  policy: IntegrationPolicyValue,
): ToolPermission {
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

function ToolRow({
  tool,
  policy,
  onChange,
  disabled,
}: {
  tool: PermissionTool;
  policy: IntegrationPolicyValue;
  onChange?: ToolPermissionListProps['onChange'];
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const labelId = useId();
  const fallback = defaultPermission(tool, policy);
  const value = tool.policy ?? fallback;
  const title = tool.title ?? humanizeTool(tool.name);
  const long = (tool.description?.length ?? 0) > 110;
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
          {tool.policy && tool.policy !== fallback && (
            <span className={styles.custom} title="You changed this">
              <span className="nc-visually-hidden">(you changed this)</span>
            </span>
          )}
        </p>
        {tool.description && (
          <p className={styles.description} data-expanded={expanded || undefined}>
            {tool.description}
          </p>
        )}
        {long && (
          <button type="button" className={styles.more} onClick={() => setExpanded((e) => !e)}>
            {expanded ? 'Less' : 'More'}
          </button>
        )}
      </div>
      <SegmentedControl
        size="sm"
        value={value}
        aria-labelledby={labelId}
        disabled={disabled}
        onValueChange={(next) => {
          const choice = next as ToolPermission;
          onChange?.(tool.name, choice === fallback ? null : choice);
        }}
        className={styles.control}
      >
        <SegmentedControl.Item value="allow">Allow</SegmentedControl.Item>
        <SegmentedControl.Item value="ask">Ask</SegmentedControl.Item>
        <SegmentedControl.Item value="off">Off</SegmentedControl.Item>
      </SegmentedControl>
    </li>
  );
}

/**
 * Every tool an integration offers, split into what only looks and what
 * changes things, each with Allow · Ask · Off. Descriptions are shown in
 * full on request — they come from the integration, so you should be able
 * to read exactly what it claims a tool does.
 */
export function ToolPermissionList({
  tools,
  policy,
  onChange,
  collapseAfter = 6,
  disabled,
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
