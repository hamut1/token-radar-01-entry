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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// Category rules establish the starting share of TVL used in the dollar estimate.
// Order matters because a label can match several patterns and the first tier wins.
// The same classification supplies the entry and weekly instructions in the farm plan.
const categories = [
  {
    key: 'lending', match: /lend|cdp|collateral/i, multiple: 0.34,
    entry: 'Supply a supported stablecoin to a market with available withdrawals.',
    weekly: 'Check available liquidity and add a small supply tranche if eligible.',
  },
  {
    key: 'dex', match: /dex|liquidity manager/i, multiple: 0.39,
    entry: 'Split the budget across both assets of a liquid pool and mint an LP position.',
    weekly: 'Check the LP range and rebalance only if it is out of range and the rules permit it.',
  },
  {
    key: 'bridge', match: /bridge/i, multiple: 0.12,
    entry: 'Quote a transfer between two supported networks, check the destination address, and send a small first transfer.',
    weekly: 'Confirm settlement and make one additional eligible transfer if you need to move funds.',
  },
  {
    key: 'staking', match: /stak/i, multiple: 0.17,
    entry: 'Stake a supported asset and verify the receipt, withdrawal delay, and minimum redemption size.',
    weekly: 'Check validator and receipt status and top up only if the points rules count it.',
  },
  {
    key: 'derivatives', match: /perpetual|derivative|options|basis trading|synthetic/i, multiple: 0.31,
    entry: 'Post a small isolated margin balance and use it for one minimum-size hedge after checking funding and liquidation terms.',
    weekly: 'Review margin and funding, then reduce or adjust the hedge if needed under the eligibility rules.',
  },
  {
    key: 'prediction', match: /prediction/i, multiple: 0.29,
    entry: 'Read the settlement criteria and use a small part of the budget for one position in a liquid market.',
    weekly: 'Check settlement updates and review eligible open markets before placing any new order.',
  },
  {
    key: 'stable', match: /stable|rwa|reserve currency/i, multiple: 0.15,
    entry: 'Check access and redemption terms, then use the smallest supported mint or subscribe order.',
    weekly: 'Check redemption liquidity and confirm whether the balance still earns credit.',
  },
  {
    key: 'insurance', match: /insurance/i, multiple: 0.20,
    entry: 'Quote a short policy against an exposure you already hold and pay the premium only within budget.',
    weekly: 'Check policy dates and coverage, renewing only if the exposure and published eligibility continue.',
  },
  {
    key: 'launchpad', match: /launchpad/i, multiple: 0.22,
    entry: 'Read the allocation rules for an open sale and commit only the minimum eligible amount within budget.',
    weekly: 'Check allocation status and track the refund and vesting deadlines.',
  },
];

// Missing and unfamiliar labels share a tier, which keeps their rows comparable.
const fallback = {
  key: 'other',
  multiple: 0.19,
  entry: 'Find the app’s documented primary action and test its smallest reversible position with a visible exit quote.',
  weekly: 'Verify the receipt and repeat the smallest documented eligible action only if it serves the position.',
};

// Publish the same category weights and curve parameters used in scoring for inspection.
export const MODEL = {
  category_multiples: Object.fromEntries([...categories, fallback].map(tier => [tier.key, tier.multiple])),
  growth_floor: -45,
  growth_cap: 75,
  loss_weight: 0.48,
  gain_weight: 0.24,
  maturity_floor: 0.72,
  maturity_range: 0.28,
  maturity_days: 1_460,
  unknown_age_days: 90,
  extra_chain_bonus: 0.028,
  extra_chain_cap: 4,
  young_days: 75,
  young_discount: 0.10,
};

export type ModelConstants = typeof MODEL;
export const MODEL_VERSION = 'radar-contour-1';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;
const BOARD_ROWS = 200;
const VALUE_CAP = 100_000_000_000_000;
const VERSION_SUFFIX = /\s(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)$/i;
const CAUTIOUS_CATEGORIES = new Set(['derivatives', 'prediction', 'launchpad', 'other']);

