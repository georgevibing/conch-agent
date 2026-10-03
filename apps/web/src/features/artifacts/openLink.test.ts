import { afterEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => vi.fn());
vi.mock('@conch/nacre', () => ({ toast }));

import { askToOpen } from './openLink';

afterEach(() => {
  toast.mockClear();
  vi.unstubAllGlobals();
});

type Asked = [string, { description: string; action: { onClick: () => void } }];

describe('a sealed page asking to open a link', () => {
  it('asks with the whole address, and opens exactly that in a tab of its own', () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    expect(askToOpen('https://evil.example/path?x=1#y')).toBe(true);
    const [title, options] = toast.mock.calls[0] as Asked;
    expect(title).toBe('Open evil.example/path?x=1#y?');
    expect(options.description).toBe('https://evil.example/path?x=1#y');
    expect(open).not.toHaveBeenCalled();
    options.action.onClick();
    expect(open).toHaveBeenCalledWith(
      'https://evil.example/path?x=1#y',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it.each([
    'javascript:alert(document.cookie)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'not a link',
    `https://example.com/${'a'.repeat(2100)}`,
  ])('never asks about %s', (url) => {
    expect(askToOpen(url)).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
