import { ArrowRight, Check, GlobeLock, Sparkles } from 'lucide-react';
import { useId, useState, type ComponentProps, type FormEvent, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Field } from '../../components/Field';
import { Input } from '../../components/Input';
import { PasswordInput } from '../../components/PasswordInput';
import { Pearl } from '../../components/Pearl';
import { StrengthMeter } from '../../components/StrengthMeter';
import { cx } from '../../utils/cx';
import { CopyButton } from '../CopyButton';
import { Steady } from '../Site/Steady';
import styles from './MakeItYours.module.css';
import { PasskeyButton } from './PasskeyButton';
import { passkeyName, type PasskeyPlatform } from './passkeyPlatform';

export type MakeItYoursState = 'ready' | 'working' | 'done' | 'expired' | 'error';

/** The app's own password rules (`checkPassword` in `@conch/protocol`). */
export interface PasswordVerdict {
  ok: boolean;
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  message: string;
}

export interface MakeItYoursProps extends Omit<ComponentProps<'main'>, 'children'> {
  state: MakeItYoursState;
  /** Where this Conch lives: "conch.example.com". */
  address: string;
  /** What this device can use (`passkeyPlatform`); none means a password is the way. */
  platform?: PasskeyPlatform;
  /** The username to start from: the server's own account name. */
  username: string;
  /** Make a passkey (the parent runs the browser's ceremony, then sets `state`). */
  onPasskey?: () => void;
  /** Use a password instead. */
  onPassword?: (username: string, password: string) => void;
  /** How good a password is, by the app's own rules. */
  checkPassword: (password: string, username: string) => PasswordVerdict;
  /** Makes a strong password to offer. */
  suggestPassword?: () => string;
  /** What went wrong, in one sentence (with `state="error"`). */
  error?: ReactNode;
  /** The command for a fresh link, shown when this one has run out. */
  command?: string;
  /** Once it's yours: open Conch now. Without it, the page says it's opening. */
  onContinue?: () => void;
  /** This link is spent, but you set it up already: go and sign in. */
  onSignIn?: () => void;
}

type Path = 'passkey' | 'password';

/**
 * The first thing anyone sees of a new Conch on a server: the page the hello
 * link opens (ADR 0064). One warm question, one big button for the way that
 * fits this device (its own passkey, named for it), and a password one press
 * away. Whoever opens the link first owns Conch, and the page says so.
 *
 * When it's done, a check lands where the pearl was and one ring of pearl light
 * passes out from it. The card keeps its size throughout (`Steady`), so nothing
 * jumps as it changes.
 */
export function MakeItYours({
  state,
  address,
  platform,
  username: initialUsername,
  onPasskey,
  onPassword,
  checkPassword,
  suggestPassword,
  error,
  command = 'conch hello',
  onContinue,
  onSignIn,
  className,
  ...props
}: MakeItYoursProps) {
  const builtIn = platform !== undefined && platform !== 'phone';
  const [path, setPath] = useState<Path>(builtIn ? 'passkey' : 'password');
  const [pressed, setPressed] = useState<Path>();
  const working = state === 'working';

  const ready = (
    <Ready
      address={address}
      platform={platform}
      path={path}
      onPath={setPath}
      username={initialUsername}
      working={working}
      pressed={pressed}
      error={state === 'error' ? error : undefined}
      checkPassword={checkPassword}
      suggestPassword={suggestPassword}
      onPasskey={() => {
        setPressed('passkey');
        onPasskey?.();
      }}
      onPassword={(name, password) => {
        setPressed('password');
        onPassword?.(name, password);
      }}
    />
  );

  return (
    <main className={cx(styles.root, className)} data-state={state} {...props}>
      <div className={styles.glow} aria-hidden />
      <Steady align="center" className={styles.card} holds={[<HoldPassword key="hold" />]}>
        {state === 'done' ? (
          <Done address={address} onContinue={onContinue} />
        ) : state === 'expired' ? (
          <Expired command={command} onSignIn={onSignIn} />
        ) : (
          ready
        )}
      </Steady>
    </main>
  );
}