// Use code-unit order to resolve exact ties consistently across host locales.
function compareSlug(left: { slug: string }, right: { slug: string }): number {
  return Number(left.slug > right.slug) - Number(left.slug < right.slug);
}

function categoryFor(protocol: SnapshotProtocol) {
  const label = protocol.category ?? '';
  return categories.find(tier => tier.match.test(label)) ?? fallback;
}

function utcDay(date: string | null): number {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) return NaN;
  return timestamp;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  const days = (utcDay(asOf) - utcDay(listedAt)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.gecko_id === null && protocol.symbol === null && protocol.mcap_usd === null;
}

export function isRankable(protocol: SnapshotProtocol): boolean {
  return isPreToken(protocol) && protocol.category?.toUpperCase() !== 'CEX' &&
    !VERSION_SUFFIX.test(protocol.name.trimEnd());
}

export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL) {
  const age = ageDays(asOf, protocol.listed_at);
  // Keep unknown recorded ages visible while using a fixed substitute for scoring.
  const days = age ?? model.unknown_age_days;
  const baseMultiple = model.category_multiples[categoryFor(protocol).key];
  // Clamp percentage points before converting the magnitude to a fraction.
  // The square root compresses larger moves and the loss weight makes declines count more.
  const growthPct = Math.max(model.growth_floor, Math.min(model.growth_cap, protocol.change_7d ?? 0));
  const weight = growthPct < 0 ? model.loss_weight : model.gain_weight;
  const growthMult = 1 + Math.sign(growthPct) * Math.sqrt(Math.abs(growthPct) / 100) * weight;
  // Normalize the log against the capped age so the curve spans zero to one.
  // Adding one before taking the log makes the curve defined even at day zero.
  // An extra day counts most early on, and age stops lifting the score at the cap.
  const maturityFraction = Math.log1p(Math.min(days, model.maturity_days)) / Math.log1p(model.maturity_days);
  const maturityMult = model.maturity_floor + model.maturity_range * maturityFraction;
  // The first distinct chain establishes the baseline. Only additional chains earn a bonus.
  const extraChains = Math.max(0, new Set(protocol.chains).size - 1);
  const chainBonus = Math.min(extraChains, model.extra_chain_cap) * model.extra_chain_bonus;

  // A quadratic taper retains more of the uncertainty discount during the first weeks.
  // At half the window, three quarters of the original discount still applies.
  // The zero floor keeps the adjustment neutral after the window closes.
  const youngDiscount = model.young_discount * Math.max(0, 1 - (days / model.young_days) ** 2);
  // Apply the chain and youth terms additively after combining maturity and growth.
  // Round the dollar score once, after applying every factor to the TVL baseline.
  const adjustedMultiple = maturityMult * growthMult + chainBonus - youngDiscount;
  const value = Math.round(protocol.tvl_usd * baseMultiple * adjustedMultiple);
  const implied = Math.max(1, Math.min(VALUE_CAP, value));

  return { implied, age, baseMultiple, growthPct, growthMult, maturityMult, chainBonus, youngDiscount };
}

