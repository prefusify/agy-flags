# agy-flags

Choose on a web page which experimental features of the Antigravity desktop app are on. [中文](README.md)

Many Antigravity features are controlled by "experiment flags" that Google's servers send to the app. agy-flags rewrites that configuration on your machine, so that you decide which flags are on.

- **It does not modify the Antigravity app.** The app's files and signature stay as they are, and nothing has to be redone after the app updates itself.
- **No certificate is installed, and HTTPS is not intercepted.**
- **It runs on your machine only**, has no third-party dependencies, and sends none of your data to third parties. One optional feature downloads a public price list (see "Estimate costs at public prices").

Besides flags, it carries some features that a flag alone cannot give: the **context usage indicator**, **costs at public prices**, a **Chinese interface** and **conversation titles in Chinese**. "How it works" says how each is done and what it costs.

macOS only for now. This tool ran on Antigravity 2.35.0, 2.35.1 and 2.35.2; the effect of every curated feature except "Conversation forking" and "Teamwork subagents are not forced to Flash" was seen on 2.35.1 or 2.35.2. The same approach was verified earlier on 2.34.0 with a prototype.

agy-flags changes requests of the desktop app only. Requests of the Antigravity command line `agy` pass through unchanged; see "Effect on the agy command line".

> These features are unreleased and may be unstable. Rewriting the configuration that the server sends may be against Google's terms of service. You use this at your own risk. This project is not affiliated with Google.

## Install

### One-step install (recommended)

Open Terminal (search for "Terminal" in Launchpad), paste the line below and press Return:

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash
```

When it is done, the settings page opens in your browser. Choose features on the page, then restart Antigravity when the page asks you to. The features are then on. You do not need to know how to code, and no password is asked.

The command does four things, in this order:

1. It looks for Node.js (18 or later). If the computer has none, it downloads the official Node.js 24.22.3 from nodejs.org (about 55 MB) into the folder of agy-flags, `~/Library/Application Support/agy-flags/runtime`, and checks its SHA-256. If the checksum is wrong, it stops and does not run the download. Nothing is installed system-wide.
2. It downloads agy-flags from GitHub.
3. It runs `install`, described below.
4. It opens the settings page in the browser.

Notes:

- The Node.js that is downloaded automatically needs macOS 13.5 or later. On an older system the script stops and says what to do.
- Bookmark the settings page and open it from the bookmark later. If the bookmark stops working, use the line under "To open the settings page again" below.
- To update agy-flags, run the install command above again. It restarts the agy-flags daemon, and an answer that Antigravity or the command line `agy` is producing at that moment is cut off, so update when they are idle.
- If you reach Google through a proxy app: use the TUN mode of that app (some apps call it enhanced mode or virtual network adapter). The download command in Terminal and the forwarder of agy-flags connect directly and do not read the "system proxy" setting. A setup with the system proxy only was not tested; by the code, the install may fail to download there, and Antigravity may fail to reach its servers after the install.

To open the settings page again (no update, nothing is restarted):

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- open
```

To see the status:

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- status
```

To remove agy-flags:

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- uninstall
```

This stops and removes agy-flags and deletes the Node.js it downloaded. If Antigravity is running through agy-flags, it is restarted once (when the program files of agy-flags are damaged and the script has to clean up by hand, it asks you to restart Antigravity yourself instead). The features you chose are kept in `~/Library/Application Support/agy-flags` and come back after a new install; add `--purge` at the end of the command to delete them too. After you remove agy-flags, quit Terminal completely and open it again; "Effect on the agy command line" explains why.

### Install from source

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
3. When the daemon is listening, the daemon sets two login-session environment variables (see "How it works"). It sets a third one while the "Context usage indicator", "Estimate costs at public prices" or "Chinese interface" is on.

Run `npm link` in the repository to get the `agy-flags` command. Without it, use `node bin/agy-flags.mjs <command>`.

## Use

```bash
agy-flags ui
```

This opens the settings page in your browser. After a one-step install there is no `agy-flags` command: the page was already opened for you, and later you open it from your bookmark or with the line under "To open the settings page again" above.

1. Turn on the features you want on the page.
2. The page says that a restart is needed. Click "Restart Antigravity". Antigravity reads its flags only when it starts. "Conversation titles in Chinese" is the exception: it needs no restart and works at once.
3. To go back, set the flag back and restart again.

The page has the curated features ("Features") only. They were chosen after the candidate flags were turned on and looked at one by one. Only features with an effect that was seen, and that is useful in daily work, are listed; the exception is under "untested" below. The entries that were added on 2.35.1 and 2.35.2 are listed under "Added to "Features" on 2.35.1 and 2.35.2" in "Verified and not verified"; the others were added on 2.35.0. Each entry is marked "tested" or "untested":

