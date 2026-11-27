// Pure functions that add a user-interface component to Antigravity's own page script.
//
// Some features are gated by a flag, but the public build of the page script (main.js)
// ships without their component: the place where the component belongs holds `void 0`.
// The context usage indicator is one of them. This module puts a component of our own
// into that place.
//
// A second, separate change fills in the cost column of the cost summary. The client gets
// that summary from its language server, and on 2.35.1 the language server has no price
// list: every price is 0. One call is put around the single place where the summary enters
// the page state. It computes the costs from a price list that agy-plus provides.
//
// A third change adds a translator to the end of the script (see l10n.mjs). It shows the
// text of the page in Chinese.
//
// A fourth change adds the page of agy-plus to the settings of the client (see
// settingspage.mjs).
//
// The changes do not depend on each other. Nothing else in the script changes.
//
// The page script is minified, and its internal names change with every release. So the
// two names the component needs are found by their shape, not by their spelling:
//   - the React namespace: the name used most often in `(0,X.useState)`;
//   - the hook that reads the state of one conversation: the function that is defined
//     with `{optimisticState:…,trueState:…}`.
// When a name or the place cannot be found, the script is returned as it is.

import vm from 'node:vm';
import { patchL10n } from './l10n.mjs';
import { patchSettingsPage } from './settingspage.mjs';

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
      box.dataset.agyPlus = 'context-usage-popover';
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
        'data-agy-plus': 'context-usage-indicator',
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
        console.error('[agy-plus] the context usage indicator failed and is hidden:', error);
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

/**
 * The function that fills in the costs of a cost summary. It runs inside Antigravity's page,
 * so it is plain JavaScript without imports.
 *
 * `table` is { modelKey: [input, output, cacheRead] } in US dollars per million tokens.
 *
 * A section is filled in only when the client left it empty: its cost is 0 and none of its
 * three prices is set. A section of a model that the table does not have stays as it is, so
 * the client keeps showing "$0.0000" and "No rate card for this model" for it.
 *
 * Only numbers are written, and only into objects that are already there.
 */
