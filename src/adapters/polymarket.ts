import type { VenueAdapter } from "./types.js";
import type {
  HistoryPoint,
  HistoryRange,
  MarketHistory,
  NormalizedMarket,
  ResolutionStatus,
  SettlementRisk,
} from "../schema.js";
import { rangeToWindow, summarizeSeries } from "./history-util.js";

const GAMMA_BASE = "https://gamma-api.polymarket.com";
const FETCH_TIMEOUT_MS = 8000;

function timed(): RequestInit {
  return { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) };
}

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
  umaBond?: string;
  umaReward?: string;
  acceptingOrders?: boolean;
  acceptingOrdersTimestamp?: string;
  // Fee + tick fields exposed by the CLOB market info endpoint. Gamma sometimes
  // surfaces these directly on the market record; when missing we leave them
  // undefined and pm_ev falls back to a default.
  makerBaseFee?: string | number;
  takerBaseFee?: string | number;
  mbf?: string | number;
  tbf?: string | number;
  orderPriceMinTickSize?: string | number;
  orderMinSize?: string | number;
}

function parseJsonArray(s: string | undefined): string[] {
  if (!s) return [];
  try {
    return JSON.parse(s);
  } catch {
    return [];
  }
}

function parseUmaStatuses(m: GammaMarket): string[] {
  if (m.umaResolutionStatuses) {
    try {
      const arr = JSON.parse(m.umaResolutionStatuses);
      if (Array.isArray(arr)) return arr.map(String).map((s) => s.toLowerCase());
    } catch {
      // fall through
    }
  }
  return m.umaResolutionStatus ? [m.umaResolutionStatus.toLowerCase()] : [];
}

function n(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null) return undefined;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : undefined;
}

function inferResolutionStatus(m: GammaMarket): ResolutionStatus {
  const statuses = parseUmaStatuses(m);
  if (statuses.some((s) => s.includes("dispute"))) return "in_dispute";
  if (m.closed === true) {
    if (statuses.some((s) => s === "resolved" || s === "settled")) return "settled";
    return "closed_pending_resolution";
  }
  if (m.acceptingOrders === false) return "closed_pending_resolution";
  return "open";
}

function computeDisputeOpenUntil(m: GammaMarket): string | undefined {
  const statuses = parseUmaStatuses(m);
  const flagged = statuses.some((s) => s.includes("propose") || s.includes("dispute"));
  if (!flagged) return undefined;
  const liveness = n(m.customLiveness);
  const acceptingTs = n(m.acceptingOrdersTimestamp);
  if (!liveness || !acceptingTs) return undefined;
  const ms = acceptingTs * 1000 + liveness * 1000;
  return new Date(ms).toISOString();
}

interface SettlementJudgement {
  risk: SettlementRisk;
  reason: string;
}

function computeSettlementRisk(
  m: GammaMarket,
  statuses: string[],
  disputeOpenUntil: string | undefined,
): SettlementJudgement {
  const liveness = n(m.customLiveness);
  const bond = n(m.umaBond);
  const description = m.description ?? "";

  // HIGH: explicit dispute / proposed status, OR active dispute window not yet closed
  if (statuses.some((s) => s.includes("dispute"))) {
    return { risk: "high", reason: "uma_resolution_statuses contains 'disputed'" };
  }
  if (statuses.some((s) => s.includes("propose") || s.includes("pending"))) {
    return { risk: "high", reason: "uma_resolution_statuses contains 'proposed' (not yet finalized)" };
  }
  if (disputeOpenUntil) {
    const stillOpen = Date.parse(disputeOpenUntil) > Date.now();
    if (stillOpen) {
      return { risk: "high", reason: `uma dispute window open until ${disputeOpenUntil}` };
    }
  }

  // MODERATE: long dispute window, under-bonded, or thin resolution rules
  if (liveness !== undefined && liveness > 86400) {
    return {
      risk: "moderate",
      reason: `uma dispute window > 24h (${Math.round(liveness / 3600)}h)`,
    };
  }
  if (bond !== undefined && bond > 0 && bond < 500) {
    return {
      risk: "moderate",
      reason: `uma bond under-collateralized (${bond} USDC < 500 default)`,
    };
  }
  if (description.length < 200) {
    return {
      risk: "moderate",
      reason: `polymarket resolution description thin (${description.length} chars < 200) — ambiguity risk`,
    };
  }

  return { risk: "low", reason: "uma optimistic oracle, no dispute flags, well-bonded" };
}

