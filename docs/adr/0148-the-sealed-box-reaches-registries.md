# 0148 — The sealed box reaches registries

- Status: accepted
- Date: 2026-10-26
- Builds on: [ADR 0028](./0028-safe-hands.md) (the sealed box, where keys live),
  [ADR 0100](./0100-permission-modes-every-provider.md) (Auto, leaving the box, Codex CLI's
  `reach`), [ADR 0117](./0117-auto-asks-about-what-matters.md),
  [ADR 0128](./0128-auto-reads-what-you-asked-for.md), [ADR 0106](./0106-where-work-runs.md)
  (places that seal)
- Amends: ADR 0028 § 2's "the network is open" for Claude Code (its SDK 0.3.303 asks about
  each host it isn't given), and the no-network box of Conch's own commands (ADR 0028,
  ADR 0100)

## Context

Conch's own commands (the host tools that Codex, Copilot, Gemini CLI, Grok, the model APIs
and local models use, and `process_start` on every provider) ran in the sealed box with
`network: { allowedDomains: [] }`: no network at all. So `npm install`, `pip install` and
`git pull` had to leave the box (`dangerouslyDisableSandbox`). Before the chat read anything,
Auto lets that through. After reading, leaving the box is what Auto judges, so routine work
met the risk policy and the second look, and sometimes a question. A script the assistant
wrote and then ran scores nothing in the risk policy; only the box holds it, and the box
couldn't install what the script needed.

What each provider reached, measured in the code before this change:

| Provider                                   | Its sealed commands reached                                                                                                                                                                                                                                                      |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conch's host tools and `process_start`     | Nothing                                                                                                                                                                                                                                                                          |
| Claude Code (its own Bash)                 | Any host, each one asked about. Claude Code gives the sandbox runtime an empty `allowedDomains` and asks for every other host through `canUseTool` (`SandboxNetworkAccess`, `{ host }`). Conch answers it like any step: Auto and Full trust let it through, Ask first asks you. |
| Codex CLI (its own tools)                  | `reach` (ADR 0100): the whole network in Auto while a person is here and only things were read, and in Full trust; nothing otherwise                                                                                                                                             |
| A place that seals (a container, ADR 0106) | Nothing                                                                                                                                                                                                                                                                          |
| Windows (`sandboxSupport`: no OS sandbox)  | No box: every command runs with your access                                                                                                                                                                                                                                      |

## Decision

**Conch's own box reaches a curated list over HTTPS.** `REGISTRY_HOSTS` in
`conversations/sandbox.ts`, one named, commented constant: the npm, Yarn, pnpm and Bun
registry; PyPI and its files; crates.io and its index and files; the Go module proxy and
checksum database; RubyGems; Homebrew's formulae and bottles; GitHub, its downloads and raw
files; GitLab; Bitbucket; and the languages' own tooling (`packages.ts` `TOOLING_HOSTS`).
Each entry is `host:443`, so neither SSH to GitHub nor plain HTTP is in reach. The runtime's
proxy is the only way out of the box (Seatbelt allows only its port on a Mac; on Linux the
box has no network of its own). It sets `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY` and their
lowercase forms, and `GIT_SSH_COMMAND` through it, and refuses a host off the list with a 403.
No ask callback is given, so an unlisted host is refused, never asked about.

**Plus the work folder's own remotes.** `git-remotes.ts` `remoteHosts` reads the folder's
HTTPS remotes with `git remote` and `git remote get-url` (`--push` too), on this computer.
A remote with a password in its address, a plain-HTTP or SSH one, or a bare address (no
name) adds nothing. `.git` is read-only in the box, so nothing inside can add a remote.

