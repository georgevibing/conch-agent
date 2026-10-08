import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import { ChartCard } from './ChartCard';
import {
  eightSeries,
  longTail,
  monthlySignups,
  quarterlyRevenue,
  spendByCategory,
  teamLoad,
  withGaps,
} from './fixtures';

describe('ChartCard', () => {
  it('is one region with the whole picture in a sentence, and passes axe', async () => {
    const { container } = renderNacre(<ChartCard chart={quarterlyRevenue} locale="en-GB" />);
    const card = screen.getByRole('region', { name: 'Chart: Revenue by quarter' });
    expect(card).toHaveTextContent('3 series over 4 points.');
    expect(card).toHaveTextContent('Europe: €4.2 at Q1 to €7.4 at Q4; lowest €4.2, highest €7.4.');
    await expectAccessible(container);
  });

  it('passes axe as a pie, with the numbers open', async () => {
    const { container } = renderNacre(
      <ChartCard chart={spendByCategory} locale="en-GB" defaultNumbers />,
    );
    await expectAccessible(container);
  });

  it('names every series in the legend with its last value', () => {
    renderNacre(<ChartCard chart={monthlySignups} locale="en-GB" />);
    expect(screen.getByRole('button', { name: /Free/ })).toHaveTextContent('1,180');
    expect(screen.getByRole('button', { name: /Paid/ })).toHaveTextContent('402');
  });

  it('takes a series out of the picture on a press, and never the last one', async () => {
    const user = userEvent.setup();
    renderNacre(<ChartCard chart={monthlySignups} locale="en-GB" />);
    const free = screen.getByRole('button', { name: /Free/ });
    const paid = screen.getByRole('button', { name: /Paid/ });
    expect(free).toHaveAttribute('aria-pressed', 'true');
    await user.click(free);
    expect(free).toHaveAttribute('aria-pressed', 'false');
    // Its value leaves the read-out with it.
    expect(screen.getByRole('slider')).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('Paid'),
    );
    expect(screen.getByRole('slider').getAttribute('aria-valuetext')).not.toContain('Free');
    // One has to stay: an empty chart says nothing.
    await user.click(paid);
    expect(paid).toHaveAttribute('aria-pressed', 'true');
  });

  it('reads the chart with the arrow keys, Home and End, and clears on Escape', async () => {
    const user = userEvent.setup();
    renderNacre(<ChartCard chart={quarterlyRevenue} locale="en-GB" />);
    const reader = screen.getByRole('slider', { name: 'Read the chart' });
    expect(reader).toHaveAttribute('aria-valuemax', '3');
    reader.focus();
    // Nothing is on yet, so the first press reads the first point.
    await user.keyboard('{ArrowRight}');
    expect(reader).toHaveAttribute('aria-valuenow', '0');
    await user.keyboard('{ArrowRight}');
    expect(reader).toHaveAttribute('aria-valuenow', '1');
    expect(reader).toHaveAttribute('aria-valuetext', 'Q2: Europe €5.1, Americas €3.4, Asia €2.6.');
    await user.keyboard('{End}');
    expect(reader).toHaveAttribute('aria-valuenow', '3');
    await user.keyboard('{Home}');
    expect(reader).toHaveAttribute('aria-valuenow', '0');
    // Enter picks that point out, Escape lets it go.
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(reader).toHaveAttribute('aria-valuenow', '0');
  });

  it('says a gap is a gap, never a zero', () => {
    renderNacre(<ChartCard chart={withGaps} locale="en-GB" />);
    const reader = screen.getByRole('slider');
    reader.focus();
    expect(screen.getByRole('region', { name: /Sensor readings/ })).toHaveTextContent(
      '3 with no reading',
    );
  });

  it('reads a pie as parts of a total, and picks a slice out on a press', async () => {
    const user = userEvent.setup();
    renderNacre(<ChartCard chart={spendByCategory} locale="en-GB" />);
    const reader = screen.getByRole('slider', { name: 'Read each part' });
    expect(reader).toHaveAttribute('aria-valuetext', 'Rent: $1,450, 54% of $2,661.');
    const rent = screen.getByRole('button', { name: /Rent/ });
    expect(rent).toHaveAttribute('aria-pressed', 'false');
    await user.click(rent);
    expect(rent).toHaveAttribute('aria-pressed', 'true');
    await user.click(rent);
    expect(rent).toHaveAttribute('aria-pressed', 'false');
  });

  it('gathers a long tail into “Others” and says so in words', () => {
    renderNacre(<ChartCard chart={longTail} locale="en-GB" />);
    expect(screen.getByRole('button', { name: /Others/ })).toBeInTheDocument();
    expect(screen.getByText(/The 7 smallest are together as “Others”/)).toBeInTheDocument();
  });

  it('opens the same numbers as a real table', async () => {
    const user = userEvent.setup();
    renderNacre(<ChartCard chart={quarterlyRevenue} locale="en-GB" />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Show the numbers/ }));
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Q4' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(table).toHaveTextContent('€7.4');
    await user.click(screen.getByRole('button', { name: /Hide the numbers/ }));
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('labels the table’s first column by what the labels turned out to be', async () => {
    const user = userEvent.setup();
    renderNacre(<ChartCard chart={monthlySignups} locale="en-GB" />);
    await user.click(screen.getByRole('button', { name: /Show the numbers/ }));
    expect(screen.getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'October 2025' })).toBeInTheDocument();
  });

  it('draws eight series without inventing a ninth colour', () => {
    renderNacre(<ChartCard chart={eightSeries} locale="en-GB" />);
    const legend = screen.getAllByRole('button').filter((b) => b.getAttribute('aria-pressed'));
    expect(legend).toHaveLength(8);
  });

  it('says so plainly when there is nothing to draw', () => {
    renderNacre(
      <ChartCard
        chart={{
          type: 'column',
          title: 'Orders a day',
          labels: ['Mon', 'Tue'],
          series: [{ name: 'Orders', values: [null, null] }],
        }}
      />,
    );
    expect(screen.getByText(/Nothing to draw/)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('hands the share bar the card root and the plot it rasterises', () => {
    const card = createRef<HTMLElement>();
    const svg = createRef<SVGSVGElement>();
    renderNacre(
      <ChartCard
        ref={card}
        svgRef={svg}
        chart={teamLoad}
        locale="en-GB"
        actions={<button type="button">Save as image</button>}
      />,
    );
    expect(card.current).toHaveAttribute('data-nacre-card', 'chart');
    expect(svg.current).toHaveAttribute('data-nacre-chart-svg');
    expect(card.current?.querySelector('[data-nacre-chart-svg]')).toBe(svg.current);
    // The plot stands alone: its own background, and colours on the marks.
    expect(svg.current?.querySelector('rect')).toHaveStyle({ fill: 'var(--ch-surface)' });
    expect(screen.getByRole('button', { name: 'Save as image' })).toBeInTheDocument();
  });

  it('shows no legend for one series: the title already names it', () => {
    renderNacre(<ChartCard chart={teamLoad} locale="en-GB" />);
    expect(screen.queryByRole('button', { name: /^Open$/ })).not.toBeInTheDocument();
  });
});
