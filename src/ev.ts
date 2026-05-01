// Positive expected value evaluator for prediction-market positions.
//
// Pure math, no I/O. Given a normalized market and (optionally) the agent's
// own probability estimate, returns:
//   - market-implied probability (mid of bid/ask, or last)
//   - edge in points (user vs market)
//   - per-dollar EV at three honesty levels (raw, after fees, after settlement risk)
//   - Kelly-fraction sizing (full + fractional, default quarter-Kelly)
//   - a discrete recommendation: BET_YES | BET_NO | EDGE_TOO_THIN | PASS
//
// Math reference: Kelly criterion (https://en.wikipedia.org/wiki/Kelly_criterion).
// Settlement-risk discount factors are working assumptions — calibrate over
// time once we have post-resolution data accumulated.

import type {
  EvRecommendation,
  EvReport,
  EvSide,
  IntraMarketArb,
  NormalizedMarket,
  SettlementRisk,
} from "./schema.js";

// Tunable constants — top-of-file so they're easy to tweak / make per-venue later.
export const DEFAULT_KELLY_FRACTION = 0.25;        // quarter-Kelly is the practitioner norm
export const ACTIONABLE_EV_THRESHOLD = 0.05;       // 5¢ EV per $1 = "actionable"
export const DEFAULT_KALSHI_TAKER_BPS = 350;       // fallback if adapter forgot
export const DEFAULT_POLYMARKET_TAKER_BPS = 200;   // 2% — Polymarket's typical category default
export const DEFAULT_LIMITLESS_TAKER_BPS = 0;      // AMM-priced, fees in slippage

const RISK_DISCOUNT: Record<SettlementRisk, number> = {
  low: 1.0,
  moderate: 0.85,
  high: 0.5,
};

export interface EvInput {
  market: NormalizedMarket;
  user_p_yes?: number;            // 0..1, agent's probability estimate
  bankroll_usd?: number;          // for Kelly sizing
  kelly_fraction?: number;        // override DEFAULT_KELLY_FRACTION
}

export interface KellyResult {
  full_fraction: number;
  suggested_fraction: number;
  suggested_stake_usd: number | null;
}

// Kelly fraction for a binary YES/NO bet at price `ask` (the actual cost per
// share) given true probability `p`. Returns f* = p − (1−p)/b where
// b = (1 − ask) / ask is the odds ratio (winnings per unit staked).
//
// Negative result means don't bet this side; positive means stake the
// fractional Kelly portion of bankroll. Per practitioner norm, callers should
// scale by 0.25 to 0.5 to absorb estimation error.
export function kellyFraction(p: number, ask: number): number {
  if (ask <= 0 || ask >= 1) return 0;             // degenerate market
  const b = (1 - ask) / ask;                       // odds ratio
  return p - (1 - p) / b;
}

// Per-dollar EV before fees / risk discount, for buying YES at `ask` given
// true probability `p`. If you bet $1 worth at ask, you receive 1/ask shares;
// each share pays $1 if YES, $0 if NO.
//   expected payout = (1/ask) × (p × 1)
//   EV per dollar   = (p × payout − cost) / cost = (p − ask) / ask
export function evPerDollar(p: number, ask: number): number {
  if (ask <= 0 || ask >= 1) return 0;
  return (p - ask) / ask;
}

export function applyRiskDiscount(ev: number, risk: SettlementRisk): number {
  return ev * RISK_DISCOUNT[risk];
}

// Detect intra-market arbitrage: if you can buy 1 share of YES at ask_yes and
// 1 share of NO at ask_no for combined cost (after both legs' taker fees) less
// than $1, you lock in a guaranteed $1 payout regardless of outcome. This is
// settlement-risk-immune because both legs settle on the same event — if UMA
// flips YES→NO, both legs follow the flip and the dollar payout is unchanged.
//
// Caller MUST pass real bid/ask data here, not probability fallbacks. We
// enforce that one level up by only invoking this when both outcomes have
// `ask` populated as actual venue order book data.
export function detectIntraMarketArb(
  askYes: number | undefined,
  askNo: number | undefined,
  feeRate: number,
  caveats: string[] = [],
): IntraMarketArb | null {
  if (
    askYes === undefined ||
    askNo === undefined ||
    askYes <= 0 || askYes >= 1 ||
    askNo <= 0 || askNo >= 1
  ) {
    return null;
  }
  const gross = askYes + askNo;
  const afterFees = gross * (1 + feeRate);
  if (afterFees >= 1) return null;
  const riskFreeReturnPct = (1 / afterFees - 1) * 100;
  return {
    detected: true,
    ask_yes: askYes,
    ask_no: askNo,
    cost_per_dollar_payout: {
      gross: Math.round(gross * 10000) / 10000,
      after_fees: Math.round(afterFees * 10000) / 10000,
    },
    risk_free_return_pct: Math.round(riskFreeReturnPct * 100) / 100,
    caveats,
  };
}

