import type { HistoryRange, MarketHistory, NormalizedMarket } from "../schema.js";

export interface VenueAdapter {
  venue: NormalizedMarket["venue"];
  searchMarkets(query: string, limit?: number): Promise<NormalizedMarket[]>;
  getMarket(venueMarketId: string): Promise<NormalizedMarket | null>;
  listActive(limit?: number): Promise<NormalizedMarket[]>;
  listDisputed?(limit?: number): Promise<NormalizedMarket[]>;
  getHistory?(venueMarketId: string, range: HistoryRange): Promise<MarketHistory | null>;
}
