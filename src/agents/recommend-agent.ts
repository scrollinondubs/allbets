import { Agent } from "agents";
import { recommendFromUrl, type RecommendReport } from "../recommend.js";
import type { AffiliateConfig } from "../affiliate.js";
import { decorateMarket } from "../affiliate.js";

interface RecommendAgentEnv {
  FIRECRAWL_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  POLYMARKET_REF_CODE?: string;
  KALSHI_REF_CODE?: string;
  LIMITLESS_REF_CODE?: string;
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
}

interface RecommendAgentState {
  recent_urls: Array<{ url: string; ts: string; topic_count: number; recommendation_count: number }>;
  total_calls: number;
  last_call_ts?: string;
}

const INITIAL_STATE: RecommendAgentState = {
  recent_urls: [],
  total_calls: 0,
};

const RECENT_LIMIT = 10;

/**
 * RecommendAgent — Cloudflare Agent that owns the URL → recommendations
 * pipeline. Built on the Cloudflare Agents SDK (Durable Object + SQLite
 * state) so each agent instance persists analysis history at the edge.
 *
 * Why an Agent and not a plain function?
 * - Native to the CF stack (sponsor of Agents Day Lisbon)
 * - State persists across calls — recent URLs, call count, last seen
 * - Foundation for v0.2 features: scheduled re-analysis, multi-turn
 *   refinement ("show me more like the second one"), per-user agents
 */
export class RecommendAgent extends Agent<RecommendAgentEnv, RecommendAgentState> {
  initialState: RecommendAgentState = INITIAL_STATE;

  /**
   * Called by the MCP tool handler. Wraps recommendFromUrl with state
   * persistence so the agent retains memory of recent analyses.
   */
  async recommend(
    profileUrl: string,
    jurisdiction: "us" | "non_us" | "unknown",
    maxRecommendations: number,
  ): Promise<RecommendReport & { agent_state: { total_calls: number; recent_urls: RecommendAgentState["recent_urls"] } }> {
    const env = this.env;
    const config: AffiliateConfig = {
      polymarket: env.POLYMARKET_REF_CODE,
      kalshi: env.KALSHI_REF_CODE,
      limitless: env.LIMITLESS_REF_CODE,
    };

    const report = await recommendFromUrl(profileUrl, jurisdiction, maxRecommendations, env);

    // decorate markets with affiliate links
    const decorated: RecommendReport = {
      ...report,
      recommendations: report.recommendations.map((rec) => ({
        ...rec,
        market: decorateMarket(rec.market, config),
      })),
    };

    // persist to agent state
    const now = new Date().toISOString();
    const recent = [
      {
        url: profileUrl,
        ts: now,
        topic_count: decorated.extracted.topics.length,
        recommendation_count: decorated.recommendations.length,
      },
      ...this.state.recent_urls,
    ].slice(0, RECENT_LIMIT);

    this.setState({
      recent_urls: recent,
      total_calls: this.state.total_calls + 1,
      last_call_ts: now,
    });

    return {
      ...decorated,
      agent_state: {
        total_calls: this.state.total_calls,
        recent_urls: this.state.recent_urls,
      },
    };
  }

  /**
   * HTTP handler — called by the agentsMiddleware when a request hits
   * /agents/recommend-agent/<id>. Lets external agents (and future
   * web-UI clients) talk to this agent via plain HTTP without going
   * through the MCP layer.
   */
  async onRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({
          name: "recommend-agent",
          description: "URL → personalized prediction-market recommendations",
          state: this.state,
        }),
        { headers: { "content-type": "application/json" } },
      );
    }
    try {
      const body = (await request.json()) as {
        profile_url: string;
        jurisdiction?: "us" | "non_us" | "unknown";
        max_recommendations?: number;
      };
      const out = await this.recommend(
        body.profile_url,
        body.jurisdiction ?? "unknown",
        body.max_recommendations ?? 10,
      );
      return new Response(JSON.stringify(out), { headers: { "content-type": "application/json" } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  }
}
