# 0070 — Discover: skills people share, read before they're added

- Status: accepted
- Date: 2026-10-04
- Builds on: [ADR 0013](./0013-skills.md) (skills),
  [ADR 0028](./0028-safe-hands.md) (the scan, pinned skills from other apps),
  [ADR 0031](./0031-skill-trust.md) (what a skill may do),
  [ADR 0047](./0047-skill-scope.md) (held for the whole chat),
  [ADR 0060](./0060-the-chat-knows-conch.md) (offers, carrying on),
  [ADR 0020](./0020-backups.md) (what's in a backup)

## Context

People want skills they didn't write: a way to make slides, a house style
for emails, a research routine. Thousands are published as Agent Skills
folders, and other agents install them with one command (`npx skills add`,
`clawhub install`). Conch could only use skills already on disk.

The same marketplaces carried the worst supply-chain attack on agents so far.
In February 2026 Koi Security found 341 malicious skills on ClawHub
(ClawHavoc), 335 of them shipping Atomic Stealer behind a fake
"Prerequisites" section: download a password-protected zip from a release
and run it, or paste a script from a paste site into Terminal. Others read
`~/.clawdbot/.env` and sent it to a webhook. The installers followed moving
refs, so a skill could change after people had read it.

So Conch adds marketplaces only if every install is read first, pinned to
exactly what was read, attributed, never runs anything, and is held to its own
list afterwards, and if all of that holds for every provider.

## Research (2026-10-04, verified against the live endpoints)

| Source                                | API                                                                                                                                                                                                           | Terms                                                                                                                                                                         | Metadata                                                                                                                                                               | Install resolves to                                                                               | Verdict                                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **anthropics/skills** (GitHub)        | GitHub's REST API (60 calls an hour without signing in) and `raw.githubusercontent.com` (not counted)                                                                                                         | Per skill: most are Apache-2.0; `docx`, `pdf`, `pptx`, `xlsx` are "source-available", copying outside Anthropic's services forbidden; one has no licence                      | The SKILL.md and LICENSE.txt themselves                                                                                                                                | `skills/<name>` at a commit                                                                       | **Used**, openly licensed skills only                                                                                         |
| **ClawHub** (clawhub.ai)              | Documented public API (`/api/v1/openapi.json`), no sign-in for reads, 3,000 reads a minute per address                                                                                                        | The registry's own docs allow third-party directories to use the public reads if they cache, honour `429`/`Retry-After`, link back, and don't mirror hidden or blocked skills | Description, installs, stars, owner, official publisher flag, per-version file list with SHA-256, scanner verdicts (VirusTotal, an LLM scan, SkillSpector), moderation | A version: each file at `/skills/{slug}/file?version=` with its SHA-256 in the version's manifest | **Used**, `nonSuspiciousOnly`, owner-qualified, pinned to a version and each file's hash                                      |
| **skills.sh** (Vercel)                | Documented v1 API needs a Vercel OIDC token (only apps deployed on Vercel). The CLI's own `/api/search` and `/api/download` are unauthenticated but undocumented, and `/api/download` isn't tied to a version | "Reasonable use, including caching" of the public API; skills belong to their authors under their repositories' licences                                                      | Installs, partners' audits                                                                                                                                             | A GitHub repository                                                                               | **Used through ClawHub's index**, which lists skills.sh's skills with their audits; downloaded from GitHub at a commit        |
| **agentskills.io**                    | None: it's the specification, plus its own `/.well-known/agent-skills/index.json` with one skill                                                                                                              | —                                                                                                                                                                             | —                                                                                                                                                                      | —                                                                                                 | The format, not a source                                                                                                      |
| **LobeHub** (market.lobehub.com)      | Needs an OAuth client (`client_credentials` with a JWT); its OpenAPI document answered 500                                                                                                                    | No third-party terms found; `robots.txt` disallows `/api/`                                                                                                                    | Unverified                                                                                                                                                             | Unverified                                                                                        | **Skipped**: no published terms for this use, and nothing verifiable                                                          |
| **skillsmp.com**                      | 50 anonymous requests a day                                                                                                                                                                                   | None published                                                                                                                                                                | Repository stars, not the skill's                                                                                                                                      | GitHub                                                                                            | **Skipped**: too few requests, misleading popularity, no terms                                                                |
| **openai/skills**, claude-plugins.dev | GitHub; an unauthenticated JSON search                                                                                                                                                                        | Per skill (some under Figma's own terms); unchecked                                                                                                                           | —                                                                                                                                                                      | GitHub                                                                                            | Not now: the first is small and slow-moving, the second's terms unverified. Either is a new `MarketSource` when it's worth it |

## Decision

### 1. Three sources behind one interface

`skills/market/types.ts` `MarketSource`: `search`, `listing`, `fetch` (one
version, downloaded and checked) and `latest` (the newest pin, for updates).

- `AnthropicSource` reads `anthropics/skills` at its newest commit: one API
  call for the commit and one for its tree, kept six hours; each SKILL.md and
  licence comes from `raw.githubusercontent.com`. A skill whose licence is
  restrictive isn't listed at all.
- `ClawHubSource` searches with `nonSuspiciousOnly=true` and maps both its own
  skills and the skills.sh entries it indexes.
- `SkillsShSource` downloads skills.sh's skills from GitHub at a commit,
  finding the folder named after the skill (or whose SKILL.md gives that name).
- `PretendMarket` (the mock engine, `pnpm dev:mock`, end-to-end) serves made-up
  skills from memory: a clean one, a ClawHavoc copy, a flagged one, and one
  whose licence forbids copying.

`CONCH_SKILL_MARKET=on|off|pretend` (default `on`, `pretend` with the mock
engine). All traffic goes through the SSRF guard (`guardedFetch('public')`) and
`MarketHttp`, which allows only the source's own hosts (a redirect anywhere
else stops there), times out, and reads every body only up to a cap.

### 2. Pinned to exactly what was read

- **GitHub**: a branch or "the default" becomes a 40-hex commit first; only the
  commit is used from then on. The commit's tree lists every file with its git
  blob hash, size and mode. Each file is fetched from
  `raw.githubusercontent.com/<owner>/<repo>/<commit>/<path>` and must hash to
  `sha1("blob <size>\0" + bytes)`. Links (`120000`), submodules and hidden files
  are never fetched.
- **ClawHub**: a version's manifest lists each file's SHA-256; each file must
  match it, byte for byte and in size. ClawHub's generated `skill-card.md` and
  `_meta.json` aren't the author's and are left out.
- The pin is `{commit}` or `{version, sha256}`, where `sha256` is a
  fingerprint of every path and its hash (`contentKey`). A registry that serves
  different bytes for the version it lists stops the download; one that later
  serves something different for the version you already have is refused
  ("now serves something different for the version you have") and yours is
  kept.
- Limits: 200 files, 16 MB, 4 MB a file. A path out of the folder, a Windows
  device name, a drive or stream, a backslash, or the same name twice in
  different cases refuses the whole skill (`validRelPath`).

### 3. Read before it's added, and nothing runs

`POST /api/skills/market/preview` downloads one version into
`skills-market/.staging/<previewId>`, writes every file `0600` (never
executable, whatever git or the registry said), and reads it like any other
skill (`scanSkill`, ADR 0028). Nothing is executed: there are no install
scripts, no `npm install`, no hooks. Scripts a skill carries can only ever be
run later by the assistant, through the permission prompts, and only within
the skill's own list.

The scan learned ClawHavoc's other spellings: `bash -c "$(curl …)"`,
`curl … | python`, reverse shells (`/dev/tcp`, `nc -e`), "download the zip,
the password is …", paste sites (glot.io, pastebin's raw view…), bare IP
addresses, and other agents' key files (`~/.clawdbot/.env`,
`auth-profiles.json`, `~/.claude/.credentials.json`, `~/.codex/auth.json`).

