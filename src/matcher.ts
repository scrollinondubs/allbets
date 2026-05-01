import type { NormalizedMarket } from "./schema.js";

const STOPWORDS = new Set([
  "the","a","an","is","are","will","be","to","in","on","of","for","by","and",
  "or","vs","before","after","this","that","with","at","by","when","does","do",
  "did","get","its","it","s","t",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface VenueBest {
  market: NormalizedMarket;
  score: number;
  adjacent: NormalizedMarket[];
}

export function bestMatchPerVenue(
  hypothesis: string,
  markets: NormalizedMarket[],
  threshold = 0.25,
): Map<NormalizedMarket["venue"], VenueBest> {
  const queryTokens = tokenize(hypothesis);
  const byVenue = new Map<NormalizedMarket["venue"], NormalizedMarket[]>();
  for (const m of markets) {
    const list = byVenue.get(m.venue) ?? [];
    list.push(m);
    byVenue.set(m.venue, list);
  }

  const result = new Map<NormalizedMarket["venue"], VenueBest>();
  for (const [venue, list] of byVenue) {
    const scored = list.map((m) => {
      const qScore = jaccard(queryTokens, tokenize(m.question));
      const eScore = m.event_question
        ? jaccard(queryTokens, tokenize(m.event_question))
        : 0;
      return { market: m, score: Math.max(qScore, eScore) };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (!top || top.score < threshold) continue;
    const adjacent = scored
      .slice(1)
      .filter((s) => s.score >= threshold * 0.6)
      .slice(0, 3)
      .map((s) => s.market);
    result.set(venue, { market: top.market, score: top.score, adjacent });
  }
  return result;
}

export function eventGroups(
  markets: NormalizedMarket[],
): Map<string, NormalizedMarket[]> {
  const groups = new Map<string, NormalizedMarket[]>();
  for (const m of markets) {
    const key = m.event_id ?? m.venue_market_id;
    const list = groups.get(key) ?? [];
    list.push(m);
    groups.set(key, list);
  }
  return groups;
}
