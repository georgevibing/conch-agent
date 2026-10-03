/**
 * The maker's guide stays true (AGENTS.md agreements 13 and 15): it names
 * every maker tool, everything `app` gives a tool, and every class of the
 * page kit, and its example app passes the real quality bar and runs sealed
 * off as it says.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APP_COLORS, APP_GLYPHS } from '@conch/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { textFiles } from '../test/conchapps';
import { checkApp } from './check';
import {
  APP_API,
  guideExample,
  MAKER_TOOLS,
  makerGuide,
  PAGE_KIT_CLASSES,
  pageKitClasses,
} from './guide';
import { readFiles } from './package';
import { createRuntime, HOST_SCRIPT } from './runtime';
import { ConchAppService } from './service';
import { fakeParts } from '../test/conchapps';
import { makerTools } from './tools';
import type { AppPackage, AppRuntime } from './types';

const homes: string[] = [];
const runtimes: AppRuntime[] = [];
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.stop();
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

describe('the maker’s guide', () => {
  const guide = makerGuide();

  it('describes every class the page kit has, and no class it hasn’t', () => {
    expect(
      Object.keys(PAGE_KIT_CLASSES).sort(),
      'The page kit’s classes changed: describe each in PAGE_KIT_CLASSES (conchapps/guide.ts).',
    ).toEqual(pageKitClasses());
    for (const name of pageKitClasses()) expect(guide).toContain(`.${name}`);
  });

  it('names every maker tool there is', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-guide-'));
    homes.push(home);
    const service = new ConchAppService({
      home,
      parts: fakeParts(),
      emit: () => undefined,
      chats: { events: async () => [], note: async () => undefined, exists: async () => true },
      manualChecks: true,
    });
    const tools = makerTools(service, {
      conversationId: 'c_guide',
      append: () => undefined,
      signal: new AbortController().signal,
      ask: async () => 'deny',
    }).map((t) => t.name);
    expect(
      [...tools].sort(),
      'A maker tool was added or removed: list it in MAKER_TOOLS and say in the guide when to use it.',
    ).toEqual([...MAKER_TOOLS].sort());
    // app_guide is the guide itself.
    for (const name of MAKER_TOOLS.filter((t) => t !== 'app_guide')) expect(guide).toContain(name);
  });

  it('says what `app` gives a tool, as the runtime’s own contract does', async () => {
    const host = await readFile(HOST_SCRIPT, 'utf8');
    const contract = host.slice(0, host.indexOf('*/'));
    for (const name of APP_API) {
      const member = name.split('.').at(-1) ?? name;
      expect(contract, `host.mjs's contract no longer mentions ${name}`).toMatch(
        new RegExp(`\\b${member}\\b`),
      );
      expect(guide, `The guide doesn't say how to use ${name}`).toContain(member);
    }
    // The runtime gives the time as an ISO string; so does the guide.
    expect(contract).toMatch(/app\.now\(\)`: the time now, as an ISO string/);
    expect(guide).toMatch(/app\.now\(\)`: the time now, as an ISO string/);
  });

  it('lists every glyph and colour an icon may use, read from the protocol', () => {
    for (const glyph of APP_GLYPHS) expect(guide).toContain(glyph);
    for (const color of APP_COLORS) expect(guide).toContain(color);
  });

  it('shows an example that passes the quality bar, with no warnings, and runs as it says', async () => {
    const home = await mkdtemp(join(tmpdir(), 'conch-guide-app-'));
    homes.push(home);
    const read = readFiles(textFiles(guideExample()));
    if (!read.ok) throw new Error(read.problems.map((p) => p.message).join('\n'));
    const runtimeFor = (app: AppPackage, appDir: string) => {
      const runtime = createRuntime({
        appDir,
        dataDir: join(home, 'data'),
        manifest: app.manifest,
        settings: async () => ({}),
        fetcher: async () => ({ ok: false, status: 0, headers: {}, body: '', refused: 'No.' }),
      });
      runtimes.push(runtime);
      return runtime;
    };
    // The check runs the tools from a folder on disk.
    const appDir = join(home, 'app');
    const { mkdir, writeFile } = await import('node:fs/promises');
    for (const [path, content] of Object.entries(guideExample())) {
      await mkdir(join(appDir, path, '..'), { recursive: true });
      await writeFile(join(appDir, path), content);
    }
    const check = await checkApp(read.app.files, {
      runtime: (app) => runtimeFor(app, appDir),
      tried: ['log_watering', 'due'],
    });
    expect(check.problems).toEqual([]);
    expect(check.warnings).toEqual([]);
    expect(check.ok).toBe(true);

    const runtime = runtimeFor(read.app, appDir);
    expect((await runtime.call('due', {})).json).toMatchObject({ due: [], total: 0 });
    expect((await runtime.call('log_watering', { plant: 'Fern', every: 3 })).text).toBe(
      'Logged: Fern watered. Next in 3 days.',
    );
    expect((await runtime.call('due', {})).json).toMatchObject({ due: [], total: 1 });
    // What the model sends is held to the schema before the tool sees it.
    expect((await runtime.call('log_watering', {})).ok).toBe(false);
  }, 60_000);
});
