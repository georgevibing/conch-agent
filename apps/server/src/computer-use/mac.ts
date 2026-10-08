/**
 * Using a Mac's apps without installing anything (ADR 0110): the system's own
 * `screencapture` for the picture, and JavaScript for Automation (`osascript
 * -l JavaScript`, part of every Mac) calling Core Graphics and AppKit for the
 * rest — the same mouse and key events a person's hardware makes, the list of
 * windows, and the two Privacy & Security switches. No native addon, no
 * download, nothing to keep up to date.
 *
 * Every call is a fresh, short `osascript` with fixed code and one JSON
 * argument Conch wrote; nothing the assistant says becomes code. Pictures go
 * through a private temporary folder that's removed as soon as the bytes are
 * read: the screen is never kept on disk.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ComputerUseAccessKind } from '@conch/protocol';

import { run, type RunResult } from '../lib/proc';
import type { ComputerDriver, PointerAction, ScreenWindow } from './driver';
import type { KeyCombo, Modifier, Rect, ScreenApp } from './policy';

/** Runs a program to completion: the seam tests stand in for. */
export type Runner = (
  file: string,
  args: string[],
  options?: { timeout?: number; signal?: AbortSignal },
) => Promise<RunResult>;

const OSASCRIPT = '/usr/bin/osascript';
const SCREENCAPTURE = '/usr/sbin/screencapture';
const OPEN = '/usr/bin/open';

/** System Settings' own pages for the two switches. */
export const ACCESS_PANES: Record<ComputerUseAccessKind, string> = {
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  control: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};

const FLAGS: Record<Modifier, number> = {
  shift: 0x20000,
  ctrl: 0x40000,
  alt: 0x80000,
  cmd: 0x100000,
  fn: 0x800000,
};

/** How many characters one call types: Stop is noticed between pieces. */
const TYPE_PIECE = 24;

/**
 * The one script. `run(argv)` reads a command Conch wrote as JSON and answers
 * in JSON. Functions the bridge doesn't declare are bound by hand.
 */
