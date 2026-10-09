# 0121 — Dashboards: Conch's numbers and traces, over OpenTelemetry and Prometheus, private by default

- Status: accepted
- Date: 2026-10-09
- Builds on: [ADR 0079](./0079-what-a-chat-costs.md) (what a turn costs),
  [ADR 0094](./0094-staying-responsive.md) (nothing may slow a turn),
  [ADR 0025](./0025-passwords.md) (keys Conch uses are sealed),
  [ADR 0063](./0063-this-computer-is-proven.md) (looking local is not trust),
  [ADR 0108](./0108-the-phone-without-native-apps.md) (a recent sign-in for what matters)

## Context

People who run Conch for a team, on a server, or just like to watch, ask for its numbers in
the dashboard they already have: Grafana, Honeycomb, Datadog, New Relic, Langfuse, Phoenix,
or a Prometheus of their own. Conch already knows everything they'd want — each turn's
provider, model, tokens, cost and time, every tool call and question, Auto's judgements,
routines, tasks, chat apps, repairs, Health and the computer's load — but only shows it on its
own pages.

Two industry shapes cover every one of those tools:

- **OpenTelemetry (OTLP/HTTP)**, pushed: `POST /v1/metrics`, `/v1/traces`, `/v1/logs`
  ([OTLP specification 1.x](https://opentelemetry.io/docs/specs/otlp/)), as protobuf or JSON,
  retrying only 429, 502, 503 and 504 with backoff and `Retry-After`.
- **Prometheus**, pulled: the text exposition format 0.0.4 or OpenMetrics 1.0
  ([exposition formats](https://prometheus.io/docs/instrumenting/exposition_formats/),
  [OpenMetrics](https://github.com/prometheus/OpenMetrics/blob/main/specification/OpenMetrics.md)).

What others did:

- **OpenClaw** ships two plugins (`diagnostics-otel`, `diagnostics-prometheus`, its
  `docs/gateway/opentelemetry.md` and `prometheus.md`): OTLP over HTTP/protobuf only, a
  config block of a dozen keys (`endpoint`, `headers`, `tracesEndpoint`, `protocol`,
  `sampleRate`, `flushIntervalMs`, `captureContent`…), `gen_ai.*` metrics plus `openclaw.*`,
  Prometheus behind its gateway's bearer auth with a 2048-series cap. Powerful, and a page of
  YAML before the first number.
- **Claude Code** ([Monitoring](https://code.claude.com/docs/en/monitoring-usage)) is
  environment variables: `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER`,
  `OTEL_EXPORTER_OTLP_PROTOCOL`, endpoints, headers; `claude_code.*` metrics and events;
  prompts only with `OTEL_LOG_USER_PROMPTS=1`; cardinality switches
  (`OTEL_METRICS_INCLUDE_SESSION_ID`, on by default).
- The services each document an endpoint shape and a header: Grafana Cloud's
  `…grafana.net/otlp` with `Authorization: Basic` of instance and token, shown as
  `OTEL_EXPORTER_OTLP_*` lines on the stack's page; Honeycomb's `x-honeycomb-team` (and a
  dataset for metrics); Datadog's agentless `otlp.<site>` with `dd-api-key`, **delta
  temporality only** for metrics; New Relic's `otlp.nr-data.net` with `api-key`, delta
  recommended; Langfuse's `/api/public/otel/v1/traces` with Basic of its key pair and
  `x-langfuse-ingestion-version: 4`, traces only; Phoenix's `/v1/traces`, **protobuf only**
  (its router answers 415 to JSON).

The GenAI semantic conventions now live in their own repository
([semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)),
all in Development, and changed shape after v1.37 (separate token counters,
`gen_ai.invoke_agent.duration`). What dashboards and backends read today is the v1.37 layout:
`gen_ai.client.token.usage`, `gen_ai.client.operation.duration`, `gen_ai.provider.name`
(renamed from `gen_ai.system`), and spans named `invoke_agent {agent}`, `chat {model}`,
`execute_tool {tool}`.

## Decision

**Settings → Dashboards**, a place of its own, and `conch dashboards` for the terminal.

### What's sent

One catalog (`telemetry/catalog.ts`) names every metric, its unit, its words and the only
labels it may carry; Prometheus, OTLP, the preview, the Grafana dashboard and the
documentation's reference all read it.

- **GenAI conventions where they say something:** `gen_ai.client.operation.duration`
  (each turn, operation `invoke_agent`, with `error.type`), `gen_ai.client.token.usage`
  (`gen_ai.token.type` input/output), `gen_ai.execute_tool.duration`.
- **`conch.*` for the rest:** turns by provider, model, agent, origin (chat, routine, task,
  chat app, other app, agent) and outcome; tokens by kind (input, output, cache read, cache
  write); `conch.cost.usd` by billing (plan prices are list prices nobody pays); time to the
  first word; turns working and waiting; errors by kind (`TurnProblem`); tool calls by tool and
  outcome; questions asked and how they were answered; Auto's verdicts and the risk that made
  it ask; routine runs; tasks; chat-app messages in and out by app; repairs by area; Health by
  state; providers ready; memories; skills; and what was sent and dropped.
- **This computer**, in the system and process conventions: `system.cpu.utilization`,
  `system.memory.utilization`, `system.filesystem.utilization` for Conch's disk,
  `process.memory.usage`, `process.uptime`, `nodejs.eventloop.delay.p99`, and Conch's own
  admission state.
- **Each turn as a trace** — `invoke_agent` over `chat` spans (the model at work between tool
  calls) and `execute_tool` spans with the question and the answer as events — with the usage
  attributes (`gen_ai.usage.input_tokens`, `…cache_read.input_tokens`, `…cache_write…`).
  Langfuse gets its session attribute and Phoenix its OpenInference span kinds, the only
  vendor additions.
- **Events** (off by default): a short log record when a turn, a tool call, a question, a
  routine run, a task or a repair ends, linked to its span.

It's all read from what the gateway already broadcasts (`Services.broadcast`): the
conversation log every engine writes, routine runs, tasks, repairs, Health. Nothing in a turn
calls it. The manager gets one optional hook, `judged`, because Auto letting a step through
leaves no event. New tools, providers and chat apps are counted by their names with no change
here.

Cumulative by default, as Prometheus wants; differences for Datadog and New Relic, counted from
what last arrived, so numbers that didn't arrive go next time instead of being lost.

### Private is the default, and proven

Never in a metric, a span or an event: what anyone wrote, a prompt, a reply, a tool's input or
output, a file's name, an email address, a key, or a chat's id.

- Labels are a closed list per metric; each is a word from a fixed list (anything else is
  `_OTHER`) or a name Conch's code gave it, held to a bounded number of values (`_other`
  beyond), and any value shaped like an email, a path or a key is `_redacted`. A metric past
  500 series folds the rest into one `otel.metric.overflow` series.
- Traces carry a chat's id only as a keyed hash (HMAC with a secret kept sealed), so turns of
  one chat group together without leading back to it.
- `service.instance.id` is random; the computer's name is never sent.
- **The words, opt-in:** Advanced → **Send what's written, too** adds `gen_ai.input.messages`,
  `gen_ai.output.messages`, `gen_ai.tool.call.arguments` and `…result` to traces, through the
  trajectory redaction (ADR 0113: every secret the vault knows, keys by shape, emails, phone
  and card numbers, the home folder), bounded in length. The security checkup warns while it's
  on and offers **Numbers only**.
- `service.test.ts` runs a turn full of an email address, a file path, a key and a chat's
  title through every format (OTLP JSON, OTLP protobuf, the Prometheus page, the preview) and
  fails on any of them; and checks that with the words on, they arrive only redacted and only
  in traces.

### Where it goes

- **Prometheus:** `GET /metrics`, a 404 until turned on. Then only with the scrape token
  (`Authorization: Bearer conch_scrape_…`, 256 random bits, shown once, kept as its SHA-256,
  compared in constant time, wrong ones counted like wrong passwords), or — the person's
  choice — programs on this computer: a loopback socket and name and no proxy header
  (`looksLocal`; another account here could read numbers too, which the checkup says), or a
  browser already signed in. It shares the gateway's request budgets and security headers;
  Fetch Metadata refuses another site's page.
- **OTLP push** to eight destinations, each knowing its endpoint shape, its headers and what it
  takes. The person pastes what the service shows; `readDashboardPaste` reads Grafana's
  `OTEL_EXPORTER_OTLP_*` lines, Langfuse's key pair, a Honeycomb, New Relic or Datadog key, an
  address, and switches to the destination the paste belongs to. Keys live in the sealed
  `telemetry.secrets.json` and go only to the destination they were pasted for; plain `http`
  only to this computer or a private network.
- **Changing where it goes** (a destination, an address, a key, the words, turning on) needs a
  person: behind sign-in, a recent one from another device (`verified`, as ADR 0108), the files
  protected from the assistant's own tools, `conch dashboards send|prometheus|token` kept from
  its shell, and a restore preview that names it (`dashboards-send`, `dashboards-scrape`).

### Never slower

Spans and events go onto bounded queues (2048 each) and leave in batches of 256, one request
at a time per signal, gzipped, with a 10 s limit, five tries with exponential backoff and
jitter (or `Retry-After`), then dropped and counted. A full queue drops what's new and counts
it, as OpenTelemetry's batch processor does. `routes.test.ts` runs real mock-engine turns while
the endpoint takes connections and never answers; `service.test.ts` pushes 300 turns' events
through in well under a second with every send hanging.

### Hand-rolled, not the OpenTelemetry SDK

The evidence: `@opentelemetry/sdk-node` 0.223 has 27 direct dependencies and pulls gRPC,
Zipkin and Prometheus exporters; `@opentelemetry/sdk-metrics` alone is 1.85 MB unpacked
(npm registry, 2026-10). The exporters are still 0.x, and the GenAI conventions churn
underneath them. What Conch needs is small and fixed: counters, histograms and gauges with
explicit buckets, cumulative or delta, spans it builds itself, and two encodings. So
`telemetry/` writes the OTLP messages from opentelemetry-proto's field numbers
(`proto.ts`, a hundred lines of varints and length-delimited fields) and the JSON mapping
from the specification, and the Prometheus text from the exposition spec. No runtime
dependency is added. Correctness is held by tests, not trust: `otlp.test.ts` decodes what
Conch writes with protobufjs (already in the lockfile, a dev dependency only) against the
OTLP `.proto` messages and checks JSON and protobuf decode to the same thing; `prometheus.test.ts`
parses the page with a reader written from the spec (HELP/TYPE once per family, label
escaping, cumulative buckets ending at `+Inf`, OpenMetrics' `# EOF`).

### The page

Choose a service by its mark, paste what it shows, turn it on and **Send a test**: a pearl
runs from Conch's shell to the service, which takes a ring of light when it received it
("Grafana Cloud received it · 182 ms"), or the line stops short in amber with exactly why.
Prometheus shows its scrape config with the token once, and a heart that beats when it last
read. A ready-made Grafana dashboard (`grafana.ts`, kept in the repository as
`docs/dashboards/conch-grafana.json` by a test) to copy or download. **What leaves** shows every
metric with a few of its values, opening with what never leaves, and the last turn as its
trace. Repair everything says when the destination keeps refusing, and retries what passes by
itself.

## Consequences

- Prometheus names are the same scraped or translated from OTLP (`conch_cost_usd_total`,
  `gen_ai_client_operation_duration_seconds`): money is `conch.cost.usd` in `{USD}` for that.
- When the GenAI conventions settle on the new layout, the catalog changes in one place; old
  names can be emitted beside new ones for a release.
- Model calls inside a turn are drawn from the conversation log (the time between tool
  calls), not measured at the provider; their tokens are on the turn. An engine that reports
  per-request usage could add it later.
- Not done: OTLP over gRPC (every destination takes HTTP), sampling (a turn is one trace; the
  volume is a person's chats), exemplars.
