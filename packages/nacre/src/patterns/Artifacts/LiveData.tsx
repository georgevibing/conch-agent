import { CloudOff, Globe, Laptop, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useId, useState, type ComponentProps } from 'react';

import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Callout } from '../../components/Callout';
import { Checkbox } from '../../components/Checkbox';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { Popover } from '../../components/Popover';
import { cx } from '../../utils/cx';
import { ago } from '../Healed/HealedNotes';
import styles from './Artifacts.module.css';

/** "Updated 2 min ago", kept current while it's on screen. */
function useAgo(at: number | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(timer);
  }, [at]);
  return at ? ago(at, Math.max(now, at)) : undefined;
}

const every = (seconds: number) =>
  seconds < 3600
    ? `every ${Math.round(seconds / 60)} min`
    : `every ${Math.round(seconds / 3600)} h`;

export interface LiveDataSourceView {
  host: string;
  /** On this computer. */
  local?: boolean;
}

export interface LiveDataBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** `live`: the last read worked. `failed`: it didn't, and the page shows what it had. */
  state: 'live' | 'failed';
  /** When it last read something that worked. */
  updatedAt?: number;
  /** What went wrong, in a sentence ("api.example.com took too long to answer."). */
  problem?: string;
  /** It reads again by itself this often (seconds). */
  everySeconds?: number;
  onRefresh: () => void;
  refreshing?: boolean;
  /** Where it reads from, which you allowed; `onStop` takes one back. */
  sources: LiveDataSourceView[];
  onStop?: (host: string) => void;
}

/**
 * A page that shows live data (ADR 0039): when it last read, how often it
 * reads again, and one press to read now. A failure is calm: the page keeps
 * what it had, and the bar says so in a sentence. "Reads from" lists the
 * sites you allowed, each one a press from taken back.
 */
