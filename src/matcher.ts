import type { NormalizedMarket } from "./schema.js";

const STOPWORDS = new Set([
  "the","a","an","is","are","will","be","to","in","on","of","for","by","and",
  "or","vs","before","after","this","that","with","at","by","when","does","do",
  "did","get","its","it","s","t","odds","what","how","much","many","probability",
]);

const SYNONYM_GROUPS: string[][] = [
  ["cut", "cuts", "cutting", "decrease", "decreases", "decreased", "lower", "lowers", "lowered", "reduce", "reduces", "reduced", "drop", "drops", "dropped", "fall", "falls", "fell"],
  ["raise", "raises", "raised", "hike", "hikes", "hiked", "increase", "increases", "increased", "boost", "boosts", "rise", "rises", "rose"],
  ["fed", "fomc", "powell", "federal", "reserve"],
  ["rate", "rates", "interest", "bps"],
  ["june", "jun"],
  ["july", "jul"],
  ["may"],
];

function expandToken(t: string): string[] {
  for (const group of SYNONYM_GROUPS) {
    if (group.includes(t)) return group;
  }
  return [t];
}

function antonymTokens(t: string): string[] {
  for (let i = 0; i < SYNONYM_GROUPS.length; i++) {
    if (SYNONYM_GROUPS[i]!.includes(t)) {
      // antonym pair: cut/decrease group <-> raise/increase group
      if (i === 0) return SYNONYM_GROUPS[1]!;
      if (i === 1) return SYNONYM_GROUPS[0]!;
    }
  }
  return [];
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function scoreMarket(queryTokens: string[], market: NormalizedMarket): number {
  const haystack = `${market.question ?? ""} ${market.event_question ?? ""}`.toLowerCase();
  let score = 0;
  for (const t of queryTokens) {
    const expanded = expandToken(t);
    let hit = false;
    for (const variant of expanded) {
      if (haystack.includes(variant)) {
        hit = true;
        break;
      }
    }
    if (hit) score += 1;

    const antonyms = antonymTokens(t);
    for (const ant of antonyms) {
      if (haystack.includes(ant)) {
        score -= 1.5; // antonym penalty stronger than synonym credit
        break;
      }
    }
  }
  return score;
}

export interface VenueBest {
  market: NormalizedMarket;
  score: number;
  adjacent: NormalizedMarket[];
}

export function bestMatchPerVenue(
  hypothesis: string,
  markets: NormalizedMarket[],
  threshold = 0.5,
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
    const scored = list.map((m) => ({ market: m, score: scoreMarket(queryTokens, m) }));
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
