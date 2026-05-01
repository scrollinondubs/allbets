import { PolymarketAdapter } from "./adapters/polymarket.js";
import { KalshiAdapter } from "./adapters/kalshi.js";
import { LimitlessAdapter } from "./adapters/limitless.js";
import type { VenueAdapter } from "./adapters/types.js";
import type { DiscoveryReport, NormalizedMarket, VenueDiscoveryResult } from "./schema.js";
import { bestMatchPerVenue } from "./matcher.js";

function slim(m: NormalizedMarket): NormalizedMarket {
  return {
    venue: m.venue,
    venue_market_id: m.venue_market_id,
    event_id: m.event_id,
    event_question: m.event_question,
    question: m.question,
    outcomes: m.outcomes.map((o) => ({
      label: o.label,
      probability: Math.round(o.probability * 1000) / 1000,
      bid: o.bid,
      ask: o.ask,
      tradable_outcome_id: o.tradable_outcome_id,
    })),
    liquidity_usd: m.liquidity_usd,
    volume_usd: m.volume_usd,
    open_interest_usd: m.open_interest_usd,
    ends_at: m.ends_at,
    resolution_status: m.resolution_status,
    dispute_open_until: m.dispute_open_until,
    settlement_risk: m.settlement_risk,
    settlement_risk_reason: m.settlement_risk_reason,
    uma_resolution_statuses: m.uma_resolution_statuses,
    uma_bond: m.uma_bond,
    uma_reward: m.uma_reward,
    custom_liveness_seconds: m.custom_liveness_seconds,
    chain: m.chain,
    collateral_token: m.collateral_token,
    restricted_jurisdictions: m.restricted_jurisdictions,
    is_parlay: m.is_parlay,
    is_auto_generated: m.is_auto_generated,
    url: m.url,
  };
}

export const ADAPTERS: VenueAdapter[] = [
  new PolymarketAdapter(),
  new KalshiAdapter(),
  new LimitlessAdapter(),
];

export interface FanOutResult {
  markets: NormalizedMarket[];
  errors: Array<{ venue: string; error: string }>;
}

export async function fanOutSearch(
  query: string,
  limitPerVenue = 15,
  venues?: NormalizedMarket["venue"][],
): Promise<FanOutResult> {
  const active = ADAPTERS.filter(
    (a) => !venues || (venues as string[]).includes(a.venue),
  );
  const settled = await Promise.allSettled(
    active.map((a) => a.searchMarkets(query, limitPerVenue)),
  );
  const markets: NormalizedMarket[] = [];
  const errors: Array<{ venue: string; error: string }> = [];
  settled.forEach((r, i) => {
    const venue = active[i]!.venue;
    if (r.status === "fulfilled") {
      markets.push(...r.value);
    } else {
      errors.push({ venue, error: String(r.reason) });
    }
  });
  return { markets, errors };
}

function jurisdictionBlocks(
  venue: NormalizedMarket["venue"],
  jurisdiction: "us" | "non_us" | "unknown" | undefined,
): boolean {
  if (!jurisdiction || jurisdiction === "unknown") return false;
  if (venue === "polymarket" && jurisdiction === "us") return true;
  if (venue === "kalshi" && jurisdiction === "non_us") return true;
  return false;
}

function jurisdictionNote(
  venue: NormalizedMarket["venue"],
  jurisdiction: "us" | "non_us" | "unknown" | undefined,
): string | undefined {
  if (!jurisdiction || jurisdiction === "unknown") return undefined;
  if (venue === "polymarket" && jurisdiction === "us") {
    return "Polymarket Polygon-international is geo-blocked from the US. Use Polymarket-QCEX (CFTC-regulated) or Kalshi.";
  }
  if (venue === "kalshi" && jurisdiction === "non_us") {
    return "Kalshi requires US KYC. Non-US users cannot trade — use Polymarket or Limitless.";
  }
  return undefined;
}

function recommendVenue(
  results: VenueDiscoveryResult[],
  jurisdiction: "us" | "non_us" | "unknown" | undefined,
): { best_venue: NormalizedMarket["venue"] | null; rationale: string; trade_here_url: string | null } {
  const tradable = results.filter(
    (r) =>
      r.has_match &&
      r.best_match &&
      !r.unavailable_reason &&
      !jurisdictionBlocks(r.venue, jurisdiction),
  );
  if (tradable.length === 0) {
    return {
      best_venue: null,
      rationale: "No venue lists this hypothesis as a tradable contract right now.",
      trade_here_url: null,
    };
  }

  tradable.sort((a, b) => {
    const al = a.best_match?.liquidity_usd ?? 0;
    const bl = b.best_match?.liquidity_usd ?? 0;
    if (bl !== al) return bl - al;
    const av = a.best_match?.volume_usd ?? 0;
    const bv = b.best_match?.volume_usd ?? 0;
    return bv - av;
  });
  const top = tradable[0]!;
  const liq = top.best_match?.liquidity_usd;
  const vol = top.best_match?.volume_usd;
  const liqText = liq != null ? `$${Math.round(liq).toLocaleString()} liquidity` : "liquidity not reported";
  const volText = vol != null ? `, $${Math.round(vol).toLocaleString()} volume` : "";
  return {
    best_venue: top.venue,
    rationale: `${top.venue} has the deepest market for this hypothesis (${liqText}${volText}).`,
    trade_here_url: top.best_match?.url ?? null,
  };
}

export async function discover(
  hypothesis: string,
  jurisdiction: "us" | "non_us" | "unknown" = "unknown",
  limitPerVenue = 15,
): Promise<DiscoveryReport> {
  const { markets, errors } = await fanOutSearch(hypothesis, limitPerVenue);
  const matches = bestMatchPerVenue(hypothesis, markets, 0.25);

  const venueOrder: NormalizedMarket["venue"][] = ["polymarket", "kalshi", "limitless"];
  const per_venue: VenueDiscoveryResult[] = venueOrder.map((venue) => {
    const error = errors.find((e) => e.venue === venue)?.error;
    const blocked = jurisdictionBlocks(venue, jurisdiction);
    const note = jurisdictionNote(venue, jurisdiction);
    const best = matches.get(venue);
    if (!best) {
      const sameVenueMarkets = markets.filter((m) => m.venue === venue);
      return {
        venue,
        has_match: false,
        match_count: sameVenueMarkets.length,
        adjacent_matches: sameVenueMarkets.slice(0, 3).map(slim),
        unavailable_reason: error
          ? `venue API error: ${error}`
          : blocked
            ? "blocked by jurisdiction"
            : "no contract matched the hypothesis",
        jurisdiction_note: note,
        error,
      };
    }
    if (blocked) {
      return {
        venue,
        has_match: false,
        match_count: best.adjacent.length + 1,
        adjacent_matches: [best.market, ...best.adjacent].map(slim),
        unavailable_reason: "blocked by jurisdiction",
        jurisdiction_note: note,
      };
    }
    return {
      venue,
      has_match: true,
      match_count: best.adjacent.length + 1,
      best_match: slim(best.market),
      adjacent_matches: best.adjacent.map(slim),
      jurisdiction_note: note,
    };
  });

  return {
    hypothesis,
    jurisdiction,
    per_venue,
    recommendation: recommendVenue(per_venue, jurisdiction),
  };
}