- **tested**: the effect was seen in the app on the version shown. The description says what was seen. Where only the entry point was confirmed and the feature itself was not tried, the description says so.
- **untested**: the effect is known from the client code only and was not seen in the app. At present only "Teamwork subagents are not forced to Flash" is like this; its effect was read from the code of the language server.

Other flags are not on the page. If you really need one, write it into `flags` in `config.json` by hand (see "Files"), for example `"some-flag": true`. The daemon reads the file by itself and rewrites the flag as usual; restart Antigravity afterwards. Such a flag was not chosen or checked; use it at your own risk.

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
- **Every other request and response is streamed through unchanged**, conversations included. A connection upgrade (WebSocket) is tunnelled unchanged too.
- **Only requests of the desktop app are rewritten.** A request from any other program passes through unchanged; see "Effect on the agy command line" below.
- A third port (47930) serves the settings page.

Guarantees by design:

- The variables are set only after the forwarding ports are listening. The daemon clears them before it stops.
- If another program has already set these variables, agy-flags does not overwrite them. The page shows the conflict.
- If a response cannot be rewritten (for example, the server changed the format), it is passed through unchanged.
- Only the responses named above, with status 200, are rewritten. For a flag the server sends, only the value is replaced; every other field is kept.
- When the daemon crashes, the system starts it again (in under 1 second in our test). The app retries in the meantime.

### Effect on the agy command line

The variables live in the login session, so every program started afterwards inherits them, Terminal included. The Antigravity command line `agy` reads the same variables, so when you run `agy` in a terminal, its requests come to agy-flags too. agy-flags handles this by rewriting requests of the desktop app only:

- The Antigravity programs say who they are in every request: the desktop app sends `antigravity/hub/<version>`, the command line sends `antigravity/cli/<version>` (the `User-Agent` header).
- Only a request that names the desktop app is rewritten. A request from the command line, or from any other sender, passes through unchanged: the response is not buffered, not decompressed and not changed, so the flag values are the ones the server sent. The "Server flags" list on the page also looks at requests of the desktop app only.
- The status area of the settings page shows how many requests of the command line were passed through. The status command shows it too.
- If a version of the desktop app changes the name it gives itself, agy-flags no longer recognises it and the flags stop taking effect. After two or three minutes of this, the settings page shows a warning with the name the app now uses.

Two things agy-flags cannot change:

- A request of the command line still goes through agy-flags on its way to Google, so **the command line works only while the agy-flags daemon is running**. The system keeps the daemon running; normally it is always there.
- A program inherits the variables when it starts. When agy-flags stops or is removed, it clears the variables of the login session, but **a terminal that was already open still carries them**, and `agy` in that terminal cannot reach its servers ("When something goes wrong" shows what that looks like). Quit Terminal completely and open it again.

The command line and the desktop app use the same server by default (`daily-cloudcode-pa.googleapis.com`), so going through agy-flags does not move the command line to another server. The third variable, `AGY_DEV_UI_URL`, has no effect on the command line: in print mode and in interactive mode the command line serves no page and does not ask for page files.

To keep `agy` in one terminal away from agy-flags completely, run this in that terminal first:

```bash
unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL
```

### Context usage indicator

The public build of the app has the flag `enable-context-usage-indicator`, but its page does not contain the component, so the flag alone does nothing. agy-flags adds the component through a development entry point that the app itself has:

- The language server honours a third environment variable, `AGY_DEV_UI_URL`. When it is set, the language server no longer uses the page files inside its own program. It takes them from that address.
- The daemon opens a fourth port (47933) as that address. The page files are read, unchanged, out of the installed language server program (they are a ZIP archive inside the program). The program is only read, never written.
- Only one file, `main.js`, is changed, and in one place only: the indicator component is put into the place that the app left empty. Every other file is served unchanged.
- The component is written by agy-flags. It reads the context usage data that the app already has, and shows a ring and a percentage; a click lists the tokens used by each part. It sends no network requests.
- When the place cannot be found (for example, the page script changed after an app update), agy-flags serves the page files unchanged and shows a warning on the settings page. The app works as usual, without the indicator.

The cost: **while this feature is on, the Antigravity page depends on agy-flags running**. While agy-flags is not running, an Antigravity window that is reloaded shows an error text. A window that is already loaded is not affected. For this reason the third variable is set only while this feature is on, and it is cleared when you turn the feature off.

After you turn the flag on and restart the app, one setting in the app must be turned on before the indicator shows: Settings → Appearance → Advanced Settings → Chat Layout → "Context and quota indicator". That setting is off by default.

### Estimate costs at public prices

With `enable-cost-accumulator` on, a dollar-sign button shows under each reply, and a click on it lists token counts and costs. On 2.35.1 every cost is $0.0000. The cause is in the language server of the app: it computes a cost as "tokens × price ÷ 1,000,000", but the program has no price list, and the three prices of every model are 0. The configuration that the server sends has no dollar prices either. This was found by reading the program of the language server, and it agrees with what was measured: every cost and every price that the page receives is 0.

