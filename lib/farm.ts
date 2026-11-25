// Farm economics for token-radar-01 v3.
//
// The model's 8 farm steps already carry a dollar cost and a time in their
// text ("... Cost: <cost>. Time: <time>."). This module parses those costs
// and times out of the step strings the model wrote and nets them against
// the airdrop slice the protocol would pay at a given capital and airdrop
// share. Nothing here is hand-written: every dollar comes from the model's
// own plan or from the snapshot's TVL / implied value.
//
//   slice  = C / (TVL + C) * share * implied        (10% = the depositor share)
//   fees   = sum of the plan's gas costs (weekly ones x weeks in the hold)
//   tbill  = C * 0.04 * hold_days / 365             (4% yield forgone)
//   net    = slice - fees - tbill
//   $/h    = net / hands-on hours
//   FARM beats all of it, THIN beats fees only, SKIP does not.
//   ROBUST pays even at the band's low end (P25 implied value).
//
// Gas is fixed: it does not scale with capital C (the plan's ticket is
// capital at risk, not a fee). The T-bill and the slice do scale with C.

/** One farm step's cost and time, parsed out of its text. */
export interface ParsedStep {
  /** Dollar gas cost of this step (0 when the step charges no gas). */
  gas: number;
  /** True when the gas repeats once a week through the hold. */
  gasWeekly: boolean;
  /** Hands-on minutes this step takes (0 for the passive hold). */
  minutes: number;
  /** True when the minutes repeat once a week through the hold. */
  minWeekly: boolean;
  /** Hold length in days (only the hold step sets this). */
  holdDays: number;
  /** Capital the step puts at risk (only the funding step sets this). */
  capital: number;
}

/** Split one farm-step string into its action, cost and time text. */
export function splitStep(step: string): { action: string; cost: string; time: string } {
  const m = step.match(/^(.*) Cost: (.+)\. Time: (.+)\.?$/);
  if (!m) return { action: step, cost: '', time: '' };
  return { action: m[1]!, cost: m[2]!, time: m[3]! };
}

/** Parse the dollar gas and the minutes out of one step's cost/time text. */
export function parseStep(step: string): ParsedStep {
  const { cost, time } = splitStep(step);
  let gas = 0;
  let gasWeekly = false;
  let capital = 0;
  let minutes = 0;
  let minWeekly = false;
  let holdDays = 0;
  // Gas: the dollar figure immediately before "of gas". A cost with no
  // "of gas" charges no gas (capital that stays, a free check, a log).
  const gasM = cost.match(/\$([\d.]+)\s+of gas/);
  if (gasM) {
    gas = parseFloat(gasM[1]!);
    gasWeekly = /a week/.test(cost);
  }
  const capM = cost.match(/\$([\d.]+)\s+of capital/) ?? cost.match(/the \$([\d.]+) stays/);
  if (capM) capital = parseFloat(capM[1]!);
  // Time: days are the passive hold; minutes are hands-on work.
  const dayM = time.match(/(\d+)\s*days?/);
  if (dayM) {
    holdDays = parseInt(dayM[1]!, 10);
  } else {
    const minM = time.match(/(\d+)\s*minutes?/);
    if (minM) {
      minutes = parseInt(minM[1]!, 10);
      minWeekly = /a week/.test(time);
    }
  }
  return { gas, gasWeekly, capital, minutes, minWeekly, holdDays };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Whole weeks inside a hold: the weekly upkeep runs once per full week. */
export function weeksIn(holdDays: number): number {
  return Math.max(1, Math.floor(holdDays / 7));
}

/** The slice a capital C would hold at an airdrop share of the implied value. */
export function sliceUsd(tvl: number, implied: number, capital: number, share: number): number {
  return (capital / (tvl + capital)) * share * implied;
}

/** The T-bill yield forgone on capital C over the hold. */
export function tbillUsd(capital: number, holdDays: number): number {
  return capital * 0.04 * (holdDays / 365);
}

/** Farm economics for one board row at a capital and airdrop share. */
export interface FarmRow {
  slice_usd: number;
  fees_usd: number;
  tbill_usd: number;
  net_usd: number;
  work_hours: number;
  per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  robust: boolean;
  breakeven_usd: number;
  sensitivity: number[];
  hold_days: number;
  best_chain: string;
  ticket_usd: number;
  work_minutes: number;
}

/** The capitals and shares the sensitivity table covers. */
export const SENS_CAPITALS = [1000, 10000, 100000];
export const SENS_SHARES = [0.05, 0.1, 0.2];

/**
 * Compute a row's farm economics. `steps` are the model's 8 farm-step
 * strings; `bandLow` is the P25 implied-value factor (1 when no band).
 * `capital` is the plan size (default $1,000), `share` the airdrop share
 * to depositors (default 10%).
 */
export function farmRow(
  steps: string[],
  tvl: number,
  implied: number,
  chains: string[],
  capital = 1000,
  share = 0.1,
  bandLow = 1,
): FarmRow {
  const parsed = steps.map(parseStep);
  const holdDays = parsed.reduce((n, s) => Math.max(n, s.holdDays), 0);
  const weeks = weeksIn(holdDays);
  const ticket = parsed.reduce((n, s) => Math.max(n, s.capital), 0);
  let fees = 0;
  let workMin = 0;
  for (const s of parsed) {
    fees += s.gasWeekly ? s.gas * weeks : s.gas;
    workMin += s.minWeekly ? s.minutes * weeks : s.minutes;
  }
  fees = round2(fees);
  const workHours = round1(workMin / 60);
  const slice = sliceUsd(tvl, implied, capital, share);
  const tbill = tbillUsd(capital, holdDays);
  const net = slice - fees - tbill;
  const perHour = workHours > 0 ? net / workHours : 0;
  const verdict: FarmRow['verdict'] = net > 0 ? 'FARM' : slice > fees ? 'THIN' : 'SKIP';
  const sliceLow = sliceUsd(tvl, implied * bandLow, capital, share);
  const robust = sliceLow - fees - tbill > 0;
  const breakeven = Math.max(1, Math.round(((fees + tbill) / share) * ((tvl + capital) / capital)));
  const sensitivity: number[] = [];
  for (const sh of SENS_SHARES) {
    for (const cap of SENS_CAPITALS) {
      sensitivity.push(round2(sliceUsd(tvl, implied, cap, sh) - fees - tbillUsd(cap, holdDays)));
    }
  }
  return {
    slice_usd: round2(slice),
    fees_usd: fees,
    tbill_usd: round2(tbill),
    net_usd: round2(net),
    work_hours: workHours,
    per_hour_usd: round2(perHour),
    verdict,
    robust,
    breakeven_usd: breakeven,
    sensitivity,
    hold_days: holdDays,
    best_chain: chains.length > 0 ? chains[0]! : 'its main chain',
    ticket_usd: ticket,
    work_minutes: workMin,
  };
}

/** Counts of each verdict across rows at the default plan size. */
export function verdictCounts(rows: { verdict: string; robust: boolean }[]): {
  farm: number;
  thin: number;
  skip: number;
  robust: number;
} {
  let farm = 0;
  let thin = 0;
  let skip = 0;
  let robust = 0;
  for (const r of rows) {
    if (r.verdict === 'FARM') farm++;
    else if (r.verdict === 'THIN') thin++;
    else skip++;
    if (r.robust) robust++;
  }
  return { farm, thin, skip, robust };
}