export const SCRIPT = String.raw`
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.bindFunction('CGPreflightScreenCaptureAccess', ['bool', []]);
ObjC.bindFunction('CGRequestScreenCaptureAccess', ['bool', []]);
ObjC.bindFunction('AXIsProcessTrusted', ['bool', []]);
ObjC.bindFunction('AXIsProcessTrustedWithOptions', ['bool', ['void*']]);
ObjC.bindFunction('CGEventPost', ['void', ['int', 'void*']]);
ObjC.bindFunction('CGEventSetFlags', ['void', ['void*', 'unsigned long long']]);
ObjC.bindFunction('CGEventSetIntegerValueField', ['void', ['void*', 'unsigned int', 'long long']]);
ObjC.bindFunction('CGEventKeyboardSetUnicodeString', ['void', ['void*', 'unsigned long', 'unsigned short *']]);
ObjC.bindFunction('CGEventCreateScrollWheelEvent2', ['void*', ['void*', 'unsigned int', 'unsigned int', 'int', 'int', 'int']]);

function post(e) { $.CGEventPost(0, e); }
function mouse(type, x, y, button) {
  return $.CGEventCreateMouseEvent($(), type, $.CGPointMake(x, y), button);
}
function appOf(running) {
  if (!running || running.isNil()) return undefined;
  const id = ObjC.unwrap(running.bundleIdentifier);
  const name = ObjC.unwrap(running.localizedName) || '';
  return { id: id || name, name: name, pid: running.processIdentifier };
}
function primary() {
  const f = $.NSScreen.screens.objectAtIndex(0).frame;
  return { width: f.size.width, height: f.size.height };
}
const ops = {
  access() {
    return { screen: $.CGPreflightScreenCaptureAccess(), control: $.AXIsProcessTrusted() };
  },
  request(c) {
    if (c.kind === 'screen') return { asked: $.CGRequestScreenCaptureAccess() };
    return { asked: $.AXIsProcessTrustedWithOptions($({ AXTrustedCheckOptionPrompt: true })) };
  },
  screen() { return primary(); },
  windows() {
    const front = appOf($.NSWorkspace.sharedWorkspace.frontmostApplication);
    const list = ObjC.deepUnwrap(ObjC.castRefToObject(
      $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0))) || [];
    const apps = {};
    const windows = [];
    for (const w of list) {
      if (!w || (w.kCGWindowAlpha !== undefined && w.kCGWindowAlpha <= 0)) continue;
      const pid = w.kCGWindowOwnerPID;
      if (!(pid in apps))
        apps[pid] = appOf($.NSRunningApplication.runningApplicationWithProcessIdentifier(pid)) ||
          { id: w.kCGWindowOwnerName || 'unknown', name: w.kCGWindowOwnerName || 'unknown', pid: pid };
      const b = w.kCGWindowBounds || {};
      windows.push({ app: apps[pid], title: w.kCGWindowName || '', layer: w.kCGWindowLayer || 0,
        bounds: { x: b.X || 0, y: b.Y || 0, width: b.Width || 0, height: b.Height || 0 } });
    }
    return { front: front, windows: windows };
  },
  shrink(c) {
    const img = $.NSImage.alloc.initWithContentsOfFile(c.src);
    if (!img || img.isNil()) throw new Error('no picture');
    const W = c.width, H = c.height;
    const rep = $.NSBitmapImageRep.alloc.initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, W, H, 8, 4, true, false, $.NSDeviceRGBColorSpace, 0, 0);
    rep.size = $.NSMakeSize(W, H);
    $.NSGraphicsContext.saveGraphicsState;
    const ctx = $.NSGraphicsContext.graphicsContextWithBitmapImageRep(rep);
    $.NSGraphicsContext.setCurrentContext(ctx);
    ctx.imageInterpolation = $.NSImageInterpolationHigh;
    img.drawInRectFromRectOperationFraction($.NSMakeRect(0, 0, W, H), $.NSZeroRect, $.NSCompositingOperationCopy, 1.0);
    $.NSColor.colorWithSRGBRedGreenBlueAlpha(0.16, 0.15, 0.17, 1).set;
    for (const r of c.cover) $.NSRectFill($.NSMakeRect(r.x, H - r.y - r.height, r.width, r.height));
    $.NSGraphicsContext.restoreGraphicsState;
    const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG, $({ NSImageCompressionFactor: 0.72 }));
    if (!data.writeToFileAtomically(c.dst, true)) throw new Error('could not write');
    return { ok: true };
  },
  pointer(c) {
    if (c.kind === 'move') { post(mouse(5, c.x, c.y, 0)); return { ok: true }; }
    if (c.kind === 'drag') {
      post(mouse(5, c.x, c.y, 0));
      post(mouse(1, c.x, c.y, 0));
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        post(mouse(6, c.x + ((c.toX - c.x) * i) / steps, c.y + ((c.toY - c.y) * i) / steps, 0));
        delay(0.012);
      }
      post(mouse(2, c.toX, c.toY, 0));
      return { ok: true };
    }
    const kinds = { left: [1, 2, 0], right: [3, 4, 1], middle: [25, 26, 2] }[c.button];
    post(mouse(5, c.x, c.y, 0));
    for (let n = 1; n <= c.count; n++) {
      const down = mouse(kinds[0], c.x, c.y, kinds[2]);
      const up = mouse(kinds[1], c.x, c.y, kinds[2]);
      $.CGEventSetIntegerValueField(down, 1, n);
      $.CGEventSetIntegerValueField(up, 1, n);
      post(down); post(up);
    }
    return { ok: true };
  },
  keys(c) {
    for (let i = 0; i < c.repeat; i++) {
      const down = $.CGEventCreateKeyboardEvent($(), c.code, true);
      const up = $.CGEventCreateKeyboardEvent($(), c.code, false);
      $.CGEventSetFlags(down, c.flags);
      $.CGEventSetFlags(up, c.flags);
      post(down); post(up);
      if (c.repeat > 1) delay(0.02);
    }
    return { ok: true };
  },
  type(c) {
    for (let i = 0; i < c.text.length; i++) {
      const unit = Ref('unsigned short');
      unit[0] = c.text.charCodeAt(i);
      for (const pressed of [true, false]) {
        const e = $.CGEventCreateKeyboardEvent($(), 0, pressed);
        $.CGEventKeyboardSetUnicodeString(e, 1, unit);
        post(e);
      }
      delay(0.006);
    }
    return { ok: true };
  },
  scroll(c) {
    post(mouse(5, c.x, c.y, 0));
    post($.CGEventCreateScrollWheelEvent2($(), 1, 2, c.dy, c.dx, 0));
    return { ok: true };
  },
  find(c) {
    const ws = $.NSWorkspace.sharedWorkspace;
    let url = c.name.indexOf('.') > 0 ? ws.URLForApplicationWithBundleIdentifier(c.name) : undefined;
    let path = url && !url.isNil() ? ObjC.unwrap(url.path) : ObjC.unwrap(ws.fullPathForApplication(c.name));
    if (!path) return {};
    const bundle = $.NSBundle.bundleWithPath(path);
    if (!bundle || bundle.isNil()) return {};
    const id = ObjC.unwrap(bundle.bundleIdentifier);
    const name = ObjC.unwrap($.NSFileManager.defaultManager.displayNameAtPath(path)) || c.name;
    return id ? { app: { id: id, name: String(name).replace(/[.]app$/, '') } } : {};
  },
  apps() {
    const list = $.NSWorkspace.sharedWorkspace.runningApplications;
    const out = [];
    for (let i = 0; i < Number(list.count); i++) {
      const a = list.objectAtIndex(i);
      if (Number(a.activationPolicy) !== 0) continue;
      const app = appOf(a);
      if (app) out.push(app);
    }
    return { apps: out };
  },
};
function run(argv) {
  const command = JSON.parse(argv[0]);
  const op = ops[command.op];
  if (!op) throw new Error('unknown');
  return JSON.stringify(op(command));
}
`;

