// Pure functions that add a user-interface component to Antigravity's own page script.
//
// Some features are gated by a flag, but the public build of the page script (main.js)
// ships without their component: the place where the component belongs holds `void 0`.
// The context usage indicator is one of them. This module puts a component of our own
// into that place. It changes nothing else in the script.
//
// The page script is minified, and its internal names change with every release. So the
// two names the component needs are found by their shape, not by their spelling:
//   - the React namespace: the name used most often in `(0,X.useState)`;
//   - the hook that reads the state of one conversation: the function that is defined
//     with `{optimisticState:…,trueState:…}`.
// When a name or the place cannot be found, the script is returned as it is.

import vm from 'node:vm';

/** The empty place for the indicator in the public build. */
export const INDICATOR_ANCHOR = 'contextUsageIndicator:void 0,';

const IDENT = '[A-Za-z_$][\\w$]*';

/** The names the component needs, or the reason why one of them was not found. */
export function detectNames(source) {
  const counts = new Map();
  const call = '.useState)';
  const before = new RegExp(`\\(0,(${IDENT})$`);
  for (let at = source.indexOf(call); at !== -1; at = source.indexOf(call, at + 1)) {
    const match = before.exec(source.slice(Math.max(0, at - 40), at));
    if (match) counts.set(match[1], (counts.get(match[1]) || 0) + 1);
  }
  let react = null;
  let best = 0;
  for (const [name, count] of counts) {
    if (count > best) {
      react = name;
      best = count;
    }
  }
  if (!react || best < 20) return { ok: false, reason: 'the React namespace was not found' };
  if (!source.includes(`${react}.createElement(`)) return { ok: false, reason: 'the React namespace was not confirmed' };

  // Look only around the words that mark the hook: a pattern that starts with a free
  // name is slow over a script of this size.
  const marker = '{optimisticState:';
  const shape = new RegExp(`(${IDENT})=\\(${IDENT},${IDENT}\\)=>\\{var ${IDENT}=\\[\\],\\{optimisticState:${IDENT},trueState:${IDENT}\\}=${IDENT}\\($`);
  const hooks = [];
  for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
    const end = source.indexOf('(', at);
    if (end === -1 || end - at > 200) continue;
    const match = shape.exec(source.slice(Math.max(0, at - 200), end + 1));
    if (match) hooks.push(match);
  }
  if (hooks.length !== 1) {
    return { ok: false, reason: `the conversation state hook was found ${hooks.length} times, not once` };
  }
  return { ok: true, react, stateHook: hooks[0][1] };
}

/**
 * The component. It runs inside Antigravity's page, so it is plain JavaScript without
 * imports. It gets React and the state hook as arguments, and it writes every text with
 * textContent or as a React text child.
 */
