import type { NormalizedMarket } from "./schema.js";
import { discover } from "./discovery.js";

export interface ExtractedProfile {
  topics: string[];
  stances: Array<{ topic: string; direction: "bullish" | "bearish" | "neutral"; horizon?: string }>;
  industries?: string[];
  geographic_focus?: string[];
  summary: string;
}

export interface Recommendation {
  market: NormalizedMarket;
  relevance_to: string;
  rank_score: number;
  rationale: string;
}

export interface RecommendReport {
  profile_url: string;
  jurisdiction: "us" | "non_us" | "unknown";
  extracted: ExtractedProfile;
  recommendations: Recommendation[];
  jurisdiction_filtered_count: number;
  warnings: string[];
}

interface WorkersAI {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  FIRECRAWL_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  AI?: WorkersAI;
}

const FIRECRAWL_BASE = "https://api.firecrawl.dev/v1";
const ANTHROPIC_BASE = "https://api.anthropic.com/v1";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SCRAPE_TIMEOUT_MS = 25000;
const MAX_MARKDOWN_CHARS = 50000;

async function firecrawlScrape(url: string, apiKey: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SCRAPE_TIMEOUT_MS);
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`firecrawl ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data?: { markdown?: string } };
    const md = json.data?.markdown ?? "";
    return md.slice(0, MAX_MARKDOWN_CHARS);
  } finally {
    clearTimeout(t);
  }
}

const EXTRACTION_SYSTEM_PROMPT = `You analyze a person's writing or profile and extract their interests, stances, and what they care about. The downstream consumer is a prediction-market discovery tool, so topics need to be SPECIFIC enough to find real-world events, not generic categories.

Respond ONLY with valid JSON matching this exact schema:

{
  "topics": ["string", ...],
  "stances": [{"topic": "string", "direction": "bullish" | "bearish" | "neutral", "horizon": "string"}, ...],
  "industries": ["string", ...],
  "geographic_focus": ["string", ...],
  "summary": "string"
}

Rules for topics:
- 3-7 specific topical keywords/phrases that name a CONCRETE event, person, company, technology, geography, or asset that could be the subject of a prediction-market question.
- GOOD: "AI coding agents", "OpenAI", "Anthropic", "GPT-5 release", "Bitcoin halving", "Powell rate decision", "Trump tariffs", "Lisbon real estate prices", "Solana ETF approval", "Polymarket"
- BAD (too generic, will match noise): "software development", "technology", "business", "innovation", "education", "AI", "the future"
- Each topic should contain at least one PROPER NOUN or distinctive 5+ letter word. Avoid bare adjectives or common verbs.
- Lowercase or natural case. No hashtags.

Rules for stances:
- Only include if the person expresses a clear directional view; if they're descriptive without a position, omit.
- direction must be one of: bullish | bearish | neutral. horizon if mentioned ("short-term", "12 months", "by 2030"); omit otherwise.

Other:
- industries: their professional / sector focus (less critical, can be generic).
- geographic_focus: locations or markets they discuss.
- summary: ONE sentence describing this person's interests and worldview, in third person.
- Return ONLY the JSON object. No prose before or after. No markdown fences.`;

function parseExtractedJson(text: string): ExtractedProfile {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  // try to locate JSON object boundaries if the model added prose
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  let parsed: ExtractedProfile;
  try {
    parsed = JSON.parse(candidate) as ExtractedProfile;
  } catch {
    throw new Error(`failed to parse extraction JSON: ${candidate.slice(0, 200)}`);
  }
  if (!Array.isArray(parsed.topics) || parsed.topics.length === 0) {
    throw new Error("extraction returned no topics");
  }
  parsed.topics = parsed.topics.slice(0, 7);
  parsed.stances = (parsed.stances ?? []).slice(0, 7);
  return parsed;
}

async function extractViaWorkersAI(markdown: string, ai: WorkersAI): Promise<ExtractedProfile> {
  const trimmed = markdown.slice(0, 30000);
  const result = (await ai.run(WORKERS_AI_MODEL, {
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: `Analyze this profile content and return the JSON:\n\n---\n\n${trimmed}` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1024,
    temperature: 0.2,
  })) as { response?: string } | string;

  const text =
    typeof result === "string"
      ? result
      : typeof result?.response === "string"
        ? result.response
        : JSON.stringify(result);
  return parseExtractedJson(text);
}

async function extractViaAnthropic(markdown: string, apiKey: string): Promise<ExtractedProfile> {
  const trimmed = markdown.slice(0, 30000);
  const res = await fetch(`${ANTHROPIC_BASE}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Analyze this profile content and return the JSON:\n\n---\n\n${trimmed}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const text = json.content.find((b) => b.type === "text")?.text ?? "";
  return parseExtractedJson(text);
}

async function extractProfile(markdown: string, env: Env, warnings: string[]): Promise<ExtractedProfile> {
  if (env.AI) {
    try {
      return await extractViaWorkersAI(markdown, env.AI);
    } catch (err) {
      warnings.push(`Workers AI extraction failed (${err instanceof Error ? err.message : String(err)}), falling back to Anthropic`);
    }
  }
  if (env.ANTHROPIC_API_KEY) {
    return extractViaAnthropic(markdown, env.ANTHROPIC_API_KEY);
  }
  throw new Error("no extraction backend configured: need AI binding or ANTHROPIC_API_KEY");
}

const MIN_RANK_SCORE = 2.5;

const GENERIC_TOKENS = new Set([
  "software", "development", "technology", "business", "innovation",
  "education", "industry", "company", "service", "platform", "product",
  "system", "solution", "data", "team", "world", "people", "thing", "stuff",
  "labor", "cabinet", "house", "general", "national", "state", "federal",
]);

