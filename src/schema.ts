import { z } from "zod";

export type Venue =
  | "polymarket"
  | "polymarket-qcex"
  | "kalshi"
  | "limitless";

export const VenueSchema = z.enum([
  "polymarket",
  "polymarket-qcex",
  "kalshi",
  "limitless",
]);

export type ResolutionStatus =
  | "open"
  | "closed_pending_resolution"
  | "in_dispute"
  | "settled"
  | "unknown";

export const ResolutionStatusSchema = z.enum([
  "open",
  "closed_pending_resolution",
  "in_dispute",
  "settled",
  "unknown",
]);

export type Chain = "polygon" | "base" | "ethereum" | "centralized";

export const NormalizedMarketSchema = z.object({
  venue: VenueSchema,
  venue_market_id: z.string(),
  event_id: z.string().optional(),
  event_question: z.string().optional(),
  question: z.string(),
  description: z.string().optional(),
  outcomes: z.array(
    z.object({
      label: z.string(),
      probability: z.number().min(0).max(1),
      bid: z.number().min(0).max(1).optional(),
      ask: z.number().min(0).max(1).optional(),
      tradable_outcome_id: z.string().optional(),
    }),
  ),
  liquidity_usd: z.number().nonnegative().optional(),
  volume_usd: z.number().nonnegative().optional(),
  open_interest_usd: z.number().nonnegative().optional(),
  ends_at: z.string().optional(),
  resolution_status: ResolutionStatusSchema,
  dispute_open_until: z.string().optional(),
  chain: z.enum(["polygon", "base", "ethereum", "centralized"]),
  collateral_token: z.string(),
  restricted_jurisdictions: z.array(z.string()).optional(),
  is_parlay: z.boolean().optional(),
  is_auto_generated: z.boolean().optional(),
  url: z.string().url(),
  raw: z.unknown().optional(),
});

export type NormalizedMarket = z.infer<typeof NormalizedMarketSchema>;

export const VenueDiscoveryResultSchema = z.object({
  venue: VenueSchema,
  has_match: z.boolean(),
  match_count: z.number().int().nonnegative(),
  best_match: NormalizedMarketSchema.optional(),
  adjacent_matches: z.array(NormalizedMarketSchema).optional(),
  unavailable_reason: z.string().optional(),
  jurisdiction_note: z.string().optional(),
  error: z.string().optional(),
});

export type VenueDiscoveryResult = z.infer<typeof VenueDiscoveryResultSchema>;

export const DiscoveryReportSchema = z.object({
  hypothesis: z.string(),
  jurisdiction: z.enum(["us", "non_us", "unknown"]).optional(),
  per_venue: z.array(VenueDiscoveryResultSchema),
  recommendation: z.object({
    best_venue: VenueSchema.nullable(),
    rationale: z.string(),
    trade_here_url: z.string().url().nullable(),
  }),
});

export type DiscoveryReport = z.infer<typeof DiscoveryReportSchema>;
