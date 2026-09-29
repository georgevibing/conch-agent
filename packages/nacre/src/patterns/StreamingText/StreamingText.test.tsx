import { waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderNacre } from '../../test/render';
import { revealWords } from './revealWords';
import { StreamingText } from './StreamingText';
import { revealSpeed, wordEnd } from './useSmoothText';

describe('StreamingText', () => {
  it('shows finished text at once, with no caret', () => {
    const { container } = renderNacre(<StreamingText text="Already here." />);
    const root = container.firstElementChild?.firstElementChild;
    expect(root).toHaveTextContent('Already here.');
    expect(root).not.toHaveAttribute('data-streaming');
    expect(root?.querySelector('[aria-hidden]')).toBeNull();
  });

  it('reveals a live stream word by word and lets fresh words settle in', async () => {
    const { container, rerender } = renderNacre(<StreamingText text="Hello " streaming />);
    const root = container.querySelector('[data-streaming]');
    rerender(<StreamingText text="Hello there, world" streaming />);
    // The last word may still be growing, so it's held back while streaming.
    await waitFor(() => expect(root).toHaveTextContent('Hello there,'));
    expect(root).not.toHaveTextContent('world');
    expect(root?.querySelector('[data-nc-fresh]')).not.toBeNull();
    rerender(<StreamingText text="Hello there, world" />);
    await waitFor(() => expect(root).toHaveTextContent('Hello there, world'));
  });

  it('shows text that grows without ever being live (history catching up) at once', () => {
    const { container, rerender } = renderNacre(<StreamingText text="Written " />);
    rerender(<StreamingText text="Written last week, replayed." />);
    expect(container).toHaveTextContent('Written last week, replayed.');
    expect(container.querySelector('[data-nc-fresh]')).toBeNull();
  });

  it('shows replaced text as is', async () => {
    const { container, rerender } = renderNacre(<StreamingText text="abc" />);
    rerender(<StreamingText text="xyz" />);
    await waitFor(() => expect(container).toHaveTextContent('xyz'));
  });
});

describe('useSmoothText helpers', () => {
  it('finds whole-word boundaries including trailing spaces', () => {
    expect(wordEnd('one two', 0)).toBe(4);
    expect(wordEnd('one two', 4)).toBe(7);
    expect(wordEnd('one  ', 0)).toBe(5);
  });

  it('speeds up with the backlog and wraps up briskly at the end', () => {
    expect(revealSpeed(10, true)).toBe(40);
    expect(revealSpeed(400, true)).toBe(500);
    expect(revealSpeed(100_000, true)).toBe(1200);
    expect(revealSpeed(10, false)).toBe(180);
  });
});

describe('revealWords', () => {
  const tree = () => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [{ type: 'text', value: 'one two three', position: { start: { offset: 0 } } }],
      },
      {
        type: 'element',
        tagName: 'pre',
        properties: {},
        children: [{ type: 'text', value: 'code stays', position: { start: { offset: 14 } } }],
      },
    ],
  });

  it('wraps each word and marks the fresh ones', () => {
    const t = tree();
    revealWords({ freshFrom: 4 })(t);
    const [p, pre] = t.children as { children: { properties?: object; children?: unknown }[] }[];
    expect(p?.children).toHaveLength(3);
    expect(p?.children.map((c) => 'dataNcFresh' in (c.properties ?? {}))).toEqual([
      false,
      true,
      true,
    ]);
    expect(pre?.children).toHaveLength(1);
  });

  it('honours a block offset and marks nothing without freshFrom', () => {
    const t = tree();
    revealWords({ freshFrom: 108, offset: 100 })(t);
    const p = (t.children[0] as { children: { properties?: object }[] }).children;
    expect(p.map((c) => 'dataNcFresh' in (c.properties ?? {}))).toEqual([false, false, true]);
    const u = tree();
    revealWords()(u);
    const q = (u.children[0] as { children: { properties?: object }[] }).children;
    expect(q.every((c) => !('dataNcFresh' in (c.properties ?? {})))).toBe(true);
  });
});
