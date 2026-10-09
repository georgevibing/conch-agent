/**
 * Keeps `--nc-visible-height` and `--nc-visible-top` on `<html>` equal to the
 * part of the window that can be seen. A phone's keyboard covers the bottom of
 * the window without resizing it, and iOS pans the page out of the way only
 * the first time; whatever is sized and placed with these stays above the
 * keyboard and in view, every time. A pinch-zoom is left alone: then the page
 * is meant to be bigger than the screen. While the focus is in something
 * marked `data-nc-keyboard-over` (the browser's keys), the size is held: the
 * keyboard goes over it, and nothing behind moves.
 */
export function installVisibleViewport(doc: Document = document): () => void {
  const view = doc.defaultView?.visualViewport;
  if (!view) return () => {};
  const root = doc.documentElement;

  const clear = () => {
    root.style.removeProperty('--nc-visible-height');
    root.style.removeProperty('--nc-visible-top');
  };
  const write = () => {
    const focused = doc.activeElement;
    if (focused instanceof Element && focused.closest('[data-nc-keyboard-over]')) return;
    if (Math.abs(view.scale - 1) > 0.01) return clear();
    root.style.setProperty('--nc-visible-height', `${view.height}px`);
    root.style.setProperty('--nc-visible-top', `${view.offsetTop}px`);
  };

  // Focus has moved on by the next task, whichever way it went.
  const refocus = () => setTimeout(write, 0);
  write();
  view.addEventListener('resize', write);
  view.addEventListener('scroll', write);
  doc.addEventListener('focusin', refocus);
  doc.addEventListener('focusout', refocus);
  return () => {
    view.removeEventListener('resize', write);
    view.removeEventListener('scroll', write);
    doc.removeEventListener('focusin', refocus);
    doc.removeEventListener('focusout', refocus);
    clear();
  };
}
