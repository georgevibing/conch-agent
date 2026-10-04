# 0073 — Conch for your other apps: an MCP door, paired by you

- Status: accepted
- Date: 2026-10-04
- Builds on: [ADR 0009](./0009-integrations.md) (apps and their policies),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading),
  [ADR 0047](./0047-skill-scope.md) (skill holds),
  [ADR 0049](./0049-every-app-works-with-every-model.md) (apps are Conch's own),
  [ADR 0063](./0063-this-computer-is-proven.md) (loopback isn't trust; launchers prove themselves),
  [ADR 0064](./0064-your-own-address.md) and [ADR 0065](./0065-passkeys-and-approving-from-your-devices.md)
  (the address, and confirming it's you)

## Context

What people set up in Conch — their memory, their skills, their apps (Gmail, Slack,
Notion…) and the browser — only reached Conch's own chats. People also work in Claude
Desktop, Cursor, VS Code or Zed, and those apps speak MCP. Without a way in, they set
everything up a second time, by hand, in each one: JSON files, tokens in plain config,
and no guard at all (ADR 0009 lists the complaints).

OpenClaw and Hermes don't offer this. The MCP specification's security guidance for a
local server is short and specific: validate `Origin` to stop DNS rebinding, bind to
loopback, and authenticate every connection. Recent incidents add to it: tool
poisoning and rug pulls (Invariant Labs, 2025), and agents tricked by what they read
(Greshake et al., 2023).

## Decision

### One door, on Conch's own port

Conch answers MCP at `/mcp` on its own port (streamable HTTP, stateless, JSON answers),
beside `/mcp/hello` and `/mcp/session` for the launcher. It is outside `/api`, so the
gateway's sign-in doesn't apply; the gateway's `Host` allowlist and Fetch Metadata
checks still run first, and the door adds its own:

1. **A program, not a page.** A request with `Origin`, or `Sec-Fetch-Site` other than
   `none`, is refused: only browsers send them. `text/plain` is never parsed (the
   gateway removed that parser), so a form can't post to it.
2. **This computer.** A request must look local (`Gatekeeper.looksLocal`: loopback
   socket, loopback `Host`, no forwarding headers). The one exception is below.
3. **A paired app, with proof.** See "Who an app is".

### Who an app is

Pairing is a person's press in **Settings → Other apps**, by the owner in a browser
(this computer, or a signed-in device that's let in) who confirmed it's them in the last
ten minutes (ADR 0065). Never a script's access key, never a tool: the assistant can't
pair an app, and an app can't pair itself or widen what it may use. Narrowing and
removing need only a sign-in.

A paired app has an id and a key (`cmcp.<id>.<secret>`, 256 random bits). Conch keeps a
SHA-256 of the key in `~/.conch/mcp/clients.json`, and the key itself in
`~/.conch/mcp/keys/<id>.key` (0600), for the launcher. `~/.conch/mcp` is a protected
path, so the assistant's own tools can't read it.

- **The launcher** (`~/.conch/mcp/launcher.mjs`, plain Node, written by Conch on each
  start) is what an app runs. It reads the key, asks `/mcp/hello` for a nonce, and
  answers `/mcp/session` with `HMAC-SHA256(key, "conch-mcp/1 <id> <nonce>")`. Conch
  gives it a session token for a day, kept in memory (a restart ends it; the launcher
  proves itself again). The key never travels: ADR 0063's reason applies — whatever
  holds Conch's port while Conch is stopped (another account, say) would collect a
  key sent to it, but a proof over a nonce the real Conch never issued is worth nothing.
  A nonce answers once, for its own app, within a minute.
- **An app that can't start the launcher** can be paired for HTTP: it sends its key as
  a bearer token, compared by hash in constant time. That key does travel, so it's only
  for apps marked `http`; the launcher's apps' keys are refused as bearers.
- Failures are throttled like sign-ins (`SignInLimiter`, per address).

### Connecting in one press

Claude Desktop, Cursor and VS Code are found where they keep their settings (the
Microsoft Store's Claude included). **Connect** shows the file it will write, then
writes one entry: the Node Conch runs on, the launcher, and `--client <id>`. No key or
token goes into another app's settings, which more programs read than the app.

- Only Conch's own entry is written or removed; everything else stays. The file as it
  was is kept beside it once (`.before-conch`).
- A file Conch can't read as JSON (comments, a typo) is left alone, and the person gets
  the entry to add. Someone else's `conch` entry is left alone too.
- Connecting again starts afresh: the pairing the old entry named is removed.
- **Healing.** On start and in Repair everything, the launcher is rewritten if it
  differs, an entry whose Node is gone or whose launcher moved is rewritten (only ours),
  and an entry for an app that's no longer paired is taken out. Each fix is one
  sentence under "Fixed on its own".

### What an app may use

An app has a list of scopes and nothing is implied:

| Scope          | Tools                                                                         |
| -------------- | ----------------------------------------------------------------------------- |
| `memory.read`  | `search_memory` (meaning search; memories waiting for an OK never show)       |
| `memory.write` | `suggest_memory`: always waits for the person's OK (ADR 0032)                 |
| `skills`       | `list_skills` (on, safe, signature intact), `use_skill`                       |
| `browser`      | `browser_*`, except handing it to the person and passkeys                     |
| `app:<id>`     | that app's tools, as the person set them in Apps; tools that are off stay off |

Never offered, whatever the scopes: passwords, files, commands, the terminal,
`delegate` and tasks, routines, making apps, and memory it could forget. The list is
worked out again for every `tools/list` and every `tools/call`, from the app's record
as it is now, so a scope taken away holds at once.

### How a call runs

Memory is read and suggested directly. Every other call runs as **one turn of the app's
own chat** in Conch (origin `{ kind: 'client' }`), with a `CallEngine` in place of a
provider: there is no model, the app already chose the tool. The turn is scoped to that
one tool (`toolAllowed`, and `apps` for the one MCP server it needs), and the engine
calls it as a model API engine would: arguments checked against the schema, the guard,
then permission (`authorizeTool`, the bridge's `requestPermission`). So everything a
chat is held to holds:

- the person's choices in Apps (Ask, Off, "Don't ask");
- the guard after reading: the app's chat remembers what it read across calls, and a
  sink after that asks (ADR 0028);
- a skill it loaded holds the chat to its list (ADR 0047);
- Activity and Undo see it; "always allow" never carries from one call to the next;
- asking the person: the question waits in the app's chat, the approvals notification
  names the app ("Claude Desktop needs your OK"), and Conch's open pages show a toast.

Calls from one app run one at a time. When the app hangs up (its request closes), the
turn stops and a waiting question expires. The app's chat is a log: nobody writes in it
(`send` refuses), and it stays out of the chat list.

### From elsewhere, only when you open it

By default the door answers only programs on this computer. The person can turn on
**Let apps you mark in through your address** (owner, confirmed). Then a request that
doesn't look local is let in only if it came over HTTPS (`Gatekeeper.isSecure`: Conch's
own listener, or a TLS proxy on this computer) to one of Conch's names, with the key of
an `http` app the person also marked `remote`. Plain HTTP from the network never gets in,
and launcher sessions never work from elsewhere. The security checkup warns while any
app may come in this way.

### Whole Conch

- **Backups:** `mcp/**` is `derived`. A restore pairs nothing, so another computer's
  apps never arrive with it; the guide says to connect them again.
- **Protected paths:** `~/.conch/mcp`.
- **Repair everything:** the `mcp` check (heals, and says when an app's settings no
  longer start Conch, with **Open Other apps**).
- **Security checkup:** paired apps (info), and apps let in through the address (warn).
- **⌘K:** "Other apps", "Claude Desktop", "Cursor", "VS Code", "MCP server".

## Threat model

| Who                                      | What they try                                     | What stops it                                                                                                         | Tested in                              |
| ---------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| A program nobody paired                  | Call tools                                        | 401 with how to pair; nothing listed                                                                                  | `endpoint.test.ts`                     |
| Anyone guessing                          | Brute-force a key                                 | 256-bit keys, hash compare, throttling (429)                                                                          | `endpoint.test.ts`                     |
| A web page (CSRF)                        | Post to `/mcp` from the browser with a stolen key | `Origin` / `Sec-Fetch-Site` refused; `text/plain` not parsed (415); no cookies count                                  | `endpoint.test.ts`                     |
| DNS rebinding                            | Reach loopback under its own name                 | `Host` allowlist (421), then `Origin`, then the key                                                                   | `endpoint.test.ts`                     |
| Another computer                         | Reach the door over the network                   | Refused unless the switch, HTTPS, and a marked HTTP app                                                               | `endpoint.test.ts`                     |
| Another account here, or a port squatter | Capture a key while Conch is stopped              | Launcher sends an HMAC over Conch's nonce, never the key; sessions die at restart                                     | `endpoint.test.ts`, `launcher.test.ts` |
| A replayed proof                         | Open a session twice, or for another app          | Single-use nonce bound to the app, one minute                                                                         | `endpoint.test.ts`                     |
| A paired app                             | Use what it wasn't given (scope escape)           | Listed and checked per call from the current record; the turn allows only that tool; Conch's own powers never offered | `service.test.ts`, `endpoint.test.ts`  |
| A paired app, misled by what it read     | Send, change or remember on its own               | The chat's guard, the app's policies, OK for writes, memories wait                                                    | `service.test.ts`                      |
| The assistant in a Conch chat            | Pair an app, read a key, widen a scope            | No tool for it; owner + confirmation on the routes; `~/.conch/mcp` protected                                          | `endpoint.test.ts`                     |
| A removed app                            | Keep using an open session                        | Sessions end on removal; key file deleted                                                                             | `endpoint.test.ts`, `pairing.test.ts`  |
| Another app's settings file              | Carry a secret, or lose the person's own entries  | No secret written; only Conch's entry touched; unreadable files left alone                                            | `pairing.test.ts`                      |

What's left: an app paired for HTTP sends its key on each request, so whatever holds
Conch's port while it's stopped could collect it; the launcher is the default for that
reason, and **Remove** revokes a key at once. A tool's description from one of the
person's own MCP apps reaches the other app as that app's server would give it (the
person connected that app to Conch; Conch's tool pinning still applies to calls). An
app that speaks to the person can still say whatever it likes in its own window; Conch
only governs what it does through Conch.

## Not now: Conch as an ACP agent

Editors that speak the Agent Client Protocol (Zed and others) can run an agent over
stdio. Conch speaking ACP as the agent would stream whole conversations to the editor,
map editor sessions to Conch chats, bridge `session/request_permission` to Conch's
questions, and carry cancellation. That's a separate piece with its own threat model,
not a small addition to this door. Zed and the other editors also take MCP servers, so
they can already use Conch through this door. ACP agent mode is a follow-up.

## Consequences

- An app paired once uses the person's memory, skills, apps and browser, with every
  provider and model behind it, and asks the person in Conch for what matters.
- Conch keeps a key per paired app on disk (0600, protected) and a launcher in
  `~/.conch/mcp`.
- A call that needs an OK waits for the person. Most apps give up after about a minute,
  so a slow answer means asking again from the app.
- No new dependencies: the MCP SDK and Node's crypto were already here.

## Sources

- Model Context Protocol, Security Best Practices and the Streamable HTTP transport
  (2025-06-18): validate `Origin`, bind locally, authenticate connections.
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet; W3C Fetch Metadata Request
  Headers, and the resource-isolation policy the gateway already follows.
- OWASP ASVS 5.0 V6 and V7 (authentication and session management), NIST SP 800-63B-4
  §3.2.2 (throttling); the HMAC challenge as in ADR 0063's launcher design.
- Invariant Labs, "MCP Security Notification: Tool Poisoning Attacks" (2025);
  Greshake et al., "Not what you've signed up for" (2023).