/** The Mac's hands and eyes. `runner` is the seam a test stands in for. */
export class MacDriver implements ComputerDriver {
  readonly platform = 'mac' as const;

  constructor(
    private readonly runner: Runner = (file, args, options) => run(file, args, options),
  ) {}

  async #call<T>(command: Record<string, unknown>, timeout = 10_000, signal?: AbortSignal) {
    const result = await this.runner(
      OSASCRIPT,
      ['-l', 'JavaScript', '-e', SCRIPT, JSON.stringify(command)],
      { timeout, ...(signal && { signal }) },
    );
    if (result.code !== 0) throw new Error(macError(result.stderr));
    return JSON.parse(result.stdout.trim() || '{}') as T;
  }

  async access() {
    try {
      const read = await this.#call<{ screen?: boolean; control?: boolean }>({ op: 'access' });
      return {
        screen: read.screen ? ('granted' as const) : ('missing' as const),
        control: read.control ? ('granted' as const) : ('missing' as const),
      };
    } catch {
      return { screen: 'unknown' as const, control: 'unknown' as const };
    }
  }

  async request(kind: ComputerUseAccessKind) {
    // Putting Conch on the list first means the person only flips its switch.
    await this.#call({ op: 'request', kind }).catch(() => undefined);
    const opened = await this.runner(OPEN, [ACCESS_PANES[kind]], { timeout: 10_000 });
    if (opened.code !== 0) throw new Error('Couldn’t open System Settings.');
  }

  screen() {
    return this.#call<{ width: number; height: number }>({ op: 'screen' });
  }

  async windows() {
    const read = await this.#call<{
      front?: ScreenApp & { pid?: number };
      windows?: (ScreenWindow & { app: ScreenApp & { pid?: number } })[];
    }>({ op: 'windows' });
    const app = (a: ScreenApp & { pid?: number }): ScreenApp => ({ id: a.id, name: a.name });
    return {
      ...(read.front && { front: app(read.front) }),
      windows: (read.windows ?? []).map((w) => ({ ...w, app: app(w.app) })),
    };
  }

  async capture(size: { width: number; height: number }, cover: Rect[], signal?: AbortSignal) {
    const dir = await mkdtemp(join(tmpdir(), 'conch-screen-'));
    try {
      const src = join(dir, 'screen.png');
      const dst = join(dir, 'screen.jpg');
      // -x: no sound; -m: the main screen; -C: with the pointer, so the model sees where it is.
      const shot = await this.runner(SCREENCAPTURE, ['-x', '-m', '-C', '-t', 'png', src], {
        timeout: 10_000,
        ...(signal && { signal }),
      });
      if (shot.code !== 0) throw new Error(macError(shot.stderr));
      await this.#call({ op: 'shrink', src, dst, ...size, cover }, 15_000, signal);
      return await readFile(dst);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async pointer(action: PointerAction) {
    await this.#call({ op: 'pointer', ...action });
  }

  async keys(combo: KeyCombo, repeat = 1) {
    const flags = combo.modifiers.reduce((all, m) => all | FLAGS[m], 0);
    await this.#call({ op: 'keys', code: combo.code, flags, repeat: Math.max(1, repeat) });
  }

  async type(text: string, signal?: AbortSignal) {
    let at = 0;
    while (at < text.length) {
      signal?.throwIfAborted();
      // Never split a pair of halves that make one character.
      let end = Math.min(text.length, at + TYPE_PIECE);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end += 1;
      await this.#call({ op: 'type', text: text.slice(at, end) }, 20_000, signal);
      at = end;
    }
  }

  async scroll(x: number, y: number, dx: number, dy: number) {
    await this.#call({ op: 'scroll', x, y, dx: Math.round(dx), dy: Math.round(dy) });
  }

  async find(name: string) {
    const read = await this.#call<{ app?: ScreenApp }>({ op: 'find', name }).catch(() => ({}));
    return 'app' in read ? read.app : undefined;
  }

  async open(app: ScreenApp) {
    const opened = await this.runner(OPEN, ['-b', app.id], { timeout: 15_000 });
    if (opened.code !== 0) throw new Error(`${app.name} didn’t open.`);
  }

  async apps() {
    const read = await this.#call<{ apps?: ScreenApp[] }>({ op: 'apps' });
    return (read.apps ?? []).map((a) => ({ id: a.id, name: a.name }));
  }
}

/** What macOS said, in words the assistant can act on. */
export function macError(stderr: string): string {
  if (/could not create image|not authori[sz]ed|-25211|1002/i.test(stderr))
    return 'macOS isn’t letting Conch see the screen. The person turns on Screen Recording for it in Settings → This computer.';
  if (/timed out|ETIMEDOUT|SIGTERM/i.test(stderr))
    return 'The computer took too long to answer. Try once more.';
  return 'The computer didn’t do that. Take a screenshot to see where things are, then try another way.';
}