export function indicatorFactory(React, useConversationState) {
  const h = React.createElement;
  const TYPE_LABELS = {
    1: 'System prompt',
    2: 'Tools',
    3: 'Rules',
    4: 'MCP tools',
    5: 'Skills',
    6: 'Subagents',
    7: 'Chat messages',
    8: 'Workflows',
    9: 'Plugins',
    10: 'Flows',
  };
  const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#64748b', '#e07b53', '#8db255', '#c77dba'];
  const selectUsage = (state) => state?.agentState?.contextWindowUsage;
  const selectCompacted = (state) => (state?.agentState?.compactedAtStepIndices?.length ?? 0) > 0;

  const num = (value) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const formatTokens = (value) => {
    const n = num(value);
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`;
    return String(Math.round(n));
  };
  const formatPercent = (value) => (value > 0 && value < 0.1 ? '<0.1' : value.toFixed(1));

  /** The numbers the trigger and the popover show. */
  function summarize(usage, compacted) {
    const used = num(usage?.estimatedTokensUsed);
    const max = num(usage?.maxContextTokens);
    const ratio = max > 0 ? Math.min(1, used / max) : 0;
    const groups = [];
    for (const group of Array.isArray(usage?.tokenGroups) ? usage.tokenGroups : []) {
      const tokens = num(group?.numTokens);
      if (tokens <= 0) continue;
      groups.push({ label: String(group?.name || TYPE_LABELS[group?.type] || 'Other'), tokens });
    }
    return {
      used,
      max,
      ratio,
      groups,
      compacted: Boolean(compacted) || num(usage?.estimatedAfterCompaction) > 0,
      color: ratio >= 0.85 ? '#ef4444' : ratio >= 0.65 ? '#f59e0b' : 'var(--primary, #3b82f6)',
    };
  }

  function el(tag, style, text) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Fill the popover. It is plain DOM under document.body, so that no parent can clip it. */
  function fillPopover(box, info) {
    box.replaceChildren();
    const head = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px');
    const title = el('div', 'display:flex;align-items:center;gap:6px;font-weight:600;font-size:12.5px');
    title.append(el('span', '', 'Context window'));
    if (info.compacted) {
      title.append(
        el('span', 'font-size:10px;font-weight:500;padding:1px 6px;border-radius:999px;background:var(--secondary);color:var(--secondary-foreground)', 'Compacted')
      );
    }
    const total =
      info.max > 0
        ? `${formatTokens(info.used)} / ${formatTokens(info.max)} (${(info.ratio * 100).toFixed(1)}%)`
        : info.used > 0
          ? `${formatTokens(info.used)} tokens`
          : 'Empty';
    head.append(title, el('span', 'font-variant-numeric:tabular-nums;color:var(--secondary-foreground);font-weight:500', total));
    box.append(head);

    const bar = el('div', 'height:6px;width:100%;border-radius:999px;background:var(--secondary);overflow:hidden;display:flex;margin-bottom:10px');
    if (info.groups.length > 0 && info.max > 0) {
      info.groups.forEach((group, i) => {
        const width = Math.min(100, (group.tokens / info.max) * 100);
        bar.append(el('div', `width:${width}%;height:100%;background:${COLORS[i % COLORS.length]}`));
      });
    } else {
      bar.append(el('div', `width:${Math.min(100, info.ratio * 100)}%;height:100%;background:${info.color}`));
    }
    box.append(bar);

    if (info.groups.length === 0) {
      box.append(
        el(
          'div',
          'color:var(--muted-foreground);font-size:11.5px',
          info.max > 0 ? 'No breakdown reported yet.' : 'Send or receive a message to see the context usage.'
        )
      );
      return;
    }
    const list = el('div', 'display:flex;flex-direction:column;gap:5px');
    info.groups.forEach((group, i) => {
      const row = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px');
      const name = el('div', 'display:flex;align-items:center;gap:6px;min-width:0');
      name.append(
        el('span', `width:7px;height:7px;border-radius:50%;flex-shrink:0;background:${COLORS[i % COLORS.length]}`),
        el('span', 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', group.label)
      );
      const base = info.max > 0 ? info.max : info.used;
      const share = base > 0 ? (group.tokens / base) * 100 : 0;
      row.append(
        name,
        el('span', 'font-variant-numeric:tabular-nums;color:var(--secondary-foreground);flex-shrink:0', `${formatTokens(group.tokens)} (${formatPercent(share)}%)`)
      );
      list.append(row);
    });
    box.append(list);
  }

  function placePopover(box, trigger) {
    const rect = trigger.getBoundingClientRect();
    const width = 300;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const above = rect.top > 280 || rect.top > window.innerHeight - rect.bottom;
    box.style.left = `${left}px`;
    box.style.top = `${above ? rect.top - 8 : rect.bottom + 8}px`;
    box.style.transform = above ? 'translateY(-100%)' : 'none';
  }

  function ContextUsageIndicator({ conversationId }) {
    const [open, setOpen] = React.useState(false);
    const triggerRef = React.useRef(null);
    const boxRef = React.useRef(null);
    const usage = useConversationState(conversationId, { selector: selectUsage });
    const compacted = useConversationState(conversationId, { selector: selectCompacted });
    const info = summarize(usage, compacted);

    // The popover exists only while it is open.
    React.useEffect(() => {
      if (!open) return undefined;
      const box = el(
        'div',
        'position:fixed;width:300px;max-height:min(420px,calc(100vh - 24px));overflow-y:auto;box-sizing:border-box;' +
          'background:var(--card,#1f1f1f);color:var(--foreground,#eee);border:1px solid var(--card-border,rgba(128,128,128,.4));' +
          'border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.32);padding:12px;z-index:9999;font-size:12px;line-height:1.45'
      );
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', 'Context window usage');
      box.dataset.agyFlags = 'context-usage-popover';
      document.body.append(box);
      boxRef.current = box;
      const place = () => {
        if (triggerRef.current) placePopover(box, triggerRef.current);
      };
      const onDown = (event) => {
        if (triggerRef.current?.contains(event.target) || box.contains(event.target)) return;
        setOpen(false);
      };
      const onKey = (event) => {
        if (event.key === 'Escape') setOpen(false);
      };
      place();
      window.addEventListener('mousedown', onDown, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('resize', place);
      window.addEventListener('scroll', place, true);
      return () => {
        window.removeEventListener('mousedown', onDown, true);
        window.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', place);
        window.removeEventListener('scroll', place, true);
        box.remove();
        boxRef.current = null;
      };
    }, [open]);

    React.useEffect(() => {
      if (boxRef.current) fillPopover(boxRef.current, info);
    });

    const percent = info.ratio * 100;
    const label = info.max > 0 ? (percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`) : '0%';
    const tip =
      info.max > 0
        ? `Context: ${formatTokens(info.used)} / ${formatTokens(info.max)} (${percent.toFixed(1)}%)`
        : 'Context window usage';
    const radius = 6;
    const circumference = 2 * Math.PI * radius;
    return h(
      'button',
      {
        ref: triggerRef,
        type: 'button',
        onClick: () => setOpen((value) => !value),
        title: open ? undefined : tip,
        'aria-label': tip,
        'aria-expanded': open,
        'data-testid': 'context-usage-indicator-trigger',
        'data-agy-flags': 'context-usage-indicator',
        className:
          'flex cursor-pointer items-center h-7 gap-1.5 rounded-full px-2 text-xs text-secondary-foreground select-none outline-none hover:bg-muted transition-colors',
        style: { background: 'transparent', border: 'none' },
      },
      h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 16 16', 'aria-hidden': 'true', style: { transform: 'rotate(-90deg)', flexShrink: 0 } },
        h('circle', { cx: 8, cy: 8, r: radius, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.25, strokeWidth: 2 }),
        h('circle', {
          cx: 8,
          cy: 8,
          r: radius,
          fill: 'none',
          stroke: info.color,
          strokeWidth: 2,
          strokeDasharray: circumference,
          strokeDashoffset: circumference * (1 - info.ratio),
          strokeLinecap: 'round',
        })
      ),
      h('span', { style: { fontVariantNumeric: 'tabular-nums', fontSize: '11.5px', fontWeight: 500 } }, label)
    );
  }

  // A mistake in the indicator must never take the input box down with it.
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
        console.error('[agy-flags] the context usage indicator failed and is hidden:', error);
      } catch {
        // nothing else to do
      }
    }
    render() {
      return this.state.failed ? null : this.props.children;
    }
  }

  function SafeIndicator(props) {
    return h(Boundary, null, h(ContextUsageIndicator, props));
  }
  SafeIndicator.summarize = summarize;
  SafeIndicator.formatTokens = formatTokens;
  return SafeIndicator;
}

