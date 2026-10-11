---
title: Dashboards
description: Send Conch's numbers and the shape of each turn to Grafana, Honeycomb, Datadog, Langfuse or Prometheus. Never the words of your chats.
order: 1.6
---

See how Conch is doing on your own dashboard: replies finished and how long they took, tokens and money, tools called and questions asked, what routines and chat apps did, and how the computer is coping.

It's off until you turn it on in **Settings → Dashboards**. <kbd>mod+k</kbd> finds it as **grafana**, **prometheus** or **dashboards**.

## Send to a service

1. Choose **Grafana Cloud**, **Honeycomb**, **Datadog**, **New Relic**, **Langfuse**, **Phoenix**, **On this computer** (Grafana, a collector or Jaeger here), or **Another place** for any OpenTelemetry endpoint.
2. Paste what the service shows you: Grafana Cloud's `OTEL_EXPORTER_OTLP_…` lines, Langfuse's two keys, or the one key others give. Conch reads the address and key out of it, and switches service if the paste belongs to another. **Paste** reads the clipboard, a paste anywhere on the page lands there too, and **Type them instead** opens each field.
3. Turn on **Send to** it.
4. Press **Send a test**. Conch sends a real span and numbers, then says **Grafana Cloud received it** and how long it took, or exactly what went wrong, such as a rejected key or nothing at the address.

Choose what goes:

- **Numbers**: turns, tokens, spending, tools and this computer.
- **Each turn as a trace**.
- **Events**, off at first: a line when a turn, tool call, question, routine run or task ends, or when Conch fixes something.

Langfuse and Phoenix take traces only.

If you sign in to Conch, changes here ask you to **Confirm it's you** with your password or passkey, then not again for ten minutes.

The key is kept with Conch's other keys, locked to this computer. It goes only to the service it was pasted for, never over plain `http` unless the address is on this computer or your network.

### Each turn as a trace

A turn follows the [OpenTelemetry GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/):

- the agent's span (`invoke_agent Juniper`), with provider, model, tokens and cost;
- the model at work between tool calls (`chat claude-sonnet-4-5`);
- each tool call (`execute_tool Bash`), with what it asked you and your answer.

Turns of one chat share an id that can't be traced back to the chat.

## Prometheus

Turn on **Answer at /metrics** under Prometheus, and Prometheus (or Grafana Alloy) can read Conch's numbers.

- **With its token** (the usual): press **Make a scrape token**. It's shown once, with a scrape config for `prometheus.yml`. A new one stops the old.
- **This computer only**: programs here read it without a token, never through a proxy. For when Prometheus runs here and nobody shares the computer.

The page shows when Prometheus last read it. Off, nothing answers at `/metrics`.

## A dashboard, ready made

**Copy dashboard** or **Download** gives a Grafana dashboard: turns and spending, turn times, tokens by model, tools and their questions, routines and chat apps, and this computer. In Grafana, open **Dashboards → New → Import** and paste it. It reads from Prometheus, so it works with Grafana Cloud or your own. It's also at `docs/dashboards/conch-grafana.json`.

## What leaves

**What leaves** shows exactly what Conch would send now: every metric with a few values, and your last turn as a trace.

By default that's numbers and the names of providers, models, agents and tools. Never what anyone wrote, what a tool read or wrote, a file name, an email address, a key or a chat's id. Labels that look like an address, path or key are replaced, and each label holds only so many values, so a dashboard never grows a line per chat.

Under **Advanced**:

- **Send what's written, too** adds message, reply and tool-call words to traces, for your own Langfuse or Phoenix. Keys, passwords, addresses and your home folder are taken out first, and the security checkup says it's on.
- **Numbers go** sets how often, from every 15 seconds to every 5 minutes.
- **Format** is **Protobuf** or **JSON**.

## When it can't send

Conch retries a down or busy service, waiting longer each time. What waits is bounded, so turns never wait and memory never fills. What never arrived is counted (`conch.telemetry.dropped`). If the service keeps refusing, **Repair everything** says so in Health, and a rejected key is yours to paste again.

## From the terminal

On a server without a browser nearby, `conch dashboards` does the same:

```bash
conch dashboards prometheus
```

```bash
conch dashboards send grafana-cloud
```

`conch dashboards test` sends a test, and `conch dashboards off` stops everything. See [the command line](../reference/cli.md).

## The numbers

Each by its OpenTelemetry name, its Prometheus name, and the labels it may carry.

<!-- conch:metrics -->
