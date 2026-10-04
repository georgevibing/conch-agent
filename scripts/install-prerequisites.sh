#!/bin/sh
# Optional terminal setup, sourced by install.sh after cloning. No top-level
# effects. Every system change is shown and approved at a real keyboard first.
# node-pty is optional: a missing tool must never prevent Conch from installing.

terminal_python() {
  for terminal_python_name in python3 python; do
    if "$terminal_python_name" -c 'import sys, pty, termios, fcntl; sys.exit(0 if sys.version_info.major == 3 else 1)' >/dev/null 2>&1; then
      return 0
    fi
  done
  return 1
}

terminal_compilers() {
  # Apple's /usr/bin tools can be placeholders which open an installer dialog.
  if [ "$OS" = darwin ]; then xcode-select -p >/dev/null 2>&1 || return 1; fi
  command -v make >/dev/null 2>&1 &&
    { command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || command -v clang >/dev/null 2>&1; } &&
    { command -v c++ >/dev/null 2>&1 || command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1; }
}

terminal_fallback() {
  if terminal_python; then
    say "Continuing with Python available for full terminals if the native build can't run."
  else
    warn "Continuing without terminal build tools. If the native terminal can't load, commands still work in basic mode."
    say "Install Python 3 for full terminals, then restart Conch. No reinstall needed."
  fi
}

# Never capture passwords or feed them to sudo. This is the person's terminal.
terminal_command() { "$@" < /dev/tty; }

ensure_terminal_prerequisites() {
  if terminal_compilers && terminal_python; then
    ok "Terminal build tools ready"
    return 0
  fi
  step "Checking what the terminal needs"
  if [ -z "$SYSTEM_PACKAGES" ]; then terminal_fallback; return 0; fi

  if [ "$OS" = darwin ]; then
    # Homebrew can supply Python. Apple's tools supply make and clang, often
    # Python too. Don't install a second Python when the first step supplied it.
    if ! terminal_compilers; then
      say "Full terminals can use Apple's Command Line Tools. The command is: xcode-select --install"
      if has_keyboard && ask "Open Apple's installer now? [Y/n]"; then
        case "$REPLY" in
          ''|[yY]|[yY][eE][sS])
            if terminal_command xcode-select --install; then
              say "Finish Apple's installation. Conch will wait up to 15 minutes."
              terminal_wait=0
              until terminal_compilers; do
                terminal_wait=$((terminal_wait + 1))
                [ "$terminal_wait" -ge 180 ] && break
                sleep 5
              done
            else
              warn "Apple's installer didn't start. Conch will use a fallback."
            fi ;;
        esac
      fi
    fi
    if ! terminal_python; then
      say "Python 3 lets full terminals work without compiling anything."
      if command -v brew >/dev/null 2>&1; then
        say "The command is: brew install python"
        if has_keyboard && ask "Install Python now? [Y/n]"; then
          case "$REPLY" in
            ''|[yY]|[yY][eE][sS])
              terminal_command brew install python || warn "Python didn't install. Conch will use a fallback." ;;
          esac
        fi
      else
        say "You can get Python later at https://www.python.org/downloads/macos/."
      fi
    fi
    if terminal_compilers && terminal_python; then ok "Terminal build tools ready"
    else terminal_fallback; fi
    return 0
  fi

  # Fixed package-manager arguments only. No eval, repositories added, upgrades,
  # lifecycle scripts as root, or automatic elevation on an unattended run.
  terminal_manager=
  for terminal_candidate in apt-get dnf pacman zypper apk; do
    if command -v "$terminal_candidate" >/dev/null 2>&1; then
      terminal_manager=$terminal_candidate
      break
    fi
  done
  case "$terminal_manager" in
    apt-get) set -- apt-get install -y build-essential python3 ;;
    dnf) set -- dnf install -y make gcc gcc-c++ python3 ;;
    pacman) set -- pacman -S --needed --noconfirm base-devel python ;;
    zypper) set -- zypper --non-interactive install make gcc gcc-c++ python3 ;;
    apk) set -- apk add build-base python3 ;;
    *)
      say "This package manager isn't supported yet. You can install Python 3 and C/C++ build tools with it later."
      terminal_fallback
      return 0 ;;
  esac
  say "Conch can install the tools for full terminals. Only this step uses your administrator password."
  if [ "$terminal_manager" = apt-get ]; then say "sudo apt-get update"; fi
  say "sudo $*"
  if ! command -v sudo >/dev/null 2>&1 || ! has_keyboard; then
    say "No administrator prompt is available here; no system packages were changed."
    terminal_fallback
    return 0
  fi
  if ask "Install these tools now? [Y/n]"; then
    case "$REPLY" in ''|[yY]|[yY][eE][sS]) ;; *) terminal_fallback; return 0 ;; esac
  else
    terminal_fallback
    return 0
  fi
  if ! terminal_command sudo -v; then
    warn "Administrator access wasn't granted; continuing without changing system packages."
    terminal_fallback
    return 0
  fi
  if [ "$terminal_manager" = apt-get ] && ! terminal_command sudo -n apt-get update; then
    warn "The package list couldn't be refreshed; continuing with the terminal fallback."
    terminal_fallback
    return 0
  fi
  if terminal_command sudo -n "$@"; then
    if terminal_compilers && terminal_python; then
      ok "Terminal build tools ready"
      return 0
    fi
    warn "The package manager finished, but some terminal tools still aren't available."
  else
    warn "The terminal tools didn't finish installing. Conch can still be installed."
  fi
  terminal_fallback
}

