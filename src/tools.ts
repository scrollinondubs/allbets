import { z } from "zod";
import { ADAPTERS, discover, fanOutSearch } from "./discovery.js";
import { PolymarketAdapter } from "./adapters/polymarket.js";
import type { NormalizedMarket } from "./schema.js";
import { HistoryRangeSchema } from "./schema.js";

export const VenueArgSchema = z
  .array(z.enum(["polymarket", "kalshi", "limitless"]))
  .optional();

export const DiscoverInputSchema = z.object({
  hypothesis: z.string().min(2),
  jurisdiction: z.enum(["us", "non_us", "unknown"]).default("unknown"),
  limit_per_venue: z.number().int().positive().max(30).default(15),
});

export const SearchInputSchema = z.object({
  query: z.string().min(2),
  limit_per_venue: z.number().int().positive().max(50).default(10),
  venues: VenueArgSchema,
});

export const ListActiveInputSchema = z.object({
  limit_per_venue: z.number().int().positive().max(50).default(10),
  venues: VenueArgSchema,
});

export const QuoteInputSchema = z.object({
  market: z.string().min(1),
});

export const DisputesActiveInputSchema = z.object({
  limit: z.number().int().positive().max(50).default(20),
});

export const HistoryInputSchema = z.object({
  market: z.string().min(1),
  range: HistoryRangeSchema.default("24h"),
});

export const TOOL_DEFS = [
  {
    name: "pm_discover",
    description:
      "Given a betting hypothesis (e.g. 'Powell cuts rates in June'), fan out across Polymarket, Kalshi, and Limitless and return what each venue has, jurisdiction notes, and a recommended venue to trade at. This is the primary tool — start here.",
    inputSchema: {
      type: "object",
      properties: {
        hypothesis: { type: "string", description: "Plain-English statement of what you want to bet on or against." },
        jurisdiction: {
          type: "string",
          enum: ["us", "non_us", "unknown"],
          default: "unknown",
          description: "User's regulatory jurisdiction. US blocks Polymarket-international; non-US blocks Kalshi.",
        },
        limit_per_venue: { type: "number", default: 15 },
      },
      required: ["hypothesis"],
    },
  },
  {
    name: "pm_quote",
    description:
      "Single-market deep-dive. Pass a market URL (Polymarket / Kalshi / Limitless) or a 'venue:id' shorthand (e.g. 'polymarket:540816' or 'kalshi:KXFEDMTG-26JUN-T5'). Returns the fully-loaded normalized market including settlement risk badge (UMA dispute window, bond/reward, resolution status). Use this AFTER pm_discover to get the trust shape behind a price.",
    inputSchema: {
      type: "object",
      properties: {
        market: {
          type: "string",
          description: "Market URL or 'venue:id' shorthand. Examples: 'https://polymarket.com/event/...', 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5', 'limitless:0x...'",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "pm_disputes_active",
    description:
      "Returns Polymarket markets currently flagged with UMA dispute risk (proposed-but-not-finalized OR actively disputed). Polymarket flipped over $30M of resolutions via UMA disputes in 2025 alone — agents holding positions in these markets should know.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
      },
    },
  },
  {
    name: "pm_history",
    description:
      "Price + volume time series for a single market. Pass the same `market` shape pm_quote accepts (URL or 'venue:id'). Returns the current normalized market plus a series of {ts, price_yes, volume_usd?} buckets and OHLC stats (open/close/high/low/change_pct). Use this to detect 'this market moved against me overnight' or 'this market just spiked' — the trust-shape badge is a snapshot, this is the story behind it. Polymarket + Kalshi supported; Limitless returns an honest empty result with the current snapshot since their public API does not expose history.",
    inputSchema: {
      type: "object",
      properties: {
        market: {
          type: "string",
          description: "Market URL or 'venue:id' shorthand (same forms pm_quote accepts).",
        },
        range: {
          type: "string",
          enum: ["1h", "24h", "7d", "30d", "all"],
          default: "24h",
          description: "Time window. Bucket size is auto-tuned to keep the series in the 24-60 point range so it stays LLM-digestible.",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "pm_search",
    description: "Raw cross-venue search. Returns up to limit_per_venue normalized markets from each venue matching the query. Useful when pm_discover is too curated.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit_per_venue: { type: "number", default: 10 },
        venues: { type: "array", items: { enum: ["polymarket", "kalshi", "limitless"] } },
      },
      required: ["query"],
    },
  },
  {
    name: "pm_list_active",
    description: "List the most active markets per venue (top by volume / liquidity). Useful for browsing.",
    inputSchema: {
      type: "object",
      properties: {
        limit_per_venue: { type: "number", default: 10 },
        venues: { type: "array", items: { enum: ["polymarket", "kalshi", "limitless"] } },
      },
    },
  },
];

function resolveMarketRef(input: string): { venue: NormalizedMarket["venue"]; id: string } | null {
  const trimmed = input.trim();

  // venue:id shorthand
  const shortMatch = trimmed.match(/^(polymarket|kalshi|limitless):(.+)$/i);
  if (shortMatch) {
    return {
      venue: shortMatch[1]!.toLowerCase() as NormalizedMarket["venue"],
      id: shortMatch[2]!.trim(),
    };
  }

  // URL form
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "");
    if (host.endsWith("polymarket.com")) {
      // /event/<slug> or /market/<id>
      const segments = path.split("/").filter(Boolean);
      const idx = segments.findIndex((s) => s === "event" || s === "market");
      const id = idx >= 0 && segments[idx + 1] ? segments[idx + 1]! : segments[segments.length - 1] ?? "";
      return id ? { venue: "polymarket", id } : null;
    }
    if (host.endsWith("kalshi.com")) {
      // /markets/<event_ticker>/<ticker>
      const segments = path.split("/").filter(Boolean);
      const ticker = segments[segments.length - 1] ?? "";
      return ticker ? { venue: "kalshi", id: ticker } : null;
    }
    if (host.endsWith("limitless.exchange")) {
      const segments = path.split("/").filter(Boolean);
      const id = segments[segments.length - 1] ?? "";
      return id ? { venue: "limitless", id } : null;
    }
  } catch {
    // not a URL
  }
  return null;
}

