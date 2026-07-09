# Codex Usage Pet

[中文说明](README.zh-CN.md)

macOS always-on-top floating window for local Codex usage, rate limits, task status, and an animated Codex pet.

The app reads local Codex session logs from `~/.codex`, so it does not require a separate server. For correct lifetime-token leveling, install the local hourly profile refresh once. It writes `profile-stats.json` from the logged-in Codex auth file, which is the data source used for the level display.

## Skins

The app includes two switchable skins: a game-style HUD and a minimal floating panel.

### Game Style

![Game style skin](assets/readme/game-skin.png)

### Minimal Style

![Minimal style skin](assets/readme/minimal-skin.png)

## Requirements

- macOS
- Node.js and npm
- Codex local data under `~/.codex`
- The default White Devon pet spritesheet is bundled at `assets/white-devon/spritesheet.webp`

If you are running inside a managed Codex Desktop shell, `node` / `npm` may not be on PATH. In that case, use the bundled Codex Node.js and pnpm path shown below.

## Install

```bash
git clone https://github.com/guo842400579-beep/codex-usage-pet.git
cd codex-usage-pet
npm install
```

### Install Without npm

If the shell prints `npm: command not found` and Codex Desktop is installed, use the bundled runtime:

```bash
git clone https://github.com/guo842400579-beep/codex-usage-pet.git
cd codex-usage-pet
export PATH="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin:$PATH"
pnpm install
pnpm rebuild electron
```

The repo includes `pnpm-workspace.yaml` so Electron build scripts are approved. If pnpm still reports `ERR_PNPM_IGNORED_BUILDS`, run:

```bash
pnpm approve-builds electron
pnpm rebuild electron
```

## Run

```bash
npm start
```

If you installed with pnpm:

```bash
pnpm start
```

You can also double-click:

```text
start-codex-usage-pet.command
```

The command file changes into its own directory before starting Electron, so it works after cloning or moving the project folder.
It prefers `node_modules/.bin/electron` and automatically tries to add the bundled Codex Desktop Node.js runtime to PATH.

Codex sandbox sessions usually cannot launch Electron GUI windows directly and may show `SIGABRT`. Use a normal terminal or double-click `start-codex-usage-pet.command` from Finder for real desktop use.

## Recommended Hourly Profile Refresh

The level display depends on the personal lifetime token count in `~/Library/Application Support/codex-usage-pet/profile-stats.json`. Run this setup at least once after installing the app. Without it, the window can still show local rate limits and recent activity, but the level will fall back to local session totals and may not represent your real lifetime token usage.

Generate the profile stats file once:

```bash
npm run fetch-profile
```

Install the hourly macOS LaunchAgent so the lifetime token count keeps updating:

```bash
npm run launchd:install
```

If you are inside a sandboxed Codex run, this command may be blocked because it writes `~/Library/LaunchAgents` and calls `launchctl`. Run it in a normal Terminal, or double-click this file from Finder:

```text
install-profile-refresh.command
```

Check status:

```bash
npm run launchd:status
```

Uninstall:

```bash
npm run launchd:uninstall
```

You can also double-click:

```text
uninstall-profile-refresh.command
```

The installer dynamically writes `~/Library/LaunchAgents/com.codex-usage-pet.profile-stats.plist` using the current project path. The LaunchAgent uses `/usr/bin/env node` with a PATH that includes common Homebrew locations and the Codex Desktop bundled runtime, so it does not depend on the exact Node.js executable used during install. Node.js 18+ is required.

Logs are written to:

```text
~/Library/Logs/codex-usage-pet/profile-stats.out.log
~/Library/Logs/codex-usage-pet/profile-stats.err.log
```

If you move the project folder after installing the LaunchAgent, run `npm run launchd:install` again from the new folder.

## Configuration

Edit `config.json`.

Important defaults:

```json
{
  "pet": {
    "atlasPath": "assets/white-devon/spritesheet.webp"
  },
  "usage": {
    "codexHome": "~/.codex",
    "profileStatsFile": "profile-stats.json",
    "tokensPerLevel": 100000000,
    "refreshMs": 5000
  }
}
```

Paths may be absolute, `~/...`, or relative to the project root.

## Level Rule

Level is local UI state, not an official Codex field.

```text
level = max(1, ceil(totalTokens / tokensPerLevel))
levelCap = level * tokensPerLevel
```

With the default `tokensPerLevel = 100000000`:

- `0` to `100,000,000` tokens: Lv.1
- `100,000,001` to `200,000,000` tokens: Lv.2
- `1,450,000,000` tokens: Lv.15, cap `1,500,000,000`

If `profile-stats.json` exists in the app data directory, the app uses its `totalTokens`. Otherwise it falls back to recent local session totals plus `usage.levelTokenOffset`.

## Data Sources

Rate limits and current activity are inferred from local Codex JSONL session logs:

- `event_msg.payload.type = "token_count"`
- `rate_limits.primary`: usually the 5h window
- `rate_limits.secondary`: usually the weekly window
- `resets_at`: reset countdown and cursor position
- `response_item` and task events: current task, tool running state, completion state

To keep startup fast, the app scans only recent session files and reads each file tail:

```json
"maxSessionFiles": 24,
"tailBytes": 2097152
```

## Pet Animations

Default animation rows for the White Devon spritesheet:

- `idle`: standing/breathing
- `running`: active Codex work
- `waiting`: approval or user input
- `runningRight` / `runningLeft`: dragging the window

The failed state is intentionally mapped to `idle`, so the crying/error row is not used.

## Validation

```bash
npm run smoke
node --check src/main.js
node --check src/preload.js
node --check src/renderer.js
node --check src/usage-reader.js
node --check scripts/fetch-profile-stats.js
node --check scripts/install-launchd.js
```
