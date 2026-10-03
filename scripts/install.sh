#!/bin/sh
# Conch, installed with one line (ADR 0026):
#
#   curl -fsSL https://conchagent.com/install.sh | sh
#
# (the same file as scripts/install.sh on GitHub, served by the website)
#
# It gets what Conch needs (Node.js and Git, when they're missing), puts
# Conch in its own folder, builds it, keeps it running in the background,
# adds "Conch" to your apps and opens it. System packages ask for permission;
# Conch itself always runs as you.
# It installs the newest stable release (ADR 0051), checked against the
# signing keys Conch ships; after that Conch updates itself.
# Run it again any time: it repairs anything that moved.
#
#   sh install.sh [--no-background] [--no-shortcut] [--no-open] [--dir PATH]
#   sh install.sh --no-system-packages   skip optional system-package setup
#   sh install.sh --server     a little computer: headless, keeps running, your phone's address
#   sh install.sh --uninstall [--delete-data]
#
# Settings from the environment: CONCH_REPO, CONCH_DIR, CONCH_HOME,
#   CONCH_CHANNEL=beta|alpha   also take beta (or alpha) releases
#   CONCH_BRANCH=main          a developer's copy: follow a branch, every change

set -eu

NODE_MAJOR=24
REPO=${CONCH_REPO:-https://github.com/georgevibing/conch-agent.git}
BRANCH=${CONCH_BRANCH:-main}
CHANNEL=${CONCH_CHANNEL:-stable}
HOME_DIR=${CONCH_HOME:-$HOME/.conch}
BACKGROUND=1
SHORTCUT=1
OPEN=1
UNINSTALL=
DELETE_DATA=
SERVER=
SYSTEM_PACKAGES=1

case "$(uname -s)" in
  Darwin) OS=darwin; DEFAULT_DIR="$HOME/Library/Application Support/Conch/app" ;;
  Linux) OS=linux; DEFAULT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/conch/app" ;;
  *) echo "Conch's installer runs on macOS and Linux. On Windows, use install.ps1." >&2; exit 1 ;;
esac
DIR=${CONCH_DIR:-$DEFAULT_DIR}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-background) BACKGROUND= ;;
    --no-shortcut) SHORTCUT= ;;
    --no-open) OPEN= ;;
    --no-system-packages) SYSTEM_PACKAGES= ;;
    --dir) shift; DIR=$1 ;;
    --dir=*) DIR=${1#--dir=} ;;
    --uninstall) UNINSTALL=1 ;;
    --server) SERVER=1; OPEN=; SHORTCUT= ;;
    --delete-data) DELETE_DATA=1 ;;
    -h|--help)
      printf '%s\n' 'Conch installer: --no-background --no-shortcut --no-open --dir PATH' \
        '  Installs the newest stable release; CONCH_CHANNEL=beta or alpha for earlier ones,' \
        '  CONCH_BRANCH=main for a developer'"'"'s copy that follows every change.' \
        '  --no-system-packages  Skip optional system packages (Git must already be installed)' \
        '  --server             Headless setup for a computer that stays on' \
        '  --uninstall [--delete-data]'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
  shift
done

case "$CHANNEL" in
  stable|beta|alpha) ;;
  *) echo "CONCH_CHANNEL can be stable, beta or alpha (not $CHANNEL)." >&2; exit 1 ;;
esac

# ── Saying things ────────────────────────────────────────────────────────

if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); GREEN=$(printf '\033[32m')
  YELLOW=$(printf '\033[33m'); RED=$(printf '\033[31m'); RESET=$(printf '\033[0m')
else
  BOLD=; DIM=; GREEN=; YELLOW=; RED=; RESET=
