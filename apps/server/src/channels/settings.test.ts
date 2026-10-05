import { ModelCatalog, Persona, Preferences, Profile } from '@conch/protocol';
import { describe, expect, it, vi } from 'vitest';

import { ChannelSettingsMenu, type SettingsContext } from './settings';
import { TextChoices } from './linked';
import type { ChannelButton } from './types';

function setup() {
  let now = 1000;
  const menu = new ChannelSettingsMenu(() => now);
  const sent: { text: string; buttons: ChannelButton[] }[] = [];
  const catalog = ModelCatalog.parse({
    default: 'claude-code',
    providers: [
      {
        engine: 'claude-code',
        label: 'Provider A',
        commands: [],
        permissionModes: ['default', 'auto', 'plan', 'bypassPermissions'],
        models: [
          {
            id: 'deep',
            label: 'Deep',
            efforts: ['low', 'high', 'max'],
            supportsFastMode: true,
            supportsAutoMode: true,
          },
          { id: 'small', label: 'Small', efforts: [] },
          ...Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, label: `Model ${i}` })),
        ],
      },
      {
        engine: 'openrouter',
        label: 'Provider B',
        commands: [],
        permissionModes: ['default', 'plan'],
        models: [{ id: 'b', label: 'B' }],
      },
    ],
  });
  const ctx: SettingsContext = {
    channelId: 'ch_one',
    chatId: 'private',
    ownerId: 'owner',
    revision: 'r1',
    options: { engine: 'claude-code', model: 'deep' },
    busy: false,
    settings: {
      version: 1,
      onboarded: true,
      preferences: Preferences.parse({}),
      persona: Persona.parse({}),
      profile: Profile.parse({}),
      connected: [],
      endpoints: {},
      servers: [],
    },
    channel: { notifyRoutines: true },
    catalog: vi.fn(async () => catalog),
    saveOptions: vi.fn(async (patch) => {
      ctx.options = { ...ctx.options, ...patch };
    }),
    saveSettings: vi.fn(async () => {}),
    saveChannel: vi.fn(async () => {}),
    send: vi.fn(async (text, buttons) => {
      sent.push({ text, buttons: buttons ?? [] });
    }),
  };
  const last = () => {
    const value = sent.at(-1);
    if (!value) throw new Error('No menu sent');
    return value;
  };
  const choose = async (label: string) => {
    const button = last().buttons.find((b) => b.label === label);
    if (!button) throw new Error(`Missing ${label}: ${JSON.stringify(last())}`);
    await menu.press(ctx, button.data);
  };
  return {
    menu,
    ctx,
    catalog,
    sent,
    last,
    choose,
    expire: () => {
      now += 600_001;
    },
  };
}

