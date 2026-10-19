import type { ConversationEventInput, Task } from '@conch/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../conversations/manager';
import { hostToolText, type HostTool, type PermissionDecision } from '../engines/types';
import { TaskOperations } from '../tasks/operations';
import type { BrowserService } from './service';
import { BrowserStepQueue } from './step-queue';
import { browserTools } from './tools';

const snapshots = vi.hoisted(() => ({ read: vi.fn(), changes: vi.fn(), mark: vi.fn() }));
vi.mock('./snapshot', () => ({
  readPage: snapshots.read,
  readChanges: snapshots.changes,
  markSecrets: snapshots.mark,
}));

/** A background task's browser: the real tools, behind the task's real ledger (ADR 0033). */
function setup() {
  vi.useFakeTimers();
  snapshots.read.mockReset().mockResolvedValue({ text: 'Page text' });
  snapshots.changes.mockReset().mockResolvedValue({ text: 'Changed page' });
  const target = {
    count: vi.fn(async () => 1),
    evaluate: vi.fn(async () => 'Next'),
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
    evaluate: vi.fn(async () => ''),
    keyboard: { press: vi.fn(async () => undefined) },
    mouse: { move: vi.fn(async () => undefined), wheel: vi.fn(async () => undefined) },
  };
  const tab = {
    conversationId: 'task_chat',
    control: 'idle',
    page,
    current: page,
    closed: false,
    touched: false,
    opened: [],
    evicted: [],
    dialogNotes: [],
    dialogsOpened: 0,
    dialogsSettled: vi.fn(async () => undefined),
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
    viewport: { width: 1280, height: 800 },
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
    conversationId: 'task_chat',
    signal: new AbortController().signal,
    permissionMode: 'auto',
    unattended: true,
    append: (_e: ConversationEventInput) => undefined,
    ask: vi.fn(async (): Promise<PermissionDecision> => 'allow'),
  } as unknown as ToolContext;
  let task: Task = {
    id: 'task_1',
    title: 'Book a table',
    prompt: 'Find a table for two',
    kind: 'background',
    status: 'running',
    options: {},
    steps: [],
    rev: 0,
    createdAt: 1,
    operations: [],
  };
  const ledger = new TaskOperations(
    async () => task,
    async (change) => (task = { ...task, ...change(task) }),
    () => false,
  );
  const tools = new Map(
    browserTools(service as unknown as BrowserService, ctx, { timeoutMs: 1_000 }).map((t) => [
      t.name,
      ledger.wrap(t),
    ]),
  );
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const run = (tools.get(name) as HostTool).run(args as never);
    const settled = run.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await settled;
    if ('error' in outcome) throw outcome.error;
    return hostToolText(outcome.result);
  };
  return { target, page, service, call, operations: () => task.operations ?? [] };
}
afterEach(() => vi.useRealTimers());

describe('a task’s browser errands and its ledger', () => {
  it('a click on a gone element did nothing, so the next click goes ahead', async () => {
    const h = setup();
    h.target.count.mockResolvedValueOnce(0);
    expect(await h.call('browser_click', { ref: 'e9', element: 'Old button' })).toContain(
      'isn’t on the page any more',
    );
    expect(h.operations().at(-1)).toMatchObject({ tool: 'browser_click', state: 'not-run' });
    expect(await h.call('browser_click', { ref: 'e3', element: 'Next' })).toContain('Changed page');
    expect(h.target.click).toHaveBeenCalledTimes(1);
  });

  it('retrying the very click that failed before acting runs it', async () => {
    const h = setup();
    h.target.count.mockResolvedValueOnce(0);
    await h.call('browser_click', { ref: 'e3', element: 'Next' });
    expect(await h.call('browser_click', { ref: 'e3', element: 'Next' })).toContain('Changed page');
    expect(h.target.click).toHaveBeenCalledTimes(1);
  });

  it('scrolls twice, presses Enter twice and clicks the same ref on a newer page', async () => {
    const h = setup();
    await h.call('browser_scroll', { direction: 'down' });
    expect(await h.call('browser_scroll', { direction: 'down' })).toContain('Changed page');
    expect(h.page.mouse.wheel).toHaveBeenCalledTimes(2);
    await h.call('browser_press', { key: 'Enter' });
    expect(await h.call('browser_press', { key: 'Enter' })).toContain('Changed page');
    expect(h.page.keyboard.press).toHaveBeenCalledTimes(2);
    await h.call('browser_click', { ref: 'e3', element: 'Next' });
    expect(await h.call('browser_click', { ref: 'e3', element: 'Next' })).toContain('Changed page');
    expect(h.target.click).toHaveBeenCalledTimes(2);
    expect(h.operations().filter((op) => op.effect === 'read')).toHaveLength(2);
  });

  it('a click that may have happened still blocks the task’s next action', async () => {
    const h = setup();
    // The click went through, then the browser lost the page while reading the result.
    snapshots.changes.mockRejectedValueOnce(
      new Error('Target page, context or browser has been closed'),
    );
    await expect(h.call('browser_click', { ref: 'e3', element: 'Pay' })).rejects.toThrow(
      'Check the page before repeating',
    );
    expect(h.operations().at(-1)).toMatchObject({ state: 'unresolved', execution: 'failed' });
    await expect(h.call('browser_click', { ref: 'e3', element: 'Pay' })).rejects.toThrow(
      'may already have happened',
    );
    await expect(h.call('browser_open', { url: 'https://example.com' })).rejects.toThrow(
      'may already have happened',
    );
    expect(h.target.click).toHaveBeenCalledTimes(1);
    // Looking is still fine.
    expect(await h.call('browser_read')).toContain('Page text');
  });
});
