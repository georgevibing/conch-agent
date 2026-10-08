import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppToGateway, GatewayToApp, PermissionMode, TaintSource } from '@conch/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AskRequest, ToolContext } from '../conversations/manager';
import { taintFrom } from '../conversations/taint';
import { hostToolText, type HostToolResult, type PermissionDecision } from '../engines/types';
import { needs } from '../skills/permissions';
import { EDGE_TITLE } from './driver';
import { PretendComputer } from './pretend';
import { ComputerUseService } from './service';
import { computerTools, SCREEN_LABEL } from './tools';

const NOTES = { id: 'com.apple.Notes', name: 'Notes' };
const ONE_PASSWORD = { id: 'com.1password.1password', name: '1Password' };
const TERMINAL = { id: 'com.apple.Terminal', name: 'Terminal' };

let home: string;
let computer: PretendComputer;
let service: ComputerUseService;
let sent: GatewayToApp[];
let fromApp: ((message: AppToGateway) => void) | undefined;
let interrupt: ReturnType<typeof vi.fn<(conversationId: string) => Promise<void>>>;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'conch-computer-'));
  computer = new PretendComputer();
  computer.show(NOTES);
  sent = [];
  interrupt = vi.fn(async (_conversationId: string) => undefined);
  service = new ComputerUseService({
    home,
    driver: computer,
    interrupt,
    app: {
      send: async (message) => {
        sent.push(message);
        return true;
      },
      listen: (handler) => {
        fromApp = handler;
        return () => undefined;
      },
    },
  });
  await service.setEnabled(true);
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function context(
  options: {
    mode?: PermissionMode;
    answer?: PermissionDecision;
    taints?: TaintSource[];
    unattended?: boolean;
    conversationId?: string;
    fullTrust?: boolean;
  } = {},
) {
  const stop = new AbortController();
  const asked: AskRequest[] = [];
  const taints = options.taints ?? [];
  const ctx = {
    conversationId: options.conversationId ?? 'chat-1',
    signal: stop.signal,
    permissionMode: options.mode ?? 'default',
    append: () => undefined,
    fullTrust: () => options.fullTrust ?? false,
    unattended: options.unattended ?? false,
    ask: vi.fn(async (request: AskRequest) => {
      asked.push(request);
      return options.answer ?? 'allow';
    }),
    untrusted: () =>
      taints.length ? 'This chat read things, which could be trying to steer me.' : undefined,
    taints: () => taints,
  } as unknown as ToolContext;
  const [tool] = computerTools(service, ctx, { settleMs: 0, openSettleMs: 0 });
  if (!tool) throw new Error('no tool');
  const call = async (args: Record<string, unknown>) =>
    (await tool.run(args as never)) as string | HostToolResult;
  return { call, asked, stop, ctx };
}

const text = (result: string | HostToolResult) => hostToolText(result);
const isError = (result: string | HostToolResult) => typeof result !== 'string' && result.isError;

