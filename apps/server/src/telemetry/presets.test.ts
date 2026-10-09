import {
  DASHBOARD_DESTINATIONS,
  fromBase64,
  readDashboardPaste,
  TelemetrySettings,
  toBase64,
  type TelemetrySettings as Settings,
} from '@conch/protocol';
import { describe, expect, it } from 'vitest';

import { targetOf, TargetProblem } from './presets';

const otlp = (patch: Partial<Settings['otlp']>): Settings['otlp'] => ({
  ...TelemetrySettings.parse({}).otlp,
  on: true,
  ...patch,
});

describe('each destination’s endpoints and key', () => {
  it('Grafana Cloud: the stack’s gateway, Basic of instance and token', () => {
    const t = targetOf(
      otlp({
        destination: 'grafana-cloud',
        endpoint: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp/',
      }),
      { instance: '123', token: 'glc_abc' },
    );
    expect(t.urls).toEqual({
      metrics: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/metrics',
      traces: 'https://otlp-gateway-prod-us-east-0.grafana.net/otlp/v1/traces',
    });
    expect(t.headers.traces?.authorization).toBe(
      `Basic ${Buffer.from('123:glc_abc').toString('base64')}`,
    );
    expect(t.temporality).toBe(2);
  });

  it('Honeycomb: the region’s host, the team key, and a dataset for metrics', () => {
    const t = targetOf(otlp({ destination: 'honeycomb', region: 'eu' }), { key: 'hcaik_1' });
    expect(t.urls.traces).toBe('https://api.eu1.honeycomb.io/v1/traces');
    expect(t.headers.traces).toEqual({ 'x-honeycomb-team': 'hcaik_1' });
    expect(t.headers.metrics).toEqual({
      'x-honeycomb-team': 'hcaik_1',
      'x-honeycomb-dataset': 'conch-metrics',
    });
  });

  it('Datadog: the site’s intake, dd-api-key, and differences', () => {
    const t = targetOf(otlp({ destination: 'datadog', region: 'us5.datadoghq.com' }), { key: 'k' });
    expect(t.urls.metrics).toBe('https://otlp.us5.datadoghq.com/v1/metrics');
    expect(t.headers.metrics).toEqual({ 'dd-api-key': 'k' });
    expect(t.temporality).toBe(1);
    // A region that isn't one is the default site, never an address someone typed.
    expect(
      targetOf(otlp({ destination: 'datadog', region: 'evil.example' }), { key: 'k' }).urls.traces,
    ).toBe('https://otlp.datadoghq.com/v1/traces');
  });

  it('New Relic: the region’s host and api-key', () => {
    const t = targetOf(otlp({ destination: 'new-relic', region: 'eu' }), { key: 'k' });
    expect(t.urls.logs).toBeUndefined();
    expect(
      targetOf(
        otlp({ destination: 'new-relic', signals: { metrics: true, traces: true, logs: true } }),
        { key: 'k' },
      ).urls.logs,
    ).toBe('https://otlp.nr-data.net/v1/logs');
    expect(t.headers.traces).toEqual({ 'api-key': 'k' });
    expect(t.temporality).toBe(1);
  });

  it('Langfuse: traces only, at its own path, with both keys', () => {
    const t = targetOf(otlp({ destination: 'langfuse', region: 'us' }), {
      public: 'pk-lf-1',
      secret: 'sk-lf-2',
    });
    expect(t.urls).toEqual({ traces: 'https://us.cloud.langfuse.com/api/public/otel/v1/traces' });
    expect(t.headers.traces).toEqual({
      authorization: `Basic ${Buffer.from('pk-lf-1:sk-lf-2').toString('base64')}`,
      'x-langfuse-ingestion-version': '4',
    });
    expect(t.flavour).toBe('langfuse');
    expect(
      targetOf(
        otlp({ destination: 'langfuse', endpoint: 'https://lf.example.com/api/public/otel' }),
        { public: 'a', secret: 'b' },
      ).urls.traces,
    ).toBe('https://lf.example.com/api/public/otel/v1/traces');
  });

  it('Phoenix: traces only, protobuf whatever was chosen, a Bearer key when given', () => {
    const local = targetOf(otlp({ destination: 'phoenix', encoding: 'json' }), {});
    expect(local).toMatchObject({
      urls: { traces: 'http://localhost:6006/v1/traces' },
      encoding: 'protobuf',
      headers: { traces: {} },
    });
    const cloud = targetOf(
      otlp({ destination: 'phoenix', endpoint: 'https://app.phoenix.arize.com/s/ada' }),
      { key: 'px' },
    );
    expect(cloud.urls.traces).toBe('https://app.phoenix.arize.com/s/ada/v1/traces');
    expect(cloud.headers.traces).toEqual({ authorization: 'Bearer px' });
  });

  it('this computer and anywhere else: the endpoint plus /v1/<signal>', () => {
    expect(targetOf(otlp({ destination: 'this-computer' }), {}).urls.metrics).toBe(
      'http://localhost:4318/v1/metrics',
    );
    const t = targetOf(
      otlp({ destination: 'custom', endpoint: 'https://otel.example.com/v1/traces' }),
      {
        headers: 'authorization=Bearer%20abc,x-team=ops',
      },
    );
    expect(t.urls.traces).toBe('https://otel.example.com/v1/traces');
    expect(t.headers.metrics).toEqual({ authorization: 'Bearer abc', 'x-team': 'ops' });
  });

  it('says what’s missing in a sentence, and never sends a key in the clear', () => {
    const problem = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error instanceof TargetProblem
          ? { message: error.message, field: error.field }
          : error;
      }
      return undefined;
    };
    expect(problem(() => targetOf(otlp({ destination: 'honeycomb' }), {}))).toEqual({
      message: 'Paste a Honeycomb ingest key.',
      field: 'key',
    });
    expect(problem(() => targetOf(otlp({ destination: 'custom' }), {}))).toMatchObject({
      field: 'endpoint',
    });
    expect(
      problem(() =>
        targetOf(otlp({ destination: 'custom', endpoint: 'http://collector.example.com' }), {}),
      ),
    ).toEqual({
      message:
        'Use an https:// address. Over plain http, what Conch sends could be read on the way.',
      field: 'endpoint',
    });
    expect(
      problem(() =>
        targetOf(
          otlp({ destination: 'custom', endpoint: 'https://user:pw@collector.example.com' }),
          {},
        ),
      ),
    ).toMatchObject({
      field: 'endpoint',
    });
    // Your own network is fine over http: a collector on the next machine.
    expect(
      targetOf(otlp({ destination: 'custom', endpoint: 'http://192.168.1.20:4318' }), {}).urls
        .traces,
    ).toBe('http://192.168.1.20:4318/v1/traces');
  });

  it('sends only what each destination takes, and only what’s turned on', () => {
    for (const d of DASHBOARD_DESTINATIONS) {
      const fields = Object.fromEntries(d.fields.map((f) => [f.id, 'x'.repeat(12)]));
      const t = targetOf(
        otlp({
          destination: d.id,
          endpoint: d.endpoint ? 'https://example.com/otlp' : undefined,
          signals: { metrics: true, traces: true, logs: true },
        }),
        fields,
      );
      expect(Object.keys(t.urls).sort(), d.id).toEqual([...d.signals].sort());
    }
    expect(
      Object.keys(
        targetOf(
          otlp({
            destination: 'this-computer',
            signals: { metrics: false, traces: true, logs: false },
          }),
          {},
        ).urls,
      ),
    ).toEqual(['traces']);
  });
});

