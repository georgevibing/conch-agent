#!/bin/sh
# Lets Conch seal the assistant's commands on Linux (ADR 0028).
#
# It installs bubblewrap (the sandbox), socat and ripgrep with this system's
# own package manager. Where Ubuntu keeps programs from making a sandbox of
# their own (23.10 and later), it lets bubblewrap do it with an AppArmor
# profile, as Ubuntu documents. Then it checks that the sandbox works, as you.
#
# Run it with sudo. Every step is printed before it runs; nothing else changes.
set -eu

say() { printf '%s\n' "$*"; }
run() {
  printf '→ %s\n' "$*"
  "$@"
}

if [ "$(id -u)" -ne 0 ]; then
  say "This needs your administrator password. Run: sudo sh $0"
  exit 1
fi

have_all() {
  command -v bwrap >/dev/null 2>&1 &&
    command -v socat >/dev/null 2>&1 &&
    command -v rg >/dev/null 2>&1
}

if have_all; then
  say "bubblewrap, socat and ripgrep are already installed."
elif command -v apt-get >/dev/null 2>&1; then
  run apt-get update
  run apt-get install -y bubblewrap socat ripgrep
elif command -v dnf >/dev/null 2>&1; then
  run dnf install -y bubblewrap socat ripgrep
elif command -v pacman >/dev/null 2>&1; then
  run pacman -S --needed --noconfirm bubblewrap socat ripgrep
elif command -v zypper >/dev/null 2>&1; then
  run zypper --non-interactive install bubblewrap socat ripgrep
elif command -v apk >/dev/null 2>&1; then
  run apk add bubblewrap socat ripgrep
else
  say "Conch doesn't know this system's package manager. Install bubblewrap, socat and ripgrep with it, then run this again."
  exit 1
fi

# Ubuntu 23.10+ lets a program make its own user namespace (what bubblewrap's
# sandbox is) only when an AppArmor profile says it may.
restricted=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
bwrap=$(command -v bwrap)
allowed=
if [ "$restricted" = 1 ] && [ -d /etc/apparmor.d ]; then
  # A profile for bubblewrap that already allows it (Ubuntu's own, or ours from before).
  for existing in $(grep -lsF "$bwrap" /etc/apparmor.d/* 2>/dev/null || true); do
    if grep -qs 'userns' "$existing"; then allowed=1; fi
  done
fi
if [ "$restricted" = 1 ] && [ -d /etc/apparmor.d ] && [ -z "$allowed" ]; then
  profile=/etc/apparmor.d/conch-bwrap
  say "→ letting $bwrap make its sandbox ($profile)"
  cat >"$profile" <<EOF
# Written by Conch's seal-commands.sh: bubblewrap may make the user namespace
# its sandbox needs. Remove this file and reload AppArmor to undo.
abi <abi/4.0>,
include <tunables/global>

profile conch-bwrap $bwrap flags=(unconfined) {
  userns,

  include if exists <local/conch-bwrap>
}
EOF
  run apparmor_parser -r "$profile"
fi

# The check Conch itself makes, as the person who asked (root is never restricted).
bwrap=$(command -v bwrap)
check='"$0" --unshare-user --unshare-pid --unshare-net --ro-bind / / -- /bin/true'
as_you() {
  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    if command -v runuser >/dev/null 2>&1; then
      runuser -u "$SUDO_USER" -- sh -c "$check" "$bwrap"
    else
      su -s /bin/sh "$SUDO_USER" -c "$check" -- "$bwrap"
    fi
  else
    sh -c "$check" "$bwrap"
  fi
}
if as_you >/dev/null 2>&1; then
  say "Done. Conch seals the assistant's commands from now on."
else
  say "bubblewrap is installed, but this computer won't let it make its sandbox (a container often can't)."
  say "Conch carries on, and asks before each command runs with your access."
  exit 1
fi
