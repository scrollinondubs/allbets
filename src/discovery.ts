import { PolymarketAdapter } from "./adapters/polymarket.js";
import { KalshiAdapter } from "./adapters/kalshi.js";
import { LimitlessAdapter } from "./adapters/limitless.js";
import type { VenueAdapter } from "./adapters/types.js";
import type { DiscoveryReport, NormalizedMarket, VenueDiscoveryResult } from "./schema.js";
import { bestMatchPerVenue } from "./matcher.js";

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
      (jurisdiction === undefined ||
        jurisdiction === "unknown" ||
        !(r.venue === "kalshi" && jurisdiction === "non_us") &&
          !(r.venue === "polymarket" && jurisdiction === "us")),
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
    const best = matches.get(venue);
    if (!best) {
      const sameVenueMarkets = markets.filter((m) => m.venue === venue);
      return {
        venue,
        has_match: false,
        match_count: sameVenueMarkets.length,
        adjacent_matches: sameVenueMarkets.slice(0, 3),
        unavailable_reason: error
          ? `venue API error: ${error}`
          : "no contract matched the hypothesis",
        jurisdiction_note: jurisdictionNote(venue, jurisdiction),
        error,
      };
    }
    return {
      venue,
      has_match: true,
      match_count: best.adjacent.length + 1,
      best_match: best.market,
      adjacent_matches: best.adjacent,
      jurisdiction_note: jurisdictionNote(venue, jurisdiction),
    };
  });

  return {
    hypothesis,
    jurisdiction,
    per_venue,
    recommendation: recommendVenue(per_venue, jurisdiction),
  };
}
