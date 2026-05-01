import type { VenueAdapter } from "./types.js";
import type { NormalizedMarket, ResolutionStatus } from "../schema.js";

const KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2";
const FETCH_TIMEOUT_MS = 8000;

function timed(): RequestInit {
  return { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
}

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

interface KalshiEvent {
  event_ticker: string;
  series_ticker?: string;
  title?: string;
  markets?: KalshiMarket[];
}

interface KalshiSeries {
  ticker: string;
  title?: string;
}

interface KalshiEventsResponse {
  events?: KalshiEvent[];
  cursor?: string;
}

interface KalshiSeriesResponse {
  series?: KalshiSeries[];
  cursor?: string;
}

const PARLAY_PREFIXES = ["KXMVE"];

const SYNONYMS: Record<string, string[]> = {
  fed: ["fed", "fomc", "powell", "federal", "reserve"],
  cut: ["cut", "decrease", "lower", "reduce"],
  raise: ["raise", "hike", "increase"],
  rate: ["rate", "rates", "interest", "bps"],
};

function expandTokens(tokens: string[]): string[] {
  const out = new Set<string>();
  for (const t of tokens) {
    out.add(t);
    for (const group of Object.values(SYNONYMS)) {
      if (group.includes(t)) for (const v of group) out.add(v);
    }
  }
  return Array.from(out);
}

function isParlay(ticker: string, marketType?: string, seriesTicker?: string): boolean {
  if (marketType === "multi_leg") return true;
  if (PARLAY_PREFIXES.some((p) => ticker.startsWith(p))) return true;
  if (seriesTicker && PARLAY_PREFIXES.some((p) => seriesTicker.startsWith(p))) return true;
  return false;
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

function toNormalized(m: KalshiMarket, eventTitle?: string): NormalizedMarket {
  const yesProb = clampProbability(n(m.last_price_dollars));
  const noProb = Math.max(0, 1 - yesProb);
  const parlay = isParlay(m.ticker, m.market_type);

  return {
    venue: "kalshi",
    venue_market_id: m.ticker,
    event_id: m.event_ticker,
    event_question: eventTitle,
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
    is_parlay: parlay,
    is_auto_generated: false,
    url: `https://kalshi.com/markets/${m.event_ticker ?? m.ticker}/${m.ticker}`,
    raw: m,
  };
}

async function fetchEventsByCursor(maxEvents = 200): Promise<KalshiEvent[]> {
  const out: KalshiEvent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 4; page++) {
    const url = new URL(`${KALSHI_BASE}/events`);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    url.searchParams.set("with_nested_markets", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, timed());
    if (!res.ok) break;
    const json = (await res.json()) as KalshiEventsResponse;
    const events = json.events ?? [];
    for (const e of events) {
      if (e.series_ticker && PARLAY_PREFIXES.some((p) => e.series_ticker!.startsWith(p))) continue;
      if (e.event_ticker && PARLAY_PREFIXES.some((p) => e.event_ticker.startsWith(p))) continue;
      out.push(e);
      if (out.length >= maxEvents) return out;
    }
    if (!json.cursor || json.cursor === cursor || events.length === 0) break;
    cursor = json.cursor;
  }
  return out;
}

async function fetchEventsForSeries(seriesTicker: string): Promise<KalshiEvent[]> {
  const url = new URL(`${KALSHI_BASE}/events`);
  url.searchParams.set("series_ticker", seriesTicker);
  url.searchParams.set("status", "open");
  url.searchParams.set("limit", "50");
  url.searchParams.set("with_nested_markets", "true");
  const res = await fetch(url, timed());
  if (!res.ok) return [];
  const json = (await res.json()) as KalshiEventsResponse;
  return json.events ?? [];
}

async function findMatchingSeries(queryTokens: string[]): Promise<string[]> {
  if (queryTokens.length === 0) return [];
  const expanded = expandTokens(queryTokens.map((t) => t.toLowerCase()));
  const url = new URL(`${KALSHI_BASE}/series`);
  url.searchParams.set("limit", "200");
  url.searchParams.set("include_product_metadata", "false");
  const res = await fetch(url, timed());
  if (!res.ok) return [];
  const json = (await res.json()) as KalshiSeriesResponse;
  const series = json.series ?? [];

  const scored = series.map((s) => {
    const haystack = `${s.title ?? ""} ${s.ticker ?? ""}`.toLowerCase();
    let score = 0;
    for (const t of expanded) if (haystack.includes(t)) score += 1;
    return { ticker: s.ticker, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, 3).map((s) => s.ticker);
}

function flattenMarkets(events: KalshiEvent[]): Array<{ market: KalshiMarket; eventTitle?: string }> {
  const seen = new Set<string>();
  const out: Array<{ market: KalshiMarket; eventTitle?: string }> = [];
  for (const e of events) {
    for (const m of e.markets ?? []) {
      if (seen.has(m.ticker)) continue;
      if (isParlay(m.ticker, m.market_type, e.series_ticker)) continue;
      seen.add(m.ticker);
      out.push({ market: m, eventTitle: e.title });
    }
  }
  return out;
}

export class KalshiAdapter implements VenueAdapter {
  readonly venue = "kalshi" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    const tokens = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);

    // Series-targeted fetch + general events fetch in parallel
    const [seriesTickers, generalEvents] = await Promise.all([
      findMatchingSeries(tokens),
      fetchEventsByCursor(200),
    ]);

    const seriesEvents = await Promise.all(seriesTickers.map(fetchEventsForSeries));
    const allEvents: KalshiEvent[] = [...seriesEvents.flat(), ...generalEvents];
    const flat = flattenMarkets(allEvents);

    if (tokens.length === 0) return flat.slice(0, limit).map((x) => toNormalized(x.market, x.eventTitle));

    const expandedTokens = expandTokens(tokens);
    const scored = flat.map((x) => {
      const haystack = `${x.market.title ?? ""} ${x.market.subtitle ?? ""} ${x.eventTitle ?? ""}`.toLowerCase();
      let score = 0;
      for (const t of expandedTokens) if (haystack.includes(t)) score += 1;
      return { x, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored
      .filter((s) => s.score > 0)
      .slice(0, limit)
      .map((s) => toNormalized(s.x.market, s.x.eventTitle));
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const ticker = venueMarketId.trim();
    const res = await fetch(`${KALSHI_BASE}/markets/${encodeURIComponent(ticker)}`, timed());
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`kalshi getMarket failed: ${res.status}`);
    const json = (await res.json()) as { market: KalshiMarket };
    if (!json.market) return null;
    return toNormalized(json.market);
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const events = await fetchEventsByCursor(200);
    const flat = flattenMarkets(events);
    return flat.slice(0, limit).map((x) => toNormalized(x.market, x.eventTitle));
  }
}
