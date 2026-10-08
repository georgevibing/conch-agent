import type { ComputerUseAccessState } from '@conch/protocol';

import type { ComputerDriver, PointerAction, ScreenWindow } from './driver';
import type { KeyCombo, Rect, ScreenApp } from './policy';

/**
 * A pretend Mac for tests (ADR 0110): a screen, its windows front to back,
 * the apps on it, and a record of every event Conch sent. Nothing real is
 * ever clicked.
 */
export class PretendComputer implements ComputerDriver {
  readonly platform = 'mac' as const;
  access_: { screen: ComputerUseAccessState; control: ComputerUseAccessState } = {
    screen: 'granted',
    control: 'granted',
  };
  size = { width: 1440, height: 900 };
  front?: ScreenApp;
  shown: ScreenWindow[] = [];
  installed: ScreenApp[] = [];
  /** What Conch did, in order. */
  log: (
    | PointerAction
    | { kind: 'keys'; combo: KeyCombo; repeat: number }
    | { kind: 'type'; text: string }
    | { kind: 'scroll'; x: number; y: number; dx: number; dy: number }
    | { kind: 'open'; app: ScreenApp }
    | { kind: 'capture'; size: { width: number; height: number }; cover: Rect[] }
  )[] = [];
  requested: string[] = [];

  /** Put `app` in front with one window filling `bounds`. */
  show(app: ScreenApp, bounds: Rect = { x: 0, y: 25, width: 1440, height: 875 }, title = '') {
    this.front = app;
    this.shown = [
      { app, title, bounds, layer: 0 },
      ...this.shown.filter((w) => w.app.id !== app.id),
    ];
  }

  access() {
    return Promise.resolve({ ...this.access_ });
  }
  request(kind: 'screen' | 'control') {
    this.requested.push(kind);
    return Promise.resolve();
  }
  screen() {
    return Promise.resolve({ ...this.size });
  }
  windows() {
    return Promise.resolve({ ...(this.front && { front: this.front }), windows: [...this.shown] });
  }
  capture(size: { width: number; height: number }, cover: Rect[]) {
    this.log.push({ kind: 'capture', size, cover });
    return Promise.resolve(Buffer.from('pretend-jpeg'));
  }
  pointer(action: PointerAction) {
    this.log.push(action);
    return Promise.resolve();
  }
  keys(combo: KeyCombo, repeat = 1) {
    this.log.push({ kind: 'keys', combo, repeat });
    return Promise.resolve();
  }
  type(text: string) {
    this.log.push({ kind: 'type', text });
    return Promise.resolve();
  }
  scroll(x: number, y: number, dx: number, dy: number) {
    this.log.push({ kind: 'scroll', x, y, dx, dy });
    return Promise.resolve();
  }
  find(name: string) {
    return Promise.resolve(
      this.installed.find((a) => a.name.toLowerCase() === name.toLowerCase() || a.id === name),
    );
  }
  open(app: ScreenApp) {
    this.log.push({ kind: 'open', app });
    this.show(app);
    return Promise.resolve();
  }
  apps() {
    return Promise.resolve(this.shown.filter((w) => w.layer === 0).map((w) => w.app));
  }
  /** Only what touched the computer, not the looks at it. */
  get acted() {
    return this.log.filter((e) => e.kind !== 'capture');
  }
}

/** The mock engine's computer: Notes in front, Keynote to open, 1Password beside it. */
export function pretendComputer(): PretendComputer {
  const computer = new PretendComputer();
  computer.installed = [
    { id: 'com.apple.Notes', name: 'Notes' },
    { id: 'com.apple.iWork.Keynote', name: 'Keynote' },
  ];
  computer.show(
    { id: 'com.1password.1password', name: '1Password' },
    { x: 960, y: 25, width: 480, height: 600 },
  );
  computer.show({ id: 'com.apple.Notes', name: 'Notes' }, { x: 0, y: 25, width: 960, height: 875 });
  return computer;
}
