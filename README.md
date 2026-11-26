# agy-flags

在网页上选择要开启的 Antigravity 桌面端实验性功能。[English](README.en.md)

Antigravity 的很多功能由 Google 服务端下发的「实验开关」控制。agy-flags 在本机改写这份下发的配置，让你自己决定哪些开关是开的。

- **不修改 Antigravity 应用**，应用自动更新后不用重新处理。
- **不安装证书，不做 HTTPS 中间人**。
- **只在本机运行**，没有第三方依赖。只有一项可选功能会联网下载公开的价格表。
- **只改写桌面端的请求**，命令行 `agy` 的请求原样放行。

除了开关，它还带四个靠开关做不到的功能：上下文用量指示器、按公开价格估算费用、界面汉化、对话标题用中文。

只支持 macOS，在 Antigravity 2.35.0 到 2.35.2 上实际跑过。

> 这些功能没有正式发布，可能不稳定。改写服务端下发的配置可能不符合 Google 的服务条款，风险由你自己承担。本项目和 Google 没有关系。

## 安装

### 一键安装（推荐）

打开「终端」，粘贴下面这一行，按回车：

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash
```

装完后设置页面会在浏览器里打开。选好功能，按页面提示重启 Antigravity 即可。不需要输入密码。

- 电脑上没有 Node.js 18 或更高版本时，脚本从 nodejs.org 下载官方的 Node.js 24.22.3（约 55 MB），核对 SHA-256 后放进本工具自己的文件夹，不往系统里装东西。它需要 macOS 13.5 或更新。
- 建议把设置页面加入书签。
- 再运行一次安装命令就是更新。更新会重启本工具的常驻进程，正在生成的回答会被打断。
- 要靠代理软件才能访问 Google 时，请用代理软件的 TUN 模式（增强模式）。下载和转发都直接连网，不读「系统代理」设置。

只重新打开设置页面、查看状态、卸载：

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- open
```

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- status
```

```bash
curl -fsSL https://raw.githubusercontent.com/prefusify/agy-flags/main/install.sh | bash -s -- uninstall
```

卸载会移除本工具和它下载的 Node.js，并在需要时重启 Antigravity 一次。你的选择保留在 `~/Library/Application Support/agy-flags`，加 `--purge` 连它一起删掉。卸载后，之前打开的终端要完全退出再打开（见「对命令行 agy 的影响」）。

### 从源码安装

需要 Node.js 18 或更高版本。

```bash
git clone https://github.com/prefusify/agy-flags.git
```

```bash
cd agy-flags && node bin/agy-flags.mjs install
```

`install` 把程序复制到 `~/Library/Application Support/agy-flags/app`，注册登录自启项 `dev.agy-flags.daemon` 并启动常驻进程，再设置环境变量。改了代码要重新运行 `install`。在仓库目录里运行 `npm link` 后，可以直接用 `agy-flags <命令>`。

## 使用

```bash
agy-flags ui
```

1. 在页面上打开想要的功能。
2. 点页面顶部的「重启 Antigravity」。Antigravity 只在启动时读取开关；「对话标题用中文」不用重启。
3. 想恢复默认，把开关拨回去再重启。

页面上只有「精选功能」：逐个打开看过、确实有用的功能。每一项标「已实测」（在标出的版本上看到过效果，说明里写了确认到哪一步）或「未实测」（效果只读自客户端代码）。精选以外的开关可以手工写进 `config.json` 的 `flags`，例如 `"some-flag": true`，效果自负。

| 命令 | 作用 |
| --- | --- |
| `agy-flags status` | 显示常驻进程、环境变量、客户端和已改动开关的状态 |
| `agy-flags ui --print` | 只打印页面地址 |
| `agy-flags uninstall [--restart-client] [--purge]` | 卸载；可顺便重启 Antigravity、删除设置和日志 |
| `agy-flags daemon` | 在前台运行常驻进程 |

## 工作原理

Antigravity 的语言服务器从 `daily-cloudcode-pa.googleapis.com`（`listExperiments`）和 `aicode.googleapis.com`（`fetchConfig`）读取实验开关。它认两个环境变量 `CLOUD_CODE_URL` 和 `AICODE_ENDPOINT_URL`，可以把这两个主机换成别的地址：

```
Antigravity ──HTTP──▶ agy-flags（127.0.0.1:47931 / 47932）──HTTPS──▶ Google
```

- 常驻进程开两个转发端口，用 `launchctl setenv` 把变量设到登录会话里，之后启动的 Antigravity 就把请求发到本机。
- 两个开关响应里，只把你选的开关换成你要的值，其余字段原样保留。改写失败时原样放行。
- 其他请求（包括对话内容）原样流式转发。
- 变量只在端口开始监听后才设置，常驻进程停止前清除。别的程序已经设了这些变量时不覆盖，页面会提示。
- 常驻进程崩溃后由系统在 1 秒内拉起。
- 设置页面在 47930 端口。

### 对命令行 agy 的影响

变量设在登录会话里，终端和其中的命令行 `agy` 也会继承，所以 `agy` 的请求也会到本工具。本工具按请求头 `User-Agent` 区分：桌面端是 `antigravity/hub/…`，命令行是 `antigravity/cli/…`。只改写桌面端的请求，其他来源一律原样放行，开关值就是服务器给的。桌面端改了自称的名字时，开关会停止生效，页面会显示警告。

本工具改变不了两点：

- 命令行的请求仍经过本工具，所以**本工具停了，命令行也用不了**。
- 本工具停止或卸载后，**之前打开的终端还带着变量**，在里面运行 `agy` 会报 `plan model not specified`。把终端完全退出再打开，或运行：

```bash
unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL
```

### 改界面的三项功能

上下文用量指示器、按公开价格估算费用、界面汉化都要改 Antigravity 的界面脚本 `main.js`。本工具不改应用，而是用语言服务器认的第三个环境变量 `AGY_DEV_UI_URL`：设了它，语言服务器就从这个地址取界面文件。常驻进程在 47933 端口提供这些文件：从已安装的语言服务器程序里原样读出，只在 `main.js` 里加本工具的代码。找不到要改的位置时（客户端更新后），原样提供并在页面上警告。

代价：**这三项开着时，界面加载依赖本工具在运行**。本工具不在运行时，重新加载的窗口只显示一段以「The dev UI server at … is not reachable」开头的文字。所以这个变量只在你打开其中一项时才设置。

- **上下文用量指示器**：对外版本有开关但缺组件，本工具补上自己写的组件，只显示上下文用量，不显示配额。重启后还要在客户端打开 Settings → Appearance → Advanced Settings → Chat Layout →「Context and quota indicator」（默认关）。
- **按公开价格估算费用**：「每条回复的 token 用量」里的费用在对外版本上全是 $0.0000，因为语言服务器里没有价格表。本工具每天最多一次从 `https://models.dev/api.json` 下载 Vertex AI 的公开价格，在界面里重算：每一轮按那一轮的模型计价，子代理按它自己的模型计价。只在客户端没给价格时才填。这是按列表价的估算，不是账单；只算输入、缓存读取和输出，Claude 的缓存写入没有计入；价格表里对不上的模型仍显示 $0.0000。
- **界面汉化**：在界面脚本末尾加一段翻译程序，页面上的一段文字和词条表 `src/l10n/zh-CN.json` 里的英文完全相同时整段换成中文。对话正文、代码、终端、输入框，以及对话名、项目名、模型名和文件名不翻译。系统菜单栏、Dock 菜单、系统弹窗、嵌在框架里的页面（例如 Swarm 面板）和词条表里没有的文字保持英文。词条表的一部分取自 [antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese)（MIT）。

