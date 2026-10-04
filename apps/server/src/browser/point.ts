import type { Frame, Page } from 'playwright-core';

import { SECRET_ATTR, type SecretKind } from './risk';

/**
 * What's at a point on the page, for the coordinate fallback (ADR 0080):
 * the control's own words (for the high-stakes check), whether it's a secret
 * field, and whether it takes typing. It looks inside frames, cross-origin
 * ones included, the way a click would land.
 */
export interface PointTarget {
  /** The control's own words, as `wordsOf` reads them for a ref. */
  words: string;
  secret?: SecretKind;
  editable: boolean;
  /** "button", "canvas", "input"… */
  tag: string;
  /** Its box in page pixels, for the cursor and the question's highlight. */
  box?: { x: number; y: number; width: number; height: number };
  /** Inside a frame Conch couldn't look into: nothing is known about it. */
  unknown?: boolean;
}

interface Probe {
  frame: boolean;
  left: number;
  top: number;
  words: string;
  secret: string | null;
  editable: boolean;
  tag: string;
  box: { x: number; y: number; width: number; height: number } | null;
}

/** Runs in the page: serialised, so self-contained. */
export function probeInPage([x, y, attr]: [number, number, string]): Probe | null {
  interface El {
    tagName: string;
    isContentEditable?: boolean;
    innerText?: string;
    value?: string;
    clientLeft: number;
    clientTop: number;
    getAttribute(name: string): string | null;
    getBoundingClientRect(): { left: number; top: number; width: number; height: number };
    closest(selector: string): El | null;
  }
  const doc = (
    globalThis as unknown as { document: { elementFromPoint(x: number, y: number): El | null } }
  ).document;
  const el = doc.elementFromPoint(x, y);
  if (!el) return null;
  const tag = el.tagName.toLowerCase();
  if (tag === 'iframe' || tag === 'frame') {
    const r = el.getBoundingClientRect();
    return {
      frame: true,
      left: r.left + el.clientLeft,
      top: r.top + el.clientTop,
      words: '',
      secret: null,
      editable: false,
      tag,
      box: null,
    };
  }
  const control =
    el.closest(
      'button, a, [role=button], [role=link], [role=menuitem], [role=option], [role=tab], [role=checkbox], [role=switch], input, select, textarea, summary, label',
    ) ?? el;
  const words = (
    control.innerText ||
    control.getAttribute('aria-label') ||
    control.value ||
    control.getAttribute('title') ||
    ''
  )
    .trim()
    .slice(0, 120);
  const r = control.getBoundingClientRect();
  return {
    frame: false,
    left: 0,
    top: 0,
    words,
    secret: el.closest(`[${attr}]`)?.getAttribute(attr) ?? null,
    editable:
      Boolean(el.isContentEditable) ||
      tag === 'textarea' ||
      (tag === 'input' &&
        !/^(button|submit|reset|checkbox|radio|file|image|range|color)$/i.test(
          el.getAttribute('type') ?? '',
        )),
    tag: control.tagName.toLowerCase(),
    box: { x: r.left, y: r.top, width: r.width, height: r.height },
  };
}

const asSecret = (value: string | null | undefined): SecretKind | undefined =>
  value === 'password' || value === 'payment' || value === 'identity' ? value : undefined;

/** What a click at (x, y) in the viewport would land on. */
export async function targetAt(page: Page, x: number, y: number): Promise<PointTarget> {
  let frame: Frame = page.mainFrame();
  let fx = x;
  let fy = y;
  let ox = 0;
  let oy = 0;
  for (let depth = 0; depth < 5; depth++) {
    const probe = await frame
      .evaluate(probeInPage, [fx, fy, SECRET_ATTR] as [number, number, string])
      .catch(() => null);
    if (!probe) return { words: '', editable: false, tag: '', unknown: depth > 0 };
    if (!probe.frame) {
      return {
        words: probe.words,
        secret: asSecret(probe.secret),
        editable: probe.editable,
        tag: probe.tag,
        ...(probe.box && {
          box: { ...probe.box, x: probe.box.x + ox, y: probe.box.y + oy },
        }),
      };
    }
    const handle = await frame
      .evaluateHandle(
        ([px, py]) =>
          (
            globalThis as unknown as {
              document: { elementFromPoint(x: number, y: number): unknown };
            }
          ).document.elementFromPoint(px, py),
        [fx, fy] as [number, number],
      )
      .catch(() => undefined);
    const child = await handle
      ?.asElement()
      ?.contentFrame()
      .catch(() => null);
    await handle?.dispose().catch(() => undefined);
    if (!child) return { words: '', editable: false, tag: 'iframe', unknown: true };
    fx -= probe.left;
    fy -= probe.top;
    ox += probe.left;
    oy += probe.top;
    frame = child;
  }
  return { words: '', editable: false, tag: '', unknown: true };
}

/** The field that has the keyboard now, in whichever frame: is it a secret, does it take text? */
export async function focused(
  page: Page,
): Promise<{ secret?: SecretKind; editable: boolean } | undefined> {
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate((attr: string) => {
        interface El {
          tagName: string;
          isContentEditable?: boolean;
          getAttribute(name: string): string | null;
          closest(selector: string): El | null;
        }
        const doc = (
          globalThis as unknown as { document: { hasFocus(): boolean; activeElement: El | null } }
        ).document;
        const el = doc.activeElement;
        if (!doc.hasFocus() || !el) return null;
        const tag = el.tagName.toLowerCase();
        if (tag === 'iframe' || tag === 'frame' || tag === 'body') return null;
        return {
          secret: el.closest(`[${attr}]`)?.getAttribute(attr) ?? null,
          editable:
            Boolean(el.isContentEditable) ||
            tag === 'textarea' ||
            (tag === 'input' &&
              !/^(button|submit|reset|checkbox|radio|file|image|range|color)$/i.test(
                el.getAttribute('type') ?? '',
              )),
        };
      }, SECRET_ATTR)
      .catch(() => null);
    if (found) return { secret: asSecret(found.secret), editable: found.editable };
  }
  return undefined;
}