fi
say() { printf '  %s\n' "$*"; }
ok() { printf '  %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
step() { printf '  %s…%s %s\n' "$DIM" "$RESET" "$*"; }
warn() { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() {
  printf '\n  %s✗ %s%s\n' "$RED" "$1" "$RESET" >&2
  [ $# -gt 1 ] && printf '    %s\n' "$2" >&2
  printf '\n' >&2
  exit 1
}
# Questions come from the keyboard even when this script arrives through a pipe.
has_keyboard() { ( : < /dev/tty ) 2>/dev/null; }
ask() {
  REPLY=n
  has_keyboard || return 1
  printf '  %s ' "$1"
  read -r REPLY < /dev/tty || { REPLY=n; return 1; }
}
LOG=$(mktemp "${TMPDIR:-/tmp}/conch-install.XXXXXX")
trap 'rm -f "$LOG"' EXIT
# Run a step quietly; on failure, show what it said.
quietly() {
  if ! "$@" >"$LOG" 2>&1; then
    tail -n 25 "$LOG" | sed 's/^/    /' >&2
    return 1
  fi
}

printf '\n  %s🐚  Conch%s\n\n' "$BOLD" "$RESET"

if [ "$(id -u)" = 0 ]; then
  fail "Run this as yourself, not with sudo." \
    "Conch runs as you. The installer asks separately if it needs to install system packages."
fi

# ── Node.js ──────────────────────────────────────────────────────────────

recent_node() {
  [ -n "$1" ] && [ -x "$1" ] &&
    "$1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NODE_MAJOR ? 0 : 1)" 2>/dev/null
}

find_node() {
  for candidate in "$HOME_DIR/runtime/node/bin/node" "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
    if recent_node "$candidate"; then echo "$candidate"; return 0; fi
  done
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node "$HOME"/.local/share/fnm/node-versions/v*/installation/bin/node; do
    if recent_node "$candidate"; then FOUND=$candidate; fi
  done
  [ -n "${FOUND:-}" ] && echo "$FOUND"
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else sha256sum "$1" | cut -d' ' -f1; fi
}

download() { curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$@"; }

# Node from nodejs.org into Conch's own folder: no administrator, nothing else touched.
get_node() {
  case "$(uname -m)" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64) ARCH=x64 ;;
    *) fail "Conch can't get Node.js for this computer ($(uname -m))." "Install Node.js $NODE_MAJOR or newer from https://nodejs.org, then run this again." ;;
  esac
  BASE="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  SUMS=$(download "$BASE/SHASUMS256.txt") || fail "Conch couldn't reach nodejs.org." "Check your internet connection, then run this again."
  FILE=$(printf '%s\n' "$SUMS" | awk '{print $2}' | grep -E "^node-v$NODE_MAJOR\.[0-9.]+-$OS-$ARCH\.tar\.gz$" | head -n 1)
  [ -n "$FILE" ] || fail "nodejs.org has no Node.js $NODE_MAJOR for this computer." "Install it from https://nodejs.org, then run this again."
  WANT=$(printf '%s\n' "$SUMS" | awk -v f="$FILE" '$2 == f {print $1}')
  TMP=$(mktemp -d "${TMPDIR:-/tmp}/conch-node.XXXXXX")
  download -o "$TMP/$FILE" "$BASE/$FILE" || fail "Downloading Node.js didn't finish." "Check your internet connection, then run this again."
  # The checksum list and the download must agree, byte for byte.
  [ "$(sha256 "$TMP/$FILE")" = "$WANT" ] || { rm -rf "$TMP"; fail "The Node.js download didn't match its checksum, so Conch threw it away." "Run this again; if it keeps happening, your network may be changing downloads."; }
  mkdir -p "$HOME_DIR/runtime"
  tar -xzf "$TMP/$FILE" -C "$HOME_DIR/runtime"
  rm -rf "$TMP"
  rm -f "$HOME_DIR/runtime/node"
  ln -s "$HOME_DIR/runtime/${FILE%.tar.gz}" "$HOME_DIR/runtime/node"
}

# ── Git ──────────────────────────────────────────────────────────────────

has_git() {
  if [ "$OS" = darwin ] && [ "$(command -v git)" = /usr/bin/git ]; then
    # /usr/bin/git is only a placeholder until the Command Line Tools are installed.
    xcode-select -p >/dev/null 2>&1
  else
    command -v git >/dev/null 2>&1
  fi
}

get_git() {
  [ -n "$SYSTEM_PACKAGES" ] || fail "Conch needs Git before it can continue." \
    "Install Git, or run this again without --no-system-packages."
  if [ "$OS" = darwin ]; then
    if command -v brew >/dev/null 2>&1; then
      step "Getting Git with Homebrew"
      quietly brew install git || fail "Homebrew couldn't install Git." "Run: brew install git"
      return
    fi
    has_keyboard || fail "Conch needs Git, which comes with Apple's Command Line Tools." \
      "Run: xcode-select --install, then run this again."
    say "Conch needs Git, which comes with Apple's Command Line Tools."
    say "${BOLD}A window opens now: press Install, and Conch carries on when it's done.${RESET}"
    xcode-select --install >/dev/null 2>&1 || true
    i=0
    until xcode-select -p >/dev/null 2>&1; do
      i=$((i + 1))
      [ $i -gt 720 ] && fail "The Command Line Tools didn't finish installing." "Run: xcode-select --install, then run this again."
      sleep 5
    done
    return
  fi
  for manager in apt-get dnf pacman zypper apk; do
    command -v "$manager" >/dev/null 2>&1 || continue
    case "$manager" in
      apt-get) CMD="sudo apt-get install -y git" ;;
      dnf) CMD="sudo dnf install -y git" ;;
      pacman) CMD="sudo pacman -S --noconfirm git" ;;
      zypper) CMD="sudo zypper install -y git" ;;
      apk) CMD="sudo apk add git" ;;
    esac
    say "Conch needs Git. Installing it needs your password once:"
    say "${DIM}$CMD${RESET}"
    command -v sudo >/dev/null 2>&1 && ask "Install Git now? [Y/n]" ||
      fail "Conch needs Git before it can continue." "Run: $CMD, then run this again."
    case "$REPLY" in [nN]*) fail "Conch needs Git." "Run: $CMD, then run this again." ;; esac
    # shellcheck disable=SC2086
    $CMD < /dev/tty || fail "Git didn't install." "Run: $CMD, then run this again."
    return
  done
  fail "Conch needs Git." "Install Git with your system's package manager, then run this again."
}

