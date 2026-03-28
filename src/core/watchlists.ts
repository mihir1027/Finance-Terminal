export const LS_WL_KEY  = 'kt_watchlists_v2';
export const LS_COL_KEY = 'kt_qm_cols_v1';
export const LS_WL_ORD  = 'kt_wl_order_v1';

export interface Watchlist {
  name: string;
  tickers: string[];
}

export function saveWatchlists(watchlists: Record<string, Watchlist>): void {
  try { localStorage.setItem(LS_WL_KEY, JSON.stringify(watchlists)); } catch (e) {}
}

export function loadWatchlists(): Record<string, Watchlist> {
  try {
    const raw = localStorage.getItem(LS_WL_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  // Default watchlists on first load
  const defaults: Record<string, Watchlist> = {
    List:    { name: 'List',    tickers: ['ADBE','ARKK','ERII','IGV','LTH','LYFT','MELI','PLNT','RDDT','TCPC','UBER','WDAY'] },
    Crypto:  { name: 'Crypto',  tickers: ['BTC-USD','ETH-USD','SOL-USD','BNB-USD','AVAX-USD'] },
    Futs:    { name: 'Futs',    tickers: ['ES=F','NQ=F','YM=F','CL=F','GC=F','NG=F'] },
    Main:    { name: 'Main',    tickers: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','V','SPY'] },
    Indices: { name: 'Indices', tickers: ['^GSPC','^DJI','^IXIC','^RUT','^VIX','^TNX'] },
  };
  saveWatchlists(defaults);
  return defaults;
}

export function getWLOrder(watchlists: Record<string, Watchlist>): string[] {
  try {
    const raw = localStorage.getItem(LS_WL_ORD);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return Object.keys(watchlists);
}

export function saveWLOrder(order: string[]): void {
  try { localStorage.setItem(LS_WL_ORD, JSON.stringify(order)); } catch (e) {}
}
