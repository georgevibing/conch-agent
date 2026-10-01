---
title: The app's API
description: The web app talks to Conch over HTTP and one WebSocket. A script with an access key can use the same doors.
order: 8
nav: API
---

This is the app's own API, at protocol version 7 today. It moves with the app, so treat it as a map and not a promise. Every body is checked against the schemas in `packages/protocol`, on both sides.

```bash
curl -H "Authorization: Bearer conch_…" http://localhost:4317/api/state
```

Make the key with `pnpm conch key`. Changes that grant trust also need a password or key from the last ten minutes.

## Over HTTP

<!-- conch:routes -->

## The live socket

One WebSocket at `/ws` carries everything that happens while you watch.

### What the app sends

<!-- conch:socket commands -->

### What Conch sends

<!-- conch:socket events -->

### What a conversation is made of

A conversation is an append-only log. Each event has a `seq`; a client that reconnects says the last one it saw, and Conch replays the rest.

<!-- conch:socket conversation -->
