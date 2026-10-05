/**
 * The documentation kept honest. Each test fails with what to do about it,
 * so a change to Conch that the pages haven't caught up with can't pass
 * `pnpm check` (AGENTS.md, working agreement 13).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import reference from 'virtual:conch-reference';

import { CHANNEL_SCENES } from './embeds/channels';
import { EMBED_NAMES } from './embeds/Embed';
import { SECTIONS } from './site/config';
import { PAGES, pagesIn, resolveLink, type Page } from './site/pages';
import { FINDABLES } from './site/search';
import { embeds, links } from './site/text';

const REPO = resolve(import.meta.dirname, '../../..');

const about = (kind: 'provider' | 'channel', id: string): Page | undefined =>
  PAGES.find((page) => page[kind] === id);

describe('what the code has, the pages cover', () => {
  it.each(reference.providers.map((provider) => [provider.name, provider.id]))(
    'the provider %s has a guide',
    (name, id) => {
      expect(
        about('provider', id)?.body,
        `${name} is a provider in apps/server/src/providers/catalog.ts with no guide. ` +
          `Write apps/docs/content/providers/${id}.md: front matter "provider: ${id}", then ` +
          `how to connect it, what it brings, and what to know first. Its facts are generated.`,
      ).toBeTruthy();
    },
  );

  it.each(
    reference.channels
      .filter((channel) => channel.available)
      .map((channel) => [channel.name, channel.id]),
  )('the channel %s has a guide', (name, id) => {
    expect(
      about('channel', id)?.body,
      `${name} is a channel in apps/server/src/channels/catalog.ts with no guide. ` +
        `Write apps/docs/content/channels/${id}.md: front matter "channel: ${id}", then the ` +
        `steps to connect it and a picture of the other app (apps/docs/src/embeds/channels.tsx).`,
    ).toBeTruthy();
  });

  it('every key the app listens for is on the keyboard page', () => {
    const keyboard = PAGES.find((page) => page.path === '/reference/keyboard');
    const listed = new Set(
      [...(keyboard?.body ?? '').matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((match) => match[1]),
    );
    const missing = reference.hotkeys.filter((keys) => !listed.has(keys));
    expect(
      missing,
      `The app listens for ${missing.join(', ')} (useHotkey in apps/web), which ` +
        `apps/docs/content/reference/keyboard.md doesn't list. Add a row: | <kbd>keys</kbd> | what it does |.`,
    ).toEqual([]);
  });

  it('every command, setting and mode says what it does', () => {
    const silent = [
      ...reference.cli.filter((c) => !c.detail || !c.summary).map((c) => `pnpm conch ${c.usage}`),
      ...reference.env.filter((v) => !v.about).map((v) => v.name),
      ...reference.modes.filter((m) => !m.description).map((m) => m.label),
      ...reference.slash.filter((s) => !s.description).map((s) => `/${s.name}`),
    ];
    expect(silent, `These have no words where the code defines them: ${silent.join(', ')}`).toEqual(
      [],
    );
  });

  it('reads the parts of Conch it is generated from', () => {
    // If one of these is empty, apps/docs/reference/build.ts lost track of where it's defined.
    expect(reference.providers.length).toBeGreaterThan(0);
    expect(reference.channels.some((channel) => channel.available)).toBe(true);
    expect(reference.integrations.length).toBeGreaterThan(0);
    expect(reference.cli.length).toBeGreaterThan(0);
    expect(reference.files.length).toBeGreaterThan(0);
    expect(reference.needs.length).toBeGreaterThan(0);
    expect(reference.routes).toContainEqual({ method: 'GET', path: '/api/health', area: 'health' });
    expect(reference.socket.commands.map((m) => m.type)).toContain('conversation.send');
    expect(reference.socket.events.map((m) => m.type)).toContain('conversation.event');
    expect(reference.socket.conversation.every((m) => m.type)).toBe(true);
  });
});

describe('every page', () => {
  it('has a place: a title, a sentence about it, and an address of its own', () => {
    const paths = PAGES.map((page) => page.path);
    expect(new Set(paths).size, 'Two pages have the same address.').toBe(paths.length);
    for (const page of PAGES) {
      expect(page.title, `${page.file} has no title.`).toBeTruthy();
      if (!page.listed) continue;
      expect(
        page.description,
        `${page.file} has no description: add "description:" to its front matter, one sentence.`,
      ).toBeTruthy();
      expect(
        page.description.length,
        `${page.file}: its description runs to ${page.description.length} characters. Keep it to one sentence.`,
      ).toBeLessThanOrEqual(160);
    }
  });

  it('sits in a section, and every section has pages', () => {
    for (const section of SECTIONS)
      expect(
        pagesIn(section.id).length,
        `The section "${section.title}" has no pages: add one to apps/docs/content/${section.id}/, ` +
          `or take the section out of apps/docs/src/site/config.ts.`,
      ).toBeGreaterThan(0);
  });

  it('links only to things that exist', () => {
    const broken: string[] = [];
    for (const page of PAGES) {
      for (const href of links(page.body)) {
        const link = resolveLink(page.file, href);
        const [, hash] = href.split('#');
        if (link.kind === 'anchor') {
          if (!page.headings.some((heading) => heading.id === hash))
            broken.push(`${page.file}: no heading "${href}" on the page`);
        } else if (link.kind === 'page') {
          if (!link.page) broken.push(`${page.file}: no page at ${href}`);
          else if (hash && !link.page.headings.some((heading) => heading.id === hash))
            broken.push(`${page.file}: ${link.page.file} has no heading "#${hash}"`);
        } else if (link.file !== undefined && !existsSync(resolve(REPO, link.file))) {
          broken.push(
            `${page.file}: ${href} points at ${link.file}, which isn't in the repository`,
          );
        }
      }
    }
    expect(broken, `Links that lead nowhere:\n${broken.join('\n')}`).toEqual([]);
  });

  it('asks only for generated parts that exist', () => {
    const unknown: string[] = [];
    for (const page of PAGES) {
      for (const { name, args } of embeds(page.body)) {
        const said = `${page.file}: <!-- conch:${[name, ...args].join(' ')} -->`;
        if (!EMBED_NAMES.includes(name)) unknown.push(`${said} (no such part)`);
        if (name === 'channel-scene' && !CHANNEL_SCENES.includes(args.join(' ')))
          unknown.push(`${said} (no such picture)`);
        if (name === 'socket' && !(args[0] && args[0] in reference.socket))
          unknown.push(`${said} (takes commands, events or conversation)`);
        if (name === 'section' && !SECTIONS.some((section) => section.id === args[0]))
          unknown.push(`${said} (no such section)`);
      }
    }
    expect(
      unknown,
      `The parts are listed in apps/docs/src/embeds/Embed.tsx.\n${unknown.join('\n')}`,
    ).toEqual([]);
  });
});

describe('search', () => {
  it('finds every page and every command by name', () => {
    const ids = new Set(FINDABLES.map((item) => item.id));
    expect(ids.size, 'Two things in search have the same id.').toBe(FINDABLES.length);
    for (const page of PAGES) expect(ids.has(`page ${page.path}`), page.path).toBe(true);
    for (const command of reference.cli) expect(ids.has(`cli ${command.usage}`)).toBe(true);
  });

  it('leads only to pages that exist', () => {
    const paths = new Set(['/releases', ...PAGES.map((page) => page.path)]);
    const lost = FINDABLES.filter((item) => !paths.has(item.to.split('#')[0] ?? ''));
    expect(lost.map((item) => `${item.title} → ${item.to}`)).toEqual([]);
  });
});
