import { ChevronDown, Folder, Zap } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '../../components/Button';
import { Popover } from '../../components/Popover';
import { Sheet } from '../../components/Sheet';
import { cx } from '../../utils/cx';
import { useMediaQuery } from '../../utils/useMediaQuery';
import {
  FastModeSection,
  findModelOption,
  matchWords,
  ModelList,
  PickerDefault,
  ThinkingSection,
  useModelSearch,
  type EffortOption,
  type ModelMatch,
  type ModelProvider,
} from '../ModelPicker/ModelPicker';
import picker from '../ModelPicker/ModelPicker.module.css';
import { ProviderLogo } from '../ModelPicker/ProviderLogo';
import { ModeList, type ModeOption } from '../ModePicker/ModePicker';
import { PlaceGlyph } from '../WorkPlaces/WorkedAt';
import {
  PLACE_STATE_WORDS,
  WorkPlaceList,
  type WorkPlaceOption,
} from '../WorkPlaces/WorkPlacePicker';
import styles from './ComposerSettings.module.css';

/** Where work runs, in the panel. Leave it out while there's nowhere else to choose. */
export interface ComposerSettingsPlace {
  options: WorkPlaceOption[];
  value: string;
  onValueChange(value: string): void;
  /** Said above the list when the provider runs its own commands here regardless. */
  note?: string;
}

/** The folder the chat works in, and the way to choose another. */
export interface ComposerSettingsFolder {
  /** Its last part ("conch"); the whole path goes in `path`. */
  name: string;
  path?: string;
  /** Choose another: the panel closes first, so a dialog can open in its place. */
  onChoose(): void;
}

export interface ComposerSettingsProps {
  /** Every connected provider's models, grouped. */
  providers: ModelProvider[];
  model: string;
  onModelChange(id: string): void;
  loading?: boolean;
  searchable?: boolean | 'auto';
  match?(text: string, query: string): ModelMatch;
  /** Empty hides Thinking (a model without effort control). */
  efforts: EffortOption[];
  effort: string;
  onEffortChange(value: string): void;
  fastMode: boolean;
  /**
   * The chosen model has fast mode. Without it the switch isn't there at all:
   * fast mode is its own setting, never a thinking level.
   */
  fastModeAvailable: boolean;
  onFastModeChange(on: boolean): void;
  /** The provider's permission modes, as given. */
  modes: ModeOption[];
  mode: string;
  onModeChange(value: string): void;
  /** Who the modes are about, in the confirmation: the assistant's name. */
  name?: string;
  place?: ComposerSettingsPlace;
  folder?: ComposerSettingsFolder;
  /** Everything chosen here equals the saved defaults. */
  isDefault: boolean;
  onMakeDefault?(): void;
  open?: boolean;
  onOpenChange?(open: boolean): void;
  /** What takes focus as it opens: the chosen model (the default), or the chosen mode. */
  focus?: 'model' | 'mode';
  disabled?: boolean;
  side?: 'top' | 'bottom';
  /** A sheet from the bottom instead of a popover. `auto` (the default): on a phone. */
  sheet?: boolean | 'auto';
  className?: string;
}

/** A phone, or a screen used by touch: the panel rises as a sheet within reach. */
const PHONE = '(max-width: 40rem), (hover: none) and (pointer: coarse)';

/**
 * The composer's one settings chip: what answers and how much it may do,
 * read as "Opus · Auto". It opens one panel with everything about the next
 * turn: the model (searchable, with More models), Thinking, Fast mode when
 * the model has it, the Mode, Where work runs once there's somewhere else,
 * the Folder, and one Make this my default. On a phone it rises as a sheet.
 *
 * The model's name gives way first in a tight toolbar; the mode is always
 * read in full, and a trusting mode tints the whole chip, so it always looks
 * armed. Switching into a `danger` mode asks a second time, in place.
 */