export function farmSteps(protocol: SnapshotProtocol, age: number | null): string[] {
  const category = categoryFor(protocol);
  const [firstChain, destination] = new Set(protocol.chains);
  const chain = firstChain ?? 'a network confirmed in the app docs';
  const route = category.key === 'bridge' && destination !== undefined
    ? ' from ' + chain + ' to ' + destination
    : ' on ' + chain;
  const cautious = CAUTIOUS_CATEGORIES.has(category.key);
  const liquidityTier = Math.max(0, Math.floor(Math.log10(protocol.tvl_usd / 5_000_000)));
  const capital = Math.min(cautious ? 35 : 125, (cautious ? 15 : 25) + liquidityTier * 15);
  const holdDays = age === null || age < 120 ? 14 : age < 540 ? 21 : 28;
  const gas = chain === 'Ethereum' ? 15 : 3;
  return [
    'Create a fresh wallet for ' + chain + ', store the recovery phrase offline, and verify the app domain and network against its docs. Budget $0 for setup and set aside up to $' + gas + ' for initial gas. Allow 10 minutes.',
    category.entry + ' Work' + route + ' with up to $' + capital + ' in capital and a $' + gas + ' gas ceiling. Skip if the minimum or live fee quote exceeds the budget. Allow 15 minutes.',
    'Read the published qualification rules before spending gas. ' + category.weekly + ' Review once a week for 5 minutes, with up to $' + gas + ' for gas only if transacting.',
    'Use ' + holdDays + ' days as a review window. For transfers, sales, or insurance, track settlement, unlock, or expiry instead of forcing a hold. Schedule two 5-minute checks and budget up to $' + gas + ' for an on-chain exit.',
    'Check the app’s official points or rewards page for your wallet and any claim window. Read-only checks cost $0. If there is a verified claim, allow 5 minutes and quote gas before signing; reject blanket approvals.',
    'Log the chain, entry and exit quotes, transaction IDs, fees, and any published eligibility rule in a local spreadsheet. Allow 5 minutes per update at $0.',
  ];
}

export interface BoardRow extends SnapshotProtocol {
  rank: number;
  implied_value_usd: number;
  token_status: 'pre-token';
  age_days: number | null;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
    chain_bonus: number;
    young_discount: number;
  };
  farm_steps: string[];
}

// Fill the extra slots by TVL before any valuation factors enter the calculation.
// The strict floor excludes protocols whose TVL equals the threshold.
function earlyProtocols(snapshot: Snapshot, watchlist: Set<string>): SnapshotProtocol[] {
  return snapshot.protocols
    .filter(protocol => protocol.tvl_usd < snapshot.floor_usd && !watchlist.has(protocol.slug) && isRankable(protocol))
    .sort((left, right) => right.tvl_usd - left.tvl_usd || compareSlug(left, right))
    .slice(0, EARLY_ROWS);
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  // Explicit watchlist membership applies after the pre-token test, at any TVL.
  const watchlist = new Set(snapshot.watchlist);
  const watched = snapshot.protocols.filter(protocol => watchlist.has(protocol.slug) && isPreToken(protocol));
  const scored = [...watched, ...earlyProtocols(snapshot, watchlist)].map(protocol => ({
    protocol,
    score: impliedValue(protocol, snapshot.as_of, model),
  }));
  // Rank the combined set on rounded implied dollars, with slugs breaking equal scores.
  // Assign consecutive ranks only after establishing that final order.
  scored.sort((left, right) => right.score.implied - left.score.implied || compareSlug(left.protocol, right.protocol));
  return scored.map(({ protocol, score }, index) => ({
    ...protocol,
    rank: index + 1,
    token_status: 'pre-token',
    age_days: score.age,
    implied_value_usd: score.implied,
    model: {
      base_multiple: score.baseMultiple,
      growth_pct: score.growthPct,
      growth_multiplier: score.growthMult,
      maturity_multiplier: score.maturityMult,
      age_days: score.age,
      chain_bonus: score.chainBonus,
      young_discount: score.youngDiscount,
    },
    farm_steps: farmSteps(protocol, score.age),
  }));
}

// Reported market caps order the separate live sample for dashboard comparison.
export function liveRows(snapshot: Snapshot) {
  const listed = snapshot.protocols.filter(protocol => !isPreToken(protocol));
  listed.sort((left, right) => (right.mcap_usd ?? -1) - (left.mcap_usd ?? -1) || compareSlug(left, right));
  return listed.slice(0, LIVE_ROWS).map(({ slug, name, category, chains, tvl_usd, mcap_usd, change_7d, symbol }) => ({
    slug, name, category, chains, tvl_usd, mcap_usd, change_7d, symbol,
  }));
}

function radarRow(row: BoardRow, watchlist: Set<string>) {
  const {
    rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd,
    listed_at, age_days, implied_value_usd, model, farm_steps,
  } = row;
  return {
    rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days,
    implied_value_usd,
    watchlist: watchlist.has(slug),
    ...model,
    farm_steps,
  };
}

