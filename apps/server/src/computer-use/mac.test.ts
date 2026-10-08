import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { ACCESS_PANES, MacDriver, macError, SCRIPT, type Runner } from './mac';

/** A pretend `osascript`, `screencapture` and `open`, answering what the script would. */
function fake(answer: (command: Record<string, unknown>) => unknown = () => ({ ok: true })) {
  const calls: { file: string; args: string[] }[] = [];
  const runner: Runner = vi.fn(async (file, args) => {
    calls.push({ file, args });
    if (file.endsWith('osascript')) {
      const command = JSON.parse(args.at(-1) ?? '{}') as Record<string, unknown>;
      if (command.op === 'shrink') await writeFile(String(command.dst), 'jpeg-bytes');
      return { stdout: JSON.stringify(answer(command)), stderr: '', code: 0 };
    }
    return { stdout: '', stderr: '', code: 0 };
  });
  return { runner, calls };
}

describe('the Mac driver', () => {
  it('runs fixed code with one JSON argument it wrote', async () => {
    const { runner, calls } = fake(() => ({ screen: true, control: false }));
    await new MacDriver(runner).access();
    expect(calls[0]?.file).toBe('/usr/bin/osascript');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['-l', 'JavaScript', '-e']);
    expect(calls[0]?.args[3]).toBe(SCRIPT);
    expect(JSON.parse(calls[0]?.args[4] ?? '')).toEqual({ op: 'access' });
  });

  it('reads the two switches, and says unknown when it can’t look', async () => {
    const { runner } = fake(() => ({ screen: true, control: false }));
    expect(await new MacDriver(runner).access()).toEqual({ screen: 'granted', control: 'missing' });
    const broken: Runner = async () => ({ stdout: '', stderr: 'boom', code: 1 });
    expect(await new MacDriver(broken).access()).toEqual({ screen: 'unknown', control: 'unknown' });
  });

  it('puts Conch on the list, then opens the switch’s own page', async () => {
    const { runner, calls } = fake();
    await new MacDriver(runner).request('screen');
    expect(JSON.parse(calls[0]?.args[4] ?? '')).toEqual({ op: 'request', kind: 'screen' });
    expect(calls[1]).toEqual({ file: '/usr/bin/open', args: [ACCESS_PANES.screen] });
    expect(ACCESS_PANES.control).toMatch(/Privacy_Accessibility$/);
  });

  it('takes the picture in a private folder and removes it once read', async () => {
    const { runner, calls } = fake();
    const jpeg = await new MacDriver(runner).capture({ width: 1280, height: 800 }, [
      { x: 0, y: 0, width: 10, height: 10 },
    ]);
    expect(jpeg.toString()).toBe('jpeg-bytes');
    const shot = calls.find((c) => c.file.endsWith('screencapture'));
    expect(shot?.args.slice(0, 5)).toEqual(['-x', '-m', '-C', '-t', 'png']);
    const folder = shot?.args[5]?.replace(/\/screen\.png$/, '');
    expect(folder).toMatch(/conch-screen-/);
    expect(existsSync(folder ?? '')).toBe(false);
    const shrink = JSON.parse(calls.find((c) => c.args[4]?.includes('shrink'))?.args[4] ?? '');
    expect(shrink).toMatchObject({ width: 1280, height: 800, cover: [{ x: 0, width: 10 }] });
  });

  it('removes the picture even when it fails', async () => {
    let folder = '';
    const runner: Runner = async (file, args) => {
      if (file.endsWith('screencapture')) folder = (args[5] ?? '').replace(/\/screen\.png$/, '');
      return { stdout: '', stderr: 'could not create image from display', code: 1 };
    };
    await expect(new MacDriver(runner).capture({ width: 10, height: 10 }, [])).rejects.toThrow(
      /Screen Recording/,
    );
    expect(existsSync(folder)).toBe(false);
  });

  it('holds the modifiers as flags on the key itself', async () => {
    const { runner, calls } = fake();
    await new MacDriver(runner).keys({
      code: 1,
      modifiers: ['cmd', 'shift'],
      label: 'shift+cmd+s',
    });
    expect(JSON.parse(calls[0]?.args[4] ?? '')).toEqual({
      op: 'keys',
      code: 1,
      flags: 0x100000 | 0x20000,
      repeat: 1,
    });
  });

  it('types in pieces, never splitting a character, and stops between them', async () => {
    const { runner, calls } = fake();
    const text = `${'a'.repeat(23)}😀${'b'.repeat(30)}`;
    await new MacDriver(runner).type(text);
    const pieces = calls.map((c) => (JSON.parse(c.args[4] ?? '') as { text: string }).text);
    expect(pieces.join('')).toBe(text);
    expect(pieces[0]).toBe(`${'a'.repeat(23)}😀`);
    const stop = new AbortController();
    stop.abort();
    await expect(new MacDriver(runner).type('hello', stop.signal)).rejects.toThrow();
  });

  it('opens an app by its bundle id, never by a name it was given', async () => {
    const { runner, calls } = fake();
    await new MacDriver(runner).open({ id: 'com.apple.Notes', name: 'Notes' });
    expect(calls[0]).toEqual({ file: '/usr/bin/open', args: ['-b', 'com.apple.Notes'] });
  });

  it('turns macOS’s errors into a next step', () => {
    expect(macError('could not create image from display')).toMatch(/Screen Recording/);
    expect(macError('something else')).toMatch(/take a screenshot/i);
  });
});