export function ComposerSettings({
  providers,
  model,
  onModelChange,
  loading = false,
  searchable = 'auto',
  match = matchWords,
  efforts,
  effort,
  onEffortChange,
  fastMode,
  fastModeAvailable,
  onFastModeChange,
  modes,
  mode,
  onModeChange,
  name = 'the assistant',
  place,
  folder,
  isDefault,
  onMakeDefault,
  open: openProp,
  onOpenChange,
  focus = 'model',
  disabled = false,
  side = 'top',
  sheet = 'auto',
  className,
}: ComposerSettingsProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = openProp ?? uncontrolledOpen;
  const [confirming, setConfirming] = useState<ModeOption | null>(null);
  const phone = useMediaQuery(PHONE);
  const asSheet = sheet === 'auto' ? phone : sheet;
  const { search, onEscapeKeyDown, focusModel } = useModelSearch(open);
  const modeListId = useId();
  const placeListId = useId();
  const headingId = useId();

  const setOpen = (next: boolean) => {
    if (!next) setConfirming(null);
    if (openProp === undefined) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const current = findModelOption(providers, model);
  const currentMode = modes.find((m) => m.value === mode) ?? modes[0];
  const currentPlace = place?.options.find((o) => o.value === place.value);
  const elsewhere = currentPlace && currentPlace.kind !== 'computer';
  const placeWaiting =
    currentPlace?.state && currentPlace.state !== 'ready' ? currentPlace.state : undefined;
  const fastOn = fastMode && fastModeAvailable;
  const effortLabel =
    effort !== 'auto' ? efforts.find((e) => e.value === effort)?.label : undefined;
  const modelLabel = current?.model.label ?? (loading ? 'Loading…' : model);
  const modeLabel = currentMode?.label ?? mode;

  // Said in full for a screen reader: everything the chip stands for.
  const label = [
    `Model: ${current?.model.label ?? model}${
      current && providers.length > 1 ? ` (${current.provider.label})` : ''
    }${effortLabel ? `, ${effortLabel} thinking` : ''}${fastOn ? ', fast mode' : ''}`,
    `Mode: ${modeLabel}`,
    currentPlace &&
      (elsewhere || placeWaiting) &&
      `Where work runs: ${currentPlace.label}${
        placeWaiting ? `, ${PLACE_STATE_WORDS[placeWaiting].toLowerCase()}` : ''
      }`,
  ]
    .filter(Boolean)
    .join('. ');

  const chip = (
    <button
      type="button"
      className={cx(picker.chip, styles.chip, className)}
      data-lustre=""
      data-tone={currentMode?.tone ?? 'default'}
      disabled={disabled}
      aria-label={label}
    >
      <ProviderLogo provider={current?.provider.logo ?? 'generic'} size={14} />
      <span className={picker.chipLabel}>{modelLabel}</span>
      {fastOn && <Zap className={picker.chipFast} aria-hidden />}
      <span className={styles.dot} aria-hidden>
        ·
      </span>
      {currentPlace && (elsewhere || placeWaiting) && (
        <span className={styles.place} data-waiting={placeWaiting} aria-hidden>
          <PlaceGlyph kind={currentPlace.kind} />
        </span>
      )}
      <span className={styles.mode}>{modeLabel}</span>
      <ChevronDown className={picker.chevron} aria-hidden />
    </button>
  );

  const onOpenAutoFocus = (event: Event) => {
    event.preventDefault();
    const row = focus === 'mode' && document.getElementById(`${modeListId}-${mode}`);
    // Focus brings the row into view, deep in the panel as it is.
    if (row) row.focus();
    else focusModel(current?.model.id ?? '');
  };

  const body = (
    <>
      <div className={styles.scroll}>
        <div className={styles.models}>
          <ModelList
            providers={providers}
            model={model}
            onModelChange={onModelChange}
            search={search}
            loading={loading}
            searchable={searchable}
            match={match}
          />
        </div>
        <ThinkingSection efforts={efforts} effort={effort} onEffortChange={onEffortChange} />
        {fastModeAvailable && (
          <FastModeSection
            fastMode={fastMode}
            available
            onFastModeChange={onFastModeChange}
            {...(current && { modelLabel: current.model.label })}
          />
        )}
        <Group title="Mode" id={`${headingId}-mode`}>
          <ModeList
            options={modes}
            value={mode}
            onValueChange={onModeChange}
            confirming={confirming}
            onConfirmingChange={setConfirming}
            listId={modeListId}
            name={name}
          />
        </Group>
        {place && (
          <Group title="Where work runs" id={`${headingId}-place`}>
            <WorkPlaceList
              options={place.options}
              value={place.value}
              onValueChange={place.onValueChange}
              {...(place.note !== undefined && { note: place.note })}
              onSetup={(setup) => {
                setOpen(false);
                setup.onSetup();
              }}
              listId={placeListId}
            />
          </Group>
        )}
        {folder && (
          <div className={cx(picker.section, styles.folder)}>
            <span className={styles.folderText}>
              <span className={picker.sectionTitle}>
                <Folder aria-hidden className={styles.folderIcon} />
                Folder
              </span>
              <span className={styles.folderName} title={folder.path}>
                {folder.name}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Working folder: ${folder.name}. Choose another`}
              onClick={() => {
                setOpen(false);
                folder.onChoose();
              }}
            >
              Change
            </Button>
          </div>
        )}
      </div>
      {!confirming && (
        <PickerDefault isDefault={isDefault} {...(onMakeDefault && { onMakeDefault })} />
      )}
    </>
  );

  if (asSheet)
    return (
      <Sheet.Root open={open} onOpenChange={setOpen}>
        <Sheet.Trigger asChild>{chip}</Sheet.Trigger>
        <Sheet.Content
          side="bottom"
          size="lg"
          className={styles.sheet}
          aria-describedby={undefined}
          onEscapeKeyDown={onEscapeKeyDown}
          onOpenAutoFocus={onOpenAutoFocus}
        >
          <Sheet.Header className={styles.sheetHeader}>
            <Sheet.Title>Model and mode</Sheet.Title>
          </Sheet.Header>
          {body}
        </Sheet.Content>
      </Sheet.Root>
    );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{chip}</Popover.Trigger>
      <Popover.Content
        side={side}
        align="start"
        padding="none"
        className={cx(picker.panel, styles.panel)}
        aria-label="Model and mode"
        onEscapeKeyDown={onEscapeKeyDown}
        onOpenAutoFocus={onOpenAutoFocus}
      >
        {body}
      </Popover.Content>
    </Popover.Root>
  );
}

/** One titled part of the panel: Mode, Where work runs. */
function Group({ title, id, children }: { title: string; id: string; children: ReactNode }) {
  return (
    <div role="group" className={styles.group} aria-labelledby={id}>
      <p id={id} className={styles.heading}>
        {title}
      </p>
      {children}
    </div>
  );
}