function Address({ address }: { address: string }) {
  return (
    <p className={styles.address}>
      <GlobeLock aria-hidden />
      <span>{address}</span>
    </p>
  );
}

function Ready({
  address,
  platform,
  path,
  onPath,
  username,
  working,
  pressed,
  error,
  checkPassword,
  suggestPassword,
  onPasskey,
  onPassword,
}: {
  address: string;
  platform?: PasskeyPlatform;
  path: Path;
  onPath: (path: Path) => void;
  username: string;
  working: boolean;
  pressed?: Path;
  error?: ReactNode;
  checkPassword: MakeItYoursProps['checkPassword'];
  suggestPassword?: () => string;
  onPasskey: () => void;
  onPassword: (username: string, password: string) => void;
}) {
  const builtIn = platform !== undefined && platform !== 'phone';
  return (
    <div className={styles.view}>
      <div className={styles.mark}>
        <Pearl size="lg" state={working ? 'thinking' : 'idle'} label={null} />
      </div>
      <div className={styles.head}>
        <Address address={address} />
        <h1 className={styles.title}>Make Conch yours</h1>
        <p className={styles.lead}>
          Whoever opens this link first owns this Conch, and that’s you. Choose how you’ll sign in.
        </p>
      </div>

      {path === 'passkey' && platform ? (
        <div className={styles.choice}>
          <PasskeyButton
            platform={platform}
            action="create"
            block
            loading={working && pressed === 'passkey'}
            disabled={working && pressed !== 'passkey'}
            onClick={onPasskey}
          />
          <p className={styles.hint}>
            {builtIn
              ? `Nothing to remember: ${passkeyName(platform)} is your key.`
              : 'Your phone shows a code to scan, then it’s your key.'}
          </p>
          {error && (
            <Callout tone="danger" live="assertive">
              {error}
            </Callout>
          )}
          <Button variant="ghost" disabled={working} onClick={() => onPath('password')}>
            Choose a password instead
          </Button>
        </div>
      ) : (
        <PasswordPath
          username={username}
          working={working && pressed === 'password'}
          disabled={working}
          error={error}
          checkPassword={checkPassword}
          suggestPassword={suggestPassword}
          onSubmit={onPassword}
          other={
            platform && (
              <Button variant="ghost" disabled={working} onClick={() => onPath('passkey')}>
                {builtIn ? `Use ${passkeyName(platform)} instead` : 'Use your phone instead'}
              </Button>
            )
          }
        />
      )}

      <p className={styles.promise}>
        From now on, a new device needs your OK before it gets in, even with the right password.
      </p>
    </div>
  );
}

function PasswordPath({
  username: initialUsername,
  working,
  disabled,
  error,
  checkPassword,
  suggestPassword,
  onSubmit,
  other,
}: {
  username: string;
  working: boolean;
  disabled: boolean;
  error?: ReactNode;
  checkPassword: MakeItYoursProps['checkPassword'];
  suggestPassword?: () => string;
  onSubmit: (username: string, password: string) => void;
  other?: ReactNode;
}) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [suggested, setSuggested] = useState(false);
  const check = checkPassword(password, username);
  const formId = useId();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!check.ok || !username.trim() || disabled) return;
    onSubmit(username.trim(), password);
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby={`${formId}-title`}>
      <h2 id={`${formId}-title`} className={styles.formTitle}>
        Choose a password
      </h2>
      <Field>
        <Field.Label>Username</Field.Label>
        <Input
          size="lg"
          name="username"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
      </Field>
      <Field invalid={password.length > 0 && !check.ok}>
        <Field.Label>Password</Field.Label>
        <PasswordInput
          size="lg"
          name="new-password"
          autoComplete="new-password"
          value={password}
          revealed={revealed}
          onRevealedChange={setRevealed}
          onChange={(e) => {
            setPassword(e.target.value);
            setSuggested(false);
          }}
          required
        />
        <StrengthMeter
          score={check.score}
          label={check.label}
          message={
            suggested
              ? 'Strong. Your browser will offer to save it — say yes.'
              : password
                ? check.message
                : 'At least 15 characters. A short sentence you’ll remember works well.'
          }
          empty={!password}
        />
      </Field>
      {error && (
        <Callout tone="danger" live="assertive">
          {error}
        </Callout>
      )}
      <div className={styles.formActions}>
        {suggestPassword && (
          <Button
            type="button"
            variant="ghost"
            leadingIcon={<Sparkles />}
            disabled={disabled}
            onClick={() => {
              setPassword(suggestPassword());
              setRevealed(true);
              setSuggested(true);
            }}
          >
            Suggest a strong one
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          loading={working}
          disabled={(disabled && !working) || !check.ok || !username.trim()}
          trailingIcon={<ArrowRight />}
        >
          Make it mine
        </Button>
      </div>
      {other && <div className={styles.other}>{other}</div>}
    </form>
  );
}

