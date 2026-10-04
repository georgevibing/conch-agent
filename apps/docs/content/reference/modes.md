---
title: Permission modes
description: How much your assistant may do without asking. Pick one per chat, and a default for new ones.
order: 4
---

Change it from the composer, or with `/mode`. A provider that can't honour a mode doesn't offer it.

<!-- conch:modes -->

In every mode but **Full trust**, anything that sends, spends or deletes asks first once the chat has [read something from outside](../security/signing-in.md#when-the-assistant-reads-something-untrusted); **Always allow** on that question lets it through for the rest of the chat. A command that wants out of the sealed box (to clone a repository or install something) asks too, with **Always allow**, except in Full trust. Whatever the mode, anything significant in [the browser](../features/browser.md) asks.
