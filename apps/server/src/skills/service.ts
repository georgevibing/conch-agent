import {
  SKILL_DESCRIPTION_MAX,
  type ConversationEventInput,
  type CreateSkillBody,
  type ServerEvent,
  type SkillDescriptionDraft,
  type SkillDetail,
  type SkillDraft,
  type SkillPermissions,
  type SkillsList,
  type TrustedPublisher,
  type UpdateSkillBody,
  type Usage,
} from '@conch/protocol';
import { z } from 'zod';

import type { Engine, HostTool } from '../engines/types';
import { draftSkill } from './draft';
import { slugify } from './draft';
import { withTitle } from './frontmatter';
import { readPermissions } from './permissions';
import { publicSkill, SkillError, type LoadedSkill, type SkillStore } from './store';
import type { SkillTrust } from './trust';

/** What the prompt may spend listing skills; the rest are still usable by name. */
const PROMPT_BUDGET = 8_000;

export interface SkillServiceDeps {
  store: SkillStore;
  /** The providers that could write a title and description, the default first. */
  engines: () => Promise<Engine[]>;
  emit: (event: ServerEvent) => void;
  /** Money spent writing titles and descriptions, for the usage ledger. */
  onSpend?: (usage: Usage) => void;
  /** Whose signatures you trust (ADR 0031). */
  trust?: SkillTrust;
}

/**
 * Skills (ADR 0013): the list, writing one from a paragraph, and how every
 * provider gets to use them — listed in the prompt, loaded with `use_skill`,
 * or asked for by name with `/name`.
 */
export class SkillService {
  constructor(private readonly deps: SkillServiceDeps) {}

  get store() {
    return this.deps.store;
  }

  async list(fresh = false): Promise<SkillsList> {
    const { skills, sources } = await this.deps.store.list({ fresh });
    return { skills: skills.map(publicSkill), sources };
  }

  /**
   * What a skill in use may do (ADR 0031). One that's gone since, or can't be
   * read, is held to the default list: never to nothing.
   */
  async permissions(id: string): Promise<{ title: string; permissions: SkillPermissions }> {
    const skill = await this.deps.store.get(id).catch(() => undefined);
    return {
      title: skill?.title ?? 'skill',
      permissions: skill?.permissions ?? readPermissions(undefined),
    };
  }

  publishers(): Promise<TrustedPublisher[]> {
    return this.deps.trust?.list() ?? Promise.resolve([]);
  }

  /**
   * Trust whoever signed this skill (ADR 0031): the key its signature holds
   * for, never a key or name sent from the browser. Only for a signature that
   * holds; the route asks for a recent password or key first.
   */
  async trustPublisher(id: string): Promise<SkillDetail> {
    const skill = await this.deps.store.get(id);
    if (!this.deps.trust || !skill.signerKey || skill.signature?.state === 'invalid')
      throw new SkillError('invalid', 'This skill isn’t signed in a way Conch can check.');
    await this.deps.trust.trust({
      key: skill.signerKey,
      name: skill.signature?.publisher ?? 'Unknown',
    });
    this.deps.store.invalidate();
    this.#changed();
    return this.deps.store.detail(id);
  }

  async forgetPublisher(fingerprint: string): Promise<boolean> {
    const forgotten = (await this.deps.trust?.forget(fingerprint)) ?? false;
    if (forgotten) {
      this.deps.store.invalidate();
      this.#changed();
    }
    return forgotten;
  }

  detail(id: string): Promise<SkillDetail> {
    return this.deps.store.detail(id);
  }

  /** A title, name and description for these instructions. Never fails. */
  async draft(instructions: string, signal?: AbortSignal): Promise<SkillDraft> {
    const engines = await this.deps.engines().catch(() => []);
    const engine = engines.find((e) => e.complete);
    const { draft, usage } = await draftSkill(engine, instructions, signal);
    if (usage) this.deps.onSpend?.(usage);
    return { ...draft, name: await this.deps.store.freeName(slugify(draft.title)) };
  }

  /**
   * The missing description of one of your skills, written from its own
   * title and instructions by the cheapest model that can — or, with none
   * connected, their first sentence — for you to look over and save.
   * Never for a skill another app owns: Conch doesn't write there.
   */
  async describe(id: string, signal?: AbortSignal): Promise<SkillDescriptionDraft> {
    const skill = await this.deps.store.get(id);
    if (!skill.editable)
      throw new SkillError(
        'read-only',
        `${skill.sourceLabel} owns this skill, so Conch won’t change it there. Make a copy to edit it.`,
      );
    const engines = await this.deps.engines().catch(() => []);
    const engine = engines.find((e) => e.complete);
    const { instructions } = await this.deps.store.detail(id);
    if (!instructions.trim()) return { description: '', from: 'none', noModel: !engine };
    const { draft, usage } = await draftSkill(engine, withTitle(skill.title, instructions), signal);
    if (usage) this.deps.onSpend?.(usage);
    return {
      description: draft.description.slice(0, SKILL_DESCRIPTION_MAX),
      from: draft.generated ? 'model' : 'text',
      noModel: !engine,
    };
  }

  async create(body: CreateSkillBody): Promise<SkillDetail> {
    const needsDraft = !body.title || !body.description;
    const draft = needsDraft ? await this.draft(body.instructions) : undefined;
    const title = body.title ?? draft?.title ?? 'New skill';
    const name = await this.deps.store.freeName(body.name ?? slugify(title));
    const skill = await this.deps.store.create({
      name,
      title,
      description: body.description ?? draft?.description ?? title,
      instructions: body.instructions,
      mode: body.mode,
    });
    this.#changed();
    return this.deps.store.detail(skill.id);
  }