What the registry warns about joins the findings as a `registry` finding: a
version its scanners call malicious, or its moderators blocked, is never added
(`blocked`); one a scanner says not to install, or that's marked suspicious, is
a danger finding.

The preview says, in plain words: what it does; what it will be able to do
(its `allowed-tools` or `permissions`, ADR 0031); what Conch found reading
every file; who published it and where, with what the place says (Official,
Verified publisher, Community, Flagged); the exact version; and its licence.

**Licences** are read from the skill itself (`license:` and a LICENSE file).
A registry's label is only a hint: ClawHub stamps everything MIT-0, including
a republished copy of Anthropic's proprietary `pdf` skill. A licence that only
allows use inside its maker's own apps blocks the install, and says so.

### 4. Added only as what was read

`POST /api/skills/market/install {previewId, mode, acknowledged?}`:

- the staging folder must still hash to what was read (`changed` otherwise,
  and it's thrown away);
- a worrying one (`danger`) needs `acknowledged` equal to that hash, as
  turning one on does (ADR 0028), which the UI sends only after a tick saying
  the person read what was found;
- it moves to `skills-market/<source>/<name>` and is turned on (or set to When
  I ask) pinned to that hash: any later change turns it off until someone looks
  ("Its files changed since you added it");
- a person's press: an access key (a script, the assistant's shell) gets 403
  `person-only`.

