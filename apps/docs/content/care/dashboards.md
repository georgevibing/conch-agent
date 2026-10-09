---
title: Dashboards
description: Send Conch's numbers and the shape of each turn to Grafana, Honeycomb, Datadog, Langfuse or Prometheus. Never the words of your chats.
order: 1.6
---

Conch can show how it's doing on a dashboard of your own: how many replies it finished and how long they took, the tokens and money they used, the tools it called and the questions it asked, what routines and chat apps did, and how the computer is coping. **Settings → Dashboards** sets it up. It's off until you turn it on.

Press <kbd>mod+k</kbd> and type **grafana**, **prometheus** or **dashboards** to go straight there.

## Send to a service

1. Choose where: **Grafana Cloud**, **Honeycomb**, **Datadog**, **New Relic**, **Langfuse**, **Phoenix**, **On this computer** (Grafana, a collector or Jaeger running here), or **Another place** for any OpenTelemetry endpoint.
2. Paste what the service shows you. Grafana Cloud's OpenTelemetry page gives a few `OTEL_EXPORTER_OTLP_…` lines; Langfuse gives two keys; the others give one. Paste the whole thing: Conch reads the address and the key out of it, and if the paste says it belongs to another service, it switches to that one. **Paste** reads the clipboard in one press, and a paste anywhere on the page lands there too. **Type them instead** opens each field.
3. Turn on **Send to** it.
4. Press **Send a test**. Conch sends a real span and its numbers there now, and says **Grafana Cloud received it** with how long it took, or exactly what went wrong: a key it didn't take, an address with nothing at it.

Choose what goes: **Numbers**, **Each turn as a trace** and **Events** (a short line when a turn, a tool call or a routine ends). Langfuse and Phoenix take traces only.

The key is kept with Conch's other keys, locked to this computer. It's only ever sent to the service it was pasted for, and never over plain `http` unless the address is on this computer or your own network.

### Each turn as a trace

A turn is drawn as the [OpenTelemetry GenAI conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) draw an agent: the agent's span (`invoke_agent Juniper`), the model at work between tool calls (`chat claude-sonnet-4-5`), and each tool call (`execute_tool Bash`), with when it asked you and what you answered. The provider, the model, the tokens and the cost are on the agent's span. Turns of one chat share an id, changed so it can't be traced back to the chat in Conch.

## Prometheus

Turn on **Answer at /metrics** under Prometheus, and Prometheus (or Grafana Alloy) can read Conch's numbers.

- **With its token** (the usual): press **Make a scrape token**. It's shown once, with the scrape config that uses it, to copy into `prometheus.yml`. Making a new one stops the old one.
- **This computer only**: programs on this computer read it without a token, never through a proxy. Use it when Prometheus runs here and nobody else shares the computer.

The page shows when Prometheus last read it. Off, nothing answers at `/metrics`.

## A dashboard, ready made

**Copy dashboard** or **Download** gives a Grafana dashboard for these numbers: turns and spending at the top, then how long turns take, tokens by model, tools and the questions they asked, routines and chat apps, and this computer. In Grafana, open **Dashboards → New → Import** and paste it. It reads from Prometheus, so it works with Grafana Cloud and with a Prometheus of your own. The same file is in the repository at `docs/dashboards/conch-grafana.json`.

## What leaves

**What leaves** on the same page shows exactly what Conch would send now: every metric by name, with a few of its values, and your last turn as its trace.

By default that's numbers, and the names of providers, models, agents and tools. Never what anyone wrote, a prompt or a reply, what a tool read or wrote, a file's name, an email address, a key, or a chat's id. A label that looks like an address, a path or a key is replaced before it leaves, and each label holds only so many different values, so a dashboard never grows a line per chat.

Under **Advanced**, **Send what's written, too** adds the words of messages, replies and tool calls to traces, for people reading their prompts in their own Langfuse or Phoenix. Keys, passwords, addresses and your home folder are taken out first. The security checkup says it's on.

## When it can't send

A service that's down or busy is tried again by itself, a little later each time, and what waits is bounded, so a turn never waits for a dashboard and Conch never fills up its memory. What never arrived is counted (`conch.telemetry.dropped`). When the service keeps refusing, **Repair everything** says so in Health, and a key it didn't take is yours to paste again.

## From the terminal

On a server without a browser nearby, `conch dashboards` does the same:

```bash
conch dashboards prometheus
```

```bash
conch dashboards send grafana-cloud
```

`conch dashboards test` sends a test now, and `conch dashboards off` stops everything. See [the command line](../reference/cli.md).

## The numbers

Each one by its OpenTelemetry name, then the name Prometheus gives it, and the labels it may carry.

<!-- conch:metrics -->
