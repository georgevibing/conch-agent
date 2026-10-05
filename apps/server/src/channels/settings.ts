/** Human-owned controls, shared by every channel. Never exposed as agent tools. */
import { randomBytes } from 'node:crypto';

import {
  honouredMode,
  EffortChoice,
  PermissionMode,
  UpdateSettingsBody,
  TurnOptions,
  type ChannelSettings,
  type ModelCatalog,
} from '@conch/protocol';

import type { Settings } from '../settings/store';
import { ChannelError, type ChannelButton } from './types';

export const SETTINGS_COMMANDS = [
  { command: 'settings', description: 'Choose how Conch works here' },
  { command: 'status', description: 'Show this chat’s model and settings' },
  { command: 'model', description: 'Choose a provider and model' },
  { command: 'effort', description: 'Choose how hard the model thinks' },
  { command: 'mode', description: 'Choose what Conch may do' },
] as const;

const MODES: Record<PermissionMode, { label: string; detail: string }> = {
  default: { label: 'Ask first', detail: 'Asks before editing files or running commands.' },
  auto: { label: 'Auto', detail: 'Safe actions go ahead; risky ones still ask.' },
  acceptEdits: {
    label: 'Edit freely',
    detail: 'May change files in the work folder without asking.',
  },
  plan: { label: 'Plan only', detail: 'Reads and plans without changing anything.' },
  bypassPermissions: {
    label: 'Full trust',
    detail:
      'Can change anything on your computer without asking. A web page or file could trick it. Only use a folder you can afford to lose.',
  },
};
const EFFORT = {
  auto: 'Auto',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
};
const EVERYDAY = {
  autoMemory: 'Learn from chats',
  autoTitle: 'Name chats automatically',
  tidyMemory: 'Tidy memory nightly',
  offlineFallback: 'Use a local model offline',
  menuBar: 'Show Conch in the menu bar',
  keepAwake: 'Keep this computer awake',
} as const;

type Scope = 'chat' | 'defaults';
export interface SettingsContext {
  channelId: string;
  chatId: string;
  ownerId: string;
  /** Includes the channel conversation epoch, so /new invalidates a menu. */
  revision: string;
  options: TurnOptions;
  settings: Settings;
  channel: ChannelSettings;
  busy: boolean;
  catalog(): Promise<ModelCatalog>;
  address?: string;
  saveOptions(options: TurnOptions): Promise<void>;
  saveSettings(patch: UpdateSettingsBody): Promise<void>;
  saveChannel(patch: Partial<ChannelSettings>): Promise<void>;
  send(text: string, buttons?: ChannelButton[]): Promise<void>;
}
type Action = (ctx: SettingsContext) => Promise<void>;
interface Choice {
  label: string;
  run: Action;
}
interface Menu {
  channelId: string;
  chatId: string;
  ownerId: string;
  revision: string;
  expires: number;
  actions: Action[];
}

export class ChannelSettingsMenu {
  #menus = new Map<string, Menu>();
  #inputs = new Map<
    string,
    Menu & { accept: (ctx: SettingsContext, text: string) => Promise<void> }
  >();
  constructor(private readonly now = () => Date.now()) {}

