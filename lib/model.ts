// Token Radar — the model (impliedValueV2, "radar-2").
//
// One sealed snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A
// protocol is pre-token when its index entry records no token (no market cap, no CoinGecko id, no
// symbol). The snapshot's live-token protocols are kept apart and shown as the market's own
// values, never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures. No protocol name is ever
// special-cased: the same function scores every row.
//
//   age_days    = days from listed_at to as_of (null -> 365 for the model)
//   growth      = clamp(change_7d, -60, +120) per cent
//   growthMult  = 1 + (growth / 100) x 0.5
//   maturityMult= 0.6 + min(age_days, 1095) / 1095 x 0.4
//   chainMult   = 1 + 0.02 x min(max(len(chains) - 1, 0), 4)
//   multiple    = the row's category multiple (see below), shrunk toward the global median
//   implied_raw = round(tvl_usd x multiple x growthMult x maturityMult x chainMult)
//   implied     = max(1, implied_raw), walked strictly decreasing down the ranking
//
// The category multiple is earned, not chosen. Comparables are the snapshot's own live-token
// protocols with a market cap over zero, excluding versioned sub-rows (a name ending in a
// release is a pool of another protocol), exchanges, and rows with no CoinGecko id. For each
// category the multiple is the median mcap/TVL of its comparables, shrunk toward the global
// median with weight n / (n + 3) so a one-row category cannot set the price on its own, then
// clamped to [0.02, 1.00]. A category with no comparables uses the global median. The medians
// are computed at runtime from whatever snapshot is fed in, so the model follows the data.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  version: string;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  shrink_prior: number;
}

export const MODEL: ModelConstants = {
  version: 'radar-2',
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.02,
  chain_cap: 4,
  multiple_floor: 0.02,
  multiple_cap: 1.0,
  shrink_prior: 3,
};

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** How many flagged Tier-2 rows the board carries, by TVL. */
export const FLAGGED_ROWS = 22;

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
  tier: 'watchlist' | 'early' | 'flagged';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_n: number;
    multiple_p25: number | null;
    multiple_p75: number | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    raw: number;
    tie_adjusted: boolean;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row, verbatim, with its farm plan and model. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  tier: 'watchlist' | 'early' | 'flagged';
  farm_steps: string[];
  model: BoardRow['model'];
}

