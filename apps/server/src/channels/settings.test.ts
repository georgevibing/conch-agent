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
  it('finds a model by name: one exact match is chosen at once, several are listed', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'model', 'model 11');
    expect(ctx.saveOptions).toHaveBeenCalledWith(expect.objectContaining({ model: 'm11' }));
    expect(last().text).toBe('✓ Now using Model 11 · Provider A.');
    await menu.command(ctx, 'model', 'provider a model 1');
    expect(last().buttons.map((b) => b.label)).toContain('Model 10 · Provider A');
    await choose('Model 10 · Provider A');
    expect(ctx.saveOptions).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'm10' }));
    await menu.command(ctx, 'effort', 'invalid');
    expect(last().text).toContain('Choose an effort');
    await menu.command(ctx, 'mode', 'Full trust');
    expect(last().text).toContain('A web page or file could trick it');
  });

  it('shows current choices without running a model, ticks the one in use, and applies a pick at once', async () => {
    const { menu, ctx, last, choose } = setup();
    await menu.command(ctx, 'status');
    expect(last().text).toContain('Model: Deep');
    await menu.command(ctx, 'effort');
    // A command's own list: everything fits, nothing to go back to.
    expect(last().buttons.map((b) => b.label)).toEqual(['✓ Auto', 'Low', 'High', 'Max']);
    await choose('High');
    expect(ctx.saveOptions).toHaveBeenCalledWith({ effort: 'high' });
    expect(last().text).toBe('✓ Thinking effort: High.');
    await menu.command(ctx, 'effort');
    expect(last().buttons.map((b) => b.label)).toContain('✓ High');
  });

  it('turns fast mode on and off by name, by toggle and from its buttons', async () => {
    const { menu, ctx, last, choose } = setup();
    await menu.command(ctx, 'fast', 'on');
    expect(ctx.saveOptions).toHaveBeenLastCalledWith({ fastMode: true });
    await menu.command(ctx, 'fast', 'toggle');
    expect(ctx.saveOptions).toHaveBeenLastCalledWith({ fastMode: false });
    await menu.command(ctx, 'fast');
    expect(last().buttons.map((b) => b.label)).toEqual(['On', '✓ Off']);
    await choose('On');
    expect(last().text).toBe('✓ Fast mode: on.');
    await menu.command(ctx, 'fast', 'sideways');
    expect(last().text).toContain('/fast on');
    ctx.options.model = 'small';
    await menu.command(ctx, 'fast');
    expect(last().text).toContain('does not offer fast mode');
  });

  it('shows the model in use first, ticked, with the other providers a step away', async () => {
    const { menu, ctx, last, choose } = setup();
    ctx.buttons = 8;
    await menu.command(ctx, 'model');
    expect(last().text).toContain('**Model:** Deep · Provider A');
    expect(
      last()
        .buttons.slice(0, 2)
        .map((b) => b.label),
    ).toEqual(['✓ Deep', 'Small']);
    // Six models, then More: no Back on a list a command opened.
    expect(last().buttons).toHaveLength(7);
    await choose('More');
    await choose('More');
    await choose('Other providers');
    expect(last().buttons.map((b) => b.label)).toContain('✓ Provider A');
    await choose('Provider B');
    await choose('B');
    expect(ctx.saveOptions).toHaveBeenCalledWith(
      expect.objectContaining({ engine: 'openrouter', model: 'b', permissionMode: 'default' }),
    );
  });

  it('pages every model within each adapter’s button limit, and resets incompatible effort and speed', async () => {
    const { menu, ctx, choose, last, sent } = setup();
    ctx.options.effort = 'max';
    ctx.options.fastMode = true;
    await menu.command(ctx, 'model');
    for (let i = 0; i < 4; i++) await choose('More');
    expect(last().buttons.some((b) => b.label === 'Model 11')).toBe(true);
    await choose('Model 11');
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
    expect(last().buttons).toHaveLength(0);
  });

  it('sets global defaults separately, never as a chat override, and asks first', async () => {
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

  it('asks before letting it do more, but not before asking first or planning', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'mode');
    expect(last().buttons.map((b) => b.label)).toEqual([
      '✓ Ask first',
      'Auto',
      'Plan only',
      'Full trust',
    ]);
    await choose('Plan only');
    expect(ctx.saveOptions).toHaveBeenLastCalledWith({ permissionMode: 'plan' });
    await menu.command(ctx, 'mode');
    await choose('Auto');
    expect(last().text).toContain('Save this change?');
    expect(ctx.saveOptions).toHaveBeenCalledOnce();
    await choose('Save change');
    expect(ctx.saveOptions).toHaveBeenLastCalledWith({ permissionMode: 'auto' });
  });

  it('warns before Full trust and rejects changes during a running answer', async () => {
    const { menu, ctx, choose, last } = setup();
    await menu.command(ctx, 'mode');
    expect(last().buttons.find((b) => b.label === 'Full trust')?.style).toBe('danger');
    await choose('Full trust');
    expect(last().text).toContain('A web page or file could trick it');
    ctx.busy = true;
    await expect(choose('Save change')).rejects.toThrow('An answer is running');
    expect(ctx.saveOptions).not.toHaveBeenCalled();
    await menu.command(ctx, 'effort');
    await expect(choose('High')).rejects.toThrow('/stop');
    expect(ctx.saveOptions).not.toHaveBeenCalled();
  });

  it.each(['ownerId', 'chatId', 'channelId', 'revision'] as const)(
    'binds each choice to %s',
    async (field) => {
      const { menu, ctx, last } = setup();
      await menu.command(ctx, 'effort');
      const token = last().buttons.find((b) => b.label === 'High')?.data ?? 'missing';
      await menu.press({ ...ctx, [field]: 'someone-else' }, token);
      expect(ctx.saveOptions).not.toHaveBeenCalled();
      await menu.press(ctx, token);
      expect(ctx.saveOptions).toHaveBeenCalledOnce();
      await menu.press(ctx, token);
      expect(ctx.saveOptions).toHaveBeenCalledOnce();
    },
  );

  it('expires choices and rejects replay even while a save is waiting', async () => {
    const { menu, ctx, last, expire } = setup();
    const high = () => last().buttons.find((b) => b.label === 'High')?.data ?? 'missing';
    await menu.command(ctx, 'effort');
    const stale = high();
    expire();
    await menu.press(ctx, stale);
    expect(ctx.saveOptions).not.toHaveBeenCalled();
    expect(last().text).toContain('expired');
    await menu.command(ctx, 'effort');
    const token = high();
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
    const model = catalog.providers[0]?.models[0];
    if (!model) throw new Error('Missing test model');
    model.efforts = [];
    await expect(choose('High')).rejects.toThrow('no longer offered');
    expect(ctx.saveOptions).not.toHaveBeenCalled();
  });

  it('writes commands the way the app needs them, and shows the goal and a waiting plan', async () => {
    const { menu, ctx, last } = setup();
    ctx.slash = (name, args) => `/conch ${name}${args ? ` ${args}` : ''}`;
    await menu.command(ctx, 'effort', 'loud');
    expect(last().text).toContain('/conch effort high');
    ctx.goal = 'Ship 2.4';
    ctx.planning = true;
    await menu.command(ctx, 'status');
    expect(last().text).toContain('Goal: Ship 2.4');
    expect(last().text).toContain('Plan mode: on, from your next message');
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
