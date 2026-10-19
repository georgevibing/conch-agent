import { Check, Inbox, Lock } from 'lucide-react';
import { useId, useState, type ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { Heading, Text } from '../../components/Text';
import { CopyButton } from '../CopyButton';
import { cx } from '../../utils/cx';
import styles from './PublicDoor.module.css';

export type AlwaysOnRelayState = 'off' | 'pairing' | 'ready' | 'needs-you' | 'error';

export interface AlwaysOnRelaySetup {
  /** The setup code: the public key and the token's hash, no secret. */
  code: string;
  /** Cloudflare Workers, the free plan. */
  worker: string;
  /** A Raspberry Pi or a Linux server with Node. */
  node: string;
  /** Docker (Fly.io, Render, a NAS). */
  docker: string;
}

export interface AlwaysOnRelayProps extends Omit<ComponentProps<'section'>, 'title'> {
  state: AlwaysOnRelayState;
  /** The relay's address, once it has one. */
  url?: string;
  /** While pairing: what to deploy it with. */
  setup?: AlwaysOnRelaySetup;
  /** Messages waiting at the relay. */
  waiting?: number;
  /** One plain sentence when it isn't simply fine. */
  message?: string;
  busy?: boolean;
  onPair?: () => void;
  onConnect?: (url: string) => void;
  onCheck?: () => void;
  onForget?: () => void;
  /** What went wrong with the address pasted in. */
  connectError?: string;
}

const PLACES: { key: keyof Omit<AlwaysOnRelaySetup, 'code'>; title: string; note: string }[] = [
  {
    key: 'worker',
    title: 'Cloudflare, free',
    note: 'In the apps/relay folder of Conch’s source, with a free Cloudflare account. Nothing to keep running.',
  },
  {
    key: 'node',
    title: 'A Raspberry Pi or a small server',
    note: 'On the Pi or the server, with Node 22.18 or later. It starts again by itself.',
  },
  {
    key: 'docker',
    title: 'Docker',
    note: 'Fly.io, Render, a NAS: anywhere that runs Docker and gives it an HTTPS address.',
  },
];

/**
 * The always-on relay (ADR 0140): a small program somewhere that's always on,
 * which keeps texts, Teams messages and routine webhooks while this computer is
 * off, locked so only this computer can read them. Off, it offers one button;
 * pairing, the command for each place it can run and a field for its address;
 * on, the address and how much waits there.
 */
export function AlwaysOnRelay({
  state,
  url,
  setup,
  waiting,
  message,
  busy,
  onPair,
  onConnect,
  onCheck,
  onForget,
  connectError,
  className,
  ...props
}: AlwaysOnRelayProps) {
  const heading = useId();
  const [address, setAddress] = useState('');
  return (
    <section
      aria-labelledby={heading}
      className={cx(styles.door, className)}
      data-state={state === 'pairing' ? 'off' : state}
      data-lustre=""
      {...props}
    >
      <span className={styles.icon} aria-hidden>
        {state === 'ready' ? <Lock /> : <Inbox />}
      </span>
      <div className={styles.body}>
        <Heading level={3} size="md" id={heading}>
          {state === 'ready'
            ? 'Always-on relay on'
            : state === 'pairing'
              ? 'Put your relay somewhere that’s always on'
              : state === 'off'
                ? 'Keep messages while this computer is off'
                : 'The always-on relay needs you'}
        </Heading>
        {state === 'off' && (
          <Text size="sm" tone="muted">
            A tiny relay, on a free Cloudflare account or a Raspberry Pi, takes texts, Teams
            messages and routine webhooks while Conch is off. It keeps them locked so only this
            computer can read them, for up to a week, and they come in when Conch is back.
          </Text>
        )}
        {state === 'ready' && (
          <>
            {url && (
              <div className={styles.address}>
                <code>{url}</code>
                <CopyButton value={url} label="Copy the relay’s address" />
              </div>
            )}
            <Text size="sm" tone="muted" aria-live="polite">
              {waiting ? `${waiting} waiting to come in. ` : 'Nothing waiting. '}
              The addresses Conch gives your apps lead here, and only this computer can read what it
              keeps.
            </Text>
          </>
        )}
        {(state === 'needs-you' || state === 'error') && (
          <Text size="sm" aria-live="polite">
            {message ?? 'It stopped answering.'} What comes meanwhile waits at the relay.
          </Text>
        )}
        {state === 'pairing' && setup && (
          <>
            <Text size="sm" tone="muted">
              Pick one place and run its command there. The setup code in it has no secret: it only
              lets the relay lock messages for this computer.
            </Text>
            <ol className={styles.own}>
              {PLACES.map((place) => (
                <li key={place.key}>
                  <Text size="sm" weight="medium">
                    {place.title}
                  </Text>
                  <Text size="sm" tone="muted">
                    {place.note}
                  </Text>
                  <div className={styles.address}>
                    <code>{setup[place.key]}</code>
                    <CopyButton
                      value={setup[place.key]}
                      label={`Copy the command for ${place.title}`}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <form
              className={styles.own}
              onSubmit={(event) => {
                event.preventDefault();
                if (address.trim()) onConnect?.(address.trim());
              }}
            >
              <Field invalid={Boolean(connectError)}>
                <Field.Label size="sm">The relay’s address</Field.Label>
                <Input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="https://conch-relay.you.workers.dev"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                />
                {connectError && <Field.Error>{connectError}</Field.Error>}
              </Field>
              <Button
                type="submit"
                variant="solid"
                size="sm"
                loading={busy}
                disabled={!address.trim()}
              >
                Use this relay
              </Button>
            </form>
          </>
        )}
        <div className={styles.actions}>
          {state === 'off' && onPair && (
            <Button variant="solid" size="sm" loading={busy} onClick={onPair}>
              Set up a relay
            </Button>
          )}
          {state !== 'off' && state !== 'pairing' && onCheck && (
            <Button variant="ghost" size="sm" leadingIcon={<Check />} onClick={onCheck}>
              {state === 'ready' ? 'Check it' : 'Try again'}
            </Button>
          )}
          {state !== 'off' && onForget && (
            <Button variant="ghost" tone="danger" size="sm" onClick={onForget}>
              {state === 'pairing' ? 'Cancel' : 'Stop using it'}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
