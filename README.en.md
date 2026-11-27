# agy-flags

Choose, in Antigravity's own settings, which experimental features of the desktop app are on. [中文](README.md)

Many Antigravity features are controlled by "experiment flags" that Google's servers send to the app. agy-flags rewrites that configuration on your machine, so that you decide which flags are on.

- **It does not modify the Antigravity app**, so nothing has to be redone after the app updates itself. The "AGY-flags" page in the settings is there because the app takes its page files from agy-flags when it starts.
- **No certificate is installed, and HTTPS is not intercepted.**
- **It runs on your machine only** and has no third-party dependencies. One optional feature downloads a public price list.
- **It changes requests of the desktop app only.** Requests of the command line `agy` pass through unchanged.

Besides flags, it has four features that a flag alone cannot give: a context usage indicator, estimated costs, a Chinese interface, and Chinese conversation titles.

macOS only. It ran on Antigravity 2.35.0 to 2.35.2.

> These features are unreleased and may be unstable. Rewriting the configuration that the server sends may be against Google's terms of service. You use this at your own risk. This project is not affiliated with Google.

## Install

### One-step install (recommended)

Open Terminal, paste the line below and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash
```

When it is done, quit and reopen Antigravity and open its Settings: the last entry on the left is **AGY-flags**. Choose features there, then restart Antigravity when the page asks you to. No password is asked.

- If the computer has no Node.js 18 or later, the script downloads the official Node.js 24.22.3 from nodejs.org (about 55 MB), checks its SHA-256 and puts it in the folder of agy-flags. Nothing is installed system-wide. This needs macOS 13.5 or later.
- To update, run the install command again. It restarts the daemon of agy-flags, and an answer that is being produced at that moment is cut off.
- If you reach Google through a proxy app, use its TUN mode (enhanced mode). The download and the forwarder connect directly and do not read the "system proxy" setting.

To see the status, or remove agy-flags:

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- status
```

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- uninstall
```

Removal deletes agy-flags and the Node.js it downloaded, and restarts Antigravity once when that is needed. Your choices stay in `~/Library/Application Support/agy-flags`; add `--purge` to delete them too. Afterwards, quit Terminal completely and open it again (see "Effect on the agy command line").

### Install from source

Node.js 18 or later is required.

```bash
git clone https://github.com/prefusify/agy-flags.git
```

```bash
cd agy-flags && node bin/agy-flags.mjs install
```

`install` copies the program to `~/Library/Application Support/agy-flags/app`, registers the login item `dev.agy-flags.daemon`, starts the daemon and sets the environment variables. Run `install` again after you change the code. Run `npm link` in the repository to use `agy-flags <command>` directly.

## Use

1. In Antigravity, open Settings and click the last entry on the left, "AGY-flags".
2. Turn on the features you want. A feature with a risk note asks first and is turned on only after you confirm.
3. Click "Restart Antigravity" at the top of the page. Antigravity reads its flags only when it starts; "Chinese conversation titles" needs no restart.
4. To go back, set the switch back and restart again.

"Enable agy-flags" at the top of the page is the main switch. Turn it off and restart: Antigravity then connects directly to Google and nothing is rewritten. The "AGY-flags" page stays, so you can turn it on again at any time.

The page has the curated features only: features that were turned on, looked at, and found useful, each with a one-sentence description. A feature whose effect is known from the client code only, and was not seen, is marked "untested"; hold the pointer over a feature name to see the version it was tested on. Other flags can be written by hand into `flags` in `config.json`, for example `"some-flag": true`, at your own risk.

If the settings have no "AGY-flags" page, see "When something goes wrong".

| Command | What it does |
| --- | --- |
| `agy-flags status` | Shows the daemon, the variables, the app and the changed flags |
| `agy-flags uninstall [--restart-client] [--purge]` | Removes agy-flags; can also restart Antigravity and delete the settings and the log |
| `agy-flags daemon` | Runs the daemon in the foreground |

## How it works

Antigravity's language server reads experiment flags from `daily-cloudcode-pa.googleapis.com` (`listExperiments`) and `aicode.googleapis.com` (`fetchConfig`). It accepts two environment variables, `CLOUD_CODE_URL` and `AICODE_ENDPOINT_URL`, that replace these two hosts:

```
Antigravity ──HTTP──▶ agy-flags (127.0.0.1:47931 / 47932) ──HTTPS──▶ Google
```

- The daemon opens two forwarding ports and sets the variables in the login session with `launchctl setenv`, so an Antigravity started afterwards sends its requests to this machine.
- In the two flag responses, only the flags you chose get the values you want; all other fields stay as they are. If rewriting fails, the response passes unchanged.
- All other requests, conversations included, are streamed through unchanged.
- The variables are set only after the ports listen, and cleared before the daemon stops. If another program already set them, agy-flags does not overwrite them; the settings page and `agy-flags status` say so.
- If the daemon crashes, the system starts it again within a second.

### Effect on the agy command line

The variables are set in the login session, so Terminal and the command line `agy` in it inherit them, and the requests of `agy` reach agy-flags too. agy-flags tells the programs apart by the `User-Agent` header: the desktop app sends `antigravity/hub/…`, the command line `antigravity/cli/…`. Only requests of the desktop app are rewritten; everything else passes unchanged, with the flag values the server gave. If a desktop version changes the name it sends, the flags stop working and the page shows a warning.

Two things agy-flags cannot change:

- The command line still goes through agy-flags, so **when agy-flags stops, the command line stops working too**.
- After agy-flags stops or is removed, **a Terminal that was already open still has the variables**, and `agy` in it reports `plan model not specified`. Quit Terminal completely and open it again, or run:

```bash
unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL
```

### The settings page and the three features that change the page

The "AGY-flags" page, the context usage indicator, estimated costs and the Chinese interface all change the page script `main.js` of Antigravity. agy-flags does not modify the app. It uses a third environment variable of the language server, `AGY_DEV_UI_URL`: with it set, the language server takes its page files from that address. The daemon serves them on port 47933: read unchanged from the installed language server program, with the code of agy-flags added to `main.js`. If a place to change is not found (after a client update), that one change is left out, the others are made, and a warning says so.

The price: **the Antigravity page loads only while agy-flags runs.** Otherwise a reloaded window shows only a text that starts with "The dev UI server at … is not reachable". The variable stays set while the main switch is off: without it the "AGY-flags" page would be gone, and with it the place to turn agy-flags on again. To keep Antigravity away from agy-flags completely, remove agy-flags.

- **The AGY-flags settings page**: one more page in the settings of the app, drawn with the app's own styles. The page asks the address of its own window for a few paths below `/__agy_flags/`, and the language server passes them on to the daemon. The app counts which page of its settings you look at; agy-flags keeps it from reporting this page.
- **Context usage indicator**: the public build has the flag but not the component; agy-flags adds a component of its own. It shows context usage, not quota. After the restart, also turn on Settings → Appearance → Advanced Settings → Chat Layout → "Context and quota indicator" in the app (off by default).
- **Estimated costs**: the costs in "Token usage per reply" are all $0.0000 in the public build, because the language server has no price list. Once a day at most, agy-flags downloads the public Vertex AI prices from `https://models.dev/api.json` and computes the costs again in the page: each turn at the prices of its model, each subagent at its own model. It fills in only where the client gave no price. This is an estimate at list prices, not a bill; only input, cache read and output are counted, not the cache writes of Claude; a model that is not in the price list still shows $0.0000.
- **Chinese interface**: a translation program is added at the end of the page script. When a text on the page equals an English entry of `src/l10n/zh-CN.json`, the whole text is replaced with the Chinese one. Conversation text, code, terminals, input boxes, and names of conversations, projects, models and files are not translated. The system menu bar, the Dock menu, system dialogs, pages in frames (for example the Swarm panel) and texts that the table does not have stay English. Part of the table comes from [antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese) (MIT).

