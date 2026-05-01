# allbets

**Cross-venue prediction-market discovery for AI agents.** Tell your agent your hypothesis, allbets tells you what's tradable across Polymarket, Kalshi, and Limitless — with liquidity, jurisdiction notes, and a recommended venue.

> Live MCP endpoint: `https://allbets.dev/mcp` (or current Workers URL `https://allbets-mcp.cold-shape-7f3f.workers.dev/mcp`)
> Built at [Agents Day Lisbon 2026-05-01](https://luma.com/) by Sean Tierney + Jax.

## Why

The three biggest prediction-market venues — Kalshi ($9.5B Jan 2026 volume), Polymarket ($3.3B), Limitless ($789M) — are mutually almost-non-overlapping in their top markets. Their identities, settlement models, and jurisdictional gates are all different. An agent that wants to "bet on the Fed cutting rates in June" today has to:

1. Know which venues even list that question
2. Know which it can legally trade on (Kalshi US-only, Polymarket geo-blocked from US, Limitless on Base)
3. Compare liquidity / probabilities across the venues that DO list it
4. Get a direct trade-here URL

allbets does steps 1-4 in a single tool call.

## Tools

| Tool | Use for |
|---|---|
| `pm_discover(hypothesis, jurisdiction?)` | **Primary.** Fan out across 3 venues, return what each has + jurisdiction notes + recommended trade-here URL. |
| `pm_quote(market_url_or_id)` | Single-market deep-dive with full **settlement-risk badge** (UMA dispute window, bond, resolution status). Use after `pm_discover` to see the trust shape behind a price. |
| `pm_disputes_active(limit?)` | List Polymarket markets currently UMA-flagged (proposed-but-not-finalized OR actively disputed). Polymarket flipped >$30M of resolutions in 2025 — agents holding positions need to know. |
| `pm_search(query, venues?)` | Raw cross-venue search. Less curated than `pm_discover`. |
| `pm_list_active(venues?)` | Most active markets per venue, for browsing. |

All reads are public-API only. **Trading is intentionally not in scope** — identity, custody, and funding fragmentation across the three venues makes a unified write-API a fool's errand. allbets is the *information* primitive; trade execution stays with the agent's existing per-venue tools.

## Settlement risk

Every quote carries a `settlement_risk: "low" | "moderate" | "high"` badge plus `settlement_risk_reason`. Computed for all venues uniformly. Kalshi (centralized) and Limitless (Pyth-deterministic) are `low` by default — that's a feature, not noise: the agent has confirmation that the settlement model is reliable.

For Polymarket (UMA Optimistic Oracle):
- **HIGH:** `uma_resolution_statuses` contains `proposed` or `disputed`, OR the dispute window is currently open
- **MODERATE:** `custom_liveness_seconds > 86400` (>24h dispute window), OR `uma_bond < 500` USDC (under-collateralized vs default), OR resolution `description` is thin (<200 chars; ambiguity proxy)
- **LOW:** none of the above

## Normalized schema

Each market comes back in a single shape that includes everything an agent needs to make a decision:

```ts
type NormalizedMarket = {
  venue: "polymarket" | "polymarket-qcex" | "kalshi" | "limitless";
  venue_market_id: string;
  event_id?: string;            // for grouping multi-outcome events
  event_question?: string;
  question: string;
  outcomes: Array<{
    label: string;
    probability: number;        // 0..1
    bid?: number; ask?: number;
    tradable_outcome_id?: string;  // CLOB token / position ID for downstream trading
  }>;
  liquidity_usd?: number;
  volume_usd?: number;
  ends_at?: string;
  resolution_status: "open" | "closed_pending_resolution" | "in_dispute" | "settled" | "unknown";
  dispute_open_until?: string;  // UMA dispute window for Polymarket
  chain: "polygon" | "base" | "ethereum" | "centralized";
  collateral_token: string;     // USDC, USDC.e, USD
  restricted_jurisdictions?: string[];  // ["US"] for Polymarket-international, ["non-US"] for Kalshi
  is_parlay?: boolean;          // Kalshi KXMVE multi-leg
  is_auto_generated?: boolean;  // Limitless lumy bot-generated
  url: string;                  // trade-here URL
  raw?: unknown;
};
```

## Architecture

- **Cloudflare Workers** runtime (no cold starts, multi-region by default)
- **Hono** for routing
- **Streamable HTTP MCP transport** (`POST /mcp` with JSON-RPC 2.0)
- Three adapters (`src/adapters/`) each implement `searchMarkets`, `getMarket`, `listActive` — plain classes, no framework lock-in
- Matcher (`src/matcher.ts`) groups by `event_id` first, then fuzzy-matches per-outcome questions within events (token-Jaccard with stopwords)
- `Promise.allSettled` fan-out so one venue's outage doesn't break the whole call

## Quick start (local dev)

```bash
npm install
npm run dev        # wrangler dev
```

Then connect Claude Desktop or any MCP client to `http://localhost:8787/mcp`.

## Deploy

```bash
export CLOUDFLARE_API_TOKEN=...
npm run deploy
```

## Connect from Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "allbets": {
      "transport": {
        "type": "streamable-http",
        "url": "https://allbets.dev/mcp"
      }
    }
  }
}
```

## Deliberate non-features

- **Trading.** MCP protocol is wrong-shaped for it (long-lived state, on-chain confirmation, idempotency, multi-user secrets). Use Polymarket Agents, Olas Polystrat, or shaanmajid/prediction-mcp for execution.
- **Cross-venue arbitrage.** Capital is non-fungible across these venues (USD vs USDC-on-Polygon vs USDC-on-Base vs Kalshi USD). Spreads exist but are not actually executable for most agents without weeks of cross-platform funding lead time. We surface prices; we do not promise arb.
- **Manifold Markets.** Play money — distorts liquidity-weighted comparisons against real-money venues.

## Roadmap

- **v0.1.1** (this release) — discovery framing, Workers + Hono deploy, Marc's bug fixes (Kalshi field-name drift, KXMVE parlay filter, Limitless lumy filter, event-aware matcher, resolution_status + chain + jurisdiction fields)
- **v0.2** — LLM-judge fuzzy matcher (Haiku over candidate pairs), Polymarket-QCEX adapter (when API docs land)
- **v0.3** — Discord/Slack bot wrapper using `pm_discover` as the backend
- **v0.4** — News→market alerts (open-source Adjacent News alternative)

## License

MIT.
