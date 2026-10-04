---
provider: codex-agent
---

## Connect it

Codex CLI uses the same connection as [Codex](codex-cli.md): connect either one and both are ready.

1. Open **Settings → Providers → Codex CLI**. If needed, choose **Install** or **Update**.
2. Choose **Sign in with your ChatGPT subscription**. You don't need an API key.
3. Conch shows a short code. Choose **Copy code and open sign-in page**, paste the code there, and approve the connection.

Conch keeps its own encrypted sign-in. Your other Codex sign-ins stay as they are.

## Codex, with its own tools

This is Codex as you know it from the terminal. It runs its own commands and makes its own file changes in your chat's work folder, and it plans its work its own way. Conch's memory, browser, skills, routines and connected apps are there too.

Everything it wants to do asks through Conch first, in the chat's mode:

- **Ask first:** each command and each change waits for your OK in the chat.
- **Plan only:** it plans; commands and changes are turned down.
- **Edit freely:** changes go ahead; commands ask.
- **Full trust:** commands and changes go ahead.

In every mode, Conch's own checks come first. Passwords and Conch's keys are out of reach. After the chat reads something from outside, it asks again before anything that could send it out. A skill in use holds the chat to its list. **Undo** puts back the files it changed.

## Where it can work

Its commands run in Codex's own sandbox, with Conch's lists:

- They write only in the chat's work folder, and the folders Conch allows a chat.
- They can't read where secrets live.
- They have no network access.

A command Codex knows to be read-only (listing a folder, reading a file) runs without asking. Anything else asks.

## Codex or Codex CLI?

- **Codex** answers with Conch's tools doing the work, like every other provider.
- **Codex CLI** brings Codex's own tools, and asks through Conch for each step.

Both use your ChatGPT plan, and its models and limits. Codex 0.159 or newer is needed.
