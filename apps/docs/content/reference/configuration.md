---
title: Configuration
description: Conch needs no configuration. These environment variables are for when you want to change where it listens or where it keeps things.
order: 2
---

Set them in the environment Conch starts in. Everything else is a setting in the app.

```bash
CONCH_PORT=8080 pnpm start
```

<!-- conch:env -->

## Where your things live

Everything Conch writes is a plain file in one folder: `~/.conch`, or wherever `CONCH_HOME` points. [What's in it](./files.md) lists every file.
