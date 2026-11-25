# agy-flags

Choose on a web page which experimental features of the Antigravity desktop app are on. [中文](README.md)

Many Antigravity features are controlled by "experiment flags" that Google's servers send to the app. agy-flags rewrites that configuration on your machine, so that you decide which flags are on.

- **It does not modify the Antigravity app.** The app's files and signature stay as they are, and nothing has to be redone after the app updates itself.
- **No certificate is installed, and HTTPS is not intercepted.**
- **It runs on your machine only**, has no third-party dependencies, and sends nothing to third parties.

Besides flags, it carries two features that a flag alone cannot turn on: **prompt cache keep-alive** and the **context usage indicator**. "How it works" says how each is done and what it costs.

macOS only for now. This tool ran on Antigravity 2.35.0. The same approach was verified earlier on 2.34.0 with a prototype.

> These features are unreleased and may be unstable. Rewriting the configuration that the server sends may be against Google's terms of service. You use this at your own risk. This project is not affiliated with Google.

## Install

Node.js 18 or later is required (it ran on Node.js 24 only).

```bash
git clone https://github.com/prefusify/agy-flags.git
```

```bash
cd agy-flags && node bin/agy-flags.mjs install
```

`install` does three things:

1. It copies the program to `~/Library/Application Support/agy-flags/app`.
2. It registers a login item (`~/Library/LaunchAgents/dev.agy-flags.daemon.plist`) and starts the daemon now.
3. When the daemon is listening, the daemon sets two login-session environment variables (see "How it works"). It sets a third one while the "Context usage indicator" is on.

Run `npm link` in the repository to get the `agy-flags` command. Without it, use `node bin/agy-flags.mjs <command>`.

## Use

```bash
agy-flags ui
```

This opens the settings page in your browser.

1. Turn on a feature under "Features", or search under "All flags" and change any boolean flag.
2. The page says that a restart is needed. Click "Restart Antigravity". Antigravity reads its flags only when it starts.
3. To go back, set the flag back and restart again.

"All flags" lists every flag the server sends (651 on 2.35.0). A boolean flag has three states: "Default" (what the server sends), "On" and "Off". An integer flag has an input field: a number is an override, and an empty field means the default. Flags of other types (string, ...) are read-only on the page.

The entries under "Features" were chosen on 2.35.0, after the candidate flags were turned on and looked at one by one. Only features with an effect that was seen, and that is useful in daily work, are listed. Each entry is marked "tested" or "untested":

- **tested**: the effect was seen in the app on the version shown. The description says what was seen. Where only the entry point was confirmed and the feature itself was not tried, the description says so.
- **untested**: the effect is known from the app's page code only and was not seen in the app. At present no entry is like this.

Flags that showed no effect are not under "Features"; "Verified and not verified" lists them. You can still turn them on under "All flags".

Other commands:

| Command | What it does |
| --- | --- |
| `agy-flags status` | Shows the daemon, the variables, the app and the changed flags |
| `agy-flags ui --print` | Prints the page address and does not open a browser |
| `agy-flags uninstall` | Stops the daemon, removes the login item, clears the variables |
| `agy-flags uninstall --restart-client` | The same, and restarts Antigravity when that is needed |
| `agy-flags uninstall --purge` | The same, and deletes the settings and the log |
| `agy-flags daemon` | Runs the daemon in the foreground (the login item runs this) |

## How it works

Antigravity's language server reads experiment flags from two addresses:

- `https://daily-cloudcode-pa.googleapis.com/v1internal:listExperiments`
- `https://aicode.googleapis.com/v1alpha:fetchConfig`

The language server honours two environment variables, `CLOUD_CODE_URL` and `AICODE_ENDPOINT_URL`, which replace these two hosts. agy-flags uses them:

```
Antigravity ──HTTP──▶ agy-flags (127.0.0.1:47931 / 47932) ──HTTPS──▶ Google
```

- The daemon opens two local forwarding ports, one for each Google host.
- It sets the two variables in the login session with `launchctl setenv`. An Antigravity that starts afterwards inherits them and sends its requests to your machine.
- The two responses above are rewritten: the flag values you chose are written into them.
- Some flags are read per model (at present only the "Prompt cache keep-alive" group). Only while such a feature is on, agy-flags rewrites one more response: the model list (`v1internal:fetchAvailableModels`). It writes these flags into the flags that each model carries.
- **Every other request and response is streamed through unchanged**, conversations included. A connection upgrade (WebSocket) is tunnelled unchanged too.
- A third port (47930) serves the settings page.

