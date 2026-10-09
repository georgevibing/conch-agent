# 0127 — Releasing with release-please: a release pull request, a tag signed in CI

- Status: accepted
- Date: 2026-10-09
- Amends: [ADR 0051](./0051-releases.md) (§ Making a release), [ADR 0054](./0054-the-desktop-app.md) (§ Building and releasing)

## Context

ADR 0051 made a release one command on the maintainer's computer: `pnpm release`
worked out the version, wrote the notes, ran the checks, signed the tag with the
maintainer's own SSH key and pushed it. It worked, but before Conch's first public
release it had three costs:

- **It's a tool of our own** where open-source projects expect a common one. A
  contributor who has used release-please, semantic-release or changesets
  recognises those; nobody recognises `pnpm release`.
- **Nothing is reviewed before it ships.** The version and notes were seen only in
  one terminal, a moment before the push.
- **The release depends on one laptop**: its checkout, its `gh`, its key, and
  `pnpm check` passing there.

What installs check doesn't change (ADR 0051 § Checking a release is real). Every
Conch takes only an annotated tag signed by an SSH key in `release/allowed_signers`,
as committed in the version already installed. Any new process has to produce
exactly that.

## Decision

**release-please** (`googleapis/release-please-action`, pinned) owns the version
and the release pull request. Conch keeps its notes and its signed tags. Merging
the pull request is the release. [docs/RELEASING.md](../RELEASING.md) is the
procedure.

### Why release-please

- **semantic-release** releases on every push that has a `feat` or `fix`, with
  no step where a person decides. Its pre-release channels are branches. And it
  makes lightweight tags with `git tag`, which installs refuse.
- **changesets** asks each pull request for a hand-written changeset file. Conch's
  commits already carry that information (ADR 0051 § The notes).
- **release-please** proposes, a person decides. The release pull request shows
  the version and the notes, runs CI, and is merged like any other. It finds the
  previous release by GitHub Release, or by tag when there's none. Given an
  existing tag, it makes the release on that tag instead of making its own. That
  is what lets Conch sign the tag.

### The flow

`.github/workflows/release.yml` runs on every push to `main`. Its jobs:

1. **plan** looks for a merged pull request labelled `autorelease: pending`.
   release-please labels its pull request so, and swaps the label for
   `autorelease: tagged` once the release is made. It reads the version from
   `.release-please-manifest.json` at the merge, and checks it against the strict
   pattern installs read tags with.
2. **tag** runs only for a release, in the GitHub environment `release`, which
   only `main` may use and which alone holds `RELEASE_SIGNING_KEY`.
   `pnpm release ci tag` (`release/tag.ts`) makes the annotated tag on the merge
   with `git tag -s` and `gpg.format=ssh`. Its message is the notes from that
   commit's `CHANGELOG.md`. It then checks the tag with `verifyTag`, against the
   list at that commit, exactly as an install would. A tag that wouldn't pass is
   deleted before anything is pushed. A tag already there, from a run that
   stopped, is accepted only if it checks out and is on this commit.
3. **release-please** runs on every push. After a tag, it makes that tag's GitHub
   Release as a **draft** (`draft: true`), flips the label, and opens the next
   release pull request.
4. **notes** runs whenever release-please opened or updated its pull request.
   `pnpm release ci notes` (`release/pr.ts`) writes Conch's notes for the
   pull request's version, from the commits since the last release its channel
   saw (`release/history.ts`), polished by Claude when `ANTHROPIC_API_KEY` is set
   (`polish.ts`, unchanged). It writes them into `CHANGELOG.md`, on top of
   `main`'s, in place of release-please's changelog. It also rewrites the
   description in the shape release-please reads back: header, `---`, a
   `## [version](compare) (date)` section, `---`, footer. It takes out a one-off
   `release-as` and release-please's `release-notes.md` overflow file.
5. **desktop** calls `desktop.yml`, now a reusable workflow (`$/` reference). It
   builds every platform as before and attaches the installers, the update feeds,
   `SHA256SUMS` and an SPDX SBOM (Syft, from the source and lockfile) to the draft.
   The installers and `SHA256SUMS` get build provenance attestations, and the
   installers an SBOM attestation.
6. **publish** writes the page (`release/page.ts`): the notes, then how to install
   and how to check a download, and, until certificates exist, a line saying the
   apps aren't code-signed. It refuses to publish a draft missing a file the page
   promises. Then it publishes, as a pre-release for alpha and beta, as latest for
   stable, and dispatches the website workflow, since a release published with
   GitHub's own token starts no workflow by itself.

Drafting first means a published release never lacks its files, and allows release
immutability (once published, nothing changes). The concurrency group `release`
runs one at a time and never cancels. A run that stopped is finished by
`workflow_dispatch` with the version.

### Channels

`release-please-config.json` uses release-please's `prerelease` versioning:

- `prerelease: true` with `prerelease-type: alpha.1` (or `beta.1`) counts
  `0.4.0-alpha.1`, `-alpha.2`…; a feature after a stable release starts
  `0.5.0-alpha.1`;
- `prerelease: false` promotes them: `0.4.0-beta.3` becomes `0.4.0`;
- `bump-minor-pre-major`: before 1.0, a breaking change is a new minor;
- `initial-version` is where the first release starts (`0.1.0-alpha.1`).

