import { z } from "zod";
import { ADAPTERS, discover, fanOutSearch } from "./discovery.js";
import { PolymarketAdapter } from "./adapters/polymarket.js";
import { recommendFromUrl } from "./recommend.js";
import { decorateMarket, decorateMarkets, type AffiliateConfig } from "./affiliate.js";
import { decorateWithImages } from "./imagen.js";
import { grokSearchX } from "./grok.js";
import { HistoryRangeSchema } from "./schema.js";
import type { NormalizedMarket } from "./schema.js";
import { evaluateMarket, DEFAULT_KELLY_FRACTION } from "./ev.js";

interface WorkersAIBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface RecommendAgentNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch: (request: Request) => Promise<Response> };
}

interface ToolEnv {
  FIRECRAWL_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  EXA_API_KEY?: string;
  OPENAI_API_KEY?: string;
  XAI_API_KEY?: string;
  POLYMARKET_REF_CODE?: string;
  KALSHI_REF_CODE?: string;
  LIMITLESS_REF_CODE?: string;
  AI?: WorkersAIBinding;
  RecommendAgent?: RecommendAgentNamespace;
}

function affiliateConfigFromEnv(env: ToolEnv): AffiliateConfig {
  return {
    polymarket: env.POLYMARKET_REF_CODE,
    kalshi: env.KALSHI_REF_CODE,
    limitless: env.LIMITLESS_REF_CODE,
  };
}

export const VenueArgSchema = z
  .array(z.enum(["polymarket", "kalshi", "limitless"]))
  .optional();

export const DiscoverInputSchema = z.object({
  hypothesis: z.string().min(2),
  jurisdiction: z.enum(["us", "non_us", "unknown"]).default("unknown"),
  limit_per_venue: z.number().int().positive().max(30).default(15),
  visual: z.boolean().default(false),
});

export const SearchInputSchema = z.object({
  query: z.string().min(2),
  limit_per_venue: z.number().int().positive().max(50).default(10),
  venues: VenueArgSchema,
  visual: z.boolean().default(false),
});

export const ListActiveInputSchema = z.object({
  limit_per_venue: z.number().int().positive().max(50).default(10),
  venues: VenueArgSchema,
  visual: z.boolean().default(false),
});

export const QuoteInputSchema = z.object({
  market: z.string().min(1),
  visual: z.boolean().default(false),
});

export const DisputesActiveInputSchema = z.object({
  limit: z.number().int().positive().max(50).default(20),
  visual: z.boolean().default(false),
});

export const RecommendInputSchema = z.object({
  profile_url: z.string().url(),
  jurisdiction: z.enum(["us", "non_us", "unknown"]).default("unknown"),
  max_recommendations: z.number().int().positive().max(20).default(10),
  visual: z.boolean().default(false),
});

export const HistoryInputSchema = z.object({
  market: z.string().min(1),
  range: HistoryRangeSchema.default("24h"),
});

