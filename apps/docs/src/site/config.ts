/** Where the site is: every page's one true address starts here. */
export const SITE_URL = 'https://conchagent.com';

/** Where the code lives, for "Edit this page" and links to files that aren't pages. */
export const REPO_URL = 'https://github.com/georgevibing/conch-agent';
export const REPO_BRANCH = 'main';

/** Who signs the note on the front page. */
export const AUTHOR = { name: 'George Kal', url: 'https://github.com/georgevibing' } as const;

/**
 * Where the app is downloaded (ADR 0054): the newest release on GitHub, with
 * the files for every system attached by the release workflow.
 */
export const DOWNLOADS = `${REPO_URL}/releases/latest`;

/** The one-line installers (README § Install), served by the site from `scripts/` when it's built. */
export const INSTALL = {
  unix: `curl -fsSL ${SITE_URL}/install.sh | sh`,
  windows: `irm ${SITE_URL}/install.ps1 | iex`,
  /** On a server: no screen, so it asks how you'll reach Conch (ADR 0064). */
  server: `curl -fsSL ${SITE_URL}/install.sh | sh -s -- --server`,
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