agy-flags fills in the prices on the side of the page:

- The daemon downloads the public price list from `https://models.dev/api.json`, keeps only the prices of Vertex AI (`google-vertex`), and stores them in `prices.json`. It downloads once a day at most. When a download fails, the last list is used, and the download is tried again after one hour. It downloads only while this feature is on.
- The page script is changed in the same way as for the "Context usage indicator", in one more place: the one place where the cost data enters the page. There agy-flags computes the cost of every row from the price list, and then hands the data to the page. Nothing else in the page changes.
- A row is filled in only when the app gave no price: a row whose cost is not 0, or that has a price that is not 0, stays as it is. When the app brings prices of its own one day, they win.
- Models are matched by name. The names in the page carry the thinking level, for example "Gemini 4 Neon (XHigh)". A model counts as matched when its name without the level in brackets is a name of the price list. A model that is not matched stays as it is and still shows $0.0000. The settings page lists which models of the app have a price. In the model list of 2.35.1, "Orchestrator (Neon)", "Orchestrator (Carbon)", "Orchestrator (Argon)" and "Gemini 3 Flash" have no price. "Gemini 4 Hydrogen (Orchestrator)" without its brackets is Gemini 4 Hydrogen, and is paid at that price.

The calculation:

- The cost of a row = input × input price + cache read × cache price + output × output price. "Input" in the page does not include the tokens read from the cache, and "Output" already includes thinking and response, so thinking and response are not added again.
- A conversation can change its model. Each turn is paid at the prices of the model of that turn, and a running total is the sum of the turns. It is not the token count of the total times the price of the last model.
- Subagents are paid at their own model. The sum of all subagents has a row of its own (Subagent) and is part of the total of the last turn (Grand Total).
- When a part of the token count of a running total matches no turn (for example because the app no longer lists older turns), that part is estimated at the model of the turn at that point.

What you should know:

- This is an estimate at public API list prices. It is not what you pay in Antigravity, and it is not your quota.
- Only input, cache read and output are counted. Cache writes of Claude cost more than plain input, and the app does not give their token count, so they are not counted. The cost for Claude is a little too low.
- Prices that depend on the size of the context are not used. The base price is used.
- For a model without a cache price in the list, cache reads are paid at the input price. The settings page says which models these are.
- Like the "Context usage indicator", this makes the Antigravity page depend on agy-flags running. See the section above.

### Chinese interface

The client has no languages of its own: the English text of the page is written directly in the page script `main.js`. So agy-flags does not change the code of the client. It adds a translator to the end of the page script:

- It is added in the same way as the "Context usage indicator": the third variable `AGY_DEV_UI_URL`, and the fourth port that serves the page files. The difference: this feature changes no place inside the script; it only adds to the end.
- When the page has loaded, the translator goes through the whole page once, and after that it watches the page for changes. When the whole of a text is equal to an English entry of the word list, the whole text is replaced with its Chinese form. A text with variable parts (for example "3 files changed") is matched with a regular expression of the word list.
- When the page puts one sentence together from several text parts (for example "No ", "automations", " yet"), the translator looks the parts up as one sentence: with an entry, the whole sentence becomes Chinese; without one, the whole sentence stays in English, and no part is translated alone. A regular expression with only one fixed word (for example "Turn …") is not used for a long run of English words, so that an English description from the server does not get only its first word translated.
- Besides the text that is shown, only these attributes are translated: `title`, `placeholder`, `aria-label`, `aria-description`, `aria-placeholder`, `alt` and `data-tooltip` (hover hints, the placeholder of an input field, and the text for screen readers). Everything is written as plain text.
- Not translated: the text of the conversation (your messages, the replies of the model, the transcript), code blocks, terminals, editors, input fields and other areas that you can edit, and the names of conversations, projects and models, file paths, commit messages and logs. These areas are recognized by the marks that the client itself puts on the page. Buttons inside the conversation text (for example Copy and Retry) are translated as usual.
- The word list is `src/l10n/zh-CN.json`. A part of it comes from the open-source project [antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese) (MIT license; the license notice is in `src/l10n/LICENSE-antigravity-chinese.txt`); only the entries that 2.35.1 still uses were kept. The rest was found in the page script of 2.35.1 and translated new. Every entry was checked again. Well-known nouns such as Agent, Subagent, Skill, MCP, token and Artifact stay in English.
- Only safe regular expressions are accepted: each must match the whole text, and must have no repeated group that can cause much backtracking and no back-reference. Each one is only tried on a text that contains its fixed part, so the page does not get slow.
- After 5 errors the translator stops itself. The page stays in English, and the client works as usual.

