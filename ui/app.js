'use strict';
// The whole page. No framework, no build step. Text from the server (flag names, values,
// catalog entries) always goes into the page with textContent, never as HTML.

(() => {
  const I18N = {
    zh: {
      tagline: '选择要开启的 Antigravity 实验性功能',
      langButton: 'English',
      gateTitle: '需要从命令行打开',
      gateBody: '这个页面要带着本机的访问令牌打开。请在终端运行下面的命令：',
      injection: '启用改写',
      injectionOn: '本工具正在改写 Google 下发给 Antigravity 的开关配置。',
      injectionOff: '已关闭：流量原样通过，不改写任何内容。',
      factClient: 'Antigravity',
      factRoute: '连接方式',
      factInjected: '上次改写',
      factServer: '服务端开关',
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
      restart: '重启 Antigravity',
      restarting: '正在重启…',
      restartConfirm: '这会退出并重新打开 Antigravity，正在运行的任务会中断。继续吗？',
      tabCurated: '精选功能',
      tabAll: '全部开关（{n}）',
      curatedNote: '这里只列打开后确实看到效果的功能。「已实测」表示在标出的版本上看到过说明里写的效果；「未实测」表示效果只是从客户端的界面代码里读出来的。',
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
      searchPlaceholder: '搜索开关名',
      onlyChanged: '只看已改动',
      addPlaceholder: '自定义开关名，例如 enable-some-feature',
      addButton: '添加并开启',
      allEmpty: '还没有看到服务端的开关清单。让 Antigravity 经过本工具启动一次，这里就会列出全部开关。',
      allCount: '显示 {shown} / {total} 个。布尔开关和整数开关可以改；其他类型只读。',
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
        '本工具只在本机运行，不向第三方发送任何数据。它改写的是 Google 下发的实验开关：这些功能还没有正式发布，可能不稳定，也可能随版本更新而失效。',
      warn: {
        'app-missing': '没有找到 Antigravity：{detail}',
        'env-conflict': '环境变量 {detail} 已经被别的程序设置。本工具不会覆盖它，所以现在不起作用。',
        'env-error': '设置环境变量失败，详情见日志。',
        'endpoint-mismatch':
          'Antigravity 自己要连接的云端地址和本工具转发的地址不一致（{detail}）。请更新本工具，或修改 config.json 里的 upstreams。',
        'not-patched': '上一次没有改写成功，已原样放行（{detail}）。服务端的格式可能变了。',
        skipped: '这些开关的类型和服务端不一致，已跳过：{detail}',
        'upstream-failed': '最近有请求转发失败（{detail}）。',
        'page-unavailable': '找不到客户端自带的界面文件（{detail}），所以没有改界面加载方式，需要改界面的功能不会生效。',
        'page-not-changed': '界面脚本没有改动，已原样提供（{detail}）。客户端的版本可能变了，需要更新本工具。',
      },
    },
    en: {
      tagline: 'Choose which Antigravity experimental features to turn on',
      langButton: '中文',
      gateTitle: 'Open this page from the command line',
      gateBody: 'This page needs the local access token. Run this command in a terminal:',
      injection: 'Rewriting enabled',
      injectionOn: 'agy-flags is rewriting the flag configuration that Google sends to Antigravity.',
      injectionOff: 'Off: traffic passes through unchanged.',
      factClient: 'Antigravity',
      factRoute: 'Connection',
      factInjected: 'Last rewrite',
      factServer: 'Server flags',
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
      restart: 'Restart Antigravity',
      restarting: 'Restarting…',
      restartConfirm: 'This quits and reopens Antigravity. Running tasks will be interrupted. Continue?',
      tabCurated: 'Features',
      tabAll: 'All flags ({n})',
      curatedNote: 'Only features with an effect that was seen are listed here. "tested on" means the described effect was seen on that version; "untested" means the effect is known from the page code of the client only.',
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
      searchPlaceholder: 'Search flag names',
      onlyChanged: 'Changed only',
      addPlaceholder: 'Custom flag name, for example enable-some-feature',
      addButton: 'Add and turn on',
      allEmpty: 'The server flag list has not been seen yet. Start Antigravity through agy-flags once and all flags are listed here.',
      allCount: 'Showing {shown} of {total}. Boolean and integer flags can be changed; other types are read-only.',
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
        'agy-flags runs on this machine only and sends nothing to third parties. It rewrites experimental flags sent by Google: these features are unreleased, may be unstable, and may stop working after an update.',
      warn: {
        'app-missing': 'Antigravity was not found: {detail}',
        'env-conflict': 'The environment variable {detail} is already set by another program. agy-flags does not overwrite it, so it has no effect now.',
        'env-error': 'Could not set the environment variables. See the log.',
        'endpoint-mismatch':
          'Antigravity wants a different cloud endpoint from the one agy-flags forwards to ({detail}). Update agy-flags, or edit upstreams in config.json.',
        'not-patched': 'The last response was not rewritten and was passed through ({detail}). The server format may have changed.',
        skipped: 'These flags have a different type on the server and were skipped: {detail}',
        'upstream-failed': 'A forwarded request failed recently ({detail}).',
        'page-unavailable': 'The page files of the client were not found ({detail}). The page loading was not changed, and features that change the page have no effect.',
        'page-not-changed': 'The page script was not changed and was served as it is ({detail}). The client version may have changed; update agy-flags.',
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

  let token = '';
  const fromHash = /[#&]t=([0-9a-f]{48,128})/.exec(location.hash);
  if (fromHash) {
    token = fromHash[1];
    try {
      sessionStorage.setItem('agy-flags-token', token);
    } catch {
      // the token then lives for this page load only
    }
    history.replaceState(null, '', location.pathname);
  } else {
    try {
      token = sessionStorage.getItem('agy-flags-token') || '';
    } catch {
      token = '';
    }
  }

  // ---- state -------------------------------------------------------------------------

  let state = null;
  let server = { version: 0, flags: {} };
  let catalog = { groups: [] };
  const view = { tab: 'curated', search: '', onlyChanged: false };
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
    const headers = { 'x-agy-flags-token': token };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    } catch {
      throw Object.assign(new Error('offline'), { offline: true });
    }
    if (res.status === 401) {
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

  function groupStatusLines(group) {
    if (group.status === 'page') {
      const page = state.page || {};
      const lines = [page.carried ? t('pageCarried') : t('pageNotCarried')];
      if (!page.script) lines.push(t('pageScriptNone'));
      else if (page.script.patched) lines.push(t('pageScriptOk', { time: timeOf(page.script.at) }));
      else lines.push(t('pageScriptFail', { reason: page.script.reason || '' }));
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
    draw('status', [lang, state.enabled, state.app, state.client, state.lastInjection, state.server, state.warnings], () => {
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
    const total = new Set([...Object.keys(server.flags), ...Object.keys(state.overrides)]).size;
    $('tab-curated').textContent = t('tabCurated');
    $('tab-all').textContent = t('tabAll', { n: total });
    for (const tab of ['curated', 'all']) {
      $(`tab-${tab}`).setAttribute('aria-selected', String(view.tab === tab));
      $(`panel-${tab}`).hidden = view.tab !== tab;
    }
  }

  function groupState(group) {
    const flags = group.flags;
    const overriddenOn = flags.filter((f) => state.overrides[f] === true);
    const effectiveOn = flags.filter((f) => (hasOverride(f) ? state.overrides[f] === true : serverBool(f) === true));
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
    draw('curated', [lang, catalog, state.overrides, server.version, state.modelPatch, state.keepAlive, state.page], () => {
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
        for (const name of group.flags) {
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
        box.append(
          h(
            'article',
            { class: 'feature' },
            h('div', { class: 'feature-head' }, h('h3', null, title), ...badges, h('span', { class: 'spacer' }), toggle),
            h('p', null, description),
            ...params,
            ...status,
            flagList
          )
        );
      }
    });
  }

  function renderAll() {
    draw('all', [lang, view.search, view.onlyChanged, state.overrides, server.version], () => {
      const names = [...new Set([...Object.keys(server.flags), ...Object.keys(state.overrides)])].sort((a, b) => a.localeCompare(b));
      const needle = view.search.trim().toLowerCase();
      const shown = names.filter((name) => {
        if (view.onlyChanged && !hasOverride(name)) return false;
        return !needle || name.toLowerCase().includes(needle);
      });
      $('all-note').textContent =
        Object.keys(server.flags).length === 0 && names.length === 0
          ? t('allEmpty')
          : t('allCount', { shown: shown.length, total: names.length });

      const list = $('list');
      const rows = [];
      for (const name of shown) {
        const info = server.flags[name];
        // A flag the server does not send has the type of the override.
        const type = info ? info.type : typeof state.overrides[name] === 'number' ? 'intValue' : 'boolValue';
        const meta = [serverLabel(name)];
        if (info?.sources) meta.push(info.sources.join(', '));
        if (info?.differs) meta.push(t('differs'));

        let control;
        if (type === 'boolValue') {
          const current = hasOverride(name) ? (state.overrides[name] ? 'on' : 'off') : 'default';
          const seg = (value, label) =>
            h('button', { type: 'button', 'aria-pressed': String(current === value), dataset: { name, value } }, label);
          control = h('div', { class: 'seg', role: 'group', 'aria-label': name }, seg('default', t('segDefault')), seg('on', t('segOn')), seg('off', t('segOff')));
        } else if (type === 'intValue') {
          // An empty field means "what the server sends".
          control = h('input', {
            class: 'int',
            type: 'number',
            inputmode: 'numeric',
            step: 1,
            'aria-label': name,
            placeholder: t('intPlaceholder'),
            value: hasOverride(name) ? state.overrides[name] : null,
            dataset: { int: name },
          });
        } else {
          control = h('span', { class: 'badge' }, t('readOnly'));
        }
        rows.push(
          h(
            'div',
            { class: 'flag' },
            h(
              'div',
              { class: 'flag-main' },
              h('div', { class: 'flag-name mono' }, name, hasOverride(name) ? ' ' : null, hasOverride(name) ? h('span', { class: 'badge changed' }, t('changed')) : null),
              h('div', { class: 'flag-meta' }, meta.join(' · '))
            ),
            control
          )
        );
      }
      list.replaceChildren(...rows);
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
    const button = event.target.closest('button[data-group]');
    if (!button || !state) return;
    const group = catalog.groups.find((g) => g.id === button.dataset.group);
    if (!group) return;
    const turnOn = button.getAttribute('aria-checked') !== 'true';
    if (turnOn && group.risk) {
      const text = group.risk[lang] || group.risk.en || '';
      if (!window.confirm(t('riskConfirm', { text }))) return;
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
  if (!token) {
    showGate();
    return;
  }

  (async () => {
    try {
      catalog = await api('GET', '/api/catalog');
      await refresh();
    } catch (err) {
      reportError(err);
    }
    setInterval(() => {
      if (document.hidden || busy) return;
      refresh().catch((err) => {
        if (err?.offline) toast(t('errOffline'));
      });
    }, 3000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh().catch(() => {});
    });
  })();
})();
