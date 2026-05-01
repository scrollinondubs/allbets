import { z } from "zod";

export type Venue = "polymarket" | "kalshi" | "limitless";

export const VenueSchema = z.enum(["polymarket", "kalshi", "limitless"]);

export const NormalizedMarketSchema = z.object({
  venue: VenueSchema,
  venue_market_id: z.string(),
  question: z.string(),
  description: z.string().optional(),
  outcomes: z.array(
    z.object({
      label: z.string(),
      probability: z.number().min(0).max(1),
      bid: z.number().min(0).max(1).optional(),
      ask: z.number().min(0).max(1).optional(),
    }),
  ),
  liquidity_usd: z.number().nonnegative().optional(),
  volume_usd: z.number().nonnegative().optional(),
  open_interest_usd: z.number().nonnegative().optional(),
  ends_at: z.string().datetime().optional(),
  url: z.string().url(),
  raw: z.unknown().optional(),
});

export type NormalizedMarket = z.infer<typeof NormalizedMarketSchema>;

export const MarketSearchResultSchema = z.object({
  query: z.string(),
  matched: z.array(NormalizedMarketSchema),
});

export type MarketSearchResult = z.infer<typeof MarketSearchResultSchema>;

export const ConsensusQuoteSchema = z.object({
  question: z.string(),
  venues: z.array(NormalizedMarketSchema),
  consensus_yes: z.number().min(0).max(1).nullable(),
  liquidity_weighted_yes: z.number().min(0).max(1).nullable(),
  cross_venue_spread: z.number().nullable(),
});

export type ConsensusQuote = z.infer<typeof ConsensusQuoteSchema>;

export const ArbOpportunitySchema = z.object({
  question: z.string(),
  buy_venue: VenueSchema,
  sell_venue: VenueSchema,
  buy_price: z.number(),
  sell_price: z.number(),
  spread_pct: z.number(),
  min_liquidity_usd: z.number(),
  notes: z.string().optional(),
});

export type ArbOpportunity = z.infer<typeof ArbOpportunitySchema>;