As with the indicator, the page depends on agy-flags while this is on. Restart the client after you turn it on or off.

What it cannot reach:

- The system menu bar, the Dock menu and system dialogs. They belong to the shell of the client, not to the page script.
- Pages inside a frame (iframe), for example the Swarm panel. The translator cannot get into them.
- Text that the word list does not have, for example text that a client update adds, and sentences that are put together from parts that mean nothing alone. They stay in English.

### Conversation titles in Chinese

To give a new conversation a title, the client sends a model request of its own: it gives your first message to a small model (`gemini-3.5-flash-lite` on 2.35.1), with an English instruction. The instruction asks for "3-5 words, title-cased", so the title is in English in whatever language you ask. This instruction is in the program of the language server, so a change of the page script cannot reach it.

agy-flags changes this one request when it forwards it:

- Only model requests of the desktop app that are not compressed (paths that end in `GenerateContent`) are looked at.
- A title request is recognized in two steps. First the first 512 bytes of the body are looked at: only a body with the request id `"requestId":"checkpoint/` there is a candidate. Any other request is forwarded at once, as usual. A candidate is received completely, and then its instruction is checked: it must start with "You are a conversation title generator".
- In a title request, the sentence that asks for English is replaced in the original bytes with a sentence that asks for Simplified Chinese (4 to 12 Chinese characters, no prefix, no quotation marks, no punctuation at the end), and the length of the request is updated. All other bytes stay as they are; your message goes out unchanged.
- When the sentence is not found (the client words it differently now), or is found more than once (for example because your message has the same sentence), the request goes out unchanged. In the first case, the settings page shows a warning.
- A candidate larger than 8 MB is not changed and is forwarded as usual.
- No restart of the client is needed: once this is on, the next new conversation gets a Chinese title. The titles of earlier conversations stay as they are.

## Security and privacy

Your Google sign-in token and all conversation content pass through the local forwarder. Therefore:

- The forwarders and the page listen on `127.0.0.1` only.
- The upstream addresses come only from `config.json`. The defaults are the two Google hosts above. The connection to the upstream is HTTPS with normal certificate checks.
- The log records events only (start, how many flags were rewritten, failure reasons). It records no headers and no bodies.
- The port that serves the page files (47933) answers read requests only, and serves only the app's own page files. Conversation traffic does not pass through it: the page talks to the language server directly. The indicator component, the cost calculation and the translator that are added to the page script send no network requests. The indicator and the translator write everything into the page as plain text; the cost calculation writes only numbers into data that the app already has. The word list ships with agy-flags; it is not downloaded.
- The forwarder reads the `User-Agent` of every request to tell whether it comes from the desktop app or from another program. It keeps the last `User-Agent` of each kind of sender in memory, for the status API and for a warning on the page. It does not write it to the log. The Antigravity programs put their program name, version and system type there.
- The page's API needs a random token. `agy-flags ui` passes it to the page in the part of the address after `#`, which browsers send to no server. The API also checks `Host` and `Origin`, so another website cannot change your settings through your browser.
- The page keeps the token in the browser's local storage for this page, so that a bookmark keeps working. Only the scripts of this page can read it, and the page deletes it when the daemon refuses it. If you do not want the token kept, clear the site data of `127.0.0.1:47930` in the browser.
- The one-step install script downloads from `github.com` and `nodejs.org` only. The Node.js it downloads must match the SHA-256 written in the script before it is run. The script does not use `sudo` and writes only to the folder of agy-flags and to the login item.
- While "Estimate costs at public prices" is on, the daemon connects to one third-party host: `models.dev`. It asks for the one address `https://models.dev/api.json` and follows no redirect. The request carries no login data and none of your data; its `User-Agent` is `agy-flags`. While that feature is off, there is no connection.
- The downloaded price list is data from another party, and a part of it is written into a script that runs in the Antigravity page. So only three things are kept from it: model keys made of lowercase letters, digits and hyphens; numbers inside fixed limits; and model names that are shown as plain text in the settings page only. Everything else is dropped. The stored copy is checked again by the same rules when it is read.
- To list in the settings page which models have a price, the forwarder reads the display names in the model list response while that feature is on. It does not change that response.
- "Conversation titles in Chinese" is the only place where agy-flags changes the content of a model request: one sentence of the instruction in the title request. To recognize that request while this is on, the forwarder looks at the first 512 bytes of every model request of the desktop app, and reads a request whose id starts with `checkpoint/` completely into memory, checks it, and then forwards it. Nothing of it is kept or logged. Requests of the `agy` command line are neither looked at nor changed. While this is off, nothing is looked at.
- There are no third-party dependencies, and the code is small enough to read.

Other programs that run as you on this machine can already read your files. agy-flags does not defend against them.

## Verified and not verified

Unless stated otherwise, everything below was tested with this tool on Antigravity 2.35.0 (macOS).

