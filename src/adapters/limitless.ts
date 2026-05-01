import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket, ResolutionStatus } from "../schema.js";

const LIMITLESS_BASE = "https://api.limitless.exchange";

interface LimitlessMarket {
  address: string;
  title: string;
  description?: string;
  slug?: string;
  stableSlug?: string;
  prices?: number[];
  liquidity?: string | number;
  liquidityFormatted?: string;
  volume?: string | number;
  volumeFormatted?: string;
  openInterest?: string | number;
  expirationDate?: string;
  expired?: boolean;
  closed?: boolean;
  resolved?: boolean;
  automationType?: string;
  conditionId?: string;
  positionIds?: string[];
}

function n(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const x = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(x) ? x : undefined;
}

function inferResolutionStatus(m: LimitlessMarket): ResolutionStatus {
  if (m.resolved === true) return "settled";
  if (m.closed === true || m.expired === true) return "closed_pending_resolution";
  return "open";
}

function toNormalized(m: LimitlessMarket): NormalizedMarket {
  const yesProb = m.prices?.[0] != null ? m.prices[0] / 100 : 0;
  const noProb = m.prices?.[1] != null ? m.prices[1] / 100 : Math.max(0, 1 - yesProb);
  const isAuto = m.automationType === "lumy";

  return {
    venue: "limitless",
    venue_market_id: m.address,
    event_id: m.stableSlug ?? m.conditionId,
    question: m.title,
    description: m.description,
    outcomes: [
      {
        label: "YES",
        probability: yesProb,
        tradable_outcome_id: m.positionIds?.[0],
      },
      {
        label: "NO",
        probability: noProb,
        tradable_outcome_id: m.positionIds?.[1],
      },
    ],
    liquidity_usd: n(m.liquidity),
    volume_usd: n(m.volume),
    open_interest_usd: n(m.openInterest),
    ends_at: m.expirationDate,
    resolution_status: inferResolutionStatus(m),
    chain: "base",
    collateral_token: "USDC",
    is_parlay: false,
    is_auto_generated: isAuto,
    url: m.slug
      ? `https://limitless.exchange/markets/${m.slug}`
      : `https://limitless.exchange/markets/${m.address}`,
    raw: m,
  };
}

function unwrap(raw: unknown): LimitlessMarket[] {
  if (Array.isArray(raw)) return raw as LimitlessMarket[];
  const obj = raw as { data?: LimitlessMarket[]; markets?: LimitlessMarket[] };
  return obj.data ?? obj.markets ?? [];
}

export class LimitlessAdapter implements VenueAdapter {
  readonly venue = "limitless" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    const res = await fetch(`${LIMITLESS_BASE}/markets/active`);
    if (!res.ok) throw new Error(`limitless search failed: ${res.status}`);
    const list = unwrap(await res.json());
    const q = query.toLowerCase();
    return list
      .filter((m) => m.title.toLowerCase().includes(q))
      .filter((m) => m.automationType !== "lumy")
      .slice(0, limit)
      .map(toNormalized);
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const res = await fetch(`${LIMITLESS_BASE}/markets/${venueMarketId}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`limitless getMarket failed: ${res.status}`);
    const json = (await res.json()) as LimitlessMarket;
    return toNormalized(json);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const res = await fetch(`${LIMITLESS_BASE}/markets/active`);
    if (!res.ok) throw new Error(`limitless listActive failed: ${res.status}`);
    const list = unwrap(await res.json());
    return list
      .filter((m) => m.automationType !== "lumy")
      .slice(0, limit)
      .map(toNormalized);
  }
}