# >>> releases (install.test.mjs runs this part on its own)
# The release to install, from a list of tags on stdin: vX.Y.Z is stable,
# vX.Y.Z-beta.N and vX.Y.Z-alpha.N are pre-releases. Stable takes only
# stable, beta also takes betas, alpha everything; the newest wins, in
# semver's order (0.10.0 after 0.9.0, beta.10 after beta.2, a release after
# its betas). Anything else that looks like a tag is passed over.
pick_release() {
  _channel=${1:-stable}
  while IFS= read -r _tag; do
    _v=${_tag#v}
    [ "v$_v" = "$_tag" ] || continue
    _num='(0|[1-9][0-9]{0,5})'
    if printf '%s\n' "$_v" | grep -Eq "^$_num\.$_num\.$_num\$"; then
      _core=$_v; _rank=3; _n=0
    elif printf '%s\n' "$_v" | grep -Eq "^$_num\.$_num\.$_num-(alpha|beta)\.[1-9][0-9]{0,4}\$"; then
      _core=${_v%%-*}; _pre=${_v#*-}; _n=${_pre#*.}
      case "${_pre%%.*}" in
        beta) _rank=2; [ "$_channel" = stable ] && continue ;;
        *) _rank=1; [ "$_channel" = alpha ] || continue ;;
      esac
    else
      continue
    fi
    _major=${_core%%.*}; _rest=${_core#*.}
    printf '%06d %06d %06d %d %05d %s\n' "$_major" "${_rest%%.*}" "${_rest#*.}" "$_rank" "$_n" "$_tag"
  done | sort | tail -n 1 | sed 's/.* //'
}

# git 2.34 or newer checks SSH signatures.
git_checks_ssh() {
  _gv=$(git --version 2>/dev/null | sed -n 's/^git version \([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p')
  [ -n "$_gv" ] || return 1
  set -- $_gv
  [ "$1" -gt 2 ] || { [ "$1" -eq 2 ] && [ "$2" -ge 34 ]; }
}
# <<< releases

# The release must be signed by a key Conch's own list names. On a first
# install the list comes from the same place as the release (GitHub, over
# HTTPS), so this catches a tag that was never signed or signed by someone
# else; after that, Conch checks every update against the list it already has.
verify_release() {
  SIGNERS="$DIR/release/allowed_signers"
  if [ ! -f "$SIGNERS" ] || ! grep -Eq '^[^#]*(ssh-ed25519|ssh-rsa|ecdsa-sha2-|sk-ssh-ed25519|sk-ecdsa-sha2-)' "$SIGNERS"; then
    warn "Conch doesn't name its signing keys yet, so this release's signature can't be checked."
    return 0
  fi
  if ! command -v ssh-keygen >/dev/null 2>&1 || ! git_checks_ssh; then
    warn "This computer's Git can't check signatures (it needs Git 2.34 and ssh-keygen), so the release isn't checked."
    return 0
  fi
  if ! git -C "$DIR" -c gpg.format=ssh -c gpg.ssh.allowedSignersFile="$SIGNERS" \
    -c gpg.ssh.program=ssh-keygen verify-tag "$1" >"$LOG" 2>&1; then
    rm -rf "$DIR"
    fail "This release of Conch isn't signed by Conch's makers, so the installer stopped." \
      "Nothing of yours was changed. Try again later, or tell Conch's makers."
  fi
}

# Conch's version, as its folder writes it.
conch_version() {
  _version=$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "$1/package.json" 2>/dev/null | head -n 1)
  [ -n "$_version" ] || _version=$(sed -n "s/.*SERVER_VERSION = '\([^']*\)'.*/\1/p" "$1/apps/server/src/version.ts" 2>/dev/null | head -n 1)
  echo "$_version"
}

