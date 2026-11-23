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

// Each category supplies a TVL multiple and the first and recurring actions for a farm.
const categories = [
  { key: 'lending', match: /lend|cdp|collateral/i, multiple: 0.34,
    entry: 'Supply a supported stablecoin to a market with available withdrawals.',
    weekly: 'Check available liquidity and add a small supply tranche if eligible.' },
  { key: 'dex', match: /dex|liquidity manager/i, multiple: 0.39,
    entry: 'Split the budget across both assets of a liquid pool and mint an LP position.',
    weekly: 'Check the LP range and rebalance only if it is out of range and the rules permit it.' },
  { key: 'bridge', match: /bridge/i, multiple: 0.12,
    entry: 'Quote a transfer between two supported networks, check the destination address, and send a small first transfer.',
    weekly: 'Confirm settlement and make one additional eligible transfer if you need to move funds.' },
  { key: 'staking', match: /stak/i, multiple: 0.17,
    entry: 'Stake a supported asset and verify the receipt, withdrawal delay, and minimum redemption size.',
    weekly: 'Check validator and receipt status and top up only if the points rules count it.' },
  { key: 'derivatives', match: /perpetual|derivative|options|basis trading|synthetic/i, multiple: 0.31,
    entry: 'Post a small isolated margin balance and use it for one minimum-size hedge after checking funding and liquidation terms.',
    weekly: 'Review margin and funding, then reduce or adjust the hedge if needed under the eligibility rules.' },
  { key: 'prediction', match: /prediction/i, multiple: 0.29,
    entry: 'Read the settlement criteria and use a small part of the budget for one position in a liquid market.',
    weekly: 'Check settlement updates and review eligible open markets before placing any new order.' },
  { key: 'stable', match: /stable|rwa|reserve currency/i, multiple: 0.15,
    entry: 'Check access and redemption terms, then use the smallest supported mint or subscribe order.',
    weekly: 'Check redemption liquidity and confirm whether the balance still earns credit.' },
  { key: 'insurance', match: /insurance/i, multiple: 0.20,
    entry: 'Quote a short policy against an exposure you already hold and pay the premium only within budget.',
    weekly: 'Check policy dates and coverage, renewing only if the exposure and published eligibility continue.' },
  { key: 'launchpad', match: /launchpad/i, multiple: 0.22,
    entry: 'Read the allocation rules for an open sale and commit only the minimum eligible amount within budget.',
    weekly: 'Check allocation status and track the refund and vesting deadlines.' },
];

const fallback = {
  key: 'other', multiple: 0.19,
  entry: 'Find the app’s documented primary action and test its smallest reversible position with a visible exit quote.',
  weekly: 'Verify the receipt and repeat the smallest documented eligible action only if it serves the position.',
};

