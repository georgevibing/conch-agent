import { CHAT_COMMANDS, COMMANDS, findCommand } from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { discordCommands } from './discord';
import { ChatActions, helpWords, nativeMenu, onlyInConch, slashIn, unknownWords } from './commands';
import { TextChoices } from './linked';

describe('One list of commands for the web app and every chat app', () => {
  it('gives no two commands the same name in chat apps either', () => {
    const names = CHAT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('keeps the chat app’s own commands out of the web app, and the web’s own out of chat apps', () => {
    expect(findCommand('stop', 'web')).toBeUndefined();
    expect(findCommand('stop', 'chat')?.name).toBe('stop');
    expect(findCommand('reset', 'chat')?.name).toBe('clear');
    expect(findCommand('export', 'chat')?.chat).toBeUndefined();
    for (const name of ['new', 'clear', 'undo', 'goal', 'plan', 'retry', 'model', 'effort'])
      expect(findCommand(name, 'chat')?.chat, name).toBeDefined();
    for (const name of ['fast', 'mode', 'status', 'help', 'settings', 'compact'])
      expect(findCommand(name, 'chat')?.chat, name).toBeDefined();
  });

  it('says what each does in words short enough for every app', () => {
    for (const c of COMMANDS) {
      expect(c.chat?.description ?? c.description, c.name).not.toMatch(/\.$/);
      expect((c.chat?.description ?? c.description).length, c.name).toBeLessThanOrEqual(256);
    }
  });
});

describe('The app’s own / menu', () => {
  it('lists Conch’s commands for Telegram, with names it accepts and the hidden ones left out', () => {
    const menu = nativeMenu();
    const names = menu.map((c) => c.command);
    expect(names).toEqual(
      expect.arrayContaining(['new', 'clear', 'goal', 'plan', 'model', 'stop']),
    );
    expect(names).not.toContain('start');
    expect(names).not.toContain('cancel');
    for (const c of menu) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('keeps a group’s menu to what works in a group', () => {
    expect(nativeMenu({ groups: true }).map((c) => c.command)).toEqual(['new', 'stop', 'help']);
  });

  it('keeps the ones people reach for when an app lists only ten (Teams)', () => {
    const names = nativeMenu({ max: 10, words: 128 }).map((c) => c.command);
    expect(names).toHaveLength(10);
    expect(names).toEqual(expect.arrayContaining(['new', 'stop', 'model', 'clear', 'help']));
  });

  it('registers Discord application commands with a value to type where one is taken', () => {
    const commands = discordCommands();
    const model = commands.find((c) => c.name === 'model');
    expect(model?.options?.[0]).toMatchObject({ type: 3, name: 'value', required: false });
    expect(commands.find((c) => c.name === 'new')?.options).toBeUndefined();
    for (const c of commands) expect(c.description.length).toBeLessThanOrEqual(100);
  });
});

describe('Words for commands in chat apps', () => {
  it('writes them after /conch on Slack, which keeps / for its own', () => {
    expect(slashIn('slack', 'model', 'opus')).toBe('/conch model opus');
    expect(slashIn('telegram', 'model')).toBe('/model');
  });

  it('shows the owner everything, someone let in what’s theirs, and a group only what works there', () => {
    const owner = helpWords({ assistant: 'Pearl', kind: 'telegram', who: 'owner' });
    expect(owner).toContain('/clear');
    expect(owner).toContain('/goal');
    expect(owner).toContain('/model');
    expect(owner).not.toContain('/cancel');
    const people = helpWords({ assistant: 'Pearl', kind: 'telegram', who: 'people' });
    expect(people).toContain('/clear');
    expect(people).not.toContain('/model');
    const guest = helpWords({ assistant: 'Pearl', kind: 'telegram', who: 'guest' });
    expect(guest).toContain('/new');
    expect(guest).not.toContain('/clear');
    expect(helpWords({ assistant: 'Pearl', kind: 'slack', who: 'owner' })).toContain('/conch plan');
  });

  it('says what a mistyped command probably meant, yours too', () => {
    // A letter swapped is the closest; one dropped comes next.
    expect(unknownWords({ typed: 'modle', kind: 'telegram', who: 'owner' })).toMatchObject({
      meant: ['model', 'mode'],
      text: expect.stringContaining('Did you mean /model or /mode?'),
    });
    expect(unknownWords({ typed: 'efort', kind: 'telegram', who: 'owner' }).meant).toEqual([
      'effort',
    ]);
    expect(unknownWords({ typed: 'claer', kind: 'telegram', who: 'people' }).meant).toEqual([
      'clear',
    ]);
    // Someone let in isn't offered the owner's settings.
    expect(unknownWords({ typed: 'modle', kind: 'telegram', who: 'people' }).meant).toEqual([]);
    expect(
      unknownWords({
        typed: 'weekly-reveiw',
        kind: 'telegram',
        who: 'owner',
        yours: ['weekly-review'],
      }).meant,
    ).toEqual(['weekly-review']);
    expect(unknownWords({ typed: 'xyzzy', kind: 'telegram', who: 'owner' }).text).toContain(
      'Send /help',
    );
  });

  it('points to Conch for a command only Conch itself has', () => {
    const exported = COMMANDS.find((c) => c.name === 'export');
    if (!exported) throw new Error('no /export');
    expect(onlyInConch('telegram', exported)).toMatch(/^\/export works in Conch itself/);
  });
});

describe('One-tap answers', () => {
  const bound = { channelId: 'ch', chatId: 'chat', userId: 'ada' };

  it('run once, only for whoever they were offered to, until they expire', async () => {
    let now = 0;
    const actions = new ChatActions(() => now);
    let ran = 0;
    const [undo] = actions.offer(bound, [{ label: 'Undo', run: async () => void ran++ }]);
    const data = undo?.data ?? '';
    expect(Buffer.byteLength(data)).toBeLessThan(64);
    expect(actions.take(data, { ...bound, userId: 'bob' })).toBe('not-yours');
    expect(actions.take(data, { ...bound, chatId: 'elsewhere' })).toBe('not-yours');
    const run = actions.take(data, bound);
    if (typeof run !== 'function') throw new Error('not runnable');
    await run();
    expect(ran).toBe(1);
    expect(actions.take(data, bound)).toBe('gone');
    const [later] = actions.offer(bound, [{ label: 'Undo', run: async () => {} }]);
    now += 10 * 60_000 + 1;
    expect(actions.take(later?.data ?? '', bound)).toBe('gone');
  });

  it('are let go with /new', () => {
    const actions = new ChatActions();
    const [button] = actions.offer(bound, [{ label: 'Undo', run: async () => {} }]);
    actions.clear('ch', 'ada');
    expect(actions.take(button?.data ?? '', bound)).toBe('gone');
  });

  it('never take a plain “yes” for an Undo nobody asked about, in apps without buttons', () => {
    const choices = new TextChoices();
    const ref = { chatId: 'self', messageId: '1' };
    choices.remember(ref, [{ label: 'Undo', data: 'c:token:0' }]);
    expect(choices.match('self', 'yes')).toBeUndefined();
    expect(choices.match('self', 'ok')).toBeUndefined();
    expect(choices.match('self', 'undo')?.data).toBe('c:token:0');
    expect(choices.match('self', '1')?.data).toBe('c:token:0');
    choices.remember(ref, [
      { label: '/model', data: 'c:token:1', style: 'primary' },
      { label: '/mode', data: 'c:token:2' },
    ]);
    expect(choices.match('self', 'yes')?.data).toBe('c:token:1');
  });
});