# ── pnpm, through Node's own corepack ────────────────────────────────────

pnpm_run() {
  if command -v corepack >/dev/null 2>&1; then
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm "$@"
  else
    VERSION=$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' "$DIR/package.json")
    npm exec --yes -- "pnpm@${VERSION:-latest}" "$@"
  fi
}

conch() { (cd "$RUN_DIR" && pnpm_run --silent --filter @conch/server conch "$@"); }
RUN_DIR=$DIR

# ── Uninstall ────────────────────────────────────────────────────────────

if [ -n "$UNINSTALL" ]; then
  NODE=$(find_node || true)
  if [ -n "$NODE" ] && [ -f "$DIR/package.json" ]; then
    PATH="$(dirname "$NODE"):$PATH"
    # Quit first: then turning Always on off also unloads it from the computer.
    conch quit >/dev/null 2>&1 || true
    conch background off >/dev/null 2>&1 || true
    conch tray off >/dev/null 2>&1 || true
    conch shortcut remove >/dev/null 2>&1 || true
    ok "Conch has stopped and won't start at login"
  fi
  rm -rf "$DIR"
  # The versions Conch's updates made ready (ADR 0051) are Conch's code, not your data.
  rm -rf "$HOME_DIR/versions"
  ok "Removed Conch from $DIR"
  if [ -n "$DELETE_DATA" ]; then
    say "This also deletes your chats, memories, routines, settings and passwords in $HOME_DIR."
    ask "Type ${BOLD}delete${RESET} to delete them for good:" || true
    if [ "$REPLY" = delete ]; then rm -rf "$HOME_DIR"; ok "Deleted $HOME_DIR"
    else say "Kept $HOME_DIR."; fi
  else
    say "${DIM}Your chats and settings are still in $HOME_DIR, for when you come back.${RESET}"
  fi
  printf '\n'
  exit 0
