import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Check,
  Copy,
  CreditCard,
  Database,
  Eye,
  EyeOff,
  Fingerprint,
  IdCard,
  KeyRound,
  Landmark,
  LockKeyhole,
  LogIn,
  Mail,
  RefreshCw,
  ScrollText,
  Server,
  ShieldAlert,
  ShieldCheck,
  Star,
  StickyNote,
  Terminal,
  Timer,
  UserRound,
  Wallet,
  Wifi,
  X,
} from 'lucide-react';
import { ToggleGroup } from 'radix-ui';
import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Heading } from '../../components/Text';
import { Highlight, type HighlightRange } from '../../components/Highlight';
import { IconButton } from '../../components/IconButton';
import { Pearl } from '../../components/Pearl';
import { Progress } from '../../components/Progress';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Skeleton } from '../../components/Skeleton';
import { Slider } from '../../components/Slider';
import { Switch } from '../../components/Switch';
import { cx } from '../../utils/cx';
import { brandMarks } from '../Integrations/brands';
import { IntegrationLogo } from '../Integrations/IntegrationLogo';
import styles from './Passwords.module.css';
import { META_SEP } from '../../components/MetaList';

// ── Kinds ───────────────────────────────────────────────────────────────────

export type VaultKind =
  | 'login'
  | 'card'
  | 'identity'
  | 'note'
  | 'apiKey'
  | 'wifi'
  | 'bank'
  | 'sshKey'
  | 'server'
  | 'database'
  | 'document'
  | 'license'
  | 'wallet';

const KIND_ICONS: Record<VaultKind, typeof KeyRound> = {
  login: KeyRound,
  card: CreditCard,
  identity: UserRound,
  note: StickyNote,
  apiKey: KeyRound,
  wifi: Wifi,
  bank: Landmark,
  sshKey: Terminal,
  server: Server,
  database: Database,
  document: IdCard,
  license: ScrollText,
  wallet: Wallet,
};

/** Which tint each kind wears (a hue token), so a list reads at a glance. */
const KIND_TONES: Record<VaultKind, string> = {
  login: 'accent',
  card: 'info',
  identity: 'success',
  note: 'warning',
  apiKey: 'accent',
  wifi: 'info',
  bank: 'success',
  sshKey: 'neutral',
  server: 'neutral',
  database: 'neutral',
  document: 'danger',
  license: 'warning',
  wallet: 'warning',
};

/** Where an item lives, when it isn't Conch's own. */
export type VaultSourceKind =
  | 'conch'
  | 'system'
  | '1password'
  | 'bitwarden'
  | 'keepassxc'
  | 'protonpass'
  | 'dashlane'
  | 'keeper'
  | 'keychain';

const SOURCE_NAMES: Record<VaultSourceKind, string> = {
  conch: 'Conch',
  system: 'Keys Conch uses',
  '1password': '1Password',
  bitwarden: 'Bitwarden',
  keepassxc: 'KeePassXC',
  protonpass: 'Proton Pass',
  dashlane: 'Dashlane',
  keeper: 'Keeper',
  keychain: 'macOS Keychain',
};

const SOURCE_COLORS: Record<Exclude<VaultSourceKind, 'conch' | 'system'>, string> = {
  '1password': '#145FE4',
  bitwarden: '#175DDC',
  keepassxc: '#6CAC4D',
  protonpass: '#6D4AFF',
  dashlane: '#0E353D',
  keeper: '#1A1A1A',
  keychain: '#4B4B50',
};

/** A password manager's name, for words around its items. */
export function vaultSourceName(source: VaultSourceKind): string {
  return SOURCE_NAMES[source];
}

/** A password manager's colour, for its logo tile wherever it shows (Apps, ⌘K). */
export function vaultSourceColor(source: VaultSourceKind): string | undefined {
  return source === 'conch' || source === 'system' ? undefined : SOURCE_COLORS[source];
}

export interface VaultItemIconProps extends Omit<ComponentProps<'span'>, 'children'> {
  kind: VaultKind;
  /** For logins: the site, shown as its monogram. */
  domain?: string;
  title: string;
  size?: 'sm' | 'md' | 'lg';
}

/** Labels before the name that say nothing about whose site it is: app.yazio.com is Yazio's. */
const HOST_WORDS = new Set([
  'www',
  'app',
  'apps',
  'my',
  'account',
  'accounts',
  'login',
  'signin',
  'auth',
  'secure',
  'id',
  'portal',
  'web',
  'm',
]);

/** Second-level labels under a country's domain: bbc.co.uk is the BBC's. */
const UNDER_COUNTRY = new Set(['co', 'com', 'org', 'net', 'gov', 'ac', 'edu', 'ne', 'or']);

/** The name a site goes by, for its monogram: "app.yazio.com" → "yazio", "bbc.co.uk" → "bbc". */
export function siteName(domain: string): string {
  const labels = domain.toLowerCase().split('.').filter(Boolean);
  if (labels.length < 2 || labels.every((l) => /^\d+$/.test(l))) return domain;
  let end = labels.length - 1;
  if (end >= 2 && labels[end]?.length === 2 && UNDER_COUNTRY.has(labels[end - 1] ?? '')) end--;
  const name = labels[end - 1];
  if (name && !HOST_WORDS.has(name)) return name;
  return labels.slice(0, end).find((l) => !HOST_WORDS.has(l)) ?? domain;
}

/**
 * An item's face: a site's own monogram tile for a login (never a favicon
 * fetched from the web — that would tell the site you have an account), or a
 * tinted glyph for everything else.
 */
export function VaultItemIcon({
  kind,
  domain,
  title,
  size = 'md',
  className,
  ...props
}: VaultItemIconProps) {
  // A site's own monogram once there's a site; until then, the kind's glyph.
  if (kind === 'login' && domain) {
    return (
      <IntegrationLogo
        name={siteName(domain)}
        size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md'}
        decorative
        className={className}
      />
    );
  }
  const Icon = KIND_ICONS[kind];
  return (
    <span
      aria-hidden
      data-tone={KIND_TONES[kind]}
      data-size={size}
      className={cx(styles.kindIcon, className)}
      {...props}
    >
      <Icon />
    </span>
  );
}

/**
 * A kind's plain glyph, for a menu or the palette's own icon slot (a tile
 * inside a 1rem slot would spill over the label).
 */
export function VaultKindGlyph({ kind }: { kind: VaultKind }) {
  const Icon = KIND_ICONS[kind];
  return <Icon aria-hidden />;
}

/** The small mark of the password manager an item comes from. */
export function VaultSourceMark({
  source,
  size = 'xs',
}: {
  source: VaultSourceKind;
  size?: 'xs' | 'sm' | 'md';
}) {
  if (source === 'conch' || source === 'system') return null;
  return (
    <IntegrationLogo
      brand={source}
      name={SOURCE_NAMES[source]}
      color={SOURCE_COLORS[source]}
      size={size}
      className={styles.sourceMark}
    />
  );
}

/**
 * Where an item lives: Conch's pearl, the password manager's mark, or a lock
 * for the keys Conch uses. On its own it's the size of the text around it and
 * sits on its middle, for a button, a menu or a line of words; `corner` puts
 * it on the corner of a row's tile, cut out by a ring, so every row answers
 * "whose is this?" without taking a word of its width.
 */