/**
 * The tallest moment (the password path), drawn unseen under whatever shows so
 * the card never changes size. Same parts as the real form, without names, so
 * no password manager takes it for one.
 */
function HoldPassword() {
  return (
    <div className={styles.view}>
      <div className={styles.mark}>
        <Pearl size="lg" label={null} />
      </div>
      <div className={styles.head}>
        <p className={styles.address}>
          <GlobeLock aria-hidden />
          <span>conch</span>
        </p>
        <p className={styles.title}>Make Conch yours</p>
        <p className={styles.lead}>
          Whoever opens this link first owns this Conch, and that’s you. Choose how you’ll sign in.
        </p>
      </div>
      <div className={styles.form}>
        <p className={styles.formTitle}>Choose a password</p>
        <Field>
          <Field.Label>Username</Field.Label>
          <Input size="lg" autoComplete="off" tabIndex={-1} readOnly />
        </Field>
        <Field>
          <Field.Label>Password</Field.Label>
          <Input size="lg" autoComplete="off" tabIndex={-1} readOnly />
          <StrengthMeter
            score={0}
            label="Too short"
            message="At least 15 characters. A short sentence you’ll remember works well."
            empty
          />
        </Field>
        <div className={styles.formActions}>
          <Button tabIndex={-1} variant="ghost" leadingIcon={<Sparkles />}>
            Suggest a strong one
          </Button>
          <Button tabIndex={-1} size="lg">
            Make it mine
          </Button>
        </div>
        <div className={styles.other}>
          <Button tabIndex={-1} variant="ghost">
            Use Windows Hello instead
          </Button>
        </div>
      </div>
      <p className={styles.promise}>
        From now on, a new device needs your OK before it gets in, even with the right password.
      </p>
    </div>
  );
}

function Done({ address, onContinue }: { address: string; onContinue?: () => void }) {
  return (
    <div className={styles.view} data-arrived="">
      <div className={styles.mark}>
        <span className={styles.ring} aria-hidden />
        <span className={styles.done} aria-hidden>
          <Check />
        </span>
      </div>
      <div className={styles.head}>
        <Address address={address} />
        <h1 className={styles.title}>It’s yours</h1>
        <p className={styles.lead} role="status">
          You’re signed in. Conch will ask you before any other device gets in.
        </p>
      </div>
      {onContinue ? (
        <Button size="lg" trailingIcon={<ArrowRight />} onClick={onContinue}>
          Open Conch
        </Button>
      ) : (
        <p className={styles.opening}>
          <Pearl size="xs" state="thinking" label={null} />
          Opening Conch…
        </p>
      )}
    </div>
  );
}

function Expired({ command, onSignIn }: { command: string; onSignIn?: () => void }) {
  return (
    <div className={styles.view}>
      <div className={styles.mark}>
        <Pearl size="lg" label={null} />
      </div>
      <div className={styles.head}>
        <h1 className={styles.title}>This link has run its course</h1>
        <p className={styles.lead}>
          It’s been used already, or it’s more than an hour old. Each link works once, so nobody
          else can use yours. For a fresh one, run this on the server:
        </p>
      </div>
      <div className={styles.command}>
        <code>{command}</code>
        <CopyButton value={command} label="Copy command" />
      </div>
      {onSignIn && (
        <Button variant="surface" onClick={onSignIn}>
          Already set it up? Sign in
        </Button>
      )}
    </div>
  );
}