Guarantees by design:

- The variables are set only after the forwarding ports are listening. The daemon clears them before it stops.
- If another program has already set these variables, agy-flags does not overwrite them. The page shows the conflict.
- If a response cannot be rewritten (for example, the server changed the format), it is passed through unchanged.
- Only the responses named above, with status 200, are rewritten. For a flag the server sends, only the value is replaced; every other field is kept. In the model list nothing changes except the flags that are written into it.
- When the daemon crashes, the system starts it again (in under 1 second in our test). The app retries in the meantime.

### Prompt cache keep-alive

Keep-alive is a feature of the app itself; agy-flags only turns it on. Three conditions must hold together: the flag `enable-prompt-cache-keep-alive` is on; the integer flag `prompt_cache_keep_alive_max_pings` is a positive number (the server does not send this flag, so agy-flags adds it); and both flags are also among the flags that each model in the model list carries. That is why agy-flags rewrites the model list while this feature is on.

While it is on, the app sends a keep-alive request 270 seconds after the last request of a conversation started, and then every 270 seconds, until the count is used up or you send a new message. When one keep-alive misses the cache, the app also stops the keep-alive for that idle stretch (this is read from the program of the app and was seen with the command line version; it was not verified separately on the desktop app). Each keep-alive is a real model request and uses quota.

### Context usage indicator

The public build of the app has the flag `enable-context-usage-indicator`, but its page does not contain the component, so the flag alone does nothing. agy-flags adds the component through a development entry point that the app itself has:

- The language server honours a third environment variable, `AGY_DEV_UI_URL`. When it is set, the language server no longer uses the page files inside its own program. It takes them from that address.
- The daemon opens a fourth port (47933) as that address. The page files are read, unchanged, out of the installed language server program (they are a ZIP archive inside the program). The program is only read, never written.
- Only one file, `main.js`, is changed, and in one place only: the indicator component is put into the place that the app left empty. Every other file is served unchanged.
- The component is written by agy-flags. It reads the context usage data that the app already has, and shows a ring and a percentage; a click lists the tokens used by each part. It sends no network requests.
- When the place cannot be found (for example, the page script changed after an app update), agy-flags serves the page files unchanged and shows a warning on the settings page. The app works as usual, without the indicator.

The cost: **while this feature is on, the Antigravity page depends on agy-flags running**. While agy-flags is not running, an Antigravity window that is reloaded shows an error text. A window that is already loaded is not affected. For this reason the third variable is set only while this feature is on, and it is cleared when you turn the feature off.

After you turn the flag on and restart the app, one setting in the app must be turned on before the indicator shows: Settings → Appearance → Advanced Settings → Chat Layout → "Context and quota indicator". That setting is off by default.

## Security and privacy

Your Google sign-in token and all conversation content pass through the local forwarder. Therefore:

- The forwarders and the page listen on `127.0.0.1` only.
- The upstream addresses come only from `config.json`. The defaults are the two Google hosts above. The connection to the upstream is HTTPS with normal certificate checks.
- The log records events only (start, how many flags were rewritten, failure reasons). It records no headers and no bodies.
- To show on the page how many keep-alive requests were sent, the forwarder looks for one fixed label name (`prompt_cache_keep_alive`) in model requests as they pass. It only counts. It does not keep or log the request content.
- The port that serves the page files (47933) answers read requests only, and serves only the app's own page files. Conversation traffic does not pass through it: the page talks to the language server directly. The indicator component that is added to the page script sends no network requests and writes everything into the page as plain text.
- The page's API needs a random token. `agy-flags ui` passes it to the page in the part of the address after `#`, which browsers send to no server. The API also checks `Host` and `Origin`, so another website cannot change your settings through your browser.
- There are no third-party dependencies, and the code is small enough to read.

Other programs that run as you on this machine can already read your files. agy-flags does not defend against them.

## Verified and not verified

Everything below was tested with this tool on Antigravity 2.35.0 (macOS).

Basics:

