import { Check, ChevronDown, ChevronRight, MessageSquare, Search, X, Zap } from 'lucide-react';
import { Popover as PopoverPrimitive, RadioGroup as RadioPrimitive } from 'radix-ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { Highlight, type HighlightRange } from '../../components/Highlight';
import { Popover } from '../../components/Popover';
import { SegmentedControl } from '../../components/SegmentedControl';
import { Skeleton } from '../../components/Skeleton';
import { Switch } from '../../components/Switch';
import { Tooltip } from '../../components/Tooltip';
import { cx } from '../../utils/cx';
import styles from './ModelPicker.module.css';
import { ProviderLogo, type ProviderId } from './ProviderLogo';

export interface ModelOption {
  id: string;
  label: string;
  description?: string;
  badge?: string;
  /** Tucked under "More models" at the end of the provider group. */
  secondary?: boolean;
  /** Extra words search should find it by (an id, a family name). */
  keywords?: string;
  /**
   * It can only chat: no apps, files, commands or memory. Says so quietly
   * under its name, in words, and search finds it by "chat only".
   */
  chatOnly?: boolean;
}

/** What the picker says about a model that can only chat. */
export const CHAT_ONLY_WORDS = 'Chat only — can’t use your apps';

export interface ModelProvider {
  id: string;
  label: string;
  logo: ProviderId;
  models: ModelOption[];
  /** Shown next to the provider name, e.g. "Default". */
  note?: string;
  /** Shown under the provider name when it has nothing to offer, e.g. why its list is empty. */
  message?: string;
}

export interface EffortOption {
  value: string;
  label: string;
  description?: string;
}

/** A search hit: higher scores first, `ranges` to highlight in the label. */
export type ModelMatch = { score: number; ranges: readonly HighlightRange[] } | null;

export interface ModelPickerProps {
  providers: ModelProvider[];
  model: string;
  onModelChange(id: string): void;
  effort: string;
  /** Empty hides the Thinking section (model without effort control). */
  efforts: EffortOption[];
  onEffortChange(value: string): void;
  fastMode: boolean;
  fastModeAvailable: boolean;
  onFastModeChange(on: boolean): void;
  /** The current selection equals the saved default. */
  isDefault: boolean;
  onMakeDefault?(): void;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  loading?: boolean;
  disabled?: boolean;
  side?: 'top' | 'bottom';
  className?: string;
  /**
   * Show a search field. `auto` (the default) shows it once there are more
   * models than fit at a glance. Typing anywhere in the list searches too.
   */
  searchable?: boolean | 'auto';
  /** How a label matches a query. Defaults to every word appearing, case-insensitively. */
  match?(text: string, query: string): ModelMatch;
  /** Just the model list — no thinking, fast mode or default (e.g. choosing a default in Settings). */
  modelOnly?: boolean;
}

/** More than this many models, and the list gets a search field. */
const SEARCH_THRESHOLD = 8;
/** Hits shown per provider while searching; keep typing to narrow the rest. */
const HITS_PER_PROVIDER = 30;

