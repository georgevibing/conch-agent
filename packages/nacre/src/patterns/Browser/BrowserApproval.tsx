import { Check, Download, Globe, KeyRound, ShieldAlert, X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import { GuardNote } from '../Safety';
import styles from './Browser.module.css';
import type { BrowserBox } from './BrowserWindow';

export type BrowserApprovalKind = 'site' | 'high-stakes' | 'download' | 'fill';
export type BrowserApprovalDecision = 'allow' | 'allow-always' | 'deny';

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
  onDecide?: (decision: BrowserApprovalDecision) => void;
}

function heading(kind: BrowserApprovalKind, site: string, action: string, name: string) {
  if (kind === 'site') return `Let ${name} use ${site}?`;
  if (kind === 'fill') return `${action} on ${site}?`;
  if (kind === 'download')
    return `${name} wants to ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
  return `${action}?`;
}

function detail(kind: BrowserApprovalKind, site: string, name: string) {
  if (kind === 'site')
    return `${name} will click and type on ${site} for this task. You can watch, and take over at any time.`;
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
) {
  if (decision === 'expired') return `No answer needed any more · ${action}`;
  if (decision === 'deny') return kind === 'site' ? `Not on ${site}` : `Declined · ${action}`;
  if (kind === 'site')
    return decision === 'allow-always'
      ? `Always allowed on ${site}`
      : `Allowed on ${site} in this chat`;
  if (kind === 'fill')
    return decision === 'allow-always' ? `Filled · always on ${site}` : `Filled · ${action}`;
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
  onDecide,
  className,
  ...props
}: BrowserApprovalProps) {
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
        <span>{resolvedText(decision, kind, site, action)}</span>
      </div>
    );
  }
  const Icon =
    kind === 'site'
      ? Globe
      : kind === 'download'
        ? Download
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
            ? `Fill a saved password on ${site}?`
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
          <p className={styles.approvalTitle}>{heading(kind, site, action, name)}</p>
        </div>
        {kind === 'site' && <p className={styles.approvalAction}>First: {action}</p>}
        <p className={styles.approvalDetail}>{detail(kind, site, name)}</p>
        {guard && <GuardNote>{guard}</GuardNote>}
        <div className={styles.approvalActions}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide?.('deny')}>
            {kind === 'site' || kind === 'fill'
              ? 'Not now'
              : kind === 'download'
                ? 'Don’t download'
                : 'Don’t'}
          </Button>
          {(kind === 'site' || kind === 'fill') && !guard && (
            <Button
              size="sm"
              variant="surface"
              disabled={busy}
              onClick={() => onDecide?.('allow-always')}
            >
              Always for {site}
            </Button>
          )}
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
                : kind === 'fill'
                  ? 'Fill'
                  : 'Allow once'}
          </Button>
        </div>
      </div>
    </div>
  );
}