<<<<<<< feat/v0.1.9-pm-ev
export const EvInputSchema = z.object({
  market: z.string().min(1),
  p_yes: z.number().min(0).max(1).optional(),
  bankroll_usd: z.number().nonnegative().optional(),
  kelly_fraction: z.number().min(0).max(1).default(DEFAULT_KELLY_FRACTION),
=======
export const SignalInputSchema = z.object({
  query: z.string().min(2),
  hours_back: z.union([z.literal(1), z.literal(6), z.literal(24), z.literal(72)]).default(24),
>>>>>>> init
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
        visual: { type: "boolean", default: false, description: "If true, attach an OpenAI-generated editorial image to each market in the response. Requires OPENAI_API_KEY Worker secret. Costs ~$0.04 per image." },
      },
      required: ["hypothesis"],
    },
  },
  {
    name: "pm_quote",
    description:
      "Single-market deep-dive. Pass a market URL (Polymarket / Kalshi / Limitless) or a 'venue:id' shorthand (e.g. 'polymarket:540816' or 'kalshi:KXFEDMTG-26JUN-T5'). Returns the fully-loaded normalized market including settlement risk badge (UMA dispute window, bond/reward, resolution status). Use this AFTER pm_discover to get the trust shape behind a price. Pass visual=true to attach an OpenAI-generated illustration to the response.",
    inputSchema: {
      type: "object",
      properties: {
        market: {
          type: "string",
          description: "Market URL or 'venue:id' shorthand. Examples: 'https://polymarket.com/event/...', 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5', 'limitless:0x...'",
        },
        visual: { type: "boolean", default: false, description: "If true, attach an OpenAI-generated editorial image to the market in the response. Requires OPENAI_API_KEY Worker secret. Costs ~$0.04 per image." },
      },
      required: ["market"],
    },
  },
  {
    name: "pm_history",
    description:
      "Price + volume time series for a single market. Pass the same `market` shape pm_quote accepts (URL or 'venue:id'). Returns the current normalized market plus a series of {ts, price_yes, volume_usd?} buckets and OHLC stats (open/close/high/low/change_pct). Use this to detect 'this market moved against me overnight' or 'this market just spiked' — the trust-shape badge is a snapshot, this is the trajectory behind it. Polymarket + Kalshi supported; Limitless returns an honest empty result with the current snapshot since their public API does not expose history.",
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
    name: "pm_signal",
    description:
      "Live X (Twitter) signal for a hypothesis or market topic, via Grok's first-party x_search. Returns the most-engaged recent posts with citations + a one-line narrative summary. Use this AFTER pm_history to answer 'why did this market just move?' — pm_history shows WHAT happened, pm_signal shows WHAT WAS BEING SAID. Polymarket / Kalshi / political / crypto markets all move on X chatter; this exposes that chatter directly. Latency 5-15s and cost ~$0.05/call so keep it opt-in, not in the hot path.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Topic, hypothesis, or market question. Free-form natural language. Examples: 'Russia Ukraine ceasefire', 'Polymarket MegaETH FDV market', 'Powell rate cut June'.",
        },
        hours_back: {
          type: "number",
          enum: [1, 6, 24, 72],
          default: 24,
          description: "Time window for the X search. Smaller windows surface fresher signal but may return fewer posts.",
        },
      },
      required: ["query"],
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
    name: "pm_ev",
    description:
      "Positive-EV evaluator + intra-market arbitrage detector for a single market. Pass `market` (URL or 'venue:id', same as pm_quote) and optionally `p_yes` (your probability estimate, 0..1) and `bankroll_usd`. Returns market-implied probability, your edge in points, EV per $1 at three honesty levels (raw, after taker fees, after settlement-risk discount), Kelly fraction sizing (default quarter-Kelly), and a discrete recommendation: INTRA_MARKET_ARB | BET_YES | BET_NO | EDGE_TOO_THIN | PASS. INTRA_MARKET_ARB is surfaced when ask_yes + ask_no + fees < $1 (settlement-risk-immune since both legs settle on the same event); the `intra_market_arb` field has the arb math + caveats. Decision support, not execution — agent goes to the trade-here URL to act. Kelly assumes your `p_yes` is well-calibrated; use a smaller `kelly_fraction` if uncertain.",
    inputSchema: {
      type: "object",
      properties: {
        market: {
          type: "string",
          description: "Market URL or 'venue:id' shorthand (same forms pm_quote accepts).",
        },
        p_yes: {
          type: "number",
          description: "Your probability estimate of the YES outcome, 0 to 1. Omit to evaluate at the market's own implied price (zero-edge baseline).",
        },
        bankroll_usd: {
          type: "number",
          description: "Total bankroll for Kelly sizing. If provided, the response includes a suggested stake. Omitted = no stake suggestion.",
        },
        kelly_fraction: {
          type: "number",
          default: 0.25,
          description: "Multiplier on the full Kelly fraction. 0.25 = quarter-Kelly (practitioner default, absorbs estimation error). 1.0 = full Kelly (max growth, max ruin risk).",
        },
      },
      required: ["market"],
    },
  },
  {
    name: "pm_recommend",
    description:
      "Personalized recommendations via the RecommendAgent (Cloudflare Agents SDK Durable Object). Scrape a profile URL (blog, Substack, personal site), extract topics + stances via Workers AI, return up to N prediction-market bets across Polymarket / Kalshi / Limitless ranked by stance-alignment + liquidity. The agent persists call history in SQLite at the edge; no PII is stored. Pass visual=true to attach an OpenAI-generated illustration to each recommendation.",
    inputSchema: {
      type: "object",
      properties: {
        profile_url: {
          type: "string",
          description: "Public URL: blog post, Substack page, personal site, etc. Twitter / LinkedIn often blocked — public blogs work most reliably.",
        },
        jurisdiction: {
          type: "string",
          enum: ["us", "non_us", "unknown"],
          default: "unknown",
        },
        max_recommendations: { type: "number", default: 10 },
        visual: { type: "boolean", default: false, description: "If true, attach an OpenAI-generated editorial image to each recommended market. Requires OPENAI_API_KEY Worker secret. Costs ~$0.04 per image." },
      },
      required: ["profile_url"],
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
        visual: { type: "boolean", default: false },
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
        visual: { type: "boolean", default: false },
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

export interface ToolResult {
  value: unknown;
  // Per MCP spec: isError flags tool-level (semantic) failure to the client,
  // distinct from JSON-RPC transport errors. Agents see this and know to
  // surface or self-correct rather than treat the response as success.
  isError?: boolean;
}

const ok = (value: unknown): ToolResult => ({ value });
const err = (value: unknown): ToolResult => ({ value, isError: true });

function decorateDiscoverReport(
  report: Awaited<ReturnType<typeof discover>>,
  config: AffiliateConfig,
): Awaited<ReturnType<typeof discover>> {
  return {
    ...report,
    per_venue: report.per_venue.map((v) => ({
      ...v,
      best_match: v.best_match ? decorateMarket(v.best_match, config) : v.best_match,
      adjacent_matches: v.adjacent_matches
        ? decorateMarkets(v.adjacent_matches, config)
        : v.adjacent_matches,
    })),
    recommendation: report.recommendation.best_venue
      ? {
          ...report.recommendation,
          trade_here_url: report.recommendation.trade_here_url
            ? decorateMarket(
                {
                  venue: report.recommendation.best_venue,
                  url: report.recommendation.trade_here_url,
                } as NormalizedMarket,
                config,
              ).url
            : report.recommendation.trade_here_url,
        }
      : report.recommendation,
  };
}

export async function runTool(name: string, args: unknown, env: ToolEnv = {}): Promise<ToolResult> {
  const affiliateConfig = affiliateConfigFromEnv(env);

  if (name === "pm_discover") {
    const { hypothesis, jurisdiction, limit_per_venue, visual } = DiscoverInputSchema.parse(args);
    const report = await discover(hypothesis, jurisdiction, limit_per_venue);
    let decorated = decorateDiscoverReport(report, affiliateConfig);
    if (visual) {
      const allMarkets: NormalizedMarket[] = [];
      decorated.per_venue.forEach((v) => {
        if (v.best_match) allMarkets.push(v.best_match);
      });
      const { markets: withImages, warnings } = await decorateWithImages(allMarkets, env.OPENAI_API_KEY, true);
      const imageByKey = new Map<string, NormalizedMarket>();
      withImages.forEach((m) => imageByKey.set(`${m.venue}:${m.venue_market_id}`, m));
      decorated = {
        ...decorated,
        per_venue: decorated.per_venue.map((v) => {
          if (!v.best_match) return v;
          const enriched = imageByKey.get(`${v.best_match.venue}:${v.best_match.venue_market_id}`);
          return enriched ? { ...v, best_match: enriched } : v;
        }),
      } as typeof decorated;
      if (warnings.length > 0) (decorated as typeof decorated & { warnings?: string[] }).warnings = warnings;
    }
    return ok(decorated);
  }
  if (name === "pm_recommend") {
    const { profile_url, jurisdiction, max_recommendations, visual } = RecommendInputSchema.parse(args);
    let result: { recommendations: Array<{ market: NormalizedMarket; [key: string]: unknown }>; [key: string]: unknown };
    if (env.RecommendAgent) {
      const id = env.RecommendAgent.idFromName("pm_recommend:default");
      const stub = env.RecommendAgent.get(id);
      const agentRes = await stub.fetch(
        new Request("https://agent.internal/agents/recommend-agent/pm_recommend:default", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ profile_url, jurisdiction, max_recommendations }),
        }),
      );
      if (!agentRes.ok) {
        const text = await agentRes.text();
        return err({ error: "agent_failed", status: agentRes.status, detail: text.slice(0, 500) });
      }
      result = (await agentRes.json()) as typeof result;
    } else {
      const report = await recommendFromUrl(profile_url, jurisdiction, max_recommendations, env);
      result = {
        ...report,
        recommendations: report.recommendations.map((rec) => ({
          ...rec,
          market: decorateMarket(rec.market, affiliateConfig),
        })),
      };
    }
    if (visual) {
      const markets = result.recommendations.map((r) => r.market);
      const { markets: withImages, warnings } = await decorateWithImages(markets, env.OPENAI_API_KEY, true);
      result = {
        ...result,
        recommendations: result.recommendations.map((rec, i) => ({
          ...rec,
          market: withImages[i] ?? rec.market,
        })),
      };
      if (warnings.length > 0) (result as { warnings?: string[] }).warnings = warnings;
    }
    return ok(result);
  }
  if (name === "pm_quote") {
    const { market, visual } = QuoteInputSchema.parse(args);
    const ref = resolveMarketRef(market);
    if (!ref) {
      return err({
        error: "could_not_parse_market_ref",
        input: market,
        accepted_forms: [
          "venue:id (e.g. 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5')",
          "polymarket.com URL",
          "kalshi.com URL",
          "limitless.exchange URL",
        ],
      });
    }
    const adapter = ADAPTERS.find((a) => a.venue === ref.venue);
    if (!adapter) return err({ error: "unknown_venue", venue: ref.venue });
    const m = await adapter.getMarket(ref.id);
    if (!m) return err({ error: "market_not_found", venue: ref.venue, id: ref.id });
    let decorated = decorateMarket(m, affiliateConfig);
    const warnings: string[] = [];
    if (visual) {
      const result = await decorateWithImages([decorated], env.OPENAI_API_KEY, true);
      decorated = result.markets[0] ?? decorated;
      warnings.push(...result.warnings);
    }
    return ok(warnings.length > 0 ? { quote: decorated, warnings } : { quote: decorated });
  }
  if (name === "pm_history") {
    const { market, range } = HistoryInputSchema.parse(args);
    const ref = resolveMarketRef(market);
    if (!ref) {
      return err({
        error: "could_not_parse_market_ref",
        input: market,
        accepted_forms: [
          "venue:id (e.g. 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5')",
          "polymarket.com URL",
          "kalshi.com URL",
          "limitless.exchange URL",
        ],
      });
    }
    const adapter = ADAPTERS.find((a) => a.venue === ref.venue);
    if (!adapter) return err({ error: "unknown_venue", venue: ref.venue });
    if (typeof adapter.getHistory !== "function") {
      return err({ error: "history_not_implemented_for_venue", venue: ref.venue });
    }
    const result = await adapter.getHistory(ref.id, range);
    if (!result) return err({ error: "market_not_found", venue: ref.venue, id: ref.id });
    return ok(result);
  }
  if (name === "pm_signal") {
    const { query, hours_back } = SignalInputSchema.parse(args);
    if (!env.XAI_API_KEY) {
      return err({
        error: "xai_api_key_not_configured",
        detail: "Set XAI_API_KEY via `wrangler secret put XAI_API_KEY` (production) or .dev.vars (local). Get a key at https://console.x.ai.",
      });
    }
    const result = await grokSearchX(query, hours_back, env.XAI_API_KEY);
    return ok(result);
  }
  if (name === "pm_disputes_active") {
    const { limit } = DisputesActiveInputSchema.parse(args);
    const adapter = ADAPTERS.find((a) => a.venue === "polymarket");
    const polymarket = adapter as PolymarketAdapter | undefined;
    if (!polymarket || typeof polymarket.listDisputed !== "function") {
      return ok({ count: 0, markets: [], note: "no adapter exposes dispute listing" });
    }
    const markets = await polymarket.listDisputed(limit);
    return ok({
      count: markets.length,
      note: "Polymarket UMA-flagged markets only. Kalshi and Limitless settle deterministically and have no analogous dispute risk.",
      markets: decorateMarkets(markets, affiliateConfig),
    });
  }
  if (name === "pm_ev") {
    const { market, p_yes, bankroll_usd, kelly_fraction } = EvInputSchema.parse(args);
    const ref = resolveMarketRef(market);
    if (!ref) {
      return err({
        error: "could_not_parse_market_ref",
        input: market,
        accepted_forms: [
          "venue:id (e.g. 'polymarket:540816', 'kalshi:KXFEDMTG-26JUN-T5')",
          "polymarket.com URL",
          "kalshi.com URL",
          "limitless.exchange URL",
        ],
      });
    }
    const adapter = ADAPTERS.find((a) => a.venue === ref.venue);
    if (!adapter) return err({ error: "unknown_venue", venue: ref.venue });
    const m = await adapter.getMarket(ref.id);
    if (!m) return err({ error: "market_not_found", venue: ref.venue, id: ref.id });
    // Decorate first so the report carries the affiliate URL — agents click
    // through from the EV recommendation to the trade-here URL.
    const decorated = decorateMarket(m, affiliateConfig);
    const report = evaluateMarket({
      market: decorated,
      user_p_yes: p_yes,
      bankroll_usd,
      kelly_fraction,
    });
    return ok(report);
  }
  if (name === "pm_search") {
    const { query, limit_per_venue, venues } = SearchInputSchema.parse(args);
    const out = await fanOutSearch(query, limit_per_venue, venues);
    return ok({
      query,
      count: out.markets.length,
      errors: out.errors,
      markets: decorateMarkets(out.markets, affiliateConfig),
    });
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
    return ok({ count: markets.length, errors, markets: decorateMarkets(markets, affiliateConfig) });
  }
  throw new Error(`unknown tool: ${name}`);
}
