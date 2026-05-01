import type { NormalizedMarket } from "./schema.js";

export interface ImagenResult {
  image_url?: string;
  image_prompt?: string;
  image_subject?: string;
  warning?: string;
}

interface WorkersAIBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

const OPENAI_BASE = "https://api.openai.com/v1";
const MODEL = "dall-e-3";
const SIZE = "1024x1024";
const TIMEOUT_MS = 90000;

const SUBJECT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SUBJECT_TIMEOUT_MS = 8000;

const SUBJECT_SYSTEM_PROMPT = `You translate prediction-market questions into a one-sentence visual subject for an editorial illustrator.

Rules:
- Output ONE sentence describing the concrete subject of the bet: people, places, objects, scenery, or activity.
- NEVER mention prediction markets, betting, odds, probabilities, percentages, charts, tickets, UI, screens, dashboards, or numbers.
- NEVER quote the question. NEVER include the words "yes" or "no".
- Translate proper nouns into visual cues (e.g. "Jerome Powell" → "the Federal Reserve chairman at a press-conference podium"; "Bitcoin" → "stacks of golden coins on a dark trading desk").
- Pick a single focal subject. Concrete, photographable, magazine-spread.
- For sports: the sport itself + the teams/athletes. For politics: the politician + relevant setting. For finance: the institution or asset, never charts. For pop culture: the figure + their world.

Output JSON: {"subject": "<one sentence>"}.`;

function styleBlock(): string {
  return [
    "Style: clean editorial illustration, muted palette, single focal subject, magazine-spread feel, painterly but restrained.",
    "Constraints: no text, no captions, no numbers, no charts, no graphs, no logos, no UI, no screens, no tickets, no dashboards, no percentage signs, no AI-slop aesthetics, no purple gradients, no neon.",
    "Tone matches subject: serious for politics or finance, playful for sports or pop culture, atmospheric for world events.",
  ].join(" ");
}

function fallbackSubject(market: NormalizedMarket): string {
  // No AI binding or extraction failed. Strip the question to a usable noun phrase.
  const q = market.event_question ?? market.question;
  const cleaned = q
    .replace(/\?/g, "")
    .replace(/^(will|does|is|are|can|should|did|has|have|do)\s+/i, "")
    .replace(/\s+by\s+\d{4}.*$/i, "")
    .replace(/\s+before\s+\d{4}.*$/i, "")
    .replace(/\s+in\s+\d{4}.*$/i, "")
    .trim();
  return `A symbolic editorial scene depicting ${cleaned}.`;
}

async function extractSubject(
  market: NormalizedMarket,
  ai: WorkersAIBinding | undefined,
): Promise<string> {
  if (!ai) return fallbackSubject(market);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SUBJECT_TIMEOUT_MS);
  try {
    const ev = market.event_question ?? "";
    const userMsg =
      ev && ev !== market.question
        ? `Question: ${market.question}\nEvent context: ${ev}`
        : `Question: ${market.question}`;
    const result = (await ai.run(SUBJECT_MODEL, {
      messages: [
        { role: "system", content: SUBJECT_SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      response_format: { type: "json_object" },
      max_tokens: 200,
      temperature: 0.4,
    })) as { response?: string } | string;

    const raw = typeof result === "string" ? result : result.response ?? "";
    const parsed = JSON.parse(raw) as { subject?: unknown };
    const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
    if (!subject) return fallbackSubject(market);
    return subject;
  } catch {
    return fallbackSubject(market);
  } finally {
    clearTimeout(t);
  }
}

function buildPrompt(subject: string): string {
  return `Editorial illustration. Subject: ${subject} ${styleBlock()}`;
}

export async function generateMarketImage(
  market: NormalizedMarket,
  apiKey: string,
  ai: WorkersAIBinding | undefined,
): Promise<ImagenResult> {
  const subject = await extractSubject(market, ai);
  const prompt = buildPrompt(subject);
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
        image_subject: subject,
        warning: `openai images ${res.status}: ${body.slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string }>;
    };
    const datum = json.data?.[0];
    if (datum?.url) return { image_url: datum.url, image_prompt: prompt, image_subject: subject };
    if (datum?.b64_json) {
      return {
        image_url: `data:image/png;base64,${datum.b64_json}`,
        image_prompt: prompt,
        image_subject: subject,
      };
    }
    return {
      image_prompt: prompt,
      image_subject: subject,
      warning: "openai response missing data[0].url and data[0].b64_json",
    };
  } catch (err) {
    return {
      image_prompt: prompt,
      image_subject: subject,
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
  ai?: WorkersAIBinding,
): Promise<{ markets: NormalizedMarket[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (!enabled) return { markets, warnings };
  if (!apiKey) {
    warnings.push("visual:true requested but OPENAI_API_KEY not configured on Worker");
    return { markets, warnings };
  }
  const settled = await Promise.allSettled(
    markets.map((m) => generateMarketImage(m, apiKey, ai)),
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
      image_subject: r.value.image_subject,
    };
  });
  return { markets: out, warnings };
}
