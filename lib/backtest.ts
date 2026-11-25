// Backtest for token-radar-01 v3.
//
// This measures radar-2, it does not change it. The pricing below is the
// model's own formula, re-derived from the snapshot and verified against
// the board: implied = TVL x peer multiple x growth x maturity, where the
// peer multiple is the category's median mcap/TVL when the category has at
// least 3 live peers, else the overall median, clamped to [0.0315, 0.9999];
// growth is 1 + clamp(7d, -60, +120)/100 x 0.5; maturity is
// 0.6 + min(age, 1095)/1095 x 0.4 (age unknown: 365 days).
//
//   LOO:        price each live token with the multiples refit WITHOUT it.
//   Flat:       the same, with one overall multiple for every token.
//   Time split: fit on tokens listed before a date, test the newer ones.
//   Ablation:   LOO with one ingredient removed at a time.
//   Band:       P25/P75 of the LOO log-residuals, as multiples.
//   Scatter:    each live token's LOO prediction against its real cap.

/** A live-token comparable: it already trades, so its cap is the truth. */
export interface LiveToken {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  listed_at: string | null;
}

const DAY_MS = 86_400_000;
const PEER_MIN = 3;
const CLAMP_LOW = 0.0315;
const CLAMP_HIGH = 0.9999;

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Percentile of a sorted array, linear interpolation. */
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0]!;
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** Pearson correlation of two equal-length arrays. */
function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return 0;
  return sxy / Math.sqrt(sxx * syy);
}

function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** The peer multiples fitted on a set of live tokens. */
export interface Multiples {
  overall: number;
  byCat: Map<string, number>;
}

export function fitMultiples(live: LiveToken[]): Multiples {
  const overall = median(live.map((p) => p.mcap_usd / p.tvl_usd));
  const byCat = new Map<string, number>();
  const cats = new Map<string, number[]>();
  for (const p of live) {
    const k = p.category ?? '';
    const arr = cats.get(k) ?? [];
    arr.push(p.mcap_usd / p.tvl_usd);
    cats.set(k, arr);
  }
  for (const [k, arr] of cats) byCat.set(k, median(arr));
  return { overall, byCat };
}

/** A live token's peer multiple under a fitted set (category, else overall). */
export function peerMultiple(p: LiveToken, m: Multiples, liveCountByCat: Map<string, number>): number {
  const k = p.category ?? '';
  const n = liveCountByCat.get(k) ?? 0;
  const raw = n >= PEER_MIN ? (m.byCat.get(k) ?? m.overall) : m.overall;
  return clamp(raw, CLAMP_LOW, CLAMP_HIGH);
}

export interface PriceOpts {
  growth: boolean;
  maturity: boolean;
  category: boolean;
}

/** Price one protocol with radar-2 under fitted multiples. */
export function priceOne(
  p: LiveToken,
  m: Multiples,
  liveCountByCat: Map<string, number>,
  asOf: string,
  opts: PriceOpts = { growth: true, maturity: true, category: true },
): number {
  const mult = opts.category ? peerMultiple(p, m, liveCountByCat) : clamp(m.overall, CLAMP_LOW, CLAMP_HIGH);
  const g = opts.growth ? clamp(p.change_7d ?? 0, -60, 120) : 0;
  const gm = 1 + (g / 100) * 0.5;
  const age = ageDays(asOf, p.listed_at) ?? 365;
  const mm = opts.maturity ? 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4 : 1;
  return Math.max(1, Math.round(p.tvl_usd * mult * gm * mm));
}

function countsByCat(live: LiveToken[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const p of live) {
    const k = p.category ?? '';
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  return c;
}

export interface LooResult {
  n: number;
  median: number;
  within3: number;
  within10: number;
  preds: { slug: string; name: string; category: string | null; pred: number; actual: number }[];
  logResiduals: number[];
}

/** Leave-one-out: refit the multiples without each token, then price it. */
export function loo(live: LiveToken[], asOf: string, opts: PriceOpts = { growth: true, maturity: true, category: true }): LooResult {
  const preds: LooResult['preds'] = [];
  const misses: number[] = [];
  const logResiduals: number[] = [];
  for (const t of live) {
    const rest = live.filter((p) => p.slug !== t.slug);
    const m = fitMultiples(rest);
    const counts = countsByCat(rest);
    const pred = priceOne(t, m, counts, asOf, opts);
    preds.push({ slug: t.slug, name: t.name, category: t.category, pred, actual: t.mcap_usd });
    misses.push(Math.max(pred / t.mcap_usd, t.mcap_usd / pred));
    logResiduals.push(Math.log(pred / t.mcap_usd));
  }
  const within3 = misses.filter((x) => x <= 3).length / Math.max(1, misses.length);
  const within10 = misses.filter((x) => x <= 10).length / Math.max(1, misses.length);
  return { n: live.length, median: median(misses), within3, within10, preds, logResiduals };
}

/** Flat baseline LOO: one overall multiple for every token. */
export function looFlat(live: LiveToken[], asOf: string): LooResult {
  return loo(live, asOf, { growth: true, maturity: true, category: false });
}

export interface TimeSplit {
  cutoff: string;
  nFit: number;
  nTest: number;
  modelMedian: number;
  flatMedian: number;
  modelWithin3: number;
  flatWithin3: number;
}

/** Fit on tokens listed before `cutoff`, test the ones listed on/after it. */
export function timeSplit(live: LiveToken[], asOf: string, cutoff: string): TimeSplit | null {
  const cut = Date.parse(`${cutoff}T00:00:00Z`);
  const fit = live.filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) < cut);
  const test = live.filter((p) => p.listed_at !== null && Date.parse(`${p.listed_at}T00:00:00Z`) >= cut);
  if (fit.length < 10 || test.length < 5) return null;
  const m = fitMultiples(fit);
  const counts = countsByCat(fit);
  const flatMult = clamp(m.overall, CLAMP_LOW, CLAMP_HIGH);
  const modelMiss: number[] = [];
  const flatMiss: number[] = [];
  for (const t of test) {
    const pred = priceOne(t, m, counts, asOf, { growth: true, maturity: true, category: true });
    const g = clamp(t.change_7d ?? 0, -60, 120);
    const gm = 1 + (g / 100) * 0.5;
    const age = ageDays(asOf, t.listed_at) ?? 365;
    const mm = 0.6 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.4;
    const flatPred = Math.max(1, Math.round(t.tvl_usd * flatMult * gm * mm));
    modelMiss.push(Math.max(pred / t.mcap_usd, t.mcap_usd / pred));
    flatMiss.push(Math.max(flatPred / t.mcap_usd, t.mcap_usd / flatPred));
  }
  return {
    cutoff,
    nFit: fit.length,
    nTest: test.length,
    modelMedian: median(modelMiss),
    flatMedian: median(flatMiss),
    modelWithin3: modelMiss.filter((x) => x <= 3).length / modelMiss.length,
    flatWithin3: flatMiss.filter((x) => x <= 3).length / flatMiss.length,
  };
}