export function costRepricerFactory(table) {
  const rows = table && typeof table === 'object' ? table : {};
  const done = new WeakSet();
  const PRICE_FIELDS = ['inputPricePerMillionTokens', 'outputPricePerMillionTokens', 'cacheReadPricePerMillionTokens'];
  // Each category of a section, and which price it is paid at (0 input, 1 output, 2 cache read).
  // Input does not include the tokens read from the cache. Output includes thinking and response.
  const CATEGORIES = [
    ['input', 0],
    ['cacheRead', 2],
    ['output', 1],
    ['thinking', 1],
    ['response', 1],
  ];

  /** A token count or a price as a number that is safe to calculate with. Token counts are BigInt. */
  const count = (value) => {
    let n = 0;
    try {
      n = Number(value ?? 0);
    } catch {
      n = 0;
    }
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  /**
   * One spelling for a model, whatever the source calls it:
   * "Gemini 4 Neon (XHigh)", "gemini-4-neon", "MODEL_GOOGLE_GEMINI_4_NEON" and
   * "claude-opus-5-5@default" style names all lose their decoration here.
   */
  const keyOf = (name) => {
    if (typeof name !== 'string' || name.length > 200) return '';
    let text = name.trim().toLowerCase();
    text = text.replace(/^.*\//, '').replace(/@.*$/, '');
    for (;;) {
      const shorter = text.replace(/\s*\([^()]*\)\s*$/, '');
      if (shorter === text) break;
      text = shorter;
    }
    text = text.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return text.replace(/^model-(?:google-)?/, '').replace(/-maas$/, '');
  };

  const hasOwnPrices = (pricing) => PRICE_FIELDS.some((field) => count(pricing?.[field]) > 0);
  /** The client left this section without a cost and without prices. */
  const isEmpty = (section) =>
    Boolean(section) && typeof section === 'object' && count(section.estimatedCostUsd) === 0 && !hasOwnPrices(section.pricing);

  /** The three prices for the model of a section, or null when the table does not have the model. */
  const rateOf = (section) => {
    const pricing = section?.pricing;
    if (!pricing || typeof pricing !== 'object' || hasOwnPrices(pricing)) return null;
    const key = keyOf(pricing.modelName);
    const row = key && Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null;
    if (!Array.isArray(row) || row.length !== 3) return null;
    return row.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0) ? row : null;
  };

  const tokensOf = (section) => CATEGORIES.map(([name]) => count(section?.[name]?.tokens));
  const usd = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const sameMain = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

  /** Write the cost of every category, and the total: input + cache read + output. */
  function writeCosts(section, costs) {
    CATEGORIES.forEach(([name], i) => {
      const category = section[name];
      if (category && typeof category === 'object') category.estimatedCostUsd = usd(costs[i]);
    });
    const output = section.output ? costs[2] : costs[3] + costs[4];
    section.estimatedCostUsd = usd(costs[0] + costs[1] + output);
  }

  function writePrices(section, rate, estimated) {
    const pricing = section.pricing;
    if (!rate || !pricing || typeof pricing !== 'object') return;
    pricing.inputPricePerMillionTokens = rate[0];
    pricing.outputPricePerMillionTokens = rate[1];
    pricing.cacheReadPricePerMillionTokens = rate[2];
    pricing.isEstimated = Boolean(estimated);
  }

  const costsAt = (tokens, rate) => CATEGORIES.map(([, price], i) => (tokens[i] * rate[price]) / 1e6);

  /** Fill one section from its own token counts. Returns its costs, or null when it was left alone. */
  function fill(section) {
    if (!isEmpty(section)) return null;
    const rate = rateOf(section);
    if (!rate) return null;
    const costs = costsAt(tokensOf(section), rate);
    writeCosts(section, costs);
    writePrices(section, rate, false);
    return costs;
  }

  function reprice(summary) {
    if (!summary || typeof summary !== 'object' || done.has(summary)) return summary;
    done.add(summary);

    // One entry for each execution: the cost of that turn, of its subagents, and the total of
    // the conversation up to that point.
    const steps = [];
    const turnCosts = summary.turnCosts && typeof summary.turnCosts === 'object' ? summary.turnCosts : {};
    for (const id of Object.keys(turnCosts)) {
      const entry = turnCosts[id];
      if (!entry || typeof entry !== 'object') continue;
      const total = entry.cumulativeTotal;
      const step = {
        total,
        open: isEmpty(total),
        ownRate: rateOf(total),
        totalTokens: tokensOf(total),
        rate: rateOf(entry.turn),
        turnTokens: tokensOf(entry.turn),
        subTokens: tokensOf(entry.subagent),
      };
      step.turnCosts = fill(entry.turn);
      step.subCosts = fill(entry.subagent);
      steps.push(step);
    }

    // A conversation can change its model, and a running total carries one model only. So a
    // running total is the sum of the steps before it, each at the prices of its own model.
    // The map has no order; the totals grow, so their size gives the order.
    const size = (tokens) => tokens[0] + tokens[1] + tokens[2];
    steps.sort((a, b) => size(a.totalTokens) - size(b.totalTokens));
    let before = [0, 0, 0, 0, 0];
    const sum = [0, 0, 0, 0, 0];
    let estimated = false;
    const add = (costs) => costs.forEach((cost, i) => (sum[i] += cost));
    for (const step of steps) {
      if (!step.total || typeof step.total !== 'object') continue;
      const grown = step.totalTokens.map((n, i) => Math.max(0, n - before[i]));
      const both = step.turnTokens.map((n, i) => n + step.subTokens[i]);
      if (step.turnCosts && sameMain(grown, step.turnTokens)) {
        add(step.turnCosts);
      } else if (step.turnCosts && sameMain(grown, both)) {
        // The subagents of a model without a price add nothing, as in their own row.
        add(step.turnCosts);
        if (step.subCosts) add(step.subCosts);
      } else if (step.rate) {
        // The growth is not this turn alone (subagents of another model, or older turns that
        // are no longer listed). It is paid at the prices of the model of this turn.
        add(costsAt(grown, step.rate));
        estimated = true;
      }
      before = step.totalTokens;
      if (step.open) {
        writeCosts(step.total, sum);
        writePrices(step.total, step.ownRate, estimated);
      }
    }

    // Each subagent has a model of its own. Measured on 2.35.1: the turns above do not hold
    // the subagents; they come in this list, in a sum without a model, and in the grand total.
    const subagents = summary.subagentCosts && typeof summary.subagentCosts === 'object' ? summary.subagentCosts : {};
    const listedTokens = [0, 0, 0, 0, 0];
    const listedCosts = [0, 0, 0, 0, 0];
    for (const id of Object.keys(subagents)) {
      tokensOf(subagents[id]).forEach((n, i) => (listedTokens[i] += n));
      const costs = fill(subagents[id]);
      if (costs) costs.forEach((cost, i) => (listedCosts[i] += cost));
    }

    const total = summary.total;
    if (total && typeof total === 'object') {
      // All subagents together: the sum of the list, when the list explains its tokens.
      const all = total.subagent;
      const allTokens = tokensOf(all);
      let allCosts = null;
      if (isEmpty(all)) {
        if (rateOf(all)) allCosts = fill(all);
        else if (size(allTokens) > 0 && sameMain(allTokens, listedTokens)) {
          writeCosts(all, listedCosts);
          allCosts = listedCosts;
        }
      }

      // All turns of the main agent together.
      const main = total.turn;
      if (isEmpty(main)) {
        if (steps.length > 0 && sameMain(tokensOf(main), before)) {
          writeCosts(main, sum);
          writePrices(main, rateOf(main), estimated);
        } else {
          fill(main);
        }
      }

      // Everything: the turns of the main agent and the subagents.
      const grand = total.cumulativeTotal;
      if (isEmpty(grand)) {
        const rate = rateOf(grand);
        const tokens = tokensOf(grand);
        if (steps.length === 0 && size(allTokens) === 0) {
          fill(grand);
        } else {
          const withSubagents = before.map((n, i) => n + allTokens[i]);
          if (sameMain(tokens, before)) {
            // The running totals already hold everything.
          } else if (sameMain(tokens, withSubagents)) {
            if (allCosts) add(allCosts);
          } else if (rate) {
            add(costsAt(tokens.map((n, i) => Math.max(0, n - before[i])), rate));
            estimated = true;
          }
          writeCosts(grand, sum);
          writePrices(grand, rate, estimated);
        }
      }
    }
    return summary;
  }

  // A mistake here must never keep the summary from reaching the page.
  function safeReprice(summary) {
    try {
      return reprice(summary);
    } catch (error) {
      try {
        console.error('[agy-plus] the costs were not filled in:', error);
      } catch {
        // nothing else to do
      }
      return summary;
    }
  }
  safeReprice.keyOf = keyOf;
  return safeReprice;
}

/** One spelling for a model name. The same function runs in the page and in the daemon. */
export const modelKey = costRepricerFactory({}).keyOf;

/** The fixed words in the middle of the place where the summary enters the page state. */
const COST_MARKER = '.costSummary!==void 0&&(';

/**
 * Every place of the form `X.costSummary!==void 0&&(Y.costSummary=X.costSummary)`.
 * The fixed words are searched for first, and the two names are read next to them: a
 * pattern that starts with a free name takes seconds over a script of this size.
 */
function costPlaces(source) {
  const places = [];
  const nameBefore = new RegExp(`(${IDENT})$`);
  const tail = new RegExp(`^(${IDENT})\\.costSummary=(${IDENT})\\.costSummary\\)`);
  for (let at = source.indexOf(COST_MARKER); at !== -1; at = source.indexOf(COST_MARKER, at + 1)) {
    const from = nameBefore.exec(source.slice(Math.max(0, at - 60), at));
    const rest = tail.exec(source.slice(at + COST_MARKER.length, at + COST_MARKER.length + 200));
    if (!from || !rest || rest[2] !== from[1]) continue;
    const start = at - from[1].length;
    places.push({ start, end: at + COST_MARKER.length + rest[0].length, from: from[1], to: rest[1] });
  }
  return places;
}


/** Is `table` { modelKey: [input, output, cacheRead] } and nothing else? It is written into the script. */
export function isPriceTable(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) return false;
  const entries = Object.entries(table);
  if (entries.length === 0 || entries.length > 5000) return false;
  return entries.every(
    ([key, row]) =>
      /^[a-z0-9][a-z0-9-]{0,99}$/.test(key) &&
      Array.isArray(row) &&
      row.length === 3 &&
      row.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e6)
  );
}