export const MODEL = {
  category_multiples: Object.fromEntries([...categories, fallback].map(({ key, multiple }) => [key, multiple])),
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
const compareSlug = (a: { slug: string }, b: { slug: string }) => a.slug < b.slug ? -1 : Number(a.slug > b.slug);
const categoryFor = (p: SnapshotProtocol) => categories.find(({ match }) => match.test(p.category ?? '')) ?? fallback;
const versionSuffix = /\s(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)$/i;

function utcDay(date: string | null): number {
  if (date === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NaN;
  const ms = Date.parse(date);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : NaN;
}

export function ageDays(asOf: string, listedAt: string | null): number | null {
  const days = (utcDay(asOf) - utcDay(listedAt)) / 86_400_000;
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category?.toUpperCase() !== 'CEX' && !versionSuffix.test(p.name.trimEnd());
}

// Score = round(TVL × category multiple × (maturity × growth + chain bonus − young discount)).
// Maturity uses log1p(age) and caps at four years. The extra discount tapers over the first 75 days.
// A shrinking deposit base gets twice the weight of a growing one because a one-week inflow can reverse;
// the growth cap and square-root response further limit the weight of short-term spikes.
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL) {
  const age = ageDays(asOf, p.listed_at);
  const days = age ?? model.unknown_age_days;
  const baseMultiple = model.category_multiples[categoryFor(p).key];
  const growthPct = Math.max(model.growth_floor, Math.min(model.growth_cap, p.change_7d ?? 0));
  const growthMult = 1 + Math.sign(growthPct) * Math.sqrt(Math.abs(growthPct) / 100) *
    (growthPct < 0 ? model.loss_weight : model.gain_weight);
  const maturityMult = model.maturity_floor + model.maturity_range *
    Math.log1p(Math.min(days, model.maturity_days)) / Math.log1p(model.maturity_days);
  const extraChains = Math.max(0, new Set(p.chains).size - 1);
  const chainBonus = Math.min(extraChains, model.extra_chain_cap) * model.extra_chain_bonus;
  const youngDiscount = model.young_discount * Math.max(0, 1 - days / model.young_days);
  const value = p.tvl_usd * baseMultiple * (maturityMult * growthMult + chainBonus - youngDiscount);
  return { implied: Math.max(1, Math.min(VALUE_CAP, Math.round(value))), age, baseMultiple,
    growthPct, growthMult, maturityMult, chainBonus, youngDiscount };
}

export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const category = categoryFor(p);
  const chains = [...new Set(p.chains)];
  const chain = chains[0] ?? 'a network confirmed in the app docs';
  const route = category.key === 'bridge' && chains.length > 1 ? ` from ${chain} to ${chains[1]}` : ` on ${chain}`;
  const cautious = ['derivatives', 'prediction', 'launchpad', 'other'].includes(category.key);
  const liquidityTier = Math.max(0, Math.floor(Math.log10(Math.max(1, p.tvl_usd) / 5_000_000)));
  const capital = Math.min(cautious ? 35 : 125, (cautious ? 15 : 25) + liquidityTier * 15);
  const holdDays = age === null || age < 120 ? 14 : age < 540 ? 21 : 28;
  const gas = chain === 'Ethereum' ? 15 : 3;
  return [
    `Create a fresh wallet for ${chain}, store the recovery phrase offline, and verify the app domain and network against its docs. Budget $0 for setup and set aside up to $${gas} for initial gas. Allow 10 minutes.`,
    `${category.entry} Work${route} with up to $${capital} in capital and a $${gas} gas ceiling. Skip if the minimum or live fee quote exceeds the budget. Allow 15 minutes.`,
    `Read the published qualification rules before spending gas. ${category.weekly} Review once a week for 5 minutes, with up to $${gas} for gas only if transacting.`,
    `Use ${holdDays} days as a review window. For transfers, sales, or insurance, track settlement, unlock, or expiry instead of forcing a hold. Schedule two 5-minute checks and budget up to $${gas} for an on-chain exit.`,
    `Check the app’s official points or rewards page for your wallet and any claim window. Read-only checks cost $0. If there is a verified claim, allow 5 minutes and quote gas before signing; reject blanket approvals.`,
    `Log the chain, entry and exit quotes, transaction IDs, fees, and any published eligibility rule in a local spreadsheet. Allow 5 minutes per update at $0.`,
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

function earlyProtocols(snapshot: Snapshot, watchlist: Set<string>): SnapshotProtocol[] {
  return snapshot.protocols
    .filter(p => !watchlist.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareSlug(a, b))
    .slice(0, EARLY_ROWS);
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const watched = snapshot.protocols.filter(p => watchlist.has(p.slug) && isPreToken(p));
  return [...watched, ...earlyProtocols(snapshot, watchlist)]
    .map(p => ({ p, score: impliedValue(p, snapshot.as_of, model) }))
    .sort((a, b) => b.score.implied - a.score.implied || compareSlug(a.p, b.p))
    .map(({ p, score }, index) => ({
      ...p,
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
      farm_steps: farmSteps(p, score.age),
    }));
}

export function liveRows(snapshot: Snapshot) {
  return snapshot.protocols
    .filter(p => !isPreToken(p))
    .sort((a, b) => (b.mcap_usd ?? -1) - (a.mcap_usd ?? -1) || compareSlug(a, b))
    .slice(0, LIVE_ROWS)
    .map(({ slug, name, category, chains, tvl_usd, mcap_usd, change_7d, symbol }) => ({
      slug, name, category, chains, tvl_usd, mcap_usd, change_7d, symbol,
    }));
}

function radarRow(row: BoardRow, watchlist: Set<string>) {
  const { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd,
    listed_at, age_days, implied_value_usd, model, farm_steps } = row;
  return { rank, slug, name, category, chains, tvl_usd, change_7d, mcap_usd, listed_at, age_days,
    implied_value_usd, watchlist: watchlist.has(slug), ...model, farm_steps };
}

export type RadarRow = ReturnType<typeof radarRow>;
export type LiveRow = ReturnType<typeof liveRows>[number];

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL) {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const rows = board.map(row => radarRow(row, watchlist));
  return {
    board,
    radar: {
      as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
      model, model_version: MODEL_VERSION, watchlist_size: watchlist.size, board_size: rows.length,
      early_size: rows.filter(row => !row.watchlist).length, live_size: live.length, rows, live,
    },
  };
}

export type RadarData = ReturnType<typeof buildRadar>['radar'];

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const nullableText = (value: unknown): value is string | null => value === null || isText(value);
const nullableNumber = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value));
const validSlug = (value: unknown): value is string => isText(value) && /^\S{1,128}$/.test(value);

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Invalid snapshot JSON');
  }
  if (!isObject(raw) || !isText(raw.as_of) || !Number.isFinite(utcDay(raw.as_of)) ||
      !isText(raw.source) || typeof raw.floor_usd !== 'number' ||
      !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0 ||
      !Array.isArray(raw.watchlist) || !raw.watchlist.every(validSlug) ||
      !Array.isArray(raw.protocols)) {
    throw new Error('Invalid snapshot metadata, watchlist or protocols array');
  }
  const slugs = new Set<string>();
  const protocols = raw.protocols.map((p: unknown, index): SnapshotProtocol => {
    if (!isObject(p) || !validSlug(p.slug) || !isText(p.name) || !p.name.trim() ||
        !nullableText(p.category) || !Array.isArray(p.chains) || !p.chains.every(isText) ||
        typeof p.tvl_usd !== 'number' || !Number.isSafeInteger(p.tvl_usd) || p.tvl_usd <= 0 ||
        !nullableNumber(p.change_7d) || !nullableNumber(p.mcap_usd) ||
        !nullableText(p.listed_at) || !nullableText(p.gecko_id) || !nullableText(p.symbol)) {
      throw new Error(`Invalid snapshot protocol at index ${index}`);
    }
    if (slugs.has(p.slug)) throw new Error(`Duplicate snapshot protocol ${p.slug}`);
    slugs.add(p.slug);
    return {
      slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd,
      change_7d: p.change_7d, mcap_usd: p.mcap_usd, listed_at: p.listed_at,
      gecko_id: p.gecko_id, symbol: p.symbol,
    };
  });
  if (new Set(raw.watchlist).size !== raw.watchlist.length) throw new Error('Duplicate watchlist slug');
  return { as_of: raw.as_of, source: raw.source, floor_usd: raw.floor_usd, protocols, watchlist: raw.watchlist };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map(row => row.slug));
  const missing = snapshot.watchlist.find(slug => !slugs.has(slug));
  if (missing !== undefined) return `Missing watchlist protocol ${missing}`;
  if (board.length !== BOARD_ROWS) return `Expected ${BOARD_ROWS} board rows, found ${board.length}`;
  if (slugs.size !== board.length) return 'Duplicate board slug';
  const eligible = new Set([
    ...snapshot.watchlist,
    ...earlyProtocols(snapshot, new Set(snapshot.watchlist)).map(p => p.slug),
  ]);
  const preToken = new Set(snapshot.protocols.filter(isPreToken).map(p => p.slug));
  const ranked = [...board].sort((a, b) => a.rank - b.rank);
  let previous = Infinity;
  for (const [index, row] of ranked.entries()) {
    if (!eligible.has(row.slug) || !preToken.has(row.slug)) return `Ineligible board protocol ${row.slug}`;
    if (row.rank !== index + 1) return `Expected rank ${index + 1}, found ${row.rank}`;
    const value = row.implied_value_usd;
    if (!Number.isSafeInteger(value) || value < 1 || value > VALUE_CAP) return `Invalid implied value for ${row.slug}`;
    if (value > previous) return `Implied value increases at rank ${row.rank}`;
    previous = value;
    const steps = row.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12 ||
        steps.some(step => !isText(step) || step.trim().length < 20 || step.trim().length > 600)) {
      return `Invalid farm steps for ${row.slug}`;
    }
  }
  return ranked[0].implied_value_usd === previous ? 'All implied values are equal' : null;
}
