import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';

import './find.css';
import { findAll, fold } from './match';

export interface FindState {
  /** Matches found (at most `MAX_MATCHES`). */
  count: number;
  /** Index of the current match, or -1. */
  current: number;
  /** More matches exist than are highlighted. */
  capped: boolean;
  /** Each match's vertical position in the scrolled content, 0–1 (for a match rail). */
  positions: number[];
}

export interface UseFindOptions {
  query: string;
  enabled?: boolean;
  /**
   * CSS selector of an element to land on first (e.g. the message a search
   * result pointed at). Waits for it to render, then scrolls to the first
   * match inside it — or to the element itself — and flashes it.
   */
  target?: string;
}

const MAX_MATCHES = 2000;
const MAX_TICKS = 400;
const ALL = 'nc-find';
const CURRENT = 'nc-find-current';
const SKIP = '[data-find-skip], [aria-hidden="true"], script, style, svg, .nc-visually-hidden';
const BLOCKS = 'p, li, pre, td, th, h1, h2, h3, h4, h5, h6, blockquote, article, section, div';
const EMPTY: FindState = { count: 0, current: -1, capped: false, positions: [] };
/** How long to wait for a `target` to appear before giving up on it. */
const TARGET_PATIENCE = 5000;

const highlights = () =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined'
    ? CSS.highlights
    : undefined;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrollParent(el: HTMLElement): HTMLElement {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight)
      return node;
  }
  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
}

function rectOf(target: Range | Element): DOMRect | undefined {
  return typeof target.getBoundingClientRect === 'function'
    ? target.getBoundingClientRect()
    : undefined;
}

/** Folded text of every visible text node under `root`, with where each node starts. */
interface Snapshot {
  text: string;
  nodes: Text[];
  starts: number[];
}

function snapshot(root: HTMLElement): Snapshot {
  const skipped = new Map<Element, boolean>();
  const blocks = new Map<Element, Element | null>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue) return NodeFilter.FILTER_REJECT;
      let skip = skipped.get(parent);
      if (skip === undefined) {
        skip = parent.closest(SKIP) !== null;
        skipped.set(parent, skip);
      }
      return skip ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  let lastBlock: Element | null | undefined;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement as Element;
    let block = blocks.get(parent);
    if (block === undefined) {
      block = parent.closest(BLOCKS);
      blocks.set(parent, block);
    }
    // Text in different blocks never runs together into one match.
    if (lastBlock !== undefined && block !== lastBlock) text += '\n';
    lastBlock = block;
    starts.push(text.length);
    nodes.push(node as Text);
    text += fold(node.nodeValue ?? '');
  }
  return { text, nodes, starts };
}

function locate(snap: Snapshot, offset: number, end: boolean): [Text, number] | undefined {
  let lo = 0;
  let hi = snap.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    const start = snap.starts[mid] as number;
    if (start < offset || (!end && start === offset)) lo = mid;
    else hi = mid - 1;
  }
  const node = snap.nodes[lo];
  if (!node) return undefined;
  return [node, Math.min(Math.max(0, offset - (snap.starts[lo] as number)), node.length)];
}

/**
 * The engine behind find-in-page: walks the text under a root, marks every
 * match with the CSS Custom Highlight API (no DOM is changed, so it's cheap
 * even while text streams in), and moves a "current" match through them.
 */
class Finder {
  #root?: HTMLElement;
  #observer?: MutationObserver;
  #snap?: Snapshot;
  #ranges: Range[] = [];
  #offsets: number[] = [];
  #query = '';
  #target?: string;
  #targetSince = 0;
  #pending?: ReturnType<typeof setTimeout>;
  #state: FindState = EMPTY;
  #listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getState = () => this.#state;

  #set(state: Partial<FindState>) {
    this.#state = { ...this.#state, ...state };
    for (const listener of this.#listeners) listener();
  }

