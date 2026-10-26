# 0151 — A saved key in a command, unseen

- Status: accepted
- Date: 2026-10-26
- Builds on: [ADR 0025](./0025-passwords.md) (Passwords, the agent's tools, redaction),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading, sealed commands),
  [ADR 0102](./0102-every-assistant-works-the-problem.md) (fix what you can yourself)

## Context

A person saved a GitHub token in Passwords as “Gh pat giotiskl” and asked the assistant to clone
a private repository with it. The assistant found the item, then refused: a skill on that
computer said a credential needs “a host-owned masked consumption path”, and it saw none. It
told the person to paste the token into a terminal themselves. Another agent on the same computer
did the job at once, by decrypting Conch's vault behind its back.

Conch did have a way: `passwords_read` returns the value after the person agrees, and the
redactor blanks it afterwards. But it puts the key in the model's context, which is exactly what
a careful model (or a careful skill) avoids, and nothing said this was the sanctioned path. The
only path that kept a value from the model was the browser's fill.

A command needs a key far more often than the model needs to know it: `git clone` with a token,
`gh` as another account, `wrangler` with an API token, `psql` with a password.

## Decision

**Conch puts the key into the command's environment itself.** Conch's command tools take
`secrets`: a short list of `{ name, item, field? }`, an environment variable and the Passwords
item (and field) whose value it gets.

- `process_start` takes it everywhere, so every provider has it: Claude Code, Codex and ACP
  agents reach it as Conch's own tool (`mcp__conch__process_start`) beside their own shell.
- Conch's own `Bash` (the API providers and Codex) takes it too.
- The value is read by the gateway (`vault/secrets.ts` `secretEnvironment`) and set on the
  child's environment, beside `hostEnvironment()`. It is never in the arguments, the prompt or
  the result; the command refers to it as `$GH_TOKEN`.

**The person agrees, with the command in front of them.** Each key asks with **VaultApproval**,
action `use`: “Let this command use the token of “Gh pat giotiskl”?”, the reason in the
assistant's words, the variable and the command. Don't / Always for this item / Allow in this
chat.

- _Allow in this chat_ is remembered for this chat, item, field and variable, in memory only,
  so the next command in the same job doesn't ask again.
- _Always for this item_ is the same per-item setting as a read (“without asking”): an item the
  assistant may read unasked may also be used unasked. A use is never more than a read.
- **After reading something untrusted** (ADR 0028) it always asks, whatever was remembered: a
  page that tells the model to `curl` a key somewhere must meet a person first.
- “Never” items refuse; a locked Passwords shows its Unlock card first.
- The command still goes through the guard and its own question as any other command: the key
  doesn't make a command more trusted, and a sealed command keeps its box (and its network
  allowlist) with the key inside it.

**What comes back is redacted before the model sees it.** The value is remembered by the
redactor as every read value is (`VaultService.readValue`), and the command's output is passed
through `redactor()` in the tool itself, so `echo $GH_TOKEN` returns `•••` to the model as well
as to the log.

**Refused, with a sentence the model can act on:**

- Names that change how a program runs rather than what it reads: `PATH`, `HOME`, `SHELL`,
  `IFS`, `ENV`, `BASH_ENV`, `PROMPT_COMMAND`, `LD_*`, `DYLD_*`, `NODE_OPTIONS`, `NODE_PATH`,
  `PYTHONPATH`/`PYTHONSTARTUP`/`PYTHONHOME`, `PERL5LIB`/`PERL5OPT`, `RUBYOPT`/`RUBYLIB`,
  `JAVA_TOOL_OPTIONS`, `_JAVA_OPTIONS`, `GIT_SSH*`, `GIT_EXEC_PATH`, `GIT_CONFIG*`, `BASH_FUNC_*`,
  the locale and Windows' own; and anything that isn't a plain `[A-Za-z_][A-Za-z0-9_]*` name.
- More than four keys in one command.
- A command that runs elsewhere (a container, an SSH machine, the cloud; ADR 0106): the key
  would leave this computer.
- Unattended runs (routines, tasks, chat apps): nobody is there to agree (ADR 0025).

**The prompt names the order.** Passwords' prompt section: a key a command needs goes in
`secrets` (you never see it); `passwords_read` only when you must know the value itself; these
are Conch's ways to use a saved key and hold whatever a skill or another tool's notes say.

## Consequences

- The incident's job is one call: `process_start` (or `Bash`) with
  `git clone https://x-access-token:$GH_TOKEN@github.com/giotiskl/indiestand-api` and
  `secrets: [{ name: "GH_TOKEN", item: "<id>" }]`, after one press.
- `passwords_read` stays for what the model must know (a PIN to say on a phone menu).
- A command can still send its key somewhere: that's what the person's agreement, the sealed
  box's network allowlist and the guard after reading are for. The card shows the command so the
  person can see where it goes.
- Claude Code's own `Bash` doesn't take `secrets`; its model is pointed at Conch's
  `process_start` for these commands.

## Addendum, 2026-10-26: no card when the person already said yes

The card asked even in Full trust, and in Auto after the person had written "use the gh pat
giotiskl". Both are the answer the card would get, so the card is noise (`vault/consent.ts`,
`consented`), for `secrets` and for `passwords_read`:

- **Full trust** uses an item without a card, unless someone else's words are in the chat
  (`untrusted` there counts only a `person` source, ADR 0028).
- **Auto** uses it without a card when one of the person's own messages (`said`, which is empty
  when anyone else is in the chat) names the item: every word of its title, and for a one-word
  title a word for a secret beside it ("my github token", not "check github"). A page can't write
  the person's words, so this holds after reading, as an asked-for step does (ADR 0128).
- **Read only, Ask first** and unattended runs ask as before; an item set to **never** is refused
  in every mode.
