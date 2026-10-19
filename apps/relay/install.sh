#!/bin/sh
# The relay on a Raspberry Pi or a small Linux server (ADR 0140), as Conch shows it:
#   curl -fsSL https://raw.githubusercontent.com/georgevibing/conch-agent/<ref>/apps/relay/install.sh | sh -s -- <setup code> <ref>
# It needs Node 22.18 or later, keeps everything in ~/.conch-relay, and starts
# with your user's systemd when there is one. Nothing runs as root.
set -eu
code="${1:-}"
ref="${2:-main}"
[ -n "$code" ] || { echo "Give it the setup code from Conch: sh -s -- conch-relay-1.…" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "The relay needs Node 22.18 or later: https://nodejs.org" >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=18)?0:1)' \
  || { echo "The relay needs Node 22.18 or later (this is $(node --version))." >&2; exit 1; }
dir="$HOME/.conch-relay"
mkdir -p "$dir/data"
chmod 700 "$dir" "$dir/data"
base="https://raw.githubusercontent.com/georgevibing/conch-agent/$ref/apps/relay/src"
for f in core envelope store node; do
  curl -fsSL "$base/$f.ts" -o "$dir/$f.ts.tmp"
  mv "$dir/$f.ts.tmp" "$dir/$f.ts"
done
umask 077
printf '%s\n' "$code" > "$dir/data/setup.txt"
port="${PORT:-8787}"
if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  cat > "$HOME/.config/systemd/user/conch-relay.service" <<UNIT
[Unit]
Description=Conch relay
After=network-online.target

[Service]
Environment=CONCH_RELAY_DATA=$dir/data
Environment=PORT=$port
ExecStart=$(command -v node) $dir/node.ts
Restart=always

[Install]
WantedBy=default.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now conch-relay.service
  loginctl enable-linger "$(id -un)" 2>/dev/null || true
  echo "The Conch relay is running on port $port, and starts again by itself."
else
  echo "Start it with: CONCH_RELAY_DATA=$dir/data PORT=$port node $dir/node.ts"
fi
echo "Give it an HTTPS address (Caddy, Tailscale Funnel or your host's), then paste that address in Conch."
