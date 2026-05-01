import { z } from "zod";
import { ADAPTERS, discover, fanOutSearch } from "./discovery.js";
import type { NormalizedMarket } from "./schema.js";

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

export async function runTool(name: string, args: unknown): Promise<unknown> {
  if (name === "pm_discover") {
    const { hypothesis, jurisdiction, limit_per_venue } = DiscoverInputSchema.parse(args);
    return discover(hypothesis, jurisdiction, limit_per_venue);
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
