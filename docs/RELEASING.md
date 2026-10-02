# Releasing Conch

One command, one question. The details are in [ADR 0051](./adr/0051-releases.md).

## A release

```sh
pnpm release
```

1. **It checks it can.** You're on `main`, nothing is uncommitted, and you're
   level with `origin/main`. If not, it says the one command to run.
2. **It works out the version** from the commits since the last stable tag:
   - a breaking change is a new major (a new minor before 1.0);
   - a `feat` is a new minor;
   - anything else is a patch.
3. **It shows** the version, the notes (New, Better, Fixed, and Heads up for a
   breaking change) and the commits they came from.
4. **It asks:** `Release v0.3.0? (y/N)`. Nothing is written before you say yes.
5. **Then it does the rest:**
   - runs `pnpm check`;
   - sets the version in `package.json` and writes `CHANGELOG.md`;
   - commits `release: v0.3.0`;
   - makes a signed tag and checks it as installs will;
   - pushes the commit and the tag together;
   - makes the GitHub Release, if `gh` is installed.

## Betas and alphas

- `pnpm release beta` makes `v0.4.0-beta.1`, then `-beta.2`. `pnpm release
alpha` works the same way. A pre-release's notes say what's new since the
  last release its channel saw.
- **To promote a beta**, run plain `pnpm release`. It makes `v0.4.0`, with
  notes since the last stable release.

## Options

- `--dry-run` shows everything and changes nothing.
- `--version 0.4.0` uses that version instead of the one worked out.
- `--no-ai` keeps the notes as written from the commits. Without it, Claude
  Code (or `ANTHROPIC_API_KEY`) polishes them, held to the commits. If the
  polished version breaks a rule, the plain notes stand.

## The first time: a signing key

Every Conch checks that a release is signed by a key in
`release/allowed_signers`. If git has no SSH signing key, `pnpm release`
offers one from `~/.ssh` and sets it up for this repository only. To make
one, run `ssh-keygen -t ed25519`. The first release adds your key to the list.
If your key has a passphrase, run `ssh-add` first.

## Changing the key

Installs trust the list in the version they already have. So:

1. Add the new key's line to `release/allowed_signers` in a commit.
2. Release once more, **signed with the old key**.
3. Switch git to the new key. Remove the old line in a later release if you
   like.

## If a push fails

The release commit and the tag stay ready on your computer. Run the command it
prints, `git push --atomic origin main v0.3.0`. If only the GitHub Release
failed, run `gh release create v0.3.0 --notes-from-tag`.

## Commits that make good notes

- Write `feat` and `fix` subjects in the person's words: `feat(web): edit pages
by hand, with a live preview`, not what changed in the code.
- A feature's commits across protocol, server, Nacre and web become one line.
  The web app's subject is the one people read.
- For a breaking change, add a `BREAKING CHANGE:` footer that says what the
  person must do: `BREAKING CHANGE: Sign in again after updating.`
- `chore`, `test`, `docs`, `refactor`, `ci` and `build` never appear in the
  notes.
