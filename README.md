# agy-flags

在网页上选择要开启的 Antigravity 桌面端实验性功能。[English](README.en.md)

Antigravity 的很多功能由 Google 服务端下发的「实验开关」控制。agy-flags 在本机改写这份下发的配置，让你自己决定哪些开关是开的。

- **不修改 Antigravity 应用**。应用的文件和签名保持原样，应用自动更新后不用重新处理。
- **不安装证书，不做 HTTPS 中间人**。
- **只在本机运行**，没有第三方依赖，不向任何第三方发送数据。

除了开关，它还带两个靠开关单独打不开的功能：**提示词缓存保活**和**上下文用量指示器**。两者的做法和代价见「工作原理」。

目前只支持 macOS。本工具在 Antigravity 2.35.0 上实际跑过；同一条技术路线此前用一个原型在 2.34.0 上验证过。

> 这些功能没有正式发布，可能不稳定。改写服务端下发的配置可能不符合 Google 的服务条款，风险由你自己承担。本项目和 Google 没有关系。

## 安装

需要 Node.js 18 或更高版本（只在 Node.js 24 上实际跑过）。

```bash
git clone https://github.com/prefusify/agy-flags.git
```

```bash
cd agy-flags && node bin/agy-flags.mjs install
```

`install` 做三件事：

1. 把程序复制到 `~/Library/Application Support/agy-flags/app`。
2. 注册一个登录自启项（`~/Library/LaunchAgents/dev.agy-flags.daemon.plist`），并立刻启动常驻进程。
3. 常驻进程开始监听后，设置两个登录会话环境变量（见「工作原理」）。打开「上下文用量指示器」时会再设置第三个。

想把 `agy-flags` 当命令直接用，可以在仓库目录里运行 `npm link`。下文都写 `agy-flags <命令>`；没有运行 `npm link` 时，用 `node bin/agy-flags.mjs <命令>` 代替。

## 使用

```bash
agy-flags ui
```

这会在浏览器里打开设置页面。

1. 在「精选功能」里打开想要的功能，或者在「全部开关」里搜索并修改任意一个布尔开关。
2. 页面顶部会提示「重启后才会生效」。点「重启 Antigravity」。Antigravity 只在启动时读取开关。
3. 想恢复默认，把开关拨回去，再重启一次。

「全部开关」列出服务端下发的所有开关（2.35.0 上是 651 个）。每个布尔开关有三个状态：「默认」（服务端给什么就是什么）、「开」、「关」。整数开关有一个输入框：填数字就是改写，清空就是恢复默认。字符串等其他类型的开关在页面上只读。

「精选功能」是在 2.35.0 上把候选开关逐个打开看过之后挑出来的，只收打开后确实看到效果、并且对日常使用有用的功能。每一项都标了「已实测」或「未实测」：

- **已实测**：在标出的版本上，在客户端里看到过开启后的效果。说明文字写的是看到的东西；只确认了入口、没有试功能本身的，说明里会写明。
- **未实测**：效果只是从客户端的界面代码里读出来的，没有在客户端里看到。目前清单里没有这样的项。

打开后没看到效果的开关不在「精选功能」里，名单见「已验证和未验证」。它们仍然可以在「全部开关」里打开。

其他命令：

| 命令 | 作用 |
| --- | --- |
| `agy-flags status` | 显示常驻进程、环境变量、客户端和已改动开关的状态 |
| `agy-flags ui --print` | 只打印页面地址，不打开浏览器 |
| `agy-flags uninstall` | 停止并移除登录自启项，清除环境变量 |
| `agy-flags uninstall --restart-client` | 同上，并在需要时自动重启 Antigravity |
| `agy-flags uninstall --purge` | 同上，并删除设置和日志 |
| `agy-flags daemon` | 在前台运行常驻进程（登录自启项运行的就是它） |

## 工作原理

Antigravity 的语言服务器从两个地址读取实验开关：

- `https://daily-cloudcode-pa.googleapis.com/v1internal:listExperiments`
- `https://aicode.googleapis.com/v1alpha:fetchConfig`

语言服务器认两个环境变量，`CLOUD_CODE_URL` 和 `AICODE_ENDPOINT_URL`，它们可以把这两个主机换成别的地址。agy-flags 利用这一点：

```
Antigravity ──HTTP──▶ agy-flags（127.0.0.1:47931 / 47932）──HTTPS──▶ Google
```

- 常驻进程在本机开两个转发端口，各对应一个 Google 主机。
- 它用 `launchctl setenv` 把这两个环境变量设到登录会话里。之后启动的 Antigravity 会继承它们，把请求发到本机。
- 上面两个响应会被改写：把你选的开关值写进去。
- 有些开关是按模型读取的（目前只有「提示词缓存保活」一组）。只有打开了这类功能时，本工具才会多改写一个响应：模型列表（`v1internal:fetchAvailableModels`），把这几个开关写进每个模型自带的开关里。
- **其他所有请求和响应原样流式转发**，包括对话内容。连接升级（WebSocket）也原样透传。
- 第三个端口（47930）提供设置页面。