/**
 * Put the call that fills in the costs around the place where the summary enters the page state.
 * @returns {{ ok: true, source: string } | { ok: false, reason: string }}
 */
export function patchCostSummary(source, table) {
  if (!isPriceTable(table)) return { ok: false, reason: 'there is no price list yet' };
  const places = costPlaces(source);
  if (places.length !== 1) return { ok: false, reason: `the place for the costs was found ${places.length} times, not once` };
  const { start, end, from, to } = places[0];
  // The function is made once for each page load. A failure while it is made leaves the summary as it is.
  const call =
    '(globalThis.__agyPlusCost||(globalThis.__agyPlusCost=(()=>{try{return(' +
    costRepricerFactory.toString() +
    `)(${JSON.stringify(table)})}catch(e){try{console.error("[agy-plus]",e)}catch(_){}return a=>a}})()))`;
  const replacement = `${from}.costSummary!==void 0&&(${to}.costSummary=${call}(${from}.costSummary))`;
  return { ok: true, source: source.slice(0, start) + replacement + source.slice(end) };
}

/** The text that replaces the anchor. A failure while the page loads leaves the place empty, as before. */
export function indicatorReplacement(names) {
  return (
    'contextUsageIndicator:(()=>{try{return{Indicator:(' +
    indicatorFactory.toString() +
    `)(${names.react},${names.stateHook})}}catch(e){try{console.error("[agy-plus]",e)}catch(_){}return void 0}})(),`
  );
}

