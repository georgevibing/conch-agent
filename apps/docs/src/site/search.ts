/**
 * What ⌘K can find: every page, every heading, and every generated thing with
 * a name (a command, a setting, a slash command, an app). Built from the same
 * pages and reference the site draws, so a new one is findable the moment it
 * exists.
 */
import reference from 'virtual:conch-reference';

import { RELEASES_HEAD } from './head';
import { SECTIONS } from './config';
import { PAGES } from './pages';
import { slugify } from './text';

export interface Findable {
  /** What cmdk matches against, and the item's identity. */
  id: string;
  title: string;
  /** Where it is: a section, or the page a heading belongs to. */
  where: string;
  /** A second line, when there's something to say. */
  description?: string;
  to: string;
  /** More words that should find it. */
  keywords: string[];
  kind: 'page' | 'heading' | 'reference';
}

const sectionTitle = new Map(SECTIONS.map((section) => [section.id, section.title]));

const pages: Findable[] = PAGES.map((page) => ({
  id: `page ${page.path}`,
  title: page.title,
  where: sectionTitle.get(page.section) ?? 'Decisions',
  description: page.description,
  to: page.path,
  keywords: [page.nav, page.description, page.provider ?? '', page.channel ?? ''],
  kind: 'page',
}));

const headings: Findable[] = PAGES.flatMap((page) =>
  page.headings.map((heading) => ({
    id: `heading ${page.path}#${heading.id}`,
    title: heading.text,
    where: page.title,
    to: `${page.path}#${heading.id}`,
    keywords: [page.title],
    kind: 'heading' as const,
  })),
);

const named: Findable[] = [
  ...reference.cli.map((command) => ({
    id: `cli ${command.usage}`,
    title: `conch ${command.usage}`,
    where: 'Command line',
    description: command.summary,
    to: `/reference/cli#${slugify(command.usage)}`,
    keywords: [command.summary, command.group],
    kind: 'reference' as const,
  })),
  ...reference.env
    .filter((variable) => !variable.internal)
    .map((variable) => ({
      id: `env ${variable.name}`,
      title: variable.name,
      where: 'Configuration',
      description: variable.about,
      to: `/reference/configuration#${variable.name.toLowerCase()}`,
      keywords: [variable.about],
      kind: 'reference' as const,
    })),
  ...reference.slash.map((command) => ({
    id: `slash ${command.name}`,
    title: `/${command.name}`,
    where: 'Slash commands',
    description: command.description,
    to: `/reference/slash-commands#slash-${command.name}`,
    keywords: [command.description, ...command.aliases],
    kind: 'reference' as const,
  })),
  ...reference.integrations.map((app) => ({
    id: `app ${app.id}`,
    title: app.name,
    where: 'Apps',
    description: app.tagline,
    to: '/features/apps',
    keywords: [app.tagline, app.description, app.category],
    kind: 'reference' as const,
  })),
];

/** Shown before anything is typed: the pages of the sidebar. */
export const BROWSABLE: readonly Findable[] = pages.filter((page) =>
  sectionTitle.has(PAGES.find((p) => p.path === page.to)?.section ?? ''),
);

/** Everything, once someone types. */
export const FINDABLES: readonly Findable[] = [
  {
    id: 'page /releases',
    title: 'Release notes',
    where: 'Conch',
    description: RELEASES_HEAD.description,
    to: '/releases',
    keywords: ['versions', 'what’s new', 'stable', 'beta', 'alpha', 'changelog'],
    kind: 'page',
  },
  ...pages,
  ...named,
  ...headings,
];
