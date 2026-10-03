# Security policy

Conch runs commands as the person using it, so security reports matter a lot to
us. Thank you for taking the time.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/georgevibing/conch-agent/security/advisories/new).

Include what you found, how to reproduce it, and what it would let someone do.
You'll get a reply as soon as possible. Fixes ship in a release, and you're
credited in the advisory unless you'd rather not be.

## Supported versions

Fixes go into the latest release and `main`. Conch looks for a new release
every day and offers it in one click.

## What's in scope

Conch's threat model includes a prompt-injected assistant, other programs on the
same computer, and other devices on the network. For example:

- signing in, sessions, device approval, or anything reachable without them;
- cross-origin requests, WebSocket hijacking, or a page escaping its sealed frame;
- the assistant raising its own privileges or getting past the guard after it
  reads untrusted content;
- keys, passwords or tokens reaching logs, URLs, the assistant or another app.

Problems in a provider, a chat app or another program Conch drives belong with
that project, unless Conch makes them worse.

How Conch is protected: [ARCHITECTURE.md § Security model](./ARCHITECTURE.md#security-model)
and [docs/SECURITY.md](./docs/SECURITY.md).
