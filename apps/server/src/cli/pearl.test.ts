/* eslint-disable no-control-regex -- these tests read terminal escapes */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PEARL_SIZE, banner, bead, hideCursor, pearlLines, shade, working } from './pearl';
import { captureUi, stripAnsi, width } from './ui';

afterEach(() => vi.restoreAllMocks());

describe('the pearl', () => {
  it('is round, and empty outside', () => {
    expect(shade(0, 0, 0)).toBeDefined();
    expect(shade(0.99, 0, 0)).toBeDefined();
    expect(shade(1, 1, 0)).toBeUndefined();
    const { ui } = captureUi({ color: 'none' });
    const lines = pearlLines(ui);
    expect(lines).toHaveLength(PEARL_SIZE / 2);
    for (const line of lines) expect(width(line)).toBe(PEARL_SIZE);
    // The corners are empty; the middle row is all pearl.
    expect(lines[0]?.startsWith(' ')).toBe(true);
    expect(lines[2]?.trim()).toHaveLength(PEARL_SIZE);
  });

  it('is lit from the upper left, with a glint there', () => {
    const glint = shade(-0.35, -0.45, 0) ?? [0, 0, 0];
    const rim = shade(0.6, 0.6, 0) ?? [255, 255, 255];
    const sum = (c: readonly number[]) => c.reduce((a, b) => a + b, 0);
    expect(sum(glint)).toBeGreaterThan(sum(rim));
  });

  it('shimmers: the film moves with time', () => {
    expect(shade(0.8, 0.3, 0)).not.toEqual(shade(0.8, 0.3, 2));
  });

  it('paints every pixel at the terminal’s depth', () => {
    const truecolor = pearlLines(captureUi({ color: 'truecolor' }).ui).join('');
    expect(truecolor).toMatch(/\x1b\[38;2;\d+;\d+;\d+m/);
    const indexed = pearlLines(captureUi({ color: '256' }).ui).join('');
    expect(indexed).toMatch(/\x1b\[38;5;\d+m/);
    expect(indexed).not.toMatch(/38;5;\d+\.\d/);
  });

  it('has a bead for every terminal', () => {
    expect(bead(captureUi({ color: 'none' }).ui, 1)).toBe('●');
    expect(bead(captureUi({ color: 'none', unicode: false }).ui, 1)).toBe('*');
    expect(bead(captureUi({ color: '16' }).ui, 0)).toMatch(/^\x1b\[3\dm●/);
    expect(bead(captureUi({ color: 'truecolor' }).ui, 0)).not.toBe(
      bead(captureUi({ color: 'truecolor' }).ui, 1),
    );
  });
});

describe('banner', () => {
  it('draws the pearl beside the title in a colourful, wide terminal', async () => {
    const { ui, text } = captureUi({ color: 'truecolor', columns: 80 });
    await banner(ui, { line: 'Let’s get Conch settled in.', sub: 'v1' });
    const lines = stripAnsi(text()).split('\n');
    expect(lines.some((l) => l.includes('▀') && l.includes('Conch'))).toBe(true);
    expect(text()).toContain('Let’s get Conch settled in.');
  });

  it('is one line with the shell where it can’t draw', async () => {
    const line = 'Let’s get Conch settled in.';
    for (const term of [{ color: '16' as const }, { color: 'truecolor' as const, columns: 40 }]) {
      const { ui, text } = captureUi(term);
      await banner(ui, { line });
      expect(stripAnsi(text())).toContain(`🐚  Conch  ·  ${line}`);
      expect(text()).not.toContain('▀');
    }
  });

  it('is plain words with no colour, and never moves the cursor', async () => {
    const { ui, text } = captureUi({ color: 'none' });
    await banner(ui, { line: 'Hello', shimmer: 500 });
    expect(text()).toBe('\n  Conch  ·  Hello\n\n');
  });

  it('shimmers in place, then shows the cursor again', async () => {
    const { ui, text } = captureUi({ tty: true, color: 'truecolor', animate: true });
    await banner(ui, { shimmer: 200 });
    const out = text();
    expect(out).toContain('\x1b[?25l');
    expect(out).toContain(`\x1b[${PEARL_SIZE / 2}A`);
    expect(out.endsWith('\x1b[?25h\n')).toBe(true);
  });
});

describe('working', () => {
  it('says what it did, in order, without a terminal', async () => {
    const { ui, text } = captureUi();
    const result = await working(ui, 'Getting a certificate', async () => 42, {
      done: (n) => `Got it (${n})`,
    });
    expect(result).toBe(42);
    expect(text()).toBe('  … Getting a certificate\n  ✓ Got it (42)\n');
  });

  it('says what went wrong and throws it on', async () => {
    const { ui, text } = captureUi();
    await expect(
      working(ui, 'Asking Let’s Encrypt', async () => {
        throw new Error('Port 80 is closed.');
      }),
    ).rejects.toThrow('Port 80 is closed.');
    expect(text()).toContain('✗ Port 80 is closed.');
  });

  it('animates in place, chatters on long waits, and stays on one line', async () => {
    const { ui, text } = captureUi({ tty: true, color: 'truecolor', animate: true, columns: 40 });
    await working(
      ui,
      'Waiting for conch.example.com to point here',
      async ({ update }) => {
        await new Promise((r) => setTimeout(r, 120));
        update('Still waiting for the name');
        await new Promise((r) => setTimeout(r, 200));
      },
      {
        chatterAfter: 50,
        chatterEvery: 100,
        lines: ['Polishing the pearl…'],
        done: 'It points here',
      },
    );
    const out = text();
    expect(out).toContain('\x1b[?25l');
    expect(out).toContain('Still waiting');
    expect(out.endsWith('\x1b[?25h')).toBe(true);
    const frames = out.split('\r\x1b[2K').map(stripAnsi);
    for (const frame of frames) expect(width(frame.trimEnd())).toBeLessThanOrEqual(39);
    expect(frames.at(-1)).toMatch(/✓ It points here\n/);
  });

  it('gives the cursor back once, and unhooks from the process', () => {
    const { ui, text } = captureUi({ tty: true, color: 'truecolor', animate: true });
    const before = process.listenerCount('SIGINT');
    const release = hideCursor(ui);
    expect(process.listenerCount('SIGINT')).toBe(before + 1);
    release();
    release();
    expect(process.listenerCount('SIGINT')).toBe(before);
    expect(text().match(/\x1b\[\?25h/g)).toHaveLength(1);
  });
});
