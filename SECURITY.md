# Security policy

Conch runs commands as the person using it, so security reports matter a lot to
us. Thank you for taking the time.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
[Security → Report a vulnerability](https://github.com/georgevibing/conch-agent/security/advisories/new).

Include what you found, how to reproduce it, and what it would let someone do.
You'll get a reply as soon as possible. Fixes ship in a release, and you're
credited in the advisory unless you'd rather not be.

## Supported versions

Security fixes go into `main` and ship in the next release of each channel:

| Channel                         | Supported                                                      |
| ------------------------------- | -------------------------------------------------------------- |
| Stable                          | The newest stable release                                      |
| Beta and alpha                  | The newest pre-release (`-beta.N`, `-alpha.N`) in that channel |
| Before the first stable release | The newest pre-release                                         |

Older versions don't get fixes: update instead. Conch looks for a new release
every day and offers it in one click.

## Verifying a release

Conch checks every update itself before it installs it. To check one by hand:

- **The tag is signed.** Every release is an SSH-signed git tag, made with a key
  in [`release/allowed_signers`](./release/allowed_signers). In a copy of the
  repository, with the tags fetched:

  ```sh
  git -c gpg.ssh.allowedSignersFile=release/allowed_signers verify-tag v1.2.3
  ```

  `Good "git" signature` means one of those keys signed it. The list from a
  release you already trust is the strongest check, since a new key is only
  added by a release signed with an old one.

- **Downloads say where they were built.** Every file attached to a release has
  build provenance from GitHub Actions: which workflow, at which commit, made it.
  With the [GitHub CLI](https://cli.github.com):

  ```sh
  gh attestation verify Conch-1.2.3-mac-arm64.dmg --repo georgevibing/conch-agent
  ```

- **Checksums.** Each release has a `SHA256SUMS` file. In the folder you
  downloaded into:

  ```sh
  sha256sum -c SHA256SUMS --ignore-missing   # macOS: shasum -a 256 -c SHA256SUMS --ignore-missing
  ```

- **What's inside.** An SBOM (software bill of materials) attached to each release
  lists every package Conch ships with.

The desktop apps aren't code-signed by Apple or Microsoft yet, so macOS and
Windows ask once before opening them. Until they are, provenance and checksums
are how to know a download is ours.

## What's in scope

Conch's threat model includes a prompt-injected assistant, other programs on the
same computer, and other devices on the network. For example:

- signing in, sessions, device approval, or anything reachable without them;
- cross-origin requests, WebSocket hijacking, or a page escaping its sealed frame;
- the assistant raising its own privileges or getting past the guard after it
  reads untrusted content;
- keys, passwords or tokens reaching logs, URLs, the assistant or another app.

Problems in a provider, a chat app or another program Conch drives belong with
that project, unless Conch makes them worse.

How Conch is protected: [ARCHITECTURE.md § Security model](./ARCHITECTURE.md#security-model)
and [docs/SECURITY.md](./docs/SECURITY.md).
