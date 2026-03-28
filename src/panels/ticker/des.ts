import { API, fp, fl, cd, ld } from '../../core/utils.js';

export function tvSymbol(tk){
  if(!tk) return tk;
  const t=tk.toUpperCase();
  // Indices
  const idxMap={'%5EGSPC':'SP:SPX','^GSPC':'SP:SPX','%5EDJI':'DJ:DJI','^DJI':'DJ:DJI',
    '%5EIXIC':'NASDAQ:COMP','^IXIC':'NASDAQ:COMP','%5ERUT':'TVC:RUT','^RUT':'TVC:RUT',
    '%5EFTSE':'TVC:UKX','^FTSE':'TVC:UKX','%5EGDAXI':'TVC:DAX','^GDAXI':'TVC:DAX',
    '%5EN225':'TVC:NI225','^N225':'TVC:NI225','%5EHSI':'TVC:HSI','^HSI':'TVC:HSI',
    '%5EFCHI':'TVC:CAC40','^FCHI':'TVC:CAC40','%5ESTOXX50E':'TVC:SX5E','^STOXX50E':'TVC:SX5E',
    '%5EVIX':  'TVC:VIX',  '^VIX':'TVC:VIX',
    '%5ETNX':  'TVC:TNX',  '^TNX':'TVC:TNX',
    '%5ETYX':  'TVC:TYX',  '^TYX':'TVC:TYX',
    '%5EIRX':  'TVC:IRX',  '^IRX':'TVC:IRX',
    '%5EFVX':  'TVC:FVX',  '^FVX':'TVC:FVX',
  };
  if(idxMap[t]) return idxMap[t];
  // Crypto — yfinance uses BTC-USD → BINANCE:BTCUSDT
  if(t.endsWith('-USD')){const base=t.replace('-USD','');return `BINANCE:${base}USDT`;}
  if(t.endsWith('-USDT')){return `BINANCE:${t.replace('-','')}` ;}
  // Futures — yfinance =F suffix → TradingView continuous
  const futMap={'GC=F':'COMEX:GC1!','SI=F':'COMEX:SI1!','CL=F':'NYMEX:CL1!',
    'BZ=F':'NYMEX:BB1!','NG=F':'NYMEX:NG1!','HG=F':'COMEX:HG1!',
    'PL=F':'NYMEX:PL1!','ZW=F':'CBOT:ZW1!','ZC=F':'CBOT:ZC1!',
    'ZS=F':'CBOT:ZS1!','KC=F':'ICEUS:KC1!','SB=F':'ICEUS:SB1!',
    'ES=F':'CME:ES1!','NQ=F':'CME:NQ1!','RTY=F':'CME:RTY1!',
    'YM=F':'CBOT:YM1!','ZB=F':'CBOT:ZB1!','ZN=F':'CBOT:ZN1!',
    '6E=F':'CME:6E1!','6J=F':'CME:6J1!','6B=F':'CME:6B1!',
  };
  if(futMap[t]) return futMap[t];
  if(t.endsWith('=F')) return t.replace('=F','1!'); // generic fallback
  // Forex =X suffix
  if(t.endsWith('=X')){
    const pair=t.replace('=X','');
    if(pair.length===6) return `FX:${pair}`;
    return `FX_IDC:${pair}`;
  }
  // ETFs and equities — assume NASDAQ or NYSE, TV auto-resolves
  // BRK-B → BRK.B
  if(t.includes('-')) return t.replace('-','.');
  return t; // plain ticker — TV resolves exchange automatically
}