export function VaultSourceBadge({
  source,
  corner,
  className,
}: {
  source: VaultSourceKind;
  /** On the corner of an item's tile (a list row). */
  corner?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-source={source}
      data-corner={corner || undefined}
      className={cx(styles.sourceBadge, className)}
      title={SOURCE_NAMES[source]}
    >
      {source === 'system' ? (
        <LockKeyhole />
      ) : source === 'conch' ? (
        <Pearl size="xs" label={null} className={styles.badgePearl} />
      ) : (
        <IntegrationLogo
          brand={source}
          name={SOURCE_NAMES[source]}
          color={SOURCE_COLORS[source]}
          size="xs"
          decorative
          className={styles.sourceBadgeLogo}
        />
      )}
    </span>
  );
}

/** Favourite or not: an outlined star that turns gold, the way the list shows it. */
export function VaultFavoriteButton({
  favorite,
  onToggle,
}: {
  favorite: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      variant="ghost"
      label={favorite ? 'Remove from favourites' : 'Add to favourites'}
      aria-pressed={favorite}
      className={styles.favorite}
      onClick={onToggle}
    >
      <Star />
    </IconButton>
  );
}

// ── List rows ───────────────────────────────────────────────────────────────

export type VaultIssue = 'weak' | 'reused' | 'compromised' | 'no2fa' | 'insecure' | 'expired';

const ISSUE_WORDS: Record<VaultIssue, string> = {
  compromised: 'In a data breach',
  reused: 'Reused',
  weak: 'Weak',
  expired: 'Expired',
  insecure: 'Not secure (http)',
  no2fa: 'Two-factor available',
};

export interface VaultRowProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
  kind: VaultKind;
  title: string;
  subtitle?: string;
  domain?: string;
  source?: VaultSourceKind;
  favorite?: boolean;
  totp?: boolean;
  /** Has a passkey. */
  passkey?: boolean;
  /** Signs in some other way than a password: its glyph at the row's end ("G" for Google). */
  signIn?: VaultSignInShape;
  issues?: VaultIssue[];
  selected?: boolean;
  /** "Deleted 3 days ago" for Recently deleted. */
  note?: string;
  /** What the list is sorted by, after the subtitle: "Used 5 min ago". */
  meta?: string;
  /** The parts of the title a search matched, marked. */
  titleRanges?: readonly HighlightRange[];
  /**
   * Where it lives, as a badge on its tile's corner (Conch's pearl or the
   * manager's mark). A manager's shows unless this is `false`; Conch's own
   * only when it's `true`, for a list that mixes places. The row's name says
   * where it's from either way.
   */
  sourceMark?: boolean;
  /** Where it sits in its own app ("Private" vault), said with where it's from. */
  container?: string;
  /** The list is choosing several: the tile turns into a tick box, and a press ticks it. */
  selecting?: boolean;
  /** Ticked, while `selecting`. */
  checked?: boolean;
}

/** One item in the list: what it is, whose it is, and whether it needs you. */
export function VaultRow({
  kind,
  title,
  subtitle,
  domain,
  source = 'conch',
  favorite,
  totp,
  passkey,
  signIn,
  issues = [],
  selected,
  note,
  meta,
  titleRanges,
  sourceMark,
  container,
  selecting,
  checked,
  className,
  ...props
}: VaultRowProps) {
  const worst = issues.includes('compromised') ? 'compromised' : issues[0];
  // A manager's mark shows unless left out; Conch's own only when the list mixes places.
  const badge = sourceMark ?? source !== 'conch';
  const where =
    source === 'conch'
      ? sourceMark
        ? 'in Conch'
        : undefined
      : `from ${SOURCE_NAMES[source]}${container ? `, ${container}` : ''}`;
  const described = [
    subtitle,
    where,
    favorite ? 'favourite' : undefined,
    signIn ? vaultSignInWords(signIn).replace(/^S/, 's') : undefined,
    totp ? 'has a one-time code' : undefined,
    passkey && signIn?.via !== 'passkey' ? 'has a passkey' : undefined,
    ...issues.map((i) => ISSUE_WORDS[i].toLowerCase()),
    note,
    meta?.toLowerCase(),
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <button
      type="button"
      data-selected={(selecting ? checked : selected) || undefined}
      data-selecting={selecting || undefined}
      aria-current={(!selecting && selected) || undefined}
      aria-pressed={selecting ? Boolean(checked) : undefined}
      aria-label={described ? `${title}, ${described}` : title}
      data-lustre=""
      className={cx(styles.row, className)}
      {...props}
    >
      <span className={styles.rowTile}>
        {selecting ? (
          <span aria-hidden className={styles.rowCheck} data-checked={checked || undefined}>
            {/* The circle holds its tick, so the two stay centred wherever the circle sits. */}
            <span className={styles.rowCheckMark}>{checked && <Check />}</span>
          </span>
        ) : (
          <VaultItemIcon kind={kind} domain={domain} title={title} />
        )}
        {badge && <VaultSourceBadge source={source} corner />}
      </span>
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>
          {/* Its own box, so a long title ends in "…" and the star stays in view. */}
          {titleRanges?.length ? (
            <Highlight className={styles.rowTitleText} text={title} ranges={titleRanges} />
          ) : (
            <span className={styles.rowTitleText}>{title}</span>
          )}
          {favorite && <Star className={styles.star} aria-hidden />}
        </span>
        {(subtitle || note || meta) && (
          <span className={styles.rowSubtitle}>
            {note ?? subtitle}
            {meta && (
              <span className={styles.rowMeta}>
                {(note ?? subtitle) ? ' · ' : ''}
                {meta}
              </span>
            )}
          </span>
        )}
      </span>
      <span className={styles.rowEnd} aria-hidden>
        {signIn && !(signIn.via === 'passkey' && passkey) && (
          <VaultSignInGlyph signIn={signIn} className={styles.rowGlyph} />
        )}
        {passkey && <Fingerprint className={styles.rowGlyph} />}
        {totp && <Timer className={styles.rowGlyph} />}
        {worst && (
          <span className={styles.issueDot} data-issue={worst} title={ISSUE_WORDS[worst]} />
        )}
      </span>
    </button>
  );
}

/** A row's place while the list loads: its tile and its two lines. */
export function VaultRowSkeleton({ className, ...props }: Omit<ComponentProps<'div'>, 'children'>) {
  return (
    <div
      aria-hidden
      data-vault-skeleton="row"
      className={cx(styles.rowSkeleton, className)}
      {...props}
    >
      <Skeleton shape="block" width="2.5rem" height="2.5rem" className={styles.rowSkeletonTile} />
      <span className={styles.rowText}>
        <Skeleton width="46%" />
        <Skeleton width="68%" />
      </span>
    </div>
  );
}

/** The heading over a group of rows ("Favourites", "A", "Previous 7 days"). */
export function VaultListHeading({ className, children, ...props }: ComponentProps<'div'>) {
  // For the eye: each row's own name already says its title, favourite and when.
  return (
    <div aria-hidden className={cx(styles.listHeading, className)} {...props}>
      {children}
    </div>
  );
}

// ── Where items live, and choosing several ─────────────────────────────────

export interface VaultSourceFilterProps extends Omit<
  ComponentProps<'div'>,
  'children' | 'defaultValue' | 'dir'
> {
  /** `all`, or one place. */
  value: VaultSourceKind | 'all';
  onValueChange: (value: VaultSourceKind | 'all') => void;
  /** Each place with items, and how many. */
  sources: { source: VaultSourceKind; count: number }[];
  /** Items everywhere. */
  total: number;
}

/**
 * Which place's items the list shows: everything, Conch's own, or one
 * password manager's. One press each, with how many are there and each
 * place's mark, so it reads at a glance. Arrow keys move between them.
 */
