/* eslint-disable no-control-regex -- these tests read terminal escapes */
import { describe, expect, it } from 'vitest';

import {
  PALETTE,
  captureUi,
  colorCode,
  detectTerm,
  oklch,
  stripAnsi,
  to16,
  to256,
  truncate,
  width,
} from './ui';

const tty = { isTTY: true, columns: 100, write: () => true };
const pipe = { isTTY: false, columns: 100, write: () => true };

describe('detectTerm', () => {
  it('is plain text when nobody is looking, or when asked', () => {
    expect(detectTerm(pipe, {}, 'linux').color).toBe('none');
    expect(detectTerm(pipe, {}, 'linux').animate).toBe(false);
    expect(detectTerm(tty, { NO_COLOR: '1', COLORTERM: 'truecolor' }, 'linux').color).toBe('none');
    expect(detectTerm(tty, { TERM: 'dumb' }, 'linux')).toMatchObject({
      tty: false,
      color: 'none',
      animate: false,
    });
  });

  it('honours FORCE_COLOR, even through a pipe', () => {
    expect(detectTerm(pipe, { FORCE_COLOR: '1' }, 'linux').color).toBe('16');
    expect(detectTerm(pipe, { FORCE_COLOR: '2' }, 'linux').color).toBe('256');
    expect(detectTerm(pipe, { FORCE_COLOR: '3' }, 'linux').color).toBe('truecolor');
    expect(detectTerm(tty, { FORCE_COLOR: '0', COLORTERM: 'truecolor' }, 'linux').color).toBe(
      'none',
    );
    // Forced colour into a pipe still never animates.
    expect(detectTerm(pipe, { FORCE_COLOR: '3' }, 'linux').animate).toBe(false);
  });

  it('knows the terminals that draw 24-bit colour', () => {
    expect(detectTerm(tty, { COLORTERM: 'truecolor' }, 'linux').color).toBe('truecolor');
    expect(detectTerm(tty, { WT_SESSION: 'x' }, 'win32').color).toBe('truecolor');
    expect(detectTerm(tty, { TERM_PROGRAM: 'iTerm.app' }, 'darwin').color).toBe('truecolor');
    expect(detectTerm(tty, { TERM_PROGRAM: 'Apple_Terminal' }, 'darwin').color).toBe('256');
    expect(detectTerm(tty, { TERM: 'xterm-256color' }, 'linux').color).toBe('256');
    expect(detectTerm(tty, { TERM: 'xterm' }, 'linux').color).toBe('16');
    expect(detectTerm(tty, {}, 'win32', '10.0.19045').color).toBe('truecolor');
    expect(detectTerm(tty, {}, 'win32', '10.0.10240').color).toBe('16');
  });

  it("doesn't animate in CI, and draws ASCII where Unicode isn't safe", () => {
    expect(detectTerm(tty, { CI: 'true', COLORTERM: 'truecolor' }, 'linux').animate).toBe(false);
    expect(detectTerm(tty, { TERM: 'linux' }, 'linux').unicode).toBe(false);
    expect(detectTerm(tty, {}, 'win32').unicode).toBe(false);
    expect(detectTerm(tty, { WT_SESSION: '1' }, 'win32').unicode).toBe(true);
  });

  it('offers clickable links only where terminals support them', () => {
    expect(detectTerm(tty, { TERM_PROGRAM: 'vscode' }, 'linux').hyperlinks).toBe(true);
    expect(detectTerm(tty, { VTE_VERSION: '6800' }, 'linux').hyperlinks).toBe(true);
    expect(detectTerm(tty, {}, 'linux').hyperlinks).toBe(false);
    expect(detectTerm(pipe, { TERM_PROGRAM: 'vscode' }, 'linux').hyperlinks).toBe(false);
  });
});

describe('colour', () => {
  it('turns Nacre’s OKLCH into sRGB', () => {
    expect(oklch(1, 0, 0)).toEqual([255, 255, 255]);
    expect(oklch(0, 0, 0)).toEqual([0, 0, 0]);
    // The accent is warm: more red than blue.
    const [r, , b] = PALETTE.accent;
    expect(r).toBeGreaterThan(b);
  });

  it('finds the nearest colour at every depth', () => {
    expect(to256([255, 0, 0])).toBe(196);
    expect(to256([128, 128, 128])).toBeGreaterThanOrEqual(232);
    expect(Number.isInteger(to256([250, 248, 247]))).toBe(true);
    expect(to16([230, 40, 40])).toBe(31);
    expect(colorCode([1, 2, 3], 'truecolor')).toBe('\x1b[38;2;1;2;3m');
    expect(colorCode([1, 2, 3], 'truecolor', true)).toBe('\x1b[48;2;1;2;3m');
    expect(colorCode([255, 0, 0], '256')).toBe('\x1b[38;5;196m');
    expect(colorCode([230, 40, 40], '16', true)).toBe('\x1b[41m');
    expect(colorCode([1, 2, 3], 'none')).toBe('');
  });
});