describe('Settings in every chat app', () => {
  it('searches a large catalog without requiring the person to page through it', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'model', 'model 11');
    expect(last().buttons.map((b) => b.label)).toContain('Model 11 · Provider A');
    await choose('Model 11 · Provider A');
    await choose('Save change');
    expect(ctx.saveOptions).toHaveBeenCalledWith(expect.objectContaining({ model: 'm11' }));
    await menu.command(ctx, 'effort', 'invalid');
    expect(last().text).toContain('Choose an effort');
    await menu.command(ctx, 'mode', 'Full trust');
    expect(last().text).toContain('A web page or file could trick it');
  });

  it('shows current choices without running a model, and offers capability-matched effort', async () => {
    const { menu, ctx, last, choose } = setup();
    await menu.command(ctx, 'status');
    expect(last().text).toContain('Model: Deep');
    await menu.command(ctx, 'effort');
    expect(last().buttons.map((b) => b.label)).toEqual(['Auto', 'Low', 'High', 'More', 'Back']);
    await choose('High');
    expect(ctx.saveOptions).not.toHaveBeenCalled();
    expect(last().text).toContain('this conversation and fresh conversations in this channel');
    await choose('Save change');
    expect(ctx.saveOptions).toHaveBeenCalledWith({ effort: 'high' });
    expect(last().text).toContain('Effort: High');
  });

  it('paginates every model within each adapter’s button limit, and resets incompatible effort and speed', async () => {
    const { menu, ctx, choose, last, sent } = setup();
    ctx.options.effort = 'max';
    ctx.options.fastMode = true;
    await menu.command(ctx, 'model');
    await choose('Provider A');
    await choose('More');
    await choose('More');
    await choose('More');
    await choose('More');
    expect(last().buttons.some((b) => b.label === 'Model 11')).toBe(true);
    await choose('Model 11');
    await choose('Save change');
    expect(ctx.saveOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'm11',
        engine: 'claude-code',
        effort: 'auto',
        fastMode: false,
      }),
    );
    expect(
      sent.every(
        (s) => s.buttons.length <= 5 && s.buttons.every((b) => Buffer.byteLength(b.data) < 64),
      ),
    ).toBe(true);
    await menu.command(ctx, 'effort');
    expect(last().text).toContain('does not offer');
    expect(last().buttons).toHaveLength(1);
  });

  it('sets global defaults separately, never as a chat override', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'settings');
    await choose('Defaults across Conch');
    await choose('Provider and model');
    await choose('Provider B');
    await choose('B');
    expect(last().text).toContain(
      'Conch defaults, including existing chats without their own choice',
    );
    await choose('Save change');
    expect(ctx.saveSettings).toHaveBeenCalledWith({
      preferences: {
        engine: 'openrouter',
        model: 'b',
        effort: 'auto',
        fastMode: false,
        permissionMode: 'default',
      },
    });
    expect(ctx.saveOptions).not.toHaveBeenCalled();
  });

  it('warns before Full trust and rejects changes during a running answer', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'mode');
    await choose('More');
    await choose('Full trust');
    expect(last().text).toContain('A web page or file could trick it');
    ctx.busy = true;
    await expect(choose('Save change')).rejects.toThrow('An answer is running');
    expect(ctx.saveOptions).not.toHaveBeenCalled();
  });

  it.each(['ownerId', 'chatId', 'channelId', 'revision'] as const)(
    'binds each choice to %s',
    async (field) => {
      const { menu, ctx, choose, last } = setup();
      await menu.command(ctx, 'effort');
      await choose('High');
      const token = last().buttons[0]?.data ?? 'missing';
      await menu.press({ ...ctx, [field]: 'someone-else' }, token);
      expect(ctx.saveOptions).not.toHaveBeenCalled();
      await menu.press(ctx, token);
      expect(ctx.saveOptions).toHaveBeenCalledOnce();
      await menu.press(ctx, token);
      expect(ctx.saveOptions).toHaveBeenCalledOnce();
    },
  );

  it('expires choices and rejects replay even while a save is waiting', async () => {
    const { menu, ctx, choose, last, expire } = setup();
    await menu.command(ctx, 'effort');
    await choose('High');
    const stale = last().buttons[0]?.data ?? 'missing';
    expire();
    await menu.press(ctx, stale);
    expect(ctx.saveOptions).not.toHaveBeenCalled();
    await menu.command(ctx, 'effort');
    await choose('High');
    const token = last().buttons[0]?.data ?? 'missing';
    let release = () => {};
    vi.mocked(ctx.saveOptions).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = menu.press(ctx, token);
    await vi.waitFor(() => expect(ctx.saveOptions).toHaveBeenCalledOnce());
    await menu.press(ctx, token);
    release();
    await first;
    expect(ctx.saveOptions).toHaveBeenCalledOnce();
  });

  it('rechecks model capabilities before saving an old selection', async () => {
    const { menu, ctx, choose, catalog } = setup();
    await menu.command(ctx, 'effort');
    await choose('High');
    const model = catalog.providers[0]?.models[0];
    if (!model) throw new Error('Missing test model');
    model.efforts = [];
    await expect(choose('Save change')).rejects.toThrow('no longer offered');
    expect(ctx.saveOptions).not.toHaveBeenCalled();
  });

  it('configures channel notifications and voice separately from global preferences', async () => {
    const { menu, ctx, choose } = setup();
    await menu.command(ctx, 'settings');
    await choose('This channel');
    await choose('Routine notifications');
    await choose('Off');
    await choose('Save change');
    expect(ctx.saveChannel).toHaveBeenCalledWith({ notifyRoutines: false });
    await choose('Voice replies');
    await choose('Writing only');
    await choose('Save change');
    expect(ctx.saveChannel).toHaveBeenCalledWith({ voiceReplies: 'never' });
    expect(ctx.saveSettings).not.toHaveBeenCalled();
  });

  it('validates free-text settings and keeps cancel out of the assistant conversation', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'settings');
    await choose('More');
    await choose('Personality and about you');
    await choose('Assistant name');
    expect(await menu.input(ctx, 'x'.repeat(41))).toBe(true);
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    expect(last().text).toContain('does not fit');
    await menu.command(ctx, 'settings');
    await choose('More');
    await choose('Personality and about you');
    await choose('Assistant name');
    await menu.input(ctx, 'Pearl');
    await choose('Save change');
    expect(ctx.saveSettings).toHaveBeenCalledWith({ persona: { name: 'Pearl' } });
    await choose('Assistant name');
    menu.clear(ctx.channelId);
    expect(await menu.input(ctx, 'ordinary message')).toBe(false);
  });

  it('validates turn limits without accepting arbitrary settings keys', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'settings');
    await choose('More');
    await choose('Preferences');
    await choose('More');
    await choose('More');
    await choose('Turn limits');
    await choose('Set limits');
    await menu.input(ctx, '1 1 0');
    expect(ctx.saveSettings).not.toHaveBeenCalled();
    expect(last().text).toContain('does not fit');
  });

  it('links to protected settings without creating a sign-in token, with an offline explanation', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'settings');
    await choose('More');
    await choose('All other settings');
    expect(last().text).toContain('Open Conch on your computer');
    ctx.address = 'https://conch.example/';
    await menu.command(ctx, 'settings');
    await choose('More');
    await choose('All other settings');
    expect(last().text).toContain('https://conch.example/settings/security');
    expect(last().text).not.toMatch(/token|#here=/);
  });

  it('never treats a text setting as an answer to an earlier permission request', () => {
    const choices = new TextChoices();
    choices.remember({ chatId: 'self', messageId: 'permission' }, [
      { label: 'Allow', data: 'p:permission:a' },
    ]);
    choices.remember({ chatId: 'self', messageId: 'settings' }, [
      { label: 'Name', data: 's:token:0' },
    ]);
    expect(choices.match('self', '1')?.data).toBe('s:token:0');
    expect(choices.match('self', 'yes')).toBeUndefined();
    expect(choices.match('self', '1', 'permission')?.data).toBe('p:permission:a');
  });

  it('can return this channel to the global defaults', async () => {
    const { menu, ctx, choose } = setup();
    await menu.command(ctx, 'settings');
    await choose('This chat');
    await choose('More');
    await choose('Use Conch defaults');
    await choose('Save change');
    expect(ctx.saveOptions).toHaveBeenCalledWith({
      engine: undefined,
      model: undefined,
      effort: undefined,
      fastMode: undefined,
      permissionMode: undefined,
    });
  });

  it('lets text-only apps consume settings once, without swallowing a subsequent text setting', () => {
    const choices = new TextChoices();
    const ref = { chatId: 'self', messageId: '1' };
    choices.remember(ref, [{ label: 'Name', data: 's:token:0' }]);
    expect(choices.match('self', '1')?.data).toBe('s:token:0');
    expect(choices.match('self', '1')).toBeUndefined();
    choices.remember(ref, [{ label: 'Save', data: 's:token:0' }]);
    expect(choices.match('self', '/cancel')).toBeUndefined();
    expect(choices.match('self', '1')).toBeUndefined();
  });
});
