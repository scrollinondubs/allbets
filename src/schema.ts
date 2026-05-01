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

export type SettlementRisk = "low" | "moderate" | "high";

export const SettlementRiskSchema = z.enum(["low", "moderate", "high"]);

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
  settlement_risk: SettlementRiskSchema,
  settlement_risk_reason: z.string(),
  uma_resolution_statuses: z.array(z.string()).optional(),
  uma_bond: z.number().nonnegative().optional(),
  uma_reward: z.number().nonnegative().optional(),
  custom_liveness_seconds: z.number().nonnegative().optional(),
  chain: z.enum(["polygon", "base", "ethereum", "centralized"]),
  collateral_token: z.string(),
  restricted_jurisdictions: z.array(z.string()).optional(),
  is_parlay: z.boolean().optional(),
  is_auto_generated: z.boolean().optional(),
  // Execution-cost fields (consumed by pm_ev). Defaults are working assumptions
  // when the venue does not expose per-market fees in its public API:
  //   Polymarket — surfaced from Gamma `mbf` / `tbf` (basis points).
  //   Kalshi     — flat 350 bps taker (~3.5%) until per-market fees exposed.
  //   Limitless  — 0 bps; AMM fees are baked into the price impact curve.
  maker_fee_bps: z.number().nonnegative().optional(),
  taker_fee_bps: z.number().nonnegative().optional(),
  min_tick_size: z.number().positive().optional(),
  min_order_size_usd: z.number().nonnegative().optional(),
  url: z.string().url(),
  raw_url: z.string().url().optional(),
  is_affiliate_link: z.boolean().optional(),
  affiliate_disclosure: z.string().optional(),
  image_url: z.string().url().optional(),
  image_prompt: z.string().optional(),
  image_subject: z.string().optional(),
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

export const HistoryRangeSchema = z.enum(["1h", "24h", "7d", "30d", "all"]);
export type HistoryRange = z.infer<typeof HistoryRangeSchema>;

export const HistoryPointSchema = z.object({
  ts: z.string(),
  price_yes: z.number().min(0).max(1),
  volume_usd: z.number().nonnegative().optional(),
});
export type HistoryPoint = z.infer<typeof HistoryPointSchema>;

export const HistoryStatsSchema = z.object({
  open: z.number().min(0).max(1),
  close: z.number().min(0).max(1),
  high: z.number().min(0).max(1),
  low: z.number().min(0).max(1),
  change_pct: z.number(),
  samples: z.number().int().nonnegative(),
  volume_total_usd: z.number().nonnegative().optional(),
});
export type HistoryStats = z.infer<typeof HistoryStatsSchema>;

export const MarketHistorySchema = z.object({
  market: NormalizedMarketSchema,
  range: HistoryRangeSchema,
  resolution_minutes: z.number().int().positive(),
  source_supports_history: z.boolean(),
  series: z.array(HistoryPointSchema),
  stats: HistoryStatsSchema.nullable(),
  note: z.string().optional(),
});
export type MarketHistory = z.infer<typeof MarketHistorySchema>;

// pm_ev — positive expected value evaluator
export const EvRecommendationSchema = z.enum([
  "INTRA_MARKET_ARB",  // ask_yes + ask_no + fees < $1 — risk-free regardless of outcome
  "BET_YES",
  "BET_NO",
  "EDGE_TOO_THIN",
  "PASS",
]);
export type EvRecommendation = z.infer<typeof EvRecommendationSchema>;

// Intra-market arbitrage signal: both YES and NO can be bought for combined
// cost (incl. fees) below $1, guaranteeing $1 payout on the winning side.
// Only set when both sides have real bid/ask data (not probability fallbacks).
// Settlement-risk-immune because both legs settle on the same event — if UMA
// flips, both legs follow the flip and the payout is unchanged.
export const IntraMarketArbSchema = z.object({
  detected: z.literal(true),
  ask_yes: z.number().min(0).max(1),
  ask_no: z.number().min(0).max(1),
  cost_per_dollar_payout: z.object({
    gross: z.number().min(0),                  // ask_yes + ask_no
    after_fees: z.number().min(0),             // gross × (1 + taker_fee_rate)
  }),
  risk_free_return_pct: z.number(),            // (1 / after_fees − 1) × 100
  caveats: z.array(z.string()),                // liquidity, sizing, etc.
});
export type IntraMarketArb = z.infer<typeof IntraMarketArbSchema>;

export const EvSideSchema = z.object({
  side: z.enum(["YES", "NO"]),
  ask_price: z.number().min(0).max(1),
  ev_per_dollar: z.object({
    raw: z.number(),
    after_fees: z.number(),
    after_settlement_risk: z.number(),
  }),
  kelly: z
    .object({
      full_fraction: z.number(),
      suggested_fraction: z.number(),
      suggested_stake_usd: z.number().nullable(),
    })
    .nullable(),
});
export type EvSide = z.infer<typeof EvSideSchema>;

export const EvReportSchema = z.object({
  market: NormalizedMarketSchema,
  market_implied_p_yes: z.number().min(0).max(1),
  user_p_yes: z.number().min(0).max(1).nullable(),
  edge_pts: z.number().nullable(),                  // user_p_yes - market_implied_p_yes, in pts
  fees: z.object({
    taker_fee_bps: z.number().nonnegative(),
    fee_per_dollar: z.number().nonnegative(),       // fraction of stake lost to fees
    source: z.enum(["venue", "default", "constant"]),
  }),
  risk_discount_factor: z.number().min(0).max(1),   // 1.0=low, 0.85=mod, 0.5=high
  yes: EvSideSchema,
  no: EvSideSchema,
  intra_market_arb: IntraMarketArbSchema.nullable(),
  recommendation: EvRecommendationSchema,
  rationale: z.string(),
});
export type EvReport = z.infer<typeof EvReportSchema>;
