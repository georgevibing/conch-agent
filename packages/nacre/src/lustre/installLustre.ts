/**
 * Installs the single delegated pointer listener that powers Lustre.
 *
 * For every `[data-lustre]` element under the pointer (including ancestors) we
 * write `--nc-mx`, `--nc-my` (pointer position) and `--nc-angle` (angle of the
 * pointer around the element's centre). On press we write `--nc-px`/`--nc-py`
 * and play a "tide ring" by animating the registered `--nc-bloom` property.
 *
 * All writes happen once per animation frame and never trigger React renders.
 */
const LUSTRE_SELECTOR = '[data-lustre]';

let installCount = 0;
let teardown: (() => void) | null = null;

function lustreChain(target: EventTarget | null): HTMLElement[] {
  const chain: HTMLElement[] = [];
  let el = target instanceof Element ? target.closest<HTMLElement>(LUSTRE_SELECTOR) : null;
  while (el) {
    chain.push(el);
    el = el.parentElement?.closest<HTMLElement>(LUSTRE_SELECTOR) ?? null;
  }
  return chain;
}

function writePointer(el: HTMLElement, x: number, y: number) {
  const rect = el.getBoundingClientRect();
  const lx = x - rect.left;
  const ly = y - rect.top;
  const angle = (Math.atan2(ly - rect.height / 2, lx - rect.width / 2) * 180) / Math.PI;
  el.style.setProperty('--nc-mx', `${lx.toFixed(1)}px`);
  el.style.setProperty('--nc-my', `${ly.toFixed(1)}px`);
  el.style.setProperty('--nc-angle', `${(angle + 90).toFixed(1)}deg`);
  return { lx, ly };
}

function motionReduced(el: HTMLElement): boolean {
  if (el.closest('[data-nacre-motion="reduced"]')) return true;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function install(doc: Document): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};

  let frame = 0;
  let pending: PointerEvent | null = null;

  const flush = () => {
    frame = 0;
    const event = pending;
    pending = null;
    if (!event) return;
    for (const el of lustreChain(event.target)) writePointer(el, event.clientX, event.clientY);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pending = event;
    if (!frame) frame = win.requestAnimationFrame(flush);
  };

  const onDown = (event: PointerEvent) => {
    const [el] = lustreChain(event.target);
    if (!el || el.matches(':disabled, [data-disabled]')) return;
    const { lx, ly } = writePointer(el, event.clientX, event.clientY);
    el.style.setProperty('--nc-px', `${lx.toFixed(1)}px`);
    el.style.setProperty('--nc-py', `${ly.toFixed(1)}px`);
    if (motionReduced(el) || typeof el.animate !== 'function') return;
    el.animate([{ '--nc-bloom': 0 }, { '--nc-bloom': 1 }] as Keyframe[], {
      duration: 720,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
  };

  doc.addEventListener('pointermove', onMove, { passive: true });
  doc.addEventListener('pointerdown', onDown, { passive: true });
  return () => {
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerdown', onDown);
    if (frame) win.cancelAnimationFrame(frame);
  };
}

/** Reference-counted: safe to call from multiple providers. Returns an uninstaller. */
export function installLustre(doc: Document = document): () => void {
  installCount += 1;
  teardown ??= install(doc);
  return () => {
    installCount -= 1;
    if (installCount === 0) {
      teardown?.();
      teardown = null;
    }
  };
}