export async function runTool(name: string, args: unknown): Promise<unknown> {
  if (name === "pm_discover") {
    const { hypothesis, jurisdiction, limit_per_venue } = DiscoverInputSchema.parse(args);
    return discover(hypothesis, jurisdiction, limit_per_venue);
  }
  if (name === "pm_quote") {
    const { market } = QuoteInputSchema.parse(args);
    const ref = resolveMarketRef(market);
    if (!ref) {
      return {
        error: "could_not_parse_market_ref",
        input: market,
        accepted_forms: [
          "venue:id (e.g. 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5')",
          "polymarket.com URL",
          "kalshi.com URL",
          "limitless.exchange URL",
        ],
      };
    }
    const adapter = ADAPTERS.find((a) => a.venue === ref.venue);
    if (!adapter) return { error: "unknown_venue", venue: ref.venue };
    const m = await adapter.getMarket(ref.id);
    if (!m) return { error: "market_not_found", venue: ref.venue, id: ref.id };
    return { quote: m };
  }
  if (name === "pm_disputes_active") {
    const { limit } = DisputesActiveInputSchema.parse(args);
    const adapter = ADAPTERS.find((a) => a.venue === "polymarket");
    const polymarket = adapter as PolymarketAdapter | undefined;
    if (!polymarket || typeof polymarket.listDisputed !== "function") {
      return { count: 0, markets: [], note: "no adapter exposes dispute listing" };
    }
    const markets = await polymarket.listDisputed(limit);
    return {
      count: markets.length,
      note: "Polymarket UMA-flagged markets only. Kalshi and Limitless settle deterministically and have no analogous dispute risk.",
      markets,
    };
  }
  if (name === "pm_history") {
    const { market, range } = HistoryInputSchema.parse(args);
    const ref = resolveMarketRef(market);
    if (!ref) {
      return {
        error: "could_not_parse_market_ref",
        input: market,
        accepted_forms: [
          "venue:id (e.g. 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5')",
          "polymarket.com URL",
          "kalshi.com URL",
          "limitless.exchange URL",
        ],
      };
    }
    const adapter = ADAPTERS.find((a) => a.venue === ref.venue);
    if (!adapter) return { error: "unknown_venue", venue: ref.venue };
    if (typeof adapter.getHistory !== "function") {
      return { error: "history_not_implemented_for_venue", venue: ref.venue };
    }
    const result = await adapter.getHistory(ref.id, range);
    if (!result) return { error: "market_not_found", venue: ref.venue, id: ref.id };
    return result;
  }
  if (name === "pm_search") {
    const { query, limit_per_venue, venues } = SearchInputSchema.parse(args);
    const out = await fanOutSearch(query, limit_per_venue, venues);
    return { query, count: out.markets.length, errors: out.errors, markets: out.markets };
  }
  if (name === "pm_list_active") {
    const { limit_per_venue, venues } = ListActiveInputSchema.parse(args);
    const active = ADAPTERS.filter(
      (a) => !venues || venues.includes(a.venue as "polymarket" | "kalshi" | "limitless"),
    );
    const settled = await Promise.allSettled(
      active.map((a) => a.listActive(limit_per_venue)),
    );
    const markets: NormalizedMarket[] = [];
    const errors: Array<{ venue: string; error: string }> = [];
    settled.forEach((r, i) => {
      const venue = active[i]!.venue;
      if (r.status === "fulfilled") markets.push(...r.value);
      else errors.push({ venue, error: String(r.reason) });
    });
    return { count: markets.length, errors, markets };
  }
  throw new Error(`unknown tool: ${name}`);
}