**The keys that publish are kept out.** `publishingKeys()` joins the box's `denyRead`:
`~/.npmrc`, `~/.yarnrc`, `~/.yarnrc.yml`, `~/.bunfig.toml`, `~/.config/configstore`,
`~/.pypirc`, pip's own settings (`~/.config/pip/pip.conf`, `~/.pip/pip.conf`, and on a Mac
`~/Library/Application Support/pip/pip.conf`), `~/.cargo/credentials` and `credentials.toml`,
`~/.gem/credentials`, `~/.config/hub`, `~/.config/glab-cli`, Git's own credential stores
(`~/.config/git/credentials`, `~/.gcm`), `~/.terraformrc` and
`~/.terraform.d/credentials.tfrc.json`. They are not in `secretPlaces`: outside the box a
command that names one still asks (risk.ts reads them as keys), rather than being refused.
`~/.config/yarn` is left readable: it holds Yarn 1's global packages, not its keys
(`~/.yarnrc` and `~/.npmrc` hold those). `~/.docker/config.json`, `~/.netrc`,
`~/.git-credentials`, `~/.config/gh`, `~/.ssh` and the keychains were kept out already.

**A registry the person moved stays out.** Those settings can't be read in the box, so
there npm or pip would ask the public registry instead of the person's own, and a name
meant for their registry could come from a stranger's package of the same name. So when
`~/.npmrc` or `~/.bunfig.toml` names another registry (a scope's included), or pip's
settings name another index, that public registry is left off the list (`elsewhere`), and
those installs leave the box as before. A project's own `.npmrc` is in the work folder and
stays readable, so npm follows it and its registry is refused rather than replaced.

**Installs can write their caches.** The box writes the work folder and the caches
`writableCaches()` names (`~/.npm`, `~/.cache`, the pnpm store, Cargo's registry, Go's
modules…), as Claude Code's box has since ADR 0028; `.git` stays read-only, and the runtime
gives the command its own temporary folder. Without the caches `npm install` fails in the
box even with the network (measured).

**Claude Code gets the same list, and nothing else changes for it.** Its `sandbox.network`
gets `allowedDomains: sealedHosts(cwd, { keysDenied: false })`: the list and the remotes,
reached without a `SandboxNetworkAccess` question. No `strictAllowlist`, no `deniedDomains`:
every other host is asked about as before, so nothing it reached is refused. Its `denyRead`
is unchanged (see below), so a registry moved elsewhere stays on its list: npm in its box
still reads `~/.npmrc` and asks the person's own registry.

**Codex CLI is unchanged.** Its domain rules need the network proxy feature
(`features.network_proxy`); "without it, commands in this profile have direct network
access, and the domain rule doesn't restrict them" (Codex's own documentation). A version
that reads the keys differently would either stop before it answers or open the whole
network in a turn that must stay sealed (someone else's words, nobody there, a skill's hold).
Its sealed turns are exactly those; in the others it already has the network. Conch's
`process_start`, which every Codex turn has, reaches the list.

**Telling the model.** `SEALED_HINT` (what a failed sealed command is told) says the
registries, GitHub, GitLab, Bitbucket and the folder's remotes work in the box, and that
another host, a private registry's or a push's sign-in, or a write elsewhere is the reason
to run it again with `dangerouslyDisableSandbox: true`. A place that seals with no network
(a container) keeps the old words (`SEALED_OFFLINE_HINT`). The host Bash and `process_start`
descriptions and the shared recovery instructions (`resilience.ts`) say so too.

### Healing a private registry

With a token in `~/.npmrc` (or pip's settings), an install from a private registry can't
sign in from the box: npm reports the 401 or 404 and the sealed hint names the private
registry. The model runs it again with `dangerouslyDisableSandbox: true`. Auto lets that out
before the chat reads anything, and after reading, with a person here and only things read,
the risk policy reads `npm install` as routine. Nothing worked in the box for these before
(it had no network), so no question is new.

## Threat model

Who can use it: a prompt-injected model, or a script it wrote in the work folder, running
sealed. What it could do with an allowed host:

- **Send what it read to an allowed host.** Every host on the list serves downloads to
  anyone and takes an upload only with an account's key: publishing a package, pushing a
  branch, opening an issue or a gist. The box can't read those keys (`publishingKeys`,
  `secretPlaces`), Conch's commands get no environment beyond `PATH`, `HOME`, `USER`, the
  locale and `TMPDIR` (`hostEnvironment`), and on a Mac the login keychain is out of reach:
  measured in the box, `security list-keychains` shows only the System keychain, so
  `git credential-osxkeychain` and `gh` find no sign-in. Unix sockets (an SSH agent, a
  credential cache, the Docker daemon) are closed by the runtime. Making an account from
  inside would need a browser and an email confirmation.
