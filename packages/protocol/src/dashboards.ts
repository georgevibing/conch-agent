import { z } from 'zod';

/**
 * Dashboards (ADR 0121): Conch's numbers, and the shape of its work, for a
 * dashboard of your own — Grafana, Honeycomb, Datadog, New Relic, Langfuse,
 * Phoenix, a Grafana on this computer, or any OpenTelemetry collector — sent
 * (OTLP) or read by Prometheus (`GET /metrics`).
 *
 * Private by default: what leaves is counts, durations, model and provider
 * names, tool names and outcomes. Never a word of a chat, a prompt, a tool's
 * input or output, a file name, an email address or a key, unless the person
 * turns on `content` themselves, and then only redacted, in traces.
 */

/** What can be sent: numbers, the shape of each turn, and short events. */
export const TelemetrySignal = z.enum(['metrics', 'traces', 'logs']);
export type TelemetrySignal = z.infer<typeof TelemetrySignal>;

/** Where Conch sends them, each with its own endpoint shape and key. */
export const DashboardDestinationId = z.enum([
  'grafana-cloud',
  'honeycomb',
  'datadog',
  'new-relic',
  'langfuse',
  'phoenix',
  'this-computer',
  'custom',
]);
export type DashboardDestinationId = z.infer<typeof DashboardDestinationId>;

/** One thing a destination needs from the person: a key, an instance number. */
export interface DashboardField {
  id: string;
  label: string;
  /** Masked, kept sealed, never sent back. */
  secret: boolean;
  placeholder: string;
  /** Optional fields can be left empty (a Grafana on this computer needs no key). */
  optional?: boolean;
}

export interface DashboardRegion {
  id: string;
  label: string;
}

/** A destination in words: what the page and `conch dashboards` say about it. */
export interface DashboardDestination {
  id: DashboardDestinationId;
  name: string;
  /** A few words, under its name on the tile. */
  tagline: string;
  /** What it can take. Conch sends only these. */
  signals: readonly TelemetrySignal[];
  fields: readonly DashboardField[];
  regions?: readonly DashboardRegion[];
  /** Its own address is the person's (a Grafana stack, a Phoenix, a collector). */
  endpoint?: { label: string; placeholder: string; optional?: boolean };
  /** Where its key is made, in its own words. */
  keyHelp: string;
  keyUrl?: string;
  /** The mark it wears (Nacre `brandMarks`). */
  brand?: string;
  /** Its tile's colour. */
  color: string;
  /** What a sentence calls it, when that isn't its name: “the collector on this computer”. */
  subject?: string;
}

