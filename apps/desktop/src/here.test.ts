import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { asThisComputer } from './here';

const CODE = 'c'.repeat(43);

/** A home with the asks folder, and a pretend gateway answering every ask in it. */
function home(answer = true) {
  const dir = mkdtempSync(join(tmpdir(), 'conch-desktop-here-'));
  const asks = join(dir, 'here', 'asks');
  mkdirSync(asks, { recursive: true });
  const asked: string[] = [];
  const timer = setInterval(() => {
    for (const name of readdirSync(asks)) {
      const id = /^([0-9a-f]+)\.ask$/.exec(name)?.[1];
      if (!id || !answer) continue;
      asked.push(readFileSync(join(asks, name), 'utf8'));
      rmSync(join(asks, name));
      writeFileSync(join(asks, `${id}.link`), `http://localhost:4317/#here=${CODE}`);
      writeFileSync(join(asks, `${id}.open`), join(dir, 'conch-open.html'));
    }
  }, 20);
  return { dir, asks, asked, stop: () => clearInterval(timer) };
}

describe('the window opens Conch as this computer (ADR 0063)', () => {
  it('asks through the folder, and loads its own page with the one-time code', async () => {
    const at = home();
    try {
      const url = await asThisComputer('http://127.0.0.1:4317/?open=check-updates', at.dir);
      expect(url).toBe(`http://127.0.0.1:4317/?open=check-updates#here=${CODE}`);
      expect(at.asked).toEqual(['/\n']);
      // No ask is left waiting; the answers are the gateway's to clear.
      expect(readdirSync(at.asks).filter((n) => n.endsWith('.ask'))).toEqual([]);
    } finally {
      at.stop();
    }
  });

  it('keeps the page as it was when no gateway answers, or there is no folder', async () => {
    const target = 'http://127.0.0.1:4317/';
    const quiet = home(false);
    try {
      expect(await asThisComputer(target, quiet.dir, 300)).toBe(target);
      expect(readdirSync(quiet.asks)).toEqual([]);
    } finally {
      quiet.stop();
    }
    expect(await asThisComputer(target, mkdtempSync(join(tmpdir(), 'conch-none-')))).toBe(target);
  });
});
