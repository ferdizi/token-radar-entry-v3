// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every other
// rankable pre-token protocol: the early rows the radar exists to find. A protocol is pre-token when its
// index entry records no token (no market cap, no CoinGecko id, no symbol); the snapshot's live-token
// protocols are kept apart and shown as the market's own values, never mixed into the ranked board.
// Rankable means pre-token and not a wrapped, staked or bridged product of a token that already trades
// (the watchlist's own rule): bridges and staked-ETH receipts hold billions of TVL but will never
// launch a token, so they are left out rather than ranked at the top.
//
// Implied value follows only from the snapshot's own figures:
//
//   peer     = the category's peer multiple: the median mcap/TVL of the live-token protocols in the
//              same category, where at least 3 live peers exist; otherwise the overall median. Every
//              multiple is clamped to the middle half of live multiples (the 25th to 75th percentile),
//              so one outlier protocol cannot set the price for a whole category.
//   base     = tvl_usd x peer
//   growth   = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   implied  = max(1, round(base x growthMult x maturity))
//
// The peer table is computed inside the program from the snapshot at run time: no protocol name and no
// multiple is ever hardcoded. The dashboard states the formula and the peer table, and recomputes each
// row from the same figures, so the page's code and the board's data are visibly the same arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  peer_min_count: number;
  overall_multiple: number;
  clamp_low: number;
  clamp_high: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  peer_min_count: 3,
  overall_multiple: 0.169,
  clamp_low: 0.032,
  clamp_high: 1.001,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    peer_multiple: number;
    peer_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One category's peer calibration, as the dashboard's methodology table shows it. */
export interface PeerRow {
  category: string;
  peers: number;
  median: number | null;
  multiple: number;
  source: 'category' | 'overall';
}

/** The dashboard's compact view of one row, with the farm plan the board carries. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  peer_multiple: number;
  peer_count: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the peer table and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  top_category: string | null;
  peers: PeerRow[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty sorted list; the average of the two middle values when even. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

/** The q-th quantile of a sorted list, linearly interpolated between the two nearest ranks. */
function quantileOf(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const at = q * (sorted.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/** The peer calibration of the snapshot: one multiple per category, computed here, never hardcoded. */
export interface PeerTable {
  model: ModelConstants;
  peers: PeerRow[];
  multipleFor: (category: string | null) => { multiple: number; count: number };
}

export function peerTable(snapshot: Snapshot): PeerTable {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.tvl_usd > 0);
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const overall = round4(medianOf(ratios));
  const low = round4(quantileOf(ratios, 0.25));
  const high = round4(quantileOf(ratios, 0.75));
  const clamp = (x: number): number => Math.min(high, Math.max(low, x));
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const c = p.category ?? 'Other';
    const list = byCategory.get(c);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(c, [p.mcap_usd! / p.tvl_usd]);
  }
  const peers: PeerRow[] = [];
  const multiples = new Map<string, { multiple: number; count: number }>();
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const sorted = [...list].sort((a, b) => a - b);
    const med = round4(medianOf(sorted));
    if (list.length >= MODEL.peer_min_count) {
      const multiple = clamp(med);
      peers.push({ category, peers: list.length, median: med, multiple, source: 'category' });
      multiples.set(category, { multiple, count: list.length });
    } else {
      peers.push({ category, peers: list.length, median: med, multiple: overall, source: 'overall' });
      multiples.set(category, { multiple: overall, count: list.length });
    }
  }
  const model: ModelConstants = { ...MODEL, overall_multiple: overall, clamp_low: low, clamp_high: high };
  return {
    model,
    peers,
    multipleFor: (category) => {
      const hit = multiples.get(category ?? 'Other');
      if (hit) return hit;
      return { multiple: overall, count: 0 };
    },
  };
}

/** The three multipliers and the implied value one protocol gets under the peer table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  table: PeerTable,
): { implied: number; multiple: number; peerCount: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, count } = table.multipleFor(protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(table.model.growth_cap, Math.max(table.model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * table.model.growth_weight;
  const ageForModel = age ?? table.model.unknown_age_days;
  const maturityMult = table.model.maturity_floor + (Math.min(Math.max(ageForModel, 0), table.model.maturity_days) / table.model.maturity_days) * table.model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, peerCount: count, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The watchlist's own exclusion: a wrapped, staked or bridged product of a token that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades. Bridges hold billions of TVL and record no token of their
 * own, but they will never launch one — ranking them would put WBTC and the Base bridge at the top
 * of a token-launch radar. The same rule defines the watchlist, so no watchlist row is ever excluded.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, table: PeerTable): BoardRow[] {
  const chosen = snapshot.protocols.filter((p) => isRankable(p) || snapshot.watchlist.includes(p.slug));
  const scored = chosen.map((p) => {
    const v = impliedValue(p, snapshot.as_of, table);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      peer_multiple: s.multiple,
      peer_count: s.peerCount,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A second, different qualifying action on the same protocol, so the plan is never one-action. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} of USDC against the supplied collateral on ${name}, then repay it within the week.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Swap $${small} of USDC through ${name}'s pool on ${chain} so the wallet shows a second kind of activity.`;
  if (c.includes('bridge')) return `Use the bridged funds in a second app on ${chain}, such as a swap or a deposit, instead of bridging them back.`;
  if (c.includes('staking') || c.includes('restak')) return `Check the staking receipt ${name} issued and confirm the position is visible in its app.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close the first hedge on ${name} and open a fresh small one, so the wallet shows two separate trades.`;
  if (c.includes('prediction')) return `Place a second position on a different market on ${name}, with a smaller stake than the first.`;
  if (c.includes('curator') || c.includes('allocator')) return `Vote on one vault proposal on ${name}, or move $${small} between two of its vaults.`;
  if (c.includes('stable')) return `Use $${small} of the stable asset in a second protocol on ${chain} instead of holding it idle.`;
  if (c.includes('rwa')) return `Check the yield the ${name} asset has accrued and compound $${small} of it back into the position.`;
  if (c.includes('insurance')) return `Read the cover terms ${name} published and confirm what the policy does and does not pay for.`;
  return `Make a second, different qualifying action on ${name}, such as a swap, a vote or a second deposit.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const second = secondActionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: second,
      cost: 'about $2 of gas',
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Plan the exit before you enter: withdraw in two tranches after the hold window, keep a small position open until a snapshot is announced, and never pay a third party to claim for you.`,
      cost: 'about $4 of gas to unwind',
      time: '15 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, carrying the farm plan the board carries. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const table = peerTable(snapshot);
  const board = buildBoard(snapshot, table);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const totalImplied = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const byCategory = new Map<string, number>();
  for (const r of board) {
    const c = r.category ?? 'Other';
    byCategory.set(c, (byCategory.get(c) ?? 0) + r.implied_value_usd);
  }
  let topCategory: string | null = null;
  let topTotal = -1;
  for (const [c, t] of byCategory) {
    if (t > topTotal) {
      topTotal = t;
      topCategory = c;
    }
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: table.model,
    model_version: MODEL_VERSION,
    watchlist: [...snapshot.watchlist],
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: totalImplied,
    top_category: topCategory,
    peers: table.peers,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
