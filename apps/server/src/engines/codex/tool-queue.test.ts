import { describe, expect, it, vi } from 'vitest';

import { ToolQueue } from './tool-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const read = 'mcp__conch__read_file';
const browser = 'mcp__conch__browser_open';

describe('Codex tool ordering', () => {
  it('orders a script like a write: reads after it wait for it (ADR 0119)', async () => {
    const queue = new ToolQueue();
    const script = deferred<undefined>();
    const first = queue.run('mcp__conch__run_script', () => script.promise);
    const looked = vi.fn(async () => undefined);
    const second = queue.run(read, looked);
    await Promise.resolve(undefined);
    expect(looked).not.toHaveBeenCalled();
    script.resolve(undefined);
    await Promise.all([first, second]);
    expect(looked).toHaveBeenCalledOnce();
  });

  it('lets independent reads pass a waiting browser, one read at a time', async () => {
    const queue = new ToolQueue();
    const page = deferred<undefined>();
    const file = deferred<undefined>();
    const first = queue.run(browser, () => page.promise);
    const second = queue.run(read, () => file.promise);
    const fetched = vi.fn(async () => undefined);
    const third = queue.run('mcp__conch__web_fetch', fetched);
    await Promise.resolve(undefined);
    expect(fetched).not.toHaveBeenCalled();
    file.resolve(undefined);
    await third;
    expect(fetched).toHaveBeenCalledOnce();
    page.resolve(undefined);
    await Promise.all([first, second]);
  });

  it('finishes earlier read results before a browser action can check permissions', async () => {
    const queue = new ToolQueue();
    const page = deferred<undefined>();
    let tainted = false;
    const first = queue.run('mcp__conch__web_fetch', async () => {
      await page.promise;
      tainted = true;
    });
    const act = vi.fn(async () => {
      expect(tainted).toBe(true);
    });
    const second = queue.run('mcp__conch__browser_click', act);
    await Promise.resolve(undefined);
    expect(act).not.toHaveBeenCalled();
    page.resolve(undefined);
    await Promise.all([first, second]);
    expect(act).toHaveBeenCalledOnce();
  });

  it.each([
    'Write',
    'Bash',
    'mcp__github__get_file_contents',
    'mcp__conch__app_example__read',
    undefined,
  ])('keeps %s as a barrier: later reads cannot overtake it', async (name) => {
    const queue = new ToolQueue();
    const page = deferred<undefined>();
    const changed = deferred<undefined>();
    const events: string[] = [];
    const first = queue.run(browser, () => page.promise);
    const second = queue.run(name, async () => {
      events.push('action');
      await changed.promise;
    });
    const third = queue.run(read, async () => {
      events.push('read');
    });
    await Promise.resolve(undefined);
    expect(events).toEqual([]);
    page.resolve(undefined);
    await first;
    await vi.waitFor(() => expect(events).toEqual(['action']));
    changed.resolve(undefined);
    await Promise.all([second, third]);
    expect(events).toEqual(['action', 'read']);
  });

  it('does not overlap two browser operations', async () => {
    const queue = new ToolQueue();
    const page = deferred<undefined>();
    const first = queue.run(browser, () => page.promise);
    const next = vi.fn(async () => undefined);
    const second = queue.run('mcp__conch__browser_read', next);
    await queue.run(read, async () => undefined);
    expect(next).not.toHaveBeenCalled();
    page.resolve(undefined);
    await Promise.all([first, second]);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns failures without poisoning subsequent calls', async () => {
    const queue = new ToolQueue();
    const first = queue.run(browser, async () => {
      throw new Error('closed');
    });
    const checked = expect(first).rejects.toThrow('closed');
    const next = vi.fn(async () => undefined);
    await queue.run(browser, next);
    await checked;
    expect(next).toHaveBeenCalledOnce();
  });
});