Looked at again on 2.35.1:

- Both flag responses were rewritten, the indicator component was added to the page script, and there was no warning.
- "Developer settings page": Settings has a Developer page.
- "Context usage indicator": a ring and a percentage show next to the input box, and a click lists the usage of each part.
- "Conversation forking": a Fork button shows below a reply, but as on 2.35.0 this does not prove that agy-flags turned it on (the reason is given below).
- The other 9 curated features: they were turned on together, and for each one the entry or setting named in the catalog was seen. They are the redesigned sidebar (the Customize Sidebar menu, with Inbox Mode), conversation groups (Move to Group), the list of background tasks (the Running page), the Markdown artifact width, opening a file with another app (Open with), the sidebar of the file pane (the Artifacts section and the filter box), the connectors entry of the input box, the telemetry switch per conversation, and the new dictation (Dictation languages). This time only the state with the flags on was looked at; the comparison with the flags off is in the 2.35.0 part below.
- The "file pane sidebar" was seen this time with `enable-enhanced-file-viewer` as the only file-related flag that was on. This adds the step that was missing on 2.35.0.
- With the "redesigned sidebar" turned on this time, the grouping stayed at Project, which had been chosen by hand before. It did not change to Status again.

Added to "Features" on 2.35.1 and 2.35.2:

- "Token usage of each reply" (`enable-cost-accumulator`): after the flag was turned on and the app restarted, a dollar-sign button showed under each reply, and a click on it listed the tokens of the turn and the running total. The second turn on the same model showed Cache 14.7K (input 2.2K); the turn after a model change showed Cache 0. The cost column showed $0.0000 for Gemini 4 Neon, Gemini 3.8 Flash and Claude Sonnet 5.5. By the fourth turn the total input was 62.1K, so the zero is not a small number rounded down. After the flag was turned off and the app restarted, the button was gone from the earlier replies, and a new reply did not have it either.
- "Estimate costs at public prices": tested in the same conversation as above. The conversation used Gemini 4 Neon, then Gemini 3.8 Flash, then Claude Sonnet 5.5.
  - With the feature on, the cost of every row agreed with a calculation by hand. The first turn (Gemini 4 Neon, input 16.7K, output 24) showed $0.0506. The second turn (input 2.2K, Cache 14.7K, output 22) showed $0.0090.
  - The third turn, on Gemini 3.8 Flash, showed $0.0128, and the running total at that turn was $0.0723: the sum of the first three turns. The token count of the total at the Flash prices would be about $0.028.
  - A turn with one tool call (Claude Sonnet 5.5, input 2.5K, Cache 104.2K, output 402) showed $0.0195.
  - After two subagents had run, the last turn had a Subagent row with $0.0678 (input 29.4K, Cache 69.4K, output 212). The Grand Total showed $0.2919: the sum of the turns plus the subagents.
  - With the feature off and the app restarted, every row of the same conversation was $0.0000 again.
  - The raw data that the page receives was looked at once: the model name is written with its level, as in "Gemini 4 Neon (XHigh)", and the cost and the three prices are 0.
  - The daemon reached models.dev directly and downloaded the price list. The switch and the "Update prices now" button of the settings page were tried too.
- The next 8 entries were turned on in two test rounds together with other candidate flags (the first round on 2.35.1 with 18 at once, the second on 2.35.2 with 6); they were not turned on one by one. The two plugin marketplace entries, the real runs of the two subagents and the draft that was still there a day later were seen in the second round. "Before" means the time when all these candidate flags were off.
  - "Subagents can use any model of the model menu" (`enable-subagent-dropdown-models`): the agent was asked for the allowed values of the model parameter for a new subagent. Before, they were the four values inherit, flash_lite, flash and pro; after, they were the whole model menu, for example Claude Opus 5.5 (High). A subagent was not actually run on another model.
  - "Code review agent" (`enable-review`): `/review-agent` appears in the slash menu of the input box. It reviewed one line of wrong Python code: after 14 seconds the conversation got the verdict "REQUEST CHANGES", with the problems graded P1 and P3. It was not tried on the changes of a real project.
  - "Deep work agent" (`enable-deepagent`): `/deepagent` appears in the slash menu. Asked whether 1009 is a prime, it made the conversation show "Started Deep Agent", and an answer with its checks came after 8 seconds. It was not tried on a complex task.
  - "Keep drafts across restarts" (`enable-input-draft-persistence`): a draft was left in one conversation, and the sidebar showed a pencil mark next to that conversation. The draft was still there after several restarts and one day; after the draft was deleted, the mark was gone too.
  - "GitHub permissions of a project" (`enable-permissioned-github`): the settings of a project show a "GitHub" row under Permission Settings, and Open leads to the GitHub Permissions page. The page has a field for a personal access token and a "GitHub Policies" switch. The global permission settings do not have this row. No token was entered and no policy was tried.
  - "Prompt the agent to use interactive HTML widgets" (`jetski-generative-ui-prompt`): the agent was asked to check its system prompt. Before, it had no section "Interactive HTML Widgets"; after, it had one. How often the agent really makes widgets was not compared.
  - "Plugin marketplace: most popular first and categories" (`enable-plugin-ranking`): before, the plugin marketplace had no "Filter plugins" button; after, it had one, with 9 categories. With Developer Tools chosen, the list said "Most popular first" and was sorted by user count.
  - "Plugin marketplace: user counts" (`enable-marketplace-user-count`): after, the plugin cards showed user counts, for example 149.4K for Google Drive; before, they did not.
