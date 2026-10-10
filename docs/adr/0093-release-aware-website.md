# 0093 — A website that follows the version people install

- Status: accepted
- Date: 2026-10-05
- Amends: [ADR 0051](./0051-releases.md)

## Decision

GitHub Pages serves the existing static site at conchagent.com, with Cloudflare
providing DNS. Publishing runs from trusted `main`. The landing page, guides,
reference and installer scripts are built from the exact commit of the newest
published, signed release of the steadiest channel that has one: stable once
there is one, before that beta, then alpha. That's what the installers install
too, so the site describes the version people get. Before the first release, they
use the latest main commit that passed CI. Alpha and beta releases never replace
stable. The site labels the version with its channel: "Alpha · v0.1.0-alpha.2".

Each version's site is built from its own code, so it must know its channel's
name. Sites before `0.1.0-alpha.2` knew only stable and development; for a
pre-release from then, the latest validated main stands in.

A second build at `/docs/next/` always describes that validated main commit, is
labelled Development, and is excluded from indexing. Existing guide addresses
remain valid. Source links name the exact commit being described.

`/releases/` renders published GitHub release notes at build time, with stable,
beta and alpha filters. Notes are escaped Markdown, not executable HTML. Drafts
are excluded. Release versions use Conch's existing parser and ordering; tags
use its SSH verification. A release commit must be an ancestor of the trusted
publishing checkout; its committed signer list then verifies its tag. This keeps
historical notes working across key rotation without trusting a tag's arbitrary
self-declared key or a commit outside main's accepted history.
API, schema and signature failures fail the build, never mean “no releases”.
No stable release is manufactured, and no signing keys are changed.

The workflow waits for successful main CI; published/edited/deleted releases,
completed desktop builds, a daily reconciliation and manual dispatch also refresh
it. The desktop completion and reconciliation cover GitHub's suppression of events
created by a workflow token. Download buttons only promise desktop files when
uploaded assets exist on the selected release. With none, they lead to installation.

Production and development are assembled into one Pages artifact. Publication is
serialized, selects current upstream state instead of the triggering event's old
SHA, and rejects a build if the selected state changed before upload. Failed builds
leave the last successful deployment serving. Build metadata is public and contains
only version, commit and public release information. Tokens are build inputs only;
no Cloudflare deployment credential is needed.

## Verification

Selection tests cover prerelease-only repositories (the newest alpha, a beta over
a newer alpha, stable over both), sites that can't describe a channel, version ordering, draft and
flag mismatches, failed verification and unavailable downloads. Rendering tests
cover notes, empty states, source/version labels and accessibility. A production
build and browser journeys cover direct links, development routes, theme changes,
search, release filters, metadata, installers and missing pages.

## Sources and trust

- [GitHub Pages custom domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site): configure and verify the domain, DNS-only records, enforce HTTPS.
- [Workflow triggers](https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow): token-generated events and explicit completion triggers.
- [Secure use of Actions](https://docs.github.com/en/actions/reference/security/secure-use): read-only build permissions, deployment-only OIDC, no PR code in privileged workflow-run jobs.

Only trusted main and verified release code are built. No pull-request artifacts or
workflow-provided commands are consumed. Public notes and asset names are treated
as data; release tags are strictly parsed before being used as Git references.
