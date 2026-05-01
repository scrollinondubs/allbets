import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket, ResolutionStatus } from "../schema.js";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface GammaEvent {
  id: string;
  title?: string;
  slug?: string;
}

interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  clobTokenIds?: string;
  conditionId?: string;
  liquidity?: string;
  volume?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
  negRisk?: boolean;
  events?: GammaEvent[];
  umaResolutionStatus?: string;
  umaResolutionStatuses?: string;
  customLiveness?: string;
  acceptingOrders?: boolean;
}

function parseJsonArray(s: string | undefined): string[] {
  if (!s) return [];
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

function inferResolutionStatus(m: GammaMarket): ResolutionStatus {
  if (m.closed === true) {
    const status = (m.umaResolutionStatus ?? "").toLowerCase();
    if (status.includes("dispute")) return "in_dispute";
    if (status === "resolved" || status === "settled") return "settled";
    return "closed_pending_resolution";
  }
  if (m.acceptingOrders === false) return "closed_pending_resolution";
  return "open";
}

function toNormalized(m: GammaMarket): NormalizedMarket {
  const labels = parseJsonArray(m.outcomes);
  const prices = parseJsonArray(m.outcomePrices).map((p) => Number(p));
  const tokenIds = parseJsonArray(m.clobTokenIds);
  const event = m.events?.[0];

  return {
    venue: "polymarket",
    venue_market_id: m.id,
    event_id: event?.id ?? m.conditionId,
    event_question: event?.title,
    question: m.question,
    description: m.description,
    outcomes: labels.map((label, i) => ({
      label,
      probability: prices[i] ?? 0,
      tradable_outcome_id: tokenIds[i],
    })),
    liquidity_usd: m.liquidity ? Number(m.liquidity) : undefined,
    volume_usd: m.volume ? Number(m.volume) : undefined,
    ends_at: m.endDate,
    resolution_status: inferResolutionStatus(m),
    dispute_open_until: m.customLiveness,
    chain: "polygon",
    collateral_token: "USDC.e",
    restricted_jurisdictions: ["US"],
    is_parlay: false,
    is_auto_generated: false,
    url: `https://polymarket.com/event/${event?.slug ?? m.slug}`,
    raw: m,
  };
}

export class PolymarketAdapter implements VenueAdapter {
  readonly venue = "polymarket" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("q", query);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`polymarket search failed: ${res.status}`);
    const json = (await res.json()) as GammaMarket[];
    return json.slice(0, limit).map(toNormalized);
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const res = await fetch(`${GAMMA_BASE}/markets/${venueMarketId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`polymarket getMarket failed: ${res.status}`);
    const json = (await res.json()) as GammaMarket;
    return toNormalized(json);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`polymarket listActive failed: ${res.status}`);
    const json = (await res.json()) as GammaMarket[];
    return json.slice(0, limit).map(toNormalized);
  }
}
