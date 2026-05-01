import type { NormalizedMarket } from "./schema.js";

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "will",
  "be",
  "to",
  "in",
  "on",
  "of",
  "for",
  "by",
  "and",
  "or",
  "vs",
  "before",
  "after",
  "this",
  "that",
  "with",
  "at",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  const union = sa.size + sb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface MatchedGroup {
  canonical_question: string;
  members: NormalizedMarket[];
  match_score: number;
}

export function groupByQuestion(
  markets: NormalizedMarket[],
  threshold = 0.45,
): MatchedGroup[] {
  const tokenized = markets.map((m) => ({ market: m, tokens: tokenize(m.question) }));
  const groups: MatchedGroup[] = [];

  for (const item of tokenized) {
    let placed = false;
    for (const group of groups) {
      const repTokens = tokenize(group.canonical_question);
      const score = jaccard(repTokens, item.tokens);
      if (score >= threshold) {
        group.members.push(item.market);
        group.match_score = Math.min(group.match_score, score);
        placed = true;
        break;
      }
    }
    if (!placed) {
      groups.push({
        canonical_question: item.market.question,
        members: [item.market],
        match_score: 1,
      });
    }
  }

  return groups.filter((g) => g.members.length >= 2);
}

export function consensusFromGroup(group: MatchedGroup): {
  consensus_yes: number | null;
  liquidity_weighted_yes: number | null;
  spread: number | null;
} {
  const yesProbs: number[] = [];
  const weighted: { p: number; w: number }[] = [];

  for (const m of group.members) {
    const yes = m.outcomes.find((o) => /yes/i.test(o.label)) ?? m.outcomes[0];
    if (!yes) continue;
    yesProbs.push(yes.probability);
    const w = m.liquidity_usd ?? m.volume_usd ?? 1;
    weighted.push({ p: yes.probability, w });
  }

  if (yesProbs.length === 0) {
    return { consensus_yes: null, liquidity_weighted_yes: null, spread: null };
  }

  const consensus = yesProbs.reduce((s, p) => s + p, 0) / yesProbs.length;
  const wTotal = weighted.reduce((s, x) => s + x.w, 0);
  const lwYes = wTotal > 0 ? weighted.reduce((s, x) => s + x.p * x.w, 0) / wTotal : null;
  const spread = Math.max(...yesProbs) - Math.min(...yesProbs);

  return { consensus_yes: consensus, liquidity_weighted_yes: lwYes, spread };
}
