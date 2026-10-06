import { Command } from 'cmdk';
import {
  ChevronRight,
  Cloud,
  Clock,
  CornerDownRight,
  Download,
  FileKey2,
  FileText,
  Folder,
  FolderCode,
  FolderPlus,
  HardDrive,
  House,
  Monitor,
  Search,
  Shell,
  TextCursorInput,
} from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { Breadcrumb } from '../../components/Breadcrumb';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Skeleton } from '../../components/Skeleton';
import styles from './FolderBrowser.module.css';

export type FolderBrowserPlaceKind =
  | 'home'
  | 'desktop'
  | 'documents'
  | 'downloads'
  | 'projects'
  | 'cloud'
  | 'workspace'
  | 'drive'
  | 'recent'
  | 'current';

/** A place to start from: Home, Desktop, a projects folder, a disk, a folder used lately. */
export interface FolderBrowserPlace {
  path: string;
  title: string;
  kind: FolderBrowserPlaceKind;
  /** "~/Projects", shown under its name where there's room. */
  detail?: string;
}

/** A folder (or, choosing a file, a file) in the one you're looking at. */
export interface FolderBrowserEntry {
  name: string;
  path: string;
  /** A shortcut to somewhere else. */
  link?: boolean;
  /** Its name starts with a dot. */
  hidden?: boolean;
}

/** What's in the folder you're looking at, as the gateway read it. */
export interface FolderBrowserListing {
  path: string;
  name: string;
  /** "~/Projects". */
  shown: string;
  parent?: string;
  crumbs: { name: string; path: string; top?: 'home' | 'disk' }[];
  folders: FolderBrowserEntry[];
  files?: FolderBrowserEntry[];
  hiddenCount: number;
  /** More than a listing holds: these are the first, by name. */
  more: boolean;
  writable: boolean;
}

/** A path being typed, read: what's there, and the folders it might go on to. */
export interface FolderBrowserGuess {
  path: string;
  state: 'folder' | 'file' | 'missing' | 'denied';
  message?: string;
  matches: FolderBrowserEntry[];
}

export interface FolderBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Choose a folder" by default. */
  title?: string;
  /** What it's for, in a line: "Where Conch reads and writes files." */
  description?: ReactNode;
  /** A folder (the default), or a file in one. */
  kind?: 'folder' | 'file';
  places?: FolderBrowserPlace[];
  /** Folders chosen lately, newest first. */
  recent?: FolderBrowserPlace[];
  /** The folder you're looking at. Undefined while the first one loads. */
  listing?: FolderBrowserListing;
  loading?: boolean;
  /**
   * Why the folder asked for couldn't be opened, in a sentence. `listing` is
   * then the last one that could, which it offers to go back to.
   */
  problem?: string;
  /** Hidden folders (names starting with a dot) are listed. */
  showHidden?: boolean;
  onShowHiddenChange?: (show: boolean) => void;
  /** Go into a folder. */
  onOpenFolder: (path: string) => void;
  /** The folder you're in (or the file chosen) is the answer. */
  onChoose: (path: string) => void;
  /** Make a new folder where you are; rejects with the words to show. */
  onCreateFolder?: (name: string) => Promise<void>;
  /** Read a typed path, for the power user's way in. Leave out to not offer typing. */
  onGuess?: (typed: string) => Promise<FolderBrowserGuess>;
  /** How this computer writes paths. */
  separator?: '/' | '\\';
}

const PLACE_ICONS: Record<FolderBrowserPlaceKind, ReactNode> = {
  home: <House />,
  desktop: <Monitor />,
  documents: <FileText />,
  downloads: <Download />,
  projects: <FolderCode />,
  cloud: <Cloud />,
  workspace: <Shell />,
  drive: <HardDrive />,
  recent: <Clock />,
  current: <Folder />,
};

/** The filter: names that have what was typed in them, nothing fuzzy. */
const byName = (_value: string, search: string, keywords?: string[]) =>
  keywords?.[0]?.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) ? 1 : 0;

