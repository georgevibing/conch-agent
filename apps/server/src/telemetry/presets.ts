/**
 * Where each destination's endpoints are and how it wants its key (ADR 0121),
 * from each service's own OTLP documentation:
 *
 * - Grafana Cloud: the stack's `…grafana.net/otlp`, `Authorization: Basic`
 *   of instance ID and token (grafana.com/docs/grafana-cloud/send-data/otlp).
 * - Honeycomb: `api.honeycomb.io` or `api.eu1.honeycomb.io`, `x-honeycomb-team`;
 *   metrics go to a dataset named by `x-honeycomb-dataset` (docs.honeycomb.io).
 * - Datadog: agentless intake at `otlp.<site>`, `dd-api-key`; its metrics
 *   intake takes delta temporality only (docs.datadoghq.com/opentelemetry).
 * - New Relic: `otlp.nr-data.net` or `otlp.eu01.nr-data.net`, `api-key`, delta
 *   recommended (docs.newrelic.com … opentelemetry-otlp).
 * - Langfuse: `/api/public/otel/v1/traces`, `Authorization: Basic` of the key
 *   pair, `x-langfuse-ingestion-version: 4` (langfuse.com … opentelemetry).
 * - Phoenix: `/v1/traces`, protobuf only (its traces router answers 415 to
 *   anything else), a Bearer key when it has sign-in.
 * - On this computer and anywhere else: `<endpoint>/v1/<signal>`, as
 *   `OTEL_EXPORTER_OTLP_ENDPOINT` means.
 */
import {
  destinationOf,
  parseOtlpHeaders,
  toBase64,
  type TelemetryEncoding,
  type TelemetrySettings,
  type TelemetrySignal,
} from '@conch/protocol';

import { isPrivateUrl } from '../local/host';
import { CUMULATIVE, DELTA, type Temporality } from './otlp';

export interface Target {
  urls: Partial<Record<TelemetrySignal, string>>;
  headers: Partial<Record<TelemetrySignal, Record<string, string>>>;
  temporality: Temporality;
  encoding: TelemetryEncoding;
  /** Attributes another convention reads (Phoenix's OpenInference span kinds, Langfuse's session). */
  flavour?: 'langfuse' | 'phoenix';
}

export class TargetProblem extends Error {
  constructor(
    message: string,
    /** What the person must change: the key, or the address. */
    readonly field: 'key' | 'endpoint',
  ) {
    super(message);
  }
}

const SIGNALS: readonly TelemetrySignal[] = ['metrics', 'traces', 'logs'];

/** `https://x/otlp/`, `https://x/otlp/v1/traces` → `https://x/otlp`. */
export function baseOf(endpoint: string): string {
  return endpoint
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1\/(?:traces|metrics|logs)$/, '');
}

/** Plain http only to this computer or your own network: a key must never travel in the clear. */
function checkAddress(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TargetProblem(
      'That address doesn’t read as one. It starts with https://.',
      'endpoint',
    );
  }
  if (parsed.username || parsed.password)
    throw new TargetProblem(
      'Put the key in its own field, not in the address, so it isn’t kept in the clear.',
      'endpoint',
    );
  if (parsed.protocol === 'https:') return;
  if (parsed.protocol === 'http:' && isPrivateUrl(url)) return;
  throw new TargetProblem(
    'Use an https:// address. Over plain http, what Conch sends could be read on the way.',
    'endpoint',
  );
}

const basic = (user: string, password: string) => `Basic ${toBase64(`${user}:${password}`)}`;

function need(fields: Record<string, string>, id: string, message: string): string {
  const value = fields[id]?.trim();
  if (!value) throw new TargetProblem(message, 'key');
  return value;
}

/**
 * Where each signal goes and with which headers, for the settings and the
 * saved fields. Throws a `TargetProblem` in a sentence when something's
 * missing: the page shows it under the field it's about.
 */