function toNormalized(m: GammaMarket): NormalizedMarket {
  const labels = parseJsonArray(m.outcomes);
  const prices = parseJsonArray(m.outcomePrices).map((p) => Number(p));
  const tokenIds = parseJsonArray(m.clobTokenIds);
  const event = m.events?.[0];
  const statuses = parseUmaStatuses(m);
  const disputeOpenUntil = computeDisputeOpenUntil(m);
  const judgement = computeSettlementRisk(m, statuses, disputeOpenUntil);

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
    dispute_open_until: disputeOpenUntil,
    settlement_risk: judgement.risk,
    settlement_risk_reason: judgement.reason,
    uma_resolution_statuses: statuses.length > 0 ? statuses : undefined,
    uma_bond: n(m.umaBond),
    uma_reward: n(m.umaReward),
    custom_liveness_seconds: n(m.customLiveness),
    chain: "polygon",
    collateral_token: "USDC.e",
    restricted_jurisdictions: ["US"],
    is_parlay: false,
    is_auto_generated: false,
    maker_fee_bps: pickBps(m.mbf, m.makerBaseFee),
    taker_fee_bps: pickBps(m.tbf, m.takerBaseFee),
    min_tick_size: n(m.orderPriceMinTickSize),
    min_order_size_usd: n(m.orderMinSize),
    url: `https://polymarket.com/event/${m.slug ?? event?.slug}`,
    raw: m,
  };
}

// Polymarket exposes fees in basis points sometimes as `mbf`/`tbf` (CLOB-style)
// and sometimes as `makerBaseFee`/`takerBaseFee` (camelCase Gamma style). Some
// older records carry the value as a decimal fraction (0.02 = 2%) — detect and
// normalize. Returns undefined if no fee data is available.
function pickBps(...candidates: Array<string | number | undefined>): number | undefined {
  for (const c of candidates) {
    const x = n(c);
    if (x === undefined) continue;
    // If the raw value is < 1, treat it as a decimal fraction (e.g. 0.02 → 200 bps).
    // Otherwise treat it as basis points already.
    return x < 1 ? Math.round(x * 10000) : x;
  }
  return undefined;
}

export class PolymarketAdapter implements VenueAdapter {
  readonly venue = "polymarket" as const;

  async searchMarkets(query: string, limit = 10): Promise<NormalizedMarket[]> {
    // Polymarket's Gamma `?q=` parameter is unreliable — it returns the same
    // volume-sorted GTA-VI mega-event regardless of query value. Pull a broad
    // active-by-volume slice and filter client-side instead.
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", "300");
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");

    const res = await fetch(url, timed());
    if (!res.ok) throw new Error(`polymarket search failed: ${res.status}`);
    const json = (await res.json()) as GammaMarket[];

    const tokens = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2);

    if (tokens.length === 0) return json.slice(0, limit).map(toNormalized);

    const scored = json.map((m) => {
      const haystack = `${m.question ?? ""} ${m.description ?? ""} ${
        (m.events?.[0]?.title ?? "")
      }`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (haystack.includes(t)) score += 1;
      }
      return { m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const matched = scored.filter((s) => s.score > 0).slice(0, limit);
    return matched.map((s) => toNormalized(s.m));
  }

  async getMarket(venueMarketId: string): Promise<NormalizedMarket | null> {
    const trimmed = venueMarketId.trim();
    const isNumericId = /^\d+$/.test(trimmed);

    if (isNumericId) {
      const res = await fetch(`${GAMMA_BASE}/markets/${trimmed}`, timed());
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`polymarket getMarket failed: ${res.status}`);
      const json = (await res.json()) as GammaMarket;
      return toNormalized(json);
    }

    // slug fallback: query Gamma with slug filter
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("slug", trimmed);
    url.searchParams.set("limit", "1");
    const res = await fetch(url, timed());
    if (!res.ok) throw new Error(`polymarket getMarket-by-slug failed: ${res.status}`);
    const json = (await res.json()) as GammaMarket[];
    if (Array.isArray(json) && json.length > 0) return toNormalized(json[0]!);

    // last resort: search by slug-as-query
    const search = new URL(`${GAMMA_BASE}/markets`);
    search.searchParams.set("q", trimmed.replace(/-/g, " "));
    search.searchParams.set("limit", "1");
    const sr = await fetch(search, timed());
    if (!sr.ok) return null;
    const sj = (await sr.json()) as GammaMarket[];
    if (Array.isArray(sj) && sj.length > 0) return toNormalized(sj[0]!);

    return null;
  }

