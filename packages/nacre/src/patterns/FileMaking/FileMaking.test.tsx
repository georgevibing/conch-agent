import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { FileMaking, FileTile } from './FileMaking';
import { badgeFor, fileMeta, fileTypeOf, htmlGist, markdownLines, withExtension } from './fileKind';

const thumb = 'data:image/png;base64,iVBORw0KGgo=';

describe('FileMaking', () => {
  it('draws the file’s shape while it is made, and says how far it got and the step', async () => {
    const { container } = renderNacre(
      <FileMaking
        state="making"
        name="Q3 report.pdf"
        progress={0.42}
        stage="generating"
        detail="Laying out pages"
        by="Chromium"
      />,
    );
    const figure = container.querySelector('figure');
    expect(figure).toHaveAttribute('aria-busy', 'true');
    expect(figure).toHaveAttribute('data-type', 'pdf');
    expect(figure).toHaveAttribute('data-shape', 'page');
    const bar = screen.getByRole('progressbar', { name: 'Making Q3 report.pdf' });
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext', '42%, Laying out pages');
    expect(screen.getByText('Laying out pages')).toBeInTheDocument();
    expect(screen.getByText('PDF · with Chromium')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Q3 report.pdf' })).toBe(figure);
    // No actions while it's being made.
    expect(screen.queryByRole('button', { name: /download|details|look closer/i })).toBeNull();
    // The edge light, and every layer inside the one corner-cut clip.
    expect(container.querySelector('[class*="rim"]')).not.toBeNull();
    expect(container.querySelector('[class*="clip"] [class*="silhouette"]')).not.toBeNull();
    await expectAccessible(container);
  });

  it.each([
    ['Budget.xlsx', 'grid'],
    ['Regions.csv', 'grid'],
    ['Launch deck.pptx', 'slides'],
    ['Everything.zip', 'box'],
    ['Tip calculator.html', 'window'],
    ['split.ts', 'code'],
    ['Intro.mp3', 'wave'],
    ['Plan.md', 'page'],
  ])('%s takes the shape of a %s', (name, shape) => {
    const { container } = renderNacre(<FileMaking state="making" name={name} />);
    expect(container.querySelector('figure')).toHaveAttribute('data-shape', shape);
  });

  it('has no number when it can’t say, waits its turn, and never claims 100%', () => {
    const { rerender } = renderNacre(<FileMaking state="making" name="a.pdf" />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
    expect(screen.getByText('Making it…')).toBeInTheDocument();
    rerender(<FileMaking state="making" name="a.pdf" stage="queued" progress={0} />);
    expect(screen.getByText('Waiting its turn…')).toBeInTheDocument();
    rerender(<FileMaking state="making" name="a.pdf" doing="Converting" />);
    expect(screen.getByText('Converting…')).toBeInTheDocument();
    rerender(<FileMaking state="making" name="a.pdf" progress={1} stage="finishing" />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '99');
    rerender(<FileMaking state="making" name="a.pdf" waiting />);
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('rises out of the light when it becomes ready while watched, and says so', () => {
    vi.useFakeTimers();
    try {
      const { container, rerender } = renderNacre(
        <FileMaking state="making" name="Plan.md" progress={0.9} />,
      );
      rerender(<FileMaking state="ready" name="Plan.md" excerpt="# Plan" />);
      const figure = container.querySelector('figure');
      expect(figure).toHaveAttribute('data-develop');
      expect(screen.getByRole('status')).toHaveTextContent('Plan.md is ready');
      expect(container.querySelector('[class*="iris"]')).not.toBeNull();
      act(() => vi.advanceTimersByTime(1200));
      expect(figure).not.toHaveAttribute('data-develop');
      expect(container.querySelector('[class*="iris"]')).toBeNull();
      expect(container.querySelector('[class*="rim"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a file already there just shows: no reveal', () => {
    const { container } = renderNacre(<FileMaking state="ready" name="a.pdf" />);
    expect(container.querySelector('figure')).not.toHaveAttribute('data-develop');
    expect(container.querySelector('[class*="rim"]')).toBeNull();
    // With no picture of it, its drawn shape is its cover, still.
    expect(container.querySelector('[data-still]')).not.toBeNull();
  });

  it('is a card once ready: its facts, look closer, download, copy link, send, details', async () => {
    const onOpen = vi.fn();
    const onCopyLink = vi.fn();
    const onSend = vi.fn();
    const { container } = renderNacre(
      <FileMaking
        state="ready"
        name="Q3 report.pdf"
        size={248_000}
        pages={3}
        thumbnail={thumb}
        downloadHref="/api/attachments/a1?download=1"
        prompt="A summary of the quarter"
        details={[{ label: 'Made with', value: 'Chromium' }]}
        onOpen={onOpen}
        onCopyLink={onCopyLink}
        onSend={onSend}
        sendLabel="Send to Telegram"
      />,
    );
    fireEvent.load(container.querySelector('img') as HTMLImageElement);
    expect(screen.getByText('PDF · 3 pages · 242 KB')).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Q3 report.pdf' })).toHaveAccessibleDescription(
      'PDF\u00a0· 3 pages\u00a0· 242 KB',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Look closer at Q3 report.pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Look closer' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    const download = screen.getByRole('link', { name: 'Download Q3 report.pdf' });
    expect(download).toHaveAttribute('href', '/api/attachments/a1?download=1');
    expect(download).toHaveAttribute('download', 'Q3 report.pdf');
    await userEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(onCopyLink).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to Telegram' }));
    expect(onSend).toHaveBeenCalled();
    const info = screen.getByRole('button', { name: 'Details' });
    await userEvent.click(info);
    expect(info).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('A summary of the quarter')).toBeVisible();
    expect(screen.getByText('Chromium')).toBeVisible();
    await expectAccessible(container);
  });

  it('falls back to its first words, then its cover, when the picture is gone', () => {
    const { container } = renderNacre(
      <FileMaking
        state="ready"
        name="Plan.md"
        kind="text"
        thumbnail={thumb}
        excerpt="# Launch plan"
      />,
    );
    fireEvent.error(container.querySelector('img') as HTMLImageElement);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Launch plan')).toBeInTheDocument();
  });

  it('draws a web page as words, never running it', () => {
    const { container } = renderNacre(
      <FileMaking
        state="ready"
        name="tips.html"
        kind="text"
        excerpt="<title>Tips</title><h1>Split it</h1><script>window.bad = 1</script><img src=x onerror=alert(1)>"
      />,
    );
    expect(screen.getByText('Tips')).toBeInTheDocument();
    expect(screen.getByText('Split it')).toBeInTheDocument();
    expect(container.querySelector('script, iframe, img')).toBeNull();
    expect(container.textContent).not.toContain('window.bad');
  });

  it('draws a CSV as a small table', () => {
    renderNacre(
      <FileMaking state="ready" name="r.csv" kind="text" excerpt={'Region,Q1\nNorth,12'} />,
    );
    expect(screen.getByText('Region')).toBeInTheDocument();
    expect(screen.getByText('North')).toBeInTheDocument();
  });

  it.each([
    ['declined', undefined, 'Not made: you said no'],
    ['failed', 'Chromium closed.', 'Couldn’t make it: Chromium closed.'],
    ['stopped', undefined, 'Stopped before it was made'],
  ] as const)('not made (%s) is a calm line', async (state, reason, words) => {
    const { container } = renderNacre(
      <FileMaking state={state} name="a.pdf" reason={reason} prompt="A report" />,
    );
    expect(screen.getByText(words)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('button', { name: 'Details' })).toBeInTheDocument();
    await expectAccessible(container);
  });
});

describe('FileTile', () => {
  it('is the same file, small: one press to look closer, one to download', async () => {
    const onOpen = vi.fn();
    const { container } = renderNacre(
      <div role="list">
        <FileTile
          role="listitem"
          name="Budget.xlsx"
          size={18_400}
          sheets={3}
          onOpen={onOpen}
          downloadHref="/d"
        />
      </div>,
    );
    expect(container.querySelector('[data-type="sheet"]')).not.toBeNull();
    await userEvent.click(
      screen.getByRole('button', { name: 'Budget.xlsx, XLSX\u00a0· 3 sheets\u00a0· 18 KB' }),
    );
    expect(onOpen).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Download Budget.xlsx' })).toHaveAttribute(
      'href',
      '/d',
    );
    await expectAccessible(container);
  });
});

describe('fileKind', () => {
  it('knows a file by its name, then its type', () => {
    expect(fileTypeOf({ name: 'a.docx' })).toBe('doc');
    expect(fileTypeOf({ name: 'a.CSV', kind: 'text' })).toBe('csv');
    expect(fileTypeOf({ name: 'a.md' })).toBe('markdown');
    expect(fileTypeOf({ name: 'a.py' })).toBe('code');
    expect(fileTypeOf({ name: 'report', mimeType: 'application/pdf' })).toBe('pdf');
    expect(fileTypeOf({ name: 'blob', kind: 'file' })).toBe('file');
    expect(fileTypeOf({ name: 'x', kind: 'image' })).toBe('image');
    expect(badgeFor('a.markdown', 'markdown')).toBe('MD');
    expect(withExtension('Q3 report', 'pdf')).toBe('Q3 report.pdf');
    expect(withExtension('Q3 report.pdf', 'pdf')).toBe('Q3 report.pdf');
    expect(fileMeta({ badge: 'PDF', pages: 1, size: 2048 })).toBe('PDF\u00a0· 1 page\u00a0· 2 KB');
  });

  it('reads Markdown and HTML as plain words', () => {
    expect(markdownLines('# A\n\n- **b**\n[c](http://x)\n```\nx\n```')).toEqual([
      { kind: 'h1', text: 'A' },
      { kind: 'li', text: 'b' },
      { kind: 'p', text: 'c' },
      { kind: 'p', text: 'x' },
    ]);
    expect(htmlGist('<title>T</title><style>p{}</style><p>One &amp; two</p>')).toEqual({
      title: 'T',
      lines: ['One & two'],
    });
  });
});
