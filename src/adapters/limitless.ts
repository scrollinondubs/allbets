import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket } from "../schema.js";

const LIMITLESS_BASE = process.env.LIMITLESS_BASE ?? "https://api.limitless.exchange";

interface LimitlessMarket {
  address: string;
  title: string;
  description?: string;
  slug?: string;
  prices?: number[];
  liquidity?: string | number;
  volume?: string | number;
  expirationDate?: string;
  closed?: boolean;
}

function toNormalized(m: LimitlessMarket): NormalizedMarket {
  const yesProb = m.prices?.[0] != null ? m.prices[0] / 100 : 0;
  const noProb = m.prices?.[1] != null ? m.prices[1] / 100 : Math.max(0, 1 - yesProb);

  return {
    venue: "limitless",
    venue_market_id: m.address,
    question: m.title,
    description: m.description,
    outcomes: [
      { label: "YES", probability: yesProb },
      { label: "NO", probability: noProb },
    ],
    liquidity_usd: m.liquidity != null ? Number(m.liquidity) : undefined,
    volume_usd: m.volume != null ? Number(m.volume) : undefined,
    ends_at: m.expirationDate,
    url: m.slug
      ? `https://limitless.exchange/markets/${m.slug}`
      : `https://limitless.exchange/markets/${m.address}`,
    raw: m,
  };
}

export class LimitlessAdapter implements VenueAdapter {
  readonly venue = "limitless" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    const url = new URL(`${LIMITLESS_BASE}/markets/active`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`limitless search failed: ${res.status}`);
    }
    const raw = await res.json();
    const list: LimitlessMarket[] = Array.isArray(raw)
      ? (raw as LimitlessMarket[])
      : ((raw as { data?: LimitlessMarket[] }).data ?? []);

    const q = query.toLowerCase();
    return list
      .filter((m) => m.title.toLowerCase().includes(q))
      .slice(0, limit)
      .map(toNormalized);
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const res = await fetch(`${LIMITLESS_BASE}/markets/${venueMarketId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`limitless getMarket failed: ${res.status}`);
    }
    const json = (await res.json()) as LimitlessMarket;
    return toNormalized(json);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const url = new URL(`${LIMITLESS_BASE}/markets/active`);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`limitless listActive failed: ${res.status}`);
    }
    const raw = await res.json();
    const list: LimitlessMarket[] = Array.isArray(raw)
      ? (raw as LimitlessMarket[])
      : ((raw as { data?: LimitlessMarket[] }).data ?? []);
    return list.slice(0, limit).map(toNormalized);
  }
}
