---
provider: claude-code
---

## Connect it

1. Open **Settings → Providers** and find **Claude Code**.
2. Press its button. If something is missing, Conch gets it, shows the command it runs, and carries on.
3. Sign in with your Claude plan in the page that opens. Or paste an Anthropic API key instead.

Already use Claude Code? There is nothing to do. Conch uses the copy you have, signed in as you are.

## It brings your setup with it

Conch drives the Claude Code that's on your computer, so everything you've set up there comes along: your `~/.claude` settings, `CLAUDE.md` files, MCP servers, hooks and skills.

Signed in with a Claude plan, it also brings your Claude account's connectors (Gmail, Calendar, Drive, Slack). Those work with Claude Code only. Anything you connect in Conch's own [Apps](../features/apps.md) works with every provider.

## Good to know

- **It asks first.** Every [permission mode](../reference/modes.md) is available, and approvals appear in the chat.
- **Commands run sealed** on macOS and Linux: they can change your work folder, and can't read your keys or saved passwords. Windows can't seal commands yet, and **Settings → Security → Safety** says so.
- **It heals itself.** If the installed copy is missing or breaks, Conch uses the copy it ships with, and leaves a note under **Fixed on its own**.
- **Limits are your plan's.** The meter in the chat header shows what's left. See [Offline and at a limit](../care/offline.md).
