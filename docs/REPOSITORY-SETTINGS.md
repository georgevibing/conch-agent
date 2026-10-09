# Repository settings

Most of how Conch is built and released lives in files. These few settings
don't: a maintainer sets them once on GitHub, in the repository's **Settings**.
Each says whether it's **required** (something breaks without it) or
**recommended** (safer with it). Release-specific steps are also summarized in
[RELEASING.md](./RELEASING.md); this page is the whole checklist.

## Branches and tags

1. **A ruleset for `main`** (required). Settings → Rules → Rulesets → New ruleset
   → New branch ruleset. Name it `main`, set **Enforcement status** to Active, and
   under **Target branches** choose Add target → Include default branch. Then tick:
   - **Restrict deletions** and **Block force pushes**.
   - **Require status checks to pass**, adding **`check`** and **`desktop`** (from
     GitHub Actions). `check` is CI's gate: it passes only when every suite does.
     Leave **Require branches to be up to date** off.
   - **Require a pull request before merging**, with **squash** as the only merge
     method, and **Require linear history**. The pull request's title becomes the
     commit, so CI checks the title is conventional too: it decides the version.

   Don't require **zizmor** or the CodeQL jobs as status checks: zizmor runs only
   when a workflow changes, so a required one would wait forever on other pull
   requests. A **Require code scanning results** rule (CodeQL, errors) is the way
   to block on CodeQL, if you want to.

   If you push to `main` directly, add **Repository admin** to the bypass list.
   The bypass also lets you merge a release pull request when step 11's app isn't
   set up, since a pull request opened with the workflow's own token runs no CI.

2. **A ruleset for release tags** (required). New ruleset → New tag ruleset. Name
   it `releases`, Active, and under **Target tags** Add target → Include by pattern
   → `v*`. Tick **Restrict updates** and **Restrict deletions**, with nobody in the
   bypass list. Installs trust these tags, so once made, no one can move or remove
   one. Leave **Restrict creations** off: the release workflow creates each tag,
   with GitHub Actions' own token, which can't be on a bypass list.

## Security

3. **Private vulnerability reporting** (required: [SECURITY.md](../SECURITY.md)
   sends people there). Settings → Advanced Security → **Private vulnerability
   reporting** → Enable.
4. **Dependabot** (recommended). Same page: enable **Dependabot alerts** and
   **Dependabot security updates**. The version updates for actions are in
   `.github/dependabot.yml` already.
5. **Secret scanning with push protection** (recommended). Same page, under
   **Secret Protection**: enable it, and **Push protection**, which refuses a push
   that contains a key.
6. **CodeQL as a workflow** (required, once). `.github/workflows/codeql.yml` runs
   CodeQL now, and GitHub refuses its results while its own default setup is on.
   Same page, under **Code scanning** → CodeQL analysis → ⋯ → **Switch to
   advanced**, then disable the default setup it offers to keep.
7. **Reported content** (recommended: the [code of conduct](../CODE_OF_CONDUCT.md)
   relies on it). Settings → Moderation options → Reported content → accept
   reports from all users, so **Report content** reaches the maintainers.

## Actions

8. **Workflow permissions** (required). Settings → Actions → General → Workflow
   permissions: choose **Read repository contents and packages permissions**
   (each workflow asks for more where it needs it), and tick **Allow GitHub
   Actions to create and approve pull requests**: release-please opens the release
   pull request with the workflow's token.
9. **Pinned actions** (recommended). Same page, under Actions permissions: tick
   **Require actions to be pinned to a full-length commit SHA**. Every workflow
   does already; this keeps it that way.

## Releases

10. **The `release` environment** (required). Run `pnpm release key`: it makes
    the environment and sets its secret with `gh`. Or by hand: Settings →
    Environments → New environment → `release`. Under **Deployment branches and
    tags**, choose Selected branches and tags and add `main`. Add the environment
    secret **`RELEASE_SIGNING_KEY`**: the private SSH key whose public half is in
    [`release/allowed_signers`](../release/allowed_signers). Only a job on `main`
    in this environment can read it. The optional repository variables
    **`RELEASE_TAGGER_NAME`** and **`RELEASE_TAGGER_EMAIL`** set who the release
    tags name as their tagger.
11. **A GitHub App for release pull requests** (recommended). A pull request
    opened with the workflow's own token doesn't run CI, so the release pull
    request would never get its `check`. Create an app (your account's Settings →
    Developer settings → GitHub Apps → New GitHub App) with no webhook and
    **Contents**, **Pull requests** and **Issues** set to Read and write, then
    install it on this repository. In Settings → Secrets and variables → Actions,
    add the repository variable **`RELEASE_APP_CLIENT_ID`** (the app's Client ID)
    and the repository secret **`RELEASE_APP_PRIVATE_KEY`** (its private key). Without them,
    release-please uses the workflow's token.
12. **`ANTHROPIC_API_KEY`** (optional). A repository secret, used to polish the
    release notes in the release pull request. Without it, the plain notes stand.
13. **Release immutability** (recommended). Settings → General → Releases → tick
    **Enable release immutability**. A published release's files and tag can't
    change afterwards; the release workflow attaches everything to a draft first,
    so it's unaffected.
