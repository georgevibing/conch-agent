import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { createPrompts, pickOption, type Keyboard, type KeyboardInput } from './prompts';
import { captureUi, stripAnsi } from './ui';

/** A keyboard a test types into. `tty` makes it a terminal (raw mode, keypresses). */
function keyboard(tty = false) {
  const input = new PassThrough() as PassThrough & KeyboardInput;
  if (tty) {
    input.isTTY = true;
    input.setRawMode = vi.fn();
  }
  const board: Keyboard = { input, close: vi.fn() };
  return { board, input };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const OPTIONS = [
  { value: 'own', label: 'From anywhere, at an address of my own', hint: 'conch.you.com' },
  { value: 'tailscale', label: 'Only from my own devices' },
  { value: 'local', label: 'Just from this computer' },
] as const;

describe('with nobody at the keyboard', () => {
  it('asks nothing, and takes the defaults', async () => {
    const { ui, text } = captureUi();
    const prompts = createPrompts({ ui, keyboard: null });
    expect(prompts.interactive).toBe(false);
    expect(await prompts.ask('Address:', { default: 'conch.example.com' })).toBe(
      'conch.example.com',
    );
    expect(await prompts.ask('Address:')).toBeUndefined();
    expect(await prompts.confirm('Open ports?', false)).toBe(false);
    expect(await prompts.choose('How?', OPTIONS, 1)).toBe('tailscale');
    expect(text()).toBe('');
  });
});

describe('ask', () => {
  it('reads a line, trimmed, and takes the default for an empty one', async () => {
    const { ui } = captureUi();
    const { board, input } = keyboard();
    const prompts = createPrompts({ ui, keyboard: board });
    const answer = prompts.ask('Address:');
    input.write('  conch.example.com  \n');
    expect(await answer).toBe('conch.example.com');
    const empty = prompts.ask('Address:', { default: 'x.example' });
    await tick();
    input.write('\n');
    expect(await empty).toBe('x.example');
  });

  it('asks again until the answer is right, saying what’s wrong', async () => {
    const { ui, text } = captureUi();
    const { board, input } = keyboard();
    const prompts = createPrompts({ ui, keyboard: board });
    const answer = prompts.ask('Address:', {
      validate: (a) => (a.includes('.') ? undefined : 'That needs a dot, like conch.example.com.'),
    });
    input.write('localhost\n');
    await tick();
    input.write('conch.example.com\n');
    expect(await answer).toBe('conch.example.com');
    expect(text()).toContain('! That needs a dot, like conch.example.com.');
  });

  it('shows nothing typed for a hidden answer', async () => {
    const { ui, text } = captureUi({ tty: true });
    const { board, input } = keyboard(true);
    const prompts = createPrompts({ ui, keyboard: board });
    const answer = prompts.ask('Password:', { hidden: true });
    await tick();
    input.write('correct horse battery\r');
    expect(await answer).toBe('correct horse battery');
    expect(text()).toContain('Password:');
    expect(text()).not.toContain('correct horse');
  });

  it('takes Ctrl+D as no answer', async () => {
    const { ui } = captureUi();
    const { board, input } = keyboard();
    const prompts = createPrompts({ ui, keyboard: board });
    const answer = prompts.ask('Address:');
    input.end();
    expect(await answer).toBeUndefined();
  });

  it('stops nicely on Ctrl+C', async () => {
    const { ui } = captureUi({ tty: true });
    const { board, input } = keyboard(true);
    const onCancel = vi.fn();
    const prompts = createPrompts({ ui, keyboard: board, onCancel });
    const answer = prompts.ask('Address:');
    await tick();
    input.write('\x03');
    expect(await answer).toBeUndefined();
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('confirm', () => {
  it('reads yes and no, and Enter takes the default', async () => {
    const { ui, text } = captureUi();
    const { board, input } = keyboard();
    const prompts = createPrompts({ ui, keyboard: board });
    const yes = prompts.confirm('Open ports 80 and 443?');
    input.write('\n');
    expect(await yes).toBe(true);
    expect(text()).toContain('[Y/n]');
    const no = prompts.confirm('Open them?');
    await tick();
    input.write('No\n');
    expect(await no).toBe(false);
    const nudged = prompts.confirm('Sure?', false);
    await tick();
    input.write('maybe\n');
    await tick();
    input.write('y\n');
    expect(await nudged).toBe(true);
    expect(text()).toContain('[y/N]');
    expect(text()).toContain('Type y or n.');
  });
});

describe('choose', () => {
  it('lists numbers and reads one, or the start of a label, without a terminal', async () => {
    const { ui, text } = captureUi();
    const { board, input } = keyboard();
    const prompts = createPrompts({ ui, keyboard: board });
    const picked = prompts.choose('How will you reach Conch?', OPTIONS);
    input.write('2\n');
    expect(await picked).toBe('tailscale');
    expect(stripAnsi(text())).toContain('1  From anywhere, at an address of my own  conch.you.com');
    const byName = prompts.choose('How?', OPTIONS);
    await tick();
    input.write('just\n');
    expect(await byName).toBe('local');
    const byDefault = prompts.choose('How?', OPTIONS, 2);
    await tick();
    input.write('\n');
    expect(await byDefault).toBe('local');
  });

  it('moves with the arrows and takes Enter in a terminal', async () => {
    const { ui, text } = captureUi({ tty: true, color: 'truecolor' });
    const { board, input } = keyboard(true);
    const prompts = createPrompts({ ui, keyboard: board });
    const picked = prompts.choose('How will you reach Conch?', OPTIONS);
    input.emit('keypress', undefined, { name: 'down' });
    input.emit('keypress', undefined, { name: 'down' });
    input.emit('keypress', undefined, { name: 'down' });
    input.emit('keypress', undefined, { name: 'up' });
    input.emit('keypress', '\r', { name: 'return' });
    expect(await picked).toBe('local');
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
    // It folds into one line with what was chosen, and the cursor is back.
    const out = stripAnsi(text());
    expect(out.trimEnd().split('\n').at(-1)).toContain(
      'How will you reach Conch?  Just from this computer',
    );
    expect(text()).toContain('\x1b[?25h');
  });

  it('takes a number straight away', async () => {
    const { ui } = captureUi({ tty: true });
    const { board, input } = keyboard(true);
    const prompts = createPrompts({ ui, keyboard: board });
    const picked = prompts.choose('How?', OPTIONS);
    input.emit('keypress', '2', { name: '2' });
    expect(await picked).toBe('tailscale');
  });

  it('wraps around, and ignores numbers past the end', async () => {
    const { ui } = captureUi({ tty: true });
    const { board, input } = keyboard(true);
    const prompts = createPrompts({ ui, keyboard: board });
    const picked = prompts.choose('How?', OPTIONS);
    input.emit('keypress', '9', { name: '9' });
    input.emit('keypress', undefined, { name: 'up' });
    input.emit('keypress', '\r', { name: 'return' });
    expect(await picked).toBe('local');
  });

  it('stops on Ctrl+C with the terminal put back', async () => {
    const { ui } = captureUi({ tty: true });
    const { board, input } = keyboard(true);
    const onCancel = vi.fn();
    const prompts = createPrompts({ ui, keyboard: board, onCancel });
    const picked = prompts.choose('How?', OPTIONS);
    input.emit('keypress', '\x03', { name: 'c', ctrl: true });
    expect(await picked).toBeUndefined();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});

describe('pickOption', () => {
  it('reads numbers and label starts, and nothing else', () => {
    expect(pickOption(OPTIONS, '1')).toBe(0);
    expect(pickOption(OPTIONS, ' 3 ')).toBe(2);
    expect(pickOption(OPTIONS, '4')).toBeUndefined();
    expect(pickOption(OPTIONS, '0')).toBeUndefined();
    expect(pickOption(OPTIONS, 'ONLY')).toBe(1);
    expect(pickOption(OPTIONS, 'zzz')).toBeUndefined();
    expect(pickOption(OPTIONS, '')).toBeUndefined();
  });
});