/** A destination as a sentence starts with it: “Grafana Cloud”, “The collector on this computer”. */
export function destinationSubject(
  d: Pick<DashboardDestination, 'name' | 'subject'>,
  start = true,
): string {
  const words = d.subject ?? d.name;
  return start ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

const HTTPS = 'https://';

/**
 * Every destination Conch knows. Pasting what a service shows you (its
 * `OTEL_EXPORTER_OTLP_*` lines, a key, both of Langfuse's keys at once) fills
 * it all in: `readDashboardPaste`.
 */
export const DASHBOARD_DESTINATIONS: readonly DashboardDestination[] = [
  {
    id: 'grafana-cloud',
    name: 'Grafana Cloud',
    tagline: 'Dashboards, alerts and traces',
    signals: ['metrics', 'traces', 'logs'],
    endpoint: {
      label: 'OTLP endpoint',
      placeholder: `${HTTPS}otlp-gateway-prod-eu-west-2.grafana.net/otlp`,
    },
    fields: [
      { id: 'instance', label: 'Instance ID', secret: false, placeholder: '1234567' },
      { id: 'token', label: 'Token', secret: true, placeholder: 'glc_…' },
    ],
    keyHelp:
      'In your Grafana Cloud stack, open OpenTelemetry → Configure, make a token, and paste everything it shows.',
    keyUrl: 'https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/',
    brand: 'grafana',
    color: '#F46800',
  },
  {
    id: 'honeycomb',
    name: 'Honeycomb',
    tagline: 'Traces you can ask anything',
    signals: ['metrics', 'traces', 'logs'],
    regions: [
      { id: 'us', label: 'United States' },
      { id: 'eu', label: 'Europe' },
    ],
    fields: [{ id: 'key', label: 'Ingest key', secret: true, placeholder: 'hcaik_…' }],
    keyHelp: 'In Honeycomb, open Environment settings → API keys and make an ingest key.',
    keyUrl: 'https://docs.honeycomb.io/configure/environments/manage-api-keys/',
    color: '#E79A12',
  },
  {
    id: 'datadog',
    name: 'Datadog',
    tagline: 'Metrics, traces and logs, agentless',
    signals: ['metrics', 'traces', 'logs'],
    regions: [
      { id: 'datadoghq.com', label: 'US1' },
      { id: 'us3.datadoghq.com', label: 'US3' },
      { id: 'us5.datadoghq.com', label: 'US5' },
      { id: 'datadoghq.eu', label: 'EU' },
      { id: 'ap1.datadoghq.com', label: 'AP1' },
      { id: 'ap2.datadoghq.com', label: 'AP2' },
    ],
    fields: [{ id: 'key', label: 'API key', secret: true, placeholder: '32 letters and digits' }],
    keyHelp: 'In Datadog, open Organization settings → API keys and make a key.',
    keyUrl: 'https://docs.datadoghq.com/opentelemetry/setup/agentless/',
    brand: 'datadog',
    color: '#632CA6',
  },
  {
    id: 'new-relic',
    name: 'New Relic',
    tagline: 'Everything in one place',
    signals: ['metrics', 'traces', 'logs'],
    regions: [
      { id: 'us', label: 'United States' },
      { id: 'eu', label: 'Europe' },
    ],
    fields: [{ id: 'key', label: 'License key', secret: true, placeholder: '…NRAL' }],
    keyHelp: 'In New Relic, open your profile → API keys and copy an ingest license key.',
    keyUrl: 'https://docs.newrelic.com/docs/opentelemetry/best-practices/opentelemetry-otlp/',
    brand: 'newrelic',
    color: '#00AC69',
  },
  {
    id: 'langfuse',
    name: 'Langfuse',
    tagline: 'Every turn as a trace, for people who tune prompts',
    signals: ['traces'],
    regions: [
      { id: 'eu', label: 'Europe' },
      { id: 'us', label: 'United States' },
      { id: 'jp', label: 'Japan' },
      { id: 'hipaa', label: 'HIPAA' },
    ],
    endpoint: {
      label: 'Your own Langfuse',
      placeholder: `${HTTPS}langfuse.example.com`,
      optional: true,
    },
    fields: [
      { id: 'public', label: 'Public key', secret: false, placeholder: 'pk-lf-…' },
      { id: 'secret', label: 'Secret key', secret: true, placeholder: 'sk-lf-…' },
    ],
    keyHelp: 'In Langfuse, open Project settings → API keys, make a pair, and paste both.',
    keyUrl: 'https://langfuse.com/integrations/native/opentelemetry',
    color: '#0A60D0',
  },
  {
    id: 'phoenix',
    name: 'Phoenix',
    tagline: 'Arize Phoenix: traces of every turn',
    signals: ['traces'],
    endpoint: {
      label: 'Phoenix address',
      placeholder: 'http://localhost:6006',
      optional: true,
    },
    fields: [
      {
        id: 'key',
        label: 'API key',
        secret: true,
        placeholder: 'Only for Phoenix Cloud or with sign-in on',
        optional: true,
      },
    ],
    keyHelp:
      'Phoenix on this computer needs nothing. For Phoenix Cloud, open Settings and copy the hostname and an API key.',
    keyUrl: 'https://arize.com/docs/phoenix/tracing/how-to-tracing/setup-tracing',
    color: '#7E3AF2',
  },
  {
    id: 'this-computer',
    name: 'On this computer',
    tagline: 'Grafana, a collector or Jaeger here',
    signals: ['metrics', 'traces', 'logs'],
    endpoint: { label: 'Address', placeholder: 'http://localhost:4318', optional: true },
    fields: [],
    keyHelp:
      'Run Grafana’s all-in-one image: docker run -p 3000:3000 -p 4318:4318 grafana/otel-lgtm. Then open localhost:3000.',
    keyUrl: 'https://github.com/grafana/docker-otel-lgtm',
    brand: 'opentelemetry',
    color: '#425CC7',
    subject: 'the collector on this computer',
  },
  {
    id: 'custom',
    name: 'Another place',
    tagline: 'Any OpenTelemetry endpoint',
    signals: ['metrics', 'traces', 'logs'],
    endpoint: { label: 'OTLP endpoint', placeholder: `${HTTPS}otel.example.com` },
    fields: [
      {
        id: 'headers',
        label: 'Headers',
        secret: true,
        placeholder: 'authorization=Bearer …',
        optional: true,
      },
    ],
    keyHelp:
      'The endpoint and headers its documentation gives for OTLP over HTTP. Conch adds /v1/metrics, /v1/traces and /v1/logs.',
    brand: 'opentelemetry',
    color: '#4F5B66',
    subject: 'your collector',
  },
];

export const destinationOf = (id: DashboardDestinationId): DashboardDestination =>
  DASHBOARD_DESTINATIONS.find((d) => d.id === id) ?? (DASHBOARD_DESTINATIONS.at(-1) as never);

export const TelemetryEncoding = z.enum(['protobuf', 'json']);
export type TelemetryEncoding = z.infer<typeof TelemetryEncoding>;

/** Who may read `GET /metrics`: a scraper with its token, or only programs on this computer. */
export const ScrapeAccess = z.enum(['token', 'this-computer']);
export type ScrapeAccess = z.infer<typeof ScrapeAccess>;

const Endpoint = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https?:\/\/[^\s/?#]+[^\s]*$/i.test(v), 'An address starts with https://.');

/** `~/.conch/telemetry.json`, as the page and the gateway share it. Keys are never in it. */
export const TelemetrySettings = z.object({
  prometheus: z
    .object({
      on: z.boolean().default(false),
      access: ScrapeAccess.default('token'),
    })
    .default({ on: false, access: 'token' }),
  otlp: z
    .object({
      on: z.boolean().default(false),
      destination: DashboardDestinationId.default('this-computer'),
      region: z.string().max(40).optional(),
      endpoint: Endpoint.optional(),
      signals: z
        .object({
          metrics: z.boolean().default(true),
          traces: z.boolean().default(true),
          logs: z.boolean().default(false),
        })
        .default({ metrics: true, traces: true, logs: false }),
      /** Protobuf is what every service takes; JSON is for a collector that asks for it. */
      encoding: TelemetryEncoding.default('protobuf'),
    })
    .default({
      on: false,
      destination: 'this-computer',
      signals: { metrics: true, traces: true, logs: false },
      encoding: 'protobuf',
    }),
  /**
   * The words of prompts, replies and tool calls in traces, redacted: for
   * people sending to their own Langfuse or Phoenix. Off unless a person turns it on.
   */
  content: z.boolean().default(false),
  /** How often numbers are sent, in seconds. */
  intervalSeconds: z.number().int().min(10).max(300).default(60),
});
export type TelemetrySettings = z.infer<typeof TelemetrySettings>;

/**
 * `PUT /api/dashboards`: a change to the settings, and the key when one was
 * pasted. Only what's given changes (no defaults here, so a change to one
 * thing never resets another).
 */
export const TelemetryUpdate = z
  .object({
    prometheus: z.object({ on: z.boolean(), access: ScrapeAccess }).partial().strict().optional(),
    otlp: z
      .object({
        on: z.boolean(),
        destination: DashboardDestinationId,
        region: z.string().max(40).nullable(),
        endpoint: Endpoint.nullable(),
        signals: z
          .object({ metrics: z.boolean(), traces: z.boolean(), logs: z.boolean() })
          .partial()
          .strict(),
        encoding: TelemetryEncoding,
      })
      .partial()
      .strict()
      .optional(),
    content: z.boolean().optional(),
    intervalSeconds: z.number().int().min(10).max(300).optional(),
    /** The destination's fields, by id. `null` forgets the saved ones. */
    key: z.record(z.string().max(40), z.string().max(8000)).nullable().optional(),
  })
  .strict();
export type TelemetryUpdate = z.infer<typeof TelemetryUpdate>;

/** The last time something went wrong sending, in one sentence. */
export const TelemetryProblem = z.object({
  at: z.number(),
  signal: TelemetrySignal,
  message: z.string().max(300),
  /** The HTTP status, when there was one. */
  status: z.number().int().optional(),
  /** Only the person can fix it: a key, an address. */
  yours: z.boolean().optional(),
});
export type TelemetryProblem = z.infer<typeof TelemetryProblem>;

const Count = z.number().int().nonnegative();

/** `GET /api/dashboards`: where things stand. */
export const TelemetryStatus = z.object({
  settings: TelemetrySettings,
  /** Which of the destination's fields are saved, never their values; `hint` shows the end of a key. */
  key: z.object({
    destination: DashboardDestinationId.optional(),
    fields: z.array(z.string().max(40)).max(10),
    hint: z.string().max(12).optional(),
  }),
  prometheus: z.object({
    path: z.literal('/metrics'),
    tokenSaved: z.boolean(),
    lastScrapeAt: z.number().optional(),
    scrapes: Count,
  }),
  otlp: z.object({
    /** Where each signal goes now, as addresses (no keys in them). */
    targets: z.partialRecord(TelemetrySignal, z.string().max(600)),
    lastSentAt: z.number().optional(),
    problem: TelemetryProblem.optional(),
    sent: z.object({ metrics: Count, traces: Count, logs: Count }),
    queued: Count,
    dropped: Count,
  }),
});
export type TelemetryStatus = z.infer<typeof TelemetryStatus>;

const LabelValue = z.string().max(120);

/** One metric as it would leave now, with a few of its series. */
export const MetricPreview = z.object({
  name: z.string().max(120),
  prometheus: z.string().max(140),
  kind: z.enum(['counter', 'gauge', 'histogram']),
  unit: z.string().max(20),
  description: z.string().max(300),
  series: Count,
  samples: z
    .array(z.object({ labels: z.record(z.string().max(60), LabelValue), value: z.number() }))
    .max(5),
});
export type MetricPreview = z.infer<typeof MetricPreview>;

/** One span as it would leave now: a name and its attributes, never content unless turned on. */
export const SpanPreview = z.object({
  name: z.string().max(200),
  kind: z.enum(['internal', 'client']),
  depth: z.number().int().min(0).max(4),
  /** When it started, from the start of the turn. */
  startMs: z.number().nonnegative(),
  ms: z.number().nonnegative(),
  attributes: z.record(z.string().max(80), z.union([z.string().max(400), z.number(), z.boolean()])),
  error: z.boolean().optional(),
});
export type SpanPreview = z.infer<typeof SpanPreview>;

/** `GET /api/dashboards/preview`: exactly what Conch would send, so anyone can see it's private. */
export const TelemetryPreview = z.object({
  metrics: z.array(MetricPreview).max(80),
  /** The newest turn, as a span tree, when there's been one. */
  spans: z.array(SpanPreview).max(40),
});
export type TelemetryPreview = z.infer<typeof TelemetryPreview>;

/** `POST /api/dashboards/test`: a real span and metric, sent now. */
export const TelemetryTestResult = z.object({
  ok: z.boolean(),
  /** One sentence: "Grafana Cloud received it." or exactly what went wrong. */
  message: z.string().max(400),
  ms: z.number().nonnegative().optional(),
  signals: z
    .array(
      z.object({
        signal: TelemetrySignal,
        ok: z.boolean(),
        status: z.number().int().optional(),
        message: z.string().max(300).optional(),
      }),
    )
    .max(3),
});
export type TelemetryTestResult = z.infer<typeof TelemetryTestResult>;

/** `POST /api/dashboards/token`: a new scrape token, shown once, with the config that uses it. */
export const ScrapeTokenResult = z.object({
  token: z.string().min(32).max(100),
  config: z.string().max(2000),
});
export type ScrapeTokenResult = z.infer<typeof ScrapeTokenResult>;

/** What a paste was: the destination it belongs to, its address and its fields. */
export interface DashboardPaste {
  destination?: DashboardDestinationId;
  endpoint?: string;
  region?: string;
  fields: Record<string, string>;
}

const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** `a=b,c=d`, as `OTEL_EXPORTER_OTLP_HEADERS` writes headers (values URL-encoded). */
export function parseOtlpHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(/,(?=\s*[A-Za-z0-9_-]+\s*=)|\n/)) {
    const at = part.indexOf('=');
    if (at <= 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const value = decode(part.slice(at + 1).trim());
    if (/^[a-z0-9_-]{1,80}$/.test(name) && value && value.length <= 4000) out[name] = value;
  }
  return out;
}

const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/s, '$2');

