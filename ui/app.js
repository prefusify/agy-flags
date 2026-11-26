'use strict';
// The whole page. No framework, no build step. Text from the server (flag names, values,
// catalog entries) always goes into the page with textContent, never as HTML.

(() => {
  const I18N = {
    zh: {
      tagline: '选择要开启的 Antigravity 实验性功能',
      langButton: 'English',
      gateTitle: '需要重新打开这个页面',
      gateBody: '这个页面要带着本机的访问令牌打开，而这个浏览器里没有保存令牌。请打开「终端」，粘贴下面这一行并按回车。它只重新打开本页，别的都不动：',
      gateAlt: '如果你是下载源码安装的，也可以在源码文件夹里运行：',
      injection: '启用改写',
      injectionOn: '本工具正在改写 Google 下发给 Antigravity 的开关配置。',
      injectionOff: '已关闭：流量原样通过，不改写任何内容。',
      factClient: 'Antigravity',
      factRoute: '连接方式',
      factInjected: '上次改写',
      factServer: '服务端开关',
      factOthers: '其他程序',
      othersLine: '命令行 agy 的请求 {cli} 个，其他来源 {other} 个：全部原样放行，没有改写',
      running: '运行中',
      notRunning: '未运行',
      notInstalled: '未找到',
      routed: '经过 agy-flags',
      direct: '直连 Google',
      unknown: '—',
      neverSeen: '还没有看到客户端的请求',
      injectedLine: '{name} {time}，改写 {n} 个',
      notPatchedLine: '{name} {time}，未改写',
      serverLine: '{n} 个',
      bannerNotRouted: 'Antigravity 在本工具生效之前就启动了。重启后，改动才会生效。',
      bannerStillRouted: '改写已关闭。Antigravity 还带着旧设置运行，重启后恢复为直连 Google。',
      bannerFlagsChanged: '你改了开关。Antigravity 只在启动时读取开关，重启后才会生效。',
      bannerPageOff: '需要改界面的功能已经关闭。Antigravity 还在从本工具加载界面，重启后恢复为自带的界面。',
      pageCarried: '界面文件：Antigravity 正在从本工具加载。',
      pageNotCarried: '界面文件：Antigravity 还没有从本工具加载，重启后生效。',
      pageScriptOk: '界面脚本：{time} 已加入组件。',
      pageScriptFail: '界面脚本：没有改动（{reason}）。',
      pageScriptNone: '界面脚本：还没有被请求。',
      pageScriptCostOk: '界面脚本：{time} 已加入费用计算。',
      pageScriptL10nOk: '界面脚本：{time} 已加入翻译程序。',
      l10nWords: '词条表：{n} 条。',
      l10nMissing: '词条表：读不出来，界面仍是英文。请重新安装本工具。',
      titlesSeen: '标题请求：已改写 {n} 次，最近一次 {time}。',
      titlesNone: '标题请求：还没有看到。新建一个对话后，这里会显示改写的次数。',
      titlesChanged: '有 {n} 个标题请求没有改写，因为客户端的指令写法变了。',
      pricesNone: '价格表：还没有下载。',
      pricesRefreshing: '价格表：正在下载……',
      pricesOk: '价格表：{n} 个模型，{time} 取自 models.dev 上 Vertex AI 的价格。每天最多更新一次。',
      pricesError: '价格表：{time} 更新失败（{error}），沿用上一份。',
      pricesErrorNone: '价格表：{time} 下载失败（{error}）。一小时后自动再试。',
      pricesNoModels: '还没有看到 Antigravity 的模型清单。Antigravity 下次启动后，这里会列出各模型的价格。',
      pricesPriced: '有价格的模型（美元 / 每百万 token：输入 / 输出 / 缓存读取）：',
      pricesRow: '{name}：{input} / {output} / {cache}',
      pricesRowNoCache: '{name}：{input} / {output} / {cache}（没有缓存价，按输入价算）',
      pricesMissing: '没有价格的模型（费用仍显示 $0.0000）：{names}',
      pricesRefresh: '立即更新价格',
      errDownload: '下载价格表失败：{detail}',
      restart: '重启 Antigravity',
      restarting: '正在重启…',
      restartConfirm: '这会退出并重新打开 Antigravity，正在运行的任务会中断。继续吗？',
      tabCurated: '精选功能',
      tabAll: '全部开关（{n}）',
      curatedNote: '这里的功能，除标「未实测」的以外，打开后都看到过效果。「已实测」表示在标出的版本上看到过说明里写的效果；「未实测」表示效果只是从客户端的代码里读出来的，没有在客户端里看到。',
      tested: '已实测 {v}',
      untested: '未实测',
      risk: '有风险',
      serverOnBadge: '服务端已开启',
      partial: '部分开启',
      riskConfirm: '这个功能有风险：\n\n{text}\n\n确定开启吗？',
      flagServerOn: '服务端：开',
      flagServerOff: '服务端：关',
      flagServerAbsent: '服务端未下发',
      flagOverrideOn: '本工具：开',
      flagOverrideOff: '本工具：关',
      searchPlaceholder: '搜索开关名或说明',
      onlyChanged: '只看已改动',
      addPlaceholder: '自定义开关名，例如 enable-some-feature',
      addButton: '添加并开启',
      allEmpty: '还没有看到服务端的开关清单。让 Antigravity 经过本工具启动一次，这里就会列出全部开关。',
      allCount: '显示 {shown} 个开关，按功能分成 {groups} 组。布尔开关和整数开关可以改；其他类型只读。',
      allLegend: '说明是读客户端的代码写的。标「推断」的只根据开关名和服务端下发的值写成，没有找到使用它的代码。',
      inferred: '推断',
      inferredTitle: '只根据开关名和服务端下发的值写成',
      curatedBadge: '精选',
      groupOther: '其他（暂无说明）',
      usagePending: '正在核对客户端用到哪些开关……',
      usageFailed: '没能核对客户端用到哪些开关（{error}），所以这次没有剔除客户端用不到的开关。',
      removedSummary: '已剔除 {n} 个开关',
      removedSummaryMatch: '已剔除 {n} 个开关，其中 {m} 个符合当前的搜索或筛选',
      removedNote: '按现有的判断，这些开关改了也不起作用，所以不在上面的列表里。这里列出名字和原因，方便核对。判断可能有错或过时，所以每一行仍然可以改；改过的可以在这里恢复默认。',
      removedUnused: '客户端的程序里找不到这个名字（{n} 个）',
      removedInternal: '只在 Google 内部环境有效（{n} 个）',
      removedNoEffect: '客户端认识这个名字，但打开后没有效果（{n} 个）',
      removedChanged: '有 {n} 个改过的开关被剔除了（改了也不起作用）：{names}。可以在页面底部「已剔除」里修改或恢复默认。',
      resetButton: '恢复默认',
      notesVersion: '手工标出的剔除项和开关说明是在 Antigravity {checked} 上核对的，而安装的客户端是 {version}。它们可能已经过时；被剔除的开关仍然可以在页面底部改。',
      notesMissing: '没能取到开关的分组和说明（{error}），所以下面不分组、没有说明，手工标出的剔除项也没有被剔除。页面会自动再试。',
      intPlaceholder: '默认',
      paramHint: '范围 {min}–{max}',
      keepAliveNone: '保活请求：常驻进程本次启动以来还没有看到。',
      keepAliveSeen: '保活请求：已看到 {n} 次，最近一次 {time}。',
      modelPatchOk: '模型列表：{time} 写入了 {n} 个模型。',
      modelPatchNever: '模型列表：还没有看到客户端请求。',
      errBadValue: '{name} 的值无效。',
      segDefault: '默认',
      segOn: '开',
      segOff: '关',
      changed: '已改动',
      readOnly: '只读',
      differs: '两处下发的值不同',
      badName: '开关名只能包含字母、数字和 _ . : - 这几种符号。',
      errGeneric: '操作失败：{detail}',
      errServerType: '{name} 在服务端不是布尔开关，不能改。',
      errOffline: '连不上 agy-flags 的常驻进程。',
      footer:
        '本工具只在本机运行，不向第三方发送你的任何数据。只有打开「按公开价格估算费用」时，它才会从 models.dev 下载一份公开的价格表。只有打开「对话标题用中文」时，它才会改动发给模型的内容，而且只改起标题那个请求里的一句指令。它改写的是 Google 下发的实验开关：这些功能还没有正式发布，可能不稳定，也可能随版本更新而失效。',
      warn: {
        'app-missing': '没有找到 Antigravity：{detail}',
        'env-conflict': '环境变量 {detail} 已经被别的程序设置。本工具不会覆盖它，所以现在不起作用。',
        'env-error': '设置环境变量失败，详情见日志。',
        'endpoint-mismatch':
          'Antigravity 自己要连接的云端地址和本工具转发的地址不一致（{detail}）。请更新本工具，或修改 config.json 里的 upstreams。',
        'not-patched': '上一次没有改写成功，已原样放行（{detail}）。服务端的格式可能变了。',
        skipped: '这些开关的类型和服务端不一致，已跳过：{detail}',
        'upstream-failed': '最近有请求转发失败（{detail}）。',
        'desktop-not-recognized':
          'Antigravity 经过了本工具，但它的请求没有被认出来（它自称 {detail}），所以开关没有改写。客户端的版本可能变了，需要更新本工具。',
        'page-unavailable': '找不到客户端自带的界面文件（{detail}），所以没有改界面加载方式，需要改界面的功能不会生效。',
        'page-not-changed': '界面脚本有一处没有改成（{detail}），对应的功能不会生效。客户端的版本可能变了，需要更新本工具。',
        'titles-not-changed': '最近一个标题请求没有改写：客户端起标题的指令写法变了，所以那个对话的标题仍是英文。需要更新本工具。',
      },
    },
    en: {
      tagline: 'Choose which Antigravity experimental features to turn on',
      langButton: '中文',
      gateTitle: 'Open this page again',
      gateBody: 'This page needs the local access token, and this browser has none saved. Open Terminal, paste the line below and press Return. It only opens this page again and changes nothing else:',
      gateAlt: 'If you installed from the source code, you can also run this in the source folder:',
      injection: 'Rewriting enabled',
      injectionOn: 'agy-flags is rewriting the flag configuration that Google sends to Antigravity.',
      injectionOff: 'Off: traffic passes through unchanged.',
      factClient: 'Antigravity',
      factRoute: 'Connection',
      factInjected: 'Last rewrite',
      factServer: 'Server flags',
      factOthers: 'Other programs',
      othersLine: '{cli} requests from the agy command line, {other} from other senders: all passed through unchanged',
      running: 'running',
      notRunning: 'not running',
      notInstalled: 'not found',
      routed: 'through agy-flags',
      direct: 'direct to Google',
      unknown: '—',
      neverSeen: 'no request from the client yet',
      injectedLine: '{name} {time}, {n} rewritten',
      notPatchedLine: '{name} {time}, not rewritten',
      serverLine: '{n}',
      bannerNotRouted: 'Antigravity was started before agy-flags took effect. Restart it to apply your changes.',
      bannerStillRouted: 'Rewriting is off. Antigravity still runs with the old settings; restart it to connect directly.',
      bannerFlagsChanged: 'You changed flags. Antigravity reads flags only when it starts; restart it to apply them.',
      bannerPageOff: 'The feature that changes the page is off. Antigravity still loads its page from agy-flags; restart it to go back to its own page.',
      pageCarried: 'Page files: Antigravity loads them from agy-flags.',
      pageNotCarried: 'Page files: Antigravity does not load them from agy-flags yet. Restart it.',
      pageScriptOk: 'Page script: component added at {time}.',
      pageScriptFail: 'Page script: not changed ({reason}).',
      pageScriptNone: 'Page script: not requested yet.',
      pageScriptCostOk: 'Page script: cost calculation added at {time}.',
      pageScriptL10nOk: 'Page script: translator added at {time}.',
      l10nWords: 'Word list: {n} entries.',
      l10nMissing: 'Word list: it cannot be read, so the page stays in English. Install agy-flags again.',
      titlesSeen: 'Title requests: {n} changed, the last one at {time}.',
      titlesNone: 'Title requests: none seen yet. Start a new conversation, and the count shows here.',
      titlesChanged: '{n} title requests were not changed, because the client words its instruction differently now.',
      pricesNone: 'Price list: not downloaded yet.',
      pricesRefreshing: 'Price list: downloading…',
      pricesOk: 'Price list: {n} models, taken at {time} from the Vertex AI prices on models.dev. Updated once a day at most.',
      pricesError: 'Price list: the update at {time} failed ({error}). The last list is still used.',
      pricesErrorNone: 'Price list: the download at {time} failed ({error}). It is tried again after one hour.',
      pricesNoModels: 'The model list of Antigravity was not seen yet. After the next start of Antigravity, the price of each model is listed here.',
      pricesPriced: 'Models with a price (US dollars per million tokens: input / output / cache read):',
      pricesRow: '{name}: {input} / {output} / {cache}',
      pricesRowNoCache: '{name}: {input} / {output} / {cache} (no cache price; the input price is used)',
      pricesMissing: 'Models without a price (their cost stays $0.0000): {names}',
      pricesRefresh: 'Update prices now',
      errDownload: 'The price list could not be downloaded: {detail}',
      restart: 'Restart Antigravity',
      restarting: 'Restarting…',
      restartConfirm: 'This quits and reopens Antigravity. Running tasks will be interrupted. Continue?',
      tabCurated: 'Features',
      tabAll: 'All flags ({n})',
      curatedNote: 'Except for the entries marked "untested", the effect of every feature here was seen. "tested on" means the described effect was seen on that version; "untested" means the effect is known from the client code only and was not seen in the app.',
      tested: 'tested on {v}',
      untested: 'untested',
      risk: 'risky',
      serverOnBadge: 'already on',
      partial: 'partly on',
      riskConfirm: 'This feature is risky:\n\n{text}\n\nTurn it on?',
      flagServerOn: 'server: on',
      flagServerOff: 'server: off',
      flagServerAbsent: 'not sent by the server',
      flagOverrideOn: 'agy-flags: on',
      flagOverrideOff: 'agy-flags: off',
      searchPlaceholder: 'Search flag names and descriptions',
      onlyChanged: 'Changed only',
      addPlaceholder: 'Custom flag name, for example enable-some-feature',
      addButton: 'Add and turn on',
      allEmpty: 'The server flag list has not been seen yet. Start Antigravity through agy-flags once and all flags are listed here.',
      allCount: 'Showing {shown} flags in {groups} groups. Boolean and integer flags can be changed; other types are read-only.',
      allLegend: 'The descriptions come from reading the client code. A description marked "inferred" rests only on the flag name and the value the server sends; no code that uses the flag was found.',
      inferred: 'inferred',
      inferredTitle: 'Based only on the flag name and the value the server sends',
      curatedBadge: 'curated',
      groupOther: 'Other (no description yet)',
      usagePending: 'Checking which flags the client uses…',
      usageFailed: 'Could not check which flags the client uses ({error}), so flags that the client does not use are not left out this time.',
      removedSummary: '{n} flags left out',
      removedSummaryMatch: '{n} flags left out; {m} of them match the search or the filter',
      removedNote: 'As far as is known, changing these flags has no effect, so they are not in the list above. They are listed here with the reason, so that you can check them. A reason can be wrong or out of date, so each flag can still be changed here; a changed one can be reset here.',
      removedUnused: 'The client programs do not contain the name ({n})',
      removedInternal: 'Works only inside Google ({n})',
      removedNoEffect: 'The client knows the name, but turning it on has no effect ({n})',
      removedChanged: 'Changed, but left out because changing them has no effect ({n}): {names}. You can change or reset them under "left out" at the bottom of the page.',
      resetButton: 'Reset',
      notesVersion: 'The flags that are left out by hand and the descriptions were checked on Antigravity {checked}, and the installed client is {version}. They can be out of date; a flag that is left out can still be changed at the bottom of the page.',
      notesMissing: 'Could not load the groups and descriptions of the flags ({error}). The list below has no groups and no descriptions, and the flags that are left out by hand are not left out. The page tries again by itself.',
      intPlaceholder: 'default',
      paramHint: 'range {min}–{max}',
      keepAliveNone: 'Keep-alive requests: none seen since the daemon started.',
      keepAliveSeen: 'Keep-alive requests: {n} seen, the last one at {time}.',
      modelPatchOk: 'Model list: written into {n} models at {time}.',
      modelPatchNever: 'Model list: no request from the client yet.',
      errBadValue: 'The value for {name} is not valid.',
      segDefault: 'Default',
      segOn: 'On',
      segOff: 'Off',
      changed: 'changed',
      readOnly: 'read-only',
      differs: 'the two hosts send different values',
      badName: 'A flag name can contain letters, digits and _ . : - only.',
      errGeneric: 'Failed: {detail}',
      errServerType: '{name} is not a boolean flag on the server and cannot be changed.',
      errOffline: 'Cannot reach the agy-flags daemon.',
      footer:
        'agy-flags runs on this machine only and sends none of your data to third parties. Only while "Estimate costs at public prices" is on, it downloads a public price list from models.dev. Only while "Conversation titles in Chinese" is on, it changes something that goes to the model: one sentence of the instruction in the request that asks for a title. It rewrites experimental flags sent by Google: these features are unreleased, may be unstable, and may stop working after an update.',
      warn: {
        'app-missing': 'Antigravity was not found: {detail}',
        'env-conflict': 'The environment variable {detail} is already set by another program. agy-flags does not overwrite it, so it has no effect now.',
        'env-error': 'Could not set the environment variables. See the log.',
        'endpoint-mismatch':
          'Antigravity wants a different cloud endpoint from the one agy-flags forwards to ({detail}). Update agy-flags, or edit upstreams in config.json.',
        'not-patched': 'The last response was not rewritten and was passed through ({detail}). The server format may have changed.',
        skipped: 'These flags have a different type on the server and were skipped: {detail}',
        'upstream-failed': 'A forwarded request failed recently ({detail}).',
        'desktop-not-recognized':
          'Antigravity runs through agy-flags, but its requests were not recognised (it calls itself {detail}), so no flag was rewritten. The client version may have changed; update agy-flags.',
        'page-unavailable': 'The page files of the client were not found ({detail}). The page loading was not changed, and features that change the page have no effect.',
        'page-not-changed': 'One change of the page script could not be made ({detail}), so its feature has no effect. The client version may have changed; update agy-flags.',
        'titles-not-changed': 'The last title request was not changed: the client words its title instruction differently now, so that conversation has an English title. Update agy-flags.',
      },
    },
  };

  const NAME_RE = /^[A-Za-z0-9_.:-]{1,160}$/;
  const $ = (id) => document.getElementById(id);

  let lang = 'en';
  try {
    lang = localStorage.getItem('agy-flags-lang') || '';
  } catch {
    lang = '';
  }
  if (lang !== 'zh' && lang !== 'en') lang = (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';

  function t(key, vars) {
    let text = I18N[lang][key] ?? I18N.en[key] ?? key;
    for (const [k, v] of Object.entries(vars || {})) text = text.replaceAll(`{${k}}`, String(v));
    return text;
  }

  /** Build an element. Children are nodes or strings; strings become text nodes. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else el.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  // ---- token -------------------------------------------------------------------------

  // The token is kept in this browser's storage for this page, so that a bookmark of the page
  // keeps working. It is removed again as soon as the daemon refuses it.
  const TOKEN_KEY = 'agy-flags-token';
  let token = '';
  const fromHash = /[#&]t=([0-9a-f]{48,128})/.exec(location.hash);
  if (fromHash) {
    token = fromHash[1];
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // the token then lives for this page load only
    }
    history.replaceState(null, '', location.pathname);
  } else {
    try {
      token = localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      token = '';
    }
  }

  function storedToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  /**
   * The daemon refused our token. Another tab of this page may have stored a newer one in the
   * meantime: then take that one, and leave the storage alone. Only a stored token that is the
   * refused one is removed. Returns true when there is another token to try.
   */
  function tokenRefused() {
    const refused = token;
    const stored = storedToken();
    if (stored && stored !== refused) {
      token = stored;
      return true;
    }
    token = '';
    if (stored) {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // nothing more to do
      }
    }
    return false;
  }

  // ---- state -------------------------------------------------------------------------

  let state = null;
  let server = { version: 0, flags: {} };
  let catalog = { groups: [] };
  let notes = { groups: [], flags: {} };
  /** Why the notes could not be loaded, or null. */
  let notesError = null;
  /** Counts the loads of the catalog and the notes, so that what is drawn from them is drawn again. */
  let loads = 0;
  const view = { tab: 'curated', search: '', onlyChanged: false, removedOpen: false };
  const drawn = {};
  /** What the user typed into a number field of a feature that is still off. */
  const drafts = {};
  let busy = false;
  let toastTimer = null;

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.hidden = true;
    }, 5000);
  }

  function showGate() {
    $('gate').hidden = false;
    $('app').hidden = true;
  }

  async function api(method, path, body) {
    let res;
    for (let attempt = 1; ; attempt += 1) {
      const headers = { 'x-agy-flags-token': token };
      if (body !== undefined) headers['content-type'] = 'application/json';
      try {
        res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
      } catch {
        throw Object.assign(new Error('offline'), { offline: true });
      }
      if (res.status !== 401) break;
      // One more try with a newer token that another tab stored; otherwise ask for the page to be reopened.
      if (attempt === 1 && tokenRefused()) continue;
      if (attempt > 1) tokenRefused();
      showGate();
      throw Object.assign(new Error('unauthorized'), { unauthorized: true });
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw Object.assign(new Error(data?.error || `HTTP ${res.status}`), { data });
    return data;
  }

  function reportError(err) {
    if (err?.unauthorized) return;
    if (err?.offline) toast(t('errOffline'));
    else if (err?.data?.error === 'server-type') toast(t('errServerType', { name: err.data.name }));
    else if (err?.data?.error === 'bad-name') toast(t('badName'));
    else if (err?.data?.error === 'bad-value') toast(t('errBadValue', { name: err.data.name }));
    else if (err?.data?.error === 'download-failed') toast(t('errDownload', { detail: err.data.detail || '' }));
    else toast(t('errGeneric', { detail: err?.message || String(err) }));
  }

  async function refresh() {
    state = await api('GET', '/api/state');
    if (state.server.version !== server.version) server = await api('GET', '/api/server-flags');
    render();
  }

  async function act(path, body) {
    if (busy) return;
    busy = true;
    try {
      await api('POST', path, body);
    } catch (err) {
      reportError(err);
    } finally {
      busy = false;
    }
    try {
      await refresh();
    } catch (err) {
      reportError(err);
    }
  }

  // ---- helpers -----------------------------------------------------------------------

  const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB') : '');
  const dateTimeOf = (ms) =>
    ms ? new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-GB', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const hasOverride = (name) => Object.hasOwn(state.overrides, name);
  const textOf = (texts) => texts?.[lang] || texts?.en || '';
  const noteOf = (name) => (Object.hasOwn(notes.flags || {}, name) ? notes.flags[name] : null);

  /** Every flag of a curated feature. Such a flag is never left out of the list. */
  function curatedFlags() {
    const names = new Set();
    for (const group of catalog.groups || []) {
      for (const name of group.flags || []) names.add(name);
      for (const param of group.params || []) names.add(param.flag);
    }
    return names;
  }

  /** The last answer of listModel() and what it was made from. */
  let modelCache = null;

  /**
   * Which flags the list shows, and which it leaves out and why:
   * 'unused' (no program of the client contains the name), 'internal' or 'noEffect' (from the notes).
   */
  function listModel() {
    // The same answer as long as its inputs are the same: every drawing of the page asks for it.
    const overridesText = JSON.stringify(state.overrides);
    if (modelCache && modelCache.server === server && modelCache.loads === loads && modelCache.overridesText === overridesText) {
      return modelCache.value;
    }
    const names = [...new Set([...Object.keys(server.flags), ...Object.keys(state.overrides)])].sort((a, b) => a.localeCompare(b));
    const unused = new Set(server.usage?.unused || []);
    const curated = curatedFlags();
    const listed = [];
    const removed = { unused: [], internal: [], noEffect: [] };
    for (const name of names) {
      const note = noteOf(name);
      let reason = null;
      // keep: the name is not in the programs, but they may build it from pieces at run time.
      if (curated.has(name)) reason = null;
      else if (unused.has(name) && note?.keep !== true) reason = 'unused';
      else if (note?.hide === 'internal' || note?.hide === 'noEffect') reason = note.hide;
      if (reason) removed[reason].push(name);
      else listed.push(name);
    }
    const value = { names, listed, removed, curated };
    modelCache = { server, loads, overridesText, value };
    return value;
  }

  /** What the server sends for a flag: true, false, or null when it is absent or not boolean. */
  function serverBool(name) {
    const info = server.flags[name];
    return info && info.type === 'boolValue' ? info.value === true : null;
  }

  function serverLabel(name) {
    const info = server.flags[name];
    if (!info) return t('flagServerAbsent');
    if (info.type === 'boolValue') return info.value === true ? t('flagServerOn') : t('flagServerOff');
    return `${info.type || '?'} = ${String(info.value)}`;
  }

  /** A whole number inside the limits of a parameter, or null. */
  function parseParam(param, text) {
    const trimmed = String(text ?? '').trim();
    if (!/^-?\d{1,15}$/.test(trimmed)) return null;
    const n = Number(trimmed);
    if (param.min !== undefined && n < param.min) return null;
    if (param.max !== undefined && n > param.max) return null;
    return n;
  }

  /** The value a parameter has now: the override, else what the user typed, else its default. */
  function paramValue(param) {
    const override = state.overrides[param.flag];
    if (typeof override === 'number') return override;
    return parseParam(param, drafts[param.flag]) ?? param.default;
  }

  /** What Antigravity loads from us, and whether the change `ok` names was made in its script. */
  function pageLines(group, ok) {
    const page = state.page || {};
    const lines = [page.carried ? t('pageCarried') : t('pageNotCarried')];
    const part = page.script?.parts?.[group.uiPatch];
    if (!page.script || !part) lines.push(t('pageScriptNone'));
    else if (part.ok) lines.push(t(ok, { time: timeOf(page.script.at) }));
    else lines.push(t('pageScriptFail', { reason: part.reason || '' }));
    return lines;
  }

  function groupStatusLines(group) {
    if (group.status === 'page') return pageLines(group, 'pageScriptOk');
    if (group.status === 'prices') {
      const lines = pageLines(group, 'pageScriptCostOk');
      const prices = state.prices || {};
      if (prices.fetchedAt) lines.push(t('pricesOk', { n: prices.count, time: dateTimeOf(prices.fetchedAt) }));
      else if (prices.refreshing) lines.push(t('pricesRefreshing'));
      else if (!prices.error) lines.push(t('pricesNone'));
      if (prices.error) {
        lines.push(t(prices.fetchedAt ? 'pricesError' : 'pricesErrorNone', { time: dateTimeOf(prices.errorAt), error: prices.error }));
      }
      return lines;
    }
    if (group.status === 'l10n') {
      const lines = pageLines(group, 'pageScriptL10nOk');
      const l10n = state.l10n || {};
      lines.push(l10n.ready ? t('l10nWords', { n: l10n.words }) : t('l10nMissing'));
      return lines;
    }
    if (group.status === 'titles') {
      const seen = state.titles || {};
      const lines = [seen.rewritten > 0 ? t('titlesSeen', { n: seen.rewritten, time: timeOf(seen.rewrittenAt) }) : t('titlesNone')];
      if (seen.changed > 0) lines.push(t('titlesChanged', { n: seen.changed }));
      return lines;
    }
    if (group.status !== 'keepAlive') return [];
    const lines = [];
    const patch = state.modelPatch;
    if (patch && patch.ok) lines.push(t('modelPatchOk', { time: timeOf(patch.at), n: patch.models }));
    else if (!patch) lines.push(t('modelPatchNever'));
    const ka = state.keepAlive || { count: 0, lastAt: null };
    lines.push(ka.count > 0 ? t('keepAliveSeen', { n: ka.count, time: timeOf(ka.lastAt) }) : t('keepAliveNone'));
    return lines;
  }

  /** The prices of the models of the client, and the button that downloads the list again. */
  function priceNodes() {
    const prices = state.prices || {};
    const nodes = [];
    const models = prices.models || [];
    const usd = (n) => `$${Number(n).toFixed(3).replace(/0$/, '')}`;
    if (prices.fetchedAt && models.length === 0) nodes.push(h('p', { class: 'feature-status' }, t('pricesNoModels')));
    const priced = models.filter((m) => m.priced);
    if (priced.length > 0) {
      const list = h('ul', { class: 'prices' });
      for (const m of priced) {
        const key = m.cacheFromInput ? 'pricesRowNoCache' : 'pricesRow';
        list.append(h('li', null, t(key, { name: m.name, input: usd(m.input), output: usd(m.output), cache: usd(m.cacheRead) })));
      }
      nodes.push(h('p', { class: 'feature-status' }, t('pricesPriced')), list);
    }
    const missing = models.filter((m) => !m.priced).map((m) => m.name);
    if (prices.fetchedAt && missing.length > 0) nodes.push(h('p', { class: 'feature-status' }, t('pricesMissing', { names: missing.join(lang === 'zh' ? '、' : ', ') })));
    nodes.push(h('p', null, h('button', { type: 'button', class: 'small', disabled: prices.refreshing === true, dataset: { pricesRefresh: '1' } }, t('pricesRefresh'))));
    return nodes;
  }

  /** Redraw one part of the page only when what it shows has changed. */
  function draw(key, signature, fn) {
    const text = JSON.stringify(signature);
    if (drawn[key] === text) return;
    drawn[key] = text;
    fn();
  }

  // ---- rendering ---------------------------------------------------------------------

  function renderStatic() {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    $('lang').textContent = t('langButton');
    $('search').placeholder = t('searchPlaceholder');
    $('add-name').placeholder = t('addPlaceholder');
  }

  function renderStatus() {
    const cli = state.traffic?.byClient?.cli || 0;
    const other = state.traffic?.byClient?.other || 0;
    draw('status', [lang, state.enabled, state.app, state.client, state.lastInjection, state.server, state.warnings, cli, other], () => {
      $('enabled').setAttribute('aria-checked', String(state.enabled));
      $('injection-desc').textContent = state.enabled ? t('injectionOn') : t('injectionOff');

      const facts = $('facts');
      facts.replaceChildren();
      const fact = (label, ...value) => facts.append(h('dt', null, label), h('dd', null, ...value));

      const app = state.app;
      const clientText = !app.installed
        ? t('notInstalled')
        : `${app.version || ''} · ${state.client.running ? t('running') : t('notRunning')}`;
      fact(t('factClient'), clientText);

      let route = t('unknown');
      if (state.client.running && state.client.routed === true) route = h('span', { class: 'good' }, t('routed'));
      else if (state.client.running && state.client.routed === false) route = t('direct');
      fact(t('factRoute'), route);

      const lines = [];
      for (const name of ['aicode', 'cloudcode']) {
        const last = state.lastInjection[name];
        if (!last) continue;
        lines.push(
          last.ok
            ? t('injectedLine', { name, time: timeOf(last.at), n: last.applied.length })
            : t('notPatchedLine', { name, time: timeOf(last.at) })
        );
      }
      fact(t('factInjected'), lines.length ? lines.join('；') : t('neverSeen'));
      fact(t('factServer'), t('serverLine', { n: state.server.count }));
      if (cli + other > 0) fact(t('factOthers'), t('othersLine', { cli, other }));

      const list = $('warnings');
      list.replaceChildren();
      for (const w of state.warnings) {
        const template = I18N[lang].warn[w.code] || `${w.code}: {detail}`;
        list.append(h('li', null, template.replaceAll('{detail}', w.detail || '')));
      }
      list.hidden = state.warnings.length === 0;
    });
  }

  function renderBanner() {
    draw('banner', [lang, state.pendingRestart, state.pendingReason, state.restarting], () => {
      const banner = $('banner');
      banner.hidden = !state.pendingRestart && !state.restarting;
      const key = {
        'not-routed': 'bannerNotRouted',
        'still-routed': 'bannerStillRouted',
        'flags-changed': 'bannerFlagsChanged',
        'page-off': 'bannerPageOff',
      }[state.pendingReason];
      $('banner-text').textContent = state.restarting ? t('restarting') : key ? t(key) : '';
      const button = $('restart');
      button.textContent = state.restarting ? t('restarting') : t('restart');
      button.disabled = state.restarting;
    });
  }

  function renderTabs() {
    $('tab-curated').textContent = t('tabCurated');
    $('tab-all').textContent = t('tabAll', { n: listModel().listed.length });
    for (const tab of ['curated', 'all']) {
      $(`tab-${tab}`).setAttribute('aria-selected', String(view.tab === tab));
      $(`panel-${tab}`).hidden = view.tab !== tab;
    }
  }

  /** What the client gets for a boolean flag: the override, else what the server sends. */
  const flagIsOn = (name) => (hasOverride(name) ? state.overrides[name] === true : serverBool(name) === true);

  function groupState(group) {
    if (group.feature) {
      // A feature of agy-flags itself. It works only together with the flags it needs.
      const own = state.features?.[group.feature] === true;
      const needed = (group.requires || []).every(flagIsOn);
      return { on: own && needed, partial: own && !needed, serverOnly: false };
    }
    const flags = group.flags;
    const overriddenOn = flags.filter((f) => state.overrides[f] === true);
    const effectiveOn = flags.filter(flagIsOn);
    // A feature with a number setting is on only when the number is set too.
    const paramsSet = (group.params || []).every((p) => typeof state.overrides[p.flag] === 'number' || server.flags[p.flag]);
    const all = effectiveOn.length === flags.length;
    return {
      on: all && paramsSet,
      partial: (effectiveOn.length > 0 && effectiveOn.length < flags.length) || (all && !paramsSet),
      serverOnly: all && paramsSet && overriddenOn.length === 0,
    };
  }

  function renderCurated() {
    draw('curated', [lang, catalog, state.overrides, server.version, state.modelPatch, state.keepAlive, state.page, state.features, state.prices, state.l10n, state.titles], () => {
      const box = $('features');
      box.replaceChildren();
      for (const group of catalog.groups) {
        const gs = groupState(group);
        const title = group.title?.[lang] || group.title?.en || group.id;
        const description = group.description?.[lang] || group.description?.en || '';
        const badges = [];
        if (group.tested) badges.push(h('span', { class: 'badge tested' }, t('tested', { v: group.tested })));
        else badges.push(h('span', { class: 'badge' }, t('untested')));
        if (group.risk) badges.push(h('span', { class: 'badge risk' }, group.riskLabel?.[lang] || group.riskLabel?.en || t('risk')));
        if (gs.serverOnly) badges.push(h('span', { class: 'badge' }, t('serverOnBadge')));
        else if (gs.partial) badges.push(h('span', { class: 'badge changed' }, t('partial')));

        const toggle = h(
          'button',
          {
            class: 'switch',
            type: 'button',
            role: 'switch',
            'aria-checked': String(gs.on),
            'aria-label': title,
            disabled: gs.serverOnly,
            dataset: { group: group.id },
          },
          h('span')
        );
        const flagList = h('ul');
        for (const name of [...group.flags, ...(group.requires || [])]) {
          const parts = [serverLabel(name)];
          if (hasOverride(name)) parts.push(state.overrides[name] ? t('flagOverrideOn') : t('flagOverrideOff'));
          flagList.append(h('li', null, h('code', null, name), ` — ${parts.join(' → ')}`));
        }
        const params = [];
        for (const param of group.params || []) {
          const label = param.label?.[lang] || param.label?.en || param.flag;
          params.push(
            h(
              'label',
              { class: 'param' },
              h('span', null, label),
              h('input', {
                type: 'number',
                inputmode: 'numeric',
                step: 1,
                min: param.min,
                max: param.max,
                value: paramValue(param),
                dataset: { group: group.id, param: param.flag },
              }),
              h('span', { class: 'muted' }, t('paramHint', { min: param.min, max: param.max }))
            )
          );
          const parts = [serverLabel(param.flag)];
          if (hasOverride(param.flag)) parts.push(`agy-flags: ${String(state.overrides[param.flag])}`);
          flagList.append(h('li', null, h('code', null, param.flag), ` — ${parts.join(' → ')}`));
        }
        const status = gs.on ? groupStatusLines(group).map((line) => h('p', { class: 'feature-status' }, line)) : [];
        if (gs.on && group.status === 'prices') status.push(...priceNodes());
        box.append(
          h(
            'article',
            { class: 'feature' },
            h('div', { class: 'feature-head' }, h('h3', null, title), ...badges, h('span', { class: 'spacer' }), toggle),
            h('p', null, description),
            ...params,
            ...status,
            flagList.childElementCount > 0 ? flagList : null
          )
        );
      }
    });
  }

  /** The type of a flag. A flag the server does not send has the type of the override. */
  function flagType(name) {
    const info = server.flags[name];
    return info ? info.type : typeof state.overrides[name] === 'number' ? 'intValue' : 'boolValue';
  }

  /** What changes one flag: three states for a boolean, a number field for an integer. */
  function flagControl(name) {
    const type = flagType(name);
    if (type === 'boolValue') {
      const current = hasOverride(name) ? (state.overrides[name] ? 'on' : 'off') : 'default';
      const seg = (value, label) =>
        h('button', { type: 'button', 'aria-pressed': String(current === value), dataset: { name, value } }, label);
      return h('div', { class: 'seg', role: 'group', 'aria-label': name }, seg('default', t('segDefault')), seg('on', t('segOn')), seg('off', t('segOff')));
    }
    if (type === 'intValue') {
      // An empty field means "what the server sends".
      return h('input', {
        class: 'int',
        type: 'number',
        inputmode: 'numeric',
        step: 1,
        'aria-label': name,
        placeholder: t('intPlaceholder'),
        value: hasOverride(name) ? state.overrides[name] : null,
        dataset: { int: name },
      });
    }
    return h('span', { class: 'badge' }, t('readOnly'));
  }

  /** One row of the flag list: name, badges, description, what the server sends, the control. */
  function flagRow(name, curated) {
    const info = server.flags[name];
    const note = noteOf(name);
    const meta = [serverLabel(name)];
    if (info?.sources) meta.push(info.sources.join(', '));
    if (info?.differs) meta.push(t('differs'));
    const badges = [];
    if (hasOverride(name)) badges.push(h('span', { class: 'badge changed' }, t('changed')));
    if (curated.has(name)) badges.push(h('span', { class: 'badge tested' }, t('curatedBadge')));
    if (note && note.basis === 'name') badges.push(h('span', { class: 'badge', title: t('inferredTitle') }, t('inferred')));
    const description = textOf(note?.text);
    return h(
      'div',
      { class: 'flag' },
      h(
        'div',
        { class: 'flag-main' },
        h('div', { class: 'flag-name' }, h('span', { class: 'mono' }, name), ...badges.flatMap((badge) => [' ', badge])),
        description ? h('div', { class: 'flag-desc' }, description) : null,
        h('div', { class: 'flag-meta' }, meta.join(' · '))
      ),
      flagControl(name)
    );
  }

  /**
   * The flags that are left out, with the reason, folded away at the end of the list.
   * While a search or the "changed only" filter is on (`filtering`), the heading says how many
   * of them match, and the block is open when some do: a search must not hide what it found.
   * Each flag keeps its control: a reason can be wrong, or out of date after a client update.
   */
  function removedBlock(removed, matches, filtering) {
    const reasons = [
      ['unused', 'removedUnused'],
      ['internal', 'removedInternal'],
      ['noEffect', 'removedNoEffect'],
    ];
    const total = reasons.reduce((n, [reason]) => n + removed[reason].length, 0);
    if (total === 0) return null;
    const parts = [];
    let matched = 0;
    for (const [reason, key] of reasons) {
      const names = removed[reason].filter(matches);
      matched += names.length;
      if (names.length === 0) continue;
      // Changed flags first: they are the ones to reset.
      names.sort((a, b) => Number(hasOverride(b)) - Number(hasOverride(a)) || a.localeCompare(b));
      const items = names.map((name) => {
        const why = reason === 'unused' ? '' : textOf(noteOf(name)?.text);
        return h(
          'li',
          null,
          h('span', { class: 'mono' }, name),
          hasOverride(name) ? h('span', { class: 'badge changed' }, t('changed')) : null,
          why ? h('span', { class: 'muted' }, why) : null,
          h(
            'span',
            { class: 'removed-control' },
            flagControl(name),
            // A boolean is reset with "Default". The other types get a button for it.
            hasOverride(name) && flagType(name) !== 'boolValue'
              ? h('button', { type: 'button', class: 'small', dataset: { name, value: 'default' } }, t('resetButton'))
              : null
          )
        );
      });
      parts.push(h('h4', null, t(key, { n: names.length })), h('ul', null, ...items));
    }
    const heldOpen = filtering && matched > 0;
    const details = h(
      'details',
      { class: 'removed', open: view.removedOpen || heldOpen },
      h('summary', null, filtering ? t('removedSummaryMatch', { n: total, m: matched }) : t('removedSummary', { n: total })),
      h('p', { class: 'muted' }, t('removedNote')),
      ...parts
    );
    details.addEventListener('toggle', () => {
      // Open because of a match is not the user's choice: it must not stay open afterwards.
      if (!heldOpen) view.removedOpen = details.open;
    });
    return details;
  }

  function renderAll() {
    draw('all', [lang, view.search, view.onlyChanged, state.overrides, server.version, loads, notesError, state.app?.version], () => {
      const { names, listed, removed, curated } = listModel();
      const needle = view.search.trim().toLowerCase();
      const matches = (name) => {
        if (view.onlyChanged && !hasOverride(name)) return false;
        if (!needle) return true;
        return name.toLowerCase().includes(needle) || textOf(noteOf(name)?.text).toLowerCase().includes(needle);
      };
      const shown = listed.filter(matches);

      // Groups in the order of the notes; flags without a known group go last.
      const known = new Set((notes.groups || []).map((group) => group.id));
      const byGroup = new Map();
      for (const name of shown) {
        const group = noteOf(name)?.group;
        const id = known.has(group) ? group : 'other';
        if (!byGroup.has(id)) byGroup.set(id, []);
        byGroup.get(id).push(name);
      }
      const order = [...(notes.groups || []), { id: 'other', title: { [lang]: t('groupOther') } }];
      const sections = [];
      for (const group of order) {
        const members = byGroup.get(group.id);
        if (!members) continue;
        sections.push(
          h(
            'section',
            { class: 'flag-group' },
            h('h3', null, textOf(group.title) || group.id, h('span', { class: 'count' }, String(members.length))),
            h('div', { class: 'flag-rows' }, ...members.map((name) => flagRow(name, curated)))
          )
        );
      }

      const lines = [];
      if (Object.keys(server.flags).length === 0 && names.length === 0) lines.push(t('allEmpty'));
      else {
        const usage = server.usage || { status: 'pending' };
        if (usage.status === 'pending') lines.push(t('usagePending'));
        if (usage.status === 'failed') lines.push(t('usageFailed', { error: usage.error || '?' }));
        const changedOut = [...removed.unused, ...removed.internal, ...removed.noEffect].filter(hasOverride).sort();
        if (changedOut.length > 0) lines.push(t('removedChanged', { n: changedOut.length, names: changedOut.join(', ') }));
        // The marks made by hand are for one client version. The search of the app is always for the installed one.
        const checked = typeof notes.checked === 'string' ? notes.checked : '';
        const version = state.app?.version || '';
        if (checked && version && checked !== version) lines.push(t('notesVersion', { checked, version }));
        if (notesError) lines.push(t('notesMissing', { error: notesError }));
        lines.push(t('allCount', { shown: shown.length, groups: sections.length }));
        if (!notesError) lines.push(t('allLegend'));
      }
      $('all-note').replaceChildren(...lines.map((line) => h('p', null, line)));
      const filtering = needle !== '' || view.onlyChanged;
      $('list').replaceChildren(...sections, ...[removedBlock(removed, matches, filtering)].filter(Boolean));
    });
  }

  function render() {
    if (!state) return;
    $('gate').hidden = true;
    $('app').hidden = false;
    renderStatus();
    renderBanner();
    renderTabs();
    if (view.tab === 'curated') renderCurated();
    else renderAll();
  }

  // ---- events ------------------------------------------------------------------------

  $('lang').addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    try {
      localStorage.setItem('agy-flags-lang', lang);
    } catch {
      // not remembered
    }
    renderStatic();
    render();
  });

  $('enabled').addEventListener('click', () => {
    if (state) act('/api/enabled', { enabled: !state.enabled });
  });

  $('restart').addEventListener('click', () => {
    if (!window.confirm(t('restartConfirm'))) return;
    act('/api/restart-client', {});
    // The request returns only after the client is back; show progress meanwhile.
    setTimeout(() => refresh().catch(() => {}), 600);
  });

  for (const tab of ['curated', 'all']) {
    $(`tab-${tab}`).addEventListener('click', () => {
      view.tab = tab;
      render();
    });
  }

  $('features').addEventListener('click', (event) => {
    if (event.target.closest('button[data-prices-refresh]')) {
      if (state) act('/api/prices/refresh', {});
      return;
    }
    const button = event.target.closest('button[data-group]');
    if (!button || !state) return;
    const group = catalog.groups.find((g) => g.id === button.dataset.group);
    if (!group) return;
    const turnOn = button.getAttribute('aria-checked') !== 'true';
    if (turnOn && group.risk) {
      const text = group.risk[lang] || group.risk.en || '';
      if (!window.confirm(t('riskConfirm', { text }))) return;
    }
    if (group.feature) {
      // The flags it needs belong to another feature: they are turned on with it, and stay on after it.
      const needed = {};
      if (turnOn) for (const name of group.requires || []) if (!flagIsOn(name)) needed[name] = true;
      const body = { changes: { [group.feature]: turnOn } };
      if (Object.keys(needed).length > 0) body.flags = needed;
      act('/api/features', body);
      return;
    }
    const changes = {};
    // Off means "back to what the server sends", not "forced off".
    for (const name of group.flags) changes[name] = turnOn ? true : null;
    for (const param of group.params || []) changes[param.flag] = turnOn ? paramValue(param) : null;
    act('/api/flags', { changes });
  });

  // A number field of a feature. It is sent at once when the feature is on, and kept for later when it is off.
  $('features').addEventListener('change', (event) => {
    const input = event.target.closest('input[data-param]');
    if (!input || !state) return;
    const group = catalog.groups.find((g) => g.id === input.dataset.group);
    const param = group?.params?.find((p) => p.flag === input.dataset.param);
    if (!param) return;
    const value = parseParam(param, input.value);
    if (value === null) {
      toast(t('errBadValue', { name: param.flag }));
      input.value = String(paramValue(param));
      return;
    }
    drafts[param.flag] = String(value);
    if (groupState(group).on && hasOverride(group.flags[0])) act('/api/flags', { changes: { [param.flag]: value } });
  });

  $('list').addEventListener('change', (event) => {
    const input = event.target.closest('input[data-int]');
    if (!input || !state) return;
    const name = input.dataset.int;
    const text = input.value.trim();
    if (text === '') {
      act('/api/flags', { changes: { [name]: null } });
      return;
    }
    if (!/^-?\d{1,15}$/.test(text)) {
      toast(t('errBadValue', { name }));
      input.value = hasOverride(name) ? String(state.overrides[name]) : '';
      return;
    }
    act('/api/flags', { changes: { [name]: Number(text) } });
  });

  $('list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-name]');
    if (!button) return;
    const value = { default: null, on: true, off: false }[button.dataset.value];
    act('/api/flags', { changes: { [button.dataset.name]: value } });
  });

  $('search').addEventListener('input', (event) => {
    view.search = event.target.value;
    render();
  });

  $('only-changed').addEventListener('change', (event) => {
    view.onlyChanged = event.target.checked;
    render();
  });

  $('add').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('add-name');
    const name = input.value.trim();
    if (!NAME_RE.test(name)) {
      toast(t('badName'));
      return;
    }
    input.value = '';
    act('/api/flags', { changes: { [name]: true } });
  });

  // ---- start -------------------------------------------------------------------------

  renderStatic();

  let loaded = false;
  let notesLoaded = false;
  /**
   * The groups and descriptions of the flags. The page works without them (one group, no
   * descriptions), so a daemon that cannot give them does not keep the page from showing.
   * It is asked again at the next tick.
   */
  async function loadNotes() {
    try {
      const data = await api('GET', '/api/flag-notes');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad answer');
      notes = {
        ...data,
        groups: Array.isArray(data.groups) ? data.groups : [],
        flags: data.flags && typeof data.flags === 'object' && !Array.isArray(data.flags) ? data.flags : {},
      };
      notesError = null;
      notesLoaded = true;
      loads += 1;
    } catch (err) {
      // No token or no daemon: the page as a whole cannot work, and says so.
      if (err?.unauthorized || err?.offline) throw err;
      notesError = err?.message || String(err);
    }
  }
  /** Load everything once, then keep the state fresh. Without a token nothing is asked from the daemon. */
  async function tick() {
    if (!token) {
      // Another tab of this page may have been given a token since.
      token = storedToken();
      if (!token) {
        showGate();
        return;
      }
    }
    if (!loaded) {
      catalog = await api('GET', '/api/catalog');
      loads += 1;
      loaded = true;
    }
    if (!notesLoaded) await loadNotes();
    await refresh();
  }

  tick().catch(reportError);
  setInterval(() => {
    if (document.hidden || busy) return;
    tick().catch((err) => {
      if (err?.offline) toast(t('errOffline'));
    });
  }, 3000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !busy) tick().catch(() => {});
  });
})();