const fine = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches === true;

/**
 * Choosing a folder on the computer Conch runs on, from any device: the
 * places people start from, the trail to where you are, the folders in it
 * (filtered as you type), a new folder where you are, and — tucked away —
 * typing a path, with suggestions as you go.
 *
 * Every folder is one press to go into; **Choose** takes the one you're in,
 * as a Mac's Open dialog does. Choosing a file, a press picks it and a
 * second (or Choose) takes it. The keyboard does it all: type to filter,
 * ↑↓ to move, Enter to go in, Backspace in an empty filter to go up, ⌘/Ctrl
 * + Enter to choose.
 */
export function FolderBrowser({
  open,
  onOpenChange,
  title,
  description,
  kind = 'folder',
  places = [],
  recent = [],
  listing,
  loading = false,
  problem,
  showHidden = false,
  onShowHiddenChange,
  onOpenFolder,
  onChoose,
  onCreateFolder,
  onGuess,
  separator = '/',
}: FolderBrowserProps) {
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'list' | 'new' | 'type'>('list');
  const [typed, setTyped] = useState('');
  const [read, setRead] = useState<{ typed: string; guess: FolderBrowserGuess }>();
  const [file, setFile] = useState<string>();
  const [name, setName] = useState('');
  const [made, setMade] = useState<{ busy?: boolean; problem?: string }>({});
  const input = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const placesLabel = useId();
  const recentLabel = useId();
  const at = listing?.path;

  // A new folder in view: a clean filter, nothing picked, the keyboard where it was.
  const [seen, setSeen] = useState(at);
  if (seen !== at) {
    setSeen(at);
    setFilter('');
    setFile(undefined);
  }
  // Closed: it opens next time as it first did.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (!open) {
      setMode('list');
      setFilter('');
      setFile(undefined);
    }
  }

  // The typed path, read as it changes (a little after, so each key isn't a request).
  const typing = mode === 'type' && Boolean(onGuess) && Boolean(typed.trim());
  useEffect(() => {
    if (!typing || !onGuess) return;
    let stale = false;
    const timer = setTimeout(() => {
      void onGuess(typed).then(
        (guess) => !stale && setRead({ typed, guess }),
        () => !stale && setRead(undefined),
      );
    }, 140);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [typing, typed, onGuess]);
  // What was read of the path as it's typed now (an older answer still helps while the next comes).
  const guess = typing ? read?.guess : undefined;

  const go = (path: string) => {
    setMode('list');
    onOpenFolder(path);
  };

  const startTyping = () => {
    setMode('type');
    setTyped(listing ? `${listing.shown.replace(/[\\/]$/, '')}${separator}` : `~${separator}`);
    requestAnimationFrame(() => input.current?.focus());
  };

  const startNew = () => {
    setMode('new');
    setName('');
    setMade({});
    requestAnimationFrame(() => nameInput.current?.focus());
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!onCreateFolder || !name.trim()) return;
    setMade({ busy: true });
    try {
      await onCreateFolder(name.trim());
      setMode('list');
      setMade({});
    } catch (error) {
      setMade({
        problem: error instanceof Error ? error.message : 'That folder couldn’t be made.',
      });
    }
  };

  const chosen = kind === 'file' ? file : at;
  const choose = () => {
    if (chosen && !problem) onChoose(chosen);
  };

  const fileName = file ? listing?.files?.find((f) => f.path === file)?.name : undefined;
  const chooseLabel =
    kind === 'file'
      ? fileName
        ? `Choose “${fileName}”`
        : 'Choose a file'
      : listing
        ? `Choose “${listing.name}”`
        : 'Choose';

  /** The typed path's words: what's wrong with it, or nothing. */
  const typedNote =
    mode === 'type' && guess && typed.trim()
      ? guess.state === 'folder'
        ? undefined
        : guess.state === 'file'
          ? kind === 'file'
            ? undefined
            : 'That’s a file, not a folder.'
          : (guess.message ?? (guess.matches.length ? undefined : 'There’s no folder there.'))
      : undefined;

  const complete = (entry: FolderBrowserEntry) => {
    const next = typed.replace(/[^\\/]*$/, entry.name) + separator;
    setTyped(next);
    input.current?.focus();
  };

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (mode === 'type' && guess?.state === 'folder') onChoose(guess.path);
      else choose();
      return;
    }
    if (mode === 'type') {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMode('list');
        return;
      }
      if (event.key === 'Tab' && !event.shiftKey && guess?.matches[0]) {
        event.preventDefault();
        complete(guess.matches[0]);
        return;
      }
      if (event.key === 'Enter') {
        // A suggestion that's highlighted is cmdk's to take; the typed path is ours.
        const highlighted = event.currentTarget
          .closest('[cmdk-root]')
          ?.querySelector('[cmdk-item][data-selected="true"]');
        if (highlighted) return;
        event.preventDefault();
        if (guess?.state === 'folder') go(guess.path);
        else if (guess?.state === 'file' && kind === 'file') onChoose(guess.path);
      }
      return;
    }
    if (event.key === 'Backspace' && !filter && listing?.parent) {
      event.preventDefault();
      go(listing.parent);
    } else if (event.key === 'ArrowUp' && event.altKey && listing?.parent) {
      event.preventDefault();
      go(listing.parent);
    }
  };

  const folders = listing?.folders ?? [];
  const files = listing?.files ?? [];
  const nothing = !loading && !problem && listing && folders.length === 0 && files.length === 0;

  const placeList = (items: FolderBrowserPlace[], labelId: string) => (
    <ul className={styles.placeList} aria-labelledby={labelId}>
      {items.map((place) => (
        <li key={`${place.kind}:${place.path}`}>
          <button
            type="button"
            className={styles.place}
            aria-current={place.path === at ? 'location' : undefined}
            title={place.detail ?? place.path}
            onClick={() => go(place.path)}
          >
            <span className={styles.placeIcon} aria-hidden>
              {PLACE_ICONS[place.kind]}
            </span>
            <span className={styles.placeName}>{place.title}</span>
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="lg"
        className={styles.dialog}
        onOpenAutoFocus={(event) => {
          // A keyboard is ready to filter; a phone's isn't raised for it.
          event.preventDefault();
          const content = event.currentTarget as HTMLElement | null;
          if (fine()) input.current?.focus();
          else content?.focus();
        }}
      >
        <Dialog.Header>
          <Dialog.Title>
            {title ?? (kind === 'file' ? 'Choose a file' : 'Choose a folder')}
          </Dialog.Title>
          {description ? (
            <Dialog.Description>{description}</Dialog.Description>
          ) : (
            <Dialog.Description className={styles.quiet}>
              {kind === 'file'
                ? 'On the computer Conch runs on.'
                : 'On the computer Conch runs on. Go into a folder, then choose it.'}
            </Dialog.Description>
          )}
        </Dialog.Header>

        <div className={styles.frame}>
          <nav className={styles.places} aria-label="Places">
            {places.length > 0 && (
              <>
                <span id={placesLabel} className={styles.placesLabel}>
                  Places
                </span>
                {placeList(places, placesLabel)}
              </>
            )}
            {recent.length > 0 && (
              <>
                <span id={recentLabel} className={styles.placesLabel}>
                  Recent
                </span>
                {placeList(recent, recentLabel)}
              </>
            )}
          </nav>

          <div className={styles.main}>
            <div className={styles.toolbar}>
              {listing ? (
                <Breadcrumb size="sm" aria-label="Where you are" className={styles.trail}>
                  {listing.crumbs.map((crumb, i) =>
                    i === listing.crumbs.length - 1 ? (
                      <Breadcrumb.Item key={crumb.path} current>
                        {crumb.top === 'home' ? <TopName name={crumb.name} /> : crumb.name}
                      </Breadcrumb.Item>
                    ) : (
                      <Breadcrumb.Item key={crumb.path} onClick={() => go(crumb.path)}>
                        {crumb.top === 'home' ? <TopName name={crumb.name} /> : crumb.name}
                      </Breadcrumb.Item>
                    ),
                  )}
                </Breadcrumb>
              ) : (
                <Skeleton shape="text" width="40%" />
              )}
              <div className={styles.tools}>
                {onGuess && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label="Type a path"
                    aria-pressed={mode === 'type'}
                    onClick={() => (mode === 'type' ? setMode('list') : startTyping())}
                  >
                    <TextCursorInput />
                  </IconButton>
                )}
                {onCreateFolder && listing?.writable && !problem && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    label="New folder"
                    aria-pressed={mode === 'new'}
                    onClick={() => (mode === 'new' ? setMode('list') : startNew())}
                  >
                    <FolderPlus />
                  </IconButton>
                )}
              </div>
            </div>

            {mode === 'new' && (
              <form className={styles.newFolder} onSubmit={(e) => void create(e)}>
                <Input
                  size="sm"
                  aria-label="New folder’s name"
                  placeholder="Untitled folder"
                  ref={nameInput}
                  value={name}
                  spellCheck={false}
                  autoComplete="off"
                  maxLength={255}
                  leading={<FolderPlus />}
                  invalid={Boolean(made.problem)}
                  onChange={(e) => {
                    setName(e.target.value);
                    setMade({});
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      e.stopPropagation();
                      setMode('list');
                    }
                  }}
                />
                <Button size="sm" type="submit" loading={made.busy} disabled={!name.trim()}>
                  Make
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setMode('list')}>
                  Cancel
                </Button>
                {made.problem && (
                  <p role="alert" className={styles.note}>
                    {made.problem}
                  </p>
                )}
              </form>
            )}

            <Command
              // cmdk names its text box by this.
              label={mode === 'type' ? 'Path' : 'Filter folders'}
              className={styles.command}
              shouldFilter={mode !== 'type'}
              filter={byName}
              loop
            >
              <div className={styles.inputRow} data-typing={mode === 'type' || undefined}>
                <span className={styles.inputIcon} aria-hidden>
                  {mode === 'type' ? <CornerDownRight /> : <Search />}
                </span>
                <Command.Input
                  ref={input}
                  className={styles.input}
                  value={mode === 'type' ? typed : filter}
                  onValueChange={mode === 'type' ? setTyped : setFilter}
                  onKeyDown={onInputKey}
                  placeholder={
                    mode === 'type'
                      ? `~${separator}Projects`
                      : listing
                        ? `Filter ${listing.name}`
                        : 'Filter'
                  }
                  aria-describedby={typedNote ? `${placesLabel}-typed` : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                />
              </div>
              {typedNote && (
                <p id={`${placesLabel}-typed`} className={styles.typedNote} role="status">
                  {typedNote}
                </p>
              )}
              <Command.List
                label={
                  mode === 'type'
                    ? 'Folders it could go on to'
                    : listing
                      ? `In ${listing.name}`
                      : 'Folders'
                }
                className={styles.list}
                aria-busy={loading || undefined}
                data-loading={loading || undefined}
              >
                {mode === 'type' ? (
                  <>
                    {guess?.state === 'folder' && (
                      <Command.Item
                        value={`go:${guess.path}`}
                        onSelect={() => go(guess.path)}
                        className={styles.row}
                      >
                        <span className={styles.rowIcon} aria-hidden>
                          <CornerDownRight />
                        </span>
                        <span className={styles.rowName}>Go to {typed.trim()}</span>
                      </Command.Item>
                    )}
                    {guess?.matches.map((entry) => (
                      <Command.Item
                        key={entry.path}
                        value={entry.path}
                        onSelect={() => complete(entry)}
                        className={styles.row}
                      >
                        <span className={styles.rowIcon} aria-hidden>
                          <Folder />
                        </span>
                        <span className={styles.rowName}>{entry.name}</span>
                        <ChevronRight aria-hidden className={styles.rowGo} />
                      </Command.Item>
                    ))}
                  </>
                ) : problem ? (
                  <div role="alert" className={styles.problem}>
                    <p>{problem}</p>
                    {listing && (
                      <Button size="sm" variant="surface" onClick={() => go(listing.path)}>
                        Back to {listing.name}
                      </Button>
                    )}
                  </div>
                ) : !listing || (loading && folders.length === 0) ? (
                  <div className={styles.skeletons} aria-hidden>
                    {[64, 48, 72, 40, 56].map((w) => (
                      <Skeleton key={w} shape="text" width={`${w}%`} />
                    ))}
                  </div>
                ) : (
                  <>
                    {folders.map((entry) => (
                      <Command.Item
                        key={entry.path}
                        value={entry.path}
                        keywords={[entry.name]}
                        onSelect={() => go(entry.path)}
                        className={styles.row}
                        data-hidden={entry.hidden || undefined}
                      >
                        <span className={styles.rowIcon} aria-hidden>
                          <Folder />
                        </span>
                        <span className={styles.rowName}>{entry.name}</span>
                        {entry.link && <span className={styles.rowTag}>Shortcut</span>}
                        <ChevronRight aria-hidden className={styles.rowGo} />
                      </Command.Item>
                    ))}
                    {files.map((entry) => (
                      <Command.Item
                        key={entry.path}
                        value={entry.path}
                        keywords={[entry.name]}
                        onSelect={() =>
                          file === entry.path ? onChoose(entry.path) : setFile(entry.path)
                        }
                        className={styles.row}
                        data-chosen={file === entry.path || undefined}
                        aria-checked={file === entry.path}
                      >
                        <span className={styles.rowIcon} aria-hidden>
                          <FileKey2 />
                        </span>
                        <span className={styles.rowName}>{entry.name}</span>
                      </Command.Item>
                    ))}
                    {nothing ? (
                      <p className={styles.empty}>
                        {kind === 'file' ? 'Nothing to choose in here.' : 'No folders in here.'}
                      </p>
                    ) : (
                      <Command.Empty className={styles.empty}>
                        Nothing called “{filter.trim()}” in here.
                      </Command.Empty>
                    )}
                  </>
                )}
              </Command.List>
              {mode !== 'type' &&
                listing &&
                !problem &&
                (listing.hiddenCount > 0 || showHidden || listing.more) && (
                  <div className={styles.foot}>
                    {listing.more && (
                      <span className={styles.note}>
                        The first {folders.length} by name. Filter to find another.
                      </span>
                    )}
                    {onShowHiddenChange && (listing.hiddenCount > 0 || showHidden) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onShowHiddenChange(!showHidden)}
                      >
                        {showHidden
                          ? 'Leave out hidden folders'
                          : listing.hiddenCount === 1
                            ? 'Show 1 hidden folder'
                            : `Show ${listing.hiddenCount} hidden folders`}
                      </Button>
                    )}
                  </div>
                )}
            </Command>
          </div>
        </div>

        <Dialog.Footer className={styles.footer}>
          <Dialog.Close asChild>
            <Button variant="ghost">Cancel</Button>
          </Dialog.Close>
          <Button
            onClick={() =>
              mode === 'type' && guess?.state === 'folder' && kind === 'folder'
                ? onChoose(guess.path)
                : choose()
            }
            disabled={
              mode === 'type'
                ? guess?.state !== 'folder' || kind !== 'folder'
                : !chosen || Boolean(problem) || loading
            }
            className={styles.choose}
          >
            {mode === 'type' && kind === 'folder' && guess?.state === 'folder'
              ? 'Choose this folder'
              : chooseLabel}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** The home folder's step: its mark, then its name. */
function TopName({ name }: { name: string }) {
  return (
    <span className={styles.top}>
      <House aria-hidden />
      {name}
    </span>
  );
}