// Pull the most useful price out of an outcome's bid/ask/probability fields.
// Prefer bid/ask mid when both present, fall back to probability (which is
// usually last_price or implied from outcomePrices). Used to derive the
// market-implied YES probability for the EV report header.
function midPrice(bid?: number, ask?: number, fallback?: number): number {
  if (bid !== undefined && ask !== undefined && bid > 0 && ask > 0) {
    return (bid + ask) / 2;
  }
  if (ask !== undefined && ask > 0) return ask;
  if (bid !== undefined && bid > 0) return bid;
  return fallback ?? 0;
}

// Conservative side-quotes: when computing actionable EV, use the ASK (what
// you'd pay) rather than the mid. If the venue doesn't expose bid/ask, fall
// back to probability as a proxy.
function sideAsk(
  side: "YES" | "NO",
  market: NormalizedMarket,
  marketImpliedYes: number,
): number {
  const yes = market.outcomes[0];
  const no = market.outcomes[1];
  if (side === "YES") {
    return yes?.ask ?? yes?.probability ?? marketImpliedYes;
  }
  return no?.ask ?? no?.probability ?? (1 - marketImpliedYes);
}

function feeBpsFor(market: NormalizedMarket): { bps: number; source: "venue" | "default" | "constant" } {
  if (typeof market.taker_fee_bps === "number") {
    // If the venue surfaces a per-market fee (Polymarket via mbf/tbf), trust it.
    // Kalshi/Limitless adapters set a constant; flag the source so the report
    // is honest about what's measured vs assumed.
    if (market.venue === "polymarket") return { bps: market.taker_fee_bps, source: "venue" };
    return { bps: market.taker_fee_bps, source: "constant" };
  }
  if (market.venue === "polymarket") return { bps: DEFAULT_POLYMARKET_TAKER_BPS, source: "default" };
  if (market.venue === "kalshi") return { bps: DEFAULT_KALSHI_TAKER_BPS, source: "default" };
  return { bps: DEFAULT_LIMITLESS_TAKER_BPS, source: "default" };
}

function evaluateSide(
  side: "YES" | "NO",
  ask: number,
  p: number,
  feeRate: number,
  risk: SettlementRisk,
  bankroll: number | undefined,
  kellyMultiplier: number,
): EvSide {
  const raw = evPerDollar(p, ask);
  const afterFees = raw - feeRate;
  const afterRisk = applyRiskDiscount(afterFees, risk);
  const fullKelly = kellyFraction(p, ask);
  const suggested = Math.max(0, fullKelly * kellyMultiplier);
  const stake = bankroll !== undefined ? bankroll * suggested : null;
  return {
    side,
    ask_price: ask,
    ev_per_dollar: {
      raw,
      after_fees: afterFees,
      after_settlement_risk: afterRisk,
    },
    kelly: {
      full_fraction: fullKelly,
      suggested_fraction: suggested,
      suggested_stake_usd: stake,
    },
  };
}