export function VaultSourceFilter({
  value,
  onValueChange,
  sources,
  total,
  className,
  ...props
}: VaultSourceFilterProps) {
  return (
    <div className={cx(styles.sourceFilter, className)} {...props}>
      <ToggleGroup.Root
        type="single"
        value={value}
        onValueChange={(next) => next && onValueChange(next as VaultSourceKind | 'all')}
        aria-label="Show items from"
        className={styles.sourceFilterGroup}
      >
        <ToggleGroup.Item
          value="all"
          className={styles.sourceChip}
          aria-label={`All, ${total} ${total === 1 ? 'item' : 'items'}`}
        >
          All
          <span className={styles.sourceChipCount}>{total}</span>
        </ToggleGroup.Item>
        {sources.map((s) => (
          <ToggleGroup.Item
            key={s.source}
            value={s.source}
            className={styles.sourceChip}
            aria-label={`${SOURCE_NAMES[s.source]}, ${s.count} ${s.count === 1 ? 'item' : 'items'}`}
          >
            <VaultSourceBadge source={s.source} />
            {SOURCE_NAMES[s.source]}
            <span className={styles.sourceChipCount}>{s.count}</span>
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  );
}

export interface VaultSelectionBarProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How many are ticked. */
  count: number;
  /** How many the list shows, for "Select all". */
  total: number;
  onSelectAll: () => void;
  onDone: () => void;
  /** What can be done with them: buttons, each saying how many it applies to. */
  actions?: ReactNode;
}

/**
 * The bar over the list while several are chosen: how many, Select all,
 * what can be done with them, and Done. Its count is read out as it changes.
 */
export function VaultSelectionBar({
  count,
  total,
  onSelectAll,
  onDone,
  actions,
  className,
  ...props
}: VaultSelectionBarProps) {
  return (
    <div
      role="group"
      aria-label="Chosen items"
      className={cx(styles.selectionBar, className)}
      {...props}
    >
      <div className={styles.selectionTop}>
        <span className={styles.selectionCount} aria-live="polite">
          {count === 0 ? 'Choose items' : `${count} chosen`}
        </span>
        {count < total && (
          <Button size="sm" variant="ghost" onClick={onSelectAll}>
            Select all {total}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
      {actions && <div className={styles.selectionActions}>{actions}</div>}
    </div>
  );
}

// ── Fields ──────────────────────────────────────────────────────────────────

const STRENGTH_WORDS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

export interface VaultFieldRowProps extends Omit<ComponentProps<'div'>, 'children' | 'onCopy'> {
  label: string;
  /** Shown as is (for fields that aren't secret). */
  value?: string;
  /** A secret: hidden until revealed. `onReveal` fetches it. */
  concealed?: boolean;
  onReveal?: () => Promise<string>;
  /**
   * Copy it: Conch's own copy handles clearing the clipboard. Gets the value
   * already shown, if it is, so it isn't fetched twice.
   */
  onCopy?: (shown?: string) => void | Promise<void>;
  /** For passwords: 0–4. */
  strength?: number;
  mono?: boolean;
  multiline?: boolean;
  /** A link for web addresses. */
  href?: string;
  /** Hide a revealed value again after this long (ms). */
  hideAfter?: number;
  /** Extra controls at the end (e.g. "History"). */
  actions?: ReactNode;
}

/**
 * One field of an item. Secrets stay as dots until you ask (Show, or ⌥-click),
 * then hide again by themselves after thirty seconds or when the tab is
 * hidden. Copy is always one click away and never shows the value.
 */
export function VaultFieldRow({
  label,
  value,
  concealed = false,
  onReveal,
  onCopy,
  strength,
  mono = false,
  multiline = false,
  href,
  hideAfter = 30_000,
  actions,
  className,
  ...props
}: VaultFieldRowProps) {
  const [shown, setShown] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const labelId = useId();

  useEffect(() => {
    if (shown === undefined) return;
    const timer = setTimeout(() => setShown(undefined), hideAfter);
    const hide = () => document.visibilityState === 'hidden' && setShown(undefined);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', hide);
    };
  }, [shown, hideAfter]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const toggle = async () => {
    if (shown !== undefined) return setShown(undefined);
    if (!onReveal) return;
    setBusy(true);
    try {
      setShown(await onReveal());
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (copying) return;
    // Getting a secret can take a moment (another app's vault): say so as it happens.
    setCopying(true);
    try {
      await onCopy?.(shown);
      setCopied(true);
    } finally {
      setCopying(false);
    }
  };
  const fetching = busy || copying;

  const text = concealed ? shown : value;
  return (
    <div role="group" aria-labelledby={labelId} className={cx(styles.field, className)} {...props}>
      <div className={styles.fieldMain}>
        <span id={labelId} className={styles.fieldLabel}>
          {label}
        </span>
        {concealed && text === undefined ? (
          <span
            className={styles.dots}
            data-fetching={fetching || undefined}
            aria-label={fetching ? 'Getting it…' : 'Hidden'}
          >
            ••••••••••••
          </span>
        ) : href && text ? (
          <a className={styles.fieldValue} href={href} target="_blank" rel="noreferrer noopener">
            {text}
          </a>
        ) : (
          <span
            className={styles.fieldValue}
            data-mono={mono || concealed || undefined}
            data-multiline={multiline || undefined}
          >
            {text}
          </span>
        )}
        {strength !== undefined && (
          <span className={styles.strength} data-score={strength}>
            <span className={styles.strengthBar} aria-hidden>
              {[0, 1, 2, 3].map((i) => (
                <span key={i} data-on={i < Math.max(1, strength) || undefined} />
              ))}
            </span>
            {STRENGTH_WORDS[strength] ?? ''}
          </span>
        )}
      </div>
      <div className={styles.fieldActions}>
        {actions}
        {concealed && onReveal && (
          <IconButton
            size="sm"
            label={
              text === undefined ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`
            }
            loading={busy}
            onClick={() => void toggle()}
          >
            {text === undefined ? <Eye /> : <EyeOff />}
          </IconButton>
        )}
        {onCopy && (
          <IconButton
            size="sm"
            label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
            loading={copying}
            onClick={() => void copy()}
          >
            {copied ? <Check /> : <Copy />}
          </IconButton>
        )}
      </div>
    </div>
  );
}

export interface VaultFieldsSkeletonProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How many fields to hold a place for. */
  rows?: number;
}

/**
 * An item's fields while they're fetched (another app's vault can take a
 * moment): the same rows, a label and a value each, so nothing moves when
 * they arrive. It waits a beat before showing, so a quick answer never flashes.
 */
export function VaultFieldsSkeleton({ rows = 3, className, ...props }: VaultFieldsSkeletonProps) {
  return (
    <div aria-hidden className={cx(styles.fieldsSkeleton, className)} {...props}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} data-vault-skeleton="field" className={styles.field}>
          <div className={styles.fieldMain}>
            <Skeleton width="4.5rem" className={styles.fieldSkeletonLabel} />
            <Skeleton width={i % 2 ? '38%' : '56%'} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── One-time codes ──────────────────────────────────────────────────────────

export interface TotpCodeProps extends Omit<ComponentProps<'div'>, 'children' | 'onCopy'> {
  label?: string;
  code?: string;
  period: number;
  /** Epoch ms the code stops working. */
  expiresAt?: number;
  /** Fetch the code (on first show, and when it runs out). */
  onFetch: () => Promise<{ code: string; period: number; expiresAt: number }>;
  onCopy?: (code: string) => void | Promise<void>;
}

/**
 * The current one-time code, split for reading ("123 456"), with a ring that
 * empties as it runs out and turns amber in its last five seconds. A new code
 * is fetched by itself when the old one ends.
 */
export function TotpCode({
  label = 'One-time code',
  period: initialPeriod,
  onFetch,
  onCopy,
  className,
  ...props
}: TotpCodeProps) {
  const [state, setState] = useState<{ code: string; period: number; expiresAt: number }>();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string>();
  const fetching = useRef(false);
  const labelId = useId();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (fetching.current) return;
    if (state && now < state.expiresAt) return;
    fetching.current = true;
    onFetch()
      .then((next) => {
        setState(next);
        setError(undefined);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => (fetching.current = false));
  }, [now, state, onFetch]);

  const period = state?.period ?? initialPeriod;
  const left = state ? Math.max(0, (state.expiresAt - now) / 1000) : period;
  const fraction = Math.min(1, left / period);
  const code = state?.code;
  const shown = code
    ? `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`
    : '••• •••';
  return (
    <div role="group" aria-labelledby={labelId} className={cx(styles.field, className)} {...props}>
      <div className={styles.fieldMain}>
        <span id={labelId} className={styles.fieldLabel}>
          {label}
        </span>
        <span className={styles.totp}>
          <span className={styles.totpCode} data-mono="" aria-live="polite">
            {error ? <span className={styles.fieldError}>{error}</span> : shown}
          </span>
          {!error && (
            <svg
              className={styles.totpRing}
              viewBox="0 0 20 20"
              data-ending={left <= 5 || undefined}
              role="img"
              aria-label={`${Math.ceil(left)} seconds left`}
            >
              <circle cx="10" cy="10" r="8" className={styles.totpTrack} />
              <circle
                cx="10"
                cy="10"
                r="8"
                pathLength={100}
                className={styles.totpValue}
                strokeDasharray={`${(fraction * 100).toFixed(2)} 100`}
              />
            </svg>
          )}
        </span>
      </div>
      <div className={styles.fieldActions}>
        {onCopy && code && (
          <IconButton size="sm" label="Copy code" onClick={() => void onCopy(code)}>
            <Copy />
          </IconButton>
        )}
      </div>
    </div>
  );
}

// ── Generator ───────────────────────────────────────────────────────────────

export interface GeneratorSettings {
  style: 'random' | 'words' | 'pin';
  length: number;
  symbols: boolean;
  digits: boolean;
  unambiguous: boolean;
}

export interface PasswordGeneratorProps extends Omit<ComponentProps<'div'>, 'onChange' | 'onCopy'> {
  settings: GeneratorSettings;
  onSettingsChange: (settings: GeneratorSettings) => void;
  /** Make a password from the settings (Conch's shared generator). */
  generate: (settings: GeneratorSettings) => string;
  /** 0–4, for the meter under it. */
  score?: (password: string) => number;
  onUse?: (password: string) => void;
  onCopy?: (password: string) => void;
}

const RANGES = { random: [8, 64], words: [3, 12], pin: [4, 12] } as const;
const DEFAULT_LENGTH = { random: 20, words: 5, pin: 6 } as const;

/**
 * A new password, made as you watch. Random, words you can say aloud, or a
 * PIN; digits and symbols coloured so they're easy to read back. Changing a
 * setting makes a new one.
 */
export function PasswordGenerator({
  settings,
  onSettingsChange,
  generate,
  score,
  onUse,
  onCopy,
  className,
  ...props
}: PasswordGeneratorProps) {
  const [value, setValue] = useState(() => generate(settings));
  const key = JSON.stringify(settings);
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    setValue(generate(settings));
  }, [key, generate, settings]);

  const [min, max] = RANGES[settings.style];
  const strength = score?.(value);
  const set = (patch: Partial<GeneratorSettings>) => onSettingsChange({ ...settings, ...patch });
  return (
    <div className={cx(styles.generator, className)} {...props}>
      <div className={styles.generatorValue} aria-live="polite" aria-label="New password">
        {Array.from(value).map((c, i) => (
          <span
            key={i}
            data-class={/\d/.test(c) ? 'digit' : /[A-Za-z]/.test(c) ? undefined : 'symbol'}
          >
            {c}
          </span>
        ))}
      </div>
      {strength !== undefined && (
        <span className={styles.strength} data-score={strength}>
          <span className={styles.strengthBar} aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} data-on={i < Math.max(1, strength) || undefined} />
            ))}
          </span>
          {STRENGTH_WORDS[strength] ?? ''}
        </span>
      )}
      <SegmentedControl
        size="sm"
        block
        aria-label="Kind of password"
        value={settings.style}
        onValueChange={(style) => {
          const next = style as GeneratorSettings['style'];
          set({ style: next, length: DEFAULT_LENGTH[next] });
        }}
      >
        <SegmentedControl.Item value="random">Random</SegmentedControl.Item>
        <SegmentedControl.Item value="words">Words</SegmentedControl.Item>
        <SegmentedControl.Item value="pin">PIN</SegmentedControl.Item>
      </SegmentedControl>
      <label className={styles.generatorLength}>
        <span>
          {settings.style === 'words'
            ? 'Words'
            : settings.style === 'pin'
              ? 'Digits'
              : 'Characters'}
        </span>
        <Slider
          size="sm"
          min={min}
          max={max}
          step={1}
          value={[settings.length]}
          onValueChange={([length]) => length && set({ length })}
          showValue="always"
          thumbLabels={['Length']}
        />
      </label>
      {settings.style !== 'pin' && (
        <div className={styles.generatorSwitches}>
          {settings.style === 'random' && (
            <Switch
              size="sm"
              label="Symbols"
              checked={settings.symbols}
              onCheckedChange={(symbols) => set({ symbols })}
            />
          )}
          <Switch
            size="sm"
            label={settings.style === 'words' ? 'A number' : 'Digits'}
            checked={settings.digits}
            onCheckedChange={(digits) => set({ digits })}
          />
          {settings.style === 'random' && (
            <Switch
              size="sm"
              label="No look-alikes"
              description="Leaves out 0/O, 1/l/I"
              checked={settings.unambiguous}
              onCheckedChange={(unambiguous) => set({ unambiguous })}
            />
          )}
        </div>
      )}
      <div className={styles.generatorActions}>
        <IconButton size="sm" label="Make another" onClick={() => setValue(generate(settings))}>
          <RefreshCw />
        </IconButton>
        {onCopy && (
          <IconButton size="sm" label="Copy" onClick={() => onCopy(value)}>
            <Copy />
          </IconButton>
        )}
        {onUse && (
          <button
            type="button"
            className={styles.generatorUse}
            data-lustre=""
            onClick={() => onUse(value)}
          >
            Use this password
          </button>
        )}
      </div>
    </div>
  );
}

// ── Security check ──────────────────────────────────────────────────────────

export interface VaultHealthProps extends Omit<ComponentProps<'section'>, 'onSelect'> {
  compromised: number;
  reused: number;
  weak: number;
  expired?: number;
  insecure?: number;
  /** Total items checked, for the all-clear line. */
  total: number;
  /** "Checked for breaches 2 days ago". */
  checkedNote?: string;
  onSelect?: (issue: VaultIssue) => void;
  /** The "Check for breaches" control. */
  action?: ReactNode;
}

/**
 * The Security check: what needs attention, worst first, each a filter. When
 * there's nothing, it says so warmly instead of showing zeros.
 */
export function VaultHealth({
  compromised,
  reused,
  weak,
  expired = 0,
  insecure = 0,
  total,
  checkedNote,
  onSelect,
  action,
  className,
  ...props
}: VaultHealthProps) {
  const tiles: { issue: VaultIssue; count: number; title: string; hint: string }[] = [
    {
      issue: 'compromised',
      count: compromised,
      title: 'In a data breach',
      hint: 'Change these first',
    },
    { issue: 'reused', count: reused, title: 'Reused', hint: 'One leak opens the others' },
    { issue: 'weak', count: weak, title: 'Weak', hint: 'Easy to guess' },
    { issue: 'expired', count: expired, title: 'Expired', hint: 'Cards and documents' },
    { issue: 'insecure', count: insecure, title: 'Not secure', hint: 'Sites without https' },
  ];
  const shown = tiles.filter((t) => t.count > 0);
  const clear = shown.length === 0;
  return (
    <section
      aria-label="Security check"
      className={cx(styles.health, className)}
      data-clear={clear || undefined}
      {...props}
    >
      <div className={styles.healthHead}>
        <span className={styles.healthIcon} aria-hidden>
          {clear ? <ShieldCheck /> : <ShieldAlert />}
        </span>
        <div className={styles.healthText}>
          <span className={styles.healthTitle}>
            {clear
              ? total
                ? 'Your passwords look good'
                : 'Nothing to check yet'
              : `${shown.reduce((n, t) => n + t.count, 0)} ${shown.reduce((n, t) => n + t.count, 0) === 1 ? 'thing needs' : 'things need'} attention`}
          </span>
          {checkedNote && <span className={styles.healthNote}>{checkedNote}</span>}
        </div>
        {action && <div className={styles.healthAction}>{action}</div>}
      </div>
      {!clear && (
        <ul className={styles.healthTiles}>
          {shown.map((t) => (
            <li key={t.issue}>
              <button
                type="button"
                className={styles.healthTile}
                data-issue={t.issue}
                onClick={() => onSelect?.(t.issue)}
              >
                <span className={styles.healthDot} aria-hidden />
                <span className={styles.healthLabel}>{t.title}</span>
                <span className={styles.healthHint}>{t.hint}</span>
                <span className={styles.healthCount}>{t.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────

export interface VaultSourceRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  source: VaultSourceKind;
  state: 'ready' | 'locked' | 'missing' | 'error' | 'off';
  message?: string;
  count?: number;
  /** The one button for its state: Turn on, Unlock, Install… */
  action?: ReactNode;
  /** Kept unlocked on this computer: it opens by itself when Conch starts. */
  keptUnlocked?: boolean;
  /** How Conch reaches it, in a few words: “Service account · 2 vaults”. */
  via?: string;
  /** Its items are copied into Conch's vault (and kept up to date while `enabled`). */
  sync?: { enabled: boolean; copies: number; when?: string; problem?: string; running?: boolean };
}

const STATE_WORDS: Record<VaultSourceRowProps['state'], string> = {
  ready: 'Connected',
  locked: 'Locked',
  missing: 'Not installed',
  error: 'Needs attention',
  off: 'Off',
};

/** A password manager Passwords can show: its mark, how it is, and one button. */
export function VaultSourceRow({
  source,
  state,
  message,
  count,
  action,
  sync,
  keptUnlocked,
  via,
  className,
  ...props
}: VaultSourceRowProps) {
  const Icon =
    state === 'locked'
      ? LockKeyhole
      : state === 'error'
        ? AlertTriangle
        : state === 'ready'
          ? BadgeCheck
          : undefined;
  // What to do about it gets a line of its own, under the name: beside the
  // state and the button it would be squeezed into a sliver.
  const hint = message && state !== 'ready' ? message : undefined;
  return (
    <div className={cx(styles.source, className)} data-state={state} {...props}>
      <div className={styles.sourceBody}>
        <span className={styles.sourceIcon}>
          {source === 'conch' || source === 'system' ? (
            <span className={styles.conchMark} aria-hidden>
              <KeyRound />
            </span>
          ) : (
            <VaultSourceMark source={source} size="md" />
          )}
        </span>
        <div className={styles.sourceText}>
          <span className={styles.sourceName}>{SOURCE_NAMES[source]}</span>
          <span className={styles.sourceState}>
            <span className={styles.sourceLabel}>
              {Icon && <Icon aria-hidden />}
              {state === 'ready' && count !== undefined
                ? `${count} ${count === 1 ? 'item' : 'items'}`
                : STATE_WORDS[state]}
            </span>
            {via && state !== 'off' && <span className={styles.sourceMessage}>· {via}</span>}
            {keptUnlocked && state === 'ready' && (
              <span className={styles.sourceMessage}>· Stays unlocked on this computer</span>
            )}
          </span>
        </div>
        {action && <div className={styles.sourceAction}>{action}</div>}
        {hint && <span className={styles.sourceHint}>{hint}</span>}
        {sync && (sync.enabled || sync.copies > 0) && (
          <span className={styles.sourceSync} data-problem={sync.problem ? '' : undefined}>
            <RefreshCw aria-hidden data-spinning={sync.running || undefined} />
            {sync.running
              ? 'Copying into Conch…'
              : sync.problem
                ? `Couldn’t bring copies up to date: ${sync.problem}`
                : sync.enabled
                  ? `${sync.copies} ${sync.copies === 1 ? 'copy' : 'copies'} in Conch, kept up to date${sync.when ? ` · ${sync.when}` : ''}`
                  : `${sync.copies} ${sync.copies === 1 ? 'copy' : 'copies'} in Conch`}
          </span>
        )}
      </div>
    </div>
  );
}

export interface VaultConnectedSourcesProps extends Omit<ComponentProps<'div'>, 'children'> {
  sources: {
    source: Exclude<VaultSourceKind, 'conch' | 'system'>;
    state: VaultSourceRowProps['state'];
    count?: number;
  }[];
  /** Open that manager's settings (unlock it, copy from it, turn it off). */
  onOpen: (source: Exclude<VaultSourceKind, 'conch' | 'system'>) => void;
}

/** The password managers shown alongside Conch's own, at a glance: one quiet chip each. */
export function VaultConnectedSources({
  sources,
  onOpen,
  className,
  ...props
}: VaultConnectedSourcesProps) {
  if (!sources.length) return null;
  return (
    <div className={cx(styles.connected, className)} {...props}>
      <span className={styles.connectedLabel}>Also showing</span>
      <ul className={styles.connectedList}>
        {sources.map((s) => {
          const state =
            s.state === 'ready'
              ? s.count !== undefined
                ? `${s.count} ${s.count === 1 ? 'item' : 'items'}`
                : 'Connected'
              : STATE_WORDS[s.state];
          return (
            <li key={s.source}>
              <button
                type="button"
                className={styles.connectedChip}
                data-state={s.state}
                aria-label={`${SOURCE_NAMES[s.source]}: ${state}`}
                onClick={() => onOpen(s.source)}
              >
                <VaultSourceMark source={s.source} size="xs" />
                <span className={styles.connectedName}>{SOURCE_NAMES[s.source]}</span>
                <span className={styles.connectedState}>
                  {s.state === 'locked' && <LockKeyhole aria-hidden />}
                  {s.state === 'error' && <AlertTriangle aria-hidden />}
                  {state}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Passkeys ────────────────────────────────────────────────────────────────

export interface VaultPasskeyRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** The site it signs in to. */
  site: string;
  userName?: string;
  /** "Used yesterday", "Never used". */
  when?: string;
  /** Remove, for Conch's own items. */
  action?: ReactNode;
}

/** A passkey kept with a login: its site, account, last use. Its key is never shown. */
export function VaultPasskeyRow({
  site,
  userName,
  when,
  action,
  className,
  ...props
}: VaultPasskeyRowProps) {
  return (
    <div className={cx(styles.passkey, className)} {...props}>
      <span className={styles.passkeyMark} aria-hidden>
        <Fingerprint />
      </span>
      <div className={styles.sourceText}>
        <span className={styles.sourceName}>Passkey for {site}</span>
        <span className={styles.sourceState}>
          {[userName, when].filter(Boolean).join(META_SEP) || 'Signs in without a password'}
        </span>
      </div>
      {action && <div className={styles.sourceAction}>{action}</div>}
    </div>
  );
}

// ── How an item signs in ────────────────────────────────────────────────────

/**
 * How an account signs in when it isn't (only) a password: through another
 * account ("Sign in with Google"), a passkey, a company's single sign-on, or a
 * link or code sent by email. (Mirrors `VaultSignIn` in @conch/protocol;
 * Nacre stays dependency-free.)
 */
export interface VaultSignInShape {
  via: 'provider' | 'passkey' | 'sso' | 'link';
  /** For `provider`: whose account, by the id its mark goes by (`google`, `apple`…). */
  provider?: string;
  /** Who, in words: "Google", "Acme SSO". */
  name?: string;
  /** The account there, usually an email. Not a secret. */
  account?: string;
  /** For a passkey: Conch can sign in with it itself. */
  usable?: boolean;
}

/** Each provider's colour, for its tile (the mark is white on it, like an app icon). */
const SIGN_IN_COLORS: Record<string, string> = {
  google: '#4285F4',
  apple: '#000000',
  microsoft: '#737373',
  facebook: '#0866FF',
  github: '#181717',
  gitlab: '#FC6D26',
  x: '#000000',
  linkedin: '#0A66C2',
  amazon: '#FF9900',
  discord: '#5865F2',
  okta: '#007DC1',
};

const SIGN_IN_GLYPHS = {
  provider: LogIn,
  passkey: Fingerprint,
  sso: Building2,
  link: Mail,
} as const;

/** Who it signs in through, in words: "Google", "Acme SSO", "a passkey". */
function signInWho(signIn: VaultSignInShape): string {
  if (signIn.via === 'passkey') return 'a passkey';
  if (signIn.via === 'link') return 'an emailed link or code';
  return signIn.name || (signIn.via === 'sso' ? 'single sign-on' : 'another account');
}

/** "Signs in with Google", "Signs in with a passkey": for a row's name and the words around it. */
export function vaultSignInWords(signIn: VaultSignInShape): string {
  return `Signs in with ${signInWho(signIn)}`;
}

/**
 * The face of a sign-in method: the provider's own mark on its colour
 * ("G" for Google), or a tinted glyph for a passkey, single sign-on or an
 * emailed link. Bundled, never fetched.
 */
export function VaultSignInMark({
  signIn,
  size = 'sm',
  className,
}: {
  signIn: VaultSignInShape;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}) {
  const id = signIn.via === 'provider' && signIn.provider !== 'other' ? signIn.provider : undefined;
  // A provider by its mark, or by its name's monogram; one nobody named, by a glyph.
  if (id || (signIn.via === 'provider' && signIn.name)) {
    return (
      <IntegrationLogo
        brand={id}
        name={signInWho(signIn)}
        color={id ? SIGN_IN_COLORS[id] : undefined}
        size={size}
        decorative
        className={cx(styles.signInMark, className)}
      />
    );
  }
  const Icon = SIGN_IN_GLYPHS[signIn.via];
  return (
    <span
      aria-hidden
      data-via={signIn.via}
      data-size={size}
      className={cx(styles.signInGlyphTile, className)}
    >
      <Icon />
    </span>
  );
}

/**
 * A sign-in method's plain glyph, the size of the text around it: the
 * provider's mark in one colour, for a list row's end, a menu or a choice.
 */
export function VaultSignInGlyph({
  signIn,
  className,
}: {
  signIn: VaultSignInShape;
  className?: string;
}) {
  const path =
    signIn.via === 'provider' && signIn.provider ? brandMarks[signIn.provider] : undefined;
  if (path)
    return (
      <svg viewBox="0 0 24 24" aria-hidden className={cx(styles.signInGlyph, className)}>
        <path d={path} fill="currentColor" />
      </svg>
    );
  const Icon = SIGN_IN_GLYPHS[signIn.via];
  return <Icon aria-hidden className={cx(styles.signInGlyph, className)} />;
}

export interface VaultSignInRowProps extends Omit<ComponentProps<'div'>, 'children'> {
  signIn: VaultSignInShape;
  /**
   * For a passkey Conch can't use: the app it's kept in ("1Password"), so
   * the row can say where to sign in from.
   */
  keptIn?: string;
  /** A quiet line under the account: "No Google login saved". */
  hint?: string;
  /** One button at the end: open the Google login Conch would use. */
  action?: ReactNode;
  /** Copy the account (an email isn't a secret, so it's copied as is). */
  onCopyAccount?: () => void | Promise<void>;
}

/**
 * How an item signs in, as the first row of its fields when it isn't a
 * password: "Signs in with Google" with the provider's mark, the account,
 * and the one thing to do next (open the Google login it uses). A passkey
 * kept where Conch can't reach it says so, in a few words.
 */
export function VaultSignInRow({
  signIn,
  keptIn,
  hint,
  action,
  onCopyAccount,
  className,
  ...props
}: VaultSignInRowProps) {
  const labelId = useId();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const out =
    signIn.via === 'passkey' && signIn.usable === false
      ? keptIn
        ? `Only in ${keptIn}, out of Conch’s reach`
        : 'Kept where Conch can’t use it'
      : undefined;
  const note = out ?? hint;
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      data-via={signIn.via}
      data-action={action ? '' : undefined}
      className={cx(styles.field, styles.signIn, className)}
      {...props}
    >
      <VaultSignInMark signIn={signIn} />
      <div className={styles.fieldMain}>
        <span id={labelId} className={styles.signInTitle}>
          {vaultSignInWords(signIn)}
        </span>
        {signIn.account && <span className={styles.signInAccount}>{signIn.account}</span>}
        {note && (
          <span className={styles.signInNote} data-out={out ? '' : undefined}>
            {out && <AlertTriangle aria-hidden />}
            {note}
          </span>
        )}
      </div>
      {(onCopyAccount || action) && (
        <div className={styles.fieldActions}>
          {onCopyAccount && signIn.account && (
            <IconButton
              size="sm"
              label={copied ? 'Copied' : 'Copy account'}
              onClick={() => void Promise.resolve(onCopyAccount()).then(() => setCopied(true))}
            >
              {copied ? <Check /> : <Copy />}
            </IconButton>
          )}
          {action}
        </div>
      )}
    </div>
  );
}

// ── An item's page ──────────────────────────────────────────────────────────

export interface VaultItemHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Its face: a `VaultItemIcon` at `lg`. */
  icon: ReactNode;
  title: ReactNode;
  /** A short line of facts under the name: "Login", "Edited 3 days ago". Empty ones are left out. */
  meta?: readonly (string | false | null | undefined)[];
  /** Favourite, Edit, More… Beside the name where there's room, under it on a phone. */
  actions?: ReactNode;
}

/**
 * The top of an item's page: its face, its name, one short line of facts,
 * and what you can do with it. Where the pane is narrow (a phone), the
 * buttons move under the name instead of squeezing it into a sliver.
 */
export function VaultItemHeader({
  icon,
  title,
  meta = [],
  actions,
  className,
  ...props
}: VaultItemHeaderProps) {
  const facts = meta.filter((m): m is string => Boolean(m));
  return (
    // A div, not a header: inside the app's page, a second banner landmark would say nothing.
    <div className={cx(styles.itemHeader, className)} {...props}>
      <div className={styles.itemHeaderBody}>
        <span className={styles.itemHeaderIcon}>{icon}</span>
        <div className={styles.itemHeaderText}>
          <Heading level={2} size="xl" className={styles.itemHeaderTitle}>
            {title}
          </Heading>
          {facts.length > 0 && (
            <span className={styles.itemHeaderMeta}>{facts.join(META_SEP)}</span>
          )}
        </div>
        {actions && <div className={styles.itemHeaderActions}>{actions}</div>}
      </div>
    </div>
  );
}

export interface VaultSourceStripProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** Whose it is: the badge at its start. */
  source: VaultSourceKind;
  /** What to know, in a few words: "Stored in 1Password". */
  label: string;
  /** After it, quieter: the vault ("Private"), when it was synced. */
  detail?: string;
  /** The one thing to do about it: Copy into Conch, Open 1Password, the other copy. */
  action?: ReactNode;
}

/**
 * Where an item lives, in one quiet line under its name: the place's mark,
 * a few words, and at most one or two buttons. It replaces a paragraph: an
 * item from 1Password reads "Stored in 1Password · Private" with **Copy into
 * Conch** beside it, and nothing more.
 */
export function VaultSourceStrip({
  source,
  label,
  detail,
  action,
  className,
  ...props
}: VaultSourceStripProps) {
  return (
    <div role="note" className={cx(styles.strip, className)} data-source={source} {...props}>
      <span className={styles.stripText}>
        <VaultSourceBadge source={source} className={styles.stripBadge} />
        <span>
          <span className={styles.stripLabel}>{label}</span>
          {detail && <span className={styles.stripDetail}>{`${META_SEP}${detail}`}</span>}
        </span>
      </span>
      {action && <span className={styles.stripAction}>{action}</span>}
    </div>
  );
}

// ── Moving in ───────────────────────────────────────────────────────────────

export interface VaultTransferProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  source: Exclude<VaultSourceKind, 'conch' | 'system'>;
  state: 'running' | 'done' | 'failed' | 'cancelled';
  total: number;
  done: number;
  copied: number;
  updated: number;
  skipped: number;
  failed?: { title: string; message: string }[];
  /** Why the whole copy stopped. */
  message?: string;
  /** Stop (while running) or Done. */
  action?: ReactNode;
}

/**
 * A copy from another password manager into Conch's vault, as it goes: how
 * far, what came in, and anything that couldn't be read, by name.
 */
export function VaultTransferProgress({
  source,
  state,
  total,
  done,
  copied,
  updated,
  skipped,
  failed = [],
  message,
  action,
  className,
  ...props
}: VaultTransferProgressProps) {
  const name = SOURCE_NAMES[source];
  const title =
    state === 'running'
      ? `Copying from ${name}…`
      : state === 'done'
        ? copied + updated > 0
          ? `Copied from ${name}`
          : `Everything from ${name} is already here`
        : state === 'cancelled'
          ? 'Stopped'
          : `Couldn’t copy from ${name}`;
  const counts = [
    copied && `${copied} copied`,
    updated && `${updated} brought up to date`,
    skipped && `${skipped} already here`,
    failed.length && `${failed.length} couldn’t be read`,
  ]
    .filter(Boolean)
    .join(META_SEP);
  return (
    <div className={cx(styles.transfer, className)} data-state={state} {...props}>
      <div className={styles.transferHead}>
        <VaultSourceMark source={source} size="md" />
        <div className={styles.sourceText}>
          <span className={styles.sourceName} role="status">
            {title}
          </span>
          <span className={styles.sourceState}>
            {state === 'failed' && message ? message : counts || `${done} of ${total}`}
          </span>
        </div>
        {state === 'done' && <Check className={styles.transferDone} aria-hidden />}
      </div>
      {(state === 'running' || state === 'cancelled') && (
        <Progress
          value={total ? done : null}
          max={Math.max(total, 1)}
          label={`${done} of ${total}`}
          showValue
        />
      )}
      {failed.length > 0 && (
        <ul className={styles.transferFailed} aria-label="Couldn’t be read">
          {failed.slice(0, 5).map((f, i) => (
            <li key={`${f.title}-${i}`}>
              <strong>{f.title}</strong> · {f.message}
            </li>
          ))}
          {failed.length > 5 && <li>and {failed.length - 5} more</li>}
        </ul>
      )}
      {action && <div className={styles.transferAction}>{action}</div>}
    </div>
  );
}

// ── In the chat ─────────────────────────────────────────────────────────────

export type VaultDecision = 'allow' | 'allow-always' | 'deny';

export interface VaultApprovalProps extends Omit<ComponentProps<'div'>, 'title'> {
  /** Who's asking: the assistant's name. */
  name?: string;
  itemTitle: string;
  itemKind: VaultKind;
  fieldLabel: string;
  /** The assistant's own words: why. */
  reason?: string;
  /** A password, card number, PIN or recovery phrase. */
  sensitive?: boolean;
  /**
   * Into a command's environment instead of read (ADR 0151): the variable and
   * the command. The assistant never sees it, so the card says so.
   */
  use?: { envName: string; command?: string };
  decision?: VaultDecision | 'expired';
  busy?: boolean;
  onDecide?: (decision: VaultDecision) => void;
}

/**
 * The assistant asking to read one thing from Passwords: what, from which
 * item, and why in its own words. A secret says plainly that the assistant
 * will see it. Asked to `use` it in a command, it names the variable and the
 * command, and that the assistant won't see it. Answered, it becomes a quiet line.
 */
export function VaultApproval({
  name = 'Conch',
  itemTitle,
  itemKind,
  fieldLabel,
  reason,
  sensitive,
  use,
  decision,
  busy,
  onDecide,
  className,
  ...props
}: VaultApprovalProps) {
  // "PIN" stays "PIN"; "Account number" reads as "account number".
  const field = fieldLabel === fieldLabel.toUpperCase() ? fieldLabel : fieldLabel.toLowerCase();
  const what = `the ${field} of “${itemTitle}”`;
  const asking = use ? `Let this command use ${what}?` : `Let ${name} read ${what}?`;
  if (decision) {
    const allowed = decision === 'allow' || decision === 'allow-always';
    return (
      <div
        role="note"
        className={cx(styles.chatDone, className)}
        data-allowed={allowed || undefined}
        {...props}
      >
        {allowed ? <Check aria-hidden /> : <EyeOff aria-hidden />}
        <span>
          {decision === 'expired'
            ? `No answer needed any more · ${what}`
            : allowed
              ? `${use ? `A command used ${what}` : `${name} read ${what}`}${
                  decision === 'allow-always'
                    ? ' · always for this item'
                    : use
                      ? ' · in this chat'
                      : ''
                }`
              : `Kept private · ${what}`}
        </span>
      </div>
    );
  }
  return (
    <div
      role="group"
      aria-label={asking}
      className={cx(styles.chatCard, className)}
      data-lustre=""
      {...props}
    >
      <div className={styles.chatHead}>
        <VaultItemIcon kind={itemKind} title={itemTitle} size="sm" />
        <div className={styles.chatText}>
          <p className={styles.chatTitle}>{asking}</p>
          {reason && <p className={styles.chatReason}>“{reason}”</p>}
          {use?.command && <code className={styles.chatCommand}>{use.command}</code>}
          <p className={styles.chatDetail}>
            {use
              ? `It goes to the command as ${use.envName}. ${name} doesn’t see it, and it’s hidden from this chat.`
              : sensitive
                ? `${name} will see it to do this. It’s hidden from this chat afterwards.`
                : `${name} will see it to do this. Nothing else in “${itemTitle}” is shared.`}
          </p>
        </div>
      </div>
      <div className={styles.chatActions}>
        <button
          type="button"
          className={styles.chatButton}
          data-variant="ghost"
          disabled={busy}
          onClick={() => onDecide?.('deny')}
        >
          Don’t
        </button>
        <button
          type="button"
          className={styles.chatButton}
          data-variant="surface"
          disabled={busy}
          onClick={() => onDecide?.('allow-always')}
        >
          Always for this item
        </button>
        <button
          type="button"
          className={styles.chatButton}
          data-variant="solid"
          disabled={busy}
          onClick={() => onDecide?.('allow')}
        >
          {use ? 'Allow in this chat' : 'Allow once'}
        </button>
      </div>
    </div>
  );
}

export interface VaultUnlockCardProps extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  state: 'waiting' | 'done' | 'declined' | 'expired';
  name?: string;
  /** Resolves when unlocked; rejects with a sentence (a wrong password). */
  onUnlock?: (password: string) => Promise<void>;
}

/**
 * Passwords is locked and the assistant needs it: unlock it right here. The
 * password goes to Conch, never into the chat; the task carries on by itself.
 */
export function VaultUnlockCard({
  state,
  name = 'Conch',
  onUnlock,
  className,
  ...props
}: VaultUnlockCardProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  if (state !== 'waiting')
    return (
      <div role="note" className={styles.chatDone} data-allowed={state === 'done' || undefined}>
        {state === 'done' ? <LockKeyhole aria-hidden /> : <LockKeyhole aria-hidden />}
        <span>{state === 'done' ? 'Passwords unlocked' : 'Passwords stayed locked'}</span>
      </div>
    );
  return (
    <form
      className={cx(styles.chatCard, className)}
      data-lustre=""
      aria-label="Unlock Passwords"
      onSubmit={(e) => {
        e.preventDefault();
        if (!password || !onUnlock) return;
        setBusy(true);
        setError(undefined);
        onUnlock(password)
          .then(() => setPassword(''))
          .catch((err: Error) => setError(err.message))
          .finally(() => setBusy(false));
      }}
      {...props}
    >
      <div className={styles.chatHead}>
        <span className={styles.chatLock} aria-hidden>
          <LockKeyhole />
        </span>
        <div className={styles.chatText}>
          <p className={styles.chatTitle}>Passwords is locked</p>
          <p className={styles.chatDetail}>
            {name} needs something from it. Unlock it and {name} carries on.
          </p>
        </div>
      </div>
      <div className={styles.chatRow}>
        <label htmlFor={inputId} className="nc-visually-hidden">
          Password for Passwords
        </label>
        <input
          id={inputId}
          type="password"
          className={styles.chatInput}
          autoComplete="current-password"
          placeholder="Password for Passwords"
          value={password}
          aria-invalid={error ? true : undefined}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="submit"
          className={styles.chatButton}
          data-variant="solid"
          disabled={busy || !password}
        >
          Unlock
        </button>
      </div>
      {error && (
        <p className={styles.chatError} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export interface RequestedFieldShape {
  label: string;
  kind: string;
  role?: string;
}

export interface VaultRequestCardProps extends Omit<ComponentProps<'form'>, 'onSubmit' | 'title'> {
  name?: string;
  state: 'waiting' | 'done' | 'declined' | 'expired';
  title: string;
  itemKind: VaultKind;
  /** The site by its real host. */
  site?: string;
  reason?: string;
  fields: RequestedFieldShape[];
  onSave?: (answer: { title: string; values: string[] }) => Promise<void>;
  onDecline?: () => void;
  /** Open the saved item. */
  onOpen?: () => void;
}

const SECRET_KINDS = new Set(['secret', 'secretText', 'pin', 'totp']);

/**
 * The assistant needs a credential: you type it here and it goes straight
 * into Passwords, never into the chat. The site is shown by its real
 * address, and the reason in the assistant's words.
 */
export function VaultRequestCard({
  name = 'Conch',
  state,
  title: suggested,
  itemKind,
  site,
  reason,
  fields,
  onSave,
  onDecline,
  onOpen,
  className,
  ...props
}: VaultRequestCardProps) {
  const [title, setTitle] = useState(suggested);
  const [values, setValues] = useState<string[]>(() => fields.map(() => ''));
  const [shown, setShown] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const baseId = useId();
  if (state !== 'waiting')
    return (
      <div role="note" className={styles.chatDone} data-allowed={state === 'done' || undefined}>
        {state === 'done' ? <Check aria-hidden /> : <X aria-hidden />}
        <span>
          {state === 'done'
            ? `Saved “${suggested}” to Passwords`
            : state === 'declined'
              ? `Not given · ${suggested}`
              : `No answer needed any more · ${suggested}`}
        </span>
        {state === 'done' && onOpen && (
          <button type="button" className={styles.chatLink} onClick={onOpen}>
            Open
          </button>
        )}
      </div>
    );
  const filled = values.some((v) => v.trim());
  return (
    <form
      className={cx(styles.chatCard, className)}
      data-lustre=""
      aria-label={`${name} asks for ${suggested}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!onSave || !filled) return;
        setBusy(true);
        setError(undefined);
        onSave({ title: title.trim() || suggested, values })
          .catch((err: Error) => setError(err.message))
          .finally(() => setBusy(false));
      }}
      {...props}
    >
      <div className={styles.chatHead}>
        <VaultItemIcon kind={itemKind} domain={site} title={site ?? suggested} size="sm" />
        <div className={styles.chatText}>
          <p className={styles.chatTitle}>
            {name} needs{' '}
            {itemKind === 'login' && site ? `your sign-in for ${site}` : `“${suggested}”`}
          </p>
          {reason && <p className={styles.chatReason}>“{reason}”</p>}
          <p className={styles.chatDetail}>It’s saved to your Passwords. {name} never sees it.</p>
        </div>
      </div>
      <div className={styles.chatFields}>
        <label className={styles.chatField}>
          <span>Name</span>
          <input
            className={styles.chatInput}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {fields.map((f, i) => {
          const secret = SECRET_KINDS.has(f.kind);
          const id = `${baseId}-${i}`;
          return (
            <div key={`${f.label}-${i}`} className={styles.chatField}>
              <label htmlFor={id}>{f.label}</label>
              <div className={styles.chatRow}>
                <input
                  id={id}
                  className={styles.chatInput}
                  type={
                    secret && !shown.has(i) ? 'password' : f.kind === 'email' ? 'email' : 'text'
                  }
                  autoComplete={
                    f.role === 'username' ? 'username' : secret ? 'new-password' : 'off'
                  }
                  spellCheck={false}
                  value={values[i] ?? ''}
                  onChange={(e) =>
                    setValues((v) => v.map((x, j) => (j === i ? e.target.value : x)))
                  }
                />
                {secret && (
                  <IconButton
                    size="sm"
                    label={
                      shown.has(i)
                        ? `Hide ${f.label.toLowerCase()}`
                        : `Show ${f.label.toLowerCase()}`
                    }
                    onClick={() =>
                      setShown((s) => {
                        const next = new Set(s);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      })
                    }
                  >
                    {shown.has(i) ? <EyeOff /> : <Eye />}
                  </IconButton>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {error && (
        <p className={styles.chatError} role="alert">
          {error}
        </p>
      )}
      <div className={styles.chatActions}>
        <button
          type="button"
          className={styles.chatButton}
          data-variant="ghost"
          disabled={busy}
          onClick={onDecline}
        >
          Not now
        </button>
        <button
          type="submit"
          className={styles.chatButton}
          data-variant="solid"
          disabled={busy || !filled}
        >
          Save to Passwords
        </button>
      </div>
    </form>
  );
}