- "Computer use" (`enable-agy-hub-cua-macos`): tested alone on 2.35.2 with macOS 27.2.1.
  - After only one restart, the "Agents" page of the side panel showed "Live preview unavailable" and the agent had no tool to operate the desktop. When the app starts, it reads only the flag value that its previous run recorded, so two restarts are necessary.
  - After two restarts, the log of the app showed that the desktop actuator was registered; the "Agents" page showed "No agent is working right now."; the main agent listed a `computer` subagent. Asked to compute 12×34 with Calculator, the subagent started and stopped at the permission card, with both permissions "Missing".
  - With the flag off again, a retry gave "no desktop actuator connected" (`NO_DESKTOP_ACTUATOR`), and the old permission card did not work. After the flag was turned on again and the app was restarted twice, a new card worked.
  - With Accessibility and Screen Recording given in System Settings, the subagent operated apps. This step was done by plain use of the app; no item-by-item record was kept.
  - Script mode does not work: the system ends `agy-desktop-script selftest` while it applies its sandbox profile, and the log of the app says "script sandbox selftest FAILED".
  - Not tested: other macOS versions, and a conversation in the mode that approves permissions automatically.
  - The main conversation cannot call the desktop tool itself: the language server gives it to the `computer` subagent only and refuses a call from any other agent (read from the text in the program).
- "Computer use: foreground actions" (`enable-agy-hub-cua-foreground`): tested once on 2.35.2 with macOS 27.2.1, with "Computer use" on as well.
  - One restart was enough: the desktop tool had 19 actions instead of 8. The new ones are whole-screen capture, click, double-click, right-click, move, drag, type, key press, scroll, wait, and bringing an app to the front.
  - Asked to compute with Calculator, the subagent made the conversation show two confirmation cards, one after the other: one asked whether it may bring Calculator to the front, look at the screen and use the mouse and keyboard; the other asked whether it may control Calculator in this conversation. Both were answered with "this task only".
  - Calculator was brought to the front. Then the app reported `USER_TAKEOVER` (mouse or keyboard input was seen) and stopped that round; where the input came from was not found out.
  - Not seen to work: whole-screen capture, clicks and typing.
- "Teamwork subagents are not forced to Flash" (`disable-teamwork-forced-flash-model`): marked "untested". Only the code of the language server was read: it checks this flag when it starts a Teamwork subagent. The flag was not turned on in the app to see the effect.
- "Chinese interface": on 2.35.2, after turning it on and restarting the client, the sidebar, the start page, the input box and the options below it, the General page of the settings, the automations page, the interface text of the plugin marketplace, the "Worked for 8s" and "60 minutes ago" under each reply, the cost summary and the context usage indicator were in Chinese. The conversation text, the names of conversations, projects and models, and the plugin descriptions that come from the server stayed in English. The test found some gaps, which were filled: the placeholder of the input box, the "now" next to a new conversation in the sidebar, the group names "Mcp Tools" and "Chat Messages" of the indicator, and sentences that the page puts together from parts ("No automations yet" was shown as "否 automations yet"). It also found that a regular expression with only one fixed word turned only the first word of a long English sentence from the server into Chinese (the plugin description "Turn Figma designs into …" got the form of "Turn {n}"); such expressions are no longer used for long sentences. The other settings pages, the menus and the dialogs were not looked at one by one.
- "Conversation titles in Chinese": on 2.35.2, turned on without a restart of the client; two new conversations, both asked in English. The one that asked "What is the capital of France?" got the title 法国首都查询 ("question about the capital of France"). The message of the other one was an instruction to reply only OK, and its title was 忽略系统指令与回复要求 ("ignore the system instruction and the reply requirement"): the title was in Chinese, but the title model took the message as a request to not follow its own instruction. The settings page counted 2 changed title requests and showed no warning.

Effect on the command line `agy` (1.5.17):

