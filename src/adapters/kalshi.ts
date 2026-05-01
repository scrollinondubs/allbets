import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket, ResolutionStatus } from "../schema.js";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";

interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  market_type?: string;
  title: string;
  subtitle?: string;
  yes_bid_dollars?: string | number;
  yes_ask_dollars?: string | number;
  last_price_dollars?: string | number;
  liquidity_dollars?: string | number;
  volume_fp?: string | number;
  volume_24h_fp?: string | number;
  notional_value_dollars?: string | number;
  open_interest_fp?: string | number;
  close_time?: string;
  status?: string;
}

function n(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const x = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(x) ? x : undefined;
}

function clampProbability(p: number | undefined): number {
  if (p === undefined) return 0;
  return Math.max(0, Math.min(1, p));
}

function statusToResolution(status?: string): ResolutionStatus {
  switch ((status ?? "").toLowerCase()) {
    case "open":
    case "active":
      return "open";
    case "closed":
    case "determined":
      return "closed_pending_resolution";
    case "settled":
    case "resolved":
      return "settled";
    default:
      return "unknown";
  }
}

function toNormalized(m: KalshiMarket): NormalizedMarket {
  const yesProb = clampProbability(n(m.last_price_dollars));
  const noProb = Math.max(0, 1 - yesProb);
  const isParlay = m.ticker.startsWith("KXMVE") || m.market_type === "multi_leg";

  return {
    venue: "kalshi",
    venue_market_id: m.ticker,
    event_id: m.event_ticker,
    question: m.title,
    description: m.subtitle,
    outcomes: [
      {
        label: "YES",
        probability: yesProb,
        bid: clampProbability(n(m.yes_bid_dollars)),
        ask: clampProbability(n(m.yes_ask_dollars)),
        tradable_outcome_id: `${m.ticker}:YES`,
      },
      {
        label: "NO",
        probability: noProb,
        tradable_outcome_id: `${m.ticker}:NO`,
      },
    ],
    liquidity_usd: n(m.liquidity_dollars),
    volume_usd: n(m.volume_fp) ?? n(m.notional_value_dollars),
    open_interest_usd: n(m.open_interest_fp),
    ends_at: m.close_time,
    resolution_status: statusToResolution(m.status),
    settlement_risk: "low",
    settlement_risk_reason: "kalshi central clearinghouse, no dispute window",
    chain: "centralized",
    collateral_token: "USD",
    restricted_jurisdictions: ["non-US"],
    is_parlay: isParlay,
    is_auto_generated: false,
    url: `https://kalshi.com/markets/${m.event_ticker ?? m.ticker}/${m.ticker}`,
    raw: m,
  };
}

export class KalshiAdapter implements VenueAdapter {
  readonly venue = "kalshi" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("status", "open");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`kalshi search failed: ${res.status}`);
    const json = (await res.json()) as { markets: KalshiMarket[] };
    const q = query.toLowerCase();
    const filtered = json.markets
      .filter((m) => !m.ticker.startsWith("KXMVE"))
      .filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.subtitle ?? "").toLowerCase().includes(q),
      );
    return filtered.slice(0, limit).map(toNormalized);
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const res = await fetch(`${KALSHI_BASE}/markets/${venueMarketId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`kalshi getMarket failed: ${res.status}`);
    const json = (await res.json()) as { market: KalshiMarket };
    return toNormalized(json.market);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const url = new URL(`${KALSHI_BASE}/markets`);
    url.searchParams.set("limit", "200");
    url.searchParams.set("status", "open");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`kalshi listActive failed: ${res.status}`);
    const json = (await res.json()) as { markets: KalshiMarket[] };
    return json.markets
      .filter((m) => !m.ticker.startsWith("KXMVE"))
      .slice(0, limit)
      .map(toNormalized);
  }
}
