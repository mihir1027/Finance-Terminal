// ── HELP ──
export function doHelp(el){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  const sec=(label)=>`<tr><td colspan="3" style="padding:5px 10px 3px;color:#3a3a3a;font-size:9px;letter-spacing:.14em;border-bottom:1px solid #1a1a1a;border-top:1px solid #1a1a1a;background:#080808;text-transform:uppercase">${label}</td></tr>`;
  const row=([k,t,ex])=>`<tr>
    <td style="padding:4px 10px;white-space:nowrap;color:#e0a040;font-weight:600;font-size:11px;vertical-align:top">${k}</td>
    <td style="padding:4px 10px;color:#aaa;font-size:10px;vertical-align:top">${t}</td>
    <td style="padding:4px 10px;color:var(--cyan);font-size:9px;vertical-align:top;white-space:nowrap">${ex}</td>
  </tr>`;

  const tickerCmds=[
    ['Q',           'Quick Quote',                         'AAPL  ·  AAPL EQ Q'],
    ['DES',         'Description + Mini Chart',             'AAPL EQ DES'],
    ['FA',          'Income / Balance / Cash Flow',         'TSLA EQ FA'],
    ['G',           'Advanced Chart (TradingView)',          'NVDA EQ G'],
    ['GIP',         'Intraday Chart (TradingView)',          'NVDA EQ GIP'],
    ['N',           'News Feed',                            'MSFT EQ N'],
    ['HDS',         'Institutional Holders',                'PLTR EQ HDS'],
    ['ANR',         'Analyst Ratings & Price Targets',      'NKE EQ ANR'],
    ['CF',          'SEC EDGAR Filings',                    'AAPL EQ CF'],
    ['HP',          'Historical Price Table',               'AAPL EQ HP'],
    ['ERN',         'Earnings History & Estimates',         'AAPL EQ ERN'],
    ['EM',          'Earnings Matrix — EPS & Revenue',      'AAPL EQ EM'],
    ['MODL',        'Historical Financial Model',           'AAPL EQ MODL'],
    ['HLDR',        'ETF Holdings & Ownership',             'ARKK EQ HLDR  ·  SPY HLDR'],
    ['FOCUS',       'Live Price Monitor',                   'NVDA EQ FOCUS'],
  ];
  const marketCmds=[
    ['WEI',         'World Equity Indices',                 'WEI'],
    ['GLCO',        'Global Commodities + Period Perf',     'GLCO'],
    ['FX',          'Forex Cross-Rate Matrix',              'FX'],
    ['WCR',         'World Currency Rates + Periods',       'WCR'],
    ['MOST',        'Most Active Equities',                 'MOST'],
    ['EQS',         'Equity Screener — 155k+ instruments',  'EQS'],
    ['QM',          'Quote Monitor — live multi-ticker',    'QM'],
  ];
  const fiCmds=[
    ['GC',          'Yield & Commodity Forward Curves',     'GC'],
    ['SOVG',        'World Sovereign Bond Monitor',         'SOVG'],
    ['SOVG [CC]',   'Country Yield Curve + Spreads',        'SOVG US  ·  SOVG DE'],
    ['WB',          'World Bond Markets (alias SOVG)',       'WB'],
    ['GOVT',        'Gov Bond Monitor (alias SOVG)',         'GOVT JP'],
    ['SOVM',        'Sovereign Debt by Country Code',       'SOVM DE'],
    ['RATE',        'Key Rates — SOFR, Treasuries, TIPS',   'RATE'],
  ];
  const macroCmds=[
    ['ECO',         'Economic Calendar',                    'ECO'],
    ['MAC',         'US Macroeconomic Dashboard (FRED)',    'MAC'],
    ['FISC',        'US Treasury Fiscal Data',              'FISC'],
    ['PRED',        'Prediction Markets (Kalshi + Poly)',   'PRED'],
    ['ECAL',        'Earnings Calendar — weekly view',      'ECAL'],
  ];
  const toolCmds=[
    ['GP',          'Graph Plot — FRED/equity overlay',     'GP'],
    ['NI',          'News & Intelligence (Wikipedia)',      'NI APPLE'],
    ['BIO',         'Biography',                            'BIO WARREN BUFFETT  ·  BIO BLACKROCK'],
    ['PDF',         'Terminal Preferences',                 'PDF'],
    ['HELP',        'This command reference',               'HELP'],
  ];

  const fkeys=[
    ['F1','HELP'],['F2','FX'],['F8','EQS'],['F9','GLCO'],['F10','WEI'],['F11','FX'],
  ];
  const qkeys=[
    ['F2','CUR'],['F3','CORP'],['F8','EQ'],['F9','OPT'],['F10','IDX'],['F12','FUT'],
  ];

  el.innerHTML=`
    <div style="padding:5px 12px;border-bottom:1px solid var(--bdr);font-size:9px;color:var(--dim);flex-shrink:0;line-height:1.8">
      Syntax: <span style="color:var(--green)">TICKER [EQ/US/etc] CMD</span>
      &nbsp;·&nbsp; Country/asset qualifiers are optional
      &nbsp;·&nbsp; Case-insensitive
      &nbsp;·&nbsp; Charts via <span style="color:var(--cyan)">TradingView</span>
    </div>
    <div style="flex:1;overflow-y:auto">
      <div style="display:flex;gap:0">
        <div style="flex:1;border-right:1px solid var(--bdr)">
          <table style="width:100%;border-collapse:collapse">
            ${sec('Ticker Commands (require a symbol)')}
            ${tickerCmds.map(row).join('')}
            ${sec('Tools')}
            ${toolCmds.map(row).join('')}
          </table>
        </div>
        <div style="flex:1">
          <table style="width:100%;border-collapse:collapse">
            ${sec('Market Data')}
            ${marketCmds.map(row).join('')}
            ${sec('Fixed Income & Rates')}
            ${fiCmds.map(row).join('')}
            ${sec('Economic & Macro')}
            ${macroCmds.map(row).join('')}
          </table>
        </div>
      </div>
      <div style="border-top:1px solid var(--bdr);padding:8px 12px;display:flex;gap:32px;flex-wrap:wrap">
        <div>
          <div style="font-size:8px;color:var(--dim);letter-spacing:.12em;margin-bottom:5px">FUNCTION KEYS (overview)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${fkeys.map(([k,v])=>`<span style="font-size:9px"><span style="background:#1c1400;color:#e0a040;padding:1px 5px;border-radius:2px;font-weight:700">${k}</span> <span style="color:#888">${v}</span></span>`).join('')}
          </div>
        </div>
        <div>
          <div style="font-size:8px;color:var(--dim);letter-spacing:.12em;margin-bottom:5px">FUNCTION KEYS (after TICKER + Space)</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${qkeys.map(([k,v])=>`<span style="font-size:9px"><span style="background:#052e16;color:#4ade80;padding:1px 5px;border-radius:2px;font-weight:700">${k}</span> <span style="color:#888">${v}</span></span>`).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}
