import { House, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Avatar } from '../../components/Avatar';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './OutsideAgents.module.css';

export interface OutsideAgentItem {
  id: string;
  name: string;
  description?: string;
  /** Where it answers: "agents.example.com". */
  host: string;
  /** On this computer or your own network. */
  private?: boolean;
  /** What went wrong last time, in words. */
  problem?: string;
}

export interface OutsideAgentListProps extends Omit<ComponentProps<'div'>, 'children'> {
  agents: OutsideAgentItem[];
  onRemove?: (agent: OutsideAgentItem) => void;
  /** The one being removed right now. */
  busy?: string;
}

/** The outside agents you added (ADR 0112): who, where, and what went wrong if anything did. */
export function OutsideAgentList({
  agents,
  onRemove,
  busy,
  className,
  ...props
}: OutsideAgentListProps) {
  if (!agents.length) return null;
  return (
    <div className={className} {...props}>
      <ul aria-label="Outside agents" className={styles.list}>
        {agents.map((agent) => (
          <li key={agent.id} className={styles.row} data-busy={busy === agent.id || undefined}>
            <Avatar name={agent.name} size="md" aria-hidden />
            <div className={styles.body}>
              <p className={styles.name}>
                {agent.name}
                {agent.private && (
                  <Badge size="sm" tone="neutral" icon={<House />}>
                    Your network
                  </Badge>
                )}
              </p>
              {agent.description && <p className={styles.description}>{agent.description}</p>}
              <p className={styles.meta}>
                {agent.problem ? (
                  <span className={styles.problem}>
                    <TriangleAlert aria-hidden /> {agent.problem}
                  </span>
                ) : (
                  `At ${agent.host} · mention @${agent.name} in a chat`
                )}
              </p>
            </div>
            {onRemove && (
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<Trash2 />}
                loading={busy === agent.id}
                onClick={() => onRemove(agent)}
                aria-label={`Remove ${agent.name}`}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface OutsideAgentPreviewProps extends Omit<ComponentProps<'section'>, 'children'> {
  name: string;
  description?: string;
  skills?: { name: string; description?: string }[];
  /** Who runs it, as its card says: unchecked. */
  by?: string;
  host: string;
  private?: boolean;
  /** A key came with the paste. */
  keyed?: boolean;
  /** Already added: adding replaces it. */
  known?: boolean;
  onAdd?: () => void;
  adding?: boolean;
  /** Something to say under it (a key it still needs). */
  note?: ReactNode;
}

/**
 * What a pasted address turned out to be, before it's added: the agent its
 * card describes arrives as a card of its own, with a sheen of pearl light
 * once, and one button. What it says about itself is shown as its own
 * claim ("says it's run by…"), never as something Conch checked.
 */
export function OutsideAgentPreview({
  name,
  description,
  skills = [],
  by,
  host,
  private: onNetwork,
  keyed,
  known,
  onAdd,
  adding,
  note,
  className,
  ...props
}: OutsideAgentPreviewProps) {
  return (
    <section
      className={cx(styles.preview, className)}
      aria-label={`${name}, found at ${host}`}
      data-nc-fresh=""
      {...props}
    >
      <div className={styles.head}>
        <Avatar name={name} size="lg" aria-hidden />
        <div className={styles.body}>
          <p className={styles.title}>{name}</p>
          <p className={styles.meta}>
            {onNetwork ? 'On your network' : 'On the internet'} · {host}
            {keyed ? ' · with its key' : ''}
          </p>
        </div>
      </div>
      {description && <p className={styles.description}>{description}</p>}
      {skills.length > 0 && (
        <ul className={styles.skills} aria-label="What it says it can do">
          {skills.slice(0, 6).map((skill) => (
            <li key={skill.name} title={skill.description}>
              {skill.name}
            </li>
          ))}
        </ul>
      )}
      {by && <p className={styles.meta}>It says it’s run by {by}.</p>}
      <p className={styles.meta}>
        It’s sent only what you write to it with @{name}, and what it answers is read as someone
        else’s words.
      </p>
      {note && <div className={styles.note}>{note}</div>}
      {onAdd && (
        <div className={styles.actions}>
          <Button leadingIcon={<Plus />} onClick={onAdd} loading={adding}>
            {known ? `Update ${name}` : `Add ${name}`}
          </Button>
        </div>
      )}
    </section>
  );
}
