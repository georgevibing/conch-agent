---
provider: claude-code
---

## Connect it

1. Open **Settings → Providers** and find **Claude Code**.
2. Press its button. If something is missing, Conch gets it and shows the command.
3. Sign in with your Claude plan, or paste an Anthropic API key.

Already use Claude Code? Conch uses your copy, signed in as you are.

## On your company's cloud

To bill Amazon Bedrock or Google Vertex AI instead of your Claude plan:

1. On its page, under **Where Claude Code runs**, choose **Amazon Bedrock** or **Google Vertex AI**.
2. Press **Use this** on an account Conch found on this computer.

When the sign-in ends, press **Sign in to AWS again**. Choose **Claude plan** to go back.

## It brings your setup with it

Your `~/.claude` settings, `CLAUDE.md` files, MCP servers, hooks and skills come along.

With a Claude plan, your Claude account's connectors load too. Those Conch can connect go into [Apps](../features/apps.md) for every provider. The rest are listed in **Settings → Providers → Set up inside a provider**, for Claude Code only.

## Good to know

- **It asks first.** Every [permission mode](../reference/modes.md) works, with approvals in the chat.
- **Commands run sealed** on macOS and Linux: they can change your work folder, not read your keys or passwords. Windows can't seal commands yet, as **Settings → Security → Advanced → Safety** says.
- **It heals itself.** If your copy breaks, Conch uses the one it ships with and notes it under **Settings → Health → Fixed on its own**.
- **Limits are your plan's.** The meter in the chat header shows what's left. See [Offline and at a limit](../care/offline.md).