/** The `NAME=value` and `NAME: value` lines in a paste (an `.env`, a YAML block, `export` lines). */
function assignments(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+|-\s+)?([A-Z][A-Z0-9_]{2,60})\s*[=:]\s*(.+?)\s*$/.exec(line);
    if (match?.[1] && match[2]) out.set(match[1], unquote(match[2]));
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 (or base64url) to text, without the platform's `atob` (the protocol runs everywhere). */
export function fromBase64(text: string): string | undefined {
  const clean = text.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const n = B64.indexOf(char);
    if (n < 0) return undefined;
    value = (value << 6) | n;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return undefined;
  }
}

/** Text to base64, for a Basic credential. */
export function toBase64(text: string): string {
  // Percent-encoding names each UTF-8 byte: read them back as bytes.
  const utf8: number[] = [];
  const encoded = encodeURIComponent(text);
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') {
      utf8.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else utf8.push(encoded.charCodeAt(i));
  }
  let out = '';
  for (let i = 0; i < utf8.length; i += 3) {
    const [a = 0, b = 0, c = 0] = utf8.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] ?? '';
    out += B64[(n >> 12) & 63] ?? '';
    out += i + 1 < utf8.length ? (B64[(n >> 6) & 63] ?? '') : '=';
    out += i + 2 < utf8.length ? (B64[n & 63] ?? '') : '=';
  }
  return out;
}