function distinctiveTopicTokens(topic: string): Set<string> {
  return new Set(
    topic
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 3 && !GENERIC_TOKENS.has(t)),
  );
}

function topicOverlapsMarket(topic: string, market: NormalizedMarket): boolean {
  const t = distinctiveTopicTokens(topic);
  if (t.size === 0) return false; // topic is too generic — drop entirely
  const haystack = `${market.question} ${market.event_question ?? ""} ${market.description ?? ""}`.toLowerCase();
  for (const tok of t) {
    if (haystack.includes(tok)) return true;
  }
  return false;
}

function rankAndDedupe(
  candidates: Array<{ topic: string; market: NormalizedMarket }>,
  stances: ExtractedProfile["stances"],
  max: number,
): Recommendation[] {
  const byMarket = new Map<string, { topics: Set<string>; market: NormalizedMarket }>();
  for (const c of candidates) {
    if (!topicOverlapsMarket(c.topic, c.market)) continue;
    const key = `${c.market.venue}:${c.market.venue_market_id}`;
    const ex = byMarket.get(key);
    if (ex) {
      ex.topics.add(c.topic);
    } else {
      byMarket.set(key, { topics: new Set([c.topic]), market: c.market });
    }
  }

  const stanceByTopic = new Map<string, ExtractedProfile["stances"][number]>();
  for (const s of stances) stanceByTopic.set(s.topic.toLowerCase(), s);

  const recommendations: Recommendation[] = [];
  for (const { topics, market } of byMarket.values()) {
    let score = 0;
    let relevance_to = Array.from(topics).join(", ");
    let rationale = `matches your interest in ${relevance_to}`;

    score += topics.size * 1.5; // multi-topic match boost

    const liq = market.liquidity_usd ?? 0;
    const vol = market.volume_usd ?? 0;
    if (liq > 100000) score += 2.0;
    else if (liq > 10000) score += 1.0;
    else if (liq > 0) score += 0.25;

    if (vol > 100000) score += 1.0;
    else if (vol > 10000) score += 0.25;

    // Drop markets with no real activity unless they're high-event interest
    if (liq === 0 && vol < 10000) score -= 1.5;

    if (market.settlement_risk === "low") score += 0.5;
    if (market.settlement_risk === "high") score -= 0.5;

    if (market.is_auto_generated) score -= 0.5;
    if (market.is_parlay) score -= 1.5;

    for (const topic of topics) {
      const stance = stanceByTopic.get(topic.toLowerCase());
      if (!stance) continue;
      score += 0.75; // we have a stance signal
      const yes = market.outcomes.find((o) => /yes/i.test(o.label));
      const yesProb = yes?.probability ?? 0.5;
      if (stance.direction === "bullish" && yesProb >= 0.4) {
        score += 1.0;
        rationale = `matches your bullish stance on ${stance.topic} — ${(yesProb * 100).toFixed(0)}% YES`;
      } else if (stance.direction === "bearish" && yesProb <= 0.6) {
        score += 1.0;
        rationale = `matches your bearish stance on ${stance.topic} — ${((1 - yesProb) * 100).toFixed(0)}% NO`;
      }
    }

    recommendations.push({ market, relevance_to, rank_score: Math.round(score * 100) / 100, rationale });
  }

  recommendations.sort((a, b) => b.rank_score - a.rank_score);
  return recommendations.filter((r) => r.rank_score >= MIN_RANK_SCORE).slice(0, max);
}

export async function recommendFromUrl(
  profileUrl: string,
  jurisdiction: "us" | "non_us" | "unknown",
  maxRecommendations: number,
  env: Env,
): Promise<RecommendReport> {
  const warnings: string[] = [];

  if (!env.FIRECRAWL_API_KEY) throw new Error("FIRECRAWL_API_KEY not configured on Worker");
  if (!env.AI && !env.ANTHROPIC_API_KEY) throw new Error("no AI binding or ANTHROPIC_API_KEY on Worker");

  let markdown: string;
  try {
    markdown = await firecrawlScrape(profileUrl, env.FIRECRAWL_API_KEY);
  } catch (err) {
    throw new Error(`scrape failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!markdown || markdown.trim().length < 200) {
    warnings.push("scraped content was very short — extraction may be unreliable");
  }

  const extracted = await extractProfile(markdown, env, warnings);

  const topicResults = await Promise.allSettled(
    extracted.topics.map((topic) => discover(topic, jurisdiction, 8)),
  );

  const candidates: Array<{ topic: string; market: NormalizedMarket }> = [];
  let jurisdictionFiltered = 0;

  topicResults.forEach((r, i) => {
    const topic = extracted.topics[i]!;
    if (r.status !== "fulfilled") {
      warnings.push(`discover failed for "${topic}": ${String(r.reason).slice(0, 120)}`);
      return;
    }
    for (const venueResult of r.value.per_venue) {
      if (venueResult.unavailable_reason === "blocked by jurisdiction") {
        jurisdictionFiltered += venueResult.match_count;
        continue;
      }
      if (venueResult.best_match) {
        candidates.push({ topic, market: venueResult.best_match });
      }
      for (const adj of venueResult.adjacent_matches ?? []) {
        candidates.push({ topic, market: adj });
      }
    }
  });

  const recommendations = rankAndDedupe(candidates, extracted.stances ?? [], maxRecommendations);

  return {
    profile_url: profileUrl,
    jurisdiction,
    extracted,
    recommendations,
    jurisdiction_filtered_count: jurisdictionFiltered,
    warnings,
  };
}
