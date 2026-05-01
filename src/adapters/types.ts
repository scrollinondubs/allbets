import type { NormalizedMarket } from "../schema.js";

export interface VenueAdapter {
  venue: "polymarket" | "kalshi" | "limitless";

  searchMarkets(query: string, limit?: number): Promise<NormalizedMarket[]>;

  getMarket(venueMarketId: string): Promise<NormalizedMarket | null>;

  listActive(limit?: number): Promise<NormalizedMarket[]>;
}
