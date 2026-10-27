import { Check, Download, Globe, KeyRound, ShieldAlert, Upload, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { GuardNote } from '../Safety';
import styles from './Browser.module.css';
import type { BrowserBox } from './BrowserWindow';

export type BrowserApprovalKind = 'site' | 'high-stakes' | 'download' | 'fill' | 'upload';
export type BrowserApprovalDecision = 'allow' | 'allow-always' | 'deny';
/** What a fill does: sign in, fill a code, make a new password, fill in a card, or your details. */
export type BrowserFillKind = 'sign-in' | 'code' | 'new-password' | 'card' | 'identity';

/** A saved item to pick, by name: never a value. */
export interface BrowserFillAccount {
  id: string;
  /** The item's name: "Google". */
  title: string;
  /** The account it signs in as, or a card's last four. */
  account?: string;
  /** Another password manager it lives in ("1password"). */
  source?: string;
}

export interface BrowserApprovalProps extends Omit<ComponentProps<'div'>, 'title'> {
  kind: BrowserApprovalKind;
  /** The registrable domain, e.g. "booking.com". */
  site: string;
  /** "Click “Place order”". */
  action: string;
  /** Thumbnail of the page, with `box` marking the control. */
  shot?: string;
  box?: BrowserBox;
  name?: string;
  /** Set once answered: the card becomes a quiet line. */
  decision?: BrowserApprovalDecision | 'expired';
  /**
   * Asked because the chat read something untrusted (ADR 0028): why, shown on
   * the card, and no "Always" is offered.
   */
  guard?: ReactNode;
  /** The answer is on its way. */
  busy?: boolean;
  /** It's your own signed-in Chrome (ADR 0080): said on the card, and never "Always". */
  ownChrome?: boolean;
  /** A task's own browser (ADR 0141): Allow also lends it your sign-in there, until it ends. */
  lendsSignIn?: boolean;
  /** For `fill`: what it does, for the card's words. Sign-ins and codes alone offer "Always". */
  fill?: BrowserFillKind;
  /**
   * For `fill` with several saved accounts: one button each, and pressing one
   * is the answer (`onChoose`, then `onDecide('allow')`).
   */
  accounts?: BrowserFillAccount[];
  /** For `fill`: it's saved for another part of this site ("accounts.google.com"). */
  savedFor?: string;
  /**
   * For `fill` on a provider's page (ADR 0133): the site this sign-in is for,
   * "Product Hunt" when it signs in with Google. One answer covers all of it.
   */
  signingInTo?: string;
  onDecide?: (decision: BrowserApprovalDecision) => void;
  /** One of `accounts` was pressed. */
  onChoose?: (id: string) => void;
}

function heading(
  kind: BrowserApprovalKind,
  site: string,
  action: string,
  name: string,
  fill?: BrowserFillKind,
  signingInTo?: string,
) {
  if (kind === 'site') return `Let ${name} use ${site}?`;
  // "Sign in to “Product Hunt” with Google as ada@gmail.com?": the site's own page is said below.
  if (kind === 'fill' && signingInTo) return `${action}?`;
  if (kind === 'fill' && fill === 'new-password') return `${action}?`;
  if (kind === 'fill') return `${action} on ${site}?`;
  if (kind === 'download')
    return `${name} wants to ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
  if (kind === 'upload') return `${action} to ${site}?`;
  return `${action}?`;
}

function fillDetail(fill: BrowserFillKind | undefined, name: string) {
  switch (fill) {
    case 'sign-in':
      return `Conch types it in from your Passwords, for this whole sign-in. ${name} never sees it.`;
    case 'code':
      return `Conch types the code in from your Passwords. ${name} never sees it.`;
    case 'new-password':
      return `Conch makes it, saves it in your Passwords and types it in. ${name} never sees it.`;
    case 'card':
      return `Conch types the card in from your Passwords. ${name} never sees it.`;
    case 'identity':
      return `Conch types your details into this form from your Passwords, and nowhere else. ${name} never sees them.`;
    default:
      return `Conch types it into the page itself, from your Passwords. ${name} never sees it.`;
  }
}

function detail(
  kind: BrowserApprovalKind,
  site: string,
  name: string,
  ownChrome: boolean,
  lendsSignIn: boolean,
) {
  if (kind === 'site')
    return ownChrome
      ? `${name} will click and type on ${site} in your own Chrome, where you’re signed in, in a tab it opened. You can watch, and take over at any time.`
      : lendsSignIn
        ? `${name} will click and type on ${site} in this task’s own browser, with your sign-in there if you have one, until the task ends. You can watch, and take over at any time.`
        : `${name} will click and type on ${site} for this task. You can watch, and take over at any time.`;
  if (kind === 'upload')
    return `The file leaves this computer and goes to ${site}. Nothing is sent until you decide.`;
  if (kind === 'download') return `It goes to the Downloads folder in your working folder.`;
  if (kind === 'fill')
    return `Conch types it into the page itself, from your Passwords. ${name} never sees it.`;
  return `On ${site}. This could spend money, send something, or be hard to undo. Nothing happens until you decide.`;
}

function resolvedText(
  decision: BrowserApprovalDecision | 'expired',
  kind: BrowserApprovalKind,
  site: string,
  action: string,
  fill?: BrowserFillKind,
) {
  if (decision === 'expired') return `No answer needed any more · ${action}`;
  if (decision === 'deny') return kind === 'site' ? `Not on ${site}` : `Declined · ${action}`;
  if (kind === 'site')
    return decision === 'allow-always'
      ? `Always allowed on ${site}`
      : `Allowed on ${site} in this chat`;
  if (kind === 'fill')
    return decision === 'allow-always'
      ? `Filled · always on ${site}`
      : `${fill === 'new-password' ? 'Saved' : 'Filled'} · ${action}`;
  return `Allowed once · ${action}`;
}

/**
 * The browser's question, in the chat. For a new site it asks once (this chat,
 * or always); for something significant it asks every time and shows the very
 * control on the page, so you know exactly what you're agreeing to.
 */
export function BrowserApproval({
  kind,
  site,
  action,
  shot,
  box,
  name = 'Conch',
  decision,
  guard,
  busy = false,
  ownChrome = false,
  lendsSignIn = false,
  fill,
  accounts,
  savedFor,
  signingInTo,
  onDecide,
  onChoose,
  className,
  ...props
}: BrowserApprovalProps) {
  const choosing = kind === 'fill' && (accounts?.length ?? 0) > 1;
  // "Always" for a sign-in or a code: never a new password or a card, which ask each time.
  const always =
    (kind === 'site' && !ownChrome) ||
    (kind === 'fill' && !choosing && fill !== 'new-password' && fill !== 'card');
  if (decision) {
    const allowed = decision === 'allow' || decision === 'allow-always';
    return (
      <div
        role="note"
        className={cx(styles.approvalDone, className)}
        data-allowed={allowed ? '' : undefined}
        {...props}
      >
        {allowed ? <Check aria-hidden /> : <X aria-hidden />}
        <span>{resolvedText(decision, kind, site, action, fill)}</span>
      </div>
    );
  }
  const Icon =
    kind === 'site'
      ? Globe
      : kind === 'download'
        ? Download
        : kind === 'upload'
          ? Upload
          : kind === 'fill'
            ? KeyRound
            : ShieldAlert;
  return (
    <div
      role="group"
      aria-label={
        kind === 'site'
          ? `Allow ${site}?`
          : kind === 'fill'
            ? fill === 'new-password'
              ? `Make a new password for ${site}?`
              : `Fill from Passwords on ${site}?`
            : kind === 'upload'
              ? `Upload files to ${site}?`
              : 'Confirm an action in the browser'
      }
      className={cx(styles.approval, className)}
      data-kind={kind}
      data-lustre=""
      {...props}
    >
      {shot && (
        <span className={styles.approvalShot}>
          <img src={shot} alt="" draggable={false} />
          {box && (
            <span
              className={styles.approvalBox}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
              aria-hidden
            />
          )}
        </span>
      )}
      <div className={styles.approvalBody}>
        <div className={styles.approvalHead}>
          <span className={styles.approvalIcon} aria-hidden>
            <Icon />
          </span>
          <p className={styles.approvalTitle}>
            {heading(kind, site, action, name, fill, signingInTo)}
          </p>
        </div>
        {kind === 'site' && <p className={styles.approvalAction}>First: {action}</p>}
        <p className={styles.approvalDetail}>
          {kind === 'fill' && signingInTo
            ? `Conch types it in on ${site} from your Passwords, for the whole sign-in to ${signingInTo}. ${name} never sees it.`
            : kind === 'fill'
              ? fillDetail(fill, name)
              : detail(kind, site, name, ownChrome, lendsSignIn)}
          {kind === 'fill' && savedFor && ` It’s saved for ${savedFor}.`}
        </p>
        {guard && <GuardNote>{guard}</GuardNote>}
        {choosing && (
          <ul className={styles.approvalAccounts} aria-label="Saved accounts">
            {accounts?.map((a) => (
              <li key={a.id}>
                <Button
                  size="sm"
                  variant="surface"
                  disabled={busy}
                  className={styles.approvalAccount}
                  leadingIcon={<KeyRound />}
                  onClick={() => {
                    onChoose?.(a.id);
                    onDecide?.('allow');
                  }}
                >
                  <span className={styles.approvalAccountName}>{a.account || a.title}</span>
                  {a.account && <span className={styles.approvalAccountItem}>{a.title}</span>}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.approvalActions}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide?.('deny')}>
            {kind === 'site' || kind === 'fill'
              ? 'Not now'
              : kind === 'download'
                ? 'Don’t download'
                : kind === 'upload'
                  ? 'Don’t upload'
                  : 'Don’t'}
          </Button>
          {always && !guard && (
            <Button
              size="sm"
              variant="surface"
              disabled={busy}
              onClick={() => onDecide?.('allow-always')}
            >
              Always for {site}
            </Button>
          )}
          {!choosing && (
            <Button
              size="sm"
              tone={kind === 'high-stakes' ? 'danger' : undefined}
              loading={busy}
              onClick={() => onDecide?.('allow')}
            >
              {kind === 'site'
                ? 'Allow in this chat'
                : kind === 'download'
                  ? 'Download'
                  : kind === 'upload'
                    ? 'Upload'
                    : kind === 'fill'
                      ? fill === 'new-password'
                        ? 'Make and save it'
                        : fill === 'sign-in'
                          ? 'Sign in'
                          : 'Fill'
                      : 'Allow once'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
