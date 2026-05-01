import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket } from "../schema.js";

const KALSHI_BASE = process.env.KALSHI_BASE ?? "https://api.elections.kalshi.com/trade-api/v2";

interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  title: string;
  subtitle?: string;
  yes_bid?: number;
  yes_ask?: number;
  last_price?: number;
  liquidity?: number;
  volume?: number;
  open_interest?: number;
  close_time?: string;
  status?: string;
}

function priceToProbability(cents?: number): number {
  if (cents == null) return 0;
  return Math.max(0, Math.min(1, cents / 100));
}

function toNormalized(m: KalshiMarket): NormalizedMarket {
  const yesProb = priceToProbability(m.last_price);
  const noProb = Math.max(0, 1 - yesProb);

  return {
    venue: "kalshi",
    venue_market_id: m.ticker,
    question: m.title,
    description: m.subtitle,
    outcomes: [
      {
        label: "YES",
        probability: yesProb,
        bid: priceToProbability(m.yes_bid),
        ask: priceToProbability(m.yes_ask),
      },
      { label: "NO", probability: noProb },
    ],
    liquidity_usd: m.liquidity != null ? m.liquidity / 100 : undefined,
    volume_usd: m.volume != null ? m.volume / 100 : undefined,
    open_interest_usd: m.open_interest != null ? m.open_interest / 100 : undefined,
    ends_at: m.close_time,
    url: `https://kalshi.com/markets/${m.event_ticker ?? m.ticker}/${m.ticker}`,
    raw: m,
  };
}

export class KalshiAdapter implements VenueAdapter {
  readonly venue = "kalshi" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("limit", String(Math.min(200, limit * 5)));
    url.searchParams.set("status", "open");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`kalshi search failed: ${res.status}`);
    }
    const json = (await res.json()) as { markets: KalshiMarket[] };
    const q = query.toLowerCase();
    const filtered = json.markets.filter(
      (m) => m.title.toLowerCase().includes(q) || (m.subtitle ?? "").toLowerCase().includes(q),
    );
    return filtered.slice(0, limit).map(toNormalized);
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const res = await fetch(`${KALSHI_BASE}/markets/${venueMarketId}`);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`kalshi getMarket failed: ${res.status}`);
    }
    const json = (await res.json()) as { market: KalshiMarket };
    return toNormalized(json.market);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("status", "open");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`kalshi listActive failed: ${res.status}`);
    }
    const json = (await res.json()) as { markets: KalshiMarket[] };
    return json.markets.slice(0, limit).map(toNormalized);
  }
}