/** The text that replaces the anchor. A failure while the page loads leaves the place empty, as before. */
export function indicatorReplacement(names) {
  return (
    'contextUsageIndicator:(()=>{try{return{Indicator:(' +
    indicatorFactory.toString() +
    `)(${names.react},${names.stateHook})}}catch(e){try{console.error("[agy-flags]",e)}catch(_){}return void 0}})(),`
  );
}

/**
 * Put the indicator into the page script.
 * @returns {{ ok: true, source: string } | { ok: false, source: string, reason: string }}
 *          `source` is the unchanged input when `ok` is false.
 */
export function patchMainJs(source, { check = true } = {}) {
  const fail = (reason) => ({ ok: false, source, reason });
  if (typeof source !== 'string') return { ok: false, source, reason: 'not a script' };
  const first = source.indexOf(INDICATOR_ANCHOR);
  if (first === -1) return fail('the place for the indicator was not found');
  if (source.indexOf(INDICATOR_ANCHOR, first + 1) !== -1) return fail('the place for the indicator was found more than once');
  const names = detectNames(source);
  if (!names.ok) return fail(names.reason);
  const patched = source.slice(0, first) + indicatorReplacement(names) + source.slice(first + INDICATOR_ANCHOR.length);
  if (check) {
    try {
      // Parse only. A script that does not parse would leave the window blank.
      new vm.Script(patched, { filename: 'main.js' });
    } catch (err) {
      return fail(`the changed script does not parse: ${err?.message || err}`);
    }
  }
  return { ok: true, source: patched, names: { react: names.react, stateHook: names.stateHook } };
}
