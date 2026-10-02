import { ArrowLeftRight, Check, MessageSquare, Plug } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './ModelSwitch.module.css';

/** Something a message needs that the chat's model can't use. */
export interface ModelSwitchNeed {
  /** An app ("Linear"), or a skill's title. */
  name: string;
  kind?: 'app' | 'skill';
  /** Catalog id, for the app's mark. */
  brand?: string;
  /** The app's tile colour (hex). */
  color?: string;
}

export interface ModelSwitchCardProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The chat's model, which can only chat. */
  model: string;
  needs: readonly ModelSwitchNeed[];
  /**
   * `offer` while the message waits; `switched` once it went with the model
   * offered; `answered` once it went without.
   */
  state?: 'offer' | 'switched' | 'answered';
  /** The best model you already set up that can. Absent: there's none. */
  switchTo?: {
    label: string;
    /** Its provider, when it isn't the chat's own. */
    provider?: string;
  };
  /** Switch the chat to `switchTo`, and send the message. */
  onSwitch?: () => void;
  busy?: boolean;
  /** No model can: set one up (shown instead of a switch). */
  onConnect?: () => void;
  /** Send it to the chat's own model anyway. */
  onAnswerWithout?: () => void;
}

/** "Linear", "Linear and Notion", "the “Weekly review” skill". */
export function needWords(needs: readonly ModelSwitchNeed[]): string {
  const names = needs.map((n) => (n.kind === 'skill' ? `the “${n.name}” skill` : n.name));
  if (names.length <= 1) return names[0] ?? 'your apps';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * The chat's model can't use what a message needs (ADR 0050) — an app, or a
 * skill's tools — so the message waits here instead of failing quietly. One
 * button switches the chat to a model you already set up that can, and the
 * message goes by itself; or it's answered without. With no model that can,
 * the one next step is setting one up. Once it goes, a quiet line says how.
 */
export function ModelSwitchCard({
  model,
  needs,
  state = 'offer',
  switchTo,
  onSwitch,
  busy,
  onConnect,
  onAnswerWithout,
  className,
  ...props
}: ModelSwitchCardProps) {
  const words = needWords(needs);
  if (state !== 'offer') {
    return (
      <div role="note" data-state={state} className={cx(styles.settled, className)} {...props}>
        {state === 'switched' ? <ArrowLeftRight aria-hidden /> : <Check aria-hidden />}
        <span>
          {state === 'switched' && switchTo
            ? `Switched to ${switchTo.label} to use ${words}`
            : `Answered without ${words}`}
        </span>
      </div>
    );
  }
  const title = `${model} can’t use ${words}`;
  const app = needs.find((n) => n.kind !== 'skill' && n.brand);
  return (
    <div role="group" aria-label={title} className={cx(styles.card, className)} {...props}>
      <span className={styles.mark} data-app={app ? '' : undefined} aria-hidden>
        {app ? (
          <IntegrationLogo
            brand={app.brand}
            name={app.name}
            color={app.color}
            size="sm"
            decorative
          />
        ) : (
          <MessageSquare />
        )}
      </span>
      <div className={styles.words}>
        <p className={styles.title}>{title}</p>
        <p className={styles.body}>
          {switchTo
            ? `${switchTo.label}${switchTo.provider ? ` on ${switchTo.provider}` : ''} can. Switch, and your message goes by itself.`
            : 'None of the models you’ve set up can use apps. Connect a provider that can, then ask again.'}
        </p>
        <div className={styles.actions}>
          {switchTo
            ? onSwitch && (
                <Button
                  size="sm"
                  leadingIcon={<ArrowLeftRight />}
                  loading={busy}
                  onClick={onSwitch}
                >
                  Switch to {switchTo.label}
                </Button>
              )
            : onConnect && (
                <Button size="sm" leadingIcon={<Plug />} onClick={onConnect}>
                  Connect a provider
                </Button>
              )}
          {onAnswerWithout && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={onAnswerWithout}>
              Answer without {needs.length > 1 ? 'them' : 'it'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