export function LiveDataBar({
  state,
  updatedAt,
  problem,
  everySeconds,
  onRefresh,
  refreshing,
  sources,
  onStop,
  className,
  ...props
}: LiveDataBarProps) {
  const when = useAgo(updatedAt);
  const failed = state === 'failed';
  return (
    <div className={cx(styles.live, className)} data-state={state} {...props}>
      <span className={styles.liveDot} aria-hidden>
        {failed ? <CloudOff /> : null}
      </span>
      <span className={styles.liveText} role="status">
        {failed ? (
          <>
            Couldn’t update{problem ? `: ${problem}` : '.'}
            {when && <> Showing what it had from {when}.</>}
          </>
        ) : (
          <>
            Live · {when ? `Updated ${when}` : 'Reading…'}
            {everySeconds ? ` · ${every(everySeconds)}` : ''}
          </>
        )}
      </span>
      {sources.length > 0 && (
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button size="sm" variant="ghost" leadingIcon={<Globe />}>
              Reads from
            </Button>
          </Popover.Trigger>
          <Popover.Content align="end" padding="sm" aria-label="Where this page reads from">
            <ul className={styles.liveSources}>
              {sources.map((s) => (
                <li key={s.host}>
                  {s.local ? <Laptop aria-hidden /> : <Globe aria-hidden />}
                  <span className={styles.liveHost}>{s.host}</span>
                  {onStop && (
                    <Button size="sm" variant="ghost" tone="danger" onClick={() => onStop(s.host)}>
                      Stop
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Popover.Content>
        </Popover.Root>
      )}
      <IconButton
        size="sm"
        label={failed ? 'Try again' : 'Update now'}
        onClick={onRefresh}
        disabled={refreshing}
        data-spinning={refreshing || undefined}
        className={styles.liveRefresh}
      >
        <RefreshCw />
      </IconButton>
    </div>
  );
}

export interface LiveDataAskProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** The page's name. */
  title: string;
  host: string;
  /** The addresses on it the page reads, as the page wrote them. */
  urls: string[];
  /** On this computer: it takes a second, explicit yes. */
  local?: boolean;
  /** The host was allowed, but these addresses are new. */
  changed?: boolean;
  /** The chat it was made in read something untrusted, as the guard says it. */
  tainted?: string;
  onAllow: (host: string, local: boolean) => void;
  onDecline: () => void;
  allowing?: boolean;
}

/**
 * The one question a page with live data asks (ADR 0039), in the flow:
 * which site, exactly which addresses, and what it can't do. Once per page
 * and site; a new address asks again.
 */
export function LiveDataAsk({
  title,
  host,
  urls,
  local,
  changed,
  tainted,
  onAllow,
  onDecline,
  allowing,
  className,
  ...props
}: LiveDataAskProps) {
  const [sure, setSure] = useState(false);
  const headingId = useId();
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className={cx(styles.ask, className)}
      data-lustre
      {...props}
    >
      <div className={styles.askHead}>
        <span className={styles.askIcon} aria-hidden>
          {local ? <Laptop /> : <Globe />}
        </span>
        <p id={headingId} className={styles.askTitle}>
          {changed ? (
            <>
              “{title}” now reads a different address on <strong>{host}</strong>. Allow it?
            </>
          ) : (
            <>
              Let “{title}” read live data from <strong>{host}</strong>?
            </>
          )}
        </p>
      </div>
      <p className={styles.askText}>
        It reads only {urls.length === 1 ? 'this address' : 'these addresses'}, without your cookies
        or sign-ins, and nothing else on the page can be sent there:
      </p>
      <ul className={styles.askUrls}>
        {urls.map((u) => (
          <li key={u}>
            <code>{u}</code>
          </li>
        ))}
      </ul>
      {tainted && (
        <Callout tone="warning" icon={<ShieldAlert />} className={styles.askWarn}>
          {tainted} Only allow a site you know.
        </Callout>
      )}
      {local && (
        <Checkbox
          size="sm"
          checked={sure}
          onCheckedChange={(on) => setSure(on === true)}
          label="Let it read from this computer"
          description="This address is a program on this computer, like a dev server. Conch itself stays out of reach."
        />
      )}
      <div className={styles.askActions}>
        <Button size="sm" variant="ghost" onClick={onDecline}>
          Not now
        </Button>
        <Button
          size="sm"
          variant="solid"
          loading={allowing}
          disabled={local && !sure}
          onClick={() => onAllow(host, Boolean(local))}
        >
          Allow
        </Button>
      </div>
    </div>
  );
}

export interface LiveDataApprovalView {
  artifactId: string;
  /** The page's name. */
  title: string;
  host: string;
  local?: boolean;
  /** "Oct 2". */
  when: string;
}

export interface LiveDataListProps extends Omit<ComponentProps<'div'>, 'children'> {
  approvals: LiveDataApprovalView[];
  onRevoke: (approval: LiveDataApprovalView) => void;
  onOpen?: (approval: LiveDataApprovalView) => void;
}

/**
 * Every site a page may read live data from, which you allowed (ADR 0039),
 * each a press from taken back. A page asks again the next time.
 */
export function LiveDataList({
  approvals,
  onRevoke,
  onOpen,
  className,
  ...props
}: LiveDataListProps) {
  if (!approvals.length)
    return (
      <EmptyState
        size="sm"
        icon={<Globe />}
        title="No page reads live data"
        description="When a page the assistant made wants fresh numbers from a site, it asks you first."
        className={className}
      />
    );
  return (
    <div className={cx(styles.liveList, className)} {...props}>
      <ul aria-label="Sites pages may read from">
        {approvals.map((a) => (
          <li key={`${a.artifactId}:${a.host}`} className={styles.liveRow}>
            <span className={styles.liveRowIcon} aria-hidden>
              {a.local ? <Laptop /> : <Globe />}
            </span>
            <span className={styles.liveRowText}>
              <span className={styles.liveHost}>{a.host}</span>
              <span className={styles.liveRowMeta}>
                {onOpen ? (
                  <button type="button" className={styles.liveRowLink} onClick={() => onOpen(a)}>
                    {a.title}
                  </button>
                ) : (
                  a.title
                )}{' '}
                · allowed {a.when}
              </span>
            </span>
            {a.local && <Badge tone="warning">This computer</Badge>}
            <Button
              size="sm"
              variant="ghost"
              tone="danger"
              aria-label={`Take back ${a.host} from ${a.title}`}
              onClick={() => onRevoke(a)}
            >
              Take back
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
