import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Capabilities, ConversationEventInput, EngineStatus } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import type { Engine } from '../engines/types';
import { SkillService } from './service';
import { externalRoots, SkillError, SkillStore } from './store';

async function write(path: string, text: string) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text);
}

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'conch-skills-'));
  const home = join(root, 'conch');
  const user = join(root, 'user');
  // Someone else's skills: OpenClaw (flat), Hermes (with a category folder), and a broken one.
  await write(
    join(user, '.openclaw', 'skills', 'gh-triage', 'SKILL.md'),
    '---\nname: gh-triage\ndescription: "Triage issues: label and assign. Use when asked to triage."\nmetadata: {"openclaw": {"requires": {"bins": ["gh"]}}}\n---\n\n# GitHub triage\n\nRun gh in {baseDir}.\n',
  );
  await write(
    join(user, '.hermes', 'skills', 'writing', 'release-notes', 'SKILL.md'),
    '---\nname: release-notes\ndescription: Writes release notes. Use when cutting a release.\nversion: 1.0.0\n---\n# Release notes\n\nSee references/style.md in ${HERMES_SKILL_DIR}.\n',
  );
  await write(
    join(user, '.hermes', 'skills', 'writing', 'release-notes', 'references', 'style.md'),
    'Be brief.',
  );
  await write(join(user, '.agents', 'skills', 'broken', 'SKILL.md'), 'no front matter here');
  await write(
    join(user, '.agents', 'skills', '.hidden', 'SKILL.md'),
    '---\nname: hidden\ndescription: x\n---\n',
  );
  const store = new SkillStore(
    home,
    externalRoots(user),
    () => new Map([['claude', 'Claude Code']]),
  );
  return { root, home, user, store };
}

function fakeEngine(overrides: Partial<Engine> = {}): Engine {
  return {
    id: 'openrouter',
    label: 'OpenRouter',
    integrations: { mode: 'bridge' },
    async detect(): Promise<EngineStatus> {
      return {
        engine: 'openrouter',
        label: 'OpenRouter',
        state: 'ready',
        install: [],
        canSignIn: false,
        checkedAt: 0,
      };
    },
    async capabilities(): Promise<Capabilities> {
      return {
        engine: 'openrouter',
        label: 'OpenRouter',
        models: [],
        commands: [],
        permissionModes: ['default'],
      };
    },
    async *runTurn() {},
    ...overrides,
  };
}