设计上保证的几件事：

- 环境变量只在转发端口已经在监听之后才设置；常驻进程停止前会先清除它们。
- 别的程序已经设置了这些变量时，agy-flags 不覆盖，页面上会提示冲突。
- 改写失败（比如服务端换了格式）时原样放行，不影响客户端使用。
- 只改写状态码为 200 的上述响应。服务端发来的每个开关只换值，其余字段原样保留。模型列表里除了写进去的开关，其他内容不变。
- 常驻进程崩溃后由系统自动拉起（实测不到 1 秒）。这期间客户端会自动重试。

### 提示词缓存保活

保活是客户端自带的功能，本工具只负责把它打开。它要同时满足三个条件：开关 `enable-prompt-cache-keep-alive` 为开；整数开关 `prompt_cache_keep_alive_max_pings` 是正数（服务端不下发这个开关，由本工具加进去）；这两个开关还要出现在模型列表里每个模型自带的开关中。所以打开这一项时，本工具会改写模型列表这个响应。

打开后，客户端在一个对话的上一次请求开始 270 秒后发一次保活请求，之后每 270 秒一次，直到次数用完或者你发了新消息。某一次保活没有命中缓存时，客户端也会停止这段空闲的保活（这一条是从客户端程序里读出来的，并在命令行版上看到过；桌面端上没有单独验证）。每次保活是一次真实的模型请求，会消耗配额。

### 上下文用量指示器

对外版本的客户端有 `enable-context-usage-indicator` 这个开关，但界面里没有带对应的组件，所以只开开关没有效果。本工具用客户端自己留的一个开发用入口来补上这个组件：

- 语言服务器认第三个环境变量 `AGY_DEV_UI_URL`。设了它以后，语言服务器不再用自己程序里内置的界面文件，改从这个地址取。
- 常驻进程开第四个端口（47933）当这个地址。界面文件从已安装的语言服务器程序里原样读出来（它们是程序里内置的一个 ZIP 压缩包），只读不写。
- 只有 `main.js` 一个文件会被改，而且只改一处：把指示器组件填进客户端原本留空的位置。其他文件原样提供。
- 组件是本工具自己写的。它读取客户端已有的上下文用量数据，显示一个圆环和百分比，点开列出各部分占用的 token。它不发任何网络请求。
- 找不到要改的位置时（比如客户端更新后界面脚本变了），本工具原样提供界面文件，并在设置页面上给出警告。客户端照常可用，只是没有指示器。

这样做的代价：**打开这一项期间，Antigravity 的界面加载依赖本工具在运行**。本工具不在运行时，重新加载的 Antigravity 窗口会显示一段报错文字；已经加载好的窗口不受影响。因此第三个环境变量只在你打开了这一项时才设置，关掉后会清除。

打开开关并重启客户端后，还要在客户端里打开一个设置才能看到指示器：Settings → Appearance → Advanced Settings → Chat Layout →「Context and quota indicator」。这个设置默认是关的。

## 安全和隐私

你的 Google 登录令牌和全部对话内容会经过本机的转发进程。因此：

- 转发进程和页面只监听 `127.0.0.1`，局域网里的其他机器连不上。
- 转发的上游地址只来自 `config.json`，默认是上面两个 Google 主机；到上游全程 HTTPS，证书照常校验。
- 日志只记录事件（启动、改写了几个开关、失败原因），不记录请求头、请求体或响应体。
- 为了在页面上显示「保活请求发了几次」，转发进程会在模型请求经过时查找一个固定的标签名（`prompt_cache_keep_alive`）。它只计数，不保存也不记录请求内容。
- 提供界面文件的端口（47933）只回应读取请求，只提供客户端自带的界面文件。对话流量不经过它：界面直接和语言服务器通信。加进界面脚本的指示器组件不发网络请求，页面内容一律按纯文本写入。
- 设置页面的接口需要一个随机令牌（`agy-flags ui` 通过地址里 `#` 之后的部分交给页面，浏览器不会把这部分发给任何服务器）。接口还会检查 `Host` 和 `Origin`，别的网站不能通过你的浏览器来改设置。
- 没有任何第三方依赖，代码量不大，可以自己读一遍。

本机上以你的身份运行的其他程序本来就能读你的文件，本工具不防这类程序。

## 已验证和未验证

以下都在 Antigravity 2.35.0（macOS）上用本工具实测。

基本功能：