/** The names of the changes, as the catalog spells them in "uiPatch". */
export const PART_INDICATOR = 'contextUsageIndicator';
export const PART_COSTS = 'costPrices';
export const PART_L10N = 'l10n';
/** The page of agy-plus in the settings. It belongs to no entry of the catalog. */
export const PART_SETTINGS = 'settingsPage';

function patchIndicator(source) {
  const first = source.indexOf(INDICATOR_ANCHOR);
  if (first === -1) return { ok: false, reason: 'the place for the indicator was not found' };
  if (source.indexOf(INDICATOR_ANCHOR, first + 1) !== -1) return { ok: false, reason: 'the place for the indicator was found more than once' };
  const names = detectNames(source);
  if (!names.ok) return { ok: false, reason: names.reason };
  return {
    ok: true,
    source: source.slice(0, first) + indicatorReplacement(names) + source.slice(first + INDICATOR_ANCHOR.length),
    names: { react: names.react, stateHook: names.stateHook },
  };
}

/**
 * Change the page script.
 * @param {string} source
 * @param {object} [options]
 * @param {boolean} [options.indicator=true] Add the context usage indicator.
 * @param {object|null} [options.prices=null] Fill in the costs from this price table.
 * @param {object|null} [options.l10n=null]   Show the page in Chinese with this word list.
 * @param {{ api: string }|null} [options.settings=null] Add the page of agy-plus to the settings.
 * @param {boolean} [options.check=true]     Parse the result before it is returned.
 * @returns {{ ok: boolean, source: string, reason?: string, names?: object, parts: object }}
 *          `ok` is true when every change that was asked for was made. `parts` says for each
 *          of them { ok, reason }. One change that cannot be made does not stop the others.
 *          `source` holds the changes that were made; it is the unchanged input when there are none.
 */
export function patchMainJs(source, { check = true, indicator = true, prices = null, l10n = null, settings = null } = {}) {
  if (typeof source !== 'string') return { ok: false, source, reason: 'not a script', parts: {} };
  const steps = [];
  if (settings) steps.push([PART_SETTINGS, (text) => patchSettingsPage(text, settings)]);
  if (indicator) steps.push([PART_INDICATOR, (text) => patchIndicator(text)]);
  if (prices) steps.push([PART_COSTS, (text) => patchCostSummary(text, prices)]);
  // The translator goes to the end, so it comes last.
  if (l10n) steps.push([PART_L10N, (text) => patchL10n(text, l10n)]);

  // Parse only. A script that does not parse would leave the window blank.
  const parseError = (text) => {
    try {
      new vm.Script(text, { filename: 'main.js' });
      return null;
    } catch (err) {
      return `the changed script does not parse: ${err?.message || err}`;
    }
  };
  const apply = (checkEach) => {
    const parts = {};
    let patched = source;
    let names;
    for (const [part, change] of steps) {
      const result = change(patched);
      const reason = result.ok ? (checkEach ? parseError(result.source) : null) : result.reason;
      parts[part] = reason ? { ok: false, reason } : { ok: true, reason: null };
      if (reason) continue;
      patched = result.source;
      if (result.names) names = result.names;
    }
    return { parts, patched, names };
  };

  // The script is large, so it is parsed once with every change in it. Only when that fails
  // is each change parsed by itself, to keep the ones that are good.
  let done = apply(false);
  if (check && done.patched !== source && parseError(done.patched)) done = apply(true);
  const failed = Object.values(done.parts).filter((part) => !part.ok);
  const out = { ok: failed.length === 0, source: done.patched, parts: done.parts };
  if (failed.length > 0) out.reason = failed.map((part) => part.reason).join('; ');
  if (done.names) out.names = done.names;
  return out;
}