### 对话标题用中文

客户端起标题时，把你的第一条消息和一段要求「3 到 5 个英文单词」的指令发给一个小模型，所以标题总是英文。这段指令在语言服务器里，改界面改不到。本工具在转发时认出这个请求，只把要求英文的那一句换成要求简体中文的一句，其余字节不变。找不到那一句或它出现不止一次时原样发出。不用重启，已有对话的标题不变。标题由模型生成，偶尔可能不完全照做。

## 安全和隐私

你的 Google 登录令牌和全部对话内容会经过本机的转发进程。因此：

- 所有端口只监听 `127.0.0.1`。上游地址只来自 `config.json`，全程 HTTPS，证书照常校验。
- 日志只记录事件，不记录请求头、请求体或响应体。
- 设置页面的接口要一个随机令牌（放在地址的 `#` 之后，浏览器不会发给服务器），还检查 `Host` 和 `Origin`，别的网站不能借你的浏览器改设置。页面把令牌存在本地存储里，书签才能一直用。
- 加进界面的代码不发网络请求，写进页面的一律是纯文本。
- 「按公开价格估算费用」开着时，常驻进程只请求 `https://models.dev/api.json`，不带登录信息和你的数据。下载的价格表只保留模型键、数字和模型名，其余丢弃。这一项开着时还会读取模型列表里的显示名，不改动它。
- 「对话标题用中文」是唯一改动模型请求内容的地方。它开着时，转发进程看桌面端每个模型请求开头的 512 个字节，把疑似起标题的请求完整读进内存检查后再发出，不保存、不写日志。
- 一键安装脚本只从 `github.com` 和 `nodejs.org` 下载，不用 `sudo`。

