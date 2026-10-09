import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expectAccessible, renderNacre } from '../../test/render';
import {
  DashboardPicker,
  GrafanaCard,
  MetricPreview,
  PasteWell,
  ScrapeBeat,
  SendTest,
  TurnWaterfall,
} from './Dashboards';
import { metrics, spans, tiles } from './fixtures';

describe('DashboardPicker', () => {
  it('is one choice among the services, by their names, with arrow keys', async () => {
    const user = userEvent.setup();
    function Picker() {
      const [value, setValue] = useState('grafana-cloud');
      return (
        <DashboardPicker
          destinations={tiles}
          value={value}
          onValueChange={setValue}
          live="grafana-cloud"
        />
      );
    }
    const { container } = renderNacre(<Picker />);
    const group = screen.getByRole('radiogroup', { name: 'Where to send' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(tiles.length);
    expect(screen.getByRole('radio', { name: /Grafana Cloud/ })).toBeChecked();
    expect(screen.getByRole('img', { name: 'Sending now' })).toBeInTheDocument();
    screen.getByRole('radio', { name: /Grafana Cloud/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: /Honeycomb/ })).toHaveFocus();
    await user.click(screen.getByRole('radio', { name: /Langfuse/ }));
    expect(screen.getByRole('radio', { name: /Langfuse/ })).toBeChecked();
    await expectAccessible(container);
  });
});

describe('PasteWell', () => {
  it('takes a paste anywhere on the page, but not into another field', async () => {
    const onPaste = vi.fn();
    renderNacre(
      <>
        <input aria-label="Elsewhere" />
        <PasteWell label="Paste what Grafana Cloud shows you" onPaste={onPaste} />
      </>,
    );
    fireEvent.paste(document.body, {
      clipboardData: { getData: () => 'OTEL_EXPORTER_OTLP_ENDPOINT=x' },
    });
    expect(onPaste).toHaveBeenCalledWith('OTEL_EXPORTER_OTLP_ENDPOINT=x');
    fireEvent.paste(screen.getByRole('textbox', { name: 'Elsewhere' }), {
      clipboardData: { getData: () => 'typed somewhere else' },
    });
    expect(onPaste).toHaveBeenCalledTimes(1);
  });

  it('shows what it read, a key only by its start and last four', async () => {
    const { container } = renderNacre(
      <PasteWell
        label="Paste what Grafana Cloud shows you"
        onPaste={() => undefined}
        found={[
          { label: 'Instance', value: '1234567' },
          { label: 'Token', value: 'glc_abcdefghijklmnop9xz2', secret: true },
        ]}
      />,
    );
    const read = screen.getByRole('list', { name: 'What Conch read' });
    expect(read).toHaveTextContent('1234567');
    expect(read).toHaveTextContent('glc_••••9xz2');
    expect(read).not.toHaveTextContent('abcdefghijklmnop');
    await expectAccessible(container);
  });

  it('folds typing each field away until asked', async () => {
    const user = userEvent.setup();
    renderNacre(
      <PasteWell label="Paste" onPaste={() => undefined}>
        <input aria-label="Token" />
      </PasteWell>,
    );
    expect(screen.queryByRole('textbox', { name: 'Token' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Type them instead' }));
    expect(screen.getByRole('textbox', { name: 'Token' })).toBeInTheDocument();
  });

  it('says a problem out loud', () => {
    renderNacre(
      <PasteWell label="Paste" onPaste={() => undefined} problem="That didn’t read as a key." />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('That didn’t read as a key.');
  });
});

describe('SendTest', () => {
  const grafana = { name: 'Grafana Cloud', brand: 'grafana', color: '#F46800' };

  it('says what a test does, then what came back, and how fast', async () => {
    const user = userEvent.setup();
    const onTest = vi.fn();
    const { rerender, container } = renderNacre(
      <SendTest destination={grafana} state="idle" onTest={onTest} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sends one span and Conch’s numbers to Grafana Cloud now.',
    );
    await user.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(onTest).toHaveBeenCalled();
    rerender(
      <SendTest
        destination={grafana}
        state="received"
        message="Grafana Cloud received it."
        ms={182}
        onTest={onTest}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Grafana Cloud received it. · 182 ms');
    expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled();
    await expectAccessible(container);
  });

  it('is busy while it sends, and says exactly why when it didn’t arrive', async () => {
    const { rerender, container } = renderNacre(
      <SendTest destination={grafana} state="sending" onTest={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: /Send a test/ })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    rerender(
      <SendTest
        destination={grafana}
        state="failed"
        message="Grafana Cloud didn’t take the key. Paste it again, or make a new one."
        onTest={() => undefined}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('didn’t take the key');
    await expectAccessible(container);
  });
});

describe('MetricPreview', () => {
  it('opens with what never leaves, then each metric with a few of its series', async () => {
    const { container } = renderNacre(<MetricPreview metrics={metrics} initial={3} />);
    expect(screen.getByText(/Never what anyone wrote/)).toBeInTheDocument();
    expect(screen.getByText('conch.turns')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Some of conch.turns' })).toHaveTextContent(
      'claude-sonnet-4-5',
    );
    expect(screen.queryByText('conch.routine.runs')).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: `Show all ${metrics.length}` }));
    expect(screen.getByText('conch.routine.runs')).toBeInTheDocument();
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('names them as Prometheus does, when asked', () => {
    renderNacre(<MetricPreview metrics={metrics} naming="prometheus" />);
    expect(screen.getByText('conch_turns_total')).toBeInTheDocument();
    expect(screen.queryByText('conch.turns')).toBeNull();
  });
});

describe('TurnWaterfall', () => {
  it('draws the turn as rows that open to their attributes', async () => {
    const user = userEvent.setup();
    const { container } = renderNacre(<TurnWaterfall spans={spans} />);
    const rows = screen.getAllByRole('button');
    expect(rows).toHaveLength(spans.length);
    expect(rows[0]).toHaveTextContent('invoke_agent Juniper');
    expect(rows[0]).toHaveTextContent('8.4 s');
    await user.click(rows[2] as HTMLElement);
    expect(rows[2]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('gen_ai.tool.name')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('draws nothing for no turn', () => {
    const { container } = renderNacre(<TurnWaterfall spans={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });
});

describe('ScrapeBeat and GrafanaCard', () => {
  it('says whether Prometheus has read it, and when', async () => {
    const { rerender, container } = renderNacre(<ScrapeBeat now={10_000} />);
    expect(screen.getByText('Waiting for Prometheus to read it')).toBeInTheDocument();
    rerender(<ScrapeBeat lastAt={10_000 - 12_000} now={10_000} />);
    expect(screen.getByText('Prometheus read it 12 s ago')).toBeInTheDocument();
    await expectAccessible(container);
  });

  it('offers the dashboard to copy and to download', async () => {
    const onCopy = vi.fn();
    const { container } = renderNacre(
      <GrafanaCard onCopy={onCopy} href="/api/dashboards/grafana" />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy dashboard' }));
    expect(onCopy).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      '/api/dashboards/grafana',
    );
    await expectAccessible(container);
  });
});
