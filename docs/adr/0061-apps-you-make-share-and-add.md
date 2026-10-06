# 0061 — Apps you make, share and add

- Status: accepted
- Date: 2026-10-03
- Builds on: [ADR 0009](./0009-integrations.md) (apps, Add your own),
  [ADR 0049](./0049-every-app-works-with-every-model.md) (every app works with every model),
  [ADR 0052](./0052-one-app-one-card.md) (one app, one card; Conch's own tool families),
  [ADR 0034](./0034-show-me.md) and [ADR 0046](./0046-edit-by-hand-and-live-data.md) (the sealed page, live data's SSRF guard),
  [ADR 0013](./0013-skills.md), [ADR 0031](./0031-skill-trust.md) and [ADR 0058](./0058-skills-from-what-worked.md)
  (skills, signatures, "the agent proposes, the person keeps"),
  [ADR 0028](./0028-safe-hands.md) (the guard after reading), [ADR 0016](./0016-getting-what-a-feature-needs.md) (needs),
  [ADR 0019](./0019-updates.md) (updates), [ADR 0020](./0020-backups.md) (backups)

## Context

**Add your own** takes an MCP server's address or a program to run. That serves
someone who already has a server and knows what MCP is. Everyone else who wants
their assistant to do something new — keep a plant diary, check a flight, log
expenses, read the club's timetable — has no way to get it short of writing
software.

The assistant can already write software. What it can't do is turn what it
wrote into something that belongs in Conch: an app on the Apps page, with tools
every model can use, a page of its own that looks like Conch, health, backups,
updates, and a way to give it to a friend. Other agents stop at "here's a
script; run it yourself", or install whatever a registry hands them with the
person's full powers (ClawHub's ClawHavoc, February 2026; poisoned MCP tool
descriptions, Invariant Labs 2025).

Three things have to hold at once:

- **No burden.** Say what you want in plain words; Conch does the rest, and asks
  only the one question that matters: _add it?_
- **Conch quality.** Whatever it makes looks and behaves like the rest of Conch:
  Nacre's look in light and dark, words a person understands, errors a model can
  act on, nothing that breaks quietly.
- **Safe to make, safe to share, safe to add.** An app is code a model wrote —
  maybe a model that just read a hostile page — or code a stranger published. It
  must not get the person's powers by being added.

## Decision

### 1. A Conch app is a small folder

```
plant-diary/
  conch-app.json     what it is (required)
  tools.mjs          what the assistant can do with it (optional)
  pages/main.html    a page of its own (optional, up to 4)
  skills/<name>/SKILL.md   longer know-how for the assistant (optional)
  README.md          for people who find it on GitHub
  icon.png           its picture, drawn instead of the glyph (optional; ADR 0090)
  conch-app.sig      who made it (optional, written by Conch)
```

`conch-app.json` (`ConchAppManifest` in `@conch/protocol`, checked on both sides):

| Key            | What it is                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conch`        | The format, `1`.                                                                                                                                                                                                                                |
| `id`           | `a-z0-9` and single hyphens, 2–40 characters. Its tools are named after it.                                                                                                                                                                     |
| `name`         | 1–40 characters, sentence case ("Plant diary").                                                                                                                                                                                                 |
| `tagline`      | What it does, at most 80 characters, for its card.                                                                                                                                                                                              |
| `description`  | At most 600 characters, for its page and its install preview.                                                                                                                                                                                   |
| `version`      | `major.minor.patch`.                                                                                                                                                                                                                            |
| `icon`         | `{ glyph, color }`: one of Nacre's app glyphs (`APP_GLYPHS`) on one of its colours (`APP_COLORS`). Nothing is fetched. A picture in the folder is drawn instead, with this as its fallback ([ADR 0090](./0090-an-apps-picture-as-its-icon.md)). |
| `kind`         | Where it sits in the gallery: one of the gallery's kinds, or `personal`.                                                                                                                                                                        |
| `tools`        | The tools module, `tools.mjs`.                                                                                                                                                                                                                  |
| `pages`        | `[{ id, title, file }]`, at most 4.                                                                                                                                                                                                             |
| `reaches`      | The websites its tools may reach: exact host names, at most 10, https only. Empty means none.                                                                                                                                                   |
| `settings`     | `[{ key, label, help?, link?, secret?, optional? }]`, at most 8: what it needs from the person, such as an API key.                                                                                                                             |
| `instructions` | At most 1,500 characters, for the assistant: when to use it, and how.                                                                                                                                                                           |
| `examples`     | At most 6 things a person might say to use it ("I watered the fern").                                                                                                                                                                           |
| `author`       | `{ name, url? }`, optional.                                                                                                                                                                                                                     |
| `repository`   | Where it's published, set by Conch when it publishes.                                                                                                                                                                                           |

A package is at most 2 MB unpacked, 200 files, and only text files of known
kinds (`.json`, `.mjs`, `.js`, `.html`, `.css`, `.md`, `.txt`, `.svg`, `.csv`).

### 2. Its tools run sealed off

`tools.mjs` exports plain tool definitions, with no imports and no dependencies:

```js
export const tools = {
  log_watering: {
    title: 'Log watering',
    description: 'Records that a plant was watered. Use when the person says they watered one.',
    input: {
      type: 'object',
      properties: { plant: { type: 'string', description: 'The plant, as the person calls it' } },
      required: ['plant'],
    },
    changes: true,
    async run({ plant }, app) {
      const log = (await app.data.get('log')) ?? [];
      log.push({ plant, at: app.now() });
      await app.data.set('log', log);
      return `Logged: ${plant} watered.`;
    },
  },
};
```

Each app's tools run in a Node process of their own (`conchapps/runtime/host.mjs`),
started by Conch when a tool is first used and stopped after ten idle minutes.
The process is held by **Node's permission model**:

- `--permission`, reading only its own folder and the runtime, writing only its
  own data folder (`CONCH_HOME/conch-app-data/<id>/`);
- no `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`
  or `--allow-inspector`; `--disallow-code-generation-from-strings` (no `eval`,
  so what the check read is what runs);
- **no network of its own.** `app.fetch(url, init)` asks Conch over the
  process's IPC channel, and Conch makes the request through the same guard as
  live data (ADR 0046: the address checked is the address dialled, no private or
  metadata addresses, no Conch port, redirects re-checked), only to a host in
  `reaches`, at most 1 MB out, 5 MB back, 20 seconds, 600 requests an hour.
  Node 24 has no network permission yet, so the process is also fenced: the
  network and process modules can't be imported (`module.registerHooks`,
  `process.getBuiltinModule`), `fetch`, `WebSocket` and undici's dispatcher are
  replaced before the app loads, and `process.binding` is already refused by the
  permission model. When the Node that runs Conch offers a network permission
  (`process.allowedNodeEnvironmentFlags`), Conch turns it on with nothing
  allowed.

`app` is everything a tool can reach: `app.data` (`get`, `set`, `update`,
`delete`, `keys`; JSON, written atomically, 50 MB per app), `app.fetch`,
`app.settings` (what the person typed; secrets included, only inside the
process), `app.now()` and `app.log()`. A tool returns text or JSON; one that
throws gives the model its message.

**Every model gets the tools.** Conch apps are a family of Conch's own tools
(`ConchApps implements HostedApps`, joined in `hostedApps()` with Google's and
Slack's), so every provider that runs Conch's tools has them as
`app_<id>__<tool>`, under the app's policy (**Ask before changes** for apps you
made, **Ask every time** for apps from anyone else), per-tool Allow · Ask · Off,
and the guard after reading. A tool that isn't `changes: true` is a read. An app
that reaches the web taints the chat when its tools answer (`taintFrom`), since
what it read came from outside. A tool call has 30 seconds; a process that
crashes is started again once, with a "fixed on its own" note.

### 3. Its pages look like Conch and stay sealed

A page is served exactly like an artifact's (ADR 0034): its own route
(`/api/conch-apps/:id/pages/:page/frame`), the same `frameHeaders`, the same
`navigates` rule, `SealedFrame`, an opaque origin, no network.

- **The Nacre page kit.** Every page gets Nacre's tokens and a classless base
  (`@conch/nacre/pagekit`, built from `tokens.css` so it can't drift): type,
  colour, buttons, fields, lists, tables, cards and empty states look like Conch
  with no CSS written, in the person's light or dark and accent. A handful of
  classes (`nc-page-head` for the icon, title and buttons at the top; `nc-card`,
  `nc-row`, `nc-stack`, `nc-muted`, `nc-badge`, `nc-empty`, `primary`, `danger`)
  cover the rest. The kit is the _whole_ of a page's look: a page has no React
  and no Nacre components, so every control it can hold is drawn by the kit,
  including the chrome the system would otherwise draw (a select's chevron, the
  button inside a file field, a colour's swatch, a meter's bar).
  `packages/nacre/src/pagekit/pagekit.test.ts` lists every control and fails
  when the kit stops drawing one; `check.ts` warns when a page restyles a
  control the kit draws or builds one out of `<div>`s, and the maker's guide
  says the same in the words a model reads.
- **A page talks to its own tools, and nothing else.** `await conch.call(tool,
input)` goes from the frame to the panel (checked with `event.source`), to the
  gateway, to that app's tools. A read goes by itself. A change goes by itself
  only while the person is pressing something in the page (the panel's
  transient user activation, which a click inside the frame gives it); otherwise
  the panel asks, naming the app, the tool and what it sends. Tools turned off
  stay off. What comes back goes only to that frame.
- A page opens on the app's own page in Apps, beside the chat that made it, and
  in the sidebar (**Pinned**).

### 4. Making one is a chat

- **Where to start.** **Add your own** now opens on **Describe it**: one box,
  "What should it do?", a few examples, and **Build it**. It's also **Make an
  app** in ⌘K, **Make "…" with Conch** when Find an app finds nothing, and any
  chat: "can you make me something that…".
- **Build it** starts a chat (`origin: 'maker'`) with what you wrote, and opens
  it. The assistant builds first and asks only what it can't sensibly assume.
- **The tools** (host tools, every provider): `app_guide` (the maker's guide:
  the format, the page kit, the quality bar), `app_new`, `app_write`,
  `app_read`, `app_check`, `app_try`, `app_present`, `app_edit`, `app_find`,
  `app_get` and `app_share`. Drafts live in `CONCH_HOME/app-workshop/<draft>/`,
  written only through these tools, so they work the same with every provider;
  a draft is tied to its chat.
- **The quality bar** (`app_check`, `conchapps/check.ts`) is the gate, not a
  suggestion. A draft can't be offered until its newest files pass:
  - the manifest reads, the tools module loads in the sealed runtime, and every
    tool has a title, a description that says when to use it, an input schema
    and an honest `changes`;
  - a tool that reaches a host not in `reaches`, or imports anything, is refused
    in words;
  - pages: `lang`, a title, labels on fields, no colours typed outside the
    tokens (warn), nothing that `navigates`, a viewport, and they're readable at
    phone width;
  - skills pass the skill scan (`scanText`); nothing secret is written in (the
    vault's redactor);
  - `app_try` has run each tool at least once against the draft's own scratch
    data, without throwing.
- **The card.** `app_present` puts one card under the reply (Nacre `AppOffer`):
  its icon and name, what it does, **what it can do** in plain words ("Keeps its
  own notes on this computer · Reaches api.open-meteo.com"), its pages, and
  **Add to my apps** (or **Update**, with what changed, new reach first) and
  **Open the page**. The card is the only way in: **the agent proposes, the
  person adds.**
- **Added.** The card turns into "Plant diary is in your apps", with its
  examples as one-tap prompts and **Open Plant diary**. The app is a card under
  **Connected**, marked **Made by you**; its page is pinned when it has one.
- **Changing it.** **Change it** on the app's page reopens the chat it was made
  in (or starts one with `app_edit`). An update is a new card, and nothing
  changes until **Update** is pressed. Three earlier versions are kept, with
  **Go back**.

### 5. Sharing is one press

**Share** on the app's page, or "put it on GitHub" in a chat (`app_share` shows
a card; publishing is the person's press, never the agent's):

- **Publish on GitHub.** A public repository under the person's account, named
  after the app, with the topic `conch-app`, the package, its README, and a
  release `v<version>`. Publishing again pushes the new version. It goes through
  GitHub's own program, `gh` (a need, ADR 0016: installed for you with winget or
  Homebrew, or linked). Signing in is GitHub's device flow, started by Conch: the
  code is shown in Conch with **Open GitHub**, and Conch carries on by itself
  when it's done. Conch never sees a GitHub password or keeps a token of its own.
- **Save as a file.** `<id>.conchapp`, a tar.gz of the package (the backup
  archive's writer and reader, `backup/archive.ts`), to send any way you like.

Either way the package is signed with the person's signing key (ADR 0031's
Ed25519 key, `conch-app.sig` over `conch-app-signature/1\n<id>\n<hash>`), so
whoever adds it sees who made it, and later versions from the same key carry on.

### 6. Adding one from somewhere

- **From a link.** A GitHub repository (or a folder in one, a release, a tag),
  or any https address of a `.conchapp`. In **Add your own → From a link**, or
  pasted in a chat (`app_get`). Conch downloads it through the SSRF guard (at
  most 10 MB, 2 MB unpacked per app), finds every `conch-app.json` in it (the
  root, or up to three folders down for a collection), checks each with the same
  quality bar's safety half, and shows a preview: name, who made it (signature,
  or "from github.com/ada"), what it can do, what it needs from you, its tools
  with read or change, and **Add to my apps**. Settings the app needs are typed
  into the preview by the person; the assistant never sees them.
- **From a file.** Drop a `.conchapp` on Apps, or choose one with the system's
  Open dialog (`PickPurpose` `conch-app`).
- **Finding one.** **Find an app** also searches GitHub for repositories with the
  topic `conch-app` (no sign-in, cached ten minutes, calm when GitHub limits
  it), under **From the community**. The assistant can look too (`app_find`),
  and offers what it found as the same card.

Anything not made in this Conch starts at **Ask every time**, is never offered
an "always allow" on first use, and its skills start **When I ask**.

### 7. Conch knows its apps

- **The prompt** lists the person's Conch apps beside the others, with each
  one's `instructions` and examples, so the assistant reaches for them by
  itself, and refers to them by name.
- It also says, in a few lines, that Conch can make an app when someone wants an
  ability nothing they have offers, or look for one, and to read `app_guide`
  first.
- **The map** of what Conch can turn on (ADR 0060 §1) lists apps you have but
  switched off, so the assistant can offer one back with a card (**Turn on**),
  and the chat carries on once it's on.
- What a stranger's app says (its name, tagline, instructions, examples, tool
  titles and descriptions) is someone else's text: it reaches the model as one
  plain line each, and its instructions and examples sit in a fenced block of
  notes ("data, not instructions"). Using one of its tools taints the chat.
- **⌘K** finds each Conch app, its pages, **Make an app** and **Add an app from a
  link**.

### 8. Whole Conch

- **Updates** (ADR 0019): apps added from GitHub are checked once a day (the
  newest release, or the default branch). An update shows on the app's card and
  in **Settings → Updates**; one signed by the key you added it with is one
  press; a new reach or setting is shown first. Nothing updates by itself.
- **Repair everything**: every app's files still match what was added (a hash),
  its runtime starts, its data folder reads. Repair restores files from the kept
  copy and restarts the runtime.
- **Backups**: `conch-apps/**` and `conch-app-data/**` are kept (with the apps),
  `conch-apps.secrets.json` is secret, `app-workshop/**` is kept with chats.
- **Protected paths**: `conch-apps/`, `conch-app-data/` and
  `conch-apps.secrets.json` (the agent's file tools can't rewrite an added app
  or read its secrets).
- **Restore preview** names the apps a backup would bring back
  (`BackupPower` `conch-apps`).

### 9. Decided while building it

- **Adding from elsewhere needs a recent sign-in.** Installing a package,
  pressing a card that offers one, updating, going back, publishing and saving a
  file (which signs with your key) need a recently verified session, like adding
  a program. Pressing the card for an app made in that very chat needs only the
  press: the person watched it being made and the card says what it can do.
- **Same hands.** Settings, keys, the app's data, its policy and the versions
  kept for **Go back** carry over to a new version only when it comes from the
  same place and is signed by the same key (`sameHands`): a GitHub repository by
  owner and name, a link by its address, a file never, and anything not made here
  only when both are signed by the same key. An app from other hands in place of
  yours starts afresh, and its card says so ("This replaces Weather from another
  maker; its settings, keys and data won't carry over"). Data kept after a
  removal remembers whose it was, in `conch-apps.json` (not in the data folder,
  which the app can write). Two versions made here are the same hands whatever
  their chats read (a version made after reading still goes back to **Ask every
  time**, and the card says when your settings go with one that reaches a new
  site). Yours is yours wherever it went: an app made here and a file signed
  with one of your own keys, which only you hold, are the same hands, so your own
  app saved as a file and added back keeps what it kept.
- **Only your apps carry your signature.** Saving as a file signs apps made here;
  an app from anyone else is saved as it was added, with its own signature if it
  had one. Publishing an app you didn't make is refused: share the address you
  added it from instead.
- **A draft's websites are a sink.** Its `reaches` were written by a model, and no
  person has seen them yet: after the chat read something from outside,
  `app_try` and a draft page's calls ask first, naming the hosts, and running a
  draft that reaches the web taints the chat.
- **A stranger's code runs only after a press.** Finding an update in the
  background reads, hashes and compares the package and scans its files as text;
  it never loads its tools. They load when the person opens the update's preview,
  or the preview of a link, a file or an `app_get` card, and then only in a
  throwaway runtime: a temporary data folder, none of your settings, and an
  `app.fetch` that refuses everything ("Nothing is fetched before you add it").
  **Update** carries the hash of the version the person looked at; a newer one
  that arrived since is refused, and who signed it is read from the files again
  on the press.
- **Made after reading.** An app offered in a chat that had read something from
  outside records what it read (`afterReading`), and a change to someone else's
  app records whose it was (`basedOn`). Its card says so, and it's treated as
  from outside: Ask every time, skills When I ask, its notes fenced, its tools
  tainting the chat, and adding it needs a recent sign-in.
- **What tools carry.** An app's tools carry their input schema to every model
  (`ConchAppTool.input`), and Conch checks what the model sends against it before
  the tool sees it.
- **Pressing in a page.** A click elsewhere in Conch also activates the window for
  a few seconds, and a page could ride on it by taking focus. `SealedFrame` counts
  a press only when the frame has focus and nothing in Conch itself was pressed
  in the last five seconds, so it errs towards asking.
- **The fence, tested from inside.** Tests that attack from a real child process
  found three more ways out than the first design closed (`console`'s socket,
  undici's newer dispatcher slot, the real `process`). The runtime now hides all
  three, freezes the built-in prototypes, and a sweep test walks everything an
  app can reach looking for a socket, a handle or a process.

## Threat model

- **The assistant**, steered by something it read, writes a malicious app. It
  runs sealed: its own folder and data only, no programs, no network but the
  hosts the person saw on the card, through the SSRF guard. Adding it is a press
  on a card that says what it can do. Its tools are held to the app's policy and
  the guard after reading like any app's.
- **A stranger's app.** The same seal, plus the preview, the signature, **Ask
  every time**, and skills that start **When I ask**. A changed reach on update
  is shown before it's accepted. A look-alike signer is named as one (ADR 0031).
- **A page** is a sealed artifact that can only call its own app's tools, and a
  change needs a press in the page or a yes.
- **A malicious package** (traversal, links, a bomb, a huge file, a binary): the
  reader takes regular files only, under the caps, through `safeJoin`.
- **Residual risk.** On Node 24 the network seal is a fence in the process, not
  the operating system's: a flaw in Node's permission model or the fence could
  let an app reach the network directly. Its files, programs and the rest of the
  computer stay closed by the permission model. Node's own model is documented
  as not a security boundary against malicious code with full control of the
  process; the fence and the no-`eval` rule are there so an app never has that.

## Consequences

- New: `apps/server/src/conchapps/` (package, runtime, fetcher, check, sign,
  github, sources, publish, store, workshop, hosted, service, tools, guide,
  prompt, routes, doctor), routes under `/api/conch-apps`, the conversation
  events `conch-app.offer` and `conch-app.share`, the server event
  `conch-apps.changed`, `UpdatesStatus.apps`, Nacre `ConchApps` (`AppIcon`,
  `AppOffer`, `AppMaker`, `AppPreview`, `CommunityApps`, `ShareSteps`,
  `AppVersions`) and the page kit, `SealedFrame`'s `onCall`, and the guide
  **Make an app**.
- New data: `conch-apps.json`, `conch-apps/`, `conch-app-data/`,
  `app-workshop/`, `conch-apps.secrets.json`.
- `gh` and `git` are needs, used only when the person publishes.

## Sources (reviewed 2026-10-03)

- [Node.js permission model](https://nodejs.org/api/permissions.html) (v24): fs, child process, worker, addons, WASI; `process.binding` refused.
- [Node.js module customisation hooks](https://nodejs.org/api/module.html#customization-hooks) (`registerHooks`).
- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM01, LLM03 (supply chain), LLM06.
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
- [GitHub CLI: `gh auth login`](https://cli.github.com/manual/gh_auth_login), [`gh repo create`](https://cli.github.com/manual/gh_repo_create); [GitHub search API rate limits](https://docs.github.com/en/rest/search/search#rate-limit)
- Greshake et al., _Not what you've signed up for_ (2023); Invariant Labs, tool poisoning (2025).
