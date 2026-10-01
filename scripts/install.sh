#!/bin/sh
# Conch, installed with one line (ADR 0026):
#
#   curl -fsSL https://raw.githubusercontent.com/giotiskl/conch-agent/main/scripts/install.sh | sh
#
# It gets what Conch needs (Node.js and Git, when they're missing), puts
# Conch in its own folder, builds it, keeps it running in the background,
# adds "Conch" to your apps and opens it. Nothing needs an administrator.
# Run it again any time: it updates Conch and repairs anything that moved.
#
#   sh install.sh [--no-background] [--no-shortcut] [--no-open] [--dir PATH]
#   sh install.sh --uninstall [--delete-data]
#
# Settings from the environment: CONCH_REPO, CONCH_BRANCH, CONCH_DIR, CONCH_HOME.

set -eu

NODE_MAJOR=24
REPO=${CONCH_REPO:-https://github.com/giotiskl/conch-agent.git}
BRANCH=${CONCH_BRANCH:-main}
HOME_DIR=${CONCH_HOME:-$HOME/.conch}
BACKGROUND=1
SHORTCUT=1
OPEN=1
UNINSTALL=
DELETE_DATA=

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
    --dir) shift; DIR=$1 ;;
    --dir=*) DIR=${1#--dir=} ;;
    --uninstall) UNINSTALL=1 ;;
    --delete-data) DELETE_DATA=1 ;;
    -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (try --help)" >&2; exit 1 ;;
  esac
  shift
done

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
ask() {
  printf '  %s ' "$1"
  if [ -r /dev/tty ]; then read -r REPLY < /dev/tty || REPLY=; else REPLY=; fi
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
    "Conch lives in your own folders and runs as you; it never needs an administrator."
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
  if [ "$OS" = darwin ]; then
    if command -v brew >/dev/null 2>&1; then
      step "Getting Git with Homebrew"
      quietly brew install git || fail "Homebrew couldn't install Git." "Run: brew install git"
      return
    fi
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
    ask "Install Git now? [Y/n]"
    case "$REPLY" in [nN]*) fail "Conch needs Git." "Run: $CMD, then run this again." ;; esac
    # shellcheck disable=SC2086
    $CMD < /dev/tty || fail "Git didn't install." "Run: $CMD, then run this again."
    return
  done
  fail "Conch needs Git." "Install Git with your system's package manager, then run this again."
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

conch() { (cd "$DIR" && pnpm_run --silent --filter @conch/server conch "$@"); }

# ── Uninstall ────────────────────────────────────────────────────────────

if [ -n "$UNINSTALL" ]; then
  NODE=$(find_node || true)
  if [ -n "$NODE" ] && [ -f "$DIR/package.json" ]; then
    PATH="$(dirname "$NODE"):$PATH"
    # Quit first: then turning Always on off also unloads it from the computer.
    conch quit >/dev/null 2>&1 || true
    conch background off >/dev/null 2>&1 || true
    conch shortcut remove >/dev/null 2>&1 || true
    ok "Conch has stopped and won't start at login"
  fi
  rm -rf "$DIR"
  ok "Removed Conch from $DIR"
  if [ -n "$DELETE_DATA" ]; then
    say "This also deletes your chats, memories, routines, settings and passwords in $HOME_DIR."
    ask "Type ${BOLD}delete${RESET} to delete them for good:"
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
  step "Updating Conch"
  if [ -n "$(git -C "$DIR" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    warn "Conch's folder has changes of its own, so it stays as it is."
  else
    quietly git -C "$DIR" pull --ff-only || warn "Conch couldn't update just now; it carries on with the version it has."
  fi
else
  step "Getting Conch"
  mkdir -p "$(dirname "$DIR")"
  quietly git clone --branch "$BRANCH" "$REPO" "$DIR" ||
    fail "Conch couldn't be downloaded." "Check your internet connection, then run this again."
fi
ok "Conch $(sed -n "s/.*SERVER_VERSION = '\([^']*\)'.*/\1/p" "$DIR/apps/server/src/version.ts" | head -n 1) ${DIM}(in $DIR)${RESET}"

step "Installing what Conch uses (a minute or two the first time)"
(cd "$DIR" && quietly pnpm_run install --frozen-lockfile) ||
  fail "Installing didn't finish." "Run this again; the lines above say what went wrong."
step "Building the app"
(cd "$DIR" && quietly pnpm_run --filter @conch/web build) ||
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

printf '\n  %sConch is ready%s at %s\n' "$BOLD" "$RESET" "$URL"
if [ -n "$BACKGROUND" ]; then
  if [ "$OS" = darwin ]; then say "${DIM}Open it any time from Applications or Spotlight: just type Conch.${RESET}"
  else say "${DIM}Open it any time from your apps.${RESET}"; fi
else
  if command -v pnpm >/dev/null 2>&1; then START="pnpm start"; else START="corepack pnpm start"; fi
  say "${DIM}Start it with: cd \"$DIR\" && $START${RESET}"
fi
printf '\n'
if [ -n "$OPEN" ] && [ -n "$BACKGROUND" ]; then
  if [ "$OS" = darwin ]; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true; fi
fi