describe('SkillStore', () => {
  it('finds skills in other agents’ folders, read-only and Off until you turn them on', async () => {
    const { store } = await setup();
    const { skills, sources } = await store.list();
    const byId = new Map(skills.map((s) => [s.id, s]));

    expect(byId.get('openclaw_gh-triage')).toMatchObject({
      name: 'gh-triage',
      title: 'GitHub triage',
      description: 'Triage issues: label and assign. Use when asked to triage.',
      source: 'openclaw',
      sourceLabel: 'OpenClaw',
      editable: false,
      mode: 'off',
    });
    expect(byId.get('hermes_release-notes')).toMatchObject({
      name: 'release-notes',
      files: ['references/style.md'],
      mode: 'off',
    });
    expect(byId.get('agents_broken')?.problem).toMatch(/front matter/);
    expect([...byId.keys()].some((id) => id.includes('hidden'))).toBe(false);
    expect(sources.find((s) => s.id === 'openclaw')).toMatchObject({ found: true, count: 1 });
    expect(sources.find((s) => s.id === 'claude')).toMatchObject({ found: false, count: 0 });
  });

  it('creates, edits, renames and removes Conch’s own skills in the standard format', async () => {
    const { store, home } = await setup();
    const created = await store.create({
      name: 'weekly-review',
      title: 'Weekly review',
      description: 'Drafts a weekly review. Use when asked to review the week.',
      instructions: 'Look at my calendar.',
      mode: 'manual',
    });
    expect(created).toMatchObject({
      id: 'weekly-review',
      editable: true,
      mode: 'manual',
      source: 'conch',
    });
    const path = join(home, 'skills', 'weekly-review', 'SKILL.md');
    expect(await readFile(path, 'utf8')).toBe(
      '---\nname: weekly-review\ndescription: Drafts a weekly review. Use when asked to review the week.\ndisable-model-invocation: true\n---\n\n# Weekly review\n\nLook at my calendar.\n',
    );

    const updated = await store.update('weekly-review', {
      title: 'Friday review',
      instructions: 'Look at my calendar and notes.',
      mode: 'auto',
    });
    expect(updated.title).toBe('Friday review');
    expect(await readFile(path, 'utf8')).not.toContain('disable-model-invocation');
    expect((await store.detail('weekly-review')).instructions).toBe(
      'Look at my calendar and notes.',
    );

    const renamed = await store.update('weekly-review', { name: 'friday-review' });
    expect(renamed.id).toBe('friday-review');
    await expect(store.get('weekly-review')).rejects.toBeInstanceOf(SkillError);

    // Off is Conch's own choice; it isn't written into the file.
    const off = await store.update('friday-review', { mode: 'off' });
    expect(off.mode).toBe('off');
    expect(await readFile(join(home, 'skills', 'friday-review', 'SKILL.md'), 'utf8')).not.toContain(
      'disable',
    );

    await store.remove('friday-review');
    expect(
      (await store.list({ fresh: true })).skills
        .filter((s) => s.source === 'conch')
        .map((s) => s.id),
    ).toEqual([]);
  });

  it('won’t change another agent’s skill, but remembers its mode and can copy it', async () => {
    const { store, home } = await setup();
    await expect(store.update('openclaw_gh-triage', { title: 'Nope' })).rejects.toMatchObject({
      code: 'read-only',
    });
    await expect(store.remove('openclaw_gh-triage')).rejects.toMatchObject({ code: 'read-only' });
    expect((await store.update('openclaw_gh-triage', { mode: 'auto' })).mode).toBe('auto');

    const copy = await store.copy('hermes_release-notes');
    expect(copy).toMatchObject({
      id: 'release-notes',
      editable: true,
      files: ['references/style.md'],
    });
    const text = await readFile(join(home, 'skills', 'release-notes', 'SKILL.md'), 'utf8');
    // Their extras survive the copy.
    expect(text).toContain('version: 1.0.0');
    // A second copy gets a name of its own.
    expect((await store.copy('hermes_release-notes')).name).toBe('release-notes-2');
  });

  it('reads a skill’s own files and nothing outside its folder', async () => {
    const { store, user, root } = await setup();
    const skill = await store.get('hermes_release-notes');
    expect(await store.resource(skill, 'references/style.md')).toBe('Be brief.');
    await write(join(root, 'secret.txt'), 'top secret');
    for (const escape of ['../../../../secret.txt', join(root, 'secret.txt'), '']) {
      await expect(store.resource(skill, escape)).rejects.toBeInstanceOf(SkillError);
    }
    // A symlink inside the folder that points out of it is refused too.
    const link = join(
      user,
      '.hermes',
      'skills',
      'writing',
      'release-notes',
      'references',
      'link.txt',
    );
    const linked = await symlink(join(root, 'secret.txt'), link).then(
      () => true,
      () => false, // Windows without the privilege to make symlinks.
    );
    if (linked)
      await expect(store.resource(skill, 'references/link.txt')).rejects.toMatchObject({
        code: 'invalid',
      });
    // Placeholders become the folder.
    expect(await store.instructions(skill)).toContain(skill.path);
  });
});