- After install, turning on "Developer settings page" on the page and restarting shows the Developer page in Settings. Turning it off, or uninstalling, and restarting removes it.
- Conversations work (streamed replies).
- After the daemon is killed, the system restarts it in under 1 second and the app keeps working.
- After uninstall, the variables are cleared, the ports are free, and the login item file is gone.
- Integer flags: tested through the count parameter of keep-alive. The server does not send this parameter; keep-alive requests started only after agy-flags wrote it.

Prompt cache keep-alive:

- With the feature on, the two keep-alive flags were written into all 41 models of the model list. The app fetches the model list again every 6 minutes, and it was rewritten again.
- The keep-alive requests of an idle conversation went out on time: the first one about 270 seconds after the main request, the second one 270 seconds later. A separate recording program confirmed the count that the agy-flags page shows.
- The first keep-alive hit the cache. The second one did not. The third and later ones were not tested.

Context usage indicator:

- After the flag was turned on, the app was restarted and "Context and quota indicator" was turned on in the app's settings, a ring and a percentage showed next to the input box. A click showed the used and the maximum tokens, and the tokens used by System Prompt, Tools, Chat Messages and the other parts.
- For this test the local overrides that the app already had were removed, to confirm that agy-flags alone turns it on.
- It was looked at in text chat only. The display after a long conversation is compacted was not tested.

The other entries under "Features":

- "Conversation groups", "Overview of background tasks", "Configurable Markdown artifact width", "Connectors in the input box", "Telemetry switch per conversation", "Reworked dictation", "Open a file with another app": with the flag on, the change in the interface that the description names was seen; with the flag off, it was not there in the same place.
- "Redesigned sidebar": the same, but the 2 flags were on together and were not tested one by one. After it is turned off, the old sidebar still groups by Status; choose Project again by hand under Display Options → Group By.
- "File pane sidebar": the same. Five file-related flags were on together during the test; the list keeps only `enable-enhanced-file-viewer`, because in the page code these two additions depend on it alone. It was not tested again with only that flag on.
- "Conversation forking": marked 2.34.0. The comparison between on and off was made on 2.34.0 with a prototype. On 2.35.0 the Fork menu and button show while the 7 flags are on, but the client used for the test also has local overrides of the same names (Custom Flags on the Developer page), so what was seen there does not prove that agy-flags turned it on.
- For most of these entries only the entry point or the setting was confirmed; the feature itself was not used. Each description says how far the test went.

Flags that were looked at and are not under "Features" (2.35.0):

| Flag | What was seen |
| --- | --- |
| `enable-agy-hub-cua-macos`, `enable-agy-hub-cua-foreground` | The side panel gets an "Agents" pane, but it shows the error "Live preview unavailable"; asked about it, the agent answered that it has no tools to control the desktop |
| `enable-bottom-terminal-panel` | "Terminal placement" did not appear in the settings; no change was seen |
| `enable-file-explorer-tab` | No file explorer entry appeared in the list of the side panel |
| `enable-move-conversation-to-project` | No option to move a conversation to a project appeared in the conversation menu |
| `enable-browser-site-data-controls` | Settings → Browser looks the same with the flag on and off |
| `enable-input-autocomplete` | No completion appeared while typing in the input box |
| `enable-pane-selection-actions` | "Comment" and "Quote" appear after selecting text in a file preview, but they also appear with the flag off |
| `enable-paste-text-as-snippet` | No code in the 2.35.0 page script uses it |
| `show-all-models-in-gemini-app` | According to the page code it applies only to the page that is embedded in another app, not to the desktop app |
| `enable-battle-mode` | No new entry point was seen in the input box or the menus |
| `enable-upload-html-artifact-to-drive`, `enable-resume-conversations-from-restart`, `enable-text-transitions`, `markdown-virtualize-long-documents`, `enable-marketplace-new-badge` | They were turned on, but their effect was not checked specifically |

You can still turn these flags on under "All flags". Another set of flags cannot work in the public build: some require a Google-internal identity (for example `context-window-selector`), and for some the interface component is not shipped in the public build (for example code search).

Not verified:

- Features other than text chat, for example voice mode, remote control and the built-in browser. Only text chat was tried with the real app.
- The tunnel for connection upgrades (WebSocket). It has a unit test only; no such request was seen in real traffic.
- String flags. They are read-only on the page. You can write them into `flags` in `config.json` by hand, but this was not tested with the real app.
- An app update while the "Context usage indicator" is on. By design the page files change together with the app's program, and they are served unchanged when they cannot be changed safely; this has unit tests only.
- Antigravity was started with the `open` command and with the "Restart" button of agy-flags only. Starting it from the Dock or Launchpad was not tested separately.
- Networks where Google is reachable only through a system proxy. The forwarder connects to Google directly and does not read proxy settings.
- The Antigravity IDE and the command line (`agy`). See the next section.

