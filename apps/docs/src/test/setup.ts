import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// findBy*/waitFor wait up to 1s by default; a busy CI runner needs more headroom.
configure({ asyncUtilTimeout: 5000 });

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      // Tests see the pages standing still: the pictures on the front page show
      // their resting moment instead of playing on a clock.
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.scrollTo ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

// jsdom has no scrolling: going to the top of a new page is nothing to do here.
window.scrollTo = () => {};