function findModel(providers: ModelProvider[], id: string) {
  for (const provider of providers) {
    const model = provider.models.find((m) => m.id === id);
    if (model) return { provider, model };
  }
  return undefined;
}

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every word of the query somewhere in the text; earlier and word-start hits rank higher. */
export function matchWords(text: string, query: string): ModelMatch {
  const haystack = fold(text);
  const ranges: [number, number][] = [];
  let score = 0;
  for (const word of fold(query).split(/\s+/).filter(Boolean)) {
    const at = haystack.indexOf(word);
    if (at === -1) return null;
    const wordStart = at === 0 || /[\s\-_/.:(]/.test(haystack[at - 1] ?? '');
    score += 100 - Math.min(at, 60) + (wordStart ? 30 : 0);
    ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return { score, ranges };
}

/**
 * The composer's model chip. One quiet pill shows what's answering; the
 * popover groups every connected provider's models, finds one as you type,
 * and holds the two dials people actually touch — how hard to think, and
 * fast mode.
 */
export function ModelPicker({
  providers,
  model,
  onModelChange,
  effort,
  efforts,
  onEffortChange,
  fastMode,
  fastModeAvailable,
  onFastModeChange,
  isDefault,
  onMakeDefault,
  open: openProp,
  onOpenChange,
  loading = false,
  disabled = false,
  side = 'top',
  className,
  searchable = 'auto',
  match = matchWords,
  modelOnly = false,
}: ModelPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [query, setQuery] = useState('');
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const current = findModel(providers, model);
  const total = providers.reduce((n, p) => n + p.models.length, 0);
  const canSearch = searchable === 'auto' ? total > SEARCH_THRESHOLD : searchable;
  const q = canSearch ? query.trim() : '';

  // "More models" groups start collapsed — unless the selection lives inside one.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(open && current?.model.secondary ? [current.provider.id] : []),
  );
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setExpanded(new Set(current?.model.secondary ? [current.provider.id] : []));
    // Each visit starts from the whole list.
    else setQuery('');
  }
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const effortLabel =
    effort !== 'auto' ? efforts.find((e) => e.value === effort)?.label : undefined;
  const listId = useId();
  const fastId = useId();
  const searchRef = useRef<HTMLInputElement>(null);

  // "Make default" → brief confirmation, then settle on the muted "Default".
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [justSaved]);

  // While searching: each provider's matches, best first, secondary models included.
  const results = q
    ? providers
        .map((provider) => ({
          provider,
          hits: provider.models
            .map((option) => {
              const label = match(option.label, q);
              const other = label
                ? null
                : match(
                    [
                      option.description,
                      option.keywords,
                      option.chatOnly && CHAT_ONLY_WORDS,
                      option.id,
                      provider.label,
                    ]
                      .filter(Boolean)
                      .join(' '),
                    q,
                  );
              const hit = label ?? (other && { score: other.score - 50, ranges: [] });
              return hit ? { option, hit } : undefined;
            })
            .filter((r): r is NonNullable<typeof r> => r !== undefined)
            .sort((a, b) => b.hit.score - a.hit.score),
        }))
        .filter((group) => group.hits.length > 0)
    : undefined;
  const firstHit = results?.[0]?.hits[0]?.option.id;

  const focusRow = (id: string | undefined) => {
    if (id) document.getElementById(`${listId}-${id}`)?.focus();
  };

  // Typeahead: with search, any letter goes to the search field; without it, jump to a label.
  const typed = useRef({ text: '', at: 0 });
  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      const value = (event.target as HTMLElement).dataset.value;
      if (value) {
        event.preventDefault();
        onModelChange(value);
      }
      return;
    }
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    if (canSearch) {
      event.preventDefault();
      setQuery((prev) => prev + event.key);
      searchRef.current?.focus();
      return;
    }
    const now = Date.now();
    typed.current = {
      text: (now - typed.current.at > 700 ? '' : typed.current.text) + event.key.toLowerCase(),
      at: now,
    };
    const all = providers.flatMap((p) =>
      p.models.filter((m) => !m.secondary || expanded.has(p.id)),
    );
    const hit = all.find((m) => m.label.toLowerCase().startsWith(typed.current.text));
    focusRow(hit?.id);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(firstHit ?? (q ? undefined : (current?.model.id ?? providers[0]?.models[0]?.id)));
    } else if (event.key === 'Enter' && firstHit) {
      event.preventDefault();
      onModelChange(firstHit);
    }
  };

  const renderRow = (option: ModelOption, ranges?: readonly HighlightRange[]) => (
    <RadioPrimitive.Item
      key={option.id}
      id={`${listId}-${option.id}`}
      value={option.id}
      data-value={option.id}
      data-secondary={(!ranges && option.secondary) || undefined}
      data-chat-only={option.chatOnly || undefined}
      className={styles.row}
    >
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>
          {ranges ? <Highlight text={option.label} ranges={ranges} /> : option.label}
          {option.badge && <span className={styles.badge}>{option.badge}</span>}
        </span>
        {option.description && <span className={styles.rowDescription}>{option.description}</span>}
        {option.chatOnly && (
          <span className={styles.chatOnly}>
            <MessageSquare aria-hidden />
            {CHAT_ONLY_WORDS}
          </span>
        )}
      </span>
      <RadioPrimitive.Indicator className={styles.check}>
        <Check aria-hidden />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Item>
  );

  const header = (provider: ModelProvider, headingId: string) => (
    <div id={headingId} className={styles.groupHeader}>
      <ProviderLogo provider={provider.logo} size={13} />
      <span>{provider.label}</span>
      {provider.note && <span className={styles.note}>{provider.note}</span>}
    </div>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cx(styles.chip, className)}
          data-lustre=""
          aria-label={`Model: ${current?.model.label ?? model}${
            current && providers.length > 1 ? ` (${current.provider.label})` : ''
          }${effortLabel ? `, ${effortLabel} thinking` : ''}${fastMode ? ', fast mode' : ''}`}
        >
          <ProviderLogo provider={current?.provider.logo ?? 'generic'} size={14} />
          <span className={styles.chipLabel}>
            {current?.model.label ?? (loading ? 'Loading…' : model)}
          </span>
          {effortLabel && <span className={styles.chipMeta}>· {effortLabel}</span>}
          {fastMode && <Zap className={styles.chipFast} aria-hidden />}
          <ChevronDown className={styles.chevron} aria-hidden />
        </button>
      </PopoverPrimitive.Trigger>
      <Popover.Content
        side={side}
        align="start"
        padding="none"
        className={styles.panel}
        aria-label="Model and thinking"
        onEscapeKeyDown={(event) => {
          // The first Escape clears the search; the next closes the picker.
          if (!query) return;
          event.preventDefault();
          setQuery('');
          searchRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (current) focusRow(current.model.id);
          else searchRef.current?.focus();
        }}
      >
        {canSearch && !loading && (
          <div className={styles.search}>
            <Search aria-hidden className={styles.searchIcon} />
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder={providers.length > 1 ? 'Search every model…' : 'Search models…'}
              aria-label="Search models"
              aria-controls={listId}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
            />
            {query && (
              <button
                type="button"
                className={styles.searchClear}
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                <X aria-hidden />
              </button>
            )}
          </div>
        )}
        {loading ? (
          <div className={styles.loading} role="status" aria-label="Loading models">
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width="42%" height={12} />
                <Skeleton width="72%" height={10} />
              </div>
            ))}
          </div>
        ) : (
          <RadioPrimitive.Root
            id={listId}
            value={model}
            onValueChange={onModelChange}
            aria-label="Model"
            className={styles.list}
            onKeyDown={onListKeyDown}
            loop
          >
            {results
              ? results.map(({ provider, hits }) => {
                  const headingId = `${listId}-${provider.id}`;
                  return (
                    <div
                      key={provider.id}
                      role="group"
                      aria-labelledby={headingId}
                      className={styles.group}
                    >
                      {header(provider, headingId)}
                      {hits
                        .slice(0, HITS_PER_PROVIDER)
                        .map(({ option, hit }) => renderRow(option, hit.ranges))}
                      {hits.length > HITS_PER_PROVIDER && (
                        <p className={styles.searchMore}>
                          {hits.length - HITS_PER_PROVIDER} more — keep typing to narrow it down
                        </p>
                      )}
                    </div>
                  );
                })
              : providers.map((provider) => {
                  const headingId = `${listId}-${provider.id}`;
                  return (
                    <div
                      key={provider.id}
                      role="group"
                      aria-labelledby={headingId}
                      className={styles.group}
                    >
                      {header(provider, headingId)}
                      {provider.models.length === 0 && provider.message && (
                        <p className={styles.groupMessage}>{provider.message}</p>
                      )}
                      {provider.models.filter((m) => !m.secondary).map((m) => renderRow(m))}
                      {provider.models.some((m) => m.secondary) && (
                        <>
                          <button
                            type="button"
                            className={styles.more}
                            aria-expanded={expanded.has(provider.id)}
                            aria-controls={`${headingId}-more`}
                            onClick={() => toggleExpanded(provider.id)}
                          >
                            <ChevronRight aria-hidden className={styles.moreChevron} />
                            More models
                            <span className={styles.moreCount}>
                              {provider.models.filter((m) => m.secondary).length}
                            </span>
                          </button>
                          <div id={`${headingId}-more`} className={styles.moreList}>
                            {expanded.has(provider.id) &&
                              provider.models.filter((m) => m.secondary).map((m) => renderRow(m))}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
            {results?.length === 0 && (
              <p className={styles.searchEmpty} role="status">
                No model matches “{q}”.
              </p>
            )}
          </RadioPrimitive.Root>
        )}

        {!modelOnly && efforts.length > 0 && (
          <div className={styles.section}>
            <div className={styles.sectionHead}>
              <span className={styles.sectionTitle}>Thinking</span>
              <span className={styles.sectionHint}>
                {efforts.find((e) => e.value === effort)?.description}
              </span>
            </div>
            <SegmentedControl.Root
              size="sm"
              block
              value={effort}
              onValueChange={(v) => v && onEffortChange(v)}
              aria-label="Thinking effort"
            >
              {efforts.map((option) => (
                <SegmentedControl.Item key={option.value} value={option.value}>
                  {option.label}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl.Root>
          </div>
        )}

        {!modelOnly && (
          <>
            <div className={cx(styles.section, styles.fastRow)}>
              <span className={styles.fastText}>
                <label htmlFor={fastId} className={styles.sectionTitle}>
                  <Zap aria-hidden className={styles.fastIcon} data-on={fastMode || undefined} />
                  Fast mode
                </label>
                <span className={styles.sectionHint}>
                  {fastModeAvailable
                    ? 'Faster replies · uses more of your plan'
                    : 'Not available for this model'}
                </span>
              </span>
              <Tooltip
                content={
                  fastModeAvailable
                    ? undefined
                    : `${current?.model.label ?? 'This model'} doesn't support fast mode`
                }
              >
                <span className={styles.switchWrap}>
                  <Switch
                    id={fastId}
                    size="sm"
                    checked={fastMode && fastModeAvailable}
                    disabled={!fastModeAvailable}
                    onCheckedChange={onFastModeChange}
                  />
                </span>
              </Tooltip>
            </div>

            <div className={styles.footer}>
              {isDefault ? (
                <span className={styles.defaultNote} data-saved={justSaved || undefined}>
                  <Check aria-hidden className={styles.defaultCheck} />
                  {justSaved ? 'Saved as your default' : 'Your default'}
                </span>
              ) : (
                onMakeDefault && (
                  <button
                    type="button"
                    className={styles.makeDefault}
                    onClick={() => {
                      onMakeDefault();
                      setJustSaved(true);
                    }}
                  >
                    Make this my default
                  </button>
                )
              )}
            </div>
          </>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}