describe('the computer tool', () => {
  it('is offered only when it’s on, and never where nobody is watching', async () => {
    const ctx = { conversationId: 'c', unattended: true } as unknown as ToolContext;
    expect(computerTools(service, ctx)).toEqual([]);
    await service.setEnabled(false);
    expect(computerTools(service, { conversationId: 'c' } as unknown as ToolContext)).toEqual([]);
  });

  it('looks at the screen as a picture about a megapixel big, even in Plan only', async () => {
    const { call } = context({ mode: 'plan' });
    const result = await call({ action: 'screenshot' });
    expect(isError(result)).toBeFalsy();
    expect(typeof result !== 'string' && result.images?.[0]?.mimeType).toBe('image/jpeg');
    expect(text(result)).toContain('Screenshot 1280×800 pixels');
    expect(text(result)).toContain('In front: Notes.');
    expect(computer.acted).toEqual([]);
  });

  it('covers the apps it’s kept from in the picture, and says so', async () => {
    computer.show(ONE_PASSWORD, { x: 0, y: 0, width: 720, height: 450 });
    computer.show(NOTES, { x: 720, y: 0, width: 720, height: 900 });
    const { call } = context();
    const result = await call({ action: 'screenshot' });
    const capture = computer.log.find((e) => e.kind === 'capture');
    expect(capture).toMatchObject({ cover: [{ x: 0, y: 0, width: 640, height: 400 }] });
    expect(text(result)).toContain('Covered over (kept from you): 1Password.');
  });

  it('marks the chat as having read the screen', () => {
    expect(taintFrom('computer', { action: 'screenshot' })).toEqual({
      kind: 'app',
      label: SCREEN_LABEL,
    });
    expect(taintFrom('mcp__conch__computer', { action: 'left_click' })?.label).toBe(SCREEN_LABEL);
  });

  it('is using apps for a skill’s list, and looking isn’t limited', () => {
    expect(needs('computer', { action: 'left_click' }, { workspace: '/w' })).toEqual({
      capability: 'apps',
      detail: 'computer',
    });
    expect(needs('computer', { action: 'screenshot' }, { workspace: '/w' })).toBeUndefined();
  });

  it('clicks where the picture says, on the screen', async () => {
    const { call } = context();
    await call({ action: 'screenshot' });
    const result = await call({ action: 'left_click', coordinate: [640, 400] });
    expect(isError(result)).toBeFalsy();
    expect(computer.acted).toEqual([{ kind: 'click', x: 720, y: 450, button: 'left', count: 1 }]);
    expect(text(result)).toContain('Clicked in Notes.');
  });

  it('reads a point however the model wrote it', async () => {
    const { call } = context();
    await call({ action: 'screenshot' });
    await call({ action: 'double_click', coordinate: '100, 200' });
    await call({ action: 'right_click', coordinate: { x: 10, y: 20 } });
    expect(computer.acted).toMatchObject([
      { kind: 'click', count: 2, button: 'left' },
      { kind: 'click', count: 1, button: 'right' },
    ]);
  });

  it('wants a look before a click, and a point on the picture', async () => {
    const { call } = context();
    expect(text(await call({ action: 'left_click', coordinate: [1, 1] }))).toMatch(
      /Take a screenshot first/,
    );
    await call({ action: 'screenshot' });
    expect(text(await call({ action: 'left_click', coordinate: [5000, 1] }))).toMatch(
      /outside the screenshot/,
    );
    // The screen changed size since: the old picture's coordinates would miss.
    computer.size = { width: 1920, height: 1080 };
    expect(text(await call({ action: 'left_click', coordinate: [1, 1] }))).toMatch(
      /Take a screenshot first/,
    );
    expect(computer.acted).toEqual([]);
  });

  it('asks the first time it touches an app in a chat, then not again', async () => {
    const { call, asked } = context();
    await call({ action: 'screenshot' });
    await call({ action: 'left_click', coordinate: [10, 100] });
    await call({ action: 'type', text: 'Shopping list' });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      summary: 'use Notes on your computer',
      explicit: true,
      detail: expect.stringContaining('⌘⎋'),
    });
    expect(computer.acted).toMatchObject([
      { kind: 'click' },
      { kind: 'type', text: 'Shopping list' },
    ]);
  });

  it('asks in Auto too: your apps are yours', async () => {
    const { call, asked } = context({ mode: 'auto' });
    await call({ action: 'screenshot' });
    await call({ action: 'left_click', coordinate: [10, 100] });
    expect(asked).toHaveLength(1);
  });

  it('does nothing when the person says no, and says not to look for another way', async () => {
    const { call } = context({ answer: 'deny' });
    await call({ action: 'screenshot' });
    const result = await call({ action: 'left_click', coordinate: [10, 100] });
    expect(isError(result)).toBe(true);
    expect(text(result)).toMatch(/doesn’t want you using Notes/);
    expect(computer.acted).toEqual([]);
  });

  it('remembers “Always” for later chats, unless the chat read something elsewhere', async () => {
    const first = context({ answer: 'allow-always' });
    await first.call({ action: 'screenshot' });
    await first.call({ action: 'left_click', coordinate: [10, 100] });
    expect(await service.store.trusts(NOTES.id)).toBe(true);

    const later = context({ conversationId: 'chat-2' });
    service.end('chat-1');
    await later.call({ action: 'screenshot' });
    await later.call({ action: 'left_click', coordinate: [10, 100] });
    expect(later.asked).toHaveLength(0);

    // Its own look at the screen doesn't count; a web page does.
    service.end('chat-2');
    const read = context({
      conversationId: 'chat-3',
      taints: [
        { kind: 'app', label: SCREEN_LABEL },
        { kind: 'web', label: 'example.com' },
      ],
    });
    await read.call({ action: 'screenshot' });
    await read.call({ action: 'left_click', coordinate: [10, 100] });
    expect(read.asked).toHaveLength(1);
    expect(read.asked[0]?.taint).toMatch(/before I use Notes/);
  });

  it('goes ahead in Full trust, in a chat you’re in', async () => {
    const { call, asked } = context({ mode: 'bypassPermissions', fullTrust: true });
    await call({ action: 'screenshot' });
    await call({ action: 'left_click', coordinate: [10, 100] });
    expect(asked).toHaveLength(0);
    expect(computer.acted).toHaveLength(1);
  });

  it('never touches a password manager, System Settings or a terminal, in any mode', async () => {
    computer.show(ONE_PASSWORD, { x: 0, y: 0, width: 400, height: 400 });
    const { call, asked } = context({ mode: 'bypassPermissions', fullTrust: true });
    await call({ action: 'screenshot' });
    const click = await call({ action: 'left_click', coordinate: [100, 100] });
    expect(text(click)).toMatch(/1Password is one of the apps Conch keeps you away from/);
    computer.show(TERMINAL);
    const typed = await call({ action: 'type', text: 'rm -rf ~' });
    expect(text(typed)).toMatch(/Terminal is one of the apps/);
    const opened = await call({ action: 'open_app', app: 'System Settings' });
    expect(isError(opened)).toBe(true);
    computer.installed = [{ id: 'com.apple.systempreferences', name: 'System Settings' }];
    expect(text(await call({ action: 'open_app', app: 'System Settings' }))).toMatch(
      /keeps you away/,
    );
    expect(asked).toHaveLength(0);
    expect(computer.acted).toEqual([]);
  });

  it('never clicks Conch itself, in its app or a browser tab', async () => {
    const chrome = { id: 'com.google.Chrome', name: 'Google Chrome' };
    computer.show(chrome, undefined, 'Book a table · Conch');
    const { call } = context({ mode: 'bypassPermissions', fullTrust: true });
    await call({ action: 'screenshot' });
    expect(text(await call({ action: 'left_click', coordinate: [100, 100] }))).toMatch(
      /keeps you away/,
    );
    expect(text(await call({ action: 'key', text: 'Return' }))).toMatch(/keeps you away/);
    expect(computer.acted).toEqual([]);
  });

  it('looks through its own glowing edge to the app underneath', async () => {
    computer.shown.unshift({
      app: { id: 'com.conchagent.app', name: 'Conch' },
      title: EDGE_TITLE,
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      layer: 1000,
    });
    const { call } = context();
    await call({ action: 'screenshot' });
    const result = await call({ action: 'left_click', coordinate: [10, 100] });
    expect(text(result)).toContain('Clicked in Notes.');
    // The edge is never painted over as if it were Conch's window.
    expect(computer.log.find((e) => e.kind === 'capture')).toMatchObject({ cover: [] });
  });

  it('says so when an app it’s kept from comes to the front', async () => {
    const { call } = context();
    await call({ action: 'screenshot' });
    computer.pointer = vi.fn(async () => {
      computer.show(TERMINAL);
    });
    const result = await call({ action: 'left_click', coordinate: [10, 100] });
    expect(text(result)).toMatch(/Terminal is in front now\. It’s kept from you/);
  });

  it('never presses the Stop keys, or keys that end the session', async () => {
    const { call } = context();
    expect(text(await call({ action: 'key', text: 'cmd+Escape' }))).toMatch(/Stop keys/);
    expect(text(await call({ action: 'key', text: 'ctrl+cmd+q' }))).toMatch(/locks the screen/);
    expect(text(await call({ action: 'key', text: 'cmd+space' }))).toMatch(/open_app/);
    await call({ action: 'key', text: 'cmd+s' });
    expect(computer.acted).toMatchObject([{ kind: 'keys', combo: { label: 'cmd+s' } }]);
  });

  it('only looks in Plan only', async () => {
    const { call } = context({ mode: 'plan' });
    await call({ action: 'screenshot' });
    expect(text(await call({ action: 'left_click', coordinate: [1, 1] }))).toMatch(/Plan only/);
    expect(text(await call({ action: 'type', text: 'hi' }))).toMatch(/Plan only/);
    expect(computer.acted).toEqual([]);
  });

  it('says which macOS switch is missing, in words', async () => {
    computer.access_ = { screen: 'missing', control: 'missing' };
    const { call } = context();
    expect(text(await call({ action: 'screenshot' }))).toMatch(/Screen Recording/);
    computer.access_ = { screen: 'granted', control: 'missing' };
    expect(isError(await call({ action: 'screenshot' }))).toBeFalsy();
    expect(text(await call({ action: 'left_click', coordinate: [1, 1] }))).toMatch(/Accessibility/);
  });

  it('opens an app by name, asking first', async () => {
    computer.installed = [{ id: 'com.apple.iWork.Keynote', name: 'Keynote' }];
    const { call, asked } = context();
    const result = await call({ action: 'open_app', app: 'keynote' });
    expect(asked[0]?.summary).toBe('use Keynote on your computer');
    expect(computer.acted).toMatchObject([{ kind: 'open', app: { name: 'Keynote' } }]);
    expect(text(result)).toContain('Opened Keynote.');
    expect(text(await call({ action: 'open_app', app: 'Nope' }))).toMatch(/no app called/);
  });

  it('scrolls at a point in the direction asked', async () => {
    const { call } = context();
    await call({ action: 'screenshot' });
    await call({
      action: 'scroll',
      coordinate: [640, 400],
      scroll_direction: 'down',
      scroll_amount: 5,
    });
    expect(computer.acted).toEqual([{ kind: 'scroll', x: 720, y: 450, dx: 0, dy: -5 }]);
  });

  it('stops to check in after enough steps', async () => {
    const { call } = context();
    for (let i = 0; i < 60; i++) await call({ action: 'screenshot' });
    expect(text(await call({ action: 'screenshot' }))).toMatch(/That’s 60 steps/);
  });

  it('lets one chat at a time use the computer', async () => {
    await context().call({ action: 'screenshot' });
    const other = context({ conversationId: 'chat-2' });
    expect(text(await other.call({ action: 'screenshot' }))).toMatch(/Another chat is using/);
  });
});

