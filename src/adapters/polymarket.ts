import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket } from "../schema.js";

const GAMMA_BASE = "https://gamma-api.polymarket.com";

interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  liquidity?: string;
  volume?: string;
  endDate?: string;
  active?: boolean;
  closed?: boolean;
}

function parseJsonArray(s: string | undefined): string[] {
  if (!s) return [];
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

function toNormalized(m: GammaMarket): NormalizedMarket {
  const labels = parseJsonArray(m.outcomes);
  const prices = parseJsonArray(m.outcomePrices).map((p) => Number(p));

  return {
    venue: "polymarket",
    venue_market_id: m.id,
    question: m.question,
    description: m.description,
    outcomes: labels.map((label, i) => ({
      label,
      probability: prices[i] ?? 0,
    })),
    liquidity_usd: m.liquidity ? Number(m.liquidity) : undefined,
    volume_usd: m.volume ? Number(m.volume) : undefined,
    ends_at: m.endDate,
    url: `https://polymarket.com/event/${m.slug}`,
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
    if (!res.ok) {
      throw new Error(`polymarket search failed: ${res.status}`);
    }
    const json = (await res.json()) as GammaMarket[];
    return json.slice(0, limit).map(toNormalized);
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const res = await fetch(`${GAMMA_BASE}/markets/${venueMarketId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`polymarket getMarket failed: ${res.status}`);
    }
    const json = (await res.json()) as GammaMarket;
    return toNormalized(json);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "volume");
    url.searchParams.set("ascending", "false");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`polymarket listActive failed: ${res.status}`);
    }
    const json = (await res.json()) as GammaMarket[];
    return json.slice(0, limit).map(toNormalized);
  }
}
