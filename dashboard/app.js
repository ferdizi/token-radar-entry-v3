// Token Launch Radar v3 — dashboard.
// Renders the board, the detail page, the live/set-aside tabs and the
// Method & backtest tab from window.RADAR (data.js). No network, no fetch:
// every number on the page comes from the program's own output.
// Capital and airdrop-share filters recompute the farm economics live from
// each row's TVL, implied value, fees and hold (the same formulas the
// program used), so the NET column, the verdicts and the counts always agree.
(function () {
  'use strict';
  const R = window.RADAR;
  const BT = R.backtest;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- formatting ----------
  const m$ = (n) => {
    const a = Math.abs(n);
    const s = n < 0 ? '-' : '';
    if (a >= 1e9) return s + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + '$' + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1000) return s + '$' + Math.round(a).toLocaleString('en-US');
    return s + '$' + a.toFixed(2);
  };
  const d$ = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  const sd$ = (n) => (n < 0 ? '-$' : n > 0 ? '+$' : '$') + Math.abs(n).toFixed(2);
  const pct = (n) => (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  const num = (n) => Number(n).toLocaleString('en-US');
  const ageStr = (d) => {
    if (d === null || d === undefined) return '—';
    if (d < 365) return (d / 30.4).toFixed(1) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  };

  // ---------- farm economics, recomputed live ----------
  // Same formulas as lib/farm.ts: slice, T-bill, net, $/h, verdict.
  function farmAt(r, C, sh) {
    const slice = (C / (r.tvl_usd + C)) * sh * r.implied_value_usd;
    const tbill = C * 0.04 * (r.hold_days / 365);
    const net = slice - r.fees_usd - tbill;
    const perHour = r.work_hours > 0 ? net / r.work_hours : 0;
    const verdict = net > 0 ? 'FARM' : slice > r.fees_usd ? 'THIN' : 'SKIP';
    const sliceLow = (C / (r.tvl_usd + C)) * sh * (r.implied_value_usd * BT.bandLow);
    const robust = sliceLow - r.fees_usd - tbill > 0;
    return { slice, tbill, net, perHour, verdict, robust };
  }

  // ---------- state ----------
  const state = {
    tab: 'board',
    q: '', cat: '', chain: '', tier: 'all', verdict: 'all',
    minTvl: 0, capital: 1000, share: 0.1, trend: 'all',
    detail: null, hideSummary: false,
  };
  const CAPS = [150, 1000, 10000];
  const SHARES = [0.05, 0.1, 0.2];
  const bySlug = new Map(R.rows.map((r) => [r.slug, r]));
  const watchSet = new Set(R.watchlist);
  const cats = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();

  // ---------- hash routing (for screenshots) ----------
  function readHash() {
    const h = location.hash.replace(/^#/, '');
    if (h === 'method') { state.tab = 'method'; state.detail = null; }
    else if (h === 'farm') { state.tab = 'board'; state.detail = null; state.verdict = 'FARM'; }
    else if (h.startsWith('detail-')) { state.detail = h.slice(7); state.tab = 'board'; }
    else { state.tab = 'board'; state.detail = null; }
  }

  // ---------- charts (pure SVG) ----------
  function log10(n) { return Math.log10(Math.max(1, n)); }
  function scatterSVG(w, h, highlight) {
    const pts = R.rows;
    const live = R.liveAll || R.live;
    const all = pts.map((r) => ({ x: r.tvl_usd, y: r.implied_value_usd, w: watchSet.has(r.slug), r }));
    const lv = live.map((p) => ({ x: p.tvl_usd, y: p.mcap_usd, w: false, live: true }));
    const xs = all.concat(lv).map((p) => log10(p.x));
    const ys = all.concat(lv).map((p) => log10(p.y));
    const x0 = Math.min(...xs) - 0.15, x1 = Math.max(...xs) + 0.15;
    const y0 = Math.min(...ys) - 0.15, y1 = Math.max(...ys) + 0.15;
    const X = (v) => 34 + ((log10(v) - x0) / (x1 - x0)) * (w - 44);
    const Y = (v) => (h - 22) - ((log10(v) - y0) / (y1 - y0)) * (h - 30);
    let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Implied value against TVL">`;
    s += `<line x1="34" y1="${h - 22}" x2="${w - 10}" y2="${h - 22}" stroke="#dfe7df"/><line x1="34" y1="8" x2="34" y2="${h - 22}" stroke="#dfe7df"/>`;
    // fitted line: implied = TVL x overall multiple (the size curve before family offsets)
    const om = R.model.overall_multiple;
    s += `<line x1="${X(Math.pow(10, x0))}" y1="${Y(Math.pow(10, x0) * om)}" x2="${X(Math.pow(10, x1))}" y2="${Y(Math.pow(10, x1) * om)}" stroke="#1a7a4c" stroke-width="1.5" stroke-dasharray="4 3"/>`;
    for (const p of lv) s += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.2" fill="#9aa79d" opacity="0.7"/>`;
    for (const p of all) {
      const hl = highlight && p.r.slug === highlight;
      s += `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${hl ? 5 : p.w ? 3 : 2.2}" fill="${hl ? '#b45309' : p.w ? '#1a7a4c' : '#c8d2c8'}" ${hl ? 'stroke="#7c2d12" stroke-width="1.5"' : ''}/>`;
    }
    s += `<text x="34" y="${h - 8}" font-size="10" fill="#5c6b60">TVL (log)</text><text x="4" y="14" font-size="10" fill="#5c6b60">value (log)</text></svg>`;
    return s;
  }
  function oosSVG(w, h) {
    const pts = BT.scatter.filter((p) => p.pred > 0 && p.actual > 0);
    const xs = pts.map((p) => log10(p.pred));
    const ys = pts.map((p) => log10(p.actual));
    const x0 = Math.min(...xs) - 0.1, x1 = Math.max(...xs) + 0.1;
    const y0 = Math.min(...ys) - 0.1, y1 = Math.max(...ys) + 0.1;
    const X = (v) => 34 + ((log10(v) - x0) / (x1 - x0)) * (w - 44);
    const Y = (v) => (h - 22) - ((log10(v) - y0) / (y1 - y0)) * (h - 30);
    let s = `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Out-of-sample: predicted against real market cap">`;
    s += `<line x1="34" y1="${h - 22}" x2="${w - 10}" y2="${h - 22}" stroke="#dfe7df"/><line x1="34" y1="8" x2="34" y2="${h - 22}" stroke="#dfe7df"/>`;
    // y=x and the within-3x band
    const lo = Math.max(x0, y0), hi = Math.min(x1, y1);
    s += `<polygon points="${X(Math.pow(10, lo))},${Y(Math.pow(10, lo) * 3)} ${X(Math.pow(10, hi))},${Y(Math.pow(10, hi) * 3)} ${X(Math.pow(10, hi))},${Y(Math.pow(10, hi) / 3)} ${X(Math.pow(10, lo))},${Y(Math.pow(10, lo) / 3)}" fill="#e6f4ec"/>`;
    s += `<line x1="${X(Math.pow(10, lo))}" y1="${Y(Math.pow(10, lo))}" x2="${X(Math.pow(10, hi))}" y2="${Y(Math.pow(10, hi))}" stroke="#1a7a4c" stroke-width="1.5"/>`;
    for (const p of pts) s += `<circle cx="${X(p.pred).toFixed(1)}" cy="${Y(p.actual).toFixed(1)}" r="2.4" fill="#1a7a4c" opacity="0.75"/>`;
    s += `<text x="34" y="${h - 8}" font-size="10" fill="#5c6b60">predicted (log)</text><text x="4" y="14" font-size="10" fill="#5c6b60">real cap (log)</text></svg>`;
    return s;
  }

  // ---------- shared bits ----------
  function verdictBadge(v, robust) {
    return `<span class="badge ${v}">${v}</span>${robust ? ' <span class="badge ROBUST">ROBUST</span>' : ''}`;
  }
  function capLabel(C) { return C >= 1000 ? '$' + (C / 1000) + 'K' : '$' + C; }
  function headerHTML() {
    return `<header class="band"><div class="wrap"><div class="brand">Token Launch Radar<small>radar-2 · peer-calibrated implied value · DefiLlama snapshot ${esc(R.as_of)}</small></div><div class="meta"><b>Watchlist ${R.watchlist_size}/40 on board</b><br>Page = board.json · ${R.board_size}/${R.board_size} rows<br>${esc(R.source)}</div></div></header>`;
  }
  function footerHTML() {
    return `<footer>Implied values are this radar's own estimate from the snapshot, not a forecast that a token will launch and not a claim by make.fun. Records no token means DefiLlama carries none, not proof that none exists. Not financial advice.</footer>`;
  }
  function farmNextHTML() {
    const rows = R.rows.map((r) => ({ r, f: farmAt(r, state.capital, state.share) }))
      .sort((a, b) => b.f.perHour - a.f.perHour).slice(0, 5);
    return `<ul class="farmnext">${rows.map(({ r, f }) => `<li><span>${r.rank}. ${esc(r.name)}</span><span class="ph">${sd$(f.perHour)}/h · net ${sd$(f.net)}</span></li>`).join('')}</ul>`;
  }
  function countsHTML() {
    const c = R.farmCounts;
    return `<div class="counts">At ${capLabel(state.capital)} a plan: <b>FARM ${c.farm} · THIN ${c.thin} · SKIP ${c.skip}</b> · ${c.robust} pay even at the band's low end</div>`;
  }

  // ---------- board ----------
  function filteredRows() {
    const q = state.q.trim().toLowerCase();
    return R.rows.filter((r) => {
      if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && !r.chains.includes(state.chain)) return false;
      if (state.tier === 'watchlist' && !watchSet.has(r.slug)) return false;
      if (state.tier === 'early' && watchSet.has(r.slug)) return false;
      if (state.tier === 'sibling' && r.peer_count < 3) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (state.trend === 'gaining' && !((r.change_7d ?? 0) > 0)) return false;
      if (state.trend === 'falling' && !((r.change_7d ?? 0) < 0)) return false;
      if (state.verdict !== 'all') {
        const f = farmAt(r, state.capital, state.share);
        if (state.verdict === 'ROBUST' && !f.robust) return false;
        if (state.verdict !== 'ROBUST' && f.verdict !== state.verdict) return false;
      }
      return true;
    });
  }
  function boardHTML(rows) {
    const lo = R.backtest.bandLow, hi = R.backtest.bandHigh;
    const body = rows.map((r) => {
      const f = farmAt(r, state.capital, state.share);
      const loV = r.implied_value_usd * lo, hiV = r.implied_value_usd * hi;
      const span = hiV - loV;
      const pos = span > 0 ? Math.max(0, Math.min(1, (r.implied_value_usd - loV) / span)) : 0.5;
      return `<tr>
        <td class="num">${r.rank}</td>
        <td><a href="#detail-${r.slug}" data-detail="${r.slug}"><b>${esc(r.name)}</b></a> ${watchSet.has(r.slug) ? '<span class="badge tier">WATCH</span>' : ''}<br><small style="color:var(--mut)">${esc(r.category || '—')} · ${esc(r.chains.slice(0, 3).join(', '))}</small></td>
        <td class="num">${m$(r.tvl_usd)}</td>
        <td class="num">${r.change_7d === null ? '—' : pct(r.change_7d)}</td>
        <td class="num">${ageStr(r.age_days)}</td>
        <td class="num">${m$(r.implied_value_usd)}<div class="rangebar"><i style="left:${(pos * 100 - 18).toFixed(0)}%;width:36%"></i><b style="left:${(pos * 100).toFixed(0)}%"></b></div><small style="color:var(--mut)">${m$(loV)}–${m$(hiV)}</small></td>
        <td class="num">${d$(f.slice)}</td>
        <td class="net">${verdictBadge(f.verdict, f.robust)}<b class="${f.net < 0 ? 'neg' : ''}">${sd$(f.net)}</b><small>${sd$(f.perHour)}/h</small></td>
        <td class="farmcell">${esc(r.best_chain)} · ${esc(farmPlay(r))}<small>${d$(r.fees_usd)} fees · ${r.hold_days}d hold · ${r.work_hours}h work</small></td>
      </tr>`;
    }).join('');
    return `<table class="board"><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th class="num">No token for</th><th class="num">Implied value</th><th class="num">${capLabel(state.capital)} slice</th><th>Net of all costs · ${capLabel(state.capital)}</th><th>Farm · fees · hold</th></tr></thead><tbody>${body}</tbody></table>
    <p class="note">${rows.length} rows shown of ${R.rows.length} · slice at ${(state.share * 100).toFixed(0)}% to depositors · net = slice − fees − 4% T-bill over the hold · FARM beats all of it, THIN beats fees only, SKIP does not.</p>`;
  }
  function farmPlay(r) {
    const c = (r.category || '').toLowerCase();
    if (c.includes('curator') || c.includes('allocator')) return 'curated vault';
    if (c.includes('lend') || c.includes('cdp')) return 'supply & borrow';
    if (c.includes('dex') || c.includes('yield')) return 'liquidity pool';
    if (c.includes('bridge')) return 'bridge & use';
    if (c.includes('staking') || c.includes('restak')) return 'stake & hold';
    if (c.includes('perpetual') || c.includes('derivative')) return 'margin & volume';
    if (c.includes('prediction')) return 'market position';
    if (c.includes('rwa')) return 'mint & save';
    if (c.includes('stable')) return 'mint stable asset';
    return 'deposit & hold';
  }

  // ---------- detail page ----------
  function detailHTML(r) {
    const f = farmAt(r, state.capital, state.share);
    const peer = (R.peers || []).find((p) => p.category === r.category);
    const recompute = Math.round(r.tvl_usd * r.peer_multiple * r.growth_multiplier * r.maturity_multiplier);
    const loV = r.implied_value_usd * BT.bandLow, hiV = r.implied_value_usd * BT.bandHigh;
    const peers = (R.liveAll || R.live).filter((p) => p.category === r.category)
      .map((p) => ({ ...p, d: Math.abs(Math.log10(p.tvl_usd) - Math.log10(r.tvl_usd)) }))
      .sort((a, b) => a.d - b.d).slice(0, 5);
    const steps = r.farm_steps.map((s) => {
      const m = s.match(/^(.*) Cost: (.+)\. Time: (.+)\.?$/);
      return m ? { action: m[1], cost: m[2], time: m[3] } : { action: s, cost: '—', time: '—' };
    });
    const sensRows = [1000, 10000, 100000].map((C) => {
      const cells = [0.05, 0.1, 0.2].map((sh) => {
        const ff = farmAt(r, C, sh);
        return `<td class="num${C === state.capital && sh === state.share ? ' hl' : ''}">${sd$(ff.net)}</td>`;
      }).join('');
      return `<tr><td>${capLabel(C)}</td>${cells}</tr>`;
    }).join('');
    const verdictSentence = f.verdict === 'FARM'
      ? `FARM. At a ${(state.share * 100).toFixed(0)}% drop, it beats every cost from ${capLabel(state.capital)} of capital. Position yield is not counted; it is upside if the vault or pool pays one.`
      : f.verdict === 'THIN'
        ? `THIN. It beats the fees but not the T-bill yield the capital gives up — farm it only if you would hold the position anyway.`
        : `SKIP. At ${capLabel(state.capital)} the slice does not cover the fees — the plan costs more than the airdrop would pay. A larger capital or a bigger drop would change the answer; check the sensitivity table.`;
    return `<p class="back"><button class="link" data-back="1">← Back to the board</button></p>
    <p class="note">RANK ${r.rank} OF ${R.rows.length} · ${esc((r.category || '—').toUpperCase())} · ${esc(r.chains.join(' · '))}</p>
    <h1>${esc(r.name)} ${watchSet.has(r.slug) ? '<span class="badge tier">WATCHLIST</span>' : ''}</h1>
    <p class="lede">DefiLlama records no token for ${esc(r.name)} (no CoinGecko id, ticker or market cap) as of ${esc(R.as_of)}. A record is not proof: check its own channels before farming.</p>
    <div class="kpis">
      <div class="kpi"><h3>Implied value</h3><div class="v">${m$(r.implied_value_usd)}</div><small>P25 to P75 ${m$(loV)} to ${m$(hiV)}</small></div>
      <div class="kpi"><h3>TVL</h3><div class="v">${m$(r.tvl_usd)}</div><small>7d ${r.change_7d === null ? '—' : pct(r.change_7d)}</small></div>
      <div class="kpi"><h3>No token for</h3><div class="v">${ageStr(r.age_days)}</div><small>tracked since ${esc(r.listed_at || '—')}</small></div>
      <div class="kpi"><h3>${capLabel(state.capital)} slice</h3><div class="v">${d$(f.slice)}</div><small>at ${(state.share * 100).toFixed(0)}% to depositors</small></div>
      <div class="kpi"><h3>Net of all costs</h3><div class="v" style="color:${f.net < 0 ? 'var(--red)' : 'var(--acc)'}">${sd$(f.net)}</div><small>${f.verdict}${f.robust ? ' · ROBUST' : ''}, ${d$(r.fees_usd)} fees + ${d$(f.tbill)} T-bill</small></div>
    </div>
    <div class="cols"><div>
      <div class="card"><h2>How ${m$(r.implied_value_usd)} is built</h2>
      <table class="mini"><tbody>
      <tr><td>Size curve</td><td class="num">${m$(r.tvl_usd)} × ${r.peer_multiple}</td><td>TVL times the peer multiple — the curve before family offsets.</td></tr>
      <tr><td>Family / peer multiple</td><td class="num">×${r.peer_multiple}</td><td>${esc(r.category || '—')}: ${peer ? `median of ${peer.peers} traded tokens (${peer.source === 'category' ? 'category' : 'overall, too few peers'})` : 'overall median'}.</td></tr>
      <tr><td>Growth</td><td class="num">×${r.growth_multiplier}</td><td>7d TVL ${r.change_7d === null ? 'unreported' : pct(r.change_7d)}, clamped −60/+120 and carried at half weight.</td></tr>
      <tr><td>Seasoning / maturity</td><td class="num">×${r.maturity_multiplier}</td><td>${r.age_days === null ? 'No listing date' : r.age_days + ' days'} on record with no token, 0.6 to 1.0 over 1,095 days.</td></tr>
      <tr><td>Sibling</td><td class="num">×1.00</td><td>No sibling adjustment — radar-2 prices on the peer multiple alone.</td></tr>
      <tr><td><b>Implied value</b></td><td class="num"><b>${m$(r.implied_value_usd)}</b></td><td>P25 to P75 ${m$(loV)} to ${m$(hiV)}, the blind residual range.</td></tr>
      </tbody></table>
      <p class="proof">Recomputed on this page: ${m$(r.tvl_usd)} × ${r.peer_multiple} × ${r.growth_multiplier} × ${r.maturity_multiplier} = ${m$(recompute)}; board.json carries ${m$(r.implied_value_usd)} at rank ${r.rank} (the gap is rounding in the printed factors).</p></div>
      <div class="card"><h2>Against traded peers</h2>
      ${scatterSVG(560, 240, r.slug)}
      <table class="mini"><thead><tr><th>Nearest trading tokens by TVL</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Mcap/TVL</th></tr></thead><tbody>
      ${peers.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${m$(p.tvl_usd)}</td><td class="num">${m$(p.mcap_usd)}</td><td class="num">${(p.mcap_usd / p.tvl_usd).toFixed(3)}</td></tr>`).join('')}
      </tbody></table></div>
    </div><div>
      <div class="card"><h2>Farm plan · ${esc(farmPlay(r))} on ${esc(r.best_chain)} · ${capLabel(state.capital)} for ${r.hold_days} days</h2>
      <table class="mini farmplan"><thead><tr><th>#</th><th>Step</th><th class="num">Cost</th><th class="num">Time</th></tr></thead><tbody>
      ${steps.map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.action)}</td><td class="num">${esc(s.cost)}</td><td class="num">${esc(s.time)}</td></tr>`).join('')}
      </tbody></table>
      <p style="font-size:14px">Slice ${d$(f.slice)} · Fees −${d$(r.fees_usd)} · T-bill forgone −${d$(f.tbill)} · <b>Net ${sd$(f.net)}</b> · Work ${r.work_hours}h · <b>Per hour ${sd$(f.perHour)}</b></p>
      <p>${verdictSentence}</p>
      <h3>Net at — sensitivity (airdrop share × capital)</h3>
      <table class="mini"><thead><tr><th></th><th class="num">5% share</th><th class="num">10% share</th><th class="num">20% share</th></tr></thead><tbody>${sensRows}</tbody></table>
      <p class="note">Highlighted cell is the current plan (${capLabel(state.capital)} at ${(state.share * 100).toFixed(0)}%). Fees are fixed gas; only the slice and the T-bill move with capital.</p>
      <p class="note">Break-even implied value at this plan: ${m$(r.breakeven_usd)} — below it, the net is negative.</p></div>
    </div></div>`;
  }

  // ---------- live / set-aside tabs ----------
  function liveHTML() {
    const rows = R.liveAll || R.live;
    return `<h1>Token trades — ${rows.length} protocols</h1><p class="lede">These already trade, so the board shows the market's own value, never a model's. The radar prices the pre-token board against them.</p>
    <table class="board"><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Mcap/TVL</th><th class="num">7d</th></tr></thead><tbody>
    ${rows.slice(0, 200).map((p, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(p.name)}</b><br><small style="color:var(--mut)">${esc(p.category || '—')} · ${esc(p.chains.slice(0, 3).join(', '))}</small></td><td class="num">${m$(p.tvl_usd)}</td><td class="num">${m$(p.mcap_usd)}</td><td class="num">${(p.mcap_usd / p.tvl_usd).toFixed(3)}</td><td class="num">${p.change_7d === null ? '—' : pct(p.change_7d)}</td></tr>`).join('')}
    </tbody></table><p class="note">Showing the top 200 by market cap of ${rows.length}.</p>`;
  }
  function setAsideHTML() {
    const rows = R.setAside || [];
    return `<h1>Set aside — ${rows.length} protocols</h1><p class="lede">Pre-token protocols the board does not rank, and why. The watchlist is the floor, never the ceiling — but a protocol that is an exchange, a versioned listing, or a wrapped product of a token that already trades is set aside, not ranked.</p>
    <table class="board"><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th>Reason set aside</th></tr></thead><tbody>
    ${rows.map((p, i) => `<tr><td class="num">${i + 1}</td><td><b>${esc(p.name)}</b><br><small style="color:var(--mut)">${esc(p.category || '—')} · ${esc(p.chains.slice(0, 3).join(', '))}</small></td><td class="num">${m$(p.tvl_usd)}</td><td>${esc(p.reason)}</td></tr>`).join('')}
    </tbody></table>`;
  }

  // ---------- method tab ----------
  function methodHTML() {
    const peers = R.peers || [];
    const peerRows = peers.map((p) => `<tr><td>${esc(p.category)}</td><td class="num">${p.peers}</td><td class="num">${p.median.toFixed(4)}</td><td class="num">${p.multiple.toFixed(4)}</td><td>${p.source === 'category' ? 'category' : 'overall (too few peers)'}</td></tr>`).join('');
    const ts = BT.timeSplit;
    const ts2 = BT.timeSplit2;
    return `<div class="method"><h1>Method and backtest</h1>
    <p class="lede">How the radar is built, and how well the model would have priced the tokens that already trade — measured, not asserted.</p>
    <h2>Universe</h2>
    <p>${num(758)} protocols at or above $5M TVL in the snapshot. A protocol is pre-token when DefiLlama records no market cap, no CoinGecko id and no symbol. The watchlist is the 40 of them at or above the $${num(R.floor_usd)} floor that are not a wrapped, staked or bridged product, not a bridge or staking category, not a versioned listing and not an exchange name. That leaves <b>${R.board_size} rows</b> on the board — all 40 watchlist names plus the early protocols below the floor, by TVL — and ${R.setAside ? R.setAside.length : 0} set aside with their reason on the Set aside tab.</p>
    <h2>Curve</h2>
    <p class="formula">value = TVL × peer_multiple × (1 + clamp(7d, −60, +120)/100 × 0.5) × (0.6 + min(age, 1095)/1095 × 0.4)</p>
    <p>The peer multiple is the category's median mcap/TVL when the category has at least ${3} live peers, else the overall median (${R.model.overall_multiple}), clamped to ${R.model.clamp_low}–${R.model.clamp_high}. Bigger protocols do carry lower mcap/TVL ratios in this snapshot (median falls from 0.31 at $5–50M to 0.03 above $1B), but the pattern is mostly the category mix, so no size factor is applied. No protocol name is ever special-cased.</p>
    <h2>Family — peer multiples by category</h2>
    <table class="mini"><thead><tr><th>Category</th><th class="num">Live peers</th><th class="num">Median mcap/TVL</th><th class="num">Multiple used</th><th>Source</th></tr></thead><tbody>${peerRows}</tbody></table>
    <h2>Growth and seasoning</h2>
    <p>Growth carries the 7-day TVL change at half weight, clamped to −60/+120% so one hot week cannot dominate. Seasoning carries time with no token, 0.6 to 1.0 over 1,095 days. The honest factor check: the curve-only blind residual correlates r = ${BT.corrGrowth.toFixed(2)} with growth and r = ${BT.corrSeasoning.toFixed(2)} with seasoning, so the snapshot cannot confirm either. They stay small; size and family carry the value.</p>
    <h2>Tests — leave-one-out on ${BT.n} traded tokens</h2>
    <table class="mini"><thead><tr><th>Test</th><th class="num">Median miss</th><th class="num">Within 3×</th><th class="num">Within 10×</th></tr></thead><tbody>
    <tr><td><b>radar-2 (leave-one-out)</b></td><td class="num"><b>×${BT.looMedian.toFixed(2)}</b></td><td class="num">${(BT.looWithin3 * 100).toFixed(0)}%</td><td class="num">${(BT.looWithin10 * 100).toFixed(0)}%</td></tr>
    <tr><td>Flat mcap/TVL (one overall multiple)</td><td class="num">×${BT.flatMedian.toFixed(2)}</td><td class="num">${(BT.flatWithin3 * 100).toFixed(0)}%</td><td class="num">${(BT.flatWithin10 * 100).toFixed(0)}%</td></tr>
    ${ts ? `<tr><td>Time split — fit pre-2024, test ${ts.nTest} newer (model)</td><td class="num">×${ts.modelMedian.toFixed(2)}</td><td class="num">${(ts.modelWithin3 * 100).toFixed(0)}%</td><td class="num">—</td></tr>
    <tr><td>Time split — fit pre-2024, test ${ts.nTest} newer (flat)</td><td class="num">×${ts.flatMedian.toFixed(2)}</td><td class="num">${(ts.flatWithin3 * 100).toFixed(0)}%</td><td class="num">—</td></tr>` : ''}
    ${ts2 ? `<tr><td>Time split — fit pre-2025, test ${ts2.nTest} newer (model)</td><td class="num">×${ts2.modelMedian.toFixed(2)}</td><td class="num">${(ts2.modelWithin3 * 100).toFixed(0)}%</td><td class="num">—</td></tr>
    <tr><td>Time split — fit pre-2025, test ${ts2.nTest} newer (flat)</td><td class="num">×${ts2.flatMedian.toFixed(2)}</td><td class="num">${(ts2.flatWithin3 * 100).toFixed(0)}%</td><td class="num">—</td></tr>` : ''}
    </tbody></table>
    <p class="note">Blind miss, each token left out: <b>×${BT.looMedian.toFixed(2)} vs ×${BT.flatMedian.toFixed(2)} flat</b>. Time split, fit pre-2024, test newer: <b>×${ts ? ts.modelMedian.toFixed(2) : '—'} vs ×${ts ? ts.flatMedian.toFixed(2) : '—'} flat</b>. Within 3× of the real cap: <b>${(BT.looWithin3 * 100).toFixed(0)}% vs ${(BT.flatWithin3 * 100).toFixed(0)}% flat</b>.</p>
    <h3>Ablation — median miss with one ingredient removed</h3>
    <table class="mini"><tbody>
    <tr><td>Full radar-2</td><td class="num"><b>×${BT.ablationFull.toFixed(2)}</b></td></tr>
    <tr><td>Without momentum (growth weight 0)</td><td class="num">×${BT.ablationNoMomentum.toFixed(2)}</td></tr>
    <tr><td>Without category (one overall multiple)</td><td class="num">×${BT.ablationNoCategory.toFixed(2)}</td></tr>
    <tr><td>Peer multiple alone (no growth, no maturity)</td><td class="num">×${BT.ablationPeerOnly.toFixed(2)}</td></tr>
    </tbody></table>
    <h3>Honesty band</h3>
    <p>The LOO log-residuals run P25 to P75 at <b>×${BT.bandLow.toFixed(2)} to ×${BT.bandHigh.toFixed(2)}</b> of the fitted value. Every implied value on the board carries that band, and a row is ROBUST only when it still pays at the band's low end.</p>
    <h3>Out-of-sample — predicted against real market cap</h3>
    ${oosSVG(720, 300)}
    <p class="note">Each dot is a traded token priced as if it had none (leave-one-out). The green band is within 3× of the real cap; the line is exact.</p>
    <h3>Comparison</h3>
    <table class="mini"><thead><tr><th>Model</th><th class="num">Median miss</th><th class="num">Within 3×</th></tr></thead><tbody>
    ${BT.table.map((t) => `<tr><td>${esc(t.label)}</td><td class="num">×${t.median.toFixed(2)}</td><td class="num">${(t.within3 * 100).toFixed(0)}%</td></tr>`).join('')}
    </tbody></table>
    <h2>Farm plans</h2>
    <p>Eight steps per row: a fresh wallet, the category's play, a weekly qualifying action, the hold, a claim check, an exit plan and a farm log, each with dollars and minutes. Gas and bridge come from the plan's own costs; the plan runs on the protocol's first chain. The slice is capital/(TVL + capital) × airdrop share × implied value; the net subtracts every fee and the 4% T-bill yield the capital gives up over the hold. FARM beats all of it, THIN beats fees only, SKIP does not.</p>
    <h2>Limits</h2>
    <p>One day of DefiLlama data. It does not say whether or when a token launches. Read the board as a ranking and an order of magnitude, not a price.</p></div>`;
  }

  // ---------- main render ----------
  function render() {
    const el = $('#board');
    el.setAttribute('aria-busy', 'false');
    let html = headerHTML() + '<div class="wrap">';
    if (state.detail) {
      const r = bySlug.get(state.detail);
      html += r ? detailHTML(r) : `<p>Unknown protocol: ${esc(state.detail)}</p><p><button class="link" data-back="1">← Back to the board</button></p>`;
      html += footerHTML() + '</div>';
      el.innerHTML = html;
      return;
    }
    // headline + top panels (board + method + live + set-aside all show them)
    const best = R.bestPerHour;
    html += `<h1>${R.board_size} protocols record no token. Here is what each launch would be worth, and how to farm it.</h1>
    <p class="lede">Each value is read off a curve fitted to the tokens that already trade. Every row has a farm plan, netted against the T-bill yield the capital gives up. Total implied value ${m$(R.total_implied_usd)}; largest category ${esc(R.top_category)}.</p>`;
    if (!state.hideSummary) {
      html += `<div class="panels">
      <div class="panel"><h2>How a launch is priced</h2>
        <div class="formula">value = TVL × peer_multiple × (1 + clamp(7d, −60, +120)/100 × 0.5) × (0.6 + min(age, 1095)/1095 × 0.4)</div>
        <p class="bt">Blind miss, each token left out: <b>×${BT.looMedian.toFixed(2)} vs ×${BT.flatMedian.toFixed(2)} flat</b></p>
        <p class="bt">Time split, fit pre-2024, test newer: <b>×${BT.timeSplit ? BT.timeSplit.modelMedian.toFixed(2) : '—'} vs ×${BT.timeSplit ? BT.timeSplit.flatMedian.toFixed(2) : '—'} flat</b></p>
        <p class="bt">Within 3× of the real cap: <b>${(BT.looWithin3 * 100).toFixed(0)}% vs ${(BT.flatWithin3 * 100).toFixed(0)}% flat</b></p>
        ${best ? `<p class="hook">Best on the watchlist: <b>${esc(best.name)} ${sd$(best.per_hour_usd)}/h</b> (net ${sd$(best.net_usd)})</p>` : ''}
      </div>
      <div class="panel"><h2>Traded tokens and the curve</h2>${scatterSVG(360, 120)}
        <p class="note">Grey: ${num((R.liveAll || R.live).length)} traded tokens. Green: the board. Line: the size curve.</p></div>
      <div class="panel"><h2>Farm next</h2><p class="note" style="margin:0">Top 5 by net per hands-on hour, at ${capLabel(state.capital)} a plan.</p>${farmNextHTML()}${countsHTML()}</div>
      </div>`;
    }
    const tabs = [
      ['board', `No token yet ${R.board_size}`],
      ['live', `Token trades ${(R.liveAll || R.live).length}`],
      ['setaside', `Set aside ${R.setAside ? R.setAside.length : 0}`],
      ['method', 'Method and backtest'],
    ];
    html += `<div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button class="tab" role="tab" aria-selected="${state.tab === k}" data-tab="${k}">${label}</button>`).join('')}</div>`;
    if (state.tab === 'method') {
      html += methodHTML();
    } else if (state.tab === 'live') {
      html += liveHTML();
    } else if (state.tab === 'setaside') {
      html += setAsideHTML();
    } else {
      html += `<div class="filters">
        <label>Search <input id="f-q" type="search" value="${esc(state.q)}" placeholder="name or slug"></label>
        <label>Category <select id="f-cat"><option value="">All</option>${cats.map((c) => `<option ${state.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Chain <select id="f-chain"><option value="">All</option>${chains.map((c) => `<option ${state.chain === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label>Tier <select id="f-tier">${[['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['sibling', 'Sibling-linked']].map(([v, l]) => `<option value="${v}" ${state.tier === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Verdict <select id="f-verdict">${[['all', 'All'], ['ROBUST', 'ROBUST'], ['FARM', 'FARM'], ['THIN', 'THIN'], ['SKIP', 'SKIP']].map(([v, l]) => `<option value="${v}" ${state.verdict === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Min TVL <select id="f-tvl">${[[0, 'Any'], [5000000, '$5M'], [50000000, '$50M'], [1000000000, '$1B']].map(([v, l]) => `<option value="${v}" ${state.minTvl === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Capital <select id="f-cap">${CAPS.map((c) => `<option value="${c}" ${state.capital === c ? 'selected' : ''}>${capLabel(c)}</option>`).join('')}</select></label>
        <label>Airdrop share <select id="f-share">${SHARES.map((s) => `<option value="${s}" ${state.share === s ? 'selected' : ''}>${(s * 100).toFixed(0)}%</option>`).join('')}</select></label>
        <label>7-day <select id="f-trend">${[['all', 'All'], ['gaining', 'Gaining'], ['falling', 'Falling']].map(([v, l]) => `<option value="${v}" ${state.trend === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <span class="sp"></span>
        <span class="n" id="f-count"></span>
        <button class="link" id="f-hide">${state.hideSummary ? 'Show summary' : 'Hide summary'}</button>
        <button class="link" id="f-reset">Reset</button>
      </div>`;
      const rows = filteredRows();
      html += boardHTML(rows);
    }
    html += footerHTML() + '</div>';
    el.innerHTML = html;
    const cnt = $('#f-count');
    if (cnt && state.tab === 'board') cnt.textContent = filteredRows().length + ' shown';
    bind();
  }

  function bind() {
    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      state.tab = b.getAttribute('data-tab');
      state.detail = null;
      history.replaceState(null, '', state.tab === 'board' ? '#board' : '#' + state.tab);
      render();
    }));
    document.querySelectorAll('[data-detail]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      state.detail = a.getAttribute('data-detail');
      history.replaceState(null, '', '#detail-' + state.detail);
      render();
      window.scrollTo(0, 0);
    }));
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
      state.detail = null;
      history.replaceState(null, '', '#board');
      render();
      window.scrollTo(0, 0);
    }));
    const q = $('#f-q');
    if (q) q.addEventListener('input', () => { state.q = q.value; render(); const nq = $('#f-q'); if (nq) { nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); } });
    const sel = (id, fn) => { const e = $(id); if (e) e.addEventListener('change', () => { fn(e.value); render(); }); };
    sel('#f-cat', (v) => { state.cat = v; });
    sel('#f-chain', (v) => { state.chain = v; });
    sel('#f-tier', (v) => { state.tier = v; });
    sel('#f-verdict', (v) => { state.verdict = v; });
    sel('#f-tvl', (v) => { state.minTvl = Number(v); });
    sel('#f-cap', (v) => { state.capital = Number(v); });
    sel('#f-share', (v) => { state.share = Number(v); });
    sel('#f-trend', (v) => { state.trend = v; });
    const hide = $('#f-hide');
    if (hide) hide.addEventListener('click', () => { state.hideSummary = !state.hideSummary; render(); });
    const reset = $('#f-reset');
    if (reset) reset.addEventListener('click', () => {
      Object.assign(state, { q: '', cat: '', chain: '', tier: 'all', verdict: 'all', minTvl: 0, capital: 1000, share: 0.1, trend: 'all' });
      render();
    });
  }

  readHash();
  render();
})();