- 安装后在页面里打开「开发者设置页」并重启，Settings 里出现 Developer 页；关掉或卸载并重启后消失。
- 对话正常收发（流式回复）。
- 强制杀掉常驻进程，系统在 1 秒内把它拉起，客户端继续可用。
- 卸载后环境变量被清除，端口释放，登录自启项文件被删除。
- 整数开关：通过保活的次数参数实测。服务端不下发这个参数，本工具写进去之后保活才开始发出。

提示词缓存保活：

- 打开后，模型列表里的 41 个模型都被写进了两个保活开关；模型列表每 6 分钟刷新一次，刷新后再次被改写。
- 一个空闲对话的保活请求按时发出：第 1 次在主请求之后约 270 秒，第 2 次再过 270 秒。另用一个独立的记录程序核对过，次数和本工具页面上显示的一致。
- 第 1 次保活命中了缓存，第 2 次没有命中。第 3 次及以后没有测。

上下文用量指示器：

- 打开开关、重启客户端、再在客户端设置里打开「Context and quota indicator」之后，输入框旁出现圆环和百分比；点开显示已用和上限的 token 数，以及 System Prompt、Tools、Chat Messages 等各部分的占用。
- 验证时去掉了客户端里原有的本地覆盖，确认只靠本工具就能打开。
- 只在文字对话里看过，没有测长对话被压缩之后的显示。

「精选功能」里的其余各项：

- 「对话分组」「后台任务一览」「调整 Markdown 工件宽度」「输入框里的连接器入口」「按对话开关遥测」「新版听写」「用其他应用打开文件」：打开时看到了说明里写的界面变化；没开时，同一位置没有它。
- 「新版侧边栏」：同上，但 2 个开关是一起开的，没有分开测。关掉后，旧侧边栏仍按 Status 分组，要在 Display Options → Group By 里手动选回 Project。
- 「文件面板侧栏」：同上。测试时同时开着 5 个和文件有关的开关；清单里只留了 `enable-enhanced-file-viewer`，因为界面代码里这两处变化只由它控制。没有单独只开它重测。
- 「对话分叉」：标的是 2.34.0。开和关的对照是在 2.34.0 上用原型做的。在 2.35.0 上 7 个开关一起打开时能看到 Fork 菜单和按钮，但测试用的客户端里另有同名的本地覆盖（Developer 页的 Custom Flags），所以这次看到的不能证明是本工具打开的。
- 上面多数项只确认了入口或设置项出现，没有把功能本身用一遍。各项的说明里写明了确认到哪一步。

看过但没有放进「精选功能」的开关（2.35.0）：

| 开关 | 看到的结果 |
| --- | --- |
| `enable-agy-hub-cua-macos`、`enable-agy-hub-cua-foreground` | 侧面板多出「Agents」面板，但它显示「Live preview unavailable」的报错；问代理，它回答没有操作桌面的工具 |
| `enable-bottom-terminal-panel` | 设置里没有出现「Terminal placement」，没有看到变化 |
| `enable-file-explorer-tab` | 侧面板的入口列表里没有出现文件浏览入口 |
| `enable-move-conversation-to-project` | 对话菜单里没有出现移动到项目的选项 |
| `enable-browser-site-data-controls` | Settings → Browser 页开关前后一样 |
| `enable-input-autocomplete` | 在输入框里打字，没有出现补全提示 |
| `enable-pane-selection-actions` | 在文件预览里选中文字后出现的「Comment」「Quote」，不开这个开关也有 |
| `enable-paste-text-as-snippet` | 2.35.0 的界面脚本里没有代码使用它 |
| `show-all-models-in-gemini-app` | 从界面代码看，它只作用于嵌在别的应用里的那种界面，不作用于桌面端 |
| `enable-battle-mode` | 输入框和菜单里没有看到新的入口 |
| `enable-upload-html-artifact-to-drive`、`enable-resume-conversations-from-restart`、`enable-text-transitions`、`markdown-virtualize-long-documents`、`enable-marketplace-new-badge` | 打开过，但没有专门去确认效果 |

这些开关仍然可以在「全部开关」里打开。另外有一批开关在对外版本里做不了：有的要求 Google 内部身份（例如 `context-window-selector`），有的对应的界面组件没有随对外版本发布（例如代码搜索）。

没有验证：

- 文字对话以外的功能，例如语音模式、远程控制、内置浏览器。真实客户端上只试过文字对话。
- 连接升级（WebSocket）的透传。只有单元测试，没有在真实客户端的流量里遇到过。
- 字符串类型的开关。页面上只读；可以手工写进 `config.json` 的 `flags`，但没有在真实客户端上测过。
- 打开「上下文用量指示器」后客户端自动更新的情况。设计上，界面文件随客户端程序一起换新，改不了时原样提供；这一点只有单元测试。
- 只用 `open` 命令和本工具的「重启」按钮启动过 Antigravity，没有专门测过从 Dock 或启动台点击启动。
- 需要系统代理才能访问 Google 的网络环境。转发进程直接连接 Google，不读取代理设置。
- Antigravity 的 IDE 版和命令行（`agy`）。见下一节。