- Before the change, for comparison: when the command line ran through the old agy-flags, the flag responses it received were rewritten (9 flags).
- Now: with the same run of the command line, agy-flags passed 17 of its requests through and rewrote none. "Last rewrite" and "Server flags" on the page did not change. The command line gave its answer as usual.
- A recording program was put between the command line and agy-flags to see the flag values that the command line really receives. The server sent 8 of the 9 flags, and all had the server's value, off, the same as on a direct connection. The response was still compressed and had not been encoded again. At the same time the desktop app received the rewritten value, on.
- When the port of agy-flags is not listening, the command line fails with `failed to construct executor: plan model not specified` and gives no answer.
- The third variable: in print mode and in interactive mode the local port of the command line answered a page request with 404, and the command line did not ask agy-flags for page files. The `remote-control` mode was not tested.

The one-step install script:

- Tested from the source folder on this machine: install when the computer has Node.js; uninstall, with and without `--purge`; uninstall when the program files are already gone.
- The case without Node.js was tested with a download address set up on this machine. With a wrong checksum the install stops and leaves nothing behind. With the right checksum, Node.js goes into the folder of agy-flags, the login item uses it, and the daemon starts. On a system older than 13.5 the script explains and stops.
- The real one-step command (`curl … | bash`) was tested on a computer that already had Node.js: the script and agy-flags were both downloaded from GitHub, the install succeeded, the installed program was the same as the one in the repository, and the temporary folder was deleted. `status` run in the same way worked too.
- The real one-step command was also tested in an environment where no Node.js can be found (a Mac with Apple silicon): the script downloaded Node.js 24.22.3 from nodejs.org, the checksum matched, and only the `node` program and the licence file went into the folder of agy-flags. The login item uses that Node.js, the daemon started, and Antigravity kept running through agy-flags. The unit tests of this project all pass on that Node.js.
- **Not tested**: a Mac with an Intel processor. The checksum of the Intel build of Node.js in the script is taken from the list that nodejs.org publishes, but the script did not run on an Intel Mac.

The results below are from 2.35.0.

Basics:

- After install, turning on "Developer settings page" on the page and restarting shows the Developer page in Settings. Turning it off, or uninstalling, and restarting removes it.
- Conversations work (streamed replies).
- After the daemon is killed, the system restarts it in under 1 second and the app keeps working.
- After uninstall, the variables are cleared, the ports are free, and the login item file is gone.
- Integer flags: tested with "Prompt cache keep-alive", which is now removed. The server does not send its count parameter; keep-alive requests started only after agy-flags wrote it. The page has no integer flag now; an integer can only be written into `config.json` by hand.

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

Not verified:

- Features other than text chat, for example voice mode, remote control and the built-in browser. Only text chat was tried with the real app.
- The tunnel for connection upgrades (WebSocket). It has a unit test only; no such request was seen in real traffic.
- String flags written into `config.json` by hand. Not tested with the real app.
- Cases of "Estimate costs at public prices" that were not looked at: models other than the three above; a turn whose subagent uses another model than the main conversation; a long conversation that was compacted. The ⓘ hint in the cost popover shows only while the pointer is over it; the prices and the model name it shows were not looked at. After a restart of the app, the usage of subagents comes back into the totals only after the conversation runs one more turn; this is the behaviour of the app itself.
- A network that needs the system proxy to reach models.dev. The daemon connects directly and does not read proxy settings.
- An app update while the "Context usage indicator" is on. By design the page files change together with the app's program, and they are served unchanged when they cannot be changed safely; this has unit tests only.
- Antigravity was started with the `open` command and with the "Restart" button of agy-flags only. Starting it from the Dock or Launchpad was not tested separately.
- Networks where Google is reachable only through a system proxy. The forwarder connects to Google directly and does not read proxy settings.
- The Antigravity IDE. See the next section.

Verified on 2.34.0 with a prototype (not this code): when the forwarder stops for a while, the app shows a retry message and recovers. This was not tested again on 2.35.0 with this tool.

## Known limits

