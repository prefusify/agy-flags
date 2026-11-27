// The AGY Plus page in Antigravity's own settings.
//
// The settings of the client are a list of pages in its page script: a table with the names
// for the navigation, and for each name the component that draws the page. Three small
// changes add one more page:
//   - the table gets one more entry;
//   - the place that draws the pages of the settings window gets one more page;
//   - the place that draws a single page (the narrow layout) gets one more case.
// A fourth change keeps the client from reporting the name of this page in its usage
// statistics. The page itself is a component of our own. It is drawn with the same marks
// (class names) as the client's own setting pages, so it looks like one of them.
//
// The page script is minified and its names change with every release, so each place is
// found by its shape. When one of the three places is not found exactly once, none of the
// changes is made.
//
// The page asks its own origin for /__agy_plus/<name>.json (see api.mjs).

/** The name of the page: in the navigation, and in the state of the client. */
export const SETTINGS_SCREEN = 'AGY Plus';

const IDENT = '[A-Za-z_$][\\w$]*';

/**
 * The page. It runs inside Antigravity's window, so it is plain JavaScript without imports.
 * It gets React as an argument, and it writes every text as a React text child.
 *
 * @param {object} React
 * @param {{ api: string }} options  `api` is the path that the requests start with.
 */
export function settingsPageFactory(React, options) {
  const h = React.createElement;
  const API = (options && options.api) || '/__agy_plus/';
  const POLL_MS = 3000;
  const own = (object, name) => Object.prototype.hasOwnProperty.call(object || {}, name);

  const TEXT = {
    zh: {
      tagline: '选择要开启的 Antigravity 增强与实验功能。多数改动要重启 Antigravity 才生效。',
      loading: '正在读取…',
      offline: '连不上 agy-plus 的常驻进程，这一页暂时不能用。',
      refused: 'agy-plus 拒绝了这一页的请求（{detail}）。',
      broken: '这一页出错了，详情见开发者工具的控制台。',
      enable: '启用 agy-plus',
      enableOn: '正在改写 Google 下发给 Antigravity 的开关配置。',
      enableOff: '已关闭：不改写任何内容，Antigravity 直连 Google。',
      bannerNotRouted: '重启 Antigravity 后，agy-plus 才开始起作用。',
      bannerStillRouted: '改写已关闭，重启 Antigravity 后恢复为直连 Google。',
      bannerFlagsChanged: '你改了开关，重启 Antigravity 后生效。',
      bannerPageOff: 'Antigravity 还在从 agy-plus 加载界面，重启后恢复为自带的界面。',
      restart: '重启 Antigravity',
      restartShort: '重启',
      restarting: '正在重启…',
      restartConfirm: '这会退出并重新打开 Antigravity，正在运行的任务会中断。',
      restartRowDesc: '退出并重新打开，正在运行的任务会中断。',
      cancel: '取消',
      turnOn: '仍要开启',
      untested: '未实测',
      testedTip: '已在 Antigravity {v} 上实测',
      untestedTip: '只从客户端代码里读出效果，还没有亲眼看到',
      serverOn: '服务端已开启',
      partial: '部分开启',
      other: '其他',
      about: '关于',
      aboutClient: 'Antigravity',
      routed: '经过 agy-plus',
      direct: '直连 Google',
      notRunning: '未运行',
      aboutRewrite: '上次改写',
      neverSeen: '还没有看到客户端的请求',
      rewritten: '{time}，改写 {n} 个开关',
      notRewritten: '{time}，没有改写',
      aboutOthers: '其他程序',
      othersLine: '命令行 agy 的请求 {cli} 个，其他来源 {other} 个，全部原样放行。',
      aboutTemplates: '自定义模板',
      aboutTemplatesLine: 'config.json 中已配置 {n} 条规则',
      aboutVersion: 'agy-plus',
      skillsSection: '内置技能',
      skillsDesc: '关闭不需要的内置技能目录，避免加载进系统提示词；新对话或重启后生效。',
      language: '页面语言',
      languageAuto: '跟随系统',
      footer:
        '本工具只在本机运行，不向第三方发送你的数据（「估算费用」会从 models.dev 下载公开价格表，「中文对话标题」只改起标题请求里的一句指令）。这些功能没有正式发布，可能不稳定，也可能随版本更新失效。',
      pageScriptFail: '没能改动 Antigravity 的界面（{reason}），这一项暂时不起作用。',
      l10nMissing: '词条表读不出来，界面仍是英文，请重新安装本工具。',
      titlesChanged: '客户端改了起标题的写法，标题暂时还是英文。',
      templatesMissing: '最近一次模型列表中有 {count} 个条目的模板标记对不上，对应条目未改写。',
      pricesError: '价格表更新失败（{error}），先用上一份。',
      pricesErrorNone: '价格表下载失败（{error}），一小时后自动再试。',
      pricesRefresh: '重试',
      errBadValue: '{name} 的值无效。',
      errServerType: '{name} 在服务端不是布尔开关，不能改。',
      errDownload: '下载价格表失败：{detail}',
      errGeneric: '操作失败：{detail}',
      warn: {
        'app-missing': '没有找到 Antigravity：{detail}',
        'env-conflict': '环境变量 {detail} 已经被别的程序设置。本工具不会覆盖它，所以现在不起作用。',
        'env-error': '设置环境变量失败，详情见日志。',
        'endpoint-mismatch': 'Antigravity 要连接的云端地址和本工具转发的地址不一致（{detail}）。请更新本工具，或修改 config.json 里的 upstreams。',
        'not-patched': '上一次没有改写成功，已原样放行（{detail}）。服务端的格式可能变了。',
        skipped: '这些开关的类型和服务端不一致，已跳过：{detail}',
        'upstream-failed': '最近有请求转发失败（{detail}）。',
        'desktop-not-recognized': 'Antigravity 的请求没有被认出来（它自称 {detail}），所以开关没有改写。客户端的版本可能变了，需要更新本工具。',
        'page-unavailable': '找不到客户端自带的界面文件（{detail}），需要改界面的功能不会生效。',
        'page-not-changed': '界面脚本有一处没有改成（{detail}），对应的功能不会生效。客户端的版本可能变了，需要更新本工具。',
        'titles-not-changed': '最近一个标题请求没有改写：客户端起标题的指令写法变了。需要更新本工具。',
        'templates-markers-missing': '最近一次模型列表中有 {detail} 个条目的模板标记对不上，已原样保留。客户端模板可能变了，请更新本工具或检查 config.json 里的 templates。',
        'skills-checksum-missing': '未找到 builtin/.checksum，Antigravity 下次启动时会重新生成内置技能目录。',
      },
    },
    en: {
      tagline: 'Choose which enhancements and experimental features of Antigravity are on. Most changes need a restart of Antigravity.',
      loading: 'Loading…',
      offline: 'The agy-plus daemon cannot be reached, so this page does not work for now.',
      refused: 'agy-plus refused the requests of this page ({detail}).',
      broken: 'This page failed. See the console of the developer tools.',
      enable: 'Enable agy-plus',
      enableOn: 'Rewriting the flag configuration that Google sends to Antigravity.',
      enableOff: 'Off: nothing is rewritten, and Antigravity connects directly to Google.',
      bannerNotRouted: 'Restart Antigravity for agy-plus to take effect.',
      bannerStillRouted: 'Rewriting is off. Restart Antigravity to connect directly to Google again.',
      bannerFlagsChanged: 'You changed flags. Restart Antigravity to apply them.',
      bannerPageOff: 'Antigravity still loads its page from agy-plus. Restart it to go back to its own page.',
      restart: 'Restart Antigravity',
      restartShort: 'Restart',
      restarting: 'Restarting…',
      restartConfirm: 'This quits and reopens Antigravity. Running tasks will be interrupted.',
      restartRowDesc: 'Quits and reopens the app. Running tasks will be interrupted.',
      cancel: 'Cancel',
      turnOn: 'Turn on anyway',
      untested: 'untested',
      testedTip: 'Seen working on Antigravity {v}',
      untestedTip: 'Known from the client code only; the effect was not seen',
      serverOn: 'already on',
      partial: 'partly on',
      other: 'Other',
      about: 'About',
      aboutClient: 'Antigravity',
      routed: 'through agy-plus',
      direct: 'direct to Google',
      notRunning: 'not running',
      aboutRewrite: 'Last rewrite',
      neverSeen: 'no request from the client yet',
      rewritten: '{time}, {n} flags rewritten',
      notRewritten: '{time}, not rewritten',
      aboutOthers: 'Other programs',
      othersLine: '{cli} requests from the agy command line and {other} from other senders, all passed through unchanged.',
      aboutTemplates: 'Custom templates',
      aboutTemplatesLine: '{n} rules in config.json',
      aboutVersion: 'agy-plus',
      skillsSection: 'Builtin skills',
      skillsDesc: 'Turn off builtin skill folders you do not need so they are not loaded into prompts; takes effect in new conversations or after a restart.',
      language: 'Page language',
      languageAuto: 'System',
      footer:
        'agy-plus runs on this machine only and sends none of your data to third parties ("Estimated costs" downloads a public price list from models.dev; "Chinese conversation titles" changes only one sentence of the title request). These features are unreleased, may be unstable, and may stop working after an update.',
      pageScriptFail: 'The Antigravity page could not be changed ({reason}), so this does not work for now.',
      l10nMissing: 'The word list cannot be read, so the page stays in English; install agy-plus again.',
      titlesChanged: 'The client now asks for titles differently, so titles are English for now.',
      templatesMissing: '{count} model entries in the last model list did not match the template markers and were left unchanged.',
      pricesError: 'The price list could not be updated ({error}); the last one is still used.',
      pricesErrorNone: 'The price list could not be downloaded ({error}); it is tried again in an hour.',
      pricesRefresh: 'Retry',
      errBadValue: 'The value for {name} is not valid.',
      errServerType: '{name} is not a boolean flag on the server and cannot be changed.',
      errDownload: 'The price list could not be downloaded: {detail}',
      errGeneric: 'Failed: {detail}',
      warn: {
        'app-missing': 'Antigravity was not found: {detail}',
        'env-conflict': 'The environment variable {detail} is already set by another program. agy-plus does not overwrite it, so it has no effect now.',
        'env-error': 'Could not set the environment variables. See the log.',
        'endpoint-mismatch': 'Antigravity wants a different cloud endpoint from the one agy-plus forwards to ({detail}). Update agy-plus, or edit upstreams in config.json.',
        'not-patched': 'The last response was not rewritten and was passed through ({detail}). The server format may have changed.',
        skipped: 'These flags have a different type on the server and were skipped: {detail}',
        'upstream-failed': 'A forwarded request failed recently ({detail}).',
        'desktop-not-recognized': 'The requests of Antigravity were not recognised (it calls itself {detail}), so no flag was rewritten. The client version may have changed; update agy-plus.',
        'page-unavailable': 'The page files of the client were not found ({detail}), so features that change the page have no effect.',
        'page-not-changed': 'One change of the page script could not be made ({detail}), so its feature has no effect. The client version may have changed; update agy-plus.',
        'titles-not-changed': 'The last title request was not changed: the client words its title instruction differently now. Update agy-plus.',
        'templates-markers-missing': '{detail} model entries in the last model list did not match the template markers and were left as sent. Update agy-plus or check templates in config.json.',
        'skills-checksum-missing': 'builtin/.checksum is missing, so Antigravity will recreate all builtin skill folders on its next start.',
      },
    },
  };

  // ---- what is on -------------------------------------------------------------------------

  const fill = (text, vars) => {
    let out = String(text);
    for (const key of Object.keys(vars || {})) out = out.split(`{${key}}`).join(String(vars[key] ?? ''));
    return out;
  };

  /** The language chosen on the page; without a choice, Chinese on a Chinese system. */
  function pickLang(state, systemLanguage) {
    const chosen = state && state.pageLanguage;
    if (chosen === 'zh' || chosen === 'en') return chosen;
    return String(systemLanguage || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  /** What the server sends for a flag: true, false, or null when it is absent or not boolean. */
  function serverBool(server, name) {
    const info = server && server.flags ? server.flags[name] : null;
    return info && info.type === 'boolValue' ? info.value === true : null;
  }

  /** What the client gets for a boolean flag: the override, else what the server sends. */
  function flagOn(state, server, name) {
    return own(state.overrides, name) ? state.overrides[name] === true : serverBool(server, name) === true;
  }

  const list = (value) => (Array.isArray(value) ? value : []);

  /**
   * One entry of the catalog: is it on?
   * `on`: everything it needs is on. `partial`: a part of it is on. `serverOnly`: it is on
   * because the server turns it on, not because of a choice made here.
   */
  function groupState(group, state, server) {
    const flags = list(group.flags);
    const flagsOn = flags.filter((name) => flagOn(state, server, name));
    const feature = group.feature ? state.features && state.features[group.feature] === true : null;
    const needed = list(group.requires).every((name) => flagOn(state, server, name));
    const ownOn = flagsOn.length === flags.length && feature !== false && (flags.length > 0 || feature === true);
    const on = ownOn && needed;
    return {
      on,
      partial: !on && (flagsOn.length > 0 || feature === true),
      serverOnly: on && feature === null && flags.every((name) => state.overrides[name] !== true),
    };
  }

  /** What is wrong with a feature that is on: [[textKey, vars]]. Empty while all is well. */
  function groupProblems(group, state) {
    const out = [];
    const part = group.uiPatch && state.page && state.page.script && state.page.script.parts ? state.page.script.parts[group.uiPatch] : null;
    if (part && !part.ok) out.push(['pageScriptFail', { reason: part.reason || '' }]);
    if (group.status === 'prices' && state.prices && state.prices.error) {
      out.push([state.prices.fetchedAt ? 'pricesError' : 'pricesErrorNone', { error: state.prices.error }]);
    }
    if (group.status === 'l10n' && !(state.l10n && state.l10n.ready)) out.push(['l10nMissing', {}]);
    if (group.status === 'titles' && state.titles && state.titles.changed > 0) out.push(['titlesChanged', {}]);
    if (group.status === 'templates' && state.templates && state.templates.missing > 0) out.push(['templatesMissing', { count: state.templates.missing }]);
    return out;
  }

  /** The changes that turn an entry on or off: { path, body } for one request. */
  function changeFor(group, turnOn, state, server) {
    const flags = {};
    // What it needs belongs to another entry: it is turned on with it, and stays on after it.
    if (turnOn) for (const name of list(group.requires)) if (!flagOn(state, server, name)) flags[name] = true;
    // Off means "back to what the server sends", not "forced off".
    for (const name of list(group.flags)) flags[name] = turnOn ? true : null;
    if (!group.feature) return { path: 'flags', body: { changes: flags } };
    const body = { changes: { [group.feature]: turnOn } };
    if (Object.keys(flags).length > 0) body.flags = flags;
    return { path: 'features', body };
  }

  /** The catalog as the page shows it: [{ id, title, groups }], an entry without a known section last. */
  function sectionsOf(catalog) {
    const groups = list(catalog && catalog.groups);
    const out = list(catalog && catalog.sections).map((section) => ({
      id: section.id,
      title: section.title,
      groups: groups.filter((group) => group.section === section.id),
    }));
    const known = new Set(out.map((section) => section.id));
    const rest = groups.filter((group) => !known.has(group.section));
    if (rest.length > 0) out.push({ id: '', title: null, groups: rest });
    return out.filter((section) => section.groups.length > 0);
  }

  // ---- requests ---------------------------------------------------------------------------

  async function call(method, name, body) {
    let res;
    try {
      res = await fetch(`${API}${name}.json`, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      throw { kind: 'offline' };
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (res.ok && data) return data;
    // Without an answer of our own, the request did not reach the daemon.
    if (!data || typeof data.error !== 'string') throw { kind: 'offline' };
    throw { kind: res.status === 403 ? 'refused' : 'failed', data };
  }

  // ---- parts that look like the client's own -------------------------------------------------
  //
  // The class names are the ones of the client's setting pages in 2.35.2: its style sheet has
  // a rule only for the names its own code uses.

  const Card = (props) =>
    h('div', { className: 'agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border' }, props.children);

  const Pill = (props) =>
    h(
      'span',
      { className: 'text-[10px] font-semibold leading-none bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full select-none border border-border shrink-0' },
      props.children
    );

  function Section(props) {
    return h(
      'div',
      { className: 'space-y-2' },
      props.title
        ? h(
            'div',
            { className: 'flex flex-col gap-1' },
            h('div', { className: 'flex items-center justify-between' }, h('div', { className: 'flex items-center gap-1.5' }, h('h3', { className: 'm-0 font-medium' }, props.title))),
            props.description ? h('span', { className: 'text-sm text-muted-foreground' }, props.description) : null
          )
        : null,
      h('div', null, props.children)
    );
  }

  function Row(props) {
    return h(
      'div',
      { 'data-disabled': props.disabled ? 'true' : undefined, className: 'py-2 px-3 w-full bg-transparent flex justify-between gap-4 items-center' },
      h(
        'div',
        { className: 'flex-1 flex flex-col gap-0.5' },
        h(
          'div',
          // In a narrow window the marks move below the name instead of squeezing it.
          { className: 'flex flex-wrap items-center gap-x-1.5 gap-y-1' },
          h('span', { className: props.disabled ? 'text-muted-foreground' : '', title: props.tip || undefined }, props.label),
          ...list(props.pills).map((text) => h(Pill, { key: text }, text))
        ),
        props.description ? h('span', { className: 'text-sm text-muted-foreground whitespace-pre-wrap' }, props.description) : null,
        props.extra ? h('div', { className: 'w-full' }, props.extra) : null
      ),
      props.right ? h('div', { className: 'shrink-0' }, props.right) : null
    );
  }

  function Switch(props) {
    return h(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked,
        'aria-label': props.label,
        disabled: props.disabled,
        onClick: () => {
          if (!props.disabled) props.onChange(!props.checked);
        },
        className:
          'relative inline-flex items-center rounded-full transition-colors duration-200 ease-in-out shrink-0 h-6 w-11 ' +
          (props.checked ? 'bg-primary' : 'bg-secondary') +
          (props.disabled ? ' opacity-50 cursor-not-allowed' : ' cursor-pointer'),
      },
      h('span', {
        className: 'inline-block rounded-full bg-white transition-transform duration-200 ease-in-out shadow-sm h-4 w-4',
        style: { transform: props.checked ? 'translateX(24px)' : 'translateX(4px)' },
      })
    );
  }

  function Button(props) {
    const look =
      props.variant === 'primary'
        ? 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm border-none'
        : 'bg-secondary text-secondary-foreground hover:text-foreground border-none';
    return h(
      'button',
      {
        type: 'button',
        disabled: props.disabled,
        onClick: props.onClick,
        className:
          'agy-button agy-button-sm inline-flex items-center font-medium transition-colors select-none outline-none cursor-pointer justify-center disabled:opacity-50 shrink-0 whitespace-nowrap ' +
          (props.disabled ? 'pointer-events-none ' : '') +
          look +
          ' h-7 text-base rounded-md gap-1.5 px-2.5',
      },
      props.children
    );
  }

  /** A line that asks for attention, with buttons on its right; below it where there is no room. */
  function Notice(props) {
    return h(
      'div',
      { role: 'status', className: 'flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm' },
      h('span', { className: 'flex-1 min-w-48' }, props.children),
      props.actions ? h('div', { className: 'flex items-center gap-1.5 shrink-0' }, props.actions) : null
    );
  }

  const Value = (props) => h('span', { className: 'text-sm text-muted-foreground' }, props.children);

  /** The frame of a setting page: title, one line below it, and the sections. */
  function Frame(props) {
    return h(
      'div',
      // translate="no": the interface translation of agy-plus leaves this page alone, which is
      // already in the language chosen on it.
      { ref: props.rootRef, className: 'w-full bg-transparent h-full overflow-y-auto', 'data-agy-plus': 'settings-page', translate: 'no' },
      h(
        'div',
        { className: `${props.compact ? 'p-4' : 'p-6'} flex flex-col gap-4 w-full max-w-2xl mx-auto` },
        h(
          'div',
          { className: 'flex flex-col gap-2 w-full mb-2 bg-transparent' },
          h(
            'div',
            { className: `flex justify-between items-start gap-4 w-full bg-transparent${props.compact ? '' : ' pr-8 lg:pr-0'}` },
            h(
              'div',
              { className: 'flex-1 flex flex-col gap-1 min-w-0 bg-transparent' },
              h('h2', { className: `${props.compact ? 'text-xl' : 'text-2xl'} m-0 font-medium truncate flex-1 text-foreground` }, 'AGY Plus'),
              props.tagline ? h('div', { className: 'text-muted-foreground bg-transparent' }, props.tagline) : null
            ),
            props.actions ? h('div', { role: 'group', 'aria-label': props.actionsLabel, title: props.actionsLabel, className: 'flex items-center gap-1.5 shrink-0 pt-1' }, props.actions) : null
          )
        ),
        h('div', { className: 'flex flex-col gap-8 w-full' }, props.children)
      )
    );
  }

  // ---- the page ---------------------------------------------------------------------------

  function Page(props) {
    const active = props.active !== false;
    // { state, server, catalog }: the last answers of the daemon.
    const [data, setData] = React.useState(null);
    // The reason why the daemon cannot be asked: { kind, data }.
    const [failure, setFailure] = React.useState(null);
    // The last change that was refused: { kind, data }.
    const [mistake, setMistake] = React.useState(null);
    // The question that is open: 'restart:top', 'restart:about' or 'risk:<id>'.
    const [asking, setAsking] = React.useState(null);
    const [restarting, setRestarting] = React.useState(false);
    const rootRef = React.useRef(null);
    const dataRef = React.useRef(null);
    const busyRef = React.useRef(false);

    const load = React.useCallback(async (everything) => {
      const last = dataRef.current;
      const state = await call('GET', 'state');
      const catalog = last && !everything ? last.catalog : await call('GET', 'catalog');
      const server = last && last.server.version === state.server.version ? last.server : await call('GET', 'server-flags');
      dataRef.current = { state, server, catalog };
      setData(dataRef.current);
      setFailure(null);
    }, []);

    // The daemon is asked only while somebody can see the page. The settings window keeps
    // its pages when it is closed, so "this page is the chosen one" is not enough.
    React.useEffect(() => {
      if (!active) return undefined;
      let stopped = false;
      let timer = null;
      let everything = true;
      const shown = () => {
        const el = rootRef.current;
        return Boolean(el) && el.getClientRects().length > 0 && !document.hidden;
      };
      const tick = async () => {
        if (stopped) return;
        if (!shown()) {
          everything = true;
        } else if (!busyRef.current) {
          try {
            await load(everything);
            everything = false;
          } catch (error) {
            if (!stopped) setFailure(error && error.kind ? error : { kind: 'offline' });
          }
        }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
      };
      tick();
      return () => {
        stopped = true;
        clearTimeout(timer);
      };
    }, [active, load]);

    /** Send one change, then show what is true now. */
    const act = async (path, body) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setMistake(null);
      try {
        await call('POST', path, body);
      } catch (error) {
        if (error && error.kind === 'failed') setMistake(error);
        else setFailure(error && error.kind ? error : { kind: 'offline' });
      } finally {
        busyRef.current = false;
      }
      try {
        await load(false);
      } catch (error) {
        setFailure(error && error.kind ? error : { kind: 'offline' });
      }
    };

    const state = data ? data.state : null;
    const lang = pickLang(state, typeof navigator === 'undefined' ? '' : navigator.language);
    const t = (key, vars) => fill(own(TEXT[lang], key) ? TEXT[lang][key] : own(TEXT.en, key) ? TEXT.en[key] : key, vars);
    const pick = (texts) => (texts && (texts[lang] || texts.en)) || '';
    const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-GB') : '');

    const failureText = failure ? (failure.kind === 'refused' ? t('refused', { detail: (failure.data && failure.data.error) || '' }) : t('offline')) : null;
    if (!data) {
      return h(Frame, { rootRef, compact: props.compact, tagline: t('tagline') }, failureText ? h(Notice, null, failureText) : h(Value, null, t('loading')));
    }

    const { server, catalog } = data;
    const restartBusy = restarting || state.restarting === true;

    const restart = () => {
      setAsking(null);
      setRestarting(true);
      // The answer comes only after the client is back, and this window is gone by then.
      act('restart-client', {}).finally(() => setRestarting(false));
    };

    /** The restart button of one place, or the question that follows a click on it. */
    const restartActions = (place, label, variant) =>
      asking === `restart:${place}`
        ? [
            h(Button, { key: 'yes', variant: 'primary', onClick: restart }, t('restartShort')),
            h(Button, { key: 'no', onClick: () => setAsking(null) }, t('cancel')),
          ]
        : [h(Button, { key: 'ask', variant, disabled: restartBusy, onClick: () => setAsking(`restart:${place}`) }, restartBusy ? t('restarting') : label)];

    const notices = [];
    if (failureText) notices.push(h(Notice, { key: 'failure' }, failureText));
    if (state.pendingRestart || restartBusy) {
      const key = { 'not-routed': 'bannerNotRouted', 'still-routed': 'bannerStillRouted', 'flags-changed': 'bannerFlagsChanged', 'page-off': 'bannerPageOff' }[
        state.pendingReason
      ];
      const text = asking === 'restart:top' ? t('restartConfirm') : restartBusy ? t('restarting') : key ? t(key) : '';
      notices.push(h(Notice, { key: 'restart', actions: restartActions('top', t('restart'), 'primary') }, text));
    }
    if (mistake) {
      const info = mistake.data || {};
      const key = { 'server-type': 'errServerType', 'bad-value': 'errBadValue', 'download-failed': 'errDownload' }[info.error] || 'errGeneric';
      notices.push(h(Notice, { key: 'mistake' }, t(key, { name: info.name || '', detail: info.detail || info.error || '' })));
    }
    for (const warning of list(state.warnings)) {
      const template = own(TEXT[lang].warn, warning.code) ? TEXT[lang].warn[warning.code] : `${warning.code}: {detail}`;
      notices.push(h(Notice, { key: `warn:${warning.code}:${warning.detail}` }, fill(template, { detail: warning.detail || '' })));
    }

    const featureRow = (group) => {
      const gs = groupState(group, state, server);
      const title = pick(group.title) || group.id;
      const pills = [];
      if (!group.tested) pills.push(t('untested'));
      if (group.risk) pills.push(pick(group.riskLabel));
      if (gs.serverOnly) pills.push(t('serverOn'));
      else if (gs.partial) pills.push(t('partial'));

      const extra = [];
      if (asking === `risk:${group.id}`) {
        extra.push(
          h(
            'div',
            { key: 'risk', className: 'pt-1' },
            h(
              Notice,
              {
                actions: [
                  h(
                    Button,
                    {
                      key: 'yes',
                      variant: 'primary',
                      onClick: () => {
                        setAsking(null);
                        const change = changeFor(group, true, state, server);
                        act(change.path, change.body);
                      },
                    },
                    t('turnOn')
                  ),
                  h(Button, { key: 'no', onClick: () => setAsking(null) }, t('cancel')),
                ],
              },
              pick(group.risk)
            )
          )
        );
      }
      if (gs.on && state.enabled) {
        groupProblems(group, state).forEach(([key, vars], i) => {
          const retry =
            key === 'pricesError' || key === 'pricesErrorNone'
              ? [h(Button, { key: 'retry', disabled: state.prices && state.prices.refreshing === true, onClick: () => act('prices-refresh', {}) }, t('pricesRefresh'))]
              : null;
          extra.push(h('div', { key: `problem:${i}`, className: 'pt-1' }, h(Notice, { actions: retry }, t(key, vars))));
        });
      }

      return h(Row, {
        key: group.id,
        label: title,
        tip: group.tested ? t('testedTip', { v: group.tested }) : t('untestedTip'),
        pills: pills.filter(Boolean),
        description: pick(group.description),
        disabled: !state.enabled,
        extra: extra.length > 0 ? extra : null,
        right: h(Switch, {
          checked: gs.on,
          label: title,
          disabled: !state.enabled || gs.serverOnly,
          onChange: (turnOn) => {
            if (turnOn && group.risk) {
              setAsking(`risk:${group.id}`);
              return;
            }
            setAsking(null);
            const change = changeFor(group, turnOn, state, server);
            act(change.path, change.body);
          },
        }),
      });
    };

    // The language of this page. The names of the languages are written in their own language.
    const languageButtons = [
      ['auto', t('languageAuto')],
      ['zh', '中文'],
      ['en', 'English'],
    ].map(([value, label]) => {
      const chosen = (state.pageLanguage || 'auto') === value;
      return h(
        Button,
        {
          key: value,
          variant: chosen ? 'primary' : undefined,
          disabled: restartBusy,
          onClick: chosen ? undefined : () => act('page-language', { language: value }),
        },
        label
      );
    });

    const lastRewrite = ['aicode', 'cloudcode'].map((name) => state.lastInjection && state.lastInjection[name]).filter(Boolean)[0];
    const by = (state.traffic && state.traffic.byClient) || {};
    const others = (by.cli || 0) + (by.other || 0);
    const client = state.client || {};
    const app = state.app || {};
    const skillItems = list(state.skills && state.skills.items);
    const customTemplates = (state.templates && state.templates.customCount) || 0;

    return h(
      Frame,
      { rootRef, compact: props.compact, tagline: t('tagline'), actions: languageButtons, actionsLabel: t('language') },
      notices.length > 0 ? h('div', { className: 'flex flex-col gap-2' }, notices) : null,
      h(
        Section,
        null,
        h(
          Card,
          null,
          h(Row, {
            label: t('enable'),
            description: state.enabled ? t('enableOn') : t('enableOff'),
            right: h(Switch, { checked: state.enabled, label: t('enable'), onChange: (enabled) => act('enabled', { enabled }) }),
          })
        )
      ),
      ...sectionsOf(catalog).map((section) =>
        h(Section, { key: section.id || 'other', title: section.title ? pick(section.title) : t('other') }, h(Card, null, section.groups.map(featureRow)))
      ),
      skillItems.length > 0
        ? h(
            Section,
            { key: 'skills', title: t('skillsSection'), description: t('skillsDesc') },
            h(
              Card,
              null,
              skillItems.map((skill) =>
                h(Row, {
                  key: skill.name,
                  label: skill.name,
                  description: pick(skill.description),
                  disabled: !state.enabled,
                  right: h(Switch, {
                    checked: skill.enabled !== false,
                    label: skill.name,
                    disabled: !state.enabled,
                    onChange: (turnOn) => {
                      setAsking(null);
                      act('skills', { changes: { [skill.name]: turnOn } });
                    },
                  }),
                })
              )
            )
          )
        : null,
      h(
        Section,
        { title: t('about') },
        h(
          Card,
          null,
          h(Row, {
            label: t('aboutClient'),
            right: h(Value, null, [app.version, !client.running ? t('notRunning') : client.routed ? t('routed') : t('direct')].filter(Boolean).join(' · ')),
          }),
          h(Row, {
            label: t('aboutRewrite'),
            right: h(
              Value,
              null,
              !lastRewrite
                ? t('neverSeen')
                : lastRewrite.ok
                  ? t('rewritten', { time: timeOf(lastRewrite.at), n: list(lastRewrite.applied).length })
                  : t('notRewritten', { time: timeOf(lastRewrite.at) })
            ),
          }),
          customTemplates > 0 ? h(Row, { label: t('aboutTemplates'), right: h(Value, null, t('aboutTemplatesLine', { n: customTemplates })) }) : null,
          others > 0 ? h(Row, { label: t('aboutOthers'), description: t('othersLine', { cli: by.cli || 0, other: by.other || 0 }) }) : null,
          h(Row, { label: t('aboutVersion'), right: h(Value, null, state.version || '') }),
          h(Row, {
            label: t('restart'),
            description: asking === 'restart:about' ? t('restartConfirm') : t('restartRowDesc'),
            right: h('div', { className: 'flex items-center gap-1.5' }, restartActions('about', t('restartShort'))),
          })
        )
      ),
      h('div', { className: 'text-sm text-muted-foreground leading-relaxed' }, t('footer'))
    );
  }

  // A mistake in this page must never take the settings window down with it.
  class Boundary extends React.Component {
    constructor(props) {
      super(props);
      this.state = { failed: false };
    }
    static getDerivedStateFromError() {
      return { failed: true };
    }
    componentDidCatch(error) {
      try {
        console.error('[agy-plus] the settings page failed:', error);
      } catch {
        // nothing else to do
      }
    }
    render() {
      if (!this.state.failed) return this.props.children;
      const lang = pickLang(null, typeof navigator === 'undefined' ? '' : navigator.language);
      return h(Frame, { compact: this.props.compact }, h(Notice, null, TEXT[lang].broken));
    }
  }

  function SafePage(props) {
    return h(Boundary, { compact: props.compact }, h(Page, props));
  }
  SafePage.helpers = { groupState, groupProblems, changeFor, sectionsOf, pickLang, fill, TEXT };
  return SafePage;
}

// ---- the changes to the page script -------------------------------------------------------

/** Every position of `mark` in `source`. */
function positions(source, mark) {
  const out = [];
  for (let at = source.indexOf(mark); at !== -1; at = source.indexOf(mark, at + 1)) out.push(at);
  return out;
}

// The fixed words of each place are searched for first, and the names are read next to
// them: a pattern that starts with a free name takes seconds over a script of this size.

/** The table of the navigation: [{screen:"General"},{screen:"App",label:"Application"},…]. */
function navigationTable(source) {
  const shape = /\[\{screen:"General"\}(?:,\{screen:"[^"{}\\]*"(?:,label:"[^"{}\\]*")?\})+\]/y;
  const found = [];
  for (const at of positions(source, '[{screen:"General"},')) {
    shape.lastIndex = at;
    const match = shape.exec(source);
    if (match) found.push({ start: at, end: at + match[0].length });
  }
  return found;
}

/** The page of the settings window that is drawn for "Developer": the new page goes after it. */
function windowPages(source) {
  const mark = '==="Developer"?"block":"none"}},';
  const before = new RegExp(`(${IDENT})\\.createElement\\("div",\\{style:\\{display:(${IDENT})$`);
  const after = new RegExp(`^(${IDENT})\\.createElement\\(${IDENT},null\\)\\)`);
  const found = [];
  for (const at of positions(source, mark)) {
    const head = before.exec(source.slice(Math.max(0, at - 120), at));
    const tail = after.exec(source.slice(at + mark.length, at + mark.length + 120));
    if (!head || !tail || head[1] !== tail[1]) continue;
    found.push({ end: at + mark.length + tail[0].length, react: head[1], screen: head[2] });
  }
  return found;
}

/** The case that draws "Developer" as a single page: the new case goes after it. */
function singlePages(source) {
  const mark = 'case "Developer":return ';
  const after = new RegExp(`^(${IDENT})\\.createElement\\(${IDENT},null\\);`);
  const found = [];
  for (const at of positions(source, mark)) {
    const tail = after.exec(source.slice(at + mark.length, at + mark.length + 120));
    if (tail) found.push({ end: at + mark.length + tail[0].length, react: tail[1] });
  }
  return found;
}

/** The call that reports which page of the settings is looked at. */
function pageReports(source) {
  const mark = '.fireEvent("settings_page_viewed",{extra:{screen:';
  const before = new RegExp(`(${IDENT})$`);
  const after = new RegExp(`^(${IDENT})\\}\\}\\)`);
  const found = [];
  for (const at of positions(source, mark)) {
    const head = before.exec(source.slice(Math.max(0, at - 60), at));
    const tail = after.exec(source.slice(at + mark.length, at + mark.length + 60));
    if (head && tail) found.push({ start: at - head[1].length, end: at + mark.length + tail[0].length, screen: tail[1] });
  }
  return found;
}

/**
 * Add the page to the settings of the client.
 * @param {string} source      The page script.
 * @param {{ api: string }} options
 * @returns {{ ok: true, source: string, reported: boolean } | { ok: false, reason: string }}
 *          `reported` is true when the place that reports the page name was not found, so
 *          the client may report the name of this page like the name of any other.
 */
export function patchSettingsPage(source, options) {
  const name = JSON.stringify(SETTINGS_SCREEN);
  if (source.includes(`{screen:${name}}`)) return { ok: false, reason: 'the settings already have a page with this name' };
  const tables = navigationTable(source);
  if (tables.length !== 1) return { ok: false, reason: `the list of setting pages was found ${tables.length} times, not once` };
  const pages = windowPages(source);
  if (pages.length !== 1) return { ok: false, reason: `the pages of the settings window were found ${pages.length} times, not once` };
  const singles = singlePages(source);
  if (singles.length !== 1) return { ok: false, reason: `the single setting page was found ${singles.length} times, not once` };
  const [table] = tables;
  const [page] = pages;
  const [single] = singles;
  if (page.react !== single.react) return { ok: false, reason: 'the two places for the page do not use the same React' };
  const react = page.react;

  // The component is made at the first use, once for each window. A failure while it is
  // made leaves an empty page, and the rest of the settings as it was.
  const maker =
    '(()=>{let c;return r=>{if(!c){try{c=(' +
    settingsPageFactory.toString() +
    `)(r,${JSON.stringify({ api: options.api })})}catch(e){try{console.error("[agy-plus]",e)}catch(_){}c=()=>null}}return c}})()`;
  const component = `globalThis.__agyPlusSettings(${react})`;

  const edits = [
    {
      start: table.start,
      end: table.end,
      text: `(globalThis.__agyPlusSettings=${maker},${source.slice(table.start, table.end - 1)},{screen:${name}}])`,
    },
    {
      start: page.end,
      end: page.end,
      text: `,${react}.createElement("div",{style:{display:${page.screen}===${name}?"block":"none"}},${react}.createElement(${component},{active:${page.screen}===${name}}))`,
    },
    { start: single.end, end: single.end, text: `case ${name}:return ${react}.createElement(${component},{active:!0,compact:!0});` },
  ];
  const reports = pageReports(source);
  if (reports.length === 1) {
    const [report] = reports;
    edits.push({ start: report.start, end: report.end, text: `(${report.screen}===${name}||${source.slice(report.start, report.end)})` });
  }

  edits.sort((a, b) => b.start - a.start);
  let out = source;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return { ok: true, source: out, reported: reports.length !== 1 };
}