describe('the glowing edge and Stop', () => {
  it('lights the edge with what it’s doing, and puts it out when the turn ends', async () => {
    const { call, stop } = context();
    await call({ action: 'screenshot' });
    expect(sent.at(-1)).toEqual({ type: 'computer', on: true, label: 'Looking at the screen' });
    expect((await service.status(true)).active).toMatchObject({
      conversationId: 'chat-1',
      steps: 1,
    });
    stop.abort();
    expect(sent.at(-1)).toEqual({ type: 'computer', on: false });
    const status = await service.status(true);
    expect(status.active).toBeUndefined();
  });

  it('keeps the latest look in memory for the live card, and forgets it after', async () => {
    const { call, stop } = context();
    await call({ action: 'screenshot' });
    const shot = (await service.status(true)).active?.shot;
    expect(shot && service.shot(shot)?.toString()).toBe('pretend-jpeg');
    stop.abort();
    expect(shot && service.shot(shot)).toBeUndefined();
  });

  it('stops the chat’s turn when Stop is pressed on the edge', async () => {
    const { call } = context();
    await call({ action: 'screenshot' });
    fromApp?.({ type: 'computer.stop' });
    await vi.waitFor(() => expect(interrupt).toHaveBeenCalledWith('chat-1'));
    expect(sent.at(-1)).toEqual({ type: 'computer', on: false });
    expect(await service.stop()).toBe(false);
  });

  it('turning it off stops what’s running', async () => {
    const { call } = context();
    await call({ action: 'screenshot' });
    await service.setEnabled(false);
    expect(interrupt).toHaveBeenCalledWith('chat-1');
    expect(service.ready).toBe(false);
  });

  it('says where the switches are, and who draws the edge', async () => {
    const status = await service.status(true);
    expect(status).toMatchObject({
      platform: 'mac',
      enabled: true,
      grantTo: 'Conch',
      overlay: 'app',
      stopKeys: '⌘⎋',
      here: true,
    });
    expect(status.keptAway).toContain('Password managers');
    await service.openAccess('control');
    expect(computer.requested).toEqual(['control']);
  });
});
