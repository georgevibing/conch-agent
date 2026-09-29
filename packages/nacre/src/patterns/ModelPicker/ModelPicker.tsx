import { Check, ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { Popover as PopoverPrimitive, RadioGroup as RadioPrimitive } from 'radix-ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

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
}

export interface ModelProvider {
  id: string;
  label: string;
  logo: ProviderId;
  models: ModelOption[];
  /** Shown next to the provider name, e.g. "Coming soon". */
  note?: string;
}

export interface EffortOption {
  value: string;
  label: string;
  description?: string;
}

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
}

function findModel(providers: ModelProvider[], id: string) {
  for (const provider of providers) {
    const model = provider.models.find((m) => m.id === id);
    if (model) return { provider, model };
  }
  return undefined;
}

/**
 * The composer's model chip. One quiet pill shows what's answering; the
 * popover groups models by provider and holds the two dials people actually
 * touch — how hard to think, and fast mode.
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
}: ModelPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const current = findModel(providers, model);

  // "More models" groups start collapsed — unless the selection lives inside one.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(open && current?.model.secondary ? [current.provider.id] : []),
  );
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setExpanded(new Set(current?.model.secondary ? [current.provider.id] : []));
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

  // "Make default" → brief confirmation, then settle on the muted "Default".
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(t);
  }, [justSaved]);

  // Typeahead across model labels.
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
    const now = Date.now();
    typed.current = {
      text: (now - typed.current.at > 700 ? '' : typed.current.text) + event.key.toLowerCase(),
      at: now,
    };
    const all = providers.flatMap((p) =>
      p.models.filter((m) => !m.secondary || expanded.has(p.id)),
    );
    const match = all.find((m) => m.label.toLowerCase().startsWith(typed.current.text));
    if (match) document.getElementById(`${listId}-${match.id}`)?.focus();
  };

  const renderRow = (option: ModelOption) => (
    <RadioPrimitive.Item
      key={option.id}
      id={`${listId}-${option.id}`}
      value={option.id}
      data-value={option.id}
      data-secondary={option.secondary || undefined}
      className={styles.row}
    >
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>
          {option.label}
          {option.badge && <span className={styles.badge}>{option.badge}</span>}
        </span>
        {option.description && <span className={styles.rowDescription}>{option.description}</span>}
      </span>
      <RadioPrimitive.Indicator className={styles.check}>
        <Check aria-hidden />
      </RadioPrimitive.Indicator>
    </RadioPrimitive.Item>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cx(styles.chip, className)}
          data-lustre=""
          aria-label={`Model: ${current?.model.label ?? model}${effortLabel ? `, ${effortLabel} thinking` : ''}${fastMode ? ', fast mode' : ''}`}
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
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById(`${listId}-${model}`)?.focus();
        }}
      >
        {loading ? (
          <div className={styles.loading} aria-busy="true" aria-label="Loading models">
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.skeletonRow}>
                <Skeleton width="42%" height={12} />
                <Skeleton width="72%" height={10} />
              </div>
            ))}
          </div>
        ) : (
          <RadioPrimitive.Root
            value={model}
            onValueChange={onModelChange}
            aria-label="Model"
            className={styles.list}
            onKeyDown={onListKeyDown}
            loop
          >
            {providers.map((provider) => {
              const headingId = `${listId}-${provider.id}`;
              return (
                <div
                  key={provider.id}
                  role="group"
                  aria-labelledby={headingId}
                  className={styles.group}
                >
                  <div id={headingId} className={styles.groupHeader}>
                    <ProviderLogo provider={provider.logo} size={13} />
                    <span>{provider.label}</span>
                    {provider.note && <span className={styles.note}>{provider.note}</span>}
                  </div>
                  {provider.models.filter((m) => !m.secondary).map(renderRow)}
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
                          provider.models.filter((m) => m.secondary).map(renderRow)}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </RadioPrimitive.Root>
        )}

        {efforts.length > 0 && (
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
      </Popover.Content>
    </Popover.Root>
  );
}