export function targetOf(otlp: TelemetrySettings['otlp'], fields: Record<string, string>): Target {
  const destination = destinationOf(otlp.destination);
  const allowed = new Set(destination.signals);
  const all: Record<string, string> = {};
  let base: string;
  let path = (signal: TelemetrySignal) => `/v1/${signal}`;
  let temporality: Temporality = CUMULATIVE;
  let encoding = otlp.encoding;
  let flavour: Target['flavour'];
  const only: Partial<Record<TelemetrySignal, Record<string, string>>> = {};

  switch (otlp.destination) {
    case 'grafana-cloud': {
      if (!otlp.endpoint)
        throw new TargetProblem(
          'Paste the OTLP endpoint from your stack’s OpenTelemetry page.',
          'endpoint',
        );
      base = baseOf(otlp.endpoint);
      const instance = need(fields, 'instance', 'Add your Grafana Cloud instance ID.');
      const token = need(fields, 'token', 'Paste a Grafana Cloud token.');
      all.authorization = basic(instance, token);
      break;
    }
    case 'honeycomb':
      base = otlp.region === 'eu' ? 'https://api.eu1.honeycomb.io' : 'https://api.honeycomb.io';
      all['x-honeycomb-team'] = need(fields, 'key', 'Paste a Honeycomb ingest key.');
      only.metrics = { 'x-honeycomb-dataset': 'conch-metrics' };
      break;
    case 'datadog': {
      const site = /^(?:(?:us3|us5|ap1|ap2)\.)?datadoghq\.(?:com|eu)$/.test(otlp.region ?? '')
        ? (otlp.region as string)
        : 'datadoghq.com';
      base = `https://otlp.${site}`;
      all['dd-api-key'] = need(fields, 'key', 'Paste a Datadog API key.');
      temporality = DELTA;
      break;
    }
    case 'new-relic':
      base = otlp.region === 'eu' ? 'https://otlp.eu01.nr-data.net' : 'https://otlp.nr-data.net';
      all['api-key'] = need(fields, 'key', 'Paste a New Relic license key.');
      temporality = DELTA;
      break;
    case 'langfuse': {
      const hosts: Record<string, string> = {
        eu: 'https://cloud.langfuse.com',
        us: 'https://us.cloud.langfuse.com',
        jp: 'https://jp.cloud.langfuse.com',
        hipaa: 'https://hipaa.cloud.langfuse.com',
      };
      base = otlp.endpoint
        ? baseOf(otlp.endpoint).replace(/\/api\/public\/otel$/, '')
        : (hosts[otlp.region ?? 'eu'] ?? 'https://cloud.langfuse.com');
      path = (signal) => `/api/public/otel/v1/${signal}`;
      const pk = need(fields, 'public', 'Paste your Langfuse public key (pk-lf-…).');
      const sk = need(fields, 'secret', 'Paste your Langfuse secret key (sk-lf-…).');
      all.authorization = basic(pk, sk);
      all['x-langfuse-ingestion-version'] = '4';
      flavour = 'langfuse';
      break;
    }
    case 'phoenix':
      base = baseOf(otlp.endpoint ?? 'http://localhost:6006');
      if (fields.key?.trim()) all.authorization = `Bearer ${fields.key.trim()}`;
      encoding = 'protobuf';
      flavour = 'phoenix';
      break;
    case 'this-computer':
      base = baseOf(otlp.endpoint ?? 'http://localhost:4318');
      break;
    case 'custom':
      if (!otlp.endpoint)
        throw new TargetProblem(
          'Paste the OTLP endpoint your collector or service gave you.',
          'endpoint',
        );
      base = baseOf(otlp.endpoint);
      Object.assign(all, parseOtlpHeaders(fields.headers ?? ''));
      break;
  }

  checkAddress(base);
  const urls: Target['urls'] = {};
  const headers: Target['headers'] = {};
  for (const signal of SIGNALS) {
    if (!allowed.has(signal) || !otlp.signals[signal]) continue;
    urls[signal] = `${base}${path(signal)}`;
    headers[signal] = { ...all, ...only[signal] };
  }
  return { urls, headers, temporality, encoding, ...(flavour && { flavour }) };
}

/** The end of a key, to show which one is saved: `…a1b2`. */
export function keyHint(fields: Record<string, string>, secretIds: readonly string[]): string {
  const key = secretIds.map((id) => fields[id]).find((v): v is string => Boolean(v?.trim()));
  return key && key.length >= 12 ? `…${key.trim().slice(-4)}` : '';
}
