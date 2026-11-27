# agy-plus

**Native UX enhancements and hidden feature toggles for the Antigravity desktop app** — adds a **Context Usage Indicator**, **Estimated Turn Costs**, a **Chinese UI**, **Chinese Conversation Titles**, and curated experimental features right inside Antigravity's own Settings panel.

[中文](README.md)

![The AGY Plus page in Antigravity Settings](assets/settings-en.png)

Public builds of Antigravity omit several everyday quality-of-life components (such as the context window ring and model rate cards) and gate many useful capabilities behind server-side experiment flags. `agy-plus` runs quietly on your Mac and embeds an **AGY Plus** page straight into Antigravity's native Settings window so you can turn enhancements and hidden features on in one place.

- **No app bundle modification**: Uses native environment variables supported by Antigravity's language server. Code signing stays intact and nothing needs re-patching after app updates.
- **No root certificates or HTTPS MITM**: Connects cleanly through local endpoint overrides without intercepting system-wide HTTPS traffic.
- **Runs locally with zero dependencies**: Binds strictly to `127.0.0.1`. Only the optional "Estimated costs" feature makes a periodic request to download the public price list from `models.dev`.
- **Leaves the `agy` CLI untouched**: Identifies traffic by `User-Agent` so only desktop app requests are enhanced while CLI requests pass through unchanged.

macOS only (tested on Antigravity 2.35.0 – 2.35.2).

> [!NOTE]
> Experimental features are unreleased and may be unstable or stop working after client updates. Overriding server-supplied configuration may not comply with Google's Terms of Service — use at your own risk. This project is not affiliated with Google.

---

## Features

### 1. Four Built-in UX Enhancements

`agy-plus` supplies four enhancements that public builds omit or that flags alone cannot provide:

![Left: estimated turn costs from the $ button under a reply. Right: the context usage breakdown next to the input box](assets/features-en.png)

| Feature | Description |
| --- | --- |
| **Context usage indicator** | Public builds have the flag (`enable-context-usage-indicator`) but omit the UI component. `agy-plus` supplies the component, showing a live usage ring next to the input box with a breakdown popover by token category. |
| **Estimated costs** | Public builds lack a rate card, so "Token usage per reply" always shows `$0.0000`. Once enabled, `agy-plus` fetches public Vertex AI list prices from `models.dev` (at most once a day) and calculates estimated costs for each turn and subagent. |
| **Chinese interface** | Translates buttons, menus, context menus, OS notifications, and settings pages into Simplified Chinese without touching chat messages, code blocks, terminal output, or file/model names. |
| **Chinese conversation titles** | Antigravity prompts a small model for `"3 to 5 English words"` when naming a new chat. `agy-plus` rewrites that single instruction sentence in transit so new conversations get Simplified Chinese titles (no restart needed). |

### 2. Curated Hidden Features

The settings page also organizes curated experiment flags that have been tested or verified in the client code:

| Section | Feature | What it does |
| --- | --- | --- |
| **Interface** | Developer settings page | Adds a `Developer` page to Settings for overriding client-side UI flags |
| | New sidebar | Switches to the redesigned sidebar with status grouping and Inbox mode |
| | Background tasks | Adds a `Running` page to Settings listing active background tasks and terminals |
| | Markdown artifact width | Adds a `Chat Layout` option to make Markdown artifacts wider or full-width |
| | File pane sidebar | Adds an artifact list and file filter to the file viewer sidebar |
| | Open with another app | Lets you open the currently viewed file in an external macOS application |
| | Connectors in the input box | Adds a connectors entry to the `Add context` menu in the composer |
| | New dictation | Lets you restrict voice dictation to selected languages |
| **Conversations** | Conversation forking | Lets you branch a new conversation from any historical step |
| | Conversation groups | Lets you organize conversations into custom user-created groups |
| | Keep unsent drafts | Preserves unsent text in the input box across app restarts |
| | Telemetry switch per conversation | Adds a per-conversation toggle to disable telemetry |
| **Agents** | Code review (`/review-agent`) | Type `/review-agent` to have a read-only subagent review your diff and report issues |
| | Deep work (`/deepagent`) | Type `/deepagent` to launch a thorough, self-verifying subagent for complex tasks (uses more quota) |
| | Any model for subagents | Allows subagents to use any model from the model dropdown when specified in your prompt |
| | Teamwork subagents not forced to Flash | Prevents `/teamwork` subagents from being forced onto Flash so they can match the main model (marked untested) |
| | GitHub permissions per project | Lets you configure a GitHub token and scope allowed GitHub actions per project |
| | Encourage interactive widgets | Prompts the agent to render interactive HTML widgets inline when a visual helps |
| | Compact guidelines template | Removes the two guideline rules against bypassing permission checks or sandboxes and against solving CAPTCHAs from the system prompt, about 1K characters (Gemini 4 Hydrogen also loses the rule to keep unrelated comments and keeps its own code-reading and code-quality sections) |
| | No plugin suggestions from the agent | Removes the featured plugins list and the plugin search tool from the system prompt, about 6.9K characters; the agent no longer stops to suggest plugins and cannot search the marketplace for you |
| | No slash command suggestions from the agent | Removes the system prompt section that tells the agent to recommend slash commands, about 1.9K characters; the commands themselves still work |
| **Usage and costs** | Token usage per reply | Adds a `$` button below each reply showing input, cache read, and output tokens |
| **Plugin marketplace** | Plugin ranking and categories | Adds category filters and popularity sorting to the plugin marketplace |
| | Plugin user counts | Shows active user counts on marketplace plugin cards |
| **Computer use** | Computer use | Lets the agent delegate macOS app control to a subagent (restart twice after enabling, then grant Accessibility & Screen Recording permissions) |
| | Computer use: take over the screen | Allows the computer-use subagent to control mouse, keyboard, and full screen after confirmation (touching the Mac stops it immediately) |

> - **Builtin skills toggles**: The settings page also lists builtin skill folders under `~/.gemini/antigravity/builtin/skills` (such as `antigravity_guide`) so you can turn individual skills off to save prompt context; turning off the master switch or uninstalling restores them automatically from backup.
> - **Advanced configuration**: Arbitrary boolean flags can be added under `"flags"` in `config.json`, and custom per-model template overrides can be declared under `"templates"` (`section_override`, `set_value`, `drop_field`, and `when_absent: "insert"`).

---

## Installation

### One-Step Install (Recommended)

Open **Terminal** and run:

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-plus/main/install.sh | bash
```

Once finished, **quit and reopen Antigravity**, open **Settings**, and select **AGY Plus** at the bottom of the left sidebar.

- **Self-contained runtime**: If your Mac doesn't have Node.js 18+, the script automatically downloads the official Node.js 24.22.3 binary from `nodejs.org`, verifies its SHA-256 checksum, and stores it inside `agy-plus`'s own folder. Nothing is installed system-wide and `sudo` is never used (requires macOS 13.5+).
- **Updating**: Re-run the install command above. It restarts the background daemon (any reply currently streaming will be interrupted).
- **Proxy users**: If you use a proxy tool to reach Google, enable its **TUN / Enhanced mode**. The local forwarder connects directly and does not read macOS System Proxy settings.

Check status or uninstall:

```bash
# Check daemon and feature status
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-plus/main/install.sh | bash -s -- status

# Uninstall (keeps your config.json)
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-plus/main/install.sh | bash -s -- uninstall