  async update(id: string, body: UpdateSkillBody): Promise<SkillDetail> {
    const skill = await this.deps.store.update(id, body);
    this.#changed();
    return this.deps.store.detail(skill.id);
  }

  async remove(id: string) {
    await this.deps.store.remove(id);
    this.#changed();
  }

  async copy(id: string): Promise<SkillDetail> {
    const skill = await this.deps.store.copy(id);
    this.#changed();
    return this.deps.store.detail(skill.id);
  }

  #changed() {
    this.deps.emit({ type: 'skills.changed' });
  }

  // ── Using skills in a conversation ──────────────────────────────────────

  /** Skills this provider should be told about: on "Automatically", working, and not ones it loads itself. */
  async #offered(engine: Engine): Promise<LoadedSkill[]> {
    const { skills } = await this.deps.store.list();
    const native = new Set(engine.skillSources ?? []);
    return skills.filter((s) => s.mode === 'auto' && !s.problem && !native.has(s.source));
  }

  /** The system-prompt section listing skills, in the `<available_skills>` shape other agents use. */
  async promptSection(engine: Engine): Promise<string> {
    const skills = await this.#offered(engine);
    if (!skills.length) return '';
    const tools = engine.hostTools !== false;
    const entries: string[] = [];
    let used = 0;
    for (const skill of skills) {
      const entry = [
        '<skill>',
        `<name>${xml(skill.name)}</name>`,
        `<description>${xml(skill.description)}</description>`,
        ...(tools ? [] : [`<location>${xml(skill.file)}</location>`]),
        '</skill>',
      ].join('');
      if (used + entry.length > PROMPT_BUDGET) break;
      entries.push(entry);
      used += entry.length;
    }
    return [
      '## Skills',
      'The user saved these skills: instructions for particular kinds of task.',
      tools
        ? 'When a request clearly matches one, call use_skill with its name before you start, then follow what it returns. It lists any files the skill has; read one by passing its path as `file`.'
        : 'When a request clearly matches one, read its SKILL.md at the location given before you start, then follow it. Paths in it are relative to that folder.',
      'Only use a skill when it fits the request, and don’t mention skills otherwise.',
      '<available_skills>',
      ...entries,
      '</available_skills>',
      ...(entries.length < skills.length
        ? [
            `${skills.length - entries.length} more skills didn’t fit here; the user can ask for them by name.`,
          ]
        : []),
    ].join('\n');
  }

  /** `use_skill`, bound to one conversation so the chat can show which skill was used. */
  tools(ctx: {
    conversationId: string;
    append: (event: ConversationEventInput) => void;
  }): HostTool[] {
    const shown = new Set<string>();
    const useSkill: HostTool<{ name: z.ZodString; file: z.ZodOptional<z.ZodString> }> = {
      name: 'use_skill',
      description:
        'Load one of the user’s saved skills — instructions for a kind of task — by name, before you start on a request it matches. Returns the instructions to follow and the files the skill has. Pass `file` (a path it lists) to read one of those files.',
      input: {
        name: z.string().min(1).max(100),
        file: z.string().min(1).max(300).optional(),
      },
      run: async ({ name, file }) => {
        const skill = await this.deps.store.byName(name);
        if (!skill) return `There's no skill called “${name}” that you can use.`;
        try {
          if (file) return await this.deps.store.resource(skill, file);
          const instructions = await this.deps.store.instructions(skill);
          if (!shown.has(skill.id)) {
            shown.add(skill.id);
            // Its list as it is now: what the chat is held to from here (ADR 0047).
            ctx.append({
              type: 'skill.used',
              skillId: skill.id,
              name: skill.name,
              title: skill.title,
              by: 'assistant',
              permissions: skill.permissions ?? readPermissions(undefined),
            });
          }
          return [
            `<skill name="${xml(skill.name)}" folder="${xml(skill.path)}">`,
            instructions,
            '</skill>',
            ...(skill.files.length
              ? [`Files in this skill (relative to its folder): ${skill.files.join(', ')}`]
              : []),
          ].join('\n');
        } catch (error) {
          return error instanceof SkillError ? error.message : 'That skill couldn’t be read.';
        }
      },
    };
    return [useSkill as HostTool];
  }

  /**
   * `/weekly-review plan for Tuesday` → the skill's instructions and what was
   * typed after the name. Anything that isn't a usable skill's name is left
   * alone (Conch's own commands never reach the gateway; the provider's do).
   */
  async expand(text: string): Promise<
    | {
        prompt: string;
        skill: { skillId: string; name: string; title: string; permissions: SkillPermissions };
      }
    | undefined
  > {
    const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!match?.[1]) return undefined;
    const skill = await this.deps.store.byName(match[1]);
    if (!skill) return undefined;
    const instructions = await this.deps.store.instructions(skill);
    const request = match[2]?.trim();
    return {
      prompt: [
        `<skill name="${xml(skill.name)}" title="${xml(skill.title)}" folder="${xml(skill.path)}">`,
        instructions,
        ...(skill.files.length
          ? [`Files in this skill (relative to its folder): ${skill.files.join(', ')}`]
          : []),
        '</skill>',
        '',
        request
          ? `The user asked you to use the “${skill.title}” skill above for this:\n\n${request}`
          : `The user asked you to use the “${skill.title}” skill above. Follow it now.`,
      ].join('\n'),
      skill: {
        skillId: skill.id,
        name: skill.name,
        title: skill.title,
        permissions: skill.permissions ?? readPermissions(undefined),
      },
    };
  }
}

function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
