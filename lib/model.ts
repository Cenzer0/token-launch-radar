// LaunchScope: a token launch radar over one sealed DefiLlama snapshot.
//
// The board ranks protocols that record no token yet by what a token would be
// worth if the protocol's record stayed as it is. The watchlist in the snapshot
// is the floor: every one of its slugs is ranked. Below the floor the radar
// keeps scanning the same way the watchlist itself was drawn: a protocol is a
// launch candidate only when it records no token and is not a wrapped, staked
// or bridged product of one that already trades, not an exchange, and not a
// versioned pool of another protocol.
//
// The implied value uses only the snapshot's own figures:
//
//   implied = TVL x BASE x momentum x maturity x breadth
//
//   momentum  reads the 7-day TVL change through a saturating curve, so one
//             wild week (the snapshot's largest is +4,448%) cannot swamp the
//             board: g is clamped to [-50, 150] and mapped by g / (60 + |g|).
//   maturity  rewards a protocol that has run a long time with no token, on a
//             log-age curve peaking near 22 months; older than that the curve
//             eases off, because a protocol that has waited five years may
//             never issue at all. A protocol whose age the snapshot does not
//             record earns only part of the credit (unknown_age_days 200):
//             an unrecorded age is not evidence of a long tokenless run.
//   breadth   counts the chains the protocol's TVL already sits on: a launch
//             with distribution on day one is worth more than a single-chain
//             one, +4% a chain up to nine chains.
//
// No protocol name is ever special-cased: one function scores every row, and
// the farm plan under each row is derived from that row's own record
// (category, chains, TVL, age), never from a list of names.

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

/** The model's constants, stated on the dashboard so a reader can re-run them. */
export interface ModelConstants {
  base_multiple: number;
  momentum_weight: number;
  momentum_floor: number;
  momentum_cap: number;
  momentum_curve: number;
  maturity_base: number;
  maturity_gain: number;
  maturity_peak_days: number;
  maturity_width: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  momentum_weight: 0.9,
  momentum_floor: -50,
  momentum_cap: 150,
  momentum_curve: 60,
  maturity_base: 0.6,
  maturity_gain: 0.55,
  maturity_peak_days: 660,
  maturity_width: 0.85,
  unknown_age_days: 200,
  breadth_per_chain: 0.04,
  breadth_max_chains: 9,
};

/** The model's version label, named on the dashboard. */
export const MODEL_VERSION = 'launchscope-2';

/** How many already-trading protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The three model factors and the implied value one protocol gets. */
export interface Scored {
  implied: number;
  momentum: number;
  maturity: number;
  breadth: number;
  growth_pct: number;
  age: number | null;
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
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row, with the structured farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  score: number;
  momentum: number;
  maturity: number;
  breadth: number;
  steps: FarmStep[];
}

/** A protocol whose token already trades: the market's own value, kept off the ranked board. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
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

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when a date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Categories that are a wrapped, staked or bridged product of a token that already trades, or an exchange. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product in a protocol's name. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name are that exchange's own product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Whether a protocol is a launch candidate the board may rank: it records no
 * token, and it is not a product of one that already trades. The snapshot's
 * watchlist was drawn by this same shape of rule, and every watchlist slug
 * passes it, so coverage never fights the filter.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** The model's three factors and the implied value for one protocol. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants): Scored {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.momentum_cap, Math.max(model.momentum_floor, rawGrowth));
  const momentum = 1 + model.momentum_weight * (growthPct / (model.momentum_curve + Math.abs(growthPct)));
  const ageForCurve = (age ?? model.unknown_age_days) + 30;
  const logOff = (Math.log(ageForCurve) - Math.log(model.maturity_peak_days + 30)) / model.maturity_width;
  const maturity = model.maturity_base + model.maturity_gain * Math.exp(-0.5 * logOff * logOff);
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains - 1);
  const breadth = 1 + model.breadth_per_chain * extraChains;
  const implied = Math.max(1, Math.round(p.tvl_usd * model.base_multiple * momentum * maturity * breadth));
  return { implied, momentum, maturity, breadth, growth_pct: growthPct, age };
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A rough gas cost for one transaction on a chain, in dollars, as the plan states it. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 12;
  if (chain === 'Bitcoin') return 6;
  return 2;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 250_000_000) return 120;
  if (p.tvl_usd >= 50_000_000) return 80;
  return 40;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's opening position, in words a farmer can follow. */
function openAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC as collateral in ${n} on ${chain} so the wallet starts earning supply history.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Deposit $${capital} into a ${n} vault on ${chain} and keep the vault shares in the wallet.`;
  if (c.includes('dex') || c.includes('yield')) return `Add $${capital} of liquidity to ${n}'s highest-volume pool on ${chain} and keep the position open.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis')) return `Deposit $${capital} of USDC margin on ${n} and open one small hedged position.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the base asset through ${n} on ${chain} and keep the staking receipt.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n}, then use the bridged funds in one app there.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in the wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain}.`;
  if (c.includes('payment')) return `Route one real payment of about $${capital} through ${n} so the wallet has transfer history.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to ${chain} and make one swap in ${n}'s own ecosystem apps.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/** The category's second qualifying action, a week or so after the first. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Borrow a small amount against the supply in ${n}, hold it two days, then repay in full so the wallet shows a clean borrow cycle.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('capital')) return `Move a quarter of the position into a second ${n} vault with a different strategy, so the wallet is active in more than one vault.`;
  if (c.includes('dex') || c.includes('yield')) return `Make three swaps through ${n} on ${chain} across separate days, so the wallet reads as a trader and not a one-off deposit.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('basis')) return `Close the hedge and open a second small position a week later, keeping total margin the same.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim the staking rewards in ${n} and restake them once, so the wallet shows a full reward cycle.`;
  if (c.includes('rwa') || c.includes('stable')) return `Redeem a tenth of the position in ${n} and mint it back a few days later, so the wallet shows both sides of the flow.`;
  return `Repeat the opening action in ${n} with a quarter of the first amount, so the wallet has more than one position day.`;
}

/** A step as one string for board.json: the action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const multi = p.chains.length > 1 ? ` It runs on ${p.chains.length} chains; stay on ${chain} for the whole plan so the history is easy to read.` : '';
  return [
    {
      text: `Set up a fresh wallet for ${p.name} alone and fund it with the gas token of ${chain} plus the capital below. Keep its seed phrase offline and never reuse the wallet for unrelated farms.`,
      cost: 'under $3 to fund and make the first transaction',
      time: '10 minutes',
    },
    {
      text: openAction(p, capital, chain),
      cost: `$${capital} of capital plus about $${gas} of gas on ${chain}`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(p, chain),
      cost: `about $${gas} of gas, no new capital`,
      time: '10 minutes, in the second week',
    },
    {
      text: `Make one qualifying action in ${p.name} every week (a deposit, a swap, a claim or a vote) so the wallet never looks dormant.${multi}`,
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, across more than one weekly snapshot, before you change its size.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check ${p.name}'s own points or rewards page from the link on its official site, and claim only there. A launch is announced by the protocol, never by a message asking you to pay to claim.`,
      cost: 'nothing to check; never pay a claim fee',
      time: '10 minutes',
    },
    {
      text: `Keep a farm log (wallet, dates, amounts, transaction hashes) and review the position monthly against this radar: if the protocol's TVL falls for three straight snapshots, halve the position.`,
      cost: 'nothing but the log',
      time: '5 minutes a month',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n and the watchlist always covered. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter((p) => watch.has(p.slug) || isRankable(p))
    .map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token' as const,
    watchlist: watch.has(p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growth_pct,
      momentum_multiplier: round4(s.momentum),
      maturity_multiplier: round4(s.maturity),
      breadth_multiplier: round4(s.breadth),
      age_days: s.age,
    },
    farm_steps: farmSteps(p, s.age).map(stepText),
  }));
}

/** The already-trading protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
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

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const top = board.length > 0 ? board[0]!.implied_value_usd : 1;
  const bottom = board.length > 0 ? board[board.length - 1]!.implied_value_usd : 1;
  const logSpan = Math.max(1, Math.log(top) - Math.log(Math.max(1, bottom)));
  const rows: RadarRow[] = board.map((r) => {
    const p = bySlug.get(r.slug)!;
    const s = impliedValue(p, snapshot.as_of, model);
    return {
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      watchlist: r.watchlist,
      implied_value_usd: r.implied_value_usd,
      score: Math.round((100 * (Math.log(r.implied_value_usd) - Math.log(Math.max(1, bottom)))) / logSpan),
      momentum: round4(s.momentum),
      maturity: round4(s.maturity),
      breadth: round4(s.breadth),
      steps: farmSteps(p, s.age),
    };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    rows,
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

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears on the board twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
