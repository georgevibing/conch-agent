import type { FolderBrowserGuess, FolderBrowserListing, FolderBrowserPlace } from './FolderBrowser';

/** A pretend home folder for stories and tests: paths → the folders (and files) in them. */
export const TREE: Record<string, { folders: string[]; files?: string[]; hidden?: string[] }> = {
  '/Users/ada': {
    folders: ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Projects'],
    hidden: ['.config', '.npm'],
  },
  '/Users/ada/Desktop': { folders: ['Screenshots'] },
  '/Users/ada/Documents': { folders: ['Passwords', 'Taxes 2026', 'Writing'], files: ['CV.pdf'] },
  '/Users/ada/Documents/Passwords': { folders: [], files: ['Family.kdbx', 'Main.kdbx'] },
  '/Users/ada/Downloads': { folders: [] },
  '/Users/ada/Projects': {
    folders: ['conch', 'garden-planner', 'notes', 'website', 'weekend-robot'],
  },
  '/Users/ada/Projects/conch': { folders: ['apps', 'docs', 'packages', 'scripts'] },
};

export const HOME = '/Users/ada';

export const PLACES: FolderBrowserPlace[] = [
  { kind: 'home', title: 'Home', path: HOME, detail: '~' },
  { kind: 'desktop', title: 'Desktop', path: `${HOME}/Desktop` },
  { kind: 'documents', title: 'Documents', path: `${HOME}/Documents` },
  { kind: 'downloads', title: 'Downloads', path: `${HOME}/Downloads` },
  { kind: 'projects', title: 'Projects', path: `${HOME}/Projects` },
  { kind: 'cloud', title: 'iCloud Drive', path: `${HOME}/Library/Mobile Documents` },
  { kind: 'workspace', title: 'Conch’s workspace', path: `${HOME}/.conch/workspace` },
  { kind: 'drive', title: 'Macintosh HD', path: '/' },
];

export const RECENT: FolderBrowserPlace[] = [
  { kind: 'recent', title: 'conch', path: `${HOME}/Projects/conch`, detail: '~/Projects/conch' },
  { kind: 'recent', title: 'website', path: `${HOME}/Projects/website` },
];

const shownOf = (path: string) => (path.startsWith(HOME) ? `~${path.slice(HOME.length)}` : path);

/** What the gateway would say about `path`. */
export function listingOf(
  path: string,
  options: { hidden?: boolean; files?: boolean } = {},
): FolderBrowserListing | undefined {
  const here = TREE[path];
  if (!here) return undefined;
  const steps = path.slice(HOME.length).split('/').filter(Boolean);
  const crumbs = [{ name: 'Home', path: HOME, top: 'home' as const }];
  let at = HOME;
  for (const step of steps) {
    at = `${at}/${step}`;
    crumbs.push({ name: step, path: at } as (typeof crumbs)[number]);
  }
  const names = [...(options.hidden ? (here.hidden ?? []) : []), ...here.folders];
  return {
    path,
    name: crumbs.at(-1)?.name ?? 'Home',
    shown: shownOf(path),
    ...(path !== HOME && { parent: path.slice(0, path.lastIndexOf('/')) }),
    crumbs,
    folders: names.map((name) => ({
      name,
      path: `${path}/${name}`,
      ...(name.startsWith('.') && { hidden: true }),
    })),
    ...(options.files && {
      files: (here.files ?? []).map((name) => ({ name, path: `${path}/${name}` })),
    }),
    hiddenCount: options.hidden ? 0 : (here.hidden?.length ?? 0),
    more: false,
    writable: true,
  };
}

/** What the gateway would say about a typed path. */
export function guessOf(typed: string): FolderBrowserGuess {
  const path = typed.replace(/^~/, HOME);
  const dir = path.endsWith('/') ? path.replace(/\/$/, '') : path.slice(0, path.lastIndexOf('/'));
  const prefix = path.endsWith('/') ? '' : path.slice(path.lastIndexOf('/') + 1);
  const matches = (TREE[dir]?.folders ?? [])
    .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((name) => ({ name, path: `${dir}/${name}` }));
  const clean = path.replace(/\/$/, '');
  return {
    path: clean,
    state: TREE[clean] ? 'folder' : 'missing',
    ...(!TREE[clean] && !matches.length && { message: 'There’s no folder there.' }),
    matches,
  };
}
