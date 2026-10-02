import {
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
import { useEffect, useId, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../../components/Button';
import { DropdownMenu } from '../../components/DropdownMenu';
import { IconButton } from '../../components/IconButton';
import { Select } from '../../components/Select';
import { Spinner } from '../../components/Spinner';
import { Tabs } from '../../components/Tabs';
import { cx } from '../../utils/cx';
import { CodeBlock } from '../CodeBlock';
import { CopyButton } from '../CopyButton';
import { Diff } from '../Diff';
import styles from './Artifacts.module.css';
import { ARTIFACT_KINDS, type ArtifactKindName } from './kinds';
import { lineDiff } from './lineDiff';

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

  const panel = (
    <section
      aria-labelledby={headingId}
      className={cx(styles.panel, className)}
      data-expanded={expanded || undefined}
      data-standalone={standalone || undefined}
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
            {k.label}
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
          {standalone && onRefresh && !editing && (
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
          {source !== undefined && !editing && <CopyButton value={source} label="Copy" size="sm" />}
          {downloadHref && !editing && (
            <IconButton
              label="Download"
              size="sm"
              onClick={() => {
                // The server sends it as an attachment: it saves, it never opens.
                const link = document.createElement('a');
                link.href = downloadHref;
                link.download = '';
                link.click();
              }}
            >
              <Download />
            </IconButton>
          )}
          {onPinnedChange && !editing && (
            <IconButton
              label={pinned ? 'Unpin from the sidebar' : 'Pin as an app'}
              size="sm"
              aria-pressed={pinned ?? false}
              onClick={() => onPinnedChange(!pinned)}
            >
              {pinned ? <PinOff /> : <Pin />}
            </IconButton>
          )}
          {!standalone && (
            <IconButton
              label={expanded ? 'Leave full screen' : 'Full screen'}
              size="sm"
              aria-pressed={expanded}
              onClick={(event) => {
                setLifted(!event.currentTarget.closest('[role="dialog"]'));
                setExpanded((e) => !e);
              }}
            >
              {expanded ? <Minimize2 /> : <Maximize2 />}
            </IconButton>
          )}
          {((onRefresh && !standalone) || onDelete) && !editing && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label="More" size="sm">
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content align="end">
                {onRefresh && !standalone && (
                  <DropdownMenu.Item
                    icon={<RefreshCw />}
                    disabled={refreshing}
                    onSelect={onRefresh}
                  >
                    Refresh with fresh data
                  </DropdownMenu.Item>
                )}
                {onDelete && (
                  <DropdownMenu.Item icon={<Trash2 />} tone="danger" onSelect={onDelete}>
                    Delete…
                  </DropdownMenu.Item>
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
                aria-label="Version"
                value={String(version)}
                onValueChange={(v) => onVersionChange?.(Number(v))}
              >
                {[...versions].reverse().map((v) => (
                  <Select.Item
                    key={v.n}
                    value={String(v.n)}
                    description={[
                      v.when,
                      v.refreshed ? 'fresh data' : v.edited ? 'edited by you' : v.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    Version {v.n}
                    {v.n === versions.at(-1)?.n ? ' (latest)' : ''}
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