describe('reading what was pasted', () => {
  it('reads Grafana Cloud’s OpenTelemetry lines into the endpoint, instance and token', () => {
    const token = `glc_${'Z'.repeat(40)}`;
    const paste = `export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://otlp-gateway-prod-eu-west-2.grafana.net/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic%20${toBase64(`1234567:${token}`)}"`;
    expect(readDashboardPaste(paste)).toEqual({
      destination: 'grafana-cloud',
      endpoint: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
      fields: { instance: '1234567', token },
    });
  });

  it('reads Langfuse’s two keys and its region, from an .env', () => {
    expect(
      readDashboardPaste(
        'LANGFUSE_SECRET_KEY="sk-lf-aaaa-bbbb-cccc"\nLANGFUSE_PUBLIC_KEY="pk-lf-1111-2222"\nLANGFUSE_HOST="https://us.cloud.langfuse.com"',
      ),
    ).toEqual({
      destination: 'langfuse',
      region: 'us',
      fields: { public: 'pk-lf-1111-2222', secret: 'sk-lf-aaaa-bbbb-cccc' },
    });
  });

  it('knows Honeycomb, New Relic and Datadog by their hosts or keys', () => {
    expect(
      readDashboardPaste(
        'OTEL_EXPORTER_OTLP_ENDPOINT=https://api.eu1.honeycomb.io\nOTEL_EXPORTER_OTLP_HEADERS=x-honeycomb-team=hcaik_01abc',
      ),
    ).toEqual({ destination: 'honeycomb', region: 'eu', fields: { key: 'hcaik_01abc' } });
    const nr = `${'a'.repeat(36)}NRAL`;
    expect(readDashboardPaste(nr)).toEqual({
      destination: 'new-relic',
      region: 'us',
      fields: { key: nr },
    });
    expect(readDashboardPaste('DD_API_KEY=0123\nDD_SITE=datadoghq.eu')).toEqual({
      destination: 'datadog',
      region: 'datadoghq.eu',
      fields: { key: '0123' },
    });
  });

  it('puts a bare key in the chosen destination’s field, and reads a local address', () => {
    expect(readDashboardPaste('hcaik_0123456789', 'honeycomb')).toEqual({
      destination: 'honeycomb',
      fields: { key: 'hcaik_0123456789' },
    });
    expect(readDashboardPaste('abcdefgh12345678', 'datadog')).toEqual({
      destination: 'datadog',
      fields: { key: 'abcdefgh12345678' },
    });
    expect(readDashboardPaste('http://localhost:4318')).toEqual({
      destination: 'this-computer',
      endpoint: 'http://localhost:4318',
      fields: {},
    });
    expect(readDashboardPaste('http://localhost:6006', 'phoenix')).toEqual({
      destination: 'phoenix',
      endpoint: 'http://localhost:6006',
      fields: {},
    });
  });

  it('round-trips base64 through text with any letters', () => {
    for (const text of ['1234:glc_x', 'pk-lf:sk-lf', 'ünïcödé:✓'])
      expect(fromBase64(toBase64(text))).toBe(text);
    expect(toBase64('123:glc_abc')).toBe(Buffer.from('123:glc_abc').toString('base64'));
  });
});