### Chinese conversation titles

To name a conversation, the app sends your first message to a small model with an instruction that asks for "3 to 5 English words", so the title is always English. The instruction is in the language server, out of reach of the page. agy-flags recognizes this request in the forwarder and replaces only the sentence that asks for English with one that asks for Simplified Chinese; all other bytes stay. If the sentence is not found, or is found more than once, the request goes out unchanged. No restart is needed, and existing titles do not change. The title comes from a model and may not always follow the instruction.

## Security and privacy

Your Google sign-in token and all conversation content pass through the forwarder on your machine. Therefore:

- All ports listen on `127.0.0.1` only. The upstream addresses come from `config.json` only; the connection is HTTPS all the way, with certificates checked as usual.
- The log records events only, never headers or bodies.
- The requests of the settings page are answered on port 47933, and only for programs of your own account: the daemon uses `lsof` to look up who is on the other end of the connection. When the language server passes a request on, every program that is connected to the language server at that moment must be one of yours as well; one connection that cannot be looked up refuses the request. So another user of the same Mac cannot change your settings.
- These requests are also refused when the `Host` is not the daemon's own address, when they name an `Origin`, or when `Sec-Fetch-Site` is anything but `same-origin`; a change must be sent as JSON. So another website cannot read or change your settings through your browser.
- The answers hold no secret: flag names, settings and status, no conversation content.
- The code added to the page talks only to the address of its own window, for the requests above, and to nothing else. It writes only plain text into the page.
- While "Estimated costs" is on, the daemon requests `https://models.dev/api.json` only, without sign-in data or any of your data. Of the downloaded price list, only model keys, numbers and model names are kept. While it is on, the forwarder also reads the display names in the model list, without changing it.
- "Chinese conversation titles" is the only place where a model request is changed. While it is on, the forwarder looks at the first 512 bytes of each model request of the desktop app, and reads a request that may be a title request into memory to check it before it goes out. Nothing is stored or logged.
- The install script downloads from `github.com` and `nodejs.org` only and does not use `sudo`.

