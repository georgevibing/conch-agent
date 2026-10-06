import type { ConversationEventInput } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { hostToolText, type HostTool, type PermissionDecision } from '../engines/types';
import type { BrowserService } from './service';
import type { Tab } from './tab';
import { BrowserStepQueue } from './step-queue';
import { browserTools } from './tools';

const snapshots = vi.hoisted(() => ({ read: vi.fn(), changes: vi.fn(), mark: vi.fn() }));
vi.mock('./snapshot', () => ({
  readPage: snapshots.read,
  readChanges: snapshots.changes,
  markSecrets: snapshots.mark,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(timeoutMs = 100) {
  vi.useFakeTimers();
  snapshots.read.mockReset().mockResolvedValue({ text: 'Page text' });
  snapshots.changes.mockReset().mockResolvedValue({ text: 'Changed page' });
  const events: ConversationEventInput[] = [];
  const stop = new AbortController();
  const target = {
    evaluate: vi.fn(async () => 'Continue'),
    scrollIntoViewIfNeeded: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
  };
  const page = {
    url: () => 'https://example.com',
    title: async () => 'Example',
    goto: vi.fn(async () => undefined),
    locator: () => target,
    on: vi.fn(),
    off: vi.fn(),
    waitForLoadState: vi.fn(async () => undefined),
  };
  const tab = {
    conversationId: 'one',
    control: 'idle',
    page,
    current: page,
    closed: false,
    touched: false,
    opened: [],
    evicted: [],
    sites: new Set(),
    whenFree: vi.fn(async () => undefined),
    setControl: vi.fn((control: string) => {
      tab.control = control;
    }),
    thumbnail: vi.fn(async () => undefined),
    boxOf: vi.fn(async () => undefined),
    announce: vi.fn(),
    entry: () => undefined,
    tabs: [{ id: 't1' }],
  };
  const service = {
    steps: new BrowserStepQueue(),
    tabFor: vi.fn(async () => tab),
    cancelStep: vi.fn(),
    saveShot: vi.fn(async () => undefined),
    guard: { navigation: vi.fn(async () => ({ ok: true })) },
    declined: vi.fn(async () => undefined),
    store: { trusts: async () => false },
    runtime: { heal: vi.fn(), backend: { shared: false } },
    forgetTab: vi.fn(),
  };
  const ctx = {
    conversationId: 'one',
    signal: stop.signal,
    permissionMode: 'default',
    append: (e: ConversationEventInput) => events.push(e),
    ask: vi.fn(async (): Promise<PermissionDecision> => 'allow'),
  } as unknown as ToolContext;
  const tools = new Map(
    browserTools(service as unknown as BrowserService, ctx, { timeoutMs }).map((t) => [t.name, t]),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) =>
    hostToolText(await (tools.get(name) as HostTool).run(args as never));
  return { stop, target, tab: tab as unknown as Tab, service, ctx, events, call };
}
afterEach(() => vi.useRealTimers());

describe('browser step deadlines through the actual tools', () => {
  it('cancels a stuck read once, reports uncertainty, and ignores its late result without replay', async () => {
    const h = setup();
    const held = deferred<{ text: string }>();
    snapshots.read.mockReturnValue(held.promise);
    const result = h.call('browser_read');
    const checked = expect(result).rejects.toThrow('Check the page before repeating');
    await vi.advanceTimersByTimeAsync(101);
    await checked;
    expect(h.service.cancelStep).toHaveBeenCalledExactlyOnceWith(h.tab);
    expect(h.service.runtime.heal).not.toHaveBeenCalled();
    expect(h.service.tabFor).toHaveBeenCalledTimes(1);
    const count = h.events.length;
    held.resolve({ text: 'Late result' });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.events).toHaveLength(count);
    expect(h.events.at(-1)).toMatchObject({ type: 'browser.step', step: { status: 'error' } });
  });

  it('keeps intentional refusals readable without turning them into execution failures', async () => {
    const h = setup();
    vi.mocked(h.ctx.ask).mockResolvedValue('deny');
    expect(await h.call('browser_click', { ref: 'e1', element: 'Continue' })).toContain(
      'doesn’t want you acting',
    );
    expect(h.target.click).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({ step: { status: 'error' } });
  });

  it('rejects an operational failure after an action rather than reporting successful execution', async () => {
    const h = setup(1_000);
    h.service.saveShot
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Could not save the screenshot.'));
    const result = h.call('browser_click', { ref: 'e1', element: 'Continue' });
    const checked = expect(result).rejects.toThrow('Could not save the screenshot.');
    await vi.advanceTimersByTimeAsync(300);
    await checked;
    expect(h.target.click).toHaveBeenCalledTimes(1);
    expect(h.service.runtime.heal).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({
      step: { status: 'error', label: 'Could not save the screenshot.' },
    });
  });

  it('never repeats an action when the browser closes while reading its result', async () => {
    const h = setup(1_000);
    snapshots.changes.mockRejectedValue(
      new Error('Target page, context or browser has been closed'),
    );
    const result = h.call('browser_click', { ref: 'e1', element: 'Continue' });
    const checked = expect(result).rejects.toThrow('Check the page before repeating the action.');
    await vi.advanceTimersByTimeAsync(300);
    await checked;
    expect(h.target.click).toHaveBeenCalledTimes(1);
    expect(h.service.tabFor).toHaveBeenCalledTimes(1);
    expect(h.service.forgetTab).not.toHaveBeenCalled();
    expect(h.service.runtime.heal).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({ step: { status: 'error' } });
  });

  it('still reopens a closed browser before action work has begun', async () => {
    const h = setup(1_000);
    h.service.tabFor.mockRejectedValueOnce(
      new Error('Target page, context or browser has been closed'),
    );
    const result = h.call('browser_click', { ref: 'e1', element: 'Continue' });
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toContain('Changed page');
    expect(h.target.click).toHaveBeenCalledTimes(1);
    expect(h.service.tabFor).toHaveBeenCalledTimes(2);
    expect(h.service.runtime.heal).toHaveBeenCalledTimes(1);
  });

  it('reports navigation failures as tool errors with the plain helpful message', async () => {
    const h = setup(1_000);
    vi.mocked(h.tab.page.goto).mockRejectedValue(new Error('net::ERR_NAME_NOT_RESOLVED'));
    await expect(h.call('browser_open', { url: 'https://example.com' })).rejects.toThrow(
      'Couldn’t find that site. Check the address.',
    );
    expect(h.events.at(-1)).toMatchObject({ step: { status: 'error' } });
    expect(h.tab.page.goto).toHaveBeenCalledTimes(1);
  });

  it('reports Stop after a click as an error and ignores the late page result', async () => {
    const h = setup(1_000);
    const held = deferred<{ text: string }>();
    snapshots.changes.mockReturnValue(held.promise);
    const result = h.call('browser_click', { ref: 'e1', element: 'Continue' });
    const checked = expect(result).rejects.toThrow('Stopped.');
    await vi.advanceTimersByTimeAsync(300);
    expect(h.target.click).toHaveBeenCalledTimes(1);
    h.stop.abort();
    await checked;
    const count = h.events.length;
    held.resolve({ text: 'Late result after the action' });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.events).toHaveLength(count);
    expect(h.events.at(-1)).toMatchObject({ step: { status: 'error', label: 'Stopped.' } });
    expect(h.target.click).toHaveBeenCalledTimes(1);
  });

  it('shows an approval wait without using its execution budget', async () => {
    const h = setup(1_000);
    const answer = deferred<PermissionDecision>();
    vi.mocked(h.ctx.ask).mockReturnValue(answer.promise);
    const result = h.call('browser_click', { ref: 'e1', element: 'Continue' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.events).toContainEqual(
      expect.objectContaining({
        step: expect.objectContaining({ status: 'waiting', label: 'Waiting for your approval' }),
      }),
    );
    expect(h.target.click).not.toHaveBeenCalled();
    expect(h.service.cancelStep).not.toHaveBeenCalled();
    answer.resolve('allow');
    await vi.advanceTimersByTimeAsync(300);
    expect(await result).toContain('Changed page');
    expect(h.target.click).toHaveBeenCalledTimes(1);
    expect(h.events.at(-1)).toMatchObject({ step: { status: 'done' } });
  });

  it('Stop during approval cannot execute a late allowance or close the user’s browser', async () => {
    const h = setup();
    const answer = deferred<PermissionDecision>();
    vi.mocked(h.ctx.ask).mockReturnValue(answer.promise);
    const result = h.call('browser_click', { ref: 'e1', element: 'Continue' });
    await vi.advanceTimersByTimeAsync(1);
    const checked = expect(result).rejects.toThrow('Stopped.');
    h.stop.abort();
    await checked;
    answer.resolve('allow');
    await vi.advanceTimersByTimeAsync(500);
    expect(h.target.click).not.toHaveBeenCalled();
    expect(h.service.cancelStep).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({ step: { status: 'error', label: 'Stopped.' } });
  });

  it('leaves manual browsing open on Stop, without taking control back', async () => {
    const h = setup();
    h.tab.control = 'user';
    const handedBack = deferred<undefined>();
    vi.mocked(h.tab.whenFree).mockReturnValue(handedBack.promise);
    const result = h.call('browser_read');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots.read).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toMatchObject({
      step: { status: 'waiting', label: 'Waiting for you to hand the browser back' },
    });
    const checked = expect(result).rejects.toThrow('Stopped.');
    h.stop.abort();
    await checked;
    handedBack.resolve(undefined);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.tab.setControl).not.toHaveBeenCalled();
    expect(h.service.cancelStep).not.toHaveBeenCalled();
  });
});