# Uninstall and delete all settings & logs
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-plus/main/install.sh | bash -s -- uninstall --purge
```

### Install from Source

Requires Node.js 18 or later:

```bash
git clone https://github.com/prefusify/agy-plus.git
cd agy-plus
node bin/agy-plus.mjs install
```

`install` copies the app to `~/Library/Application Support/agy-plus/app`, loads the `dev.agy-plus.daemon` LaunchAgent, and sets the session environment variables. Re-run `install` after editing source files. You can also run `npm link` in the repo to use the `agy-plus` CLI globally:

| Command | Description |
| --- | --- |
| `agy-plus status` | Displays daemon health, environment variables, client routing state, and active flag overrides |
| `agy-plus skills [list \| off \| on]` | Lists or toggles builtin skill folders (defaults to `antigravity_guide` when no name is given) |
| `agy-plus uninstall [--restart-client] [--purge]` | Uninstalls `agy-plus` (restoring any backed-up builtin skills); optionally restarts Antigravity and deletes config/logs |
| `agy-plus daemon` | Runs the daemon in the foreground |

---

## Usage

1. In Antigravity, open **Settings** and click **AGY Plus** at the bottom of the left sidebar.
2. Toggle on the features you want (features with a risk badge will ask for confirmation first).
3. Click **Restart Antigravity** in the top banner. Except for "Chinese conversation titles", Antigravity applies changes at startup.
4. **Enable agy-plus** at the top is the master switch: turning it off and restarting makes Antigravity connect directly to Google without rewriting anything, while keeping the `AGY Plus` settings page available so you can turn it back on anytime.

> [!TIP]
> After turning on **Context usage indicator** and restarting, also enable `Settings → Appearance → Advanced Settings → Chat Layout → Context and quota indicator` (off by default in the client).

---

## How It Works & Security

### 1. Flag Rewriting & Request Forwarding (Ports 47931 / 47932)

Antigravity's language server fetches experiment flags from `daily-cloudcode-pa.googleapis.com` (`listExperiments`) and `aicode.googleapis.com` (`fetchConfig`). It natively honors two environment variables — `CLOUD_CODE_URL` and `AICODE_ENDPOINT_URL` — to override those endpoints:

```text
Antigravity ──HTTP──▶ agy-plus (127.0.0.1:47931 / 47932) ──HTTPS──▶ Google
```

- Once its local ports are listening, the daemon sets those variables in your macOS login session via `launchctl setenv`.
- In `listExperiments` and `fetchConfig` responses, only your selected boolean flags are overridden; when template overrides are enabled, `fetchAvailableModels` responses have the declared template targets applied; all other fields stay untouched. If rewriting ever fails, the original response passes through unchanged.
- Every other request (including chat streams) is piped straight through without buffering or logging.

### 2. Settings Page & UI Script Injection (Port 47933)

The **AGY Plus** settings page, **Context usage indicator**, **Estimated costs**, and **Chinese interface** all patch the client's frontend bundle (`main.js`). Rather than modifying `/Applications/Antigravity.app`, `agy-plus` uses a third native environment variable, `AGY_DEV_UI_URL`:

- The daemon serves the client's UI assets on `127.0.0.1:47933`, reading them directly from the installed language server binary and appending `agy-plus`'s components to `main.js` in memory.
- Each patch locates its target by AST/code shape rather than minified variable names. If a client update changes one shape, only that patch is skipped (with a warning in Settings) while everything else keeps working.

### 3. Local Security & Privacy

Because your auth tokens and conversation traffic pass through the local forwarder:

- **Loopback only**: All ports bind strictly to `127.0.0.1`. Upstream connections always use HTTPS with standard certificate verification. Logs record lifecycle events only — never headers or bodies.
- **Same-user & same-origin protection**: The settings API on port 47933 uses `lsof` to verify that the connecting process (and any process connected to the language server) belongs to your macOS UID, blocking other local users on a shared Mac. It also enforces `Host` checks, requires `Sec-Fetch-Site: same-origin`, and rejects requests with an `Origin` header so websites in your browser cannot read or change your settings.

---

## Troubleshooting & FAQ

<details>
<summary><b>1. The "AGY Plus" page is missing from Settings</b></summary>

1. **Quit and reopen Antigravity first.** Only an instance started while the `agy-plus` daemon is running inherits the environment variables (an app window auto-restored at macOS login may have started before the daemon).
2. Still missing? Run `agy-plus status`:
   - `pending`: One more client restart is required.
   - `warning: page-not-changed`: A client update changed the shape of `main.js` so the UI page couldn't be injected. You can still configure everything by editing `~/Library/Application Support/agy-plus/config.json` (auto-reloaded on save, then restart Antigravity):
     - `enabled`: Master switch (`true` / `false`)
     - `flags`: Flag overrides (e.g. `{"enable-developer-mode": true}`)
     - `features`: Built-in enhancements (`costPrices`, `uiChinese`, `chineseTitles`, `guidelinesOverride`, `slashCommandsOverride`)
     - `templates`: Per-model template override rules
     - `disabledSkills`: Disabled builtin skill folder names (e.g. `["antigravity_guide"]`)
     - `pageLanguage`: Language of the AGY Plus page (`auto` follows the system, `zh`, `en`); also switchable at the top right of that page
</details>

<details>
<summary><b>2. Reloading the Antigravity window shows <code>The dev UI server at … is not reachable</code></b></summary>

While `AGY_DEV_UI_URL` is set, Antigravity loads its frontend assets from `agy-plus` on port 47933. If the daemon is stopped, a reloaded window cannot fetch its UI.
- Restart the daemon, or uninstall `agy-plus` to return to normal.
- To bypass `agy-plus` immediately without uninstalling, clear the variables and restart Antigravity:
  ```bash
  launchctl unsetenv CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL
  ```
</details>

<details>
<summary><b>3. After stopping or uninstalling, the <code>agy</code> CLI says <code>plan model not specified</code></b></summary>

Because session variables are inherited by Terminal windows, the `agy` CLI also routes through `agy-plus` while it runs (and is passed through unchanged via its `User-Agent: antigravity/cli/…`).
After you stop or uninstall `agy-plus`, **already-open Terminal windows** still hold the old environment variables. Quit and reopen Terminal completely, or run:

```bash
unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL
```
</details>

<details>
<summary><b>4. What happened to "Prompt cache keep-alive"?</b></summary>

It was removed because it frequently stopped after one or two pings, and any ping that missed the cache was billed as full uncached input. If you enabled it in an earlier version, manually remove `enable-prompt-cache-keep-alive` and `prompt_cache_keep_alive_max_pings` from `"flags"` in `~/Library/Application Support/agy-plus/config.json`.
</details>

---

## Files & Development

All runtime data lives in `~/Library/Application Support/agy-plus/`:

| Path | Purpose |
| --- | --- |
| `config.json` | Your flag overrides, feature toggles, ports, and upstream URLs (editable by hand; auto-reloads) |
| `state.json` | Last seen server flag snapshot and model display names |
| `prices.json` | Cached price list from `models.dev` |
| `skills-backup/` | Backup folder for disabled builtin skills |
| `daemon.log` | Daemon event log |
| `app/` & `runtime/` | Installed program copy and standalone Node.js runtime |

The LaunchAgent plist is `~/Library/LaunchAgents/dev.agy-plus.daemon.plist`.

### Running Tests

```bash
npm test
```

The test suite runs completely isolated in memory and temporary folders — it never calls `launchctl`, touches your real settings directory, or makes network requests.

- **Forwarding & rewriting**: [`src/forward.mjs`](src/forward.mjs) (HTTP proxy & title prompt rewrite), [`src/patch.mjs`](src/patch.mjs) (flag & per-model template patching), [`src/skills.mjs`](src/skills.mjs) (builtin skill folder manager), [`src/daemon.mjs`](src/daemon.mjs) (daemon lifecycle)
- **UI injection & Settings page**: [`src/bundle.mjs`](src/bundle.mjs) (reads embedded UI assets from the language server binary), [`src/uipatch.mjs`](src/uipatch.mjs) (context indicator & cost repricer), [`src/settingspage.mjs`](src/settingspage.mjs) (`AGY Plus` settings page), [`src/uiserver.mjs`](src/uiserver.mjs) (asset server & settings API)
- **Localization & catalog**: [`src/l10n.mjs`](src/l10n.mjs) & [`src/l10n/zh-CN.json`](src/l10n/zh-CN.json) (Chinese translator & string table), [`src/catalog.json`](src/catalog.json) (curated feature catalog), [`tools/l10n-candidates.mjs`](tools/l10n-candidates.mjs) (scans updated client bundles for untranslated strings)

## License & Credits

[MIT](LICENSE).

- Portions of the Chinese localization table are adapted from [antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese) (MIT; see [`src/l10n/LICENSE-antigravity-chinese.txt`](src/l10n/LICENSE-antigravity-chinese.txt)).
- The idea of embedding feature toggles directly into the host app's native Settings window was inspired by [obsidian-prism](https://github.com/RMvdesi/obsidian-prism) (no code was used).
- Community link: [LINUX DO](https://linux.do/).
