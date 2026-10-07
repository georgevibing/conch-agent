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

export interface AgentPickerProps {
  agents: readonly AgentPickerAgent[];
  /** Who it is now. */
  value: string;
  onValueChange: (id: string) => void;
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

/**
 * Who you're talking to, and a press to talk to someone else: the agent's
 * face and name as a button, and a menu of every agent with its face and
 * what it's for. Choosing one is the whole change.
 */
export function AgentPicker({
  agents,
  value,
  onValueChange,
  variant = 'chip',
  label = (name) => `Talking to ${name}. Choose another agent`,
  actions = [],
  heading,
  className,
}: AgentPickerProps) {
  const current = agents.find((a) => a.id === value) ?? agents[0];
  if (!current) return null;
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
            key={JSON.stringify(current.avatar ?? '')}
            name={current.name}
            avatar={current.avatar}
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
        <MenuPrimitive.RadioGroup value={current.id} onValueChange={onValueChange}>
          {agents.map((agent) => (
            <MenuPrimitive.RadioItem
              key={agent.id}
              value={agent.id}
              className={cx(menuStyles.item, styles.pickerItem)}
            >
              <AgentAvatar name={agent.name} avatar={agent.avatar} size="md" decorative />
              <span className={styles.pickerText}>
                <span className={styles.pickerItemName}>{agent.name}</span>
                {agent.role && <span className={styles.pickerRole}>{agent.role}</span>}
              </span>
              <MenuPrimitive.ItemIndicator className={styles.pickerCheck}>
                <Check aria-hidden />
              </MenuPrimitive.ItemIndicator>
            </MenuPrimitive.RadioItem>
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