describe('SkillService', () => {
  it('lists automatic skills in the prompt, except those a provider loads itself', async () => {
    const { store } = await setup();
    const skills = new SkillService({ store, engines: async () => [], emit: () => {} });
    await skills.create({
      instructions: 'Review my week.',
      title: 'Weekly review',
      description: 'Drafts a weekly review. Use when asked to review the week.',
      mode: 'auto',
    });
    await store.setMode('openclaw_gh-triage', 'auto');

    const section = await skills.promptSection(fakeEngine());
    expect(section).toContain('<available_skills>');
    expect(section).toContain('<name>weekly-review</name>');
    expect(section).toContain('<name>gh-triage</name>');
    expect(section).toContain('use_skill');
    // Off skills (Hermes, by default) aren't offered.
    expect(section).not.toContain('release-notes');

    // A provider that can't run Conch's tools is told where the file is instead.
    const codex = await skills.promptSection(fakeEngine({ hostTools: false }));
    expect(codex).toContain('<location>');
    expect(codex).not.toContain('use_skill');

    // One that reads a folder itself isn't told about it twice.
    await store.setMode('openclaw_gh-triage', 'off');
    expect(await skills.promptSection(fakeEngine({ skillSources: ['conch'] }))).toBe('');
  });

  it('expands /name into the skill and what was typed, and ignores everything else', async () => {
    const { store } = await setup();
    const skills = new SkillService({ store, engines: async () => [], emit: () => {} });
    await skills.create({
      instructions: 'Look at the calendar.',
      title: 'Weekly review',
      description: 'Drafts a weekly review. Use when asked.',
      mode: 'manual',
    });
    const expanded = await skills.expand('/weekly-review focus on work');
    expect(expanded?.skill).toEqual({
      permissions: expect.objectContaining({ capabilities: ['files', 'web'] }),
      skillId: 'weekly-review',
      name: 'weekly-review',
      title: 'Weekly review',
    });
    expect(expanded?.prompt).toContain('Look at the calendar.');
    expect(expanded?.prompt).toMatch(/for this:\n\nfocus on work$/);
    expect(await skills.expand('/compact')).toBeUndefined();
    expect(await skills.expand('weekly-review')).toBeUndefined();
    // Off skills can't be asked for.
    expect(await skills.expand('/gh-triage')).toBeUndefined();
  });

  it('use_skill returns the instructions once and shows the skill in the chat', async () => {
    const { store } = await setup();
    const skills = new SkillService({ store, engines: async () => [], emit: () => {} });
    await store.setMode('hermes_release-notes', 'auto');
    const appended: ConversationEventInput[] = [];
    const [tool] = skills.tools({ conversationId: 'c1', append: (e) => appended.push(e) });
    if (!tool) throw new Error('no use_skill tool');
    const run = (args: object) => tool.run(args as never);
    const text = await run({ name: 'release-notes' });
    expect(text).toContain('See references/style.md in');
    expect(text).toContain('Files in this skill (relative to its folder): references/style.md');
    expect(await run({ name: 'release-notes', file: 'references/style.md' })).toBe('Be brief.');
    await run({ name: 'release-notes' });
    expect(appended).toEqual([
      {
        type: 'skill.used',
        skillId: 'hermes_release-notes',
        name: 'release-notes',
        title: 'Release notes',
        by: 'assistant',
        // The list it came in with: what the chat is held to from here (ADR 0047).
        permissions: expect.objectContaining({ declared: false }),
      },
    ]);
    expect(await run({ name: 'nope' })).toMatch(/no skill called/);
    expect(await run({ name: 'release-notes', file: '../../secret' })).toMatch(
      /isn’t in this skill’s folder/,
    );
  });

  it('writes the title and description when you don’t', async () => {
    const { store } = await setup();
    const events: string[] = [];
    const skills = new SkillService({
      store,
      engines: async () => [
        fakeEngine({
          complete: async () => ({
            text: '{"title":"Tidy downloads","description":"Sorts the Downloads folder by type. Use when asked to clean up downloads."}',
          }),
        }),
      ],
      emit: (e) => events.push(e.type),
    });
    const draft = await skills.draft('Move files in Downloads into folders by type.');
    expect(draft).toEqual({
      title: 'Tidy downloads',
      name: 'tidy-downloads',
      description: 'Sorts the Downloads folder by type. Use when asked to clean up downloads.',
      generated: true,
    });
    const created = await skills.create({
      instructions: 'Move files in Downloads into folders by type.',
      mode: 'auto',
    });
    expect(created).toMatchObject({
      name: 'tidy-downloads',
      title: 'Tidy downloads',
      mode: 'auto',
    });
    expect(events).toEqual(['skills.changed']);
    // The next draft for the same idea gets a free name.
    expect((await skills.draft('Tidy it again')).name).toBe('tidy-downloads-2');
  });
});