A name one of your skills already answers to gets its own folder and name
(`meeting-notes-2`, written into its SKILL.md before it's read), so `/name`
stays yours. Where it came from (`skills-market.json`: source, listing,
publisher, trust, pin, licence) is a protected path: an assistant that could
write it could give a skill a publisher or a check it never had.

Installed skills are ordinary skills from then on: the store reads them as
source `market`, read-only, so `use_skill`, `/name`, holding a chat to the
skill's list (ADR 0047) and Codex's tighter sealing work the same for every
provider. **Make a copy** makes an editable one; **Remove** takes it away.

### 5. Updates are read like the first time

At most once a day per skill, `latest()` compares the newest pin's
fingerprint with what you have (a new commit that didn't touch the skill's
folder isn't an update). An update is never taken by itself:
`POST /api/skills/:id/market/update/preview` downloads it, reads it, and
returns what's different, file by file with unified diffs, and whether it asks
to do more than before (`wider`: a new capability, or an "only" list that grew
or went), which is said first. `POST …/market/update` takes exactly that,
swaps the folder, keeps the mode (off stays off) and pins it again.

### 6. Discover on the Skills page

Skills has two tabs, **Your skills** and **Discover** (`/skills/discover`).
Discover has a search box (what's typed is in the address), the kinds
(Writing, Documents, Design, Research, Everyday, Coding, Data, Work: Conch
sorts each skill onto one from its own words), **Ideas** for someone who
doesn't know what to look for ("Turn notes into slides"), and the shelf.
A card says what it does in a line, its trust, where and who it's from, and
how many use it. Opening one (`/skills/discover/<id>`) reads it at once and
shows the preview with one button, **Add skill**, and **Use it: When it
fits / Only when I ask**. A worrying one shows **Add anyway** behind a tick;
a blocked one has no button, only why.

When a place can't be reached or asks to wait, the last answer is shown from
`skills-market-cache.json` with one quiet line ("These are from before"). A
`limited` source isn't asked again until it said it may be.

Nacre: `MarketShelf`, `MarketSkillCard`, `MarketIdeas`, `MarketCategories`,
`MarketSkillPreview`, `MarketTrustBadge`, and `OfferCard` `kind="market"`,
each with stories, play tests and axe.

### 7. From the chat (ADR 0060)

The map tells providers with tools about `find_skills`, and `offer` takes
`kind: "market"`.

- `find_skills({words})` searches with at most eight plain words. It returns
  each skill's id, its name as plain words, the shelf, the source and how many
  use it, and **never a stranger's description**: a listing can't steer the
  chat, so the tool doesn't taint it. Not in a chat that read something from
  outside, nor for nobody (routines, tasks, chat apps).
- `OfferDesk` shows a `market` offer only for a listing `find_skills` found,
  that its registry doesn't warn about and you don't have; the usual rules
  apply (not after reading something untrusted, once per chat, one per turn).
  **Don't suggest** mutes all of Discover's offers (`skill:market_discover`,
  in the shape older versions already accept).
- The card shows where it's from and its trust; **Look at it** opens the same
  read in a dialog; **Add and carry on** installs it, and the chat carries on
  with the skill, the prompt saying it was added from that place.

⌘K finds **Discover skills**, and skills people share by name (from the shelf
and, once typing pauses, a search), opening one to read.

### 8. Whole Conch

- **Backups**: `skills-market/**` and `skills-market.json` are kept (group
  skills); `skills-market/.staging/**` and `skills-market-cache.json` are
  derived.
- **Repair everything**: `skill-market` forgets an added skill whose folder is
  gone, clears looks nobody added, and says quietly when a place didn't answer.
- **Protected paths**: `skills-market.json`.

## Threat model

| Who                                      | Tries                                                                                       | Stopped by                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A malicious publisher                    | ClawHavoc prerequisites, `curl \| sh`, key theft, exfiltration, hidden characters, binaries | The scan (danger needs a tick and the exact hash), the registry's verdicts, the skill's held list, the prompts |
| The same, later                          | An update that adds a step                                                                  | Pins; updates are read with diffs and `wider` before they're taken; a changed folder turns off                 |
| A registry or a CDN                      | Serving other bytes than it lists, or changing a published version                          | Per-file git blob SHA-1 or SHA-256; the version's fingerprint compared on update                               |
| A hostile index                          | `../` paths, device names, links, case clashes, huge files                                  | `validRelPath`, mode filter, limits, refusing the whole skill                                                  |
| A redirect                               | Sending a download to another host or inside the network                                    | `MarketHttp`'s host list and the SSRF guard on every hop                                                       |
| A web page the chat read                 | Getting a skill offered or added                                                            | No `find_skills` or market offers after reading something from outside; adding is a person's press             |
| A listing's text                         | Prompt injection through `find_skills`                                                      | Only ids, plain names and Conch's own words reach the model                                                    |
| The assistant                            | Installing, forging where a skill came from                                                 | No install tool; `person-only` routes; `skills-market.json` is protected                                       |
| Someone republishing a proprietary skill | Getting it copied here                                                                      | The skill's own licence words win over the registry's label                                                    |

## Consequences

- People find, read and add a skill in two presses, from the Skills page,
  ⌘K or the chat, with any provider, and it holds to the same rules as every
  skill from elsewhere.
- **Known limits.**
  - GitHub allows 60 unauthenticated API calls an hour per address (a 304 is
    counted too). An install costs two, Anthropic's shelf two every six hours,
    an update check one per GitHub skill a day; `limited` answers back off.
  - skills.sh's skills are found only as ClawHub indexes them. Its own
    documented API needs a Vercel token Conch can't have.
  - The scan is a careful reader, not an antivirus (ADR 0028). The pin, the
    held list and the prompts are the other layers.
  - Windows Defender treats test files that spell out reverse shells as
    malware, so those tests assemble their samples at run time and read them in
    memory.

Sources followed: Koi Security's ClawHavoc report and The Hacker News'
coverage (Feb 2026); ClawHub's OpenAPI document and "public catalog reuse"
notes; the skills.sh terms and API docs; the Agent Skills specification
(agentskills.io); GitHub's REST API rate-limit and conditional-request docs;
OWASP Top 10 for LLM Applications 2025 (LLM01 prompt injection, LLM03 supply
chain); Greshake et al., "Not what you've signed up for" (2023).
