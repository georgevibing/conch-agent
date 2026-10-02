/** Where the code lives, for "Edit this page" and links to files that aren't pages. */
export const REPO_URL = 'https://github.com/giotiskl/conch-agent';
export const REPO_BRANCH = 'main';

/**
 * Who signs the note on the front page. A placeholder taken from the
 * repository's address: change it to the name and page you want there.
 */
export const AUTHOR = { name: 'giotiskl', url: 'https://github.com/giotiskl' } as const;

/** The one-line installers (README § Quick start). */
export const INSTALL = {
  unix: `curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/${REPO_BRANCH}/scripts/install.sh | sh`,
  windows: `irm https://raw.githubusercontent.com/giotiskl/conch-agent/${REPO_BRANCH}/scripts/install.ps1 | iex`,
} as const;

export interface Section {
  id: string;
  title: string;
  /** One line, for the home page and search. */
  about: string;
}

/**
 * The sidebar, in order. A page joins a section by living in its folder
 * (`content/<id>/`); sections themselves are the only thing listed by hand.
 */
export const SECTIONS: readonly Section[] = [
  { id: 'start', title: 'Get started', about: 'Install it, say hello, take it with you.' },
  { id: 'providers', title: 'Providers', about: 'The assistants and models Conch drives.' },
  { id: 'channels', title: 'Talk to me here', about: 'Reach it from the chat apps on your phone.' },
  { id: 'features', title: 'What it does', about: 'Memory, skills, the web, your files.' },
  { id: 'care', title: 'It looks after itself', about: 'Repair, backups, updates, undo.' },
  { id: 'security', title: 'Security', about: 'Who gets in, and what the assistant may do.' },
  { id: 'reference', title: 'Reference', about: 'Every command, setting and message.' },
  { id: 'project', title: 'Under the hood', about: 'How Conch is built, and why.' },
];