export type RadarRow = ReturnType<typeof radarRow>;
export type LiveRow = ReturnType<typeof liveRows>[number];

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL) {
  const board = buildBoard(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const rows = board.map(row => radarRow(row, watchlist));
  const live = liveRows(snapshot);
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model,
      model_version: MODEL_VERSION,
      watchlist_size: watchlist.size,
      board_size: rows.length,
      early_size: rows.filter(row => !row.watchlist).length,
      live_size: live.length,
      rows,
      live,
    },
  };
}

export type RadarData = ReturnType<typeof buildRadar>['radar'];

export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown): value is string | null => value === null || isText(value);
const nullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const validSlug = (value: unknown): value is string => isText(value) && /^\S{1,128}$/.test(value);
const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function parseProtocol(raw: unknown, index: number): SnapshotProtocol {
  if (!isObject(raw) || !validSlug(raw.slug) || !isText(raw.name) || !raw.name.trim() ||
      !nullableText(raw.category) || !Array.isArray(raw.chains) || !raw.chains.every(isText) ||
      !positiveInteger(raw.tvl_usd) || !nullableNumber(raw.change_7d) || !nullableNumber(raw.mcap_usd) ||
      !nullableText(raw.listed_at) || !nullableText(raw.gecko_id) || !nullableText(raw.symbol)) {
    throw new Error('Invalid snapshot protocol at index ' + index);
  }
  const { slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol } = raw;
  return { slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, gecko_id, symbol };
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Invalid snapshot JSON');
  }
  if (!isObject(raw) || !isText(raw.as_of) || !Number.isFinite(utcDay(raw.as_of)) ||
      !isText(raw.source) || !positiveInteger(raw.floor_usd) ||
      !Array.isArray(raw.watchlist) || !raw.watchlist.every(validSlug) || !Array.isArray(raw.protocols)) {
    throw new Error('Invalid snapshot metadata, watchlist or protocols array');
  }

  const { as_of, source, floor_usd, watchlist } = raw;
  const seen = new Set<string>();
  const protocols = raw.protocols.map((entry, index) => {
    const protocol = parseProtocol(entry, index);
    if (seen.has(protocol.slug)) throw new Error('Duplicate snapshot protocol ' + protocol.slug);
    seen.add(protocol.slug);
    return protocol;
  });
  if (new Set(watchlist).size !== watchlist.length) throw new Error('Duplicate watchlist slug');
  return { as_of, source, floor_usd, protocols, watchlist };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map(row => row.slug));
  const missing = snapshot.watchlist.find(slug => !slugs.has(slug));
  if (missing !== undefined) return 'Missing watchlist protocol ' + missing;
  if (board.length !== BOARD_ROWS) return 'Expected ' + BOARD_ROWS + ' board rows, found ' + board.length;
  if (slugs.size !== board.length) return 'Duplicate board slug';

  const eligible = new Set(snapshot.watchlist);
  for (const protocol of earlyProtocols(snapshot, eligible)) eligible.add(protocol.slug);
  const preToken = new Set(snapshot.protocols.filter(isPreToken).map(protocol => protocol.slug));
  const ranked = [...board].sort((left, right) => left.rank - right.rank);
  // Dollar rounding can produce ties in other snapshots, so only increases fail this check.
  let previous = Infinity;
  for (const [index, row] of ranked.entries()) {
    const { slug, rank, implied_value_usd: value, farm_steps: steps } = row;
    if (!eligible.has(slug) || !preToken.has(slug)) return 'Ineligible board protocol ' + slug;
    if (rank !== index + 1) return 'Expected rank ' + (index + 1) + ', found ' + rank;
    if (!positiveInteger(value) || value > VALUE_CAP) return 'Invalid implied value for ' + slug;
    if (value > previous) return 'Implied value increases at rank ' + rank;
    previous = value;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12 ||
        steps.some(step => !isText(step) || step.trim().length < 20 || step.trim().length > 600)) {
      return 'Invalid farm steps for ' + slug;
    }
  }
  return ranked[0].implied_value_usd === previous ? 'All implied values are equal' : null;
}