The only step it can't take is from alphas to betas of the same version. For that
`pnpm release channel beta` sets a one-off `release-as`, which the release pull
request takes out (`release/channel.ts`). Betas back to alphas of the same version
are refused, because installs never go back a version. Tags stay `v` plus SemVer
with `-alpha.N` or `-beta.N`, so `release/semver.ts` and every install read them
as before. release-please computes the next version now, so `nextVersion` is gone.

This was checked against release-please 17.6.0, the version the action bundles,
using its own strategies: the first version, each step above, a merged pull
request read back as a release, and housekeeping-only commits making no pull
request.

### The key

The release key is an ed25519 SSH key without a passphrase, made by
`pnpm release key` (`release/key.ts`). Its public half is the line
`conch-release` in `release/allowed_signers`. Its private half is an environment
secret, set through `gh`. The command also creates the environment, with a
deployment-branch policy of `main` only. The maintainer keeps a copy of the
private key offline. Rotation is ADR 0051's: add the new key in a release signed
by the old one.

The tag names `Conch releases` and GitHub Actions' bot address as its tagger.
That's set by `RELEASE_TAGGER_NAME` and `RELEASE_TAGGER_EMAIL` when the
maintainer prefers their own name.

### Around it

- **Commits are checked.** `scripts/commits.mjs` checks every pull request's
  commit subjects and title against Conventional Commits, since they now decide
  versions on their own.
- **A GitHub App token**, when `RELEASE_APP_CLIENT_ID` and `RELEASE_APP_PRIVATE_KEY`
  exist, lets release-please's pull request run CI. Pull requests opened with
  `GITHUB_TOKEN` start no workflows. The token is limited to contents, pull
  requests and issues.
- **Supply chain.** Every action is pinned to a commit. Each job asks only for the
  permissions it uses. No job that releases restores a dependency cache. The
  release jobs install with `--ignore-scripts`, filtered to the server.
  actionlint, and zizmor (pedantic), find nothing; zizmor also runs in CI.
- **`pnpm release`** now shows what the next release says so far, and runs the
  `channel`, `as` and `key` steps. Its `ci notes|tag|page` subcommands are the
  workflow's steps, testable on real repositories (`release/flow.test.ts`).

## Security

What changes from ADR 0051's table is where the key lives.

| Who                                                   | Could try                  | What holds                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A pull request's workflow                             | read `RELEASE_SIGNING_KEY` | It's an environment secret, and only `main` may deploy to `release`. Workflows from forks get no secrets.                                                                                          |
| A commit that lands on `main`                         | sign its own release       | Only by being merged as a release pull request, which a maintainer merges. Branch rules require CI on `main` (docs/REPOSITORY-SETTINGS.md).                                                        |
| A compromised dependency or action                    | take the key from the job  | Actions are pinned to commits. The key is in one step's environment only, after an install with no scripts and no restored cache. The tag job runs no third-party action after checkout but setup. |
| GitHub, or someone with the repository's admin rights | sign a release             | They can, as they could reach any CI secret. The key's line in `allowed_signers` says it's CI's. A maintainer's own key can sign instead (ADR 0051), at the cost of the laptop again.              |
| Moving or deleting a published tag                    | swap what a version is     | The tag ruleset restricts updates and deletions. Installs read the tag object and its name (ADR 0051), and immutable releases keep the files.                                                      |

## Consequences

- `pnpm release`'s one question (`run.ts`) is gone, and so is signing on the
  maintainer's computer.
- The maintainer's acts are: merge the release pull request, and occasionally run
  `pnpm release channel` or `as`. `pnpm release key` runs once.
- `CHANGELOG.md` headings follow release-please's (`## [0.4.0](link) (date)`).
  `changelogFor` reads that form and the old one.
- Releases carry `SHA256SUMS` and an SBOM. Both, with provenance, are on the
  release page.
- No new npm dependencies: release-please runs as its action.

## Known limits

- A release pull request opened with `GITHUB_TOKEN` runs no CI, so a branch rule
  requiring `check` blocks it unless the release app is set up, or an admin
  bypasses the rule.
- Editing notes by hand on the release branch lasts only until the next push to
  `main`, which rewrites them from the commits.
- The apps aren't code-signed for macOS or Windows yet. The workflow signs as soon
  as the certificates are secrets.
- actionlint 1.7.12 doesn't know the `$/` reference yet. zizmor and GitHub do.

## Sources

- release-please 17.6.0: `Manifest` (release discovery by GitHub Release, then
  tag; merged pull requests labelled `autorelease: pending`), the
  `PrereleaseVersioningStrategy`, `PullRequestBody`, and the
  `pull-request-overflow-handler`. release-please-action 5.0.0's outputs (`pr`,
  `release_created`).
- GitHub Docs: reusable workflows; environments and deployment branch policies;
  `GITHUB_TOKEN` and the events it doesn't trigger; artifact attestations;
  immutable releases. The GitHub changelog of 2026-07-30 on self-repository `$/`
  references.
- OpenSSF Scorecard checks (Pinned-Dependencies, Token-Permissions,
  Signed-Releases); zizmor's audits; SLSA build provenance; SPDX 2.3.
- Conventional Commits 1.0.0; Semantic Versioning 2.0.0 §9–11.
