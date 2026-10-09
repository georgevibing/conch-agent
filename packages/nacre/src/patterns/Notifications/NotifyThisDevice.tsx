import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Collapsible } from '../../components/Collapsible';
import { Spinner } from '../../components/Spinner';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { SettingsRow } from '../Settings/SettingsSubpages';
import styles from './Notifications.module.css';

/**
 * - `on`: this device is told when something needs you.
 * - `off`: it could be; one switch.
 * - `install`: on an iPhone or iPad, notifications come once Conch is on the
 *   Home Screen (`AddToHomeScreen` says how).
 * - `blocked`: the browser was told no; only its settings can undo that.
 * - `unsupported`: this browser can't (or the address isn't https).
 */
export type NotifyState = 'on' | 'off' | 'install' | 'blocked' | 'unsupported';

/** One thing this device can be told about: “Tell me when … an answer is ready”. */
export interface NotifyTopic {
  id: string;
  /** Finishes “Tell me when”: “An answer is ready”. */
  label: string;
  on: boolean;
}

export interface NotifyThisDeviceProps extends Omit<
  ComponentProps<'section'>,
  'title' | 'onChange'
> {
  state: NotifyState;
  /** Turning on or off right now. */
  busy?: boolean;
  onChange?: (on: boolean) => void;
  /** What it's told about, shown under the switch only while it's on. */
  topics?: NotifyTopic[];
  onTopicChange?: (id: string, on: boolean) => void;
  /**
   * Open the topics on a page of their own (`NotifyTopics`): the card then
   * shows one Topics row, saying how many are on, in place of the list.
   */
  onOpenTopics?: () => void;
  /** Say what each one is about; off, only that there's something to open. */
  previews?: boolean;
  onPreviewsChange?: (on: boolean) => void;
  /** Send one now, to see it arrive. */
  onTest?: () => void;
  testing?: boolean;
  /** Why it can't, or what to do in the browser's settings, in a sentence. */
  detail?: ReactNode;
  /** Under the card when it can't be on yet: the steps to install. */
  children?: ReactNode;
}

const TITLES: Record<NotifyState, string> = {
  on: 'Allow notifications',
  off: 'Allow notifications',
  install: 'Add Conch to your Home Screen',
  blocked: 'Notifications are blocked',
  unsupported: 'This browser can’t show notifications',
};

const DETAILS: Record<NotifyState, string> = {
  on: 'On this device, while you’re away.',
  off: 'On this device, while you’re away.',
  install: 'iPhone and iPad notify from there:',
  blocked: 'Allow them for this site in your browser’s settings.',
  unsupported: 'Try Safari, Chrome, Edge or Firefox.',
};

/**
 * Notifications on this device, at a glance: one switch. While it's on, what
 * it's told about opens beneath it as a short list; off, the list folds away,
 * because it means nothing then. When the device needs something first (the
 * Home Screen on an iPhone, the browser's own permission), it says exactly
 * that, in a line.
 */