function pickRecommendation(
  yes: EvSide,
  no: EvSide,
  arb: IntraMarketArb | null,
): { rec: EvRecommendation; rationale: string } {
  // Intra-market arb dominates: it's risk-free regardless of probability
  // estimate or settlement-risk band, so it overrides the directional picks.
  if (arb) {
    return {
      rec: "INTRA_MARKET_ARB",
      rationale: `risk-free arb available: buy YES at ${arb.ask_yes} + NO at ${arb.ask_no} for ${arb.cost_per_dollar_payout.after_fees} per $1 payout (incl. fees) → +${arb.risk_free_return_pct.toFixed(2)}% guaranteed return`,
    };
  }
  const yesEv = yes.ev_per_dollar.after_settlement_risk;
  const noEv = no.ev_per_dollar.after_settlement_risk;
  const best = yesEv > noEv ? { side: "YES" as const, ev: yesEv } : { side: "NO" as const, ev: noEv };
  if (best.ev <= 0) {
    return {
      rec: "PASS",
      rationale: `both sides have non-positive risk-adjusted EV (YES=${yesEv.toFixed(3)}, NO=${noEv.toFixed(3)})`,
    };
  }
  if (best.ev < ACTIONABLE_EV_THRESHOLD) {
    return {
      rec: "EDGE_TOO_THIN",
      rationale: `${best.side} has +${(best.ev * 100).toFixed(1)}¢ EV per $1 — below the ${(ACTIONABLE_EV_THRESHOLD * 100).toFixed(0)}¢ actionable threshold`,
    };
  }
  return {
    rec: best.side === "YES" ? "BET_YES" : "BET_NO",
    rationale: `${best.side} has +${(best.ev * 100).toFixed(1)}¢ risk-adjusted EV per $1 staked`,
  };
}

export function evaluateMarket(input: EvInput): EvReport {
  const { market, user_p_yes, bankroll_usd, kelly_fraction } = input;
  const yes = market.outcomes[0];
  const marketImpliedYes = midPrice(yes?.bid, yes?.ask, yes?.probability);
  const p = user_p_yes !== undefined ? user_p_yes : marketImpliedYes;

  const fee = feeBpsFor(market);
  const feeRate = fee.bps / 10000;
  const risk = market.settlement_risk;
  const kellyMult = kelly_fraction ?? DEFAULT_KELLY_FRACTION;

  const askYes = sideAsk("YES", market, marketImpliedYes);
  const askNo = sideAsk("NO", market, marketImpliedYes);

  // YES side uses agent's p directly. NO side flips it: betting NO is the
  // same as betting YES on the complementary event with probability (1 − p).
  const yesEval = evaluateSide("YES", askYes, p, feeRate, risk, bankroll_usd, kellyMult);
  const noEval = evaluateSide("NO", askNo, 1 - p, feeRate, risk, bankroll_usd, kellyMult);

  // Intra-market arbitrage detection — only meaningful when BOTH outcomes
  // expose real ask data (not probability fallbacks). If either side falls
  // back to `probability` we suppress the signal because that's a midpoint
  // estimate, not a tradable price; surfacing arb on synthetic asks would
  // be misleading.
  const realAskYes = market.outcomes[0]?.ask;
  const realAskNo = market.outcomes[1]?.ask;
  const arbCaveats: string[] = [];
  // Liquidity is a soft warning, not a blocker — agents can decide whether
  // the depth is sufficient given their position size.
  if (
    market.liquidity_usd !== undefined &&
    market.liquidity_usd < 1000
  ) {
    arbCaveats.push(
      `liquidity is thin ($${Math.round(market.liquidity_usd).toLocaleString()}); top-of-book ask sizes may not absorb meaningful capital before slippage erases the edge`,
    );
  }
  if (fee.source === "default" || fee.source === "constant") {
    arbCaveats.push(
      `fee rate (${fee.bps} bps) is a ${fee.source} — venue did not surface a per-market fee, so realized cost may differ`,
    );
  }
  const intraArb = detectIntraMarketArb(realAskYes, realAskNo, feeRate, arbCaveats);

  const { rec, rationale } = pickRecommendation(yesEval, noEval, intraArb);
  const edgePts =
    user_p_yes !== undefined ? Math.round((user_p_yes - marketImpliedYes) * 1000) / 10 : null;

  return {
    market,
    market_implied_p_yes: marketImpliedYes,
    user_p_yes: user_p_yes ?? null,
    edge_pts: edgePts,
    fees: {
      taker_fee_bps: fee.bps,
      fee_per_dollar: feeRate,
      source: fee.source,
    },
    risk_discount_factor: RISK_DISCOUNT[risk],
    yes: yesEval,
    no: noEval,
    intra_market_arb: intraArb,
    recommendation: rec,
    rationale,
  };
}