Other programs that run as you on this machine can read and write your files anyway, and they can send the requests above too; agy-flags does not protect against them.

## What was tested

The version that the settings page shows for a feature (hold the pointer over its name) is the version on which its effect was seen. Overall:

- The "AGY-flags" settings page on 2.35.2: turning features on and off, the risk question, the main switch, and "Restart Antigravity" on the page; looked at in Chinese and in English, and in a narrow window (720 wide).
- Flag rewriting worked on 2.35.0 to 2.35.2. Also tested on 2.35.0: turning a flag off or removing agy-flags restores the original; conversations work; after the daemon was killed, it was back within a second; removal cleans up the variables, ports and login item.
- The command line `agy` 1.5.17: all its requests passed unchanged, and it got the same flag values as without agy-flags.
- One-step install: the real command worked on Apple silicon Macs with and without Node.js; a wrong checksum stops the install.

Not tested:

- Intel Macs.
- A network that has only the "system proxy".
- The IDE edition of Antigravity (by the rules, its requests only pass through).
- Features other than text conversations, for example voice, remote control, the built-in browser.
- WebSocket pass-through (unit tests only).
- A client update while a page feature is on.
- Starting Antigravity from the Dock or Launchpad.
- A Mac on which another user is signed in at the same time. That another user is refused is covered by unit tests only.
- The "AGY-flags" page in the mobile web version (remote control). The settings have another, single-page layout there, which the desktop app never shows.

## Known limits