describe('writing a missing description', () => {
  const service = (store: SkillStore, engines: Engine[] = []) =>
    new SkillService({ store, engines: async () => engines, emit: () => undefined });
  const model = (text: string) => fakeEngine({ complete: async () => ({ text }) });

  it('says which fix fits: a description to write, or a file to look at', async () => {
    const { home, store } = await setup();
    await write(join(home, 'skills', 'plain', 'SKILL.md'), '---\nname: plain\n---\n\nDo it.\n');
    await write(
      join(home, 'skills', 'huge', 'SKILL.md'),
      `---\nname: huge\n---\n${'x'.repeat(300_000)}`,
    );
    const { skills } = await store.list({ fresh: true });
    const kind = (id: string) => skills.find((s) => s.id === id)?.problemKind;
    expect(kind('agents_broken')).toBe('no-front-matter');
    expect(kind('plain')).toBe('no-description');
    expect(kind('huge')).toBe('unreadable');
    expect(kind('openclaw_gh-triage')).toBeUndefined();
  });

  it('drafts it from the skill’s own words and saves only the front matter', async () => {
    const { home, store } = await setup();
    const body = 'Tidy the Downloads folder.\n\n- Sort files into folders by type.\n';
    await write(join(home, 'skills', 'tidy', 'SKILL.md'), body);
    const prompts: string[] = [];
    const skills = new SkillService({
      store,
      engines: async () => [
        fakeEngine({
          complete: async (input) => {
            prompts.push(input.prompt);
            return {
              text: '{"title":"Tidy downloads","does":"Sorts the Downloads folder by type","when":"Use when asked to clean up downloads"}',
            };
          },
        }),
      ],
      emit: () => undefined,
    });
    const draft = await skills.describe('tidy');
    expect(draft).toEqual({
      description: 'Sorts the Downloads folder by type. Use when asked to clean up downloads.',
      from: 'model',
      noModel: false,
    });
    expect(prompts[0]).toContain('Sort files into folders by type.');

    const saved = await skills.update('tidy', { description: draft.description });
    expect(saved.problem).toBeUndefined();
    expect(saved.mode).toBe('auto');
    // What the person wrote is untouched: no heading added, nothing reflowed.
    expect(await readFile(join(home, 'skills', 'tidy', 'SKILL.md'), 'utf8')).toBe(
      `---\nname: tidy\ndescription: Sorts the Downloads folder by type. Use when asked to clean up downloads.\n---\n\n${body}`,
    );
  });

  it('says when no model can write it, and starts from the first sentence', async () => {
    const { home, store } = await setup();
    await write(
      join(home, 'skills', 'notes', 'SKILL.md'),
      '---\nname: notes\n---\n# Meeting notes\n\nTurn a transcript into action items. Then email them.\n',
    );
    expect(await service(store).describe('notes')).toEqual({
      description: 'Turn a transcript into action items.',
      from: 'text',
      noModel: true,
    });
    // A model that fails is not the same as no model at all.
    const broken = fakeEngine({
      complete: async () => {
        throw new Error('offline');
      },
    });
    expect(await service(store, [broken]).describe('notes')).toMatchObject({
      from: 'text',
      noModel: false,
    });
    await write(join(home, 'skills', 'empty', 'SKILL.md'), '---\nname: empty\n---\n');
    store.invalidate();
    expect(await service(store, [model('{}')]).describe('empty')).toEqual({
      description: '',
      from: 'none',
      noModel: false,
    });
  });

  it('never writes into another app’s folder, but its copy can be fixed', async () => {
    const { user, store } = await setup();
    const skills = service(store, [
      model('{"title":"Broken","does":"Explains what broke","when":"Use when something breaks"}'),
    ]);
    await expect(skills.describe('agents_broken')).rejects.toMatchObject({ code: 'read-only' });
    await expect(skills.update('agents_broken', { description: 'x' })).rejects.toBeInstanceOf(
      SkillError,
    );
    expect(await readFile(join(user, '.agents', 'skills', 'broken', 'SKILL.md'), 'utf8')).toBe(
      'no front matter here',
    );

    const copy = await skills.copy('agents_broken');
    expect(copy).toMatchObject({ editable: true, problemKind: 'no-description' });
    const draft = await skills.describe(copy.id);
    expect(draft.from).toBe('model');
    expect((await skills.update(copy.id, { description: draft.description })).problem).toBe(
      undefined,
    );
  });
});