- **Carry it in a request.** A GET to a registry or to GitHub can carry words in its path,
  but only the host's own logs see them, never a stranger. Left off on purpose:
  `upload.pypi.org`, `api.github.com` and the cloud's buckets (`storage.googleapis.com`,
  S3), where anyone can upload with a signed address.
- **Push to the person's own remote.** That needs their sign-in, which is unreadable. The
  remote is the person's: a clone sets it, `.git` is read-only inside, and adding one
  outside the box is a command the risk policy reads like any other.

What remains:

- A key typed into a remote's address (`https://token@host/…`) or an `http.extraHeader` in
  the work folder's own `.git/config` is readable in the box, as before, and its host may now
  be in reach (GitHub is). A push with it goes through; the risk policy's question about a
  push is what stands there, as it does outside the box. The folder's own `.env` is readable
  too, but no allowed host takes it without a key.
- The person's registry settings in environment variables (`NPM_CONFIG_REGISTRY`,
  `PIP_INDEX_URL`) never reached Conch's commands, sealed or not (`hostEnvironment`).
- On a Mac, programs that check certificates through the system's trust service (Go, so
  `go mod download` and `gh`; some Rust-built tools) fail in the box: allowing that service
  (`enableWeakerNetworkIsolation`) would let a command make it fetch addresses for it. They
  leave the box as before. Yarn 2+ doesn't read the proxy variables and leaves it too.
- Claude Code's box still reads the publishing keys, and in Auto Conch lets each
  `SandboxNetworkAccess` question through without judging the host. That was so before this
  change; keeping its keys readable is what keeps a private-registry install in its box from
  newly leaving it. Judging those questions, or keeping the keys out there too, is a separate
  decision.
- **Windows** has no OS sandbox (`sandboxSupport`), so there is no box to give a network
  to: every command runs with the person's access and asks as before. The runtime's Windows
  backend needs a separate local account and machine-wide filter rules, which only an
  administrator can set up; that is its own decision.

## Consequences

- In Auto, installs, clones and pulls over HTTPS run sealed on every provider that uses
  Conch's tools, and never meet the judgement for leaving the box, before or after reading.
- Nothing is narrower: every list only adds hosts; Claude Code's other hosts and Codex CLI's
  reach are as they were. Where Conch's box newly reads less (the publishing keys), it had
  no network before, so nothing that worked in it stops working.
- The list needs care as registries move (GitHub’s release files now come from
  `release-assets.githubusercontent.com`). A host missing from it only means that
  command leaves the box as before.
- Tests: `sandbox.test.ts` (the list, what's left out, the remotes, a moved registry, the
  box's lists), `host-sealed.test.ts` (what the host tools hand the runtime, the hint),
  `claude-code/sandbox.test.ts` (Claude Code's sandbox block).

## Sources

Read 2026-10-26:

- [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing): the proxy and its
  variables, `allowedDomains` reached without a prompt, the prompt per mode for an unlisted
  host, Go's TLS failing under Seatbelt, a hostname-only proxy that doesn't inspect TLS.
- [Codex agent approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security):
  `features.network_proxy`, permission profiles' `network.domains`, and that domain rules
  don't restrict a profile without the proxy.
- `@anthropic-ai/sandbox-runtime` 0.0.80 (README and `dist/sandbox/*`): an empty
  `allowedDomains` still routes through the proxy and refuses everything; no ask callback
  refuses unlisted hosts; `host:port` entries; the resolved-address check; what a read deny
  does on each system.
- `@anthropic-ai/claude-agent-sdk` 0.3.303 (`sdk.d.ts` and its bundled CLI): `SandboxSettings`,
  and the `SandboxNetworkAccess` question sent through `canUseTool`.
- Measured on macOS 26 with the runtime and Conch's own lists: `npm install`, `pip install`,
  `uv pip install` and `git clone` over HTTPS ran sealed; `upload.pypi.org`,
  `api.github.com`, `example.com` and plain HTTP were refused; the login keychain was out of
  reach.
- Greshake et al. (2023), indirect prompt injection; Willison's lethal trifecta (ADR 0028).
