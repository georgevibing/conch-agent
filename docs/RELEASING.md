# Releasing Conch

**Merging the release pull request is the release.** Everything else is done by
[release-please](https://github.com/googleapis/release-please) and
`.github/workflows/release.yml`. Why it's built this way is in
[ADR 0127](./adr/0127-releasing-with-release-please.md); how installs check and
take a release is in [ADR 0051](./adr/0051-releases.md).

## How a release happens

1. **Commits land on `main`**, as conventional commits (CI checks them on every
   pull request, `scripts/commits.mjs`).
2. **release-please keeps one pull request open**, titled
   `chore(main): release Conch 0.4.0`. On every push to `main` it works out the
   next version from the commits since the last release:
   - a breaking change is a new major (a new minor before 1.0);
   - a `feat` is a new minor (the next pre-release number on alpha or beta);
   - a `fix` or `perf` is a patch;
   - housekeeping alone (`chore`, `docs`, `test`, `ci`, `build`, `refactor`)
     makes no release, and no pull request.

   It sets that version in `package.json` and `.release-please-manifest.json`.

3. **Conch writes the notes into it.** Right after, `pnpm release ci notes`
   replaces release-please's changelog with Conch's own (New, Better, Fixed, and
   Heads up for a breaking change), in `CHANGELOG.md` and in the pull request's
   description. With the `ANTHROPIC_API_KEY` secret, Claude polishes them, held to
   the commits. If the polished version breaks a rule, the plain notes stand.
4. **You merge it when you want to ship.** Read the notes there first: they're
   what people read in the app, on GitHub and on the website.
5. **The workflow does the rest**, in about 40 minutes:
   - **Tag.** Makes the SSH-signed tag `v0.4.0` on the merge, with the notes as
     its message, and checks it against `release/allowed_signers` the way every
     install will, before pushing it. The key is only in this step.
   - **Draft.** release-please makes the GitHub Release for that tag, as a draft,
     and opens the next release pull request.
   - **Apps.** `desktop.yml` builds the app for every platform onto the draft,
     with `SHA256SUMS`, an SBOM and build provenance.
   - **Publish.** Writes the release's page (the notes, how to install, how to
     check a download) and publishes it: as a pre-release for alpha and beta, as
     the latest release for stable. Then it updates the website.

`pnpm release` on its own shows what the next release says so far, and its pull
request. Add `--ai` to see the notes polished, as CI does.

## Before the first release

Once, in this order:

1. **Make the release key.** Run `pnpm release key`. It makes an SSH key
   (`~/.ssh/conch-release`) and adds its public half to `release/allowed_signers`.
   With `gh` signed in, it also sets up GitHub's `release` environment (only `main`
   may use it) and gives it the private half as the `RELEASE_SIGNING_KEY` secret.
   **Keep a copy of the private key** in a password manager: changing keys later
   needs it. Commit `release/allowed_signers` and push it.
2. **Set the repository's settings** in
   [REPOSITORY-SETTINGS.md](./REPOSITORY-SETTINGS.md). Two matter for releasing:
   - _Allow GitHub Actions to create and approve pull requests_ (required);
   - the release app (recommended), so CI runs on the release pull request.
3. **Optionally, add `ANTHROPIC_API_KEY`** as a repository secret, for polished
   notes.
4. **Merge the first release pull request.** It's `0.1.0-alpha.1`
   (`initial-version` in `release-please-config.json`).

Installs from before the first release trust the key the first release names,
once (ADR 0051 § Trust on first use). Every release after must be signed by a
key they already trust.

## Alphas, betas and stable releases

`release-please-config.json` says which come next. `pnpm release channel`
changes it, in a commit of its own:

| Command                       | The releases after it                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm release channel alpha`  | `0.1.0-alpha.1`, `-alpha.2`… A new feature after a stable release starts the next version's alphas. |
| `pnpm release channel beta`   | From alphas, `0.1.0-beta.1` next, then `-beta.2`…                                                   |
| `pnpm release channel stable` | From alphas or betas, their version: `0.1.0-beta.3` becomes `0.1.0`. Then `0.1.1`, `0.2.0`…         |
| `pnpm release as 1.0.0`       | Exactly that version, once.                                                                         |

Each makes a commit; push it, and the release pull request follows. A commit
that only changes the configuration is housekeeping, which opens no release pull
request by itself. So when the change alone is the next release (promoting betas
to stable, alphas becoming betas, or `as`), the commit says so in a
`Release-As: 0.1.0` footer. release-please releases exactly that version next,
and only once: every release after it is past that commit. Going from betas back
to alphas of the same version is refused: installs never go back a version.

People choose their channel in Settings → Health → Updates (ADR 0051 §
Channels). Stable is the default and only takes stable releases.

## The notes

They're written from the commits, so write the commits for them:

- Write `feat` and `fix` subjects in the person's words: `feat(web): edit pages
by hand, with a live preview`, not what changed in the code.
- A feature's commits across protocol, server, Nacre and web become one line.
  The web app's subject is the one people read.
- For a breaking change, add a `BREAKING CHANGE:` footer that says what the
  person must do: `BREAKING CHANGE: Sign in again after updating.`
- `chore`, `test`, `docs`, `refactor`, `ci` and `build` never appear in them.

**To edit them by hand**, change the newest section of `CHANGELOG.md` on the
release pull request's branch just before you merge. The tag and the page are
made from that section. Every push to `main` rewrites them from the commits
again.

## If something goes wrong

Start a run by hand only when no Release run is in progress: a newer push to
`main` replaces a run that's still waiting its turn.

- **A step failed after the tag was made** (the draft, the apps, publishing, the
  website). Run **Actions → Release → Run workflow** with the version (`0.4.0`).
  It checks the tag that's there and carries on from where it stopped. A release
  already published only gets the website again.
- **A desktop build failed.** If the workflow was at fault, fix it on `main` and
  run the same as above: the apps are built from the tag with the workflow from
  `main`. If the app's code was, that version can't be fixed. Fix it on `main`,
  and let the next release carry it. Either way, the draft isn't published until
  every file it promises is there.
- **The release pull request says it isn't ready to merge.** `release/allowed_signers`
  has no key. Run `pnpm release key` and push the list; the pull request updates.
  With the release app set up, CI's `check` fails on it too, so branch rules
  keep it from being merged.
- **The tag wasn't made** ("isn't set", "isn't trusted by…"). The secret
  `RELEASE_SIGNING_KEY` isn't a key that both the list at that commit and the
  release before it trust. The merged pull request waits, labelled
  `autorelease: pending`, and until it's released no new release pull request
  opens. Either:
  - give the secret the right key (`gh secret set RELEASE_SIGNING_KEY --env
release < key`), then run **Release** by hand with no version; or
  - skip that version: fix the list or the key on `main`, swap the merged pull
    request's `autorelease: pending` label for `autorelease: tagged`, then run
    `pnpm release as <the version after it>` and push. Without a release for the
    skipped version, release-please would count from scratch; the footer names
    the next one exactly.
- **Two merged release pull requests wait.** Label every one but the newest
  `autorelease: tagged`, then run **Release** by hand.

## Changing the key

Installs trust the list in the version they already have. So:

1. Add the new key's line to `release/allowed_signers` in a commit.
2. Release once more, still **signed with the old key**.
3. Then give GitHub the new private key: `pnpm release key` on the computer that
   has it. It refuses until the newest release on every channel trusts the key,
   so make that release a stable one (it reaches every channel). Remove the old line in a
   later release if you like.

The tag job checks each new tag against the list each channel's installs carry
(the newest release on every channel the new one is offered on), so a key handed over too early stops the release instead of
shipping one nobody takes.

Keep the old key's line for a while after the switch. An install further behind
crosses on the release that added the new key, and Conch only looks at the six
newest releases on its channel (ADR 0051): one more than six releases behind
that bridge would find none it can check.

If the old key is lost, installs can't take a new one from a release: they'd have
to install again.

## Code signing for the apps

Not set up yet. Without it, macOS and Windows ask once before opening the app, and
a Mac app can't replace itself, so it offers each update as a download. The
release page says so. The workflow signs as soon as these repository secrets
exist:

- **macOS:** `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` (a Developer ID Application
  certificate, `.p12` as base64). To notarize, also an App Store Connect API key:
  `APPLE_API_KEY` (the `.p8` file's text), `APPLE_API_KEY_ID` and
  `APPLE_API_ISSUER`.
- **Windows:** `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (a code-signing
  certificate).

Provenance, checksums and the signed tag hold either way.

## What a release carries

| What                                          | Built on / by         |
| --------------------------------------------- | --------------------- |
| `Conch-0.4.0-mac-arm64.dmg` and `.zip`        | `macos-latest`        |
| `Conch-0.4.0-mac-x64.dmg` and `.zip`          | `macos-15-intel`      |
| `Conch-0.4.0-win-x64.exe`                     | `windows-latest`      |
| `Conch-0.4.0-linux-x64.AppImage` and `.deb`   | `ubuntu-latest`       |
| `Conch-0.4.0-linux-arm64.AppImage` and `.deb` | `ubuntu-24.04-arm`    |
| `latest*.yml`, `*.blockmap`                   | the update feeds      |
| `conch-0.4.0.spdx.json`                       | the SBOM (Syft, SPDX) |
| `SHA256SUMS`                                  | every file's checksum |

