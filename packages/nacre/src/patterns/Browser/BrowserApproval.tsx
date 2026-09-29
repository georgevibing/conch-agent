import { Check, Download, Globe, ShieldAlert, X } from 'lucide-react';
import type { ComponentProps } from 'react';

import { Button } from '../../components/Button';
import { cx } from '../../utils/cx';
import styles from './Browser.module.css';
import type { BrowserBox } from './BrowserWindow';

export type BrowserApprovalKind = 'site' | 'high-stakes' | 'download';
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
  /** The answer is on its way. */
  busy?: boolean;
  onDecide?: (decision: BrowserApprovalDecision) => void;
}

function heading(kind: BrowserApprovalKind, site: string, action: string, name: string) {
  if (kind === 'site') return `Let ${name} use ${site}?`;
  if (kind === 'download')
    return `${name} wants to ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
  return `${action}?`;
}

function detail(kind: BrowserApprovalKind, site: string, name: string) {
  if (kind === 'site')
    return `${name} will click and type on ${site} for this task. You can watch, and take over at any time.`;
  if (kind === 'download') return `It goes to the Downloads folder in your working folder.`;
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
  const Icon = kind === 'site' ? Globe : kind === 'download' ? Download : ShieldAlert;
  return (
    <div
      role="group"
      aria-label={kind === 'site' ? `Allow ${site}?` : 'Confirm an action in the browser'}
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
        <div className={styles.approvalActions}>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecide?.('deny')}>
            {kind === 'site' ? 'Not now' : kind === 'download' ? 'Don’t download' : 'Don’t'}
          </Button>
          {kind === 'site' && (
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
                : 'Allow once'}
          </Button>
        </div>
      </div>
    </div>
  );
}