# Sealed commands on Linux (ADR 0028): bubblewrap, socat and ripgrep, and on
# Ubuntu 23.10+ an AppArmor profile that lets the system's bubblewrap make its
# sandbox. Only an administrator can do it, so it's asked once here. Fixed
# arguments only, shown before they run: nothing is read from a file the
# assistant could change (the checkout is yours to write, so the assistant's too).
ensure_command_sandbox() {
  [ "$OS" = linux ] || return 0
  sandbox_ready() {
    command -v bwrap >/dev/null 2>&1 && command -v socat >/dev/null 2>&1 &&
      command -v rg >/dev/null 2>&1 &&
      bwrap --unshare-user --unshare-pid --unshare-net --ro-bind / / -- /bin/true >/dev/null 2>&1
  }
  if sandbox_ready; then
    ok "Sealed commands ready"
    return 0
  fi
  sandbox_install=
  if ! command -v bwrap >/dev/null 2>&1 || ! command -v socat >/dev/null 2>&1 ||
    ! command -v rg >/dev/null 2>&1; then
    for sandbox_candidate in apt-get dnf pacman zypper apk; do
      if command -v "$sandbox_candidate" >/dev/null 2>&1; then
        sandbox_install=$sandbox_candidate
        break
      fi
    done
    if [ -z "$sandbox_install" ]; then
      say "Sealing the assistant's commands needs bubblewrap, socat and ripgrep. Install them with your package manager when you like."
      return 0
    fi
  fi
  sandbox_restricted=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null || echo 0)
  step "Sealing the assistant's commands"
  say "Conch keeps the assistant's commands to your work folder, with no network or secrets, using bubblewrap."
  say "It needs your administrator password once. It runs:"
  case "$sandbox_install" in
    apt-get) say "sudo apt-get update"; say "sudo apt-get install -y bubblewrap socat ripgrep" ;;
    dnf) say "sudo dnf install -y bubblewrap socat ripgrep" ;;
    pacman) say "sudo pacman -S --needed --noconfirm bubblewrap socat ripgrep" ;;
    zypper) say "sudo zypper --non-interactive install bubblewrap socat ripgrep" ;;
    apk) say "sudo apk add bubblewrap socat ripgrep" ;;
  esac
  if [ "$sandbox_restricted" = 1 ]; then
    say "and lets /usr/bin/bwrap make its sandbox, as Flatpak needs: an AppArmor profile in /etc/apparmor.d/conch-bwrap"
  fi
  if [ -z "$SYSTEM_PACKAGES" ] || ! command -v sudo >/dev/null 2>&1 || ! has_keyboard; then
    say "Skipped for now. Conch offers it again under Settings → Health; until then each command asks first."
    return 0
  fi
  if ask "Set it up now? [Y/n]"; then
    case "$REPLY" in ''|[yY]|[yY][eE][sS]) ;; *)
      say "Skipped. Conch offers it again under Settings → Health."
      return 0 ;;
    esac
  else
    return 0
  fi
  if ! terminal_command sudo -v; then
    warn "Administrator access wasn't granted. Conch offers this again under Settings → Health."
    return 0
  fi
  sandbox_ok=1
  case "$sandbox_install" in
    apt-get) terminal_command sudo -n apt-get update &&
      terminal_command sudo -n apt-get install -y bubblewrap socat ripgrep || sandbox_ok= ;;
    dnf) terminal_command sudo -n dnf install -y bubblewrap socat ripgrep || sandbox_ok= ;;
    pacman) terminal_command sudo -n pacman -S --needed --noconfirm bubblewrap socat ripgrep || sandbox_ok= ;;
    zypper) terminal_command sudo -n zypper --non-interactive install bubblewrap socat ripgrep || sandbox_ok= ;;
    apk) terminal_command sudo -n apk add bubblewrap socat ripgrep || sandbox_ok= ;;
  esac
  if [ -n "$sandbox_ok" ] && [ "$sandbox_restricted" = 1 ] && [ -x /usr/bin/bwrap ]; then
    printf '%s\n' '# Conch: bubblewrap may make the user namespace its sandbox needs.' \
      'abi <abi/4.0>,' 'include <tunables/global>' \
      'profile conch-bwrap /usr/bin/bwrap flags=(unconfined) {' '  userns,' '}' |
      sudo -n tee /etc/apparmor.d/conch-bwrap >/dev/null &&
      terminal_command sudo -n apparmor_parser -r /etc/apparmor.d/conch-bwrap || sandbox_ok=
  fi
  if [ -n "$sandbox_ok" ] && sandbox_ready; then
    ok "Sealed commands ready"
  else
    warn "Commands aren't sealed yet. Conch carries on, asks before each one, and offers this again under Settings → Health."
  fi
}
