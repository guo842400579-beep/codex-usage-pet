# Codex Usage Pet

[中文说明](README.zh-CN.md)

macOS always-on-top floating window for local Codex usage, rate limits, task status, and an animated Codex pet.

The app reads local Codex session logs from `~/.codex`, so it does not require a separate server. For precise lifetime-token leveling, it can also refresh `profile-stats.json` from the logged-in Codex auth file on a local hourly launchd job.

## Requirements

- macOS
- Node.js and npm
- Codex local data under `~/.codex`
- A Codex-compatible pet spritesheet, defaulting to `~/.codex/pets/white-devon/spritesheet.webp`

## Install

```bash
npm install
```

## Run

```bash
npm start
```

You can also double-click:

```text
start-codex-usage-pet.command
```

The command file changes into its own directory before starting Electron, so it works after cloning or moving the project folder.

## Build a macOS App

Create a local `.app` bundle:

```bash
npm run pack:mac
```

The app bundle is generated at:

```text
dist/mac-*/Codex Usage Pet.app
```

Create a DMG installer:

```bash
npm run dist:mac
```

Generated app bundles and installers are ignored by Git.

The generated app is not Developer ID signed or notarized unless you configure Apple signing credentials. On other Macs, users may need to approve it in macOS Security settings.

## Optional Hourly Profile Refresh

The floating window can read precise lifetime tokens from `~/Library/Application Support/codex-usage-pet/profile-stats.json`. Generate it once:

```bash
npm run fetch-profile
```

Install an hourly macOS LaunchAgent:

```bash
npm run launchd:install
```

Check status:

```bash
npm run launchd:status
```

Uninstall:

```bash
npm run launchd:uninstall
```

The installer dynamically writes `~/Library/LaunchAgents/com.codex-usage-pet.profile-stats.plist` using the current project path and the current Node.js executable. No hardcoded user path is committed.

## Configuration

Edit `config.json`.

Important defaults:

```json
{
  "pet": {
    "atlasPath": "~/.codex/pets/white-devon/spritesheet.webp"
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
