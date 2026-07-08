#!/bin/zsh
set -e

cd "$(dirname "$0")"

CODEX_RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
export PATH="$CODEX_RUNTIME/node/bin:$CODEX_RUNTIME/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  cat <<'EOF'
Codex Usage Pet could not find Node.js 18+.

Install Node.js, or run this from a shell where node is available.
EOF
  exit 1
fi

node scripts/install-launchd.js uninstall

cat <<'EOF'

Hourly profile refresh is uninstalled.
You can close this window.
EOF

