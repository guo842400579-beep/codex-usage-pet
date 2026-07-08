#!/bin/zsh
set -e

cd "$(dirname "$0")"

CODEX_RUNTIME="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies"
if [[ -d "$CODEX_RUNTIME/node/bin" ]]; then
  export PATH="$CODEX_RUNTIME/node/bin:$CODEX_RUNTIME/bin:$PATH"
fi

if [[ -x "./node_modules/.bin/electron" ]]; then
  exec "./node_modules/.bin/electron" .
fi

if command -v npm >/dev/null 2>&1; then
  exec npm start
fi

if command -v pnpm >/dev/null 2>&1; then
  exec pnpm start
fi

cat <<'EOF'
Codex Usage Pet could not find Electron.

Install dependencies first:
  npm install

If this shell has no npm but you are running inside Codex Desktop, try:
  export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH"
  pnpm install
  pnpm start
EOF
exit 1
