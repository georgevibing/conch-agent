import type { ComponentProps, CSSProperties, ReactNode } from 'react';

import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './Handset.module.css';

export interface HandsetMessage {
  id: string;
  /** `them`: the other side (BotFather, your bot); `you`: the person holding the phone. */
  from: 'them' | 'you';
  text: ReactNode;
  /** Buttons under the message, as the app draws them. */
  buttons?: { label: string; tone?: 'primary' | 'danger' }[];
}

export interface HandsetProps extends Omit<ComponentProps<'figure'>, 'title'> {
  /** What the picture shows, for screen readers ("What you’ll see in Telegram"). */
  label: string;
  /** Brand id for the chat's picture when there's no `avatar`. */
  brand: string;
  color?: string;
  /** Who the chat is with. */
  title: string;
  subtitle?: string;
  avatar?: string;
  messages: HandsetMessage[];
  /** The other side is writing. */
  typing?: boolean;
  /** What sits at the bottom: the message box, or the one button to press. */
  footer?: ReactNode;
  /** Something is about to happen here: the frame's rim slowly orbits. */
  alive?: boolean;
}

/**
 * A phone, showing the chat app as the person will see it. It sits beside
 * each step of setting up a channel, so "what am I looking for?" always has a
 * picture: BotFather's reply with the key lit up, the Start button to press,
 * the bot's first hello. Messages rise in one after another, once.
 */
function HandsetRoot({
  label,
  brand,
  color,
  title,
  subtitle,
  avatar,
  messages,
  typing,
  footer,
  alive,
  className,
  style,
  ...props
}: HandsetProps) {
  return (
    <figure
      aria-label={label}
      className={cx(styles.handset, className)}
      data-lustre=""
      data-lustre-ambient={alive || undefined}
      style={{ ...(color && { '--hs-brand': color }), ...style } as CSSProperties}
      {...props}
    >
      <div className={styles.screen}>
        <div className={styles.bar} aria-hidden>
          {avatar ? (
            <img src={avatar} alt="" className={styles.avatar} />
          ) : (
            <IntegrationLogo
              brand={brand}
              name={title}
              color={color}
              size="sm"
              decorative
              className={styles.logo}
            />
          )}
          <span className={styles.who}>
            <span className={styles.title}>{title}</span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </span>
        </div>
        <ol className={styles.messages}>
          {messages.map((message, index) => (
            <li
              key={message.id}
              className={styles.message}
              data-from={message.from}
              style={{ '--hs-i': index } as CSSProperties}
            >
              <span className="nc-visually-hidden">
                {message.from === 'you' ? 'You: ' : `${title}: `}
              </span>
              <div className={styles.bubble}>{message.text}</div>
              {message.buttons && (
                <div className={styles.buttons} aria-hidden>
                  {message.buttons.map((button) => (
                    <span key={button.label} className={styles.button} data-tone={button.tone}>
                      {button.label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
          {typing && (
            <li
              className={styles.message}
              data-from="them"
              style={{ '--hs-i': messages.length } as CSSProperties}
            >
              <span className="nc-visually-hidden">{title} is writing</span>
              <div className={cx(styles.bubble, styles.typing)} aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </li>
          )}
        </ol>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </figure>
  );
}

/** Lights up the part to copy (the key in BotFather's reply). */
function HandsetKey({ className, ...props }: ComponentProps<'mark'>) {
  return <mark className={cx(styles.key, className)} {...props} />;
}

/** The app's message box, as a picture. */
function HandsetComposer({ placeholder = 'Message' }: { placeholder?: string }) {
  return (
    <div className={styles.composer} aria-hidden>
      {placeholder}
    </div>
  );
}

/** The one thing to press at the bottom of the chat (Telegram's START), gently calling. */
function HandsetAction({ children }: { children: ReactNode }) {
  return (
    <div className={styles.action}>
      <span className={styles.actionLabel}>{children}</span>
    </div>
  );
}

export const Handset = Object.assign(HandsetRoot, {
  Root: HandsetRoot,
  Key: HandsetKey,
  Composer: HandsetComposer,
  Action: HandsetAction,
});
