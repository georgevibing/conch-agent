import { afterEach, describe, expect, it, vi } from 'vitest';

import { installVisibleViewport } from './visibleViewport';

/** A pretend `visualViewport`: what a phone reports as its keyboard comes and goes. */
function fakeViewport(initial: { height: number; offsetTop?: number; scale?: number }) {
  const view = Object.assign(new EventTarget(), { offsetTop: 0, scale: 1, ...initial });
  vi.stubGlobal('visualViewport', view);
  const change = (next: Partial<typeof initial>) => {
    Object.assign(view, next);
    view.dispatchEvent(new Event('resize'));
  };
  return change;
}

const visible = () => ({
  height: document.documentElement.style.getPropertyValue('--nc-visible-height'),
  top: document.documentElement.style.getPropertyValue('--nc-visible-top'),
});

describe('installVisibleViewport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the part of the window that can be seen, every time the keyboard comes up', () => {
    const change = fakeViewport({ height: 844 });
    const uninstall = installVisibleViewport();
    expect(visible()).toEqual({ height: '844px', top: '0px' });

    change({ height: 508, offsetTop: 120 });
    expect(visible()).toEqual({ height: '508px', top: '120px' });
    change({ height: 844, offsetTop: 0 });
    // The second time iOS doesn't pan the page; the size still follows.
    change({ height: 508 });
    expect(visible()).toEqual({ height: '508px', top: '0px' });

    uninstall();
    expect(visible()).toEqual({ height: '', top: '' });
  });

  it('leaves a pinch-zoom alone', () => {
    const change = fakeViewport({ height: 844 });
    const uninstall = installVisibleViewport();
    change({ height: 422, offsetTop: 200, scale: 2 });
    expect(visible()).toEqual({ height: '', top: '' });
    change({ height: 844, offsetTop: 0, scale: 1 });
    expect(visible()).toEqual({ height: '844px', top: '0px' });
    uninstall();
  });

  it('holds still while the keyboard goes over something marked for it (the browser’s keys)', async () => {
    const change = fakeViewport({ height: 844 });
    const uninstall = installVisibleViewport();
    const keys = document.createElement('textarea');
    keys.setAttribute('data-nc-keyboard-over', '');
    document.body.append(keys);
    keys.focus();
    change({ height: 508, offsetTop: 120 });
    expect(visible()).toEqual({ height: '844px', top: '0px' });
    // Gone from there, with the keyboard still up: the size follows again.
    keys.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(visible()).toEqual({ height: '508px', top: '120px' });
    keys.remove();
    uninstall();
  });

  it('does nothing where there is no visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    const uninstall = installVisibleViewport();
    expect(visible()).toEqual({ height: '', top: '' });
    uninstall();
  });
});
