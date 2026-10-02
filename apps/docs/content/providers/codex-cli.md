---
provider: codex-cli
---

## Connect your ChatGPT subscription

1. Open **Settings → Providers → Codex**. If needed, choose **Install** or **Update**.
2. Choose **Sign in with your ChatGPT subscription**. You do not need an API key.
3. Open the sign-in page and enter the short code Conch shows. This works when Conch runs on a remote computer, too.
4. Sign in to your own ChatGPT account and approve the connection. Conch verifies the account before reporting it connected.

Your plan and workspace determine available models and usage limits. A model appearing in the list is not a guarantee that a particular request is included in your plan; OpenAI confirms that when it handles the request. Conch does not make a paid test request during setup.

Conch keeps a **separate encrypted sign-in**, not a copy of your credentials from another assistant. Existing Codex/OpenClaw sign-ins are untouched. The Codex app-server renews this connection automatically. If access expires or is revoked, **Settings → Providers** offers reconnecting. Choose **Disconnect** to remove only Conch’s connection.

## The same Conch tools

Codex can use Conch’s memory, browser, skills, routines and connected apps. Conch supplies work-folder file tools and safe commands, validates tool arguments, and applies its approvals, skill limits, read-then-act checks and Undo tracking before changes.

- **Ask first:** reads are available; file changes and commands ask.
- **Plan only:** file reads only; changes and commands are refused.
- **Edit freely:** work-folder file edits need no extra question; commands ask.
- **Full trust:** ordinary work-folder actions need no extra question. Protected paths, disabled tools and read-then-act checks still apply.

Commands always run in an operating-system sandbox, with no network access and writes limited to this chat’s work folder. There is no unrestricted fallback. On Linux, **Settings → Health** explains any missing bubblewrap, socat or ripgrep dependency. On Windows, command tools are unavailable; file tools and connected apps still work. File tools reject links outside the workspace, hard links and protected credential locations.

## Conversations and compatibility

Conch uses Codex’s supported app-server interface, not `codex exec`. Codex 0.159.0 or newer is required. Dynamic tool definitions are an experimental app-server surface; unsupported versions fail with an update/reconnect action rather than silently dropping tools or approvals.

Each turn receives the latest Conch tool list and a bounded handoff of the conversation. Old native Codex resume IDs are not reused, so disconnected apps or changed permissions cannot survive in an old thread’s tool definitions. This may use more input tokens than a native resumed thread.

For credential-refresh safety, turns on this Codex connection run one at a time. Other providers can still run concurrently. Cancel stops the active request and its child process.

The host must also permit OS sandbox creation, not merely have its executables installed. Container/kernel restrictions can prevent Bubblewrap from creating namespaces (for example, a loopback permission error). Conch omits commands and does not retry without isolation; text inference, scoped file tools and connected apps remain available through the environment-free Codex connection. The host administrator must provide supported sandbox permissions to enable commands.
