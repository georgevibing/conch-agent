import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ArtifactCard } from './ArtifactCard';
import { ArtifactChart, niceTicks } from './ArtifactChart';
import { ArtifactPanel } from './ArtifactPanel';
import { ArtifactTable } from './ArtifactTable';
import { lineDiff } from './lineDiff';
import { SealedFrame } from './SealedFrame';

const visitors = {
  type: 'bar' as const,
  title: 'Visitors this week',
  labels: ['Mon', 'Tue', 'Wed'],
  series: [
    { name: 'This week', values: [120, 180, 90] },
    { name: 'Last week', values: [100, 150, null] },
  ],
};

describe('ArtifactChart', () => {
  it('draws, names its series, and shows the same numbers as a table', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<ArtifactChart chart={visitors} />);
    expect(
      screen.getByRole('img', {
        name: /Visitors this week: bar chart of This week, Last week across 3 points/,
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Legend' })).getAllByRole('listitem'),
    ).toHaveLength(2);
    expect(container.querySelectorAll('path[class*="bar"]')).toHaveLength(6);
    await expectAccessible(container);

    await user.click(screen.getByRole('radio', { name: 'Table' }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'This week' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: /Wed 90 —/ })).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('a single series needs no legend; a hovered bar tells its numbers', () => {
    const { container } = renderNacre(
      <ArtifactChart
        chart={{
          type: 'bar',
          labels: ['a', 'b'],
          series: [{ name: 'Sales', values: [3, 4] }],
          unit: '€',
        }}
      />,
    );
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    const bar = container.querySelector('path[class*="bar"]');
    if (!bar) throw new Error('no bar');
    fireEvent.mouseMove(bar);
    expect(screen.getByRole('status')).toHaveTextContent('aSales€3');
  });

  it('picks clean ticks', () => {
    expect(niceTicks(180)).toEqual([0, 50, 100, 150, 200]);
    expect(niceTicks(9)).toEqual([0, 2.5, 5, 7.5, 10]);
    expect(niceTicks(10, -5)[0]).toBeLessThanOrEqual(-5);
  });
});

describe('ArtifactTable', () => {
  it('sorts by any column, numbers as numbers', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(
      <ArtifactTable label="Budget" csv={'Item,Cost\nRent,"1,200"\nFood,300\nFun,45'} />,
    );
    const cost = screen.getByRole('button', { name: 'Cost' });
    await user.click(cost);
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    const firstCells = () =>
      screen
        .getAllByRole('row')
        .slice(1)
        .map((r) => r.textContent);
    expect(firstCells()).toEqual(['Fun45', 'Food300', 'Rent1,200']);
    await user.click(cost);
    expect(firstCells()[0]).toBe('Rent1,200');
    await user.click(cost);
    expect(screen.getByRole('columnheader', { name: 'Cost' })).toHaveAttribute('aria-sort', 'none');
    await expectAccessible(container);
  });
});

describe('lineDiff', () => {
  it('finds the changed lines, with context, in hunks', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = ['a', 'b', 'c', 'D', 'e', 'f', 'g', 'h', 'i', 'j', 'k'].join('\n');
    const lines = lineDiff(before, after, 1);
    expect(lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'hunk:Line 3',
      'context:c',
      'del:d',
      'add:D',
      'context:e',
      'hunk:Line 10',
      'context:j',
      'add:k',
    ]);
    expect(lines.find((l) => l.kind === 'add' && l.text === 'k')).toMatchObject({ newNumber: 11 });
    expect(lineDiff('same', 'same')).toEqual([]);
  });
});