- **Changes need a restart of Antigravity.** An Antigravity that the system reopens at login may start before the daemon. It then bypasses agy-flags and its settings have no "AGY-flags" page; quit and reopen it once.
- **After a client update, the settings page may be missing.** The page is added at three places of the page script that are found by their shape. If a shape has changed, the page is not added; everything else keeps working. `agy-flags status` then says why, and the features can be written into `config.json` by hand meanwhile.
- **When agy-flags stops, a reloaded Antigravity window shows only an error text.** See "The settings page and the three features that change the page".
- **This may stop working at any time.** Google can remove these variables or change how flags are sent in any version. If Antigravity moves to another cloud host, the page shows an "address mismatch" warning; update agy-flags or change `upstreams` in `config.json`.
- **"Prompt cache keep-alive" was removed.** It often stopped after one or two pings, and a ping that missed the cache was billed as the whole uncached input. If you turned it on before, delete `enable-prompt-cache-keep-alive` and `prompt_cache_keep_alive_max_pings` from `flags` in `config.json` by hand.

## When something goes wrong

If the app cannot reach its servers or shows "Error Loading Models", run `agy-flags status` first (after a one-step install, use the `status` line above). The log is `~/Library/Application Support/agy-flags/daemon.log`.

If the settings have no "AGY-flags" page:

1. Quit and reopen Antigravity first. Only an Antigravity that was started while agy-flags runs has the page.
2. If it is still missing, run `agy-flags status`. A `pending` line means that one more restart is needed. `warning: page-not-changed` means that the page can no longer be added after a client update; the reason follows.
3. Without the page, edit `~/Library/Application Support/agy-flags/config.json`; it is read again when you save it. `enabled` is the main switch, `flags` holds the flags (for example `"some-flag": true`), and `features` holds `costPrices` (estimated costs), `uiChinese` (Chinese interface) and `chineseTitles` (Chinese conversation titles). Then restart Antigravity.

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

## Files

All in `~/Library/Application Support/agy-flags/`:

| File | Content |
| --- | --- |
| `config.json` | Changed flags, ports, upstream addresses. You can edit it; it is read again by itself |
| `state.json` | The server flags and model display names seen last |
| `prices.json` | The price list from models.dev |
| `daemon.log` | The log |
| `app/` | The program that `install` copied |
| `runtime/` | The Node.js that the one-step install downloaded |

The login item is `~/Library/LaunchAgents/dev.agy-flags.daemon.plist`.

## Development

```bash
npm test
```

The tests do not call `launchctl`, do not touch the real settings folder, and do not use the network.

- `src/patch.mjs`: rewrites flag responses, reads model display names.
- `src/forward.mjs`: HTTP forwarding, telling sources apart by `User-Agent`, rewriting the title request.
- `src/bundle.mjs`: reads the page files built into the language server program.
- `src/uipatch.mjs`: the changes to the page script: the indicator component, cost recomputation, the translation program.
- `src/settingspage.mjs`: the "AGY-flags" settings page, and the change that adds it to the page script.
- `src/l10n.mjs`, `src/l10n/zh-CN.json`: the translation program and its table.
- `src/prices.mjs`: downloads and checks the price list.
- `src/uiserver.mjs`: serves the page files to the language server, and takes the requests of the settings page.
- `src/env.mjs`, `src/launchd.mjs`, `src/client.mjs`: environment variables, the login item, status and restart of Antigravity.
- `src/daemon.mjs`: the daemon.
- `src/api.mjs`, `src/peer.mjs`: the requests of the settings page, and the check of who sent a request.
- `src/catalog.json`: the curated features. Test results are welcome.
- `install.sh`: the one-step install and removal script.
- `tools/l10n-candidates.mjs`: lists texts in the page script that the table cannot translate yet, to find new texts after a client update.

## License

MIT. Part of the translation table of the Chinese interface comes from antigravity-chinese (MIT); its license is in `src/l10n/LICENSE-antigravity-chinese.txt`.

The idea of putting the choice of features into the settings of the app itself comes from [obsidian-prism](https://github.com/RMvdesi/obsidian-prism). None of its code is used here.
