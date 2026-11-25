// token-radar-01 v3 entry (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with radar-2
// (lib/model.ts, unchanged), nets each row's farm plan against its airdrop
// slice (lib/farm.ts), backtests radar-2 on the live tokens
// (lib/backtest.ts), and writes the ranked board, the dashboard data, the
// dashboard, the screenshots and the dossier the judge reads.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';
import { farmRow, verdictCounts } from './lib/farm.ts';
import { runBacktest } from './lib/backtest.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

// Backtest first: the farm verdicts need the band's low end (ROBUST).
const backtest = runBacktest(snapshot.protocols as never, snapshot.as_of);

// Farm economics per row at the default plan ($1,000, 10% to depositors).
const boardRows = board.map((row) => {
  const farm = farmRow(row.farm_steps, row.tvl_usd, row.implied_value_usd, row.chains, 1000, 0.1, backtest.bandLow);
  return { ...row, ...farm };
});
const counts = verdictCounts(boardRows);
const watchlist = (radar as unknown as { watchlist: string[] }).watchlist;
const bestPerHour = boardRows
  .filter((r) => watchlist.includes(r.slug))
  .reduce((best, r) => (r.per_hour_usd > (best?.per_hour_usd ?? -Infinity) ? r : best), null as (typeof boardRows)[number] | null);

// The set-aside tab: pre-token protocols the board does not rank, and why.
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED = /\bwrapped\b|\bstaked\b|\bstaking\b/i;
const BRIDGE_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const EXCHANGE_NAMES = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
function setAsideReason(p: { name: string; category: string | null }): string {
  if (p.category === 'CEX') return 'exchange';
  if (VERSIONED.test(p.name)) return 'versioned listing';
  if (WRAPPED.test(p.name)) return 'wrapped or staked product';
  if (p.category !== null && BRIDGE_CATS.has(p.category)) return 'bridge or staking product';
  if (EXCHANGE_NAMES.test(p.name)) return 'exchange name';
  return 'below the early radar cut';
}
const boardSlugs = new Set(board.map((r) => r.slug));
const setAside = snapshot.protocols
  .filter((p) => p.mcap_usd === null && p.gecko_id === null && p.symbol === null && !boardSlugs.has(p.slug))
  .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, reason: setAsideReason(p) }))
  .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

// Every live-token protocol, for the "Token trades" tab (not just the top 24).
const liveAll = snapshot.protocols
  .filter((p) => p.mcap_usd !== null)
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
  .map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));

// The dashboard's rows carry the same farm economics as board.json.
const radarRows = (radar as unknown as { rows: Record<string, unknown>[] }).rows.map((r) => {
  const farm = boardRows.find((b) => b.slug === r.slug);
  return farm ? { ...r, ...farm } : r;
});

const radarOut = {
  ...(radar as unknown as Record<string, unknown>),
  rows: radarRows,
  backtest,
  farmCounts: counts,
  bestPerHour:
    bestPerHour === null
      ? null
      : { slug: bestPerHour.slug, name: bestPerHour.name, net_usd: bestPerHour.net_usd, per_hour_usd: bestPerHour.per_hour_usd },
  setAside,
  liveAll,
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: boardRows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radarOut as never));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${boardRows.length} rows scored (${(radar as unknown as { early_size: number }).early_size} early, ${(radar as unknown as { live_size: number }).live_size} live set aside), ${setAside.length} set aside\n` +
    `token radar: farm at $1K/10%: FARM ${counts.farm} · THIN ${counts.thin} · SKIP ${counts.skip} · ROBUST ${counts.robust}; best ${bestPerHour?.name ?? 'none'} +$${bestPerHour?.per_hour_usd ?? 0}/h\n` +
    `token radar: backtest LOO x${backtest.looMedian.toFixed(2)} (flat x${backtest.flatMedian.toFixed(2)}), within-3x ${(backtest.looWithin3 * 100).toFixed(0)}% (flat ${(backtest.flatWithin3 * 100).toFixed(0)}%), band x${backtest.bandLow.toFixed(2)}-x${backtest.bandHigh.toFixed(2)}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
