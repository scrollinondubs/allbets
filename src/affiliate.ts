import type { NormalizedMarket } from "./schema.js";

export interface AffiliateConfig {
  polymarket?: string;
  kalshi?: string;
  limitless?: string;
}

export interface WrappedUrl {
  url: string; // affiliate-wrapped if a code is configured for the venue, else the raw url
  raw_url: string; // always the bare url with no affiliate params
  is_affiliate_link: boolean;
  affiliate_disclosure?: string;
}

const DISCLOSURE =
  "This link includes an allbets referral code. If you sign up or trade through it, allbets may earn a share of trading fees.";

function appendQueryParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    // not a parseable URL — return unchanged so we never break the response
    return url;
  }
}

export function wrapAffiliate(
  venue: NormalizedMarket["venue"],
  rawUrl: string,
  config: AffiliateConfig,
): WrappedUrl {
  let code: string | undefined;
  let paramName = "ref";

  if (venue === "polymarket" || venue === "polymarket-qcex") {
    code = config.polymarket;
    paramName = "r"; // Polymarket uses ?r=<code> per their referral docs
  } else if (venue === "kalshi") {
    code = config.kalshi;
    paramName = "referral";
  } else if (venue === "limitless") {
    code = config.limitless;
    paramName = "ref";
  }

  if (!code) {
    return { url: rawUrl, raw_url: rawUrl, is_affiliate_link: false };
  }

  const wrapped = appendQueryParam(rawUrl, paramName, code);
  return {
    url: wrapped,
    raw_url: rawUrl,
    is_affiliate_link: wrapped !== rawUrl,
    affiliate_disclosure: DISCLOSURE,
  };
}

export function decorateMarket(
  market: NormalizedMarket,
  config: AffiliateConfig,
): NormalizedMarket {
  const wrapped = wrapAffiliate(market.venue, market.url, config);
  return {
    ...market,
    url: wrapped.url,
    raw_url: wrapped.raw_url,
    is_affiliate_link: wrapped.is_affiliate_link,
    affiliate_disclosure: wrapped.affiliate_disclosure,
  };
}

export function decorateMarkets(
  markets: NormalizedMarket[],
  config: AffiliateConfig,
): NormalizedMarket[] {
  return markets.map((m) => decorateMarket(m, config));
}
