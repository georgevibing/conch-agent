import {
  Building2,
  Fingerprint,
  KeyRound,
  Lock,
  Mail,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../utils/cx';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './Browser.module.css';
import type { BrowserFillAccount } from './BrowserApproval';

/**
 * How the item saved for the page signs in when it isn't a password (ADR
 * 0133): through Google, a company's SSO, a passkey, a link by email. Names
 * only. (Mirrors `BrowserSignInOffer` in @conch/protocol.)
 */
export interface BrowserSignInOffer {
  via: 'provider' | 'passkey' | 'sso' | 'link';
  /** A provider Conch knows, for its mark ("google"). */
  provider?: string;
  /** "Google", "Acme SSO"; for a passkey or a link, the item's name. */
  name: string;
  account?: string;
  /** The page's own button Conch can press for you ("Continue with Google"). */
  button?: string;
  /** Saved as "another account" without saying whose: the page's provider buttons to choose from. */
  buttons?: string[];
  /** For a provider: the saved login Conch fills on its pages. */
  with?: BrowserFillAccount;
  /** For a passkey: Conch holds it. */
  usable?: boolean;
  /** For a passkey Conch can't use: where it's kept ("1Password"). */
  keptIn?: string;
}

/** What you can fill into the box you're in, from Passwords (ADR 0130). */
export interface BrowserFillOffer {
  /** `sign-in`: no box, the page's own way in ("Continue with Google"): see `signIn`. */
  field: 'username' | 'password' | 'new-password' | 'code' | 'card' | 'sign-in';
  /** The page's host, as shown. */
  site: string;
  items: BrowserFillAccount[];
  /** The saved site this page only pretends to be. */
  lookalike?: string;
  /** Why it can't be filled here. */
  blocked?: 'insecure' | 'frame';
  /** Passwords is locked. */
  locked?: boolean;
  /** The item saved for this site signs in some other way. */
  signIn?: BrowserSignInOffer;
  /** On a provider's page: the sign-in it's for ("Product Hunt"), its account first. */
  for?: string;
}

export interface BrowserFillProps extends Omit<ComponentProps<'div'>, 'children'> {
  offer: BrowserFillOffer;
  /** Fill this item into the box (and what goes with it). */
  onFill?: (id: string) => void;
  /** Make a strong password, save it, and fill it in. */
  onGenerate?: () => void;
  /** Open Passwords, to unlock it. */
  onUnlock?: () => void;
  /**
   * Start the item's own way in: press the page's "Continue with Google" (or the
   * `button` chosen, for an item that doesn't say whose account), or use the passkey.
   */
  onSignIn?: (id: string, button?: string) => void;
  onDismiss?: () => void;
}

const WHAT: Record<BrowserFillOffer['field'], string> = {
  username: 'your username',
  password: 'your password',
  'new-password': 'a new password',
  code: 'the code',
  card: 'a card',
  'sign-in': 'your sign-in',
};

/** The face of a way in: the provider's mark, or a glyph for the rest. */
function SignInFace({ signIn }: { signIn: BrowserSignInOffer }) {
  if (signIn.via === 'provider' && signIn.provider)
    return (
      <IntegrationLogo
        brand={signIn.provider}
        name={signIn.name}
        size="xs"
        decorative
        className={styles.fillMark}
      />
    );
  const Icon =
    signIn.via === 'passkey'
      ? Fingerprint
      : signIn.via === 'sso'
        ? Building2
        : signIn.via === 'link'
          ? Mail
          : UserRound;
  return <Icon aria-hidden />;
}

/** "Product Hunt signs in with Google · ada@gmail.com", and what Conch does about it. */
function signInWords(
  signIn: BrowserSignInOffer,
  title: string,
): { line: ReactNode; hint?: string } {
  const account = signIn.account && <span className={styles.fillHint}> · {signIn.account}</span>;
  const who = <strong>{title}</strong>;
  switch (signIn.via) {
    case 'provider':
      return {
        line: (
          <>
            {who} signs in with {signIn.buttons ? 'another account' : signIn.name}
            {account}
          </>
        ),
        hint: signIn.buttons
          ? 'Which one do you use?'
          : signIn.with
            ? `Conch fills ${signIn.name}’s sign-in from “${signIn.with.title}”.`
            : signIn.button
              ? undefined
              : `Press “Continue with ${signIn.name}” on the page.`,
      };
    case 'sso':
      return {
        line: (
          <>
            {who} signs in through {signIn.name}
            {account}
          </>
        ),
        ...(!signIn.button && { hint: 'Enter your work email to go to your company’s sign-in.' }),
      };
    case 'passkey':
      return signIn.usable === false
        ? {
            line: (
              <>
                {who}’s passkey is in {signIn.keptIn ?? 'another app'}, which this browser can’t
                use.
              </>
            ),
            hint: 'Sign in another way, then Conch can keep a passkey of its own.',
          }
        : {
            line: (
              <>
                {who} signs in with your passkey
                {account}
              </>
            ),
          };
    default:
      return {
        line: (
          <>
            {who} signs in with a link sent by email
            {account}
          </>
        ),
        hint: 'Enter your email: the site sends a link or a code.',
      };
  }
}

/**
 * While you drive the browser, the box you're in can be filled from
 * Passwords in one press: the account to sign in with, a strong new password
 * on a sign-up, the code, a card. A page that only looks like one of your
 * sites says so instead, and offers nothing. A site whose item signs in some
 * other way says how ("Product Hunt signs in with Google"), with the page's
 * own button to press; on Google's pages, that site's account comes first.
 */
export function BrowserFill({
  offer,
  onFill,
  onGenerate,
  onUnlock,
  onSignIn,
  onDismiss,
  className,
  ...props
}: BrowserFillProps) {
  const warning = Boolean(offer.lookalike);
  const close = onDismiss && (
    <IconButton size="sm" variant="ghost" label="Close" onClick={onDismiss}>
      <X />
    </IconButton>
  );
  let body;
  const signIn = offer.signIn;
  const item = offer.items[0];
  if (signIn && item && !offer.lookalike && !offer.blocked && !offer.locked) {
    const { line, hint } = signInWords(signIn, item.title);
    const press = (label?: string) => onSignIn?.(item.id, label);
    const action =
      signIn.via === 'passkey' ? (
        signIn.usable !== false && (
          <Button size="sm" leadingIcon={<Fingerprint />} onClick={() => press()}>
            Use your passkey
          </Button>
        )
      ) : signIn.buttons ? (
        <ul className={styles.fillItems} aria-label="Ways to sign in on this page">
          {signIn.buttons.map((label) => (
            <li key={label}>
              <Button size="sm" variant="surface" onClick={() => press(label)}>
                {label}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        signIn.button &&
        signIn.via !== 'link' && (
          <Button size="sm" onClick={() => press()}>
            {signIn.button}
          </Button>
        )
      );
    // The email for a company sign-in or a link still fills from the item.
    const fills = offer.field !== 'sign-in' && offer.items.length > 0;
    // Its words and buttons wrap together; the close button stays at the end of the bar.
    body = (
      <div className={styles.fillMain}>
        <span className={styles.fillLabel} data-sign-in="">
          <SignInFace signIn={signIn} />
          <span>
            {line}
            {hint && (
              <>
                {' '}
                <span className={styles.fillHintLine}>{hint}</span>
              </>
            )}
          </span>
        </span>
        {fills ? (
          <ul className={styles.fillItems} aria-label="Saved for this site">
            {offer.items.map((i) => (
              <li key={i.id}>
                <Button
                  size="sm"
                  variant="surface"
                  aria-label={`Fill from “${i.title}”${i.account ? `, ${i.account}` : ''}`}
                  onClick={() => onFill?.(i.id)}
                >
                  {i.account || i.title}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          action
        )}
      </div>
    );
  } else if (offer.lookalike) {
    body = (
      <span className={styles.fillLabel}>
        <ShieldAlert aria-hidden />
        <span>
          <strong>This isn’t {offer.lookalike}.</strong> It may be a fake site. Don’t sign in here.
        </span>
      </span>
    );
  } else if (offer.blocked) {
    body = (
      <span className={styles.fillLabel}>
        <ShieldAlert aria-hidden />
        <span>
          {offer.blocked === 'frame'
            ? 'This box comes from another site, so Passwords won’t fill it.'
            : 'This page isn’t secure, so Passwords won’t fill it.'}
        </span>
      </span>
    );
  } else if (offer.locked) {
    body = (
      <>
        <span className={styles.fillLabel}>
          <Lock aria-hidden />
          <span>Passwords is locked.</span>
        </span>
        {onUnlock && (
          <Button size="sm" variant="surface" onClick={onUnlock}>
            Unlock
          </Button>
        )}
      </>
    );
  } else if (offer.field === 'new-password') {
    body = (
      <>
        <span className={styles.fillLabel}>
          <KeyRound aria-hidden />
          <span>
            A strong password, saved in Passwords.{' '}
            <span className={styles.fillHint}>For {offer.site}</span>
          </span>
        </span>
        <Button size="sm" leadingIcon={<Sparkles />} onClick={onGenerate}>
          Use a strong password
        </Button>
      </>
    );
  } else {
    body = (
      <>
        <span className={styles.fillLabel}>
          <KeyRound aria-hidden />
          <span>
            Fill {WHAT[offer.field]} from Passwords
            {offer.for && <span className={styles.fillHint}> · For {offer.for}</span>}
          </span>
        </span>
        <ul className={styles.fillItems} aria-label="Saved for this site">
          {offer.items.map((item) => (
            <li key={item.id}>
              <Button
                size="sm"
                variant="surface"
                aria-label={`Fill from “${item.title}”${item.account ? `, ${item.account}` : ''}`}
                onClick={() => onFill?.(item.id)}
              >
                {item.account || item.title}
              </Button>
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <div
      role="group"
      aria-label="Passwords"
      className={cx(styles.fillBar, className)}
      data-tone={warning || offer.blocked ? 'warning' : undefined}
      {...props}
    >
      {body}
      {close}
    </div>
  );
}