Each app is opened once on its runner to check it starts. Every installer and
`SHA256SUMS` has a build provenance attestation (`gh attestation verify <file>
--repo georgevibing/conch-agent`), and the installers an SBOM attestation.
[SECURITY.md](../SECURITY.md) says how to check each by hand.

## The website

[conchagent.com](https://conchagent.com) is `apps/docs`: the front page, the
documentation, and the installers at `/install.sh` and `/install.ps1`.
`.github/workflows/site.yml` publishes the newest verified stable release. Before
there is one, it publishes the latest `main` commit that passed CI. The landing
page, guides, generated reference and installer scripts all come from that exact
commit; the site shows its version and source link.

`/docs/next/` always describes validated `main`, with a Development label and no
search indexing. `/releases/` reads published GitHub Release notes at build time,
including alpha and beta releases. Drafts stay private. Without uploaded desktop
assets, **Install Conch** opens the installation guide instead of a missing download.

The Website workflow runs after successful CI and desktop builds, when the Release
workflow publishes a release, when a release is edited or deleted, daily, and from
**Actions → Website → Run workflow**. A GitHub API failure, inconsistent release
metadata or an invalid signature stops publication and keeps the existing site.
Builds assemble both versions into one artifact; a final selection check refuses
stale builds.

For a local production-shaped build, run `pnpm docs:build`; it labels the local
commit Development without contacting GitHub. For development routing, set
`CONCH_DOCS_BASE=/docs/next/`. CI additionally provides a public JSON manifest through
`CONCH_SITE_MANIFEST`, generated by `apps/docs/publishing/prepare.ts`; it contains
no credentials. See [ADR 0093](./adr/0093-release-aware-website.md).

The first time (verify ownership in GitHub account settings before adding the domain):

1. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**, then
   enter `conchagent.com` as the **Custom domain**.
2. At the domain's DNS provider, point the bare domain at GitHub Pages with four `A`
   DNS-only records (`185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
   `185.199.111.153`), four `AAAA` records (`2606:50c0:8000::153`,
   `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`), and a
   `CNAME` for `www` to `georgevibing.github.io`.
3. Once the check passes, tick **Enforce HTTPS**. Verifying the domain in your GitHub
   account's **Settings → Pages** keeps anyone else from claiming it.
4. Add the site to Google Search Console and Bing Webmaster Tools, and submit
   `https://conchagent.com/sitemap.xml`.

The address lives in one place, `SITE_URL` in `apps/docs/src/site/config.ts`: canonical
links, the sitemap, `CNAME` and the install lines all follow it.

## The desktop apps

- **Installed apps update from these releases.** They read the repository's public
  releases (never drafts), and offer one once this computer's file is attached
  ([ADR 0054](./adr/0054-the-desktop-app.md)).
- **To build without releasing**, run **Desktop app** from the Actions tab: the files
  stay with the run for two weeks. Give it a tag to attach the apps to a release that
  has none.
- **On your own computer**, `pnpm desktop:build` makes that computer's installers in
  `apps/desktop/out`. Each platform's app is built on that platform.

## The version shown in Conch

Development checkouts show **Dev · commit**. The root package version is the last
release's (release-please sets it in the release pull request); before the first
release it's `0.1.0`, a planning number, not evidence that anything was published.
Only a clean detached checkout at its matching release tag, or a desktop payload
built from that checkout, displays **v0.1.0**, **v0.1.0-alpha.1** or **v0.1.0-beta.2**.
A branch stays Dev even if it happens to point at a release commit. Without Git or
packaged build metadata, Conch says Dev without inventing a commit.

The displayed build is captured at startup. Updating the folder leaves the running
identity alone until restart. The channel picker controls future updates; choosing
stable does not relabel a running beta as stable. Desktop builds carry their identity
in `conch-build.json`, so local and manually dispatched builds also remain Dev.
Dev desktop installers use an internal `0.0.0-dev.<commit>` package number so
Electron can replace them with the first real release, including `0.1.0`.
Release installers use their full release version. Build metadata does not
replace release signatures or installer verification.

A Dev build can move to the first release in its selected channel even when its
package number sorts above that pre-release. Actual release installs keep the
existing no-downgrade rule.