describe('SealedFrame', () => {
  it('is sandboxed to scripts only, and believes a height only from its own frame', () => {
    renderNacre(<SealedFrame src="/api/artifacts/a_1/versions/1/frame" title="Tip calculator" />);
    const frame = screen.getByTitle('Tip calculator') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { conch: 'artifact', height: 900 } }),
      );
    });
    expect(frame.style.blockSize).toBe('320px');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { conch: 'artifact', height: 900 },
          source: frame.contentWindow,
        }),
      );
    });
    expect(frame.style.blockSize).toBe('900px');
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { conch: 'artifact', height: 1e9 },
          source: frame.contentWindow,
        }),
      );
    });
    expect(frame.style.blockSize).toBe('4000px');
  });

  it('passes on a link to open only from its own frame, and only http(s)', () => {
    const onOpenLink = vi.fn();
    renderNacre(<SealedFrame src="/frame" title="Links" onOpenLink={onOpenLink} />);
    const frame = screen.getByTitle('Links') as HTMLIFrameElement;
    const send = (data: unknown, source: MessageEventSource | null = frame.contentWindow) =>
      act(() => {
        window.dispatchEvent(new MessageEvent('message', { data, source }));
      });
    send({ conch: 'artifact', open: 'https://example.com/a' }, null);
    send({ conch: 'artifact', open: 'javascript:alert(1)' });
    send({ conch: 'artifact', open: 'data:text/html,<script>1</script>' });
    send({ conch: 'artifact', open: `https://example.com/${'x'.repeat(3000)}` });
    expect(onOpenLink).not.toHaveBeenCalled();
    send({ conch: 'artifact', open: 'https://example.com/a' });
    expect(onOpenLink).toHaveBeenCalledWith('https://example.com/a');
  });

  it('keeps the code off a page that could send you away, until you say so', async () => {
    const user = userEvent.setup();
    const allow = vi.fn();
    const { container } = renderNacre(
      <SealedFrame
        src="/api/artifacts/a_1/versions/1/frame"
        title="Links"
        navigates
        onAllowScripts={allow}
      />,
    );
    const frame = screen.getByTitle('Links');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('src')).toContain('scripts=0');
    await user.click(screen.getByRole('button', { name: 'Run it anyway' }));
    expect(allow).toHaveBeenCalled();
    // axe can't look inside a frame under jsdom; the Storybook sweep covers it.
    expect(container.querySelector('iframe')).not.toBeNull();
  });

  it('stops a page that navigates after it loaded', () => {
    renderNacre(<SealedFrame src="/frame" title="Sneaky" />);
    const frame = screen.getByTitle('Sneaky');
    fireEvent.load(frame);
    fireEvent.load(frame);
    expect(screen.queryByTitle('Sneaky')).toBeNull();
    expect(screen.getByText('Conch stopped this page')).toBeInTheDocument();
  });
});

describe('ArtifactCard and ArtifactPanel', () => {
  it('a card says what it is and opens it', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = renderNacre(
      <ArtifactCard
        title="Budget"
        kind="table"
        version={2}
        action="updated"
        note="Added a total"
        onClick={onClick}
      />,
    );
    const card = screen.getByRole('button', {
      name: /Budget.*Table · version 2 · Added a total.*Open/,
    });
    await user.click(card);
    expect(onClick).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('a card can show a small preview that can’t be reached, and still opens as one button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { container } = renderNacre(
      <ArtifactCard
        title="Budget"
        kind="table"
        version={1}
        onClick={onClick}
        preview={<ArtifactTable csv={'Item,Cost\nRent,1200\nFood,400'} label="Budget" compact />}
      />,
    );
    const card = screen.getByRole('button', { name: /Budget.*Table · made for you.*Open/ });
    expect(card).toHaveAttribute('data-preview');
    // Seen, not used: no sort buttons, nothing in the tab order but the card.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('[inert]')).toHaveTextContent('Rent');
    await user.tab();
    expect(card).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalled();
    await expectAccessible(container);
  });

  it('shows the thing, its code and its changes; pins, goes full screen and closes', async () => {
    const user = userEvent.setup();
    const onPinned = vi.fn();
    const onClose = vi.fn();
    const onVersion = vi.fn();
    const { container } = renderNacre(
      <ArtifactPanel
        title="Trip plan"
        kind="markdown"
        versions={[
          { n: 1, when: '9:40 AM' },
          { n: 2, when: '9:41 AM', note: 'Added day two' },
        ]}
        version={2}
        onVersionChange={onVersion}
        preview={<p>The plan</p>}
        source={'# Plan\nDay one\nDay two'}
        previous={'# Plan\nDay one'}
        downloadHref="/download"
        onPinnedChange={onPinned}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('region', { name: 'Trip plan' })).toBeInTheDocument();
    expect(screen.getByText('The plan')).toBeInTheDocument();
    expect(screen.getByText('Added day two')).toBeInTheDocument();
    await expectAccessible(container);

    await user.click(screen.getByRole('tab', { name: 'Changes' }));
    expect(screen.getByText('Day two')).toBeInTheDocument();
    expect(screen.getAllByText('added')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Pin as an app' }));
    expect(onPinned).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole('button', { name: 'Full screen' }));
    expect(screen.getByRole('region', { name: 'Trip plan' })).toHaveAttribute('data-expanded');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('region', { name: 'Trip plan' })).not.toHaveAttribute('data-expanded');

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('the first version has no changes to show', () => {
    renderNacre(
      <ArtifactPanel
        title="One"
        kind="chart"
        versions={[{ n: 1, when: 'now' }]}
        version={1}
        preview={null}
        source="{}"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Changes' })).toBeDisabled();
    expect(screen.queryByRole('combobox', { name: 'Version' })).toBeNull();
  });
});