  clear(channelId?: string) {
    for (const [key, menu] of this.#menus)
      if (!channelId || menu.channelId === channelId) this.#menus.delete(key);
    for (const [key, menu] of this.#inputs)
      if (!channelId || menu.channelId === channelId) this.#inputs.delete(key);
  }
  #key(ctx: SettingsContext) {
    return JSON.stringify([ctx.channelId, ctx.chatId, ctx.ownerId]);
  }
  #bound(ctx: SettingsContext): Menu {
    return {
      channelId: ctx.channelId,
      chatId: ctx.chatId,
      ownerId: ctx.ownerId,
      revision: ctx.revision,
      expires: this.now() + 600_000,
      actions: [],
    };
  }
  #valid(menu: Menu, ctx: SettingsContext) {
    return (
      menu.channelId === ctx.channelId &&
      menu.chatId === ctx.chatId &&
      menu.ownerId === ctx.ownerId &&
      menu.revision === ctx.revision &&
      menu.expires > this.now()
    );
  }
  #prune() {
    for (const map of [this.#menus, this.#inputs]) {
      for (const [key, menu] of map) if (menu.expires <= this.now()) map.delete(key);
      while (map.size >= 200) map.delete(map.keys().next().value ?? '');
    }
  }
  waiting(channelId: string, chatId: string, ownerId: string) {
    return this.#inputs.has(JSON.stringify([channelId, chatId, ownerId]));
  }

  async press(ctx: SettingsContext, data: string) {
    const match = /^s:([A-Za-z0-9_-]+):(\d)$/.exec(data);
    const id = match?.[1];
    const menu = id ? this.#menus.get(id) : undefined;
    const action = menu?.actions[Number(match?.[2])];
    if (!id || !menu || !action || !this.#valid(menu, ctx)) {
      await ctx.send('That settings menu has expired. Send /settings to open it again.');
      return;
    }
    this.#menus.delete(id); // Claim synchronously, before the first await: no replay.
    this.#inputs.delete(this.#key(ctx));
    await action(ctx);
  }
  async input(ctx: SettingsContext, text: string): Promise<boolean> {
    const key = this.#key(ctx);
    const pending = this.#inputs.get(key);
    if (!pending) return false;
    this.#inputs.delete(key);
    if (!this.#valid(pending, ctx)) {
      await ctx.send('That settings question expired. Send /settings to start again.');
      return true;
    }
    await pending.accept(ctx, text);
    return true;
  }
  async command(ctx: SettingsContext, command: string, argument = '') {
    this.clear(ctx.channelId);
    if (command === 'status') return ctx.send(await this.#summary(ctx, 'chat'));
    if (command === 'model')
      return argument ? this.#search(ctx, 'chat', argument) : this.#providers(ctx, 'chat');
    if (command === 'effort') {
      if (!argument) return this.#effort(ctx, 'chat');
      const effort = EffortChoice.safeParse(argument.toLowerCase());
      if (!effort.success) return ctx.send('Choose an effort from /effort, or use /effort high.');
      return this.#change(
        ctx,
        'chat',
        { effort: effort.data },
        `Thinking effort: ${EFFORT[effort.data]}.`,
      );
    }
    if (command === 'mode') {
      if (!argument) return this.#mode(ctx, 'chat');
      const named = Object.entries(MODES).find(
        ([, words]) => words.label.toLowerCase() === argument.toLowerCase(),
      )?.[0];
      const mode = PermissionMode.safeParse(named ?? argument);
      if (!mode.success) return ctx.send('Choose a mode from /mode, or use /mode plan.');
      return this.#change(
        ctx,
        'chat',
        { permissionMode: mode.data },
        `${MODES[mode.data].label}: ${MODES[mode.data].detail}`,
      );
    }
    return this.#home(ctx);
  }
  async #page(
    ctx: SettingsContext,
    text: string,
    choices: Choice[],
    page = 0,
    back: Action = (c) => this.#home(c),
  ) {
    this.#prune();
    for (const [id, menu] of this.#menus)
      if (
        menu.channelId === ctx.channelId &&
        menu.chatId === ctx.chatId &&
        menu.ownerId === ctx.ownerId
      )
        this.#menus.delete(id);
    // Discord allows five buttons in one row; text-only apps accept one-digit replies.
    const start = page * 3;
    const visible = choices.slice(start, start + 3);
    if (start + 3 < choices.length)
      visible.push({ label: 'More', run: (c) => this.#page(c, text, choices, page + 1, back) });
    visible.push({
      label: page ? 'Previous' : 'Back',
      run: page ? (c) => this.#page(c, text, choices, page - 1, back) : back,
    });
    const id = randomBytes(12).toString('base64url');
    this.#menus.set(id, { ...this.#bound(ctx), actions: visible.map((c) => c.run) });
    await ctx.send(
      text,
      visible.map((c, i) => ({ label: c.label.slice(0, 60), data: `s:${id}:${i}` })),
    );
  }
  async #confirm(ctx: SettingsContext, text: string, apply: Action, back: Action) {
    await this.#page(
      ctx,
      `${text}\n\nSave this change?`,
      [
        {
          label: 'Save change',
          run: async (c) => {
            await apply(c);
            await c.send('Saved.');
            await back(c);
          },
        },
      ],
      0,
      back,
    );
  }
  async #ask(
    ctx: SettingsContext,
    text: string,
    accept: (ctx: SettingsContext, value: string) => Promise<void>,
  ) {
    this.#prune();
    this.#inputs.set(this.#key(ctx), { ...this.#bound(ctx), accept });
    await ctx.send(
      `${text}\n\nSend /cancel to leave settings. Your next message is a setting, not a message to the assistant.`,
    );
  }
  async #home(ctx: SettingsContext) {
    await this.#page(
      ctx,
      await this.#summary(ctx, 'chat'),
      [
        { label: 'This chat', run: (c) => this.#chat(c, 'chat') },
        { label: 'Defaults across Conch', run: (c) => this.#chat(c, 'defaults') },
        { label: 'This channel', run: (c) => this.#channel(c) },
        { label: 'Preferences', run: (c) => this.#preferences(c) },
        { label: 'Personality and about you', run: (c) => this.#personal(c) },
        { label: 'All other settings', run: (c) => this.#advanced(c) },
      ],
      0,
      async (c) => {
        this.clear(c.channelId);
        await c.send('Settings closed.');
      },
    );
  }
  #options(ctx: SettingsContext, scope: Scope) {
    const p = ctx.settings.preferences;
    const o = scope === 'chat' ? ctx.options : {};
    const engine = o.engine ?? p.engine;
    return {
      engine,
      model: o.model ?? (engine === p.engine ? p.model : undefined),
      effort: o.effort ?? p.effort,
      fastMode: o.fastMode ?? p.fastMode,
      permissionMode: o.permissionMode ?? p.permissionMode,
    };
  }
  async #selected(ctx: SettingsContext, scope: Scope) {
    const options = this.#options(ctx, scope);
    const catalog = await ctx.catalog();
    if (scope === 'defaults' || !ctx.options.engine) options.engine = catalog.default;
    const provider = catalog.providers.find((p) => p.engine === options.engine);
    const model =
      provider?.models.find((m) => m.id === options.model) ??
      (!options.model ? provider?.models[0] : undefined);
    return { options, provider, model };
  }
  async #summary(ctx: SettingsContext, scope: Scope) {
    const { options: o, provider, model } = await this.#selected(ctx, scope);
    return `**${scope === 'chat' ? 'This chat' : 'Defaults across Conch'}**\nProvider: ${provider?.label ?? o.engine}\nModel: ${model?.label ?? o.model ?? 'Provider default'}\nEffort: ${model?.efforts.length ? EFFORT[o.effort] : 'Not offered by this model'}\nFast mode: ${model?.supportsFastMode ? (o.fastMode ? 'On' : 'Off') : 'Not offered by this model'}\nPermissions: ${MODES[honouredMode(o.permissionMode, provider?.permissionModes)].label}${ctx.busy ? '\nAn answer is running. Stop it or wait before changing this chat.' : ''}${!provider ? '\nThis provider is unavailable. Choose another model or open Providers in Conch.' : ''}`;
  }
  async #chat(ctx: SettingsContext, scope: Scope) {
    await this.#page(ctx, await this.#summary(ctx, scope), [
      { label: 'Provider and model', run: (c) => this.#providers(c, scope) },
      { label: 'Thinking effort', run: (c) => this.#effort(c, scope) },
      { label: 'Fast mode', run: (c) => this.#fast(c, scope) },
      { label: 'Permissions', run: (c) => this.#mode(c, scope) },
      ...(scope === 'chat'
        ? [
            {
              label: 'Use Conch defaults',
              run: (c: SettingsContext) =>
                this.#change(
                  c,
                  scope,
                  {
                    engine: undefined,
                    model: undefined,
                    effort: undefined,
                    fastMode: undefined,
                    permissionMode: undefined,
                  },
                  `Remove this channel’s overrides. Defaults use ${MODES[c.settings.preferences.permissionMode].label}: ${MODES[c.settings.preferences.permissionMode].detail}`,
                ),
            },
          ]
        : []),
    ]);
  }
  async #change(ctx: SettingsContext, scope: Scope, patch: TurnOptions, description: string) {
    const back = (c: SettingsContext) => this.#chat(c, scope);
    await this.#confirm(
      ctx,
      `${description}\nApplies to ${scope === 'chat' ? 'this conversation and fresh conversations in this channel' : 'Conch defaults, including existing chats without their own choice'}.`,
      async (c) => {
        if (scope === 'chat' && c.busy)
          throw new ChannelError(
            'refused',
            'An answer is running. Send /stop or wait, then change this chat’s settings.',
          );
        let { provider, model } = await this.#selected(c, scope);
        if (patch.engine) {
          provider = (await c.catalog()).providers.find((p) => p.engine === patch.engine);
          model = provider?.models.find((m) => m.id === patch.model);
          if (!model)
            throw new ChannelError(
              'refused',
              'That model is no longer available. Send /model to refresh the list.',
            );
        }
        if (patch.effort && patch.effort !== 'auto' && !model?.efforts.includes(patch.effort))
          throw new ChannelError(
            'refused',
            'That effort is no longer offered by this model. Send /effort to refresh.',
          );
        if (patch.fastMode && !model?.supportsFastMode)
          throw new ChannelError('refused', 'This model does not offer fast mode.');
        if (
          patch.permissionMode &&
          (!provider?.permissionModes.includes(patch.permissionMode) ||
            (patch.permissionMode === 'auto' && !model?.supportsAutoMode))
        )
          throw new ChannelError(
            'refused',
            'That permission mode is no longer offered. Send /mode to refresh.',
          );
        patch = TurnOptions.parse(patch);
        if (scope === 'chat') await c.saveOptions(patch);
        else await c.saveSettings({ preferences: patch });
      },
      back,
    );
  }
  async #search(ctx: SettingsContext, scope: Scope, query: string) {
    if (query.length > 200) {
      await ctx.send('Use a model name or a few words, up to 200 characters.');
      return;
    }
    const words = query.trim().toLowerCase().split(/\s+/);
    const providers = (await ctx.catalog()).providers;
    const choices: Choice[] = providers.flatMap((provider) =>
      provider.models
        .filter((model) =>
          words.every((word) =>
            `${provider.label} ${model.label} ${model.id}`.toLowerCase().includes(word),
          ),
        )
        .map((model) => ({
          label: `${model.label} · ${provider.label}`,
          run: (c: SettingsContext) =>
            this.#change(
              c,
              scope,
              {
                engine: provider.engine,
                model: model.id,
                effort: 'auto',
                fastMode: false,
                permissionMode: honouredMode(
                  this.#options(c, scope).permissionMode,
                  provider.permissionModes.filter(
                    (mode) => mode !== 'auto' || model.supportsAutoMode,
                  ),
                ),
              },
              `Use ${provider.label} · ${model.label} (${model.id}). Effort returns to Auto and fast mode turns off.`,
            ),
        })),
    );
    await this.#page(
      ctx,
      choices.length
        ? `Models matching “${query}”.`
        : `No connected model matches “${query}”. Try another name with /model, or connect a provider in Conch.`,
      choices,
      0,
      (c) => this.#providers(c, scope),
    );
  }

  async #providers(ctx: SettingsContext, scope: Scope) {
    const { providers } = await ctx.catalog();
    await this.#page(
      ctx,
      'Choose a connected provider, or search by name with /model followed by a few words.',
      [
        {
          label: 'Find a model',
          run: (c: SettingsContext) =>
            this.#ask(c, 'Which model are you looking for?', (v, query) =>
              this.#search(v, scope, query),
            ),
        },
        ...providers.map((p) => ({
          label: p.label,
          run: async (c: SettingsContext) => {
            const current = (await c.catalog()).providers.find((v) => v.engine === p.engine);
            await this.#page(
              c,
              current?.models.length
                ? `Choose a model from ${p.label}.`
                : 'This provider could not list its models. Open Providers in Conch to check its connection, or choose another provider.',
              (current?.models ?? []).map((m) => ({
                label: m.label,
                run: (v) =>
                  this.#change(
                    v,
                    scope,
                    {
                      engine: p.engine,
                      model: m.id,
                      effort: 'auto',
                      fastMode: false,
                      permissionMode: honouredMode(
                        this.#options(v, scope).permissionMode,
                        current?.permissionModes.filter(
                          (mode) => mode !== 'auto' || m.supportsAutoMode,
                        ),
                      ),
                    },
                    `Use ${p.label} · ${m.label}. Effort returns to Auto and fast mode turns off.`,
                  ),
              })),
              0,
              (v) => this.#providers(v, scope),
            );
          },
        })),
      ],
      0,
      (c) => this.#chat(c, scope),
    );
  }
  async #effort(ctx: SettingsContext, scope: Scope) {
    const { model } = await this.#selected(ctx, scope);
    await this.#page(
      ctx,
      model?.efforts.length
        ? 'Choose how hard the model thinks. More effort can take longer and cost more.'
        : 'This model does not offer an effort control.',
      model?.efforts.length
        ? (['auto', ...model.efforts] as const).map((effort) => ({
            label: EFFORT[effort],
            run: (c) => this.#change(c, scope, { effort }, `Thinking effort: ${EFFORT[effort]}.`),
          }))
        : [],
      0,
      (c) => this.#chat(c, scope),
    );
  }
  async #fast(ctx: SettingsContext, scope: Scope) {
    const { model } = await this.#selected(ctx, scope);
    await this.#page(
      ctx,
      model?.supportsFastMode
        ? 'Fast mode can cost more. Choose whether to use it.'
        : 'This model does not offer fast mode.',
      model?.supportsFastMode
        ? [true, false].map((fastMode) => ({
            label: fastMode ? 'On' : 'Off',
            run: (c) =>
              this.#change(c, scope, { fastMode }, `Fast mode: ${fastMode ? 'on' : 'off'}.`),
          }))
        : [],
      0,
      (c) => this.#chat(c, scope),
    );
  }
  async #mode(ctx: SettingsContext, scope: Scope) {
    const { provider, model } = await this.#selected(ctx, scope);
    await this.#page(
      ctx,
      'Choose what Conch may do. Safety checks and skill restrictions still apply.',
      (provider?.permissionModes ?? [])
        .filter((m) => m !== 'auto' || model?.supportsAutoMode)
        .map((permissionMode) => ({
          label: MODES[permissionMode].label,
          run: (c) =>
            this.#change(
              c,
              scope,
              { permissionMode },
              `${MODES[permissionMode].label}: ${MODES[permissionMode].detail}`,
            ),
        })),
      0,
      (c) => this.#chat(c, scope),
    );
  }
  async #channel(ctx: SettingsContext) {
    await this.#page(
      ctx,
      `**This channel**\nRoutine notifications: ${ctx.channel.notifyRoutines ? 'On' : 'Off'}\nVoice replies: ${ctx.channel.voiceReplies ?? 'match'}`,
      [
        {
          label: 'Routine notifications',
          run: (c) =>
            this.#page(
              c,
              'Send routine results here?',
              [true, false].map((notifyRoutines) => ({
                label: notifyRoutines ? 'On' : 'Off',
                run: (v) =>
                  this.#confirm(
                    v,
                    `Routine notifications in this channel: ${notifyRoutines ? 'on' : 'off'}.`,
                    (x) => x.saveChannel({ notifyRoutines }),
                    (x) => this.#channel(x),
                  ),
              })),
              0,
              (v) => this.#channel(v),
            ),
        },
        {
          label: 'Voice replies',
          run: (c) =>
            this.#page(
              c,
              'Replies are always written too. Voice needs speech setup and an app that can send voice notes.',
              (['match', 'always', 'never'] as const).map((voiceReplies) => ({
                label: { match: 'Match my message', always: 'Always speak', never: 'Writing only' }[
                  voiceReplies
                ],
                run: (v) =>
                  this.#confirm(
                    v,
                    `Voice replies in this channel: ${voiceReplies}.`,
                    (x) => x.saveChannel({ voiceReplies }),
                    (x) => this.#channel(x),
                  ),
              })),
              0,
              (v) => this.#channel(v),
            ),
        },
        {
          label: 'People and groups',
          run: (c) =>
            this.#links(
              c,
              'Manage who can reach Conch from Apps. These controls stay behind Conch’s sign-in.',
              [['Apps', '/apps']],
            ),
        },
      ],
    );
  }
  async #preferences(ctx: SettingsContext) {
    await this.#page(ctx, '**Preferences across Conch**', [
      ...Object.entries(EVERYDAY).map(([key, label]) => ({
        label,
        run: async (c: SettingsContext) => {
          const name = key as keyof typeof EVERYDAY;
          await this.#page(
            c,
            `${label}: ${c.settings.preferences[name] ? 'On' : 'Off'}.`,
            [true, false].map((on) => ({
              label: on ? 'On' : 'Off',
              run: (v) =>
                this.#save(
                  v,
                  { preferences: { [name]: on } },
                  `${label}: ${on ? 'on' : 'off'}.`,
                  (x) => this.#preferences(x),
                ),
            })),
            0,
            (v) => this.#preferences(v),
          );
        },
      })),
      { label: 'Turn limits', run: (c) => this.#limits(c) },
      {
        label: 'Safety checks and fallbacks',
        run: (c) =>
          this.#links(c, 'Safety checks need a fresh sign-in before they can be turned off.', [
            ['Safety', '/settings/security'],
            ['Models and fallbacks', '/settings/models'],
          ]),
      },
    ]);
  }
  async #save(ctx: SettingsContext, patch: UpdateSettingsBody, text: string, back: Action) {
    const parsed = UpdateSettingsBody.safeParse(patch);
    if (!parsed.success) {
      await ctx.send('That value does not fit this setting. Open /settings and try again.');
      return;
    }
    await this.#confirm(
      ctx,
      `${text}\nApplies throughout Conch.`,
      (c) => c.saveSettings(parsed.data),
      back,
    );
  }
  async #personal(ctx: SettingsContext) {
    await this.#page(
      ctx,
      `**Personality and about you**\nAssistant: ${ctx.settings.persona.name}\nTone: ${ctx.settings.persona.tone}\nYour name: ${ctx.settings.profile.name || 'Not set'}`,
      [
        {
          label: 'Assistant name',
          run: (c) =>
            this.#ask(c, 'What should your assistant be called? (1–40 characters)', (v, name) =>
              this.#save(v, { persona: { name } }, `Assistant name: ${name}`, (x) =>
                this.#personal(x),
              ),
            ),
        },
        {
          label: 'Tone',
          run: (c) =>
            this.#page(
              c,
              'Choose a tone.',
              (['warm', 'concise', 'playful', 'precise'] as const).map((tone) => ({
                label: tone,
                run: (v) =>
                  this.#save(v, { persona: { tone } }, `Tone: ${tone}`, (x) => this.#personal(x)),
              })),
              0,
              (v) => this.#personal(v),
            ),
        },
        {
          label: 'Instructions',
          run: (c) =>
            this.#ask(
              c,
              `Current instructions:\n${c.settings.persona.instructions || 'None'}\n\nSend replacement instructions (up to 4,000 characters), or a single - to clear.`,
              (v, value) =>
                this.#save(
                  v,
                  { persona: { instructions: value === '-' ? '' : value } },
                  `Replace assistant instructions with:\n${value}`,
                  (x) => this.#personal(x),
                ),
            ),
        },
        {
          label: 'Your name',
          run: (c) =>
            this.#ask(c, 'What should Conch call you? (up to 80 characters)', (v, name) =>
              this.#save(v, { profile: { name } }, `Your name: ${name}`, (x) => this.#personal(x)),
            ),
        },
        {
          label: 'About you',
          run: (c) =>
            this.#ask(
              c,
              `Current about you:\n${c.settings.profile.about || 'None'}\n\nSend replacement text (up to 4,000 characters), or a single - to clear.`,
              (v, value) =>
                this.#save(
                  v,
                  { profile: { about: value === '-' ? '' : value } },
                  `Replace About you with:\n${value}`,
                  (x) => this.#personal(x),
                ),
            ),
        },
      ],
    );
  }
  async #limits(ctx: SettingsContext) {
    const limits = ctx.settings.preferences.turnLimits;
    await this.#page(
      ctx,
      `**Turn limits**\n${limits.on ? 'On' : 'Off'} · ${limits.steps} steps · ${limits.tokens} fresh tokens · ${limits.minutes} minutes`,
      [
        {
          label: limits.on ? 'Turn off' : 'Turn on',
          run: (c) =>
            this.#save(
              c,
              {
                preferences: {
                  turnLimits: { ...c.settings.preferences.turnLimits, on: !limits.on },
                },
              },
              `Turn limits: ${limits.on ? 'off' : 'on'}.`,
              (v) => this.#limits(v),
            ),
        },
        {
          label: 'Set limits',
          run: (c) =>
            this.#ask(
              c,
              'Send steps, fresh tokens and minutes separated by spaces. Example: 100 2000000 30. Steps: 5–10000; tokens: 50000–1000000000; minutes: 1–1440.',
              async (v, text) => {
                if (!/^\d+\s+\d+\s+\d+$/.test(text.trim())) {
                  await v.send('Use three whole numbers, for example 100 2000000 30.');
                  return;
                }
                const [steps, tokens, minutes] = text.trim().split(/\s+/).map(Number);
                await this.#save(
                  v,
                  {
                    preferences: {
                      turnLimits: {
                        on: v.settings.preferences.turnLimits.on,
                        steps: steps ?? 0,
                        tokens: tokens ?? 0,
                        minutes: minutes ?? 0,
                      },
                    },
                  },
                  `Turn limits: ${steps} steps, ${tokens} tokens, ${minutes} minutes.`,
                  (x) => this.#limits(x),
                );
              },
            ),
        },
      ],
      0,
      (c) => this.#preferences(c),
    );
  }
  async #advanced(ctx: SettingsContext) {
    await this.#links(
      ctx,
      'Open the remaining settings in Conch. Sign in there as usual. Credentials, safety checks, file pickers and this device’s appearance stay in Conch.',
      [
        ['All settings', '/settings'],
        ['Providers', '/settings/providers'],
        ['Safety', '/settings/security'],
        ['Voice', '/settings/voice'],
        ['Usage and budgets', '/settings/usage'],
        ['Apps and channels', '/apps'],
      ],
    );
  }
  async #links(ctx: SettingsContext, text: string, links: [string, string][]) {
    let base: URL | undefined;
    try {
      if (ctx.address) {
        const url = new URL(ctx.address);
        if (url.protocol === 'https:' && !url.username && !url.password) base = url;
      }
    } catch {
      /* No usable address. */
    }
    const list = links
      .map(([label, path]) => (base ? `[${label}](${new URL(path, base).href})` : label))
      .join('\n');
    await this.#page(
      ctx,
      `${text}\n\n${list}${base ? '' : '\n\nOpen Conch on your computer. To reach it from your phone, set up Your address in Settings.'}`,
      [],
    );
  }
}
