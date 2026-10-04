import {
  SKILL_DESCRIPTION_MAX,
  type ConversationEventInput,
  type CreateSkillBody,
  type ServerEvent,
  type SkillDescriptionDraft,
  type SkillDetail,
  type SkillDraft,
  type SkillWritten,
  type SkillMode,
  type SkillPermissions,
  type SkillShelf,
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
import { writeSkill } from './write';
import { readPermissions } from './permissions';
import { publicSkill, SkillError, type LoadedSkill, type SkillStore } from './store';
import type { SkillTrust } from './trust';
import { SHELF_DAYS, type SkillUsage } from './usage';

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
  /** When each skill was last used, and which ones Conch put here (ADR 0058). */
  usage?: SkillUsage;
  /** A suggestion was saved as a skill: it's settled (ADR 0058). */
  suggestionSaved?: (id: string) => Promise<void>;
  /** Skills added from Discover are taken away there (ADR 0070). */
  market?: { owns(id: string): boolean; remove(id: string): Promise<void> };
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
   * A whole skill from an idea or rough notes (the steps, a title and a
   * description), for you to read and change before it's saved. With no
   * provider that can write, your words come back as they were. Never fails.
   */
  async write(idea: string, signal?: AbortSignal): Promise<SkillWritten> {
    const engines = await this.deps.engines().catch(() => []);
    const engine = engines.find((e) => e.complete);
    const { skill, usage } = await writeSkill(engine, idea, signal);
    if (usage) this.deps.onSpend?.(usage);
    return {
      ...skill,
      name: await this.deps.store.freeName(slugify(skill.title)),
      noModel: !engine,
    };
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
      ...(body.permissions && { permissions: body.permissions }),
    });
    if (body.suggestion) {
      // Conch put it on your shelf: the tidy-up may offer it back one day (ADR 0058).
      await this.deps.usage
        ?.note(skill.id, body.suggestion.startsWith('ws_') ? 'learned' : 'suggested')
        .catch(() => undefined);
      await this.deps.suggestionSaved?.(body.suggestion).catch(() => undefined);
    }
    this.#changed();
    return this.deps.store.detail(skill.id);
  }

  async update(id: string, body: UpdateSkillBody): Promise<SkillDetail> {
    const skill = await this.deps.store.update(id, body);
    if (skill.id !== id) await this.deps.usage?.renamed(id, skill.id).catch(() => undefined);
    this.#changed();
    return this.deps.store.detail(skill.id);
  }

  async remove(id: string) {
    if (this.deps.market?.owns(id)) await this.deps.market.remove(id);
    else await this.deps.store.remove(id);
    await this.deps.usage?.forget(id).catch(() => undefined);
    this.#changed();
  }

  /** A skill was used in a chat (a `skill.used` event, however it got there). */
  used(skillId: string): void {
    void this.deps.usage?.used(skillId).catch(() => undefined);
  }

  /**
   * The tidy shelf (ADR 0058): skills Conch put here that haven't been used
   * in a long while. Looking changes nothing.
   */
  async shelf(): Promise<SkillShelf> {
    const usage = this.deps.usage;
    if (!usage) return { stale: [], days: SHELF_DAYS };
    const { skills } = await this.deps.store.list();
    return { stale: await usage.stale(skills), days: SHELF_DAYS };
  }

  /**
   * Your answer to the shelf: turn them off, or keep them. Only skills that
   * are still on the shelf now are touched — a skill used since, changed or
   * gone is left as it is. Turning off is the only change Conch makes, and
   * only on your press.
   */
  async tidyShelf(action: 'off' | 'keep', ids: readonly string[]): Promise<number> {
    const usage = this.deps.usage;
    if (!usage) return 0;
    const { stale } = await this.shelf();
    const chosen = stale.filter((s) => ids.includes(s.id)).map((s) => s.id);
    if (!chosen.length) return 0;
    if (action === 'keep') await usage.keep(chosen);
    else for (const id of chosen) await this.deps.store.update(id, { mode: 'off' });
    this.#changed();
    return chosen.length;
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
  async expand(text: string): Promise<Expanded | undefined> {
    const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/i.exec(text.trim());
    if (!match?.[1]) return undefined;
    const skill = await this.deps.store.byName(match[1]);
    if (!skill) return undefined;
    return this.#expand(skill, match[2]?.trim());
  }

  async #expand(skill: LoadedSkill, request: string | undefined): Promise<Expanded> {
    const instructions = await this.deps.store.instructions(skill);
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

  // ── Offering a skill in the chat (ADR 0060) ─────────────────────────────

  /**
   * The skills the assistant may offer to turn on: Off, or set to When I ask,
   * that would work if turned on (nothing wrong with the file, nothing
   * worrying found, a signature that holds), and not ones this provider
   * loads by itself.
   */
  async offerable(engine: Engine): Promise<OfferableSkill[]> {
    const { skills } = await this.deps.store.list().catch(() => ({ skills: [] as LoadedSkill[] }));
    const native = new Set(engine.skillSources ?? []);
    return skills
      .filter(
        (s) =>
          (s.mode === 'off' || s.mode === 'manual') &&
          !s.problem &&
          s.review?.verdict !== 'danger' &&
          s.signature?.state !== 'invalid' &&
          !native.has(s.source),
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        title: s.title,
        description: s.description,
        mode: s.mode as 'off' | 'manual',
      }));
  }

  /** A skill's mode now, or `undefined` when it's gone or can't be used. */
  async modeOf(id: string): Promise<SkillMode | undefined> {
    const skill = await this.deps.store.get(id).catch(() => undefined);
    return skill && !skill.problem ? skill.mode : undefined;
  }

  /** **Turn on** / **Always** from a chat's offer: set to Automatically, as the Skills page would. */
  async turnOn(id: string): Promise<void> {
    await this.update(id, { mode: 'auto' });
  }

  /**
   * Run a request with a skill, once (**Use it** on an offer, ADR 0060): its
   * instructions and the request, as `/name request` would. `undefined` when
   * it's off, gone, or can't be read.
   */
  async once(id: string, request: string): Promise<Expanded | undefined> {
    const skill = await this.deps.store.get(id).catch(() => undefined);
    if (!skill || skill.mode === 'off' || skill.problem) return undefined;
    return this.#expand(skill, request).catch(() => undefined);
  }
}

/** A request with a skill's instructions in front: what the provider gets. */
export interface Expanded {
  prompt: string;
  skill: { skillId: string; name: string; title: string; permissions: SkillPermissions };
}

/** A skill the chat can offer (ADR 0060). */
export interface OfferableSkill {
  id: string;
  name: string;
  title: string;
  description: string;
  mode: 'off' | 'manual';
}

function xml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
