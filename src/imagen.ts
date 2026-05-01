import type { NormalizedMarket } from "./schema.js";

export interface ImagenResult {
  image_url?: string;
  image_prompt?: string;
  warning?: string;
}

const OPENAI_BASE = "https://api.openai.com/v1";
const MODEL = "dall-e-3";
const SIZE = "1024x1024";
const TIMEOUT_MS = 90000;

function buildPrompt(market: NormalizedMarket): string {
  const yesProb =
    market.outcomes.find((o) => /yes/i.test(o.label))?.probability ?? 0.5;
  const yesPct = Math.round(yesProb * 100);
  const ev = market.event_question ?? market.question;
  const safeQ = market.question.replace(/["\\]/g, "");
  return [
    `Editorial illustration for a prediction market.`,
    `Question: "${safeQ}".`,
    ev !== market.question ? `Event context: "${ev.replace(/["\\]/g, "")}".` : "",
    `Current market consensus: ${yesPct}% YES.`,
    `Style: clean editorial illustration, muted palette, single focal subject, magazine-spread feel.`,
    `Constraints: no text overlay, no charts, no logos, no UI screenshots, no AI-slop aesthetics, no purple gradients.`,
    `Tone matches the question subject: serious for politics or finance, playful for sports or pop culture.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export async function generateMarketImage(
  market: NormalizedMarket,
  apiKey: string,
): Promise<ImagenResult> {
  const prompt = buildPrompt(market);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENAI_BASE}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: SIZE,
        response_format: "url",
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      return {
        image_prompt: prompt,
        warning: `openai images ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const datum = json.data?.[0];
    if (datum?.url) return { image_url: datum.url, image_prompt: prompt };
    if (datum?.b64_json) {
      // fallback for image models that ignore response_format and always return b64
      return {
        image_url: `data:image/png;base64,${datum.b64_json}`,
        image_prompt: prompt,
      };
    }
    return {
      image_prompt: prompt,
      warning: "openai response missing data[0].url and data[0].b64_json",
    };
  } catch (err) {
    return {
      image_prompt: prompt,
      warning: `openai images failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(t);
  }
}

export async function decorateWithImages(
  markets: NormalizedMarket[],
  apiKey: string | undefined,
  enabled: boolean,
): Promise<{ markets: NormalizedMarket[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (!enabled) return { markets, warnings };
  if (!apiKey) {
    warnings.push("visual:true requested but OPENAI_API_KEY not configured on Worker");
    return { markets, warnings };
  }
  const settled = await Promise.allSettled(
    markets.map((m) => generateMarketImage(m, apiKey)),
  );
  const out = markets.map((m, i) => {
    const r = settled[i];
    if (!r) return m;
    if (r.status === "rejected") {
      warnings.push(`image gen rejected for ${m.venue}:${m.venue_market_id}: ${String(r.reason).slice(0, 120)}`);
      return m;
    }
    if (r.value.warning) warnings.push(r.value.warning);
    return {
      ...m,
      image_url: r.value.image_url,
      image_prompt: r.value.image_prompt,
    };
  });
  return { markets: out, warnings };
}