本机上以你的身份运行的其他程序本来就能读你的文件，本工具不防这类程序。

## 测过什么

每项精选功能的实测结果写在设置页面它的说明里。整体上测过的：

- 开关改写在 2.35.0 到 2.35.2 上都生效。在 2.35.0 上还测过：关掉或卸载后恢复原样；对话正常收发；强制杀掉常驻进程后 1 秒内被拉起；卸载后变量、端口和自启项都清理干净。
- 命令行 `agy` 1.5.17：请求全部原样放行，拿到的开关值和直连一样。
- 一键安装：在有和没有 Node.js 的 Apple 芯片 Mac 上，用真实命令装通；校验值不符时停止安装。

没有测过：

- Intel 芯片的 Mac。
- 只开「系统代理」的网络环境。
- Antigravity 的 IDE 版（按规则，它的请求只会被放行）。
- 文字对话以外的功能，例如语音、远程控制、内置浏览器。
- WebSocket 透传（只有单元测试）。
- 开着改界面的功能时客户端自动更新。
- 从 Dock 或启动台启动 Antigravity。

## 已知限制

- **改动要重启 Antigravity 才生效**。登录时系统自动恢复的 Antigravity 可能比常驻进程先启动，不经过本工具；页面会提示你重启一次。
- **这条路可能随时失效**。Google 可以在任何版本里去掉这些环境变量或改变下发方式。Antigravity 改用别的云端主机时，页面会显示「地址不一致」，这时更新本工具或改 `config.json` 里的 `upstreams`。
- **「提示词缓存保活」已删除**。它常常发一两次就停，没命中缓存的那次还按整段输入计费。以前打开过的话，请手工从 `config.json` 的 `flags` 删掉 `enable-prompt-cache-keep-alive` 和 `prompt_cache_keep_alive_max_pings`。

## 出问题时

客户端连不上服务器或显示「Error Loading Models」时，先运行 `agy-flags status`（一键安装的用上面的 `status` 那一行）。日志在 `~/Library/Application Support/agy-flags/daemon.log`。

要立刻绕开本工具，清除三个变量再重启 Antigravity：

```bash
launchctl unsetenv CLOUD_CODE_URL
```

```bash
launchctl unsetenv AICODE_ENDPOINT_URL
```

```bash
launchctl unsetenv AGY_DEV_UI_URL
```

## 文件位置

都在 `~/Library/Application Support/agy-flags/` 下：

| 文件 | 内容 |
| --- | --- |
| `config.json` | 已改动的开关、端口、上游地址。可以手工编辑，会自动重新读取 |
| `token` | 设置页面的访问令牌 |
| `state.json` | 最近一次看到的服务端开关清单和模型显示名 |
| `prices.json` | 从 models.dev 下载的价格表 |
| `daemon.log` | 日志 |
| `app/` | `install` 复制的程序 |
| `runtime/` | 一键安装下载的 Node.js |

登录自启项是 `~/Library/LaunchAgents/dev.agy-flags.daemon.plist`。

## 开发

```bash
npm test
```

测试不调用 `launchctl`，不读写真实的设置目录，不访问网络。

- `src/patch.mjs`：改写开关响应、读模型显示名。
- `src/forward.mjs`：HTTP 转发、按 `User-Agent` 区分来源、改写起标题的请求。
- `src/bundle.mjs`：从语言服务器程序里读内置的界面文件。
- `src/uipatch.mjs`：对界面脚本的改写：指示器组件、费用重算、翻译程序。
- `src/l10n.mjs`、`src/l10n/zh-CN.json`：翻译程序和词条表。
- `src/prices.mjs`：下载和检查价格表。
- `src/uiserver.mjs`：向语言服务器提供界面文件。
- `src/env.mjs`、`src/launchd.mjs`、`src/client.mjs`：环境变量、登录自启项、Antigravity 的状态和重启。
- `src/daemon.mjs`、`src/api.mjs`：常驻进程、设置页面的接口和访问控制。
- `src/catalog.json`：「精选功能」清单。欢迎补充实测结果。
- `ui/`：设置页面，不用框架，不用构建。
- `install.sh`：一键安装和卸载脚本。
- `tools/l10n-candidates.mjs`：列出界面脚本里词条表还翻不了的文字，客户端更新后用来找新文字。

## 许可

MIT。界面汉化词条表的一部分取自 antigravity-chinese（MIT），许可声明见 `src/l10n/LICENSE-antigravity-chinese.txt`。