/** Everything the Method tab and the top panel print. */
export interface Backtest {
  n: number;
  looMedian: number;
  looWithin3: number;
  looWithin10: number;
  flatMedian: number;
  flatWithin3: number;
  flatWithin10: number;
  timeSplit: TimeSplit | null;
  timeSplit2: TimeSplit | null;
  ablationFull: number;
  ablationNoMomentum: number;
  ablationNoCategory: number;
  ablationPeerOnly: number;
  bandLow: number;
  bandHigh: number;
  corrGrowth: number;
  corrSeasoning: number;
  scatter: { slug: string; name: string; category: string | null; pred: number; actual: number }[];
  table: { label: string; median: number; within3: number }[];
}

/** Run the whole backtest on the snapshot's live tokens. */
export function runBacktest(
  protocols: { slug: string; name: string; category: string | null; tvl_usd: number; mcap_usd: number | null; change_7d: number | null; listed_at: string | null }[],
  asOf: string,
): Backtest {
  const live: LiveToken[] = protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
    }));
  const full = loo(live, asOf, { growth: true, maturity: true, category: true });
  const flat = looFlat(live, asOf);
  const noMom = loo(live, asOf, { growth: false, maturity: true, category: true });
  const noCat = loo(live, asOf, { growth: true, maturity: true, category: false });
  const peerOnly = loo(live, asOf, { growth: false, maturity: false, category: true });
  const split = timeSplit(live, asOf, '2024-01-01');
  // Second split only when enough tokens were listed after 2025-01-01.
  const after2025 = live.filter((p) => p.listed_at !== null && p.listed_at >= '2025-01-01').length;
  const split2 = after2025 >= 20 ? timeSplit(live, asOf, '2025-01-01') : null;
  const sortedRes = [...full.logResiduals].sort((a, b) => a - b);
  const bandLow = Math.exp(percentile(sortedRes, 0.25));
  const bandHigh = Math.exp(percentile(sortedRes, 0.75));
  // Honest factor check: curve-only blind residuals vs growth and seasoning.
  const growths = peerOnly.preds.map((pr) => {
    const t = live.find((x) => x.slug === pr.slug)!;
    return t.change_7d ?? 0;
  });
  const ages = peerOnly.preds.map((pr) => {
    const t = live.find((x) => x.slug === pr.slug)!;
    return ageDays(asOf, t.listed_at) ?? 365;
  });
  const corrGrowth = pearson(growths, peerOnly.logResiduals);
  const corrSeasoning = pearson(ages, peerOnly.logResiduals);
  const table = [
    { label: 'Curve + family + factors (radar-2)', median: full.median, within3: full.within3 },
    { label: 'Curve + family (peer multiple only)', median: peerOnly.median, within3: peerOnly.within3 },
    { label: 'Flat mcap/TVL', median: flat.median, within3: flat.within3 },
    { label: 'Time split, model', median: split ? split.modelMedian : 0, within3: split ? split.modelWithin3 : 0 },
    { label: 'Time split, flat', median: split ? split.flatMedian : 0, within3: split ? split.flatWithin3 : 0 },
  ];
  return {
    n: live.length,
    looMedian: full.median,
    looWithin3: full.within3,
    looWithin10: full.within10,
    flatMedian: flat.median,
    flatWithin3: flat.within3,
    flatWithin10: flat.within10,
    timeSplit: split,
    timeSplit2: split2,
    ablationFull: full.median,
    ablationNoMomentum: noMom.median,
    ablationNoCategory: noCat.median,
    ablationPeerOnly: peerOnly.median,
    bandLow,
    bandHigh,
    corrGrowth,
    corrSeasoning,
    scatter: full.preds,
    table,
  };
}
