import {
  Check,
  Copy,
  Download,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../components/Button';
import { DropdownMenu } from '../../components/DropdownMenu';
import { IconButton } from '../../components/IconButton';
import { Select } from '../../components/Select';
import { Spinner } from '../../components/Spinner';
import { Tabs } from '../../components/Tabs';
import { toast } from '../../components/Toast';
import { copyText } from '../../utils/clipboard';
import { cx } from '../../utils/cx';
import { CodeBlock } from '../CodeBlock';
import { CopyButton } from '../CopyButton';
import { Diff } from '../Diff';
import styles from './Artifacts.module.css';
import { ARTIFACT_KINDS, type ArtifactKindName } from './kinds';
import { lineDiff } from './lineDiff';
import { META_SEP } from '../../components/MetaList';

export interface ArtifactPanelVersion {
  n: number;
  /** "Today, 9:41 AM". */
  when: string;
  note?: string;
  /** Made by "Refresh with fresh data". */
  refreshed?: boolean;
  /** Made by you, by hand. */
  edited?: boolean;
}

export type ArtifactPanelView = 'preview' | 'source' | 'changes';

export interface ArtifactPanelProps extends Omit<ComponentProps<'section'>, 'title'> {
  title: string;
  kind: ArtifactKindName;
  versions: ArtifactPanelVersion[];
  /** The version showing. */
  version: number;
  onVersionChange?: (n: number) => void;
  /** The thing itself, drawn by the app (a sealed frame, a chart, a document…). */
  preview: ReactNode;
  /** This version's text, for Code, Copy and Changes. Absent while loading. */
  source?: string;
  /** The version before it, for Changes. */
  previous?: string;
  view?: ArtifactPanelView;
  defaultView?: ArtifactPanelView;
  onViewChange?: (view: ArtifactPanelView) => void;
  /** Where to download this version. */
  downloadHref?: string;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  /** It can be refreshed with fresh data (pinned apps). */
  onRefresh?: () => void;
  refreshing?: boolean;
  onDelete?: () => void;
  onClose?: () => void;
  /** It can be edited by hand: an Edit button. */
  onEdit?: () => void;
  /**
   * Editing it (an `ArtifactEditor`): shown instead of View, Code and
   * Changes, with the header's own actions put away until it's done.
   */
  editing?: ReactNode;
  /** Start filling the window. */
  defaultExpanded?: boolean;
  /** No close button or full-screen toggle: the panel is the page (a pinned app). */
  standalone?: boolean;
}

/** Narrower than this (a phone's sheet, a thin dock), its header keeps to the essentials. */
const NARROW_REM = 30;

/**
 * Whether the panel is narrow, and whether it sits in a dialog (a sheet on a
 * phone, which full screen can't make any bigger). Measured before the first
 * paint, so a phone never sees the wide header first; a panel that isn't laid
 * out (hidden, or under jsdom) reads as wide, as it always did.
 */
function usePanelRoom(el: HTMLElement | null) {
  const [room, setRoom] = useState({ narrow: false, inDialog: false });
  useLayoutEffect(() => {
    if (!el) return;
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const inDialog = Boolean(el.closest('[role="dialog"]'));
    const fit = (width: number) => {
      if (width <= 0) return;
      const narrow = width < NARROW_REM * rem;
      setRoom((r) => (r.narrow === narrow && r.inDialog === inDialog ? r : { narrow, inDialog }));
    };
    fit(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) fit(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return room;
}

/**
 * The thing beside the chat (ADR 0034): the thing itself, its code, and what
 * changed since the version before; every version kept, to copy, download,
 * pin as an app or open full screen. Quiet chrome so what was made is the
 * loudest thing on screen.
 */
export function ArtifactPanel({
  title,
  kind,
  versions,
  version,
  onVersionChange,
  preview,
  source,
  previous,
  view: viewProp,
  defaultView = 'preview',
  onViewChange,
  downloadHref,
  pinned,
  onPinnedChange,
  onRefresh,
  refreshing,
  onDelete,
  onClose,
  onEdit,
  editing,
  defaultExpanded = false,
  standalone,
  className,
  ...props
}: ArtifactPanelProps) {
  const [internal, setInternal] = useState(defaultView);
  const view = viewProp ?? internal;
  const setView = (next: ArtifactPanelView) => {
    if (viewProp === undefined) setInternal(next);
    onViewChange?.(next);
  };
  const [expanded, setExpanded] = useState(defaultExpanded);
  // Full screen lifts the panel to the page, unless it's in a dialog (a sheet on a
  // phone) whose focus it must stay inside: there it fills the dialog.
  const [lifted, setLifted] = useState(true);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const { narrow, inDialog } = usePanelRoom(panelEl);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const headingId = useId();
  const k = ARTIFACT_KINDS[kind];
  const current = versions.find((v) => v.n === version);
  const first = versions[0]?.n === version;
  const changes = useMemo(
    () =>
      view === 'changes' && source !== undefined && previous !== undefined
        ? lineDiff(previous, source)
        : undefined,
    [view, source, previous],
  );

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const download = () => {
    if (!downloadHref) return;
    // The server sends it as an attachment: it saves, it never opens.
    const link = document.createElement('a');
    link.href = downloadHref;
    link.download = '';
    link.click();
  };
  const copyFromMenu = async () => {
    if (source === undefined) return;
    try {
      await copyText(source);
    } catch {
      toast.error('Couldn’t copy it here. Download it instead.');
      return;
    }
    setCopied(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1600);
  };
  const toggleFullScreen = (from: Element) => {
    setLifted(!from.closest('[role="dialog"]'));
    setExpanded((e) => !e);
  };

  // Narrow (a phone's sheet, a thin dock): the name and its kind keep the room.
  // Edit and Close stay; the rest goes into More. In a dialog, full screen would
  // only fill the dialog it already fills, so it isn't offered there.
  const tucked = narrow && !editing;
  const canFullScreen = !standalone && !(narrow && inDialog);
  const canCopy = source !== undefined && !editing;
  const canDownload = Boolean(downloadHref) && !editing;
  const canPin = Boolean(onPinnedChange) && !editing;
  const canRefresh = Boolean(onRefresh) && !editing;
  const tuckedItems =
    tucked && (canCopy || canDownload || canPin || canFullScreen || (standalone && canRefresh));
  const hasMenu = !editing && Boolean(tuckedItems || (onRefresh && !standalone) || onDelete);

  const panel = (
    <section
      ref={setPanelEl}
      aria-labelledby={headingId}
      className={cx(styles.panel, className)}
      data-expanded={expanded || undefined}
      data-standalone={standalone || undefined}
      data-narrow={narrow || undefined}
      {...props}
    >
      <header className={styles.panelHead}>
        <span className={styles.panelIcon} aria-hidden>
          {k.icon}
        </span>
        <div className={styles.panelTitles}>
          <h2 id={headingId} className={styles.panelTitle}>
            {title}
          </h2>
          <span className={styles.panelMeta}>
            <span className={styles.panelKind}>{k.label}</span>
            {refreshing && (
              <span className={styles.refreshing} role="status">
                <Spinner size="xs" label={null} /> Getting fresh data…
              </span>
            )}
          </span>
        </div>
        <div className={styles.panelActions}>
          {onEdit && !editing && (
            <Button size="sm" variant="soft" leadingIcon={<Pencil />} onClick={onEdit}>
              Edit
            </Button>
          )}
          {standalone && canRefresh && !tucked && (
            <Button
              size="sm"
              variant="soft"
              leadingIcon={<RefreshCw />}
              loading={refreshing}
              onClick={onRefresh}
            >
              Refresh
            </Button>
          )}
          {canCopy && !tucked && <CopyButton value={source} label="Copy" size="sm" />}
          {canDownload && !tucked && (
            <IconButton label="Download" size="sm" onClick={download}>
              <Download />
            </IconButton>
          )}
          {canPin && !tucked && (
            <IconButton
              label={pinned ? 'Unpin from the sidebar' : 'Pin as an app'}
              size="sm"
              aria-pressed={pinned ?? false}
              onClick={() => onPinnedChange?.(!pinned)}
            >
              {pinned ? <PinOff /> : <Pin />}
            </IconButton>
          )}
          {canFullScreen && !tucked && (
            <IconButton
              label={expanded ? 'Leave full screen' : 'Full screen'}
              size="sm"
              aria-pressed={expanded}
              onClick={(event) => toggleFullScreen(event.currentTarget)}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
          )}
          {hasMenu && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label="More" size="sm">
                  {copied ? <Check /> : <MoreHorizontal />}
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                {tucked && (
                  <>
                    {canCopy && (
                      <DropdownMenu.Item icon={<Copy />} onSelect={() => void copyFromMenu()}>
                        Copy
                      </DropdownMenu.Item>
                    )}
                    {canDownload && (
                      <DropdownMenu.Item icon={<Download />} onSelect={download}>
                        Download
                      </DropdownMenu.Item>
                    )}
                    {canPin && (
                      <DropdownMenu.Item
                        icon={pinned ? <PinOff /> : <Pin />}
                        onSelect={() => onPinnedChange?.(!pinned)}
                      >
                        {pinned ? 'Unpin from the sidebar' : 'Pin as an app'}
                      </DropdownMenu.Item>
                    )}
                    {canFullScreen && (
                      <DropdownMenu.Item
                        icon={expanded ? <Minimize2 /> : <Maximize2 />}
                        // The item's gone by the time it's chosen: the panel tells.
                        onSelect={() => panelEl && toggleFullScreen(panelEl)}
                      >
                        {expanded ? 'Leave full screen' : 'Full screen'}
                      </DropdownMenu.Item>
                    )}
                  </>
                )}
                {canRefresh && (tucked || !standalone) && (
                  <DropdownMenu.Item
                    icon={<RefreshCw />}
                    disabled={refreshing}
                    onSelect={onRefresh}
                  >
                    Refresh with fresh data
                  </DropdownMenu.Item>
                )}
                {onDelete && (
                  <>
                    {tuckedItems && <DropdownMenu.Separator />}
                    <DropdownMenu.Item icon={<Trash2 />} tone="danger" onSelect={onDelete}>
                      Delete…
                    </DropdownMenu.Item>
                  </>
                )}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          )}
          {onClose && !standalone && (
            <IconButton label="Close" size="sm" onClick={onClose}>
              <X />
            </IconButton>
          )}
        </div>
        <span className="nc-visually-hidden" aria-live="polite">
          {copied ? 'Copied to clipboard' : ''}
        </span>
      </header>

      {editing ? (
        <div className={styles.panelEditing}>{editing}</div>
      ) : (
        <Tabs
          value={view}
          onValueChange={(v) => setView(v as ArtifactPanelView)}
          size="sm"
          className={styles.panelTabs}
        >
          <div className={styles.panelBar}>
            <Tabs.List aria-label="Show">
              <Tabs.Trigger value="preview">{kind === 'html' ? 'Use' : 'View'}</Tabs.Trigger>
              <Tabs.Trigger value="source">Code</Tabs.Trigger>
              <Tabs.Trigger value="changes" disabled={first}>
                Changes
              </Tabs.Trigger>
            </Tabs.List>
            {versions.length > 1 && (
              <Select
                size="sm"
                variant="ghost"
                align="end"
                className={styles.panelVersion}
                aria-label="Version"
                value={String(version)}
                onValueChange={(v) => onVersionChange?.(Number(v))}
              >
                {[...versions].reverse().map((v) => (
                  <Select.Item
                    key={v.n}
                    value={String(v.n)}
                    description={[
                      // Narrow, the bar shows just "Version 2"; which is newest is said here.
                      narrow && v.n === versions.at(-1)?.n ? 'Latest' : undefined,
                      v.when,
                      v.refreshed ? 'fresh data' : v.edited ? 'edited by you' : v.note,
                    ]
                      .filter(Boolean)
                      .join(META_SEP)}
                  >
                    Version {v.n}
                    {!narrow && v.n === versions.at(-1)?.n ? ' (latest)' : ''}
                  </Select.Item>
                ))}
              </Select>
            )}
          </div>

          {current?.note && view !== 'source' && <p className={styles.panelNote}>{current.note}</p>}

          <Tabs.Content value="preview" className={styles.panelBody}>
            {preview}
          </Tabs.Content>
          <Tabs.Content value="source" className={styles.panelBody} data-view="source">
            {source === undefined ? (
              <Spinner />
            ) : (
              <CodeBlock
                code={source}
                language={k.language}
                lineNumbers
                variant="bare"
                defaultWrap
              />
            )}
          </Tabs.Content>
          <Tabs.Content value="changes" className={styles.panelBody}>
            {changes === undefined ? (
              <Spinner />
            ) : changes.length === 0 ? (
              <p className={styles.panelNote}>Nothing changed from the version before.</p>
            ) : (
              <Diff diff={changes} filename={`Version ${version - 1} → ${version}`} />
            )}
          </Tabs.Content>
        </Tabs>
      )}

      {expanded && (
        <Button
          className={styles.panelEsc}
          size="sm"
          variant="surface"
          onClick={() => setExpanded(false)}
        >
          Leave full screen
        </Button>
      )}
    </section>
  );
  // Over everything, whatever transforms the panel sits in (a sheet, a sliding dock).
  return expanded && lifted && typeof document !== 'undefined'
    ? createPortal(panel, document.body)
    : panel;
}
