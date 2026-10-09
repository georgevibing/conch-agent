import {
  TelemetrySettings,
  type TelemetryPreview,
  type TelemetryStatus,
  type TelemetryUpdate,
} from '@conch/protocol';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockFetch, renderApp } from '../../test/harness';
import { DashboardsTab } from './DashboardsTab';

afterEach(() => vi.unstubAllGlobals());

const violations = async (container: HTMLElement) =>
  (await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })).violations;

function status(patch: TelemetryUpdate = {}, more: Partial<TelemetryStatus> = {}): TelemetryStatus {
  const base = TelemetrySettings.parse({});
  return {
    settings: {
      ...base,
      ...(patch.content !== undefined && { content: patch.content }),
      prometheus: { ...base.prometheus, ...patch.prometheus },
      otlp: {
        ...base.otlp,
        ...(patch.otlp as object),
        signals: { ...base.otlp.signals, ...patch.otlp?.signals },
      } as TelemetryStatus['settings']['otlp'],
    },
    key: { fields: [] },
    prometheus: { path: '/metrics', tokenSaved: false, scrapes: 0 },
    otlp: { targets: {}, sent: { metrics: 0, traces: 0, logs: 0 }, queued: 0, dropped: 0 },
    ...more,
  };
}

const preview: TelemetryPreview = {
  metrics: [
    {
      name: 'conch.turns',
      prometheus: 'conch_turns_total',
      kind: 'counter',
      unit: '{turn}',
      description: 'Replies the assistant finished.',
      series: 1,
      samples: [{ labels: { 'conch.provider': 'mock', 'conch.origin': 'chat' }, value: 2 }],
    },
  ],
  spans: [
    {
      name: 'invoke_agent Conch',
      kind: 'internal',
      depth: 0,
      startMs: 0,
      ms: 1200,
      attributes: {},
    },
    { name: 'chat mock', kind: 'client', depth: 1, startMs: 0, ms: 1200, attributes: {} },
  ],
};

describe('Settings → Dashboards', () => {
  it('reads a pasted Grafana Cloud setup into its endpoint and key, and saves them', async () => {
    let now = status({ otlp: { destination: 'grafana-cloud' } });
    const calls = mockFetch({
      'GET /api/access': () => ({ method: 'none' }),
      'GET /api/dashboards': () => now,
      'GET /api/dashboards/preview': () => preview,
      'PUT /api/dashboards': (body) => {
        const b = body as TelemetryUpdate;
        now = status(
          { otlp: { destination: 'grafana-cloud', ...b.otlp } },
          { key: { destination: 'grafana-cloud', fields: ['instance', 'token'], hint: '…ab12' } },
        );
        return now;
      },
    });
    const { container } = renderApp(<DashboardsTab />);
    expect(await screen.findByRole('radio', { name: /Grafana Cloud/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Send to Grafana Cloud/ })).toBeDisabled();
    const token = `glc_${'Q'.repeat(40)}ab12`;
    fireEvent.paste(document.body, {
      clipboardData: {
        getData: () =>
          `OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-eu-west-2.grafana.net/otlp"\nOTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20${btoa(`1234567:${token}`)}"`,
      },
    });
    const read = await screen.findByRole('list', { name: 'What Conch read' });
    expect(read).toHaveTextContent('otlp-gateway-prod-eu-west-2.grafana.net/otlp');
    expect(read).toHaveTextContent('1234567');
    expect(read).not.toHaveTextContent('QQQQ');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({
        otlp: {
          destination: 'grafana-cloud',
          endpoint: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
        },
        key: { instance: '1234567', token },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('switch', { name: /Send to Grafana Cloud/ })).toBeEnabled(),
    );
    expect(await violations(container)).toEqual([]);
  });

  it('sends a test once it’s on, and says what came back', async () => {
    const user = userEvent.setup();
    mockFetch({
      'GET /api/access': () => ({ method: 'none' }),
      'GET /api/dashboards': () =>
        status(
          { otlp: { on: true, destination: 'this-computer' } },
          {
            otlp: {
              targets: {},
              sent: { metrics: 3, traces: 2, logs: 0 },
              queued: 0,
              dropped: 0,
              lastSentAt: Date.now() - 30_000,
            },
          },
        ),
      'GET /api/dashboards/preview': () => preview,
      'POST /api/dashboards/test': () => ({
        ok: false,
        message:
          'The collector on this computer couldn’t be reached at localhost:4318. Check it’s running, then try again.',
        signals: [],
      }),
    });
    renderApp(<DashboardsTab />);
    expect(await screen.findByText(/Sent 30 s ago/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText(/couldn’t be reached at localhost:4318/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument();
  });

  it('turns on /metrics and shows a new scrape token once, with the config', async () => {
    const user = userEvent.setup();
    let now = status();
    mockFetch({
      'GET /api/access': () => ({ method: 'none' }),
      'GET /api/dashboards': () => now,
      'GET /api/dashboards/preview': () => preview,
      'PUT /api/dashboards': () => (now = status({ prometheus: { on: true } })),
      'GET /api/dashboards/scrape-config': () => ({
        config: 'scrape_configs:\n  - job_name: conch\n',
      }),
      'POST /api/dashboards/token': () => ({
        token: `conch_scrape_${'x'.repeat(43)}`,
        config: `scrape_configs:\n  - job_name: conch\n    authorization:\n      credentials: conch_scrape_${'x'.repeat(43)}\n`,
      }),
    });
    renderApp(<DashboardsTab />);
    await user.click(await screen.findByRole('switch', { name: 'Answer at /metrics' }));
    expect(await screen.findByText('Waiting for Prometheus to read it')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Make a scrape token' }));
    expect(
      await screen.findAllByText(new RegExp(`conch_scrape_${'x'.repeat(43)}`)),
    ).not.toHaveLength(0);
  });

  it('shows what leaves, and the last turn as a trace', async () => {
    mockFetch({
      'GET /api/access': () => ({ method: 'none' }),
      'GET /api/dashboards': () => status(),
      'GET /api/dashboards/preview': () => preview,
    });
    renderApp(<DashboardsTab />);
    expect(await screen.findByText('conch.turns')).toBeInTheDocument();
    expect(screen.getByText(/Never what anyone wrote/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /invoke_agent Conch/ })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('radio', { name: 'Prometheus' }));
    expect(screen.getByText('conch_turns_total')).toBeInTheDocument();
  });
});