fi

# ── Install ──────────────────────────────────────────────────────────────

NODE=$(find_node || true)
if [ -n "$NODE" ] && [ -z "${CONCH_FORCE_NODE_DOWNLOAD:-}" ]; then
  ok "Node.js $("$NODE" -v | sed 's/^v//')"
else
  step "Getting Node.js $NODE_MAJOR"
  get_node
  NODE="$HOME_DIR/runtime/node/bin/node"
  ok "Node.js $("$NODE" -v | sed 's/^v//') ${DIM}(in $HOME_DIR/runtime)${RESET}"
fi
PATH="$(dirname "$NODE"):$PATH"
export PATH

if ! has_git; then get_git; fi
ok "Git"

if [ -d "$DIR/.git" ]; then
  # A release swapped in by Conch's own updates is the one that runs (ADR 0051).
  CURRENT=
  [ -f "$HOME_DIR/versions/current" ] && CURRENT=$(head -n 1 "$HOME_DIR/versions/current")
  if [ -n "$CURRENT" ] && [ -f "$CURRENT/apps/server/src/start.ts" ]; then
    RUN_DIR=$CURRENT
    say "${DIM}Conch updates itself: Settings → Health → Updates.${RESET}"
  elif ! git -C "$DIR" symbolic-ref -q HEAD >/dev/null 2>&1; then
    say "${DIM}Conch updates itself: Settings → Health → Updates.${RESET}"
  else
    step "Updating Conch"
    if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
      warn "Conch's folder has changes of its own, so it stays as it is."
    else
      quietly git -C "$DIR" pull --ff-only || warn "Conch couldn't update just now; it carries on with the version it has."
    fi
  fi
elif [ -n "${CONCH_BRANCH:-}" ]; then
  # A developer's copy: this branch, every change on it.
  step "Getting Conch ($BRANCH)"
  mkdir -p "$(dirname "$DIR")"
  quietly git clone --branch "$BRANCH" "$REPO" "$DIR" ||
    fail "Conch couldn't be downloaded." "Check your internet connection, then run this again."
  git -C "$DIR" config conch.follow branch
else
  step "Getting Conch"
  mkdir -p "$(dirname "$DIR")"
  quietly git clone --branch "$BRANCH" "$REPO" "$DIR" ||
    fail "Conch couldn't be downloaded." "Check your internet connection, then run this again."
  TAG=$(git -C "$DIR" tag -l 'v*' | pick_release "$CHANNEL")
  if [ -n "$TAG" ]; then
    verify_release "$TAG"
    quietly git -C "$DIR" -c advice.detachedHead=false checkout --quiet --detach "$TAG" ||
      fail "Conch couldn't open release $TAG." "Run this again; the lines above say what went wrong."
    [ "$CHANNEL" = stable ] || git -C "$DIR" config conch.channel "$CHANNEL"
  else
    # Before Conch's first release, it follows main, as it always did.
    say "${DIM}Conch has no releases yet, so it follows every change.${RESET}"
  fi
fi
ok "Conch $(conch_version "$RUN_DIR") ${DIM}(in $RUN_DIR)${RESET}"

# Sourced from the checkout so the one-line installer also works through a pipe.
# Older branches may not have this optional setup yet.
if [ -f "$RUN_DIR/scripts/install-prerequisites.sh" ]; then
  . "$RUN_DIR/scripts/install-prerequisites.sh"
  ensure_terminal_prerequisites
fi

step "Installing what Conch uses (a minute or two the first time)"
(cd "$RUN_DIR" && quietly pnpm_run install --frozen-lockfile --config.confirmModulesPurge=false) ||
  fail "Installing didn't finish." "Run this again; the lines above say what went wrong."