export function NotifyThisDevice({
  state,
  busy = false,
  onChange,
  topics,
  onTopicChange,
  onOpenTopics,
  previews,
  onPreviewsChange,
  onTest,
  testing,
  detail,
  children,
  className,
  ...props
}: NotifyThisDeviceProps) {
  const titleId = useId();
  const detailId = useId();
  const groupId = useId();
  const Icon =
    state === 'on' ? BellRing : state === 'install' ? Smartphone : state === 'off' ? Bell : BellOff;
  const canSwitch = state === 'on' || state === 'off';
  const on = state === 'on';
  // Folding away, it keeps what it showed: the list leaves whole, not empty.
  const [shown, setShown] = useState(topics);
  if (topics && topics !== shown) setShown(topics);
  const list = topics ?? shown;
  const anyOn = list?.some((t) => t.on) ?? false;

  return (
    <section
      aria-labelledby={titleId}
      className={cx(styles.card, className)}
      data-state={state}
      {...props}
    >
      <div className={styles.head}>
        <span className={styles.icon} data-state={state} aria-hidden>
          {busy ? <Spinner size="sm" label={null} /> : <Icon />}
        </span>
        <div className={styles.text}>
          <p className={styles.title} id={titleId}>
            {TITLES[state]}
          </p>
          <p className={styles.detail} id={detailId}>
            {detail ?? DETAILS[state]}
          </p>
        </div>
        {canSwitch && onChange && (
          <Switch
            checked={on}
            disabled={busy}
            onCheckedChange={onChange}
            aria-labelledby={titleId}
            aria-describedby={detailId}
          />
        )}
      </div>

      {canSwitch && (
        // Always here while it can be on, so turning it on plays the reveal.
        <Collapsible open={on && (Boolean(topics) || Boolean(onTest))}>
          <Collapsible.Content>
            <div className={styles.choices}>
              {list && onOpenTopics && (
                <SettingsRow
                  variant="plain"
                  page="topics"
                  label="Topics"
                  description="What it tells you about"
                  value={topicCount(list)}
                  onClick={onOpenTopics}
                />
              )}
              {list && !onOpenTopics && (
                <>
                  <p className={styles.groupLabel} id={groupId}>
                    Tell me when
                  </p>
                  <TopicSwitches
                    topics={list}
                    labelledBy={groupId}
                    {...(onTopicChange && { onTopicChange })}
                  />
                </>
              )}
              {list && previews !== undefined && (
                // Only worth deciding while it's told about something.
                <Collapsible open={anyOn}>
                  <Collapsible.Content>
                    <div className={styles.previews} data-after={onOpenTopics ? 'row' : 'list'}>
                      <Switch
                        size="sm"
                        labelPosition="start"
                        label="Show what it’s about"
                        description="Off: just “Open Conch to see it.”"
                        checked={previews}
                        onCheckedChange={(next) => onPreviewsChange?.(next)}
                      />
                    </div>
                  </Collapsible.Content>
                </Collapsible>
              )}
              {onTest && (
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="surface"
                    leadingIcon={<BellRing />}
                    loading={testing}
                    onClick={onTest}
                  >
                    Send a test
                  </Button>
                </div>
              )}
            </div>
          </Collapsible.Content>
        </Collapsible>
      )}

      {children != null && <div className={styles.body}>{children}</div>}
    </section>
  );
}

/** “4 of 6”, “All 6”, “None”: how many it tells you about. */
function topicCount(topics: NotifyTopic[]): string {
  const on = topics.filter((t) => t.on).length;
  if (on === 0) return 'None';
  if (on === topics.length) return `All ${on}`;
  return `${on} of ${topics.length}`;
}

function TopicSwitches({
  topics,
  labelledBy,
  onTopicChange,
}: {
  topics: NotifyTopic[];
  labelledBy: string;
  onTopicChange?: (id: string, on: boolean) => void;
}) {
  return (
    <div role="group" aria-labelledby={labelledBy} className={styles.rows}>
      {topics.map((topic) => (
        <Switch
          key={topic.id}
          size="sm"
          labelPosition="start"
          label={topic.label}
          checked={topic.on}
          onCheckedChange={(next) => onTopicChange?.(topic.id, next)}
        />
      ))}
    </div>
  );
}

export interface NotifyTopicsProps extends Omit<ComponentProps<'section'>, 'title'> {
  topics: NotifyTopic[];
  onTopicChange?: (id: string, on: boolean) => void;
}

/**
 * What this device is told about, as a page of its own (Settings →
 * Notifications → Topics): each finishes “Tell me when”, one switch apiece.
 */
export function NotifyTopics({ topics, onTopicChange, className, ...props }: NotifyTopicsProps) {
  const groupId = useId();
  return (
    <section
      aria-labelledby={groupId}
      className={cx(styles.card, styles.topics, className)}
      {...props}
    >
      <p className={styles.groupLabel} id={groupId}>
        Tell me when
      </p>
      <TopicSwitches
        topics={topics}
        labelledBy={groupId}
        {...(onTopicChange && { onTopicChange })}
      />
    </section>
  );
}
