# allbets

One MCP server, three prediction markets. Polymarket + Kalshi + Limitless behind a single normalized tool surface for AI agents.

> Built at [Agents Day Lisbon 2026-05-01](https://luma.com/) by Sean Tierney + Jax (Sean's AI assistant).

## Why

Every existing prediction-market MCP is single-venue. An agent that wants to compare odds across exchanges has to load 3 different MCPs, each with overlapping but inconsistent schemas. allbets normalizes that — one query fans out, results come back in a unified shape, and the agent sees a clean cross-venue view.

Three target venues (top by January 2026 real-money volume):

| Venue | Volume Jan 2026 | Auth | Sandbox |
|---|---|---|---|
| Kalshi | $9.5B | RSA-PSS signed | demo-api.kalshi.co |
| Polymarket | $3.3B | EIP-712 wallet sigs (writes); none for reads | Polygon testnet |
| Limitless | $789M | Wallet (writes); none for reads | - |

## Tools

- **`pm_search(query, limit_per_venue?, venues?)`** — fan out a free-text query across all three venues, return normalized markets
- **`pm_quote(query, limit_per_venue?, group_threshold?)`** — fan out + fuzzy-group same-question contracts cross-venue, return consensus + liquidity-weighted probability
- **`pm_arb(query, min_spread_pct?)`** — find cross-venue arbitrage opportunities (same question, different prices)

All reads are public-API only — no keys needed. Trading is out of scope (every existing MCP already does that).

## Normalized schema

```ts
type NormalizedMarket = {
  venue: "polymarket" | "kalshi" | "limitless";
  venue_market_id: string;
  question: string;
  description?: string;
  outcomes: Array<{
    label: string;
    probability: number;  // 0..1
    bid?: number;
    ask?: number;
  }>;
  liquidity_usd?: number;
  volume_usd?: number;
  open_interest_usd?: number;
  ends_at?: string;
  url: string;
  raw?: unknown;          // full venue response for power users
};
```

## Status

Hackathon-quality scaffold. Not production. Read-only. Adapters call public endpoints; venue API shapes will drift and need maintenance.

- [x] TypeScript MCP server skeleton (stdio transport)
- [x] Polymarket Gamma adapter (public read)
- [x] Kalshi public market list adapter
- [x] Limitless public adapter
- [x] Token-Jaccard fuzzy event matcher
- [x] `pm_search`, `pm_quote`, `pm_arb` tools
- [ ] LLM-judge pass over fuzzy matches (currently token-overlap only)
- [ ] Discord bot wrapper (planned — same MCP, embeddable interface)
- [ ] Caching / rate-limit handling
- [ ] Trading / write surface (intentionally not scoped)

## Install + run

```bash
npm install
npm run build
npm start
```

Or with Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "allbets": {
      "command": "node",
      "args": ["/absolute/path/to/allbets/dist/index.js"]
    }
  }
}
```

## Roadmap

1. **v0.1** — read-only fan-out, fuzzy match, consensus quote, arb finder
2. **v0.2** — LLM event matcher (Claude/Haiku judge over candidate pairs), caching
3. **v0.3** — Discord/Slack bot wrapper that calls allbets and posts consensus inline
4. **v0.4** — webhook surface for news → market alerts
5. **vNever** — trading. Use Polymarket Agents, Olas Polystrat, or any of the 5+ existing Kalshi bots if you want to trade.

## License

MIT.