# Check the installed backend, not just whether a compiler was found. Optional
# native builds can still fail (network, platform, ABI); the fallback is usable.
if TERMINAL=$(cd "$RUN_DIR" && pnpm_run --silent --filter @conch/server exec tsx -e \
  "import { loadBackend } from './src/terminal/backend.ts'; console.log(loadBackend(() => {}).kind)" 2>"$LOG"); then
  case "$TERMINAL" in
    pty) ok "Full terminal ready" ;;
    python) ok "Full terminal ready (using Python; no native build needed)" ;;
    basic) warn "Terminal commands work in basic mode; full-screen programs need Python or the native terminal tools." ;;
    *) warn "Conch will choose the best available terminal when it starts." ;;
  esac
else
  warn "The terminal check couldn't finish; Conch will check again when it starts."
fi
step "Building the app"
(cd "$RUN_DIR" && quietly pnpm_run --filter @conch/web build) ||
  fail "Building Conch didn't finish." "Run this again; the lines above say what went wrong."
ok "Installed"

if [ -n "$SHORTCUT" ]; then
  if conch shortcut >"$LOG" 2>&1; then ok "$(sed -n 's/.*✓ //p' "$LOG" | head -n 1)"
  else warn "Conch couldn't add itself to your apps; open it at http://localhost:4317."; fi
fi

URL=http://localhost:4317
if [ -n "$BACKGROUND" ]; then
  step "Starting Conch"
  if conch background on >"$LOG" 2>&1; then
    URL=$(sed -n 's/.*\(http:\/\/[^ ]*\).*/\1/p' "$LOG" | head -n 1)
    URL=${URL:-http://localhost:4317}
    ok "Conch is running, and starts by itself when you log in"
  else
    sed 's/^/    /' "$LOG" >&2
    fail "Conch didn't start." "Run it by hand to see why: cd \"$DIR\" && corepack pnpm start"
  fi
fi

# A little computer (ADR 0029): keeps going with nobody logged in, and your phone can reach it.
if [ -n "$SERVER" ]; then
  if [ "$OS" = linux ]; then
    if conch background after-logout on >"$LOG" 2>&1; then ok "Conch keeps running after you log out"
    else sed 's/^/  /' "$LOG"; fi
  else
    say "${DIM}A Mac stops Conch when you log out: turn on automatic login in System Settings → Users & Groups.${RESET}"
  fi
  if [ -r /dev/tty ] && conch status 2>/dev/null | grep -q 'No sign-in'; then
    say "Your phone signs in with a password. Choose one now:"
    conch password < /dev/tty || true
  fi
  if conch phone >"$LOG" 2>&1; then
    sed 's/^/  /' "$LOG"
    conch pair || true
  else
    sed 's/^/  /' "$LOG"
    say "${DIM}When that's done: pnpm conch phone, then pnpm conch pair.${RESET}"
  fi
fi

printf '\n  %sConch is ready%s at %s\n' "$BOLD" "$RESET" "$URL"
if [ -n "$BACKGROUND" ]; then
  if [ "$OS" = darwin ]; then say "${DIM}Open it any time from Applications or Spotlight: just type Conch.${RESET}"
  else say "${DIM}Open it any time from your apps.${RESET}"; fi
else
  if command -v pnpm >/dev/null 2>&1; then START="pnpm start"; else START="corepack pnpm start"; fi
  say "${DIM}Start it with: cd \"$DIR\" && $START${RESET}"
fi
printf '\n'
# It opens as this computer (ADR 0063): `pnpm conch open` hands the browser a one-time link.
if [ -n "$OPEN" ] && [ -n "$BACKGROUND" ]; then
  if ! conch open >/dev/null 2>&1; then
    if [ "$OS" = darwin ]; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
  fi
fi
