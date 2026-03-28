import { API, ld } from '../../core/utils.js';
import { tvSymbol } from './des.js';

export function doG(el,tk,defaultInterval,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';

  // TradingView interval codes: 1=1min, 5=5min, 15=15min, 60=1h, D=daily, W=weekly, M=monthly
  const intervals=[
    {lbl:'1m', tv:'1'},  {lbl:'5m',  tv:'5'},  {lbl:'15m', tv:'15'},
    {lbl:'1h', tv:'60'}, {lbl:'4h',  tv:'240'},{lbl:'D',   tv:'D'},
    {lbl:'W',  tv:'W'},  {lbl:'M',   tv:'M'},
  ];
  // Chart types
  const chartTypes=[
    {lbl:'Candles', tv:'1'},{lbl:'Bars',   tv:'0'},{lbl:'Line',   tv:'2'},
    {lbl:'Area',    tv:'3'},{lbl:'Heikin', tv:'8'},
  ];
  // Indicator studies (TradingView built-in study IDs)
  const indicators=[
    {lbl:'RSI',    id:'RSI@tv-basicstudies'},
    {lbl:'MACD',   id:'MACD@tv-basicstudies'},
    {lbl:'BB',     id:'BB@tv-basicstudies'},
    {lbl:'EMA 50', id:'MAExp@tv-basicstudies', inputs:{length:50}},
    {lbl:'SMA 200',id:'MASimple@tv-basicstudies', inputs:{length:200}},
  ];

  let curInterval  = defaultInterval || 'D';
  let curType      = '1'; // candlestick
  const activeInds = new Set<string>();

  const tvSym = tvSymbol(tk);

  function buildChart(){
    const container=document.getElementById(`tv-container-${wid}`);
    if(!container) return;
    container.innerHTML='';

    const studies=Array.from(activeInds);

    const script=document.createElement('script');
    script.type='text/javascript';
    script.src='https://s3.tradingview.com/tv.js';
    script.async=true;
    script.onload=()=>{
      if(!window.TradingView) return;
      new window.TradingView.widget({
        autosize:     true,
        symbol:       tvSym,
        interval:     curInterval,
        timezone:     'America/New_York',
        theme:        'dark',
        style:        curType,
        locale:       'en',
        toolbar_bg:   '#0d0d0d',
        enable_publishing: false,
        hide_top_toolbar:  false,
        hide_legend:       false,
        save_image:        false,
        container_id:      `tv-container-${wid}`,
        backgroundColor:   '#0d0d0d',
        gridColor:         'rgba(255,255,255,0.04)',
        studies,
        overrides: {
          'paneProperties.background':              '#0d0d0d',
          'paneProperties.backgroundType':          'solid',
          'paneProperties.vertGridProperties.color':'rgba(255,255,255,0.04)',
          'paneProperties.horzGridProperties.color':'rgba(255,255,255,0.04)',
          'scalesProperties.textColor':             '#6b7280',
          'scalesProperties.lineColor':             '#252525',
          'candleStyle.upColor':                    '#4ade80',
          'candleStyle.downColor':                  '#f87171',
          'candleStyle.borderUpColor':              '#4ade80',
          'candleStyle.borderDownColor':            '#f87171',
          'candleStyle.wickUpColor':                '#4ade80',
          'candleStyle.wickDownColor':              '#f87171',
          'hollowCandleStyle.upColor':              '#4ade80',
          'hollowCandleStyle.downColor':            '#f87171',
          'lineStyle.color':                        '#4ade80',
          'areaStyle.color1':                       'rgba(74,222,128,0.3)',
          'areaStyle.color2':                       'rgba(74,222,128,0.0)',
          'areaStyle.linecolor':                    '#4ade80',
        },
        studies_overrides: {
          'volume.volume.color.0': '#f87171',
          'volume.volume.color.1': '#4ade80',
          'volume.volume ma.color': '#fbbf24',
          'volume.volume ma.transparency': 30,
        },
        disabled_features: ['use_localstorage_for_settings'],
        enabled_features:  ['study_templates','side_toolbar_in_fullscreen_mode'],
        charts_storage_api_version: '1.1',
        client_id:    'kinetic_terminal',
        user_id:      'local_user',
        fullscreen:   false,
      });
    };

    if(window.TradingView){
      script.onload();
      return;
    }
    container.appendChild(script);
  }

  // Indicator toggle button rendering
  function renderIndBtns(){
    const row=document.getElementById(`tv-inds-${wid}`);
    if(!row) return;
    row.innerHTML=indicators.map(({lbl,id})=>{
      const on=activeInds.has(id);
      return`<button class="pb tv-ind${on?' active':''}" data-id="${id}" onclick="window._tvInd_${wid}('${id}')">${lbl}</button>`;
    }).join('');
  }

  // Signal badge from Alpha Vantage (async, non-blocking)
  async function loadSignalBadge(){
    const badge=document.getElementById(`tv-signal-${wid}`);
    if(!badge) return;
    try{
      const d=await fetch(`${API}/tech/${tk}`).then(x=>x.json());
      if(!d.ok) return;
      const sig=d.signal||'';
      const col=sig==='BULLISH'?'#4ade80':sig==='BEARISH'?'#f87171':'#888';
      badge.innerHTML=`<span style="color:${col};font-size:9px;letter-spacing:.06em">● ${sig}</span>`;
      if(d.rsi?.value!=null){
        badge.innerHTML+=`<span style="color:#555;font-size:9px;margin-left:8px">RSI ${d.rsi.value}</span>`;
      }
    }catch(e){}
  }

  el.innerHTML=`
    <div style="display:flex;align-items:center;gap:2px;padding:4px 8px;border-bottom:1px solid var(--bdr);flex-shrink:0;flex-wrap:wrap;background:#0a0a0a">
      <span style="font-size:9px;color:var(--dim);letter-spacing:.1em;margin-right:4px">${tvSym}</span>
      <span id="tv-signal-${wid}" style="margin-right:4px"></span>
      <span style="color:var(--bdr2);margin-right:4px">|</span>
      <span style="font-size:8px;color:var(--dim);margin-right:2px">INTERVAL:</span>
      ${intervals.map(({lbl,tv})=>`<button class="pb tv-int${tv===curInterval?' active':''}" data-tv="${tv}" onclick="window._tvInt_${wid}('${tv}')">${lbl}</button>`).join('')}
      <span style="color:var(--bdr2);margin:0 4px">|</span>
      <span style="font-size:8px;color:var(--dim);margin-right:2px">TYPE:</span>
      ${chartTypes.map(({lbl,tv})=>`<button class="pb tv-type${tv===curType?' active':''}" data-tvt="${tv}" onclick="window._tvType_${wid}('${tv}')">${lbl}</button>`).join('')}
      <span style="color:var(--bdr2);margin:0 4px">|</span>
      <span style="font-size:8px;color:var(--dim);margin-right:2px">INDICATORS:</span>
      <span id="tv-inds-${wid}" style="display:inline-flex;gap:2px"></span>
      <span style="color:var(--bdr2);margin:0 4px">|</span>
      <button class="pb" onclick="window._tvPop_${wid}()" title="Open in TradingView">↗ TV</button>
    </div>
    <div id="tv-container-${wid}" style="flex:1;min-height:0;background:#0d0d0d"></div>
  `;

  renderIndBtns();

  window[`_tvInt_${wid}`]=(tv)=>{
    curInterval=tv;
    document.querySelectorAll(`#wb-${wid} .tv-int`).forEach(b=>b.classList.toggle('active',b.dataset.tv===tv));
    buildChart();
  };
  window[`_tvType_${wid}`]=(tv)=>{
    curType=tv;
    document.querySelectorAll(`#wb-${wid} .tv-type`).forEach(b=>b.classList.toggle('active',b.dataset.tvt===tv));
    buildChart();
  };
  window[`_tvInd_${wid}`]=(id)=>{
    if(activeInds.has(id)) activeInds.delete(id); else activeInds.add(id);
    renderIndBtns();
    buildChart();
  };
  window[`_tvPop_${wid}`]=()=>{
    window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(tvSym)}`,'_blank');
  };

  buildChart();
  // Load signal badge asynchronously — doesn't block chart render
  loadSignalBadge();
}