在 2.34.0 上用原型（不是本工具的代码）验证过：转发进程中途停止时，客户端显示重试并自动恢复。这一项没有在 2.35.0 上用本工具重测。

## 已知限制

- **改动要重启 Antigravity 才生效**。
- **登录后先启动的 Antigravity 不经过本工具**。如果系统在登录时自动恢复了 Antigravity，它可能比常驻进程先启动。页面会提示你重启一次。
- **打开「上下文用量指示器」期间，界面加载依赖本工具**。本工具不在运行时，重新加载的 Antigravity 窗口会显示一段报错文字（见「出问题时」）。不想承担这一点，就不要打开这一项；其他功能不受影响。
- **指示器组件是本工具自己写的，不是 Google 的原版**。它只显示上下文用量，不显示模型配额。客户端更新后如果界面脚本的结构变了，它会自动停用，直到本工具更新。
- **保活不保证命中缓存**。实测中第 1 次保活命中了缓存，第 2 次没有命中。没命中的那次按整段未缓存输入计费。
- **其他程序也会继承这些环境变量**。变量设在登录会话里，之后启动的所有程序（包括终端）都带着它们。绝大多数程序不认这些名字，没有影响。但 Antigravity 的命令行 `agy` 会读 `CLOUD_CODE_URL`：在变量设置之后打开的终端里运行 `agy`，它的请求也会经过本工具，开关也会被改写。这种组合没有测过，IDE 版也没有测过。不想让某个终端里的 `agy` 经过本工具，先在那个终端里运行 `unset CLOUD_CODE_URL AICODE_ENDPOINT_URL AGY_DEV_UI_URL`。
- **云端地址是写死的**。如果某个版本的 Antigravity 改用别的主机，页面会显示「地址不一致」的警告。这时请更新本工具，或者修改 `config.json` 里的 `upstreams`。
- **这条路可能随时失效**。Google 可以在任何一个版本里去掉这些环境变量，或者改变下发方式。

## 出问题时

客户端提示连不上服务器或「Error Loading Models」时，先看状态：

```bash
agy-flags status
```

Antigravity 的窗口只显示一段以「The dev UI server at … is not reachable」开头的文字时，说明「上下文用量指示器」开着，而本工具没有在运行。让本工具恢复运行后重新加载窗口，或者按下面的办法清除变量。

要立刻绕开本工具，清除三个变量，再重启 Antigravity：

```bash
launchctl unsetenv CLOUD_CODE_URL
```

```bash
launchctl unsetenv AICODE_ENDPOINT_URL
```

```bash
launchctl unsetenv AGY_DEV_UI_URL
```

日志在 `~/Library/Application Support/agy-flags/daemon.log`。

## 文件位置

| 路径 | 内容 |
| --- | --- |
| `~/Library/Application Support/agy-flags/config.json` | 设置：已改动的开关、端口、上游地址。可以手工编辑，常驻进程会自动重新读取 |
| `~/Library/Application Support/agy-flags/token` | 设置页面的访问令牌 |
| `~/Library/Application Support/agy-flags/state.json` | 最近一次看到的服务端开关清单 |
| `~/Library/Application Support/agy-flags/daemon.log` | 日志 |
| `~/Library/Application Support/agy-flags/app/` | `install` 复制的程序 |
| `~/Library/LaunchAgents/dev.agy-flags.daemon.plist` | 登录自启项 |

更新本工具：拉取新代码后再运行一次 `agy-flags install`。

## 开发

```bash
npm test
```

测试不调用 `launchctl`，不读写真实的设置目录，不访问网络。

目录结构：

- `src/patch.mjs`：改写两种开关响应和模型列表的纯函数。
- `src/forward.mjs`：单个上游的 HTTP 转发。
- `src/bundle.mjs`：从语言服务器程序里找到并读取内置的界面文件。
- `src/uipatch.mjs`：指示器组件，以及把它填进界面脚本的改写。
- `src/uiserver.mjs`：向语言服务器提供界面文件的服务。
- `src/env.mjs`：环境变量的设置和清除规则。
- `src/daemon.mjs`：把转发、页面接口和环境变量组合成常驻进程。
- `src/api.mjs`：设置页面的接口和访问控制。
- `src/client.mjs`：读取 Antigravity 的版本和运行状态，重启它。
- `src/launchd.mjs`：登录自启项。
- `src/catalog.json`：「精选功能」清单。欢迎补充实测结果。
- `ui/`：设置页面，不用框架，不用构建。

## 许可

MIT