- **A change needs a restart of Antigravity.**
- **An Antigravity that starts before the daemon is not routed.** If the system reopens Antigravity at login, it can start before the daemon. The page then asks you to restart it once.
- **While the "Context usage indicator", "Estimate costs at public prices" or "Chinese interface" is on, the page depends on agy-flags.** While agy-flags is not running, an Antigravity window that is reloaded shows an error text (see "When something goes wrong"). If you do not want this, leave these three features off; the other features are not affected.
- **The Chinese interface is not complete.** The system menu bar, the Dock menu, system dialogs and pages inside a frame (for example the Swarm panel) cannot be reached; text that the word list does not have stays in English. Text that a client update adds waits for an update of the word list.
- **A Chinese title is made by the model.** agy-flags changes only the instruction, and the model may not always follow it exactly; for example, a title can be longer. If a later client words this instruction differently, agy-flags passes the request through unchanged, the titles are in English again, and the settings page says so.
- **An estimated cost is not a bill.** It uses public API list prices and counts only input, cache read and output. The prices come from models.dev, not from Google. See "Estimate costs at public prices".
- **The indicator component is written by agy-flags; it is not Google's original.** It shows context usage only, not the model quota. If the structure of the page script changes after an app update, the component turns itself off until agy-flags is updated.
- **"Prompt cache keep-alive" was removed.** In the tests the keep-alive requests went out on time, but they often stopped after one or two: when one keep-alive misses the cache, the app sends no more, and the one that missed is charged as uncached input for the whole context. If you turned it on with agy-flags before, the two flags `enable-prompt-cache-keep-alive` and `prompt_cache_keep_alive_max_pings` are still in `flags` in `config.json`. The page no longer shows them; remove them by hand.
- **Other programs inherit the variables too.** The variables live in the login session, so every program started afterwards (terminals included) carries them. Almost all programs ignore these names. The Antigravity command line `agy` reads them: its requests go through agy-flags, but they are not rewritten. It therefore needs the agy-flags daemon to be running, and after agy-flags stops or is removed, a terminal that was already open must be quit and opened again. See "Effect on the agy command line". The Antigravity IDE was not tested; by the same rule its requests only pass through.
- **The desktop app is recognised by the name it gives itself.** If a version of the desktop app changes that name, the flags stop taking effect and the page shows a warning, until agy-flags is updated.
- **The cloud addresses are fixed in the configuration.** If a version of Antigravity moves to another host, the page shows an "endpoint mismatch" warning. Update agy-flags, or edit `upstreams` in `config.json`.
- **This can stop working at any time.** Google can remove these variables or change how flags are delivered in any release.

## When something goes wrong

If the app cannot reach its servers or shows "Error Loading Models", look at the status first:

```bash
agy-flags status
```

After a one-step install there is no `agy-flags` command. Use the line under "To see the status" in "One-step install" instead.

If the command line `agy` fails in a terminal with `failed to construct executor: plan model not specified; you must specify a valid model`, and you did not change any model setting: that terminal probably still carries the variables of agy-flags, while agy-flags has stopped or was removed. Quit Terminal completely and open it again, or run `unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL` in that terminal.

If an Antigravity window shows only a text that starts with "The dev UI server at … is not reachable", the "Context usage indicator", "Estimate costs at public prices" or "Chinese interface" is on and agy-flags is not running. Get agy-flags running again and reload the window, or clear the variables as shown below.

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
| `~/Library/Application Support/agy-flags/state.json` | The server flag list and the model display names as last seen |
| `~/Library/Application Support/agy-flags/prices.json` | The price list downloaded from models.dev. This file does not exist until "Estimate costs at public prices" was turned on once |
| `~/Library/Application Support/agy-flags/daemon.log` | The log |
| `~/Library/Application Support/agy-flags/app/` | The program copied by `install` |
| `~/Library/Application Support/agy-flags/runtime/` | The Node.js downloaded by the one-step install script. Absent when the computer had Node.js already |
| `~/Library/LaunchAgents/dev.agy-flags.daemon.plist` | The login item |

To update agy-flags, run the one-step install command again. After an install from source, pull the new code and run `agy-flags install` again.

## Development

```bash
npm test
```

The tests do not call `launchctl`, do not touch the real settings directory, and do not use the network.

- `src/patch.mjs`: pure functions that rewrite the two flag responses and read the display names of the models.
- `src/forward.mjs`: the HTTP forwarder for one upstream, the rule that tells from the `User-Agent` who sent a request, and the change of the title request.
- `src/bundle.mjs`: finds and reads the page files inside the language server program.
- `src/uipatch.mjs`: the three changes to the page script: the indicator component, the function that computes the costs from the price list, and the translator at the end.
- `src/l10n.mjs`: the translator of the page, and the rules that a word list must follow.
- `src/l10n/zh-CN.json`: the Simplified Chinese word list.
- `src/prices.mjs`: downloads, checks and stores the price list of models.dev.
- `src/uiserver.mjs`: the server that gives the page files to the language server.
- `src/env.mjs`: the rules for setting and clearing the variables.
- `src/daemon.mjs`: puts the forwarders, the page API and the variables together.
- `src/api.mjs`: the page API and its access control.
- `src/client.mjs`: reads the app's version and run state, and restarts it.
- `src/launchd.mjs`: the login item.
- `src/catalog.json`: the "Features" list. Test results are welcome.
- `ui/`: the settings page. No framework, no build step.
- `install.sh`: the one-step install and uninstall script.
- `tools/l10n-candidates.mjs`: lists the texts in the page script of the installed client that the word list cannot translate yet. Run it before and after a client update and compare the two outputs to find the new texts. The output also holds many strings that are not interface text; pick by hand.

## License

MIT. A part of the word list for the Chinese interface comes from antigravity-chinese (MIT); its license notice is in `src/l10n/LICENSE-antigravity-chinese.txt`.