/** One category's earned multiple, with the comparables behind it. */
export interface CategoryMultiple {
  category: string;
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  multiple: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model and its multiples. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  comparables: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  flagged_size: number;
  live_size: number;
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

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank at all: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

// ---------------------------------------------------------------- comparables

/** Categories whose product is a wrapped, staked or bridged form of something that already trades:
// the README watchlist rule keeps them out of the clean early radar. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Exchange names: a protocol whose name starts with one is a product of an exchange that trades. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** A whole-word match for wrapped / staked / staking in a protocol name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a below-floor pre-token row fails the README watchlist rule, so it is not a clean
 * pre-token launch: a wrapped/staked/bridge product, or an exchange's own product. CEX rows and
 * versioned pools are excluded earlier by isRankable and never reach this check.
 */
export function failsCleanRule(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return true;
  return false;
}

/** The snapshot's live-token protocols that can price a category: a market cap over zero, a
 * CoinGecko id, not an exchange, not a versioned sub-row. */
export function comparableRows(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      !isPreToken(p) &&
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      p.gecko_id !== null &&
      p.category !== 'CEX' &&
      !VERSIONED.test(p.name),
  );
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function quartileOf(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  return sorted[Math.min(n - 1, Math.floor(q * n))]!;
}

/**
 * The earned multiples: the global median mcap/TVL across all comparables, and one multiple per
 * category — the category median shrunk toward the global median with weight n / (n + prior), so
 * a one-row category cannot set the price on its own — clamped to [multiple_floor, multiple_cap].
 * A category with no comparables uses the global median.
 */
export function categoryMultiples(
  comparables: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { global: number; multiples: CategoryMultiple[] } {
  const ratios = comparables.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const global = medianOf(ratios);
  const byCategory = new Map<string, number[]>();
  for (const p of comparables) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCategory.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  const multiples: CategoryMultiple[] = [...byCategory.entries()]
    .map(([category, values]) => {
      const sorted = values.sort((a, b) => a - b);
      const n = sorted.length;
      const med = medianOf(sorted);
      const w = n / (n + model.shrink_prior);
      const multiple = clamp(w * med + (1 - w) * global, model.multiple_floor, model.multiple_cap);
      return {
        category,
        n,
        median: med,
        p25: quartileOf(sorted, 0.25),
        p75: quartileOf(sorted, 0.75),
        multiple,
      };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return { global, multiples };
}

/** The multiple a category earns, or the global median when it has no comparables. */
export function multipleFor(category: string | null, multiples: CategoryMultiple[], global: number): CategoryMultiple | null {
  if (category === null) return null;
  return multiples.find((m) => m.category === category) ?? null;
}

// ---------------------------------------------------------------- the value model

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValueV2(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: CategoryMultiple[],
  global: number,
  model: ModelConstants = MODEL,
): {
  raw: number;
  multiple: number;
  multiple_n: number;
  multiple_p25: number | null;
  multiple_p75: number | null;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const entry = multipleFor(protocol.category, multiples, global);
  const multiple = entry === null ? global : entry.multiple;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_cap);
  const raw = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return {
    raw,
    multiple,
    multiple_n: entry === null ? 0 : entry.n,
    multiple_p25: entry === null ? null : entry.p25,
    multiple_p75: entry === null ? null : entry.p75,
    growth_pct: growthPct,
    growth_multiplier: growthMult,
    maturity_multiplier: maturityMult,
    chain_multiplier: chainMult,
    age,
  };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { global, multiples } = categoryMultiples(comparableRows(snapshot), model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, { p: SnapshotProtocol; tier: BoardRow['tier'] }>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, { p, tier: 'watchlist' });
  }
  // The early radar: clean pre-token protocols below the watchlist floor, by TVL. Never a
  // replacement for a watchlist row: a chosen protocol stays chosen.
  const below = snapshot.protocols.filter(
    (p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd,
  );
  const early = below
    .filter((p) => !failsCleanRule(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, { p, tier: 'early' });
  // Tier-2, flagged: the strongest of the rows the clean rule excludes, ranked for completeness
  // and badged as wrapped / staked / bridge products, not clean pre-token launches.
  const flagged = below
    .filter((p) => failsCleanRule(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, FLAGGED_ROWS);
  for (const p of flagged) chosen.set(p.slug, { p, tier: 'flagged' });

  const scored = [...chosen.values()].map(({ p, tier }) => {
    const v = impliedValueV2(p, snapshot.as_of, multiples, global, model);
    return { p, tier, v };
  });
  scored.sort((a, b) => b.v.raw - a.v.raw || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // The gate requires implied value strictly non-rising with rank: walk the ranking and shave a
  // dollar off any row that would tie or outrank the one above it, and record the adjustment.
  let prev = Number.POSITIVE_INFINITY;
  return scored.map((s, i) => {
    const tieAdjusted = s.v.raw >= prev;
    const implied = tieAdjusted ? prev - 1 : s.v.raw;
    prev = implied;
    return {
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
      token_status: 'pre-token' as const,
      tier: s.tier,
      age_days: s.v.age,
      implied_value_usd: implied,
      model: {
        multiple: round4(s.v.multiple),
        multiple_n: s.v.multiple_n,
        multiple_p25: s.v.multiple_p25 === null ? null : round4(s.v.multiple_p25),
        multiple_p75: s.v.multiple_p75 === null ? null : round4(s.v.multiple_p75),
        growth_pct: round4(s.v.growth_pct),
        growth_multiplier: round4(s.v.growth_multiplier),
        maturity_multiplier: round4(s.v.maturity_multiplier),
        chain_multiplier: round4(s.v.chain_multiplier),
        raw: s.v.raw,
        tie_adjusted: tieAdjusted,
      },
      farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    };
  });
}

// ---------------------------------------------------------------- farm plans

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
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('restak') || c.includes('staking'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt. The receipt is a claim on the stake, not the protocol's own token.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name} on ${chain} to open a basis position and keep it open.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('governance')) return `Deposit $${capital} of USDC into ${name} on ${chain} and vote on its governance proposals.`;
  if (c.includes('payment')) return `Pay $${capital} through ${name} on ${chain} and keep the payment receipt.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names, and never from a URL: the protocol's own site is the only place a farmer should look.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
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
      text: `Make a second qualifying action a week later, such as another deposit, a borrow, a swap or a vote, so the wallet shows repeat use.`,
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
      text: `Before you withdraw, open the protocol's own rewards or points page from its own site and claim only from the link it publishes. Never pay to claim, and never follow a claim link from a DM or a reply.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    {
      text: `When you exit, unwind in reverse order, smallest position first, and keep the log so the next farm starts from a clean record.`,
      cost: 'about $4 of gas to unwind',
      time: '15 minutes',
    },
  ];
}

// ---------------------------------------------------------------- radar data

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

/** A board row's dashboard form: the row, verbatim, with its farm plan and model breakdown. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    tier: row.tier,
    farm_steps: row.farm_steps,
    model: row.model,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { global, multiples } = categoryMultiples(comparableRows(snapshot), model);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: model.version,
    global_multiple: global,
    comparables: comparableRows(snapshot).length,
    multiples,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.tier === 'early').length,
    flagged_size: board.filter((r) => r.tier === 'flagged').length,
    live_size: live.length,
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
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