Verified on 2.34.0 with a prototype (not this code): when the forwarder stops for a while, the app shows a retry message and recovers. This was not tested again on 2.35.0 with this tool.

## Known limits

- **A change needs a restart of Antigravity.**
- **An Antigravity that starts before the daemon is not routed.** If the system reopens Antigravity at login, it can start before the daemon. The page then asks you to restart it once.
- **While the "Context usage indicator" is on, the page depends on agy-flags.** While agy-flags is not running, an Antigravity window that is reloaded shows an error text (see "When something goes wrong"). If you do not want this, leave that feature off; the other features are not affected.
- **The indicator component is written by agy-flags; it is not Google's original.** It shows context usage only, not the model quota. If the structure of the page script changes after an app update, the component turns itself off until agy-flags is updated.
- **Keep-alive does not guarantee a cache hit.** In the test the first keep-alive hit the cache and the second one did not. The one that missed is charged as uncached input for the whole context.
- **Other programs inherit the variables too.** The variables live in the login session, so every program started afterwards (terminals included) carries them. Almost all programs ignore these names. The Antigravity command line `agy` does read `CLOUD_CODE_URL`: when you run `agy` in a terminal that was opened after the variables were set, its requests go through agy-flags too, and its flags are rewritten too. This combination was not tested, and neither was the IDE. To keep `agy` in one terminal away from agy-flags, run `unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL` in that terminal first.
- **The cloud addresses are fixed in the configuration.** If a version of Antigravity moves to another host, the page shows an "endpoint mismatch" warning. Update agy-flags, or edit `upstreams` in `config.json`.
- **This can stop working at any time.** Google can remove these variables or change how flags are delivered in any release.

## When something goes wrong

If the app cannot reach its servers or shows "Error Loading Models", look at the status first:

```bash
agy-flags status
```

If an Antigravity window shows only a text that starts with "The dev UI server at … is not reachable", the "Context usage indicator" is on and agy-flags is not running. Get agy-flags running again and reload the window, or clear the variables as shown below.

To bypass agy-flags at once, clear the three variables and restart Antigravity:

```bash
launchctl unsetenv CLOUD_CODE_URL
```

```bash
launchctl unsetenv AICODE_ENDPOINT_URL
```

```bash
launchctl unsetenv AGY_DEV_UI_URL
```

The log is at `~/Library/Application Support/agy-flags/daemon.log`.

## Files

| Path | Content |
| --- | --- |
| `~/Library/Application Support/agy-flags/config.json` | Settings: changed flags, ports, upstream addresses. You can edit it by hand; the daemon reads it again |
| `~/Library/Application Support/agy-flags/token` | The access token of the settings page |
| `~/Library/Application Support/agy-flags/state.json` | The server flag list as last seen |
| `~/Library/Application Support/agy-flags/daemon.log` | The log |
| `~/Library/Application Support/agy-flags/app/` | The program copied by `install` |
| `~/Library/LaunchAgents/dev.agy-flags.daemon.plist` | The login item |

To update agy-flags, pull the new code and run `agy-flags install` again.

## Development

```bash
npm test
```

The tests do not call `launchctl`, do not touch the real settings directory, and do not use the network.

- `src/patch.mjs`: pure functions that rewrite the two flag responses and the model list.
- `src/forward.mjs`: the HTTP forwarder for one upstream.
- `src/bundle.mjs`: finds and reads the page files inside the language server program.
- `src/uipatch.mjs`: the indicator component, and the change that puts it into the page script.
- `src/uiserver.mjs`: the server that gives the page files to the language server.
- `src/env.mjs`: the rules for setting and clearing the variables.
- `src/daemon.mjs`: puts the forwarders, the page API and the variables together.
- `src/api.mjs`: the page API and its access control.
- `src/client.mjs`: reads the app's version and run state, and restarts it.
- `src/launchd.mjs`: the login item.
- `src/catalog.json`: the "Features" list. Test results are welcome.
- `ui/`: the settings page. No framework, no build step.

## License

MIT
