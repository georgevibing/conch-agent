import { Check, Globe, Lock, SquareArrowOutUpRight } from 'lucide-react';
import { useId, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Collapsible } from '../../components/Collapsible';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Spinner } from '../../components/Spinner';
import { Heading, Text } from '../../components/Text';
import { CopyButton } from '../CopyButton';
import { cx } from '../../utils/cx';
import styles from './PublicDoor.module.css';

export type PublicDoorState = 'off' | 'starting' | 'ready' | 'needs-you' | 'error';

export interface PublicDoorProps extends Omit<ComponentProps<'section'>, 'title'> {
  state: PublicDoorState;
  /** The public address, once there is one. */
  url?: string;
  via?: 'tailscale' | 'own';
  /** The apps that come in through it ("Teams", "WeChat"), for the words. */
  apps: string[];
  /** One plain sentence when it isn't simply fine. */
  message?: string;
  /** What only a person can do: a page to open, or a command to copy. */
  problem?: { message: string; url?: string; command?: string };
  /** Installing Tailscale, as the app's own button (`GetIt`). */
  install?: ReactNode;
  /** The port the door listens on, for an address of your own. */
  port?: number;
  busy?: boolean;
  onTailscale?: () => void;
  onOwn?: (url: string) => void;
  onOff?: () => void;
  onCheck?: () => void;
  /** What went wrong with an address typed in. */
  ownError?: string;
}

/**
 * The one way in from the internet, for the chat apps that only deliver to a
 * web address. Off, it says why it's needed and offers one button (Tailscale
 * Funnel), with an address of your own folded under it; on, it shows the
 * address with a lock, because only signed deliveries get through; when only
 * a person can finish it, it says the step and gives the page or the command.
 */
export function PublicDoor({
  state,
  url,
  via,
  apps,
  message,
  problem,
  install,
  port = 4319,
  busy,
  onTailscale,
  onOwn,
  onOff,
  onCheck,
  ownError,
  className,
  ...props
}: PublicDoorProps) {
  const heading = useId();
  const [own, setOwn] = useState('');
  const names = apps.length ? apps.join(' and ') : 'These apps';
  return (
    <section
      aria-labelledby={heading}
      className={cx(styles.door, className)}
      data-state={state}
      data-lustre=""
      {...props}
    >
      <span className={styles.icon} aria-hidden>
        {state === 'ready' ? (
          <Lock />
        ) : state === 'starting' ? (
          <Spinner size="sm" label="" />
        ) : (
          <Globe />
        )}
      </span>
      <div className={styles.body}>
        <Heading level={3} size="md" id={heading}>
          {state === 'ready'
            ? 'Public address on'
            : state === 'starting'
              ? 'Turning on the public address…'
              : state === 'off'
                ? 'A public address, just for these messages'
                : 'The public address needs you'}
        </Heading>
        {state === 'ready' && url && (
          <>
            <div className={styles.address}>
              <code>{url}</code>
              <CopyButton value={url} label="Copy the public address" />
            </div>
            <Text size="sm" tone="muted">
              {via === 'tailscale' ? 'Through Tailscale Funnel. ' : ''}
              It only lets in messages {names} signed. Nothing else on this computer can be reached
              through it.
            </Text>
          </>
        )}
        {state === 'off' && (
          <Text size="sm" tone="muted">
            {names} only deliver messages to a web address. Conch can open one that leads to a small
            door of its own, which lets in nothing but their signed messages.
          </Text>
        )}
        {state === 'starting' && (
          <Text size="sm" tone="muted" aria-live="polite">
            {problem?.message ?? 'This takes a moment.'}
          </Text>
        )}
        {(state === 'needs-you' || state === 'error') && (
          <Text size="sm" aria-live="polite">
            {problem?.message ?? message ?? 'It stopped working.'}
          </Text>
        )}
        {problem?.command && (
          <div className={styles.address}>
            <code>{problem.command}</code>
            <CopyButton value={problem.command} label="Copy the command" />
          </div>
        )}
        <div className={styles.actions}>
          {problem?.url && (
            <Button asChild variant="solid" size="sm" trailingIcon={<SquareArrowOutUpRight />}>
              <a href={problem.url} target="_blank" rel="noreferrer noopener">
                Open Tailscale’s page
              </a>
            </Button>
          )}
          {install}
          {(state === 'off' || state === 'needs-you' || state === 'error') &&
            !install &&
            onTailscale && (
              <Button
                variant={problem?.url ? 'surface' : 'solid'}
                size="sm"
                loading={busy}
                onClick={onTailscale}
              >
                {state === 'off' ? 'Turn on with Tailscale' : 'Try again'}
              </Button>
            )}
          {state === 'ready' && onCheck && (
            <Button variant="ghost" size="sm" leadingIcon={<Check />} onClick={onCheck}>
              Check it
            </Button>
          )}
          {state !== 'off' && onOff && (
            <Button variant="ghost" tone="danger" size="sm" onClick={onOff}>
              Turn off
            </Button>
          )}
        </div>
        {state !== 'ready' && onOwn && (
          <Collapsible>
            <Collapsible.Trigger asChild>
              <Button variant="ghost" size="sm" className={styles.more}>
                I have an address of my own
              </Button>
            </Collapsible.Trigger>
            <Collapsible.Content>
              <form
                className={styles.own}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (own.trim()) onOwn(own.trim());
                }}
              >
                <Text size="sm" tone="muted">
                  A reverse proxy, frp or a tunnel you already run. Make it forward to{' '}
                  <code>http://127.0.0.1:{port}</code> on this computer, then type its address.
                </Text>
                <Field invalid={Boolean(ownError)}>
                  <Field.Label size="sm">Your address</Field.Label>
                  <Input
                    value={own}
                    onChange={(event) => setOwn(event.target.value)}
                    placeholder="https://conch.example.com"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {ownError && <Field.Error>{ownError}</Field.Error>}
                </Field>
                <Button
                  type="submit"
                  variant="surface"
                  size="sm"
                  loading={busy}
                  disabled={!own.trim()}
                >
                  Use this address
                </Button>
              </form>
            </Collapsible.Content>
          </Collapsible>
        )}
      </div>
    </section>
  );
}
