#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { PolymarketAdapter } from "./adapters/polymarket.js";
import { KalshiAdapter } from "./adapters/kalshi.js";
import { LimitlessAdapter } from "./adapters/limitless.js";
import type { VenueAdapter } from "./adapters/types.js";
import { groupByQuestion, consensusFromGroup } from "./matcher.js";
import type { NormalizedMarket } from "./schema.js";

const adapters: VenueAdapter[] = [
  new PolymarketAdapter(),
  new KalshiAdapter(),
  new LimitlessAdapter(),
];

async function fanOut<T>(
  fns: Array<() => Promise<T[]>>,
): Promise<{ results: T[]; errors: Array<{ index: number; error: string }> }> {
  const settled = await Promise.allSettled(fns.map((fn) => fn()));
  const results: T[] = [];
  const errors: Array<{ index: number; error: string }> = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") {
      results.push(...r.value);
    } else {
      errors.push({ index: i, error: String(r.reason) });
    }
  });
  return { results, errors };
}

const SearchInput = z.object({
  query: z.string().min(2),
  limit_per_venue: z.number().int().positive().max(50).default(10),
  venues: z.array(z.enum(["polymarket", "kalshi", "limitless"])).optional(),
});

const QuoteInput = z.object({
  query: z.string().min(2),
  limit_per_venue: z.number().int().positive().max(20).default(5),
  group_threshold: z.number().min(0).max(1).default(0.45),
});

const ArbInput = z.object({
  query: z.string().min(2),
  min_spread_pct: z.number().min(0).max(100).default(2),
  group_threshold: z.number().min(0).max(1).default(0.45),
});

const tools = [
  {
    name: "pm_search",
    description:
      "Fan out a query across Polymarket, Kalshi, and Limitless. Returns normalized markets from each venue. Use this when the user asks about a topic and you want to see what contracts exist.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query, e.g. 'fed rate cut june'" },
        limit_per_venue: { type: "number", default: 10 },
        venues: {
          type: "array",
          items: { enum: ["polymarket", "kalshi", "limitless"] },
        },
      },
      required: ["query"],
    },
  },
  {
    name: "pm_quote",
    description:
      "Fan out, fuzzy-group cross-venue markets that ask the same question, and return the consensus probability + liquidity-weighted probability. Use when the user wants the market's view on a specific event.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit_per_venue: { type: "number", default: 5 },
        group_threshold: { type: "number", default: 0.45 },
      },
      required: ["query"],
    },
  },
  {
    name: "pm_arb",
    description:
      "Find cross-venue arbitrage opportunities — same question priced differently on different venues. Returns spreads above min_spread_pct.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        min_spread_pct: { type: "number", default: 2 },
        group_threshold: { type: "number", default: 0.45 },
      },
      required: ["query"],
    },
  },
];

const server = new Server(
  { name: "allbets", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments ?? {};

  if (name === "pm_search") {
    const { query, limit_per_venue, venues } = SearchInput.parse(args);
    const active = adapters.filter((a) => !venues || venues.includes(a.venue));
    const { results, errors } = await fanOut(
      active.map((a) => () => a.searchMarkets(query, limit_per_venue)),
    );
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ query, count: results.length, errors, markets: results }, null, 2),
        },
      ],
    };
  }

  if (name === "pm_quote") {
    const { query, limit_per_venue, group_threshold } = QuoteInput.parse(args);
    const { results, errors } = await fanOut(
      adapters.map((a) => () => a.searchMarkets(query, limit_per_venue)),
    );
    const groups = groupByQuestion(results, group_threshold);
    const ranked = groups
      .map((g) => ({ group: g, ...consensusFromGroup(g) }))
      .sort((a, b) => b.group.members.length - a.group.members.length);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { query, errors, group_count: ranked.length, groups: ranked },
            null,
            2,
          ),
        },
      ],
    };
  }

  if (name === "pm_arb") {
    const { query, min_spread_pct, group_threshold } = ArbInput.parse(args);
    const { results, errors } = await fanOut(
      adapters.map((a) => () => a.searchMarkets(query, 10)),
    );
    const groups = groupByQuestion(results, group_threshold);
    const opportunities: Array<{
      question: string;
      members: NormalizedMarket[];
      spread_pct: number;
    }> = [];

    for (const g of groups) {
      const probs = g.members.map((m) => {
        const yes = m.outcomes.find((o) => /yes/i.test(o.label)) ?? m.outcomes[0];
        return { venue: m.venue, p: yes?.probability ?? 0, m };
      });
      const max = probs.reduce((a, b) => (a.p > b.p ? a : b));
      const min = probs.reduce((a, b) => (a.p < b.p ? a : b));
      const spreadPct = (max.p - min.p) * 100;
      if (spreadPct >= min_spread_pct && max.venue !== min.venue) {
        opportunities.push({
          question: g.canonical_question,
          members: g.members,
          spread_pct: spreadPct,
        });
      }
    }

    opportunities.sort((a, b) => b.spread_pct - a.spread_pct);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ query, errors, opportunities }, null, 2),
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: `unknown tool: ${name}` }],
    isError: true,
  };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[allbets] MCP server ready on stdio");
}

main().catch((err) => {
  console.error("[allbets] fatal:", err);
  process.exit(1);
});
