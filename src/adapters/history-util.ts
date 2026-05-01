import type { HistoryPoint, HistoryRange, HistoryStats } from "../schema.js";

export interface HistoryWindow {
  start_seconds: number;
  end_seconds: number;
  resolution_minutes: number;
}

// Map a user-facing range to a (window, bucket-size) pair tuned to keep point
// counts in the 24-60 range. LLMs digest that cleanly; finer buckets balloon
// token usage without surfacing more signal.
export function rangeToWindow(range: HistoryRange): HistoryWindow {
  const now = Math.floor(Date.now() / 1000);
  switch (range) {
    case "1h":
      return { start_seconds: now - 60 * 60, end_seconds: now, resolution_minutes: 1 };
    case "24h":
      return { start_seconds: now - 24 * 60 * 60, end_seconds: now, resolution_minutes: 60 };
    case "7d":
      return { start_seconds: now - 7 * 24 * 60 * 60, end_seconds: now, resolution_minutes: 360 };
    case "30d":
      return { start_seconds: now - 30 * 24 * 60 * 60, end_seconds: now, resolution_minutes: 1440 };
    case "all":
      return { start_seconds: 0, end_seconds: now, resolution_minutes: 1440 };
  }
}

export function summarizeSeries(series: HistoryPoint[]): HistoryStats | null {
  if (series.length === 0) return null;
  const open = series[0]!.price_yes;
  const close = series[series.length - 1]!.price_yes;
  let high = open;
  let low = open;
  let volume_total: number | undefined;
  for (const p of series) {
    if (p.price_yes > high) high = p.price_yes;
    if (p.price_yes < low) low = p.price_yes;
    if (p.volume_usd !== undefined) {
      volume_total = (volume_total ?? 0) + p.volume_usd;
    }
  }
  const change_pct = open === 0 ? 0 : ((close - open) / open) * 100;
  return {
    open,
    close,
    high,
    low,
    change_pct: Math.round(change_pct * 100) / 100,
    samples: series.length,
    ...(volume_total !== undefined ? { volume_total_usd: Math.round(volume_total * 100) / 100 } : {}),
  };
}