  attach(root: HTMLElement) {
    this.#root = root;
    this.#snap = undefined;
    this.#observer = new MutationObserver(() => {
      this.#snap = undefined;
      // Streaming text mutates constantly; re-scan at most a few times a second.
      if (this.#query && !this.#pending) {
        this.#pending = setTimeout(() => {
          this.#pending = undefined;
          this.#run(false);
        }, 150);
      }
    });
    this.#observer.observe(root, { subtree: true, childList: true, characterData: true });
    if (this.#query) this.#run(true);
  }

  detach() {
    this.#observer?.disconnect();
    this.#observer = undefined;
    clearTimeout(this.#pending);
    this.#pending = undefined;
    this.#root = undefined;
    this.#snap = undefined;
    this.#ranges = [];
    this.#offsets = [];
    highlights()?.delete(ALL);
    highlights()?.delete(CURRENT);
    if (this.#state !== EMPTY) {
      this.#state = EMPTY;
      for (const listener of this.#listeners) listener();
    }
  }

  setQuery(query: string, target?: string) {
    const changed = query !== this.#query;
    if (target && target !== this.#target) this.#targetSince = Date.now();
    this.#target = target;
    this.#query = query;
    if (changed || target) this.#run(true);
  }

  next = () => this.#step(1);
  prev = () => this.#step(-1);

  #step(delta: number) {
    const count = this.#ranges.length;
    if (!count) return;
    const current = (this.#state.current + delta + count) % count;
    this.#select(current, true);
  }

  #select(index: number, reveal: boolean) {
    const range = this.#ranges[index];
    const registry = highlights();
    if (range) {
      registry?.set(CURRENT, new Highlight(range));
      if (reveal) this.#reveal(range);
    } else {
      registry?.delete(CURRENT);
    }
    this.#set({ current: range ? index : -1 });
  }

  #reveal(target: Range | Element) {
    const root = this.#root;
    const rect = rectOf(target);
    if (!root || !rect) return;
    const scroller = scrollParent(root);
    const box = scroller.getBoundingClientRect();
    const margin = Math.min(96, box.height * 0.2);
    if (rect.top >= box.top + margin && rect.bottom <= box.bottom - margin) return;
    const top = scroller.scrollTop + (rect.top - box.top) - box.height * 0.35;
    const far = Math.abs(top - scroller.scrollTop) > box.height * 2;
    if (typeof scroller.scrollTo === 'function') {
      scroller.scrollTo({ top, behavior: far || reducedMotion() ? 'auto' : 'smooth' });
    } else {
      scroller.scrollTop = top;
    }
  }

  #run(fresh: boolean) {
    const root = this.#root;
    const registry = highlights();
    if (!root || !this.#query.trim()) {
      this.#ranges = [];
      this.#offsets = [];
      registry?.delete(ALL);
      registry?.delete(CURRENT);
      this.#set(EMPTY);
      return;
    }
    const snap = (this.#snap ??= snapshot(root));
    const found = findAll(snap.text, this.#query, MAX_MATCHES + 1);
    const capped = found.length > MAX_MATCHES;
    const previous = this.#offsets[this.#state.current];
    this.#offsets = [];
    this.#ranges = [];
    for (const [s, e] of found.slice(0, MAX_MATCHES)) {
      const start = locate(snap, s, false);
      const end = locate(snap, e, true);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(...start);
      range.setEnd(...end);
      this.#ranges.push(range);
      this.#offsets.push(s);
    }
    if (registry) {
      if (this.#ranges.length) registry.set(ALL, new Highlight(...this.#ranges));
      else registry.delete(ALL);
    }

    let current = -1;
    let reveal = fresh;
    const landed = this.#land();
    if (landed !== undefined) {
      current = landed;
      reveal = false;
    } else if (!fresh && previous !== undefined) {
      // Content changed under us: stay on the same match.
      current = this.#offsets.findIndex((o) => o >= previous);
      if (current === -1) current = this.#ranges.length - 1;
    } else if (this.#ranges.length) {
      current = this.#firstVisible();
      // Still waiting for a target to render: don't scroll somewhere else first.
      if (this.#target) reveal = false;
    }
    this.#set({ count: this.#ranges.length, capped, positions: this.#positions() });
    this.#select(current, reveal && current !== -1);
  }

  /** Resolve a pending `target`: its first match (or the element) becomes current. */
  #land(): number | undefined {
    const selector = this.#target;
    const root = this.#root;
    if (!selector || !root) return undefined;
    let element: Element | null = null;
    try {
      element = root.querySelector(selector);
    } catch {
      this.#target = undefined;
      return undefined;
    }
    if (!element) {
      if (Date.now() - this.#targetSince > TARGET_PATIENCE) this.#target = undefined;
      return undefined;
    }
    this.#target = undefined;
    flash(element);
    const index = this.#ranges.findIndex((r) => element.contains(r.startContainer));
    if (index !== -1) {
      this.#reveal(this.#ranges[index] as Range);
      return index;
    }
    this.#reveal(element);
    const after = this.#ranges.findIndex(
      (r) => element.compareDocumentPosition(r.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    return after === -1 ? this.#ranges.length - 1 : after;
  }

  /** Like a browser: start from the first match at or below the top of the view. */
  #firstVisible(): number {
    const root = this.#root;
    const first = this.#ranges[0];
    if (!root || !first || !rectOf(first)) return 0;
    const top = scrollParent(root).getBoundingClientRect().top;
    let lo = 0;
    let hi = this.#ranges.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((rectOf(this.#ranges[mid] as Range)?.bottom ?? 0) < top) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  #positions(): number[] {
    const root = this.#root;
    if (!root || !this.#ranges.length || !rectOf(this.#ranges[0] as Range)) return [];
    const scroller = scrollParent(root);
    const height = scroller.scrollHeight;
    if (!height) return [];
    const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const step = Math.max(1, Math.ceil(this.#ranges.length / MAX_TICKS));
    const out: number[] = [];
    for (let i = 0; i < this.#ranges.length; i += step) {
      const rect = rectOf(this.#ranges[i] as Range);
      if (rect) out.push(Math.min(1, Math.max(0, (rect.top - origin) / height)));
    }
    return out;
  }
}

function flash(element: Element) {
  element.removeAttribute('data-nc-flash');
  // Restart the animation if it's already running.
  void (element as HTMLElement).offsetWidth;
  element.setAttribute('data-nc-flash', '');
  setTimeout(() => element.removeAttribute('data-nc-flash'), 2000);
}

/**
 * Find-in-page for a region (a transcript). Highlights every match of `query`
 * under `root`, tracks a current match and scrolls it into view.
 */
export function useFind(
  root: RefObject<HTMLElement | null>,
  { query, enabled = true, target }: UseFindOptions,
) {
  const [finder] = useState(() => new Finder());
  const state = useSyncExternalStore(finder.subscribe, finder.getState, finder.getState);

  useEffect(() => {
    const el = root.current;
    if (!enabled || !el) return;
    finder.attach(el);
    return () => finder.detach();
  }, [enabled, root, finder]);

  useEffect(() => {
    finder.setQuery(enabled ? query : '', enabled ? target : undefined);
  }, [finder, query, target, enabled]);

  return { ...state, next: finder.next, prev: finder.prev };
}