describe('measuring', () => {
  it('counts columns, not escapes, and emoji as two', () => {
    expect(width('\x1b[1mhello\x1b[22m')).toBe(5);
    expect(width('✨ done')).toBe(7);
    expect(width('🐚')).toBe(2);
    expect(width('\x1b]8;;https://x\x1b\\link\x1b]8;;\x1b\\')).toBe(4);
  });

  it('cuts to fit with an ellipsis, keeping colour closed', () => {
    expect(truncate('short', 10)).toBe('short');
    const cut = truncate('\x1b[32mabcdefghij\x1b[39m', 6);
    expect(stripAnsi(cut)).toBe('abcde…');
    expect(cut.endsWith('\x1b[0m')).toBe(true);
  });
});

describe('the kit', () => {
  it('indents every line two spaces', () => {
    const { ui, text } = captureUi();
    ui.say('one\ntwo');
    ui.blank();
    expect(text()).toBe('  one\n  two\n\n');
  });

  it('prints no escapes at all without colour', () => {
    const { ui, text } = captureUi({ color: 'none' });
    ui.ok('fine');
    ui.note('hm');
    ui.error('no');
    ui.command('conch devices');
    ui.say(ui.link('https://conchagent.com'));
    ui.box('inside', { title: 'Title', tone: 'accent' });
    expect(text()).not.toMatch(/\x1b/);
    expect(text()).toContain('✓ fine');
    expect(text()).toContain('$ conch devices');
  });

  it('falls back to ASCII symbols and boxes', () => {
    const { ui, text } = captureUi({ unicode: false });
    ui.ok('fine');
    ui.box('inside');
    expect(text()).toContain('v fine');
    expect(text()).toContain('+------');
    expect(ui.qr('https://x')).toBe(false);
  });

  it('draws a box whose lines are all the same width', () => {
    const { ui, text } = captureUi({ color: 'truecolor' });
    ui.box(['https://conch.example.com/#hello=abc', 'Works once.'], {
      title: 'Make it yours',
      tone: 'accent',
    });
    const lines = text().trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(new Set(lines.map(width)).size).toBe(1);
    expect(stripAnsi(lines[0] ?? '')).toContain('Make it yours');
  });

  it('drops a box’s sides rather than wrap in a narrow terminal', () => {
    const { ui, text } = captureUi({ columns: 30 });
    ui.box('https://conch.example.com/#hello=a-very-long-code', { title: 'Link' });
    expect(text()).not.toContain('│');
    expect(text()).toContain('https://conch.example.com/#hello=a-very-long-code');
  });

  it('wraps links for terminals that can click them', () => {
    const { ui } = captureUi({ color: 'truecolor', hyperlinks: true });
    expect(ui.link('https://a.b', 'here')).toContain('\x1b]8;;https://a.b\x1b\\');
  });

  it('turns a step into ✓ in place in a terminal', () => {
    const { ui, text } = captureUi({ tty: true, color: 'truecolor' });
    const step = ui.step('Getting Node.js');
    step.update('Getting Node.js 24');
    step.done('Node.js 24.9');
    step.fail('ignored once done');
    const out = text();
    expect(out).toContain('\r\x1b[2K');
    expect(stripAnsi(out.split('\r').at(-1) ?? '')).toBe('  ✓ Node.js 24.9\n');
    expect(out).not.toContain('ignored');
  });

  it('tells a step’s story line by line in a log', () => {
    const { ui, text } = captureUi();
    const step = ui.step('Looking for Git');
    step.warn('Git is old');
    expect(text()).toBe('  … Looking for Git\n  ! Git is old\n');
  });

  it('lines up names and values', () => {
    const { ui, text } = captureUi();
    ui.kv([
      ['Address', 'https://a'],
      ['Certificate', 'good'],
    ]);
    expect(text()).toBe('  Address      https://a\n  Certificate  good\n');
  });

  it('draws a QR code only when it fits', () => {
    const wide = captureUi({ columns: 80 });
    expect(wide.ui.qr('https://conch.example.com/#pair=abc')).toBe(true);
    expect(wide.text()).toContain('█');
    const narrow = captureUi({ columns: 20 });
    expect(narrow.ui.qr('https://conch.example.com/#pair=abc')).toBe(false);
    expect(narrow.text()).toBe('');
  });

  it('keeps a rule inside the terminal', () => {
    const { ui, text } = captureUi({ columns: 24 });
    ui.rule('Devices');
    expect(width(text().trimEnd())).toBeLessThanOrEqual(24);
  });
});
