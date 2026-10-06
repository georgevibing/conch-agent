import type { PickPurpose } from '@conch/protocol';
import { FolderBrowser, type FolderBrowserPlace } from '@conch/nacre';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { create } from 'zustand';

import { ApiError } from '../../api/client';
import { folders, inDesktopApp, pickPath } from '../../lib/pick';

/** What each purpose is called in the browser, and whether it's a file. */
const WORDS: Record<PickPurpose, { title: string; description?: string; kind: 'folder' | 'file' }> =
  {
    workspace: {
      title: 'Choose a working folder',
      description: 'Where your assistant reads and writes files.',
      kind: 'folder',
    },
    'watch-folder': {
      title: 'Choose a folder to watch',
      description: 'The routine starts when something changes in it.',
      kind: 'folder',
    },
    'keepassxc-database': { title: 'Choose your KeePassXC database', kind: 'file' },
    'keepassxc-keyfile': {
      title: 'Choose the key file',
      description: 'Conch keeps where it is, never what’s in it.',
      kind: 'file',
    },
    'conch-app': { title: 'Choose the app to add', kind: 'file' },
  };

export interface ChooseOptions {
  purpose: PickPurpose;
  /** Where it is now, to start there. */
  current?: string;
}

interface Asking extends ChooseOptions {
  answer: (path: string | undefined) => void;
}

const useAsking = create<{ asking?: Asking }>(() => ({}));

const RECENT_KEY = 'conch.folders.recent';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value)
      ? value.filter((p): p is string => typeof p === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function remember(path: string) {
  try {
    const next = [path, ...readRecent().filter((p) => p !== path)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // A private window: nothing remembered, nothing lost.
  }
}

const nameOf = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
const parentOf = (path: string) => path.replace(/[\\/][^\\/]*[\\/]?$/, '') || '/';

/**
 * Choose a folder (or a file) on the computer Conch runs on, from wherever
 * this page is: the system's own Open dialog in the desktop app, and Conch's
 * folder browser everywhere else — a browser here, a phone, a laptop on the
 * same Tailscale. Resolves the path, or undefined when the person cancels.
 */
export async function chooseOnComputer(options: ChooseOptions): Promise<string | undefined> {
  if (inDesktopApp()) {
    try {
      return await pickPath(options.purpose);
    } catch {
      // The app couldn't show it: the browser does the same job.
    }
  }
  const previous = useAsking.getState().asking;
  previous?.answer(undefined);
  return new Promise((answer) => useAsking.setState({ asking: { ...options, answer } }));
}

/** The folder browser, over everything (and over Settings), when something asks for a folder. */
export function FolderChooserHost() {
  const asking = useAsking((s) => s.asking);
  if (!asking) return null;
  // A new question starts afresh: where it started, nothing typed.
  return <Chooser key={`${asking.purpose}:${asking.current ?? ''}`} asking={asking} />;
}

function Chooser({ asking }: { asking: Asking }) {
  const client = useQueryClient();
  const words = WORDS[asking.purpose];
  const recentPaths = readRecent();
  const startAt =
    words.kind === 'file' && asking.current
      ? parentOf(asking.current)
      : (asking.current ?? recentPaths[0] ?? '~');
  const [path, setPath] = useState(startAt);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(true);

  const places = useQuery({
    queryKey: ['folders', 'places'],
    queryFn: folders.places,
    staleTime: 60_000,
  });
  const listing = useQuery({
    queryKey: ['folders', 'list', path, hidden, words.kind === 'file' ? asking.purpose : 'folder'],
    queryFn: () =>
      folders.list(path, { hidden, ...(words.kind === 'file' && { purpose: asking.purpose }) }),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 5_000,
  });

  // Where it was isn't there any more (a folder moved, a drive unplugged): start at home, quietly.
  const missing = listing.error instanceof ApiError && listing.error.code === 'folder-missing';
  if (missing && path === startAt && startAt !== '~') setPath('~');

  const finish = (answer: string | undefined) => {
    setOpen(false);
    asking.answer(answer);
    // Let the dialog leave before it's gone.
    setTimeout(() => {
      if (useAsking.getState().asking === asking) useAsking.setState({ asking: undefined });
    }, 200);
  };

  const known = new Set((places.data?.places ?? []).map((p) => p.path));
  const recent: FolderBrowserPlace[] = [
    ...(asking.current && words.kind === 'folder' && !known.has(asking.current)
      ? [{ kind: 'current' as const, title: nameOf(asking.current), path: asking.current }]
      : []),
    ...recentPaths
      .filter((p) => !known.has(p) && p !== asking.current)
      .map((p) => ({ kind: 'recent' as const, title: nameOf(p), path: p })),
  ].slice(0, RECENT_MAX);

  const problem =
    listing.error && !(missing && path === startAt)
      ? listing.error instanceof ApiError
        ? listing.error.message
        : 'That folder couldn’t be read.'
      : undefined;

  return (
    <FolderBrowser
      open={open}
      onOpenChange={(next) => !next && finish(undefined)}
      title={words.title}
      {...(words.description && { description: words.description })}
      kind={words.kind}
      places={(places.data?.places ?? []).map((p) => ({
        kind: p.kind,
        title: p.title,
        path: p.path,
        ...(p.shown && { detail: p.shown }),
      }))}
      recent={recent}
      listing={listing.data}
      loading={listing.isFetching}
      problem={problem}
      separator={places.data?.separator ?? '/'}
      showHidden={hidden}
      onShowHiddenChange={setHidden}
      onOpenFolder={setPath}
      onChoose={(chosen) => {
        remember(words.kind === 'file' ? parentOf(chosen) : chosen);
        finish(chosen);
      }}
      onCreateFolder={async (name) => {
        const parent = listing.data?.path;
        if (!parent) return;
        const made = await folders.make(parent, name);
        await client.invalidateQueries({ queryKey: ['folders', 'list', parent] });
        setPath(made.path);
      }}
      onGuess={folders.guess}
    />
  );
}