  async listActive(limit = 25): Promise<NormalizedMarket[]> {
    const url = new URL(`${GAMMA_BASE}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "volume24hr");
    url.searchParams.set("ascending", "false");

    const res = await fetch(url, timed());
    if (!res.ok) throw new Error(`polymarket listActive failed: ${res.status}`);
    const json = (await res.json()) as GammaMarket[];
    return json.slice(0, limit).map(toNormalized);
  }

  // CLOB /prices-history takes a clobTokenId (the YES outcome's ERC-1155 id),
  // not the Gamma market id. Resolve through getMarket() to get tradable_outcome_id,
  // then ask CLOB for the price series.
  async getHistory(venueMarketId: string, range: HistoryRange): Promise<MarketHistory | null> {
    const market = await this.getMarket(venueMarketId);
    if (!market) return null;
    const yesTokenId = market.outcomes[0]?.tradable_outcome_id;
    const window = rangeToWindow(range);
    if (!yesTokenId) {
      return {
        market,
        range,
        resolution_minutes: window.resolution_minutes,
        source_supports_history: false,
        series: [],
        stats: null,
        note: "polymarket market is missing clobTokenIds — likely an event-aggregator entry, not a tradable market",
      };
    }
    const url = new URL("https://clob.polymarket.com/prices-history");
    url.searchParams.set("market", yesTokenId);
    url.searchParams.set("startTs", String(window.start_seconds));
    url.searchParams.set("endTs", String(window.end_seconds));
    url.searchParams.set("fidelity", String(window.resolution_minutes));

    const res = await fetch(url, timed());
    if (!res.ok) {
      return {
        market,
        range,
        resolution_minutes: window.resolution_minutes,
        source_supports_history: false,
        series: [],
        stats: null,
        note: `polymarket prices-history returned ${res.status} for clobTokenId='${yesTokenId.slice(0, 12)}...'`,
      };
    }
    const json = (await res.json()) as { history?: Array<{ t: number; p: number }> };
    const series: HistoryPoint[] = (json.history ?? []).map((pt) => ({
      ts: new Date(pt.t * 1000).toISOString(),
      price_yes: pt.p,
    }));
    return {
      market,
      range,
      resolution_minutes: window.resolution_minutes,
      source_supports_history: true,
      series,
      stats: summarizeSeries(series),
    };
  }

  async listDisputed(limit = 20): Promise<NormalizedMarket[]> {
    const candidates = new Map<string, NormalizedMarket>();
    const queries = ["dispute", "disputed", "proposed", "pending"];
    for (const q of queries) {
      const url = new URL(`${GAMMA_BASE}/markets`);
      url.searchParams.set("limit", "100");
      url.searchParams.set("q", q);
      const res = await fetch(url, timed());
      if (!res.ok) continue;
      const json = (await res.json()) as GammaMarket[];
      for (const raw of json) {
        const market = toNormalized(raw);
        if (market.settlement_risk === "high") {
          candidates.set(market.venue_market_id, market);
        }
      }
    }
    const list = Array.from(candidates.values());
    list.sort((a, b) => {
      const ad = a.dispute_open_until ? Date.parse(a.dispute_open_until) : Infinity;
      const bd = b.dispute_open_until ? Date.parse(b.dispute_open_until) : Infinity;
      return ad - bd;
    });
    return list.slice(0, limit);
  }
}
