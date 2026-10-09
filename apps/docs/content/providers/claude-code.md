---
provider: claude-code
---

## Connect it

1. Open **Settings → Providers** and find **Claude Code**.
2. Press its button. If something is missing, Conch gets it, shows the command it runs, and carries on.
3. Sign in with your Claude plan in the page that opens. Or paste an Anthropic API key instead.

Already use Claude Code? There is nothing to do. Conch uses the copy you have, signed in as you are.

## On your company's cloud

Claude Code can run on Amazon Bedrock or Google Vertex AI instead of your Claude plan, billed to that account. On its page, choose **Amazon Bedrock** or **Google Vertex AI** under **Where Claude Code runs**, then press **Use this** on an account Conch found on this computer. Claude Code signs in with that same AWS or Google sign-in. When it ends, **Sign in to AWS again** brings it back. Choose **Claude plan** to go back.

## It brings your setup with it

Conch drives the Claude Code that's on your computer, so everything you've set up there comes along: your `~/.claude` settings, `CLAUDE.md` files, MCP servers, hooks and skills.

Signed in with a Claude plan, it also loads your Claude account's connectors by itself. Where Conch can connect the same app, it brings it into its own [Apps](../features/apps.md), so it works with every provider; the rest are listed in **Settings → Providers → Set up inside a provider**, and only work with Claude Code.

## Good to know

- **It asks first.** Every [permission mode](../reference/modes.md) is available, and approvals appear in the chat.
- **Commands run sealed** on macOS and Linux: they can change your work folder, and can't read your keys or saved passwords. Windows can't seal commands yet, and **Settings → Security → Advanced → Safety** says so.
- **It heals itself.** If the installed copy is missing or breaks, Conch uses the copy it ships with, and leaves a note under **Settings → Health → Fixed on its own**.
- **Limits are your plan's.** The meter in the chat header shows what's left. See [Offline and at a limit](../care/offline.md).
