import {
  ScrapeTokenResult,
  TelemetryPreview,
  TelemetryStatus,
  TelemetryTestResult,
  type TelemetryUpdate,
} from '@conch/protocol';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { request } from '../../api/client';

/** Settings → Dashboards (ADR 0121): where Conch's numbers go, and who reads them. */
export const dashboardsApi = {
  status: () => request(TelemetryStatus, '/api/dashboards'),
  update: (body: TelemetryUpdate) =>
    request(TelemetryStatus, '/api/dashboards', { method: 'PUT', body }),
  preview: () => request(TelemetryPreview, '/api/dashboards/preview'),
  test: () => request(TelemetryTestResult, '/api/dashboards/test', { method: 'POST', body: {} }),
  token: () => request(ScrapeTokenResult, '/api/dashboards/token', { method: 'POST', body: {} }),
  scrapeConfig: () => request(z.object({ config: z.string() }), '/api/dashboards/scrape-config'),
  grafana: async () => {
    const res = await fetch('/api/dashboards/grafana', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Conch couldn’t make the dashboard just now.');
    return res.text();
  },
};

export const dashboardsKeys = {
  status: ['dashboards'] as const,
  preview: ['dashboards', 'preview'] as const,
};

/** Where things stand; asked again every few seconds, so “read 12 s ago” stays true. */
export function useDashboards() {
  return useQuery({
    queryKey: dashboardsKeys.status,
    queryFn: dashboardsApi.status,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
}

/** Exactly what would leave now. */
export function useDashboardPreview() {
  return useQuery({
    queryKey: dashboardsKeys.preview,
    queryFn: dashboardsApi.preview,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
}
