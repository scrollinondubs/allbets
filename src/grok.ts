// Grok / xAI live X (Twitter) signal adapter.
//
// Uses the xAI Responses API (POST /v1/responses) with the built-in `x_search`
// agent tool to pull recent posts about a topic with citation URLs. This is
// xAI's first-party access to the X firehose — Claude / GPT / Gemini all
// require scraping (which X actively blocks) so Grok is the durable choice
// for this signal source.
//
// Note re: best_practices.md "Sampling": that guidance says prefer client-side
// LLM access via MCP sampling (no server-side API key). We accept the tradeoff
// here because the actual product is X.com firehose access, not the LLM
// reasoning — and only Grok provides the firehose.

const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";
const FETCH_TIMEOUT_MS = 90_000; // x_search internally makes multiple searches; gpt-grok-style tool loop can be slow

export interface SignalPost {
  handle?: string;
  text: string;
  posted_at?: string;
  url?: string;
  retweets_estimate?: number;
  likes_estimate?: number;
}

export interface SignalResult {
  query: string;
  hours_back: number;
  source: string;
  posts: SignalPost[];
  narrative: string;
  citations: string[];
  generated_at: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    x_search_calls?: number;
    cost_usd?: number;
  };
}

interface XaiResponse {
  output?: Array<{
    type: string;
    content?: Array<{
      type: string;
      text?: string;
      annotations?: Array<{ type: string; url?: string }>;
    }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost_in_usd_ticks?: number;
    server_side_tool_usage_details?: {
      x_search_calls?: number;
    };
  };
  error?: { message?: string } | string;
}

function extractTextAndCitations(
  body: XaiResponse,
): { text: string; citations: string[] } {
  const messages = (body.output ?? []).filter((o) => o.type === "message");
  const last = messages[messages.length - 1];
  const blocks = last?.content ?? [];
  const text = blocks
    .filter((b) => b.type === "output_text")
    .map((b) => b.text ?? "")
    .join("\n")
    .trim();
  const citations: string[] = [];
  for (const b of blocks) {
    for (const a of b.annotations ?? []) {
      if (a.type === "url_citation" && a.url) citations.push(a.url);
    }
  }
  return { text, citations };
}

function tryParsePosts(text: string): SignalPost[] {
  const stripped = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    const parsed = JSON.parse(stripped) as { posts?: SignalPost[] } | SignalPost[];
    if (Array.isArray(parsed)) return parsed;
    return parsed.posts ?? [];
  } catch {
    return [];
  }
}

function buildPrompt(query: string, hoursBack: number): string {
  return [
    `Search X for the most-engaged posts in the last ${hoursBack} hours about: "${query}".`,
    `Return ONLY a single JSON object with this exact shape — no prose, no markdown fences:`,
    `{`,
    `  "posts": [`,
    `    {`,
    `      "handle": "@username",`,
    `      "text": "the post body verbatim",`,
    `      "posted_at": "ISO timestamp if available",`,
    `      "url": "https://x.com/...",`,
    `      "retweets_estimate": 0,`,
    `      "likes_estimate": 0`,
    `    }`,
    `  ],`,
    `  "narrative": "one or two sentences summarizing the dominant story across these posts"`,
    `}`,
    `Return up to 10 posts, ranked by engagement. If no relevant posts found, return an empty posts array with a narrative explaining the absence.`,
  ].join("\n");
}

export async function grokSearchX(
  query: string,
  hoursBack: number,
  apiKey: string,
): Promise<SignalResult> {
  const res = await fetch(XAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "grok-4-fast",
      input: [{ role: "user", content: buildPrompt(query, hoursBack) }],
      tools: [{ type: "x_search" }],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`xai responses ${res.status}: ${detail.slice(0, 300)}`);
  }
  const body = (await res.json()) as XaiResponse;
  if (body.error) {
    const msg = typeof body.error === "string" ? body.error : body.error.message ?? "unknown error";
    throw new Error(`xai error: ${msg}`);
  }

  const { text, citations } = extractTextAndCitations(body);
  const posts = tryParsePosts(text);

  let narrative = "";
  try {
    const obj = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim()) as {
      narrative?: string;
    };
    narrative = obj.narrative ?? "";
  } catch {
    narrative = text.length < 500 ? text : `${text.slice(0, 500)}…`;
  }

  const usage = body.usage;
  const costUsd = usage?.cost_in_usd_ticks
    ? usage.cost_in_usd_ticks / 1_000_000_000
    : undefined;

  return {
    query,
    hours_back: hoursBack,
    source: "x.com via xAI Responses API + x_search tool",
    posts,
    narrative,
    citations,
    generated_at: new Date().toISOString(),
    usage: {
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      x_search_calls: usage?.server_side_tool_usage_details?.x_search_calls,
      cost_usd: costUsd,
    },
  };
}
