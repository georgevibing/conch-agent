import { Check, ChevronDown } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';

import { DropdownMenu } from '../../components/DropdownMenu';
import { menuStyles } from '../../components/DropdownMenu/menuShared';
import { cx } from '../../utils/cx';
import { AgentAvatar } from '../AgentAvatar/AgentAvatar';
import type { AgentFace } from '../AgentAvatar/presets';
import styles from './Agents.module.css';

export interface AgentPickerAgent {
  id: string;
  name: string;
  role?: string;
  avatar?: AgentFace | string;
}

export interface AgentPickerAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
}

/**
 * A choice that isn't one agent: "Default agent", whoever is the default when
 * it's needed. It wears that agent's face today.
 */
export interface AgentPickerFallback {
  /** What it's called: "Default agent". */
  label: string;
  /** Who it is today, for its face. */
  agent: Pick<AgentPickerAgent, 'name' | 'avatar'>;
  /** A line under it in the menu: "Sage, while it’s the default". */
  role?: string;
}

interface AgentPickerBase {
  agents: readonly AgentPickerAgent[];
  /**
   * `hello`: the face large with its name under it, where a new chat starts.
   * `chip`: a small face and its name, in a header.
   */
  variant?: 'hello' | 'chip';
  /** What the button is called, for the agent shown: "Atlas answers this chat. Choose another". */
  label?: (name: string) => string;
  /** What else the menu offers, under the agents: a new one, all of them. */
  actions?: readonly AgentPickerAction[];
  /** A line over the agents in the menu ("Switch to"). */
  heading?: string;
  className?: string;
}

export type AgentPickerProps = AgentPickerBase &
  (
    | {
        fallback?: undefined;
        /** Who it is now. */
        value: string;
        onValueChange: (id: string) => void;
      }
    | {
        /** Offered first; chosen, the value is `null`. An agent that's gone shows as it. */
        fallback: AgentPickerFallback;
        value: string | null;
        onValueChange: (id: string | null) => void;
      }
  );

/** The fallback's place in the menu: never an agent's id (`ag_…`). */
const FALLBACK = 'nc-fallback';

/** One agent in the menu: its face, its name, what it's for, a check when it's the one. */
function PickerItem({
  value,
  agent,
  face = agent,
}: {
  value: string;
  agent: AgentPickerAgent;
  face?: Pick<AgentPickerAgent, 'name' | 'avatar'>;
}) {
  return (
    <MenuPrimitive.RadioItem value={value} className={cx(menuStyles.item, styles.pickerItem)}>
      <AgentAvatar name={face.name} avatar={face.avatar} size="md" decorative />
      <span className={styles.pickerText}>
        <span className={styles.pickerItemName}>{agent.name}</span>
        {agent.role && <span className={styles.pickerRole}>{agent.role}</span>}
      </span>
      <MenuPrimitive.ItemIndicator className={styles.pickerCheck}>
        <Check aria-hidden />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}

/**
 * Who you're talking to, and a press to talk to someone else: the agent's
 * face and name as a button, and a menu of every agent with its face and
 * what it's for. Choosing one is the whole change. With a `fallback`, the
 * first choice is no agent in particular ("Default agent"), worn with the
 * face of whoever that is today.
 */
export function AgentPicker(props: AgentPickerProps) {
  const {
    agents,
    value,
    fallback,
    variant = 'chip',
    label = (name) => `Talking to ${name}. Choose another agent`,
    actions = [],
    heading,
    className,
  } = props;
  const unset: AgentPickerAgent | undefined = fallback && {
    id: FALLBACK,
    name: fallback.label,
    ...(fallback.role && { role: fallback.role }),
  };
  const chosen = agents.find((a) => a.id === value);
  const current = chosen ?? unset ?? agents[0];
  if (!current) return null;
  // The fallback is shown by its label, with the face of the agent it stands for.
  const face = chosen ?? fallback?.agent ?? current;
  const choose = (id: string) => {
    if (props.fallback) props.onValueChange(id === FALLBACK ? null : id);
    else props.onValueChange(id);
  };
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cx(styles.picker, className)}
          data-variant={variant}
          data-lustre={variant === 'chip' || undefined}
          aria-label={label(current.name)}
        >
          <AgentAvatar
            key={JSON.stringify(face.avatar ?? '')}
            name={face.name}
            avatar={face.avatar}
            size={variant === 'hello' ? 'xl' : 'xs'}
            decorative
            className={styles.pickerFace}
          />
          <span className={styles.pickerName}>
            {current.name}
            <ChevronDown aria-hidden className={styles.pickerChevron} />
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        align={variant === 'hello' ? 'center' : 'start'}
        className={styles.pickerMenu}
      >
        {heading && <DropdownMenu.Label>{heading}</DropdownMenu.Label>}
        <MenuPrimitive.RadioGroup value={current.id} onValueChange={choose}>
          {unset && fallback && <PickerItem value={FALLBACK} agent={unset} face={fallback.agent} />}
          {agents.map((agent) => (
            <PickerItem key={agent.id} value={agent.id} agent={agent} />
          ))}
        </MenuPrimitive.RadioGroup>
        {actions.length > 0 && <DropdownMenu.Separator />}
        {actions.map((action) => (
          <DropdownMenu.Item key={action.label} icon={action.icon} onSelect={action.onSelect}>
            {action.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