/** The host of an address, lowercased, without the platform's `URL`. */
export function hostOf(url: string | undefined): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]+\]|[^:/?#]+)/i.exec(url ?? '');
  return match?.[1]?.toLowerCase() ?? '';
}

/** A Basic credential's two halves, when it holds two. */
function basic(value: string): [string, string] | undefined {
  const match = /^Basic\s+([A-Za-z0-9+/=_-]+)$/i.exec(value.trim());
  if (!match?.[1]) return undefined;
  const plain = fromBase64(match[1]);
  const at = plain?.indexOf(':') ?? -1;
  return plain && at > 0 ? [plain.slice(0, at), plain.slice(at + 1)] : undefined;
}

/**
 * Whatever someone pasted from a service's setup page, read into a destination:
 * the `OTEL_EXPORTER_OTLP_ENDPOINT` and `_HEADERS` lines Grafana Cloud shows,
 * Langfuse's two keys, a Honeycomb, New Relic or Datadog key, an address.
 * Nothing is guessed that the text doesn't say; a key alone fills the field
 * of the destination already chosen.
 */
export function readDashboardPaste(
  text: string,
  chosen: DashboardDestinationId = 'custom',
): DashboardPaste {
  const paste = text.trim().slice(0, 8000);
  const fields: Record<string, string> = {};
  const vars = assignments(paste);
  const url = (
    vars.get('OTEL_EXPORTER_OTLP_ENDPOINT') ??
    vars.get('PHOENIX_COLLECTOR_ENDPOINT') ??
    vars.get('LANGFUSE_HOST') ??
    vars.get('LANGFUSE_BASE_URL') ??
    /\bhttps?:\/\/[^\s"'<>,]+/i.exec(paste)?.[0]
  )?.replace(/\/+$/, '');
  const headers = parseOtlpHeaders(vars.get('OTEL_EXPORTER_OTLP_HEADERS') ?? '');
  const host = hostOf(url);

  // Langfuse: a pk-lf- and an sk-lf- key, wherever they are.
  const pk = vars.get('LANGFUSE_PUBLIC_KEY') ?? /\bpk-lf-[A-Za-z0-9-]{8,}/.exec(paste)?.[0];
  const sk = vars.get('LANGFUSE_SECRET_KEY') ?? /\bsk-lf-[A-Za-z0-9-]{8,}/.exec(paste)?.[0];
  if (pk || sk || /langfuse\.com$/.test(host)) {
    if (pk) fields.public = pk;
    if (sk) fields.secret = sk;
    const region = /^(us|jp|hipaa)\.cloud\.langfuse\.com$/.exec(host)?.[1];
    const own = url && !/(^|\.)cloud\.langfuse\.com$/.test(host) ? url : undefined;
    return {
      destination: 'langfuse',
      fields,
      ...(region ? { region } : /^cloud\.langfuse\.com$/.test(host) && { region: 'eu' }),
      ...(own && { endpoint: own.replace(/\/api\/public\/otel.*$/, '') }),
    };
  }

  if (/grafana\.net$/.test(host) || (chosen === 'grafana-cloud' && headers.authorization)) {
    const pair = headers.authorization ? basic(headers.authorization) : undefined;
    if (pair) [fields.instance, fields.token] = pair;
    const token = /\bglc_[A-Za-z0-9+/=_-]{20,}/.exec(paste)?.[0];
    if (!fields.token && token) fields.token = token;
    return { destination: 'grafana-cloud', fields, ...(url && { endpoint: url }) };
  }

  if (/honeycomb\.io$/.test(host) || headers['x-honeycomb-team']) {
    const key = headers['x-honeycomb-team'] ?? /\bhc[a-z]{2,4}_[A-Za-z0-9]{20,}/.exec(paste)?.[0];
    if (key) fields.key = key;
    return {
      destination: 'honeycomb',
      fields,
      region: /eu1\.honeycomb\.io$/.test(host) ? 'eu' : 'us',
    };
  }

  if (/nr-data\.net$/.test(host) || headers['api-key'] || /\b[A-Za-z0-9]{36}NRAL\b/.test(paste)) {
    const key = headers['api-key'] ?? /\b[A-Za-z0-9]{36}NRAL\b/.exec(paste)?.[0];
    if (key) fields.key = key;
    return {
      destination: 'new-relic',
      fields,
      region: /eu01\.nr-data\.net$/.test(host) ? 'eu' : 'us',
    };
  }

  const site = /(?:^|\.)((?:us3\.|us5\.|ap1\.|ap2\.)?datadoghq\.(?:com|eu))$/.exec(host)?.[1];
  if (site || headers['dd-api-key'] || vars.get('DD_API_KEY')) {
    const key = headers['dd-api-key'] ?? vars.get('DD_API_KEY');
    if (key) fields.key = key;
    const named = vars.get('DD_SITE');
    const region = site ?? named;
    return { destination: 'datadog', fields, ...(region && { region }) };
  }

  const phoenixKey = vars.get('PHOENIX_API_KEY');
  if (phoenixKey || vars.get('PHOENIX_COLLECTOR_ENDPOINT') || /phoenix\.arize\.com$/.test(host)) {
    if (phoenixKey) fields.key = phoenixKey;
    return {
      destination: 'phoenix',
      fields,
      ...(url && { endpoint: url.replace(/\/v1\/traces$/, '') }),
    };
  }

  if (url && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && !Object.keys(headers).length) {
    if (chosen === 'phoenix') return { destination: 'phoenix', fields, endpoint: url };
    return { destination: 'this-computer', fields, endpoint: url };
  }

  if (url || Object.keys(headers).length) {
    const list = Object.entries(headers).map(([k, v]) => `${k}=${v}`);
    if (list.length) fields.headers = list.join(',');
    return { destination: 'custom', fields, ...(url && { endpoint: url }) };
  }

  // A key alone: it belongs to the destination already chosen, in its one secret field.
  const secret = destinationOf(chosen).fields.find((f) => f.secret);
  if (secret && /^\S{8,}$/.test(paste)) fields[secret.id] = paste;
  return { destination: chosen, fields };
}
