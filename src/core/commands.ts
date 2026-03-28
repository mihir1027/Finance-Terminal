export interface Cmd { key: string; desc: string; fkey?: string | null; }

export const GLOBAL_CMDS: Cmd[] = [
  {key:'WEI',   desc:'World Equity Indices'},
  {key:'GLCO',  desc:'Global Commodities'},
  {key:'FX',    desc:'Forex Cross-Rate Matrix'},
  {key:'WCR',   desc:'World Currency Rates'},
  {key:'SOVG',  desc:'World Sovereign Bonds'},
  {key:'SOVM',  desc:'Sovereign Debt by Country'},
  {key:'WB',    desc:'World Bond Markets'},
  {key:'GOVT',  desc:'Government Bond Monitor'},
  {key:'GC',    desc:'Yield & Forward Curves'},
  {key:'GP',    desc:'Graph Plot'},
  {key:'MOST',  desc:'Most Active Stocks'},
  {key:'PRED',  desc:'Prediction Markets'},
  {key:'FISC',  desc:'US Treasury Fiscal Data'},
  {key:'ECO',   desc:'Economic Calendar'},
  {key:'MAC',   desc:'US Macroeconomic Dashboard'},
  {key:'RATE',  desc:'Key Rates Monitor'},
  {key:'EQS',   desc:'Equity Screener'},
  {key:'SECF',  desc:'Securities Finder'},
  {key:'QM',    desc:'Quote Monitor'},
  {key:'FOCUS', desc:'Live Price Monitor'},
  {key:'NI',    desc:'News & Intelligence'},
  {key:'BIO',   desc:'Biography'},
  {key:'ECAL',  desc:'Earnings Calendar'},
  {key:'RES',   desc:'Research Reports'},
  {key:'HELP',  desc:'Command Reference'},
  {key:'PDF',   desc:'Terminal Preferences'},
];

export const TICKER_CMDS: Cmd[] = [
  {key:'Q',     desc:'Quick Quote'},
  {key:'DES',   desc:'Company Description'},
  {key:'FA',    desc:'Financial Statements'},
  {key:'G',     desc:'Advanced Chart'},
  {key:'GIP',   desc:'Intraday Chart'},
  {key:'N',     desc:'News'},
  {key:'HDS',   desc:'Institutional Holders'},
  {key:'ANR',   desc:'Analyst Ratings'},
  {key:'CF',    desc:'SEC Filings'},
  {key:'HP',    desc:'Historical Prices'},
  {key:'ERN',   desc:'Earnings History & Estimates'},
  {key:'EM',    desc:'Earnings Matrix'},
  {key:'MODL',  desc:'Financial Model'},
  {key:'HLDR',  desc:'ETF Holdings & Ownership'},
  {key:'FOCUS', desc:'Live Price Monitor'},
];

export const ASSET_CLASSES: Cmd[] = [
  {key:'EQ',   desc:'Equity',                    fkey:'F8'},
  {key:'CUR',  desc:'Currency',                  fkey:'F2'},
  {key:'OPT',  desc:'Option',                    fkey:'F9'},
  {key:'FUT',  desc:'Future',                    fkey:'F12'},
  {key:'IDX',  desc:'Index',                     fkey:'F10'},
  {key:'ETF',  desc:'Exchange-Traded Fund',      fkey:null},
  {key:'ETC',  desc:'Exchange-Traded Commodity', fkey:null},
  {key:'UT',   desc:'Unit',                      fkey:null},
  {key:'GOV',  desc:'Government Bond',           fkey:null},
  {key:'BET',  desc:'Betting Odds',              fkey:null},
  {key:'CORP', desc:'Corporate Bond',            fkey:'F3'},
];

/** Commands that don't require a ticker argument */
export const PURE = new Set([
  'HELP','WEI','GLCO','FX','MOST','EQS','SECF','GC','QM','SOVG','WB','GOVT','PRED','FISC',
  'ECO','MAC','RATE','SOVM','CORP','MTGE','M-MKT','MUNI','PFD','PORT','GP','BIO',
  'NI','ECAL','PDF','MODL','WCR','RES',
]);

/** Tokens to skip during command parsing (qualifiers, not tickers) */
export const SKIP = new Set(['US','EQ','UK','EU','ETF','CM','JP','CN','HK','CUR','OPT','FUT','IDX','ETC','GOV','CORP']);

/** Crypto ticker aliases */
export const TICKER_ALIAS: Record<string, string> = {
  BITCOIN:'BTC-USD', BTC:'BTC-USD',
  ETHEREUM:'ETH-USD', ETH:'ETH-USD',
  SOLANA:'SOL-USD',  SOL:'SOL-USD',
};