export async function doDes(el,tk,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`DES: ${tk}`);
  try{
    const r=await fetch(`${API}/des/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    const d=cd(r.changePct),s=r.change>=0?'+':'',dec=r.price>1000?0:2;
    const tvSym=tvSymbol(tk);

    // ── Chart state ──────────────────────────────────────────────────────
    const MODES={
      INTRADAY:{label:'INTRADAY',intervals:[{l:'1m',v:'1'},{l:'5m',v:'5'},{l:'15m',v:'15'},{l:'1h',v:'60'},{l:'4h',v:'240'}],def:'15'},
      CHART:   {label:'CHART',   intervals:[{l:'D',v:'D'},{l:'W',v:'W'},{l:'M',v:'M'}],def:'D'},
    };
    let curMode='CHART', curInt='D', curType='1';

    // ── HTML shell ───────────────────────────────────────────────────────
    el.innerHTML=`
      <div class="des-hdr">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div class="des-name">${r.name}</div>
          <span style="font-size:9px;color:var(--dim);border:1px solid var(--bdr);padding:1px 6px;margin-left:10px;flex-shrink:0;letter-spacing:.06em">${r.ticker}</span>
        </div>
        <div class="des-sub">${r.exchange} · ${r.currency} · ${r.sector} · ${r.industry}<br>${r.country}${r.employees?` · ${r.employees.toLocaleString()} employees`:''}${r.website&&r.website!=='—'?`<br><a href="${r.website}" target="_blank" style="color:var(--cyan)">${r.website}</a>`:''}</div>
        <div class="des-prow">
          <div class="des-price ${d}">${fp(r.price,dec)}</div>
          <div class="des-chg ${d}">${s}${fp(r.change,dec)} (${s}${fp(r.changePct,2)}%)</div>
        </div>
      </div>
      <div class="des-main">
        <div class="des-left">
          <div class="des-desc-wrap">
            <div class="des-desc" id="des-desc-${wid}">${r.description||'No description available.'}</div>
            <span class="des-more" id="des-more-${wid}" onclick="window._desMore['${wid}']()" >See more ↓</span>
          </div>
          <div class="des-chart-area">
            <div id="des-tb-${wid}" style="display:flex;align-items:center;gap:2px;padding:4px 8px;border-bottom:1px solid var(--bdr);flex-shrink:0;flex-wrap:wrap;background:#0a0a0a"></div>
            <div id="tv-container-${wid}" style="flex:1;min-height:0;background:#0d0d0d"></div>
          </div>
        </div>
        <div class="des-right">${[
          ['MARKET',   [['Mkt Cap', fl(r.marketCap)],['Shares Out',fl(r.sharesOutstanding)],['Beta',fp(r.beta,2)]]],
          ['VALUATION',[['P/E (TTM)',fp(r.pe,1)],['EPS (TTM)',fp(r.eps,2)],['P/B',fp(r.pbRatio,2)],['Div Yield',r.dividendYield?(r.dividendYield*100).toFixed(2)+'%':'—']]],
          ['52W RANGE',[['High',fp(r.hi52,dec)],['Low',fp(r.lo52,dec)]]],
          ['HEADCOUNT',[['Employees',r.employees?r.employees.toLocaleString():'—']]],
        ].map(([hd,rows])=>`<div class="des-rg"><div class="des-rg-hd">${hd}</div>${rows.map(([l,v])=>`<div class="des-rrow"><span class="des-rl">${l}</span><span class="des-rv">${v}</span></div>`).join('')}</div>`).join('')}</div>
      </div>
    `;

    // ── See More toggle ──────────────────────────────────────────────────
    window._desMore=window._desMore||{};
    window._desMore[wid]=function(){
      const desc=document.getElementById(`des-desc-${wid}`);
      const btn=document.getElementById(`des-more-${wid}`);
      const exp=desc.classList.toggle('expanded');
      btn.textContent=exp?'See less ↑':'See more ↓';
    };

    // ── Build TV chart ───────────────────────────────────────────────────
    function buildDesChart(){
      const container=document.getElementById(`tv-container-${wid}`);
      if(!container) return;
      container.innerHTML='';
      function inject(){
        if(!window.TradingView) return;
        new window.TradingView.widget({
          autosize:true, symbol:tvSym, interval:curInt, range:'12M', timezone:'America/New_York',
          theme:'dark', style:curType, locale:'en', toolbar_bg:'#0d0d0d',
          enable_publishing:false, hide_top_toolbar:true, save_image:false,
          container_id:`tv-container-${wid}`, backgroundColor:'#0d0d0d',
          gridColor:'rgba(255,255,255,0.04)',
          overrides:{
            'paneProperties.background':'#0d0d0d','paneProperties.backgroundType':'solid',
            'paneProperties.vertGridProperties.color':'rgba(255,255,255,0.04)',
            'paneProperties.horzGridProperties.color':'rgba(255,255,255,0.04)',
            'scalesProperties.textColor':'#6b7280','scalesProperties.lineColor':'#252525',
            'candleStyle.upColor':'#4ade80','candleStyle.downColor':'#f87171',
            'candleStyle.borderUpColor':'#4ade80','candleStyle.borderDownColor':'#f87171',
            'candleStyle.wickUpColor':'#4ade80','candleStyle.wickDownColor':'#f87171',
            'lineStyle.color':'#4ade80',
            'areaStyle.color1':'rgba(74,222,128,0.3)','areaStyle.color2':'rgba(74,222,128,0.0)',
            'areaStyle.linecolor':'#4ade80',
          },
          studies_overrides:{'volume.volume.color.0':'#f87171','volume.volume.color.1':'#4ade80'},
          disabled_features:['use_localstorage_for_settings','left_toolbar','header_widget','context_menus','edit_buttons_in_legend','control_bar','timeframes_toolbar','main_series_scale_menu','scales_context_menu'],
          fullscreen:false,
        });
      }
      if(window.TradingView){inject();}
      else{
        const sc=document.createElement('script');
        sc.src='https://s3.tradingview.com/tv.js';
        sc.onload=inject;
        container.appendChild(sc);
      }
    }

    // ── Build toolbar ────────────────────────────────────────────────────
    function buildToolbar(){
      const tb=document.getElementById(`des-tb-${wid}`);
      if(!tb) return;
      const mode=MODES[curMode];
      const modeHtml=Object.keys(MODES).map(m=>
        `<button class="des-mode-btn${m===curMode?' active':''}" onclick="window._desTb['${wid}'].setMode('${m}')">${MODES[m].label}</button>`
      ).join('');
      const intHtml=mode.intervals.map(({l,v})=>
        `<button class="pb tv-int${v===curInt?' active':''}" onclick="window._desTb['${wid}'].setInt('${v}')">${l}</button>`
      ).join('');
      const typeHtml=[{l:'Candles',v:'1'},{l:'Line',v:'2'},{l:'Area',v:'3'}].map(({l,v})=>
        `<button class="pb tv-type${v===curType?' active':''}" onclick="window._desTb['${wid}'].setType('${v}')">${l}</button>`
      ).join('');
      tb.innerHTML=`
        ${modeHtml}
        <span style="color:var(--bdr2);margin:0 4px">|</span>
        <span style="font-size:8px;color:var(--dim);margin-right:2px">INTERVAL</span>
        ${intHtml}
        <span style="color:var(--bdr2);margin:0 4px">|</span>
        ${typeHtml}
        <span style="color:var(--bdr2);margin:0 4px">|</span>
        <button class="pb" onclick="window.open('https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}','_blank')" title="Open in TradingView">↗ TV</button>
      `;
    }

    // ── Toolbar callbacks ────────────────────────────────────────────────
    window._desTb=window._desTb||{};
    window._desTb[wid]={
      setMode(m){ curMode=m; curInt=MODES[m].def; buildToolbar(); buildDesChart(); },
      setInt(v){ curInt=v; buildToolbar(); buildDesChart(); },
      setType(v){ curType=v; buildToolbar(); buildDesChart(); },
    };

    buildToolbar();
    buildDesChart();

  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

