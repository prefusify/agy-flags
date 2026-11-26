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
      pageNotCarried: '重启 Antigravity 后生效。',
      pageScriptFail: '没能改动 Antigravity 的界面（{reason}），这一项暂时不起作用。',
      pageScriptL10nOk: '界面脚本：{time} 已加入翻译程序。',
      l10nMissing: '词条表读不出来，界面仍是英文，请重新安装本工具。',
      titlesChanged: '客户端改了起标题的写法，标题暂时还是英文。',
      pricesError: '价格表更新失败（{error}），先用上一份。',
      pricesErrorNone: '价格表下载失败（{error}），一小时后自动再试。',
      pricesRefresh: '重试',
      errDownload: '下载价格表失败：{detail}',
      restart: '重启 Antigravity',
      restarting: '正在重启…',
      restartConfirm: '这会退出并重新打开 Antigravity，正在运行的任务会中断。继续吗？',
      curatedNote: '「已实测」表示在标出的版本上亲眼看到过效果，「未实测」表示只从客户端代码里读出、还没看到过。',
      tested: '已实测 {v}',
      untested: '未实测',
      risk: '有风险',
      serverOnBadge: '服务端已开启',
      partial: '部分开启',
      riskConfirm: '这个功能有风险：\n\n{text}\n\n确定开启吗？',
      errBadValue: '{name} 的值无效。',
      errGeneric: '操作失败：{detail}',
      errServerType: '{name} 在服务端不是布尔开关，不能改。',
      errOffline: '连不上 agy-flags 的常驻进程。',
      footer:
        '本工具只在本机运行，不向第三方发送你的数据（「估算费用」会从 models.dev 下载公开价格表，「中文对话标题」只改起标题请求里的一句指令）。这些功能没有正式发布，可能不稳定，也可能随版本更新失效。',
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
      pageNotCarried: 'Restart Antigravity for this to work.',
      pageScriptFail: 'The Antigravity page could not be changed ({reason}), so this does not work for now.',
      pageScriptL10nOk: 'Page script: translator added at {time}.',
      l10nMissing: 'The word list cannot be read, so the page stays in English; install agy-flags again.',
      titlesChanged: 'The client now asks for titles differently, so titles are English for now.',
      pricesError: 'The price list could not be updated ({error}); the last one is still used.',
      pricesErrorNone: 'The price list could not be downloaded ({error}); it is tried again in an hour.',
      pricesRefresh: 'Retry',
      errDownload: 'The price list could not be downloaded: {detail}',
      restart: 'Restart Antigravity',
      restarting: 'Restarting…',
      restartConfirm: 'This quits and reopens Antigravity. Running tasks will be interrupted. Continue?',
      curatedNote: '"tested on" means the effect was seen on that version; "untested" means it is known from the client code only.',
      tested: 'tested on {v}',
      untested: 'untested',
      risk: 'risky',
      serverOnBadge: 'already on',
      partial: 'partly on',
      riskConfirm: 'This feature is risky:\n\n{text}\n\nTurn it on?',
      errBadValue: 'The value for {name} is not valid.',
      errGeneric: 'Failed: {detail}',
      errServerType: '{name} is not a boolean flag on the server and cannot be changed.',
      errOffline: 'Cannot reach the agy-flags daemon.',
      footer:
        'agy-flags runs on this machine only and sends none of your data to third parties ("Estimated costs" downloads a public price list from models.dev; "Chinese conversation titles" changes only one sentence of the title request). These features are unreleased, may be unstable, and may stop working after an update.',
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
  const drawn = {};
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
  const hasOverride = (name) => Object.hasOwn(state.overrides, name);

  /** What the server sends for a flag: true, false, or null when it is absent or not boolean. */
  function serverBool(name) {
    const info = server.flags[name];
    return info && info.type === 'boolValue' ? info.value === true : null;
  }

  /** Problems of the page features only; nothing is shown while all is well. */
  function pageProblems(group) {
    const page = state.page || {};
    if (!page.carried) return [t('pageNotCarried')];
    const part = page.script?.parts?.[group.uiPatch];
    return part && !part.ok ? [t('pageScriptFail', { reason: part.reason || '' })] : [];
  }

  /** What is wrong with a feature that is on, as plain lines; empty while all is well. */
  function groupProblems(group) {
    const lines = group.uiPatch ? pageProblems(group) : [];
    if (group.status === 'prices' && state.prices?.error) {
      const prices = state.prices;
      lines.push(t(prices.fetchedAt ? 'pricesError' : 'pricesErrorNone', { error: prices.error }));
    }
    if (group.status === 'l10n' && !state.l10n?.ready) lines.push(t('l10nMissing'));
    if (group.status === 'titles' && state.titles?.changed > 0) lines.push(t('titlesChanged'));
    return lines;
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
    const all = effectiveOn.length === flags.length;
    return {
      on: all,
      partial: effectiveOn.length > 0 && effectiveOn.length < flags.length,
      serverOnly: all && overriddenOn.length === 0,
    };
  }

  function renderCurated() {
    draw('curated', [lang, catalog, state.overrides, server.version, state.page, state.features, state.prices, state.l10n, state.titles], () => {
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
        const status = gs.on ? groupProblems(group).map((line) => h('p', { class: 'feature-status' }, line)) : [];
        if (gs.on && group.status === 'prices' && state.prices?.error) {
          const disabled = state.prices.refreshing === true;
          status.push(h('p', null, h('button', { type: 'button', class: 'small', disabled, dataset: { pricesRefresh: '1' } }, t('pricesRefresh'))));
        }
        box.append(
          h(
            'article',
            { class: 'feature' },
            h('div', { class: 'feature-head' }, h('h3', null, title), ...badges, h('span', { class: 'spacer' }), toggle),
            h('p', null, description),
            ...status
          )
        );
      }
    });
  }

  function render() {
    if (!state) return;
    $('gate').hidden = true;
    $('app').hidden = false;
    renderStatus();
    renderBanner();
    renderCurated();
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
    act('/api/flags', { changes });
  });

  // ---- start -------------------------------------------------------------------------

  renderStatic();

  let loaded = false;
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
      loaded = true;
    }
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
