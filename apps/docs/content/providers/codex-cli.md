---
provider: codex-cli
---

## Connect it

1. Open **Settings → Providers** and find **Codex**.
2. Press its button. If Codex isn't on this computer, **Install** gets it, with the command shown, and carries on.
3. Sign in with your ChatGPT plan or an OpenAI key.

## How much it may do

Codex decides inside its own sandbox, so Conch can't put a question in front of you before each step. Instead, the mode you pick sets how far the sandbox reaches:

| Mode            | What Codex can touch                                           |
| --------------- | -------------------------------------------------------------- |
| **Plan only**   | It reads. Nothing changes.                                     |
| **Edit freely** | Files in the chat's folder, and nothing else on your computer. |
| **Full trust**  | Anything. Only in a folder you can afford to lose.             |

**Ask first** and **Auto** aren't offered, because Codex couldn't honour them.

Once a chat has read something from outside (a web page, an email), Conch keeps Codex to the chat's folder, even in **Full trust**.

## Good to know

- **Memory is read-only here.** Codex sees what Conch remembers about you, and can't save a new memory itself. Use `/remember`, or let another provider do it.
- **No browsing.** Conch's [browser](../features/browser.md) needs tools Codex can't call yet.
- **Sealing needs a recent Codex.** From Codex 0.159 its commands can't read where your keys live. An older one keeps to the work folder but can still read them, and **Settings → Security → Safety** says which you have.
- **Early support.** It works, and it will get better.
