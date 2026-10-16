---
provider: codex-agent
---

## Connect it

Codex CLI shares its connection with [Codex](codex-cli.md). Connect either, and both are ready.

1. Open **Settings → Providers → Codex CLI**. If needed, choose **Install** or **Update**.
2. Choose **Sign in with your ChatGPT subscription**. No API key is needed.
3. Choose **Copy code and open sign-in page**, paste the code and approve.

Conch keeps its own encrypted sign-in. Your other Codex sign-ins stay as they are.

## Codex, with its own tools

Codex runs its own commands and file changes in your chat's work folder. Conch's memory, browser, skills, routines and apps are there too. Each step asks through Conch, as the chat's mode says:

- **Ask first:** each command and change waits for your OK.
- **Read only:** it plans. Commands and changes are turned down.
- **Auto:** they go ahead, except [something serious](../reference/modes.md#auto). Its sandbox has the network until the chat reads something.
- **Full trust:** they go ahead, and its sandbox reaches your folders and the network. Conch's keys stay out of reach.

In every mode:

- Passwords and Conch's keys are out of reach.
- After the chat reads something from outside, anything that could send it out asks again.
- Skills keep their permission lists in Ask first and Read only. Auto and Full trust follow the mode you chose.
- **Undo** puts back the files it changed.

## Where it can work

Commands run in Codex's own sandbox. They write only in the chat's work folder and the folders Conch allows, can't read where secrets live, and have no network. A command Codex knows is read-only runs without asking.

## Codex or Codex CLI?

- **Codex** answers with Conch's tools, like every other provider.
- **Codex CLI** brings Codex's own tools, and asks through Conch for each step.

Both use your ChatGPT plan's models and limits, and both can answer at once. The chip at the top of a chat shows what's left of the five-hour and weekly limits. Codex 0.159 or newer is needed.
