import { API, fp, cd, pill, ld, dc, charts } from '../../core/utils.js';
import { ow, registerFTimer } from '../../core/windowManager.js';

export async function doPred(el, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld('Fetching prediction markets…');

  let _data=null, _rendered=[], _ts=0, _countdown=60, _search='';
  let activeCat='all', activeSort='volume', activePlat='both', sortOpen=false;

  // ── helpers ──
  function fmt_pct(v){if(v==null)return'—';return(v*100).toFixed(1)+'%';}
  function fmt_vol(v){if(!v||v===0)return'—';if(v>=1e6)return'$'+(v/1e6).toFixed(1)+'M';if(v>=1e3)return'$'+(v/1e3).toFixed(0)+'K';return'$'+v.toFixed(0);}
  function fmt_date(s){if(!s)return'—';try{const d=new Date(s);if(isNaN(d))return'—';const diff=Math.round((d-Date.now())/864e5);if(diff<0)return'exp';if(diff===0)return'today';if(diff===1)return'tmrw';if(diff<=90)return diff+'d';return Math.round(diff/30)+'mo';}catch{return'—';}}
  function prob_color(p){if(p==null)return'#666';if(p>=.65)return'var(--green)';if(p<=.35)return'var(--red)';return'#ccc';}
  function spread_color(s){if(s>=5)return'var(--green)';if(s>=2)return'#ccc';return'#555';}

  // ── category classifier ──
  function classify(title){
    const t=title.toLowerCase();
    if(/bitcoin|btc|ethereum|eth|\bcrypto\b|blockchain|defi|\btoken\b|\bcoin\b|solana|doge|xrp|binance|coinbase/.test(t)) return'crypto';
    if(/elect|president|congress|senate|democrat|republican|trump|biden|harris|kamala|vote|ballot|govern|minister|mayor|prime\s*minister|nato|ukraine|russia|china|iran|war|ceasefire|tariff|sanction|geopolit|poll|approval/.test(t)) return'politics';
    if(/nba|nfl|mlb|nhl|soccer|tennis|football|basketball|baseball|hockey|champion|league|cup|super\s*bowl|world\s*cup|playoffs|finals|tournament|vs\.|\bsport|olympic|ufc|mma|boxing|golf|pga|ncaa/.test(t)) return'sports';
    if(/fed|federal\s*reserve|interest\s*rate|inflation|cpi|pce|gdp|unemployment|recession|jobs|economy|monetary|fiscal|fomc|rate\s*cut|rate\s*hike|basis\s*point|nonfarm|payroll|treasury|yield/.test(t)) return'economics';
    if(/stock|nasdaq|s&p|sp500|dow|earnings|ipo|merger|acquisition|bond|equity|dividend|etf|sec|valuation|index|market\s*cap/.test(t)) return'finance';
    return'other';
  }

  // ── detail popup ──
  async function doPredDetail(detEl, market, wid2){
    detEl.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
    const platCol=market.platform==='kalshi'?'#60a5fa':'#a78bfa';
    const platLabel=market.platform==='kalshi'?'KALSHI':'POLYMARKET';
    const oc=market.outcomes||[];
    const HIST_COLORS=['#4ade80','#38bdf8','#a78bfa','#fbbf24'];

    const outRows=oc.map((o,i)=>{
      const pct=fmt_pct(o.yes_price);
      const col=prob_color(o.yes_price);
      const bidAsk=(o.yes_bid&&o.yes_ask)?`${(o.yes_bid*100).toFixed(0)}/${(o.yes_ask*100).toFixed(0)}¢`:'—';
      return`<tr>
        <td style="color:#777;font-size:10px;width:18px;padding:4px 4px">${i+1}</td>
        <td style="color:${i===0?'#fff':'#ccc'};font-weight:${i===0?700:400};font-size:12px;text-align:left;padding:4px 6px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${(o.title||'').replace(/"/g,"'")}">${(o.title||'').slice(0,38)}</td>
        <td style="color:${col};font-weight:700;font-size:13px;text-align:right;width:56px;padding:4px 6px">${pct}</td>
        <td style="color:#999;text-align:right;width:60px;font-size:11px;padding:4px 6px">${bidAsk}</td>
        <td style="color:#888;text-align:right;width:56px;font-size:11px;padding:4px 6px">${fmt_vol(o.volume)}</td>
      </tr>`;
    }).join('');

    detEl.innerHTML=`
      <div style="padding:7px 10px;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:6px;flex-shrink:0">
        <span style="font-size:9px;color:${platCol};border:1px solid ${platCol};padding:1px 6px;border-radius:2px;letter-spacing:.08em;flex-shrink:0">${platLabel}</span>
        <span style="font-size:13px;color:#eee;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${market.title.replace(/"/g,"'")}">${market.title}</span>
        <span style="font-size:11px;color:#aaa;flex-shrink:0">EXP ${fmt_date(market.close_time)}</span>
      </div>
      <div style="flex-shrink:0;overflow-y:auto;max-height:185px;border-bottom:1px solid #111">
        <table class="mont" style="font-size:11px;width:100%">
          <thead><tr>
            <th style="width:18px"></th>
            <th style="text-align:left;padding:5px 6px">OUTCOME</th>
            <th style="text-align:right;padding:5px 6px">YES%</th>
            <th style="text-align:right;padding:5px 6px">BID/ASK</th>
            <th style="text-align:right;padding:5px 6px">VOL</th>
          </tr></thead>
          <tbody>${outRows}</tbody>
        </table>
      </div>
      <div style="display:flex;align-items:center;padding:4px 10px;border-bottom:1px solid #111;flex-shrink:0;gap:4px">
        <span style="font-size:9px;color:#777;letter-spacing:.1em;margin-right:4px">PROBABILITY HISTORY</span>
        <div id="pred-lgnd-${wid2}" style="display:flex;flex-wrap:wrap;gap:3px;flex:1"></div>
      </div>
      <div id="pred-hist-${wid2}" style="flex:1;min-height:0;position:relative"></div>
      <div style="padding:3px 8px;font-size:9px;color:#666;border-top:1px solid #0d0d0d;text-align:right;flex-shrink:0">Read only · No positions will be placed</div>`;

    const chartEl=document.getElementById(`pred-hist-${wid2}`);
    const lgndEl=document.getElementById(`pred-lgnd-${wid2}`);
    if(!chartEl||!oc.length) return;

    // fetch history for top 4 outcomes in parallel
    const platKey=market.platform==='polymarket'?'poly':'kalshi';
    const toFetch=oc.slice(0,4).map(o=>{
      const mktId=platKey==='poly'?o.clob_token:o.ticker;
      if(!mktId) return Promise.resolve({ok:false});
      return fetch(`${API}/pred/history?platform=${platKey}&market=${encodeURIComponent(mktId)}`)
        .then(x=>x.json()).catch(()=>({ok:false}));
    });
    const results=await Promise.all(toFetch);

    const hasData=results.some(r=>r.ok&&r.history&&r.history.length>1);
    if(!hasData){
      chartEl.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:10px;color:#444">No history available</div>';
      return;
    }

    const chart=LightweightCharts.createChart(chartEl,{
      width:chartEl.clientWidth||460, height:chartEl.clientHeight||160,
      layout:{background:{color:'#020202'},textColor:'#777'},
      grid:{vertLines:{color:'#111'},horzLines:{color:'#111'}},
      rightPriceScale:{borderColor:'#222'},
      timeScale:{borderColor:'#222',timeVisible:true},
      crosshair:{mode:1},
    });

    // build series + legend
    const legendItems=[];
    results.forEach((res,i)=>{
      if(!res.ok||!res.history||res.history.length<2) return;
      const o=oc[i];
      const series=chart.addLineSeries({
        color:HIST_COLORS[i]||'#888',
        lineWidth:i===0?2:1,
        priceFormat:{type:'custom',formatter:v=>v.toFixed(1)+'%'},
      });
      const seen=new Set();
      const pts=res.history.filter(p=>{if(seen.has(p.time))return false;seen.add(p.time);return true;})
        .sort((a,b)=>a.time-b.time);
      series.setData(pts.map(p=>({time:p.time,value:p.value})));
      legendItems.push({series,color:HIST_COLORS[i]||'#888',label:(o.title||'').slice(0,22),visible:true});
    });

    chart.timeScale().fitContent();

    // render legend
    if(lgndEl&&legendItems.length){
      lgndEl.innerHTML=legendItems.map((item,i)=>
        `<span data-li="${i}" style="cursor:pointer;display:inline-flex;align-items:center;gap:3px;padding:1px 6px;border:1px solid #222;border-radius:2px;user-select:none">
          <span style="display:inline-block;width:12px;height:${i===0?3:2}px;background:${item.color};border-radius:1px"></span>
          <span style="color:#ccc;font-size:9px">${item.label}</span>
        </span>`
      ).join('');
      lgndEl.querySelectorAll('[data-li]').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const item=legendItems[+btn.dataset.li];
          item.visible=!item.visible;
          item.series.applyOptions({visible:item.visible});
          btn.style.opacity=item.visible?'1':'0.35';
        });
      });
    }

    // resize observer — chart follows window resize
    new ResizeObserver(()=>{
      if(chartEl.clientWidth>0&&chartEl.clientHeight>0)
        chart.applyOptions({width:chartEl.clientWidth,height:chartEl.clientHeight});
    }).observe(chartEl);

    if(!window._predCharts) window._predCharts={};
    window._predCharts[wid2]=chart;
  }

  // ── row renderer ──
  function renderRows(rows){
    _rendered=rows;
    const showPlat=activePlat==='both';
    return rows.map((r,i)=>{
      const multiBadge=r.outcome_count>1?`<span style="color:#444;font-size:8px;margin-left:4px">[${r.outcome_count}]</span>`:'';
      const liqVal=r.liquidity>0?fmt_vol(r.liquidity):(r.open_interest>0?fmt_vol(r.open_interest):'—');
      const spread=r.yes_bid&&r.yes_ask?((r.yes_ask-r.yes_bid)*100).toFixed(1)+'¢':null;
      const titleTip=(r.title+(spread?' · Spread: '+spread:'')).replace(/"/g,"'");
      const oc=r.outcomes||[];
      let subLine='';
      const _sh=s=>(s||'').replace(/^will\s+/i,'').replace(/\?.*$/,'').trim();
      if(oc.length===2&&oc[0]&&oc[1]){
        subLine=`<div style="font-size:8px;margin-top:1px"><span style="color:${prob_color(oc[0].yes_price)}">${fmt_pct(oc[0].yes_price)}</span><span style="color:#555;margin-left:3px">· ${fmt_pct(oc[1].yes_price)}</span></div>`;
      }else if(oc.length>2&&oc[0]){
        const top=oc[0],sec=oc[1];
        subLine=`<div style="font-size:8px;margin-top:1px"><span style="color:${prob_color(top.yes_price)}">${_sh(top.title).slice(0,18)} ${fmt_pct(top.yes_price)}</span>${sec?`<span style="color:#555;margin-left:5px">${_sh(sec.title).slice(0,16)} ${fmt_pct(sec.yes_price)}</span>`:''}</div>`;
      }
      return`<tr data-idx="${i}" style="cursor:pointer">
        <td style="color:#666;width:18px">${i+1}</td>
        ${showPlat?`<td style="color:${r.platform==='kalshi'?'#60a5fa':'#a78bfa'};width:36px;font-weight:600">${r.platform==='kalshi'?'KLSH':'POLY'}</td>`:''}
        <td style="color:#eee;max-width:300px;text-align:left" title="${titleTip}"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.title}${multiBadge}</div>${subLine}</td>
        <td style="color:${prob_color(r.yes_price)};font-weight:700;width:54px;text-align:right">${fmt_pct(r.yes_price)}</td>
        <td style="color:#777;width:52px;text-align:right;font-size:10px">${spread||'—'}</td>
        <td style="color:#ccc;width:62px;text-align:right">${fmt_vol(r.volume24h)}</td>
        <td style="color:#999;width:56px;text-align:right">${liqVal}</td>
        <td style="color:#888;width:46px;text-align:right">${fmt_date(r.close_time)}</td>
      </tr>`;
    }).join('');
  }

  // ── arb renderer ──
  function renderArb(pairs){
    const warn=`<div style="padding:5px 10px 6px;background:#0d0d0d;border-bottom:1px solid #1e1e1e;font-size:8px;color:#555;flex-shrink:0;letter-spacing:.06em">
      ⚠ KEYWORD-MATCHED · VERIFY BOTH MARKETS RESOLVE ON THE SAME EVENT · SPREADS ≥5¢ IN GREEN
    </div>`;
    if(!pairs.length) return`<div style="display:flex;flex-direction:column;flex:1">${warn}<div style="padding:24px;color:#555;text-align:center;font-size:9px">No cross-platform matches found</div></div>`;
    const rows=pairs.map(p=>{
      const conf=p.match_score>=0.5?'HIGH':p.match_score>=0.4?'MED':'LOW';
      const confCol=p.match_score>=0.5?'var(--green)':p.match_score>=0.4?'#ccc':'#444';
      return`<tr>
        <td style="color:#ccc;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left" title="${p.kalshi_title}">${p.kalshi_title}</td>
        <td style="color:#ccc;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left" title="${p.poly_title}">${p.poly_title}</td>
        <td style="color:${prob_color(p.kalshi_yes)};font-weight:700;text-align:right">${fmt_pct(p.kalshi_yes)}</td>
        <td style="color:${prob_color(p.poly_yes)};font-weight:700;text-align:right">${fmt_pct(p.poly_yes)}</td>
        <td style="color:${spread_color(p.spread_cents)};font-weight:700;text-align:right">${p.spread_cents}¢</td>
        <td style="color:${confCol};font-size:8px;text-align:center">${conf}</td>
        <td style="color:#666;text-align:right">${fmt_vol(p.vol24_kalshi)}</td>
        <td style="color:#666;text-align:right">${fmt_vol(p.vol24_poly)}</td>
      </tr>`;
    }).join('');
    return`<div style="display:flex;flex-direction:column;flex:1;overflow:hidden">${warn}<div style="flex:1;overflow-y:auto"><table class="mont" style="font-size:11px">
      <thead><tr><th style="text-align:left">KALSHI MARKET</th><th style="text-align:left">POLYMARKET</th><th>KLSH</th><th>POLY</th><th>SPREAD</th><th>CONF</th><th>K-VOL</th><th>P-VOL</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
  }

  // ── main render ──
  function render(){
    if(!_data) return;
    const body=document.getElementById('pred-body');
    if(!body) return;
    const {kalshi,polymarket,arb}=_data;
    const now=Date.now();

    if(activeCat==='arb'){body.innerHTML=renderArb(arb);return;}

    let pool=activePlat==='kalshi'?[...kalshi]:activePlat==='poly'?[...polymarket]:[...kalshi,...polymarket];
    pool=pool.filter(m=>m.yes_price!=null);
    if(activeCat!=='all') pool=pool.filter(m=>classify(m.title)===activeCat);
    if(_search) pool=pool.filter(m=>m.title.toLowerCase().includes(_search.toLowerCase())||
      (m.outcomes||[]).some(o=>(o.title||'').toLowerCase().includes(_search.toLowerCase())));

    if(activeSort==='volume')    pool.sort((a,b)=>(b.volume24h||0)-(a.volume24h||0));
    else if(activeSort==='liq')  pool.sort((a,b)=>(b.liquidity||0)-(a.liquidity||0));
    else if(activeSort==='new')  pool.sort((a,b)=>new Date(b.created_time||0)-new Date(a.created_time||0));
    else if(activeSort==='5050') pool=pool.filter(m=>m.yes_price>=.42&&m.yes_price<=.58).sort((a,b)=>Math.abs(a.yes_price-.5)-Math.abs(b.yes_price-.5));
    else if(activeSort==='upcoming'){pool=pool.filter(m=>{const diff=(new Date(m.close_time||0)-now)/864e5;return diff>=0&&diff<=60;}).sort((a,b)=>new Date(a.close_time)-new Date(b.close_time));}

    const showPlat=activePlat==='both';
    const rows=pool.slice(0,100);
    const cnt=`<span style="font-size:9px;color:#555;margin-left:auto;margin-right:8px">${pool.length} markets</span>`;
    const thead=`<tr><th style="width:18px"></th>${showPlat?'<th>EXCH</th>':''}<th style="text-align:left">MARKET</th><th style="text-align:right">YES</th><th style="text-align:right">SPREAD</th><th style="text-align:right">VOL 24H</th><th style="text-align:right">DEPTH</th><th style="text-align:right">EXP</th></tr>`;
    body.innerHTML=`<div style="flex:1;overflow-y:auto"><div style="display:flex;align-items:center;padding:3px 8px;border-bottom:1px solid #0f0f0f">${cnt}</div><table class="mont" style="font-size:11px"><thead>${thead}</thead><tbody id="pred-tbody-${wid}">${renderRows(rows)}</tbody></table></div>`;
    const tbody=body.querySelector(`#pred-tbody-${wid}`);
    if(tbody) tbody.addEventListener('click',e=>{
      const tr=e.target.closest('tr[data-idx]');
      if(!tr) return;
      const m=_rendered[+tr.dataset.idx];
      if(!m) return;
      const label=m.title.slice(0,46)+(m.title.length>46?'…':'');
      ow('pred-detail',null,label,510,460,(detEl,_,wid2)=>doPredDetail(detEl,m,wid2));
    });
  }

  // ── toolbar builder ──
  function buildShell(){
    const cats=[
      {k:'all',      l:'ALL'},
      {k:'politics', l:'POLITICS'},
      {k:'economics',l:'ECONOMICS'},
      {k:'finance',  l:'FINANCE'},
      {k:'crypto',   l:'CRYPTO'},
      {k:'sports',   l:'SPORTS'},
      {k:'other',    l:'OTHER'},
      {k:'arb',      l:'⚡ ARB'},
    ];
    const plats=[{k:'both',l:'ALL'},{k:'kalshi',l:'KALSHI'},{k:'poly',l:'POLY'}];
    const sortLabels={volume:'VOL 24H',liq:'LIQUIDITY',new:'NEWEST','5050':'50/50',upcoming:'UPCOMING'};

    el.innerHTML=`
      <div id="pred-toolbar" style="display:flex;align-items:center;padding:5px 8px;border-bottom:1px solid var(--bdr);flex-shrink:0;gap:3px;flex-wrap:wrap">
        <div style="display:flex;gap:2px;flex:1;flex-wrap:wrap">
          ${cats.map(c=>`<span class="pred-cat${c.k===activeCat?' pred-cat-a':''}" data-cat="${c.k}"
            style="cursor:pointer;padding:2px 9px;font-size:9px;border:1px solid var(--bdr);border-radius:2px;white-space:nowrap">${c.l}</span>`).join('')}
        </div>
        <div style="width:1px;height:18px;background:var(--bdr);margin:0 4px"></div>
        <div style="display:flex;gap:2px">
          ${plats.map(p=>`<span class="pred-plat${p.k===activePlat?' pred-plat-a':''}" data-plat="${p.k}"
            style="cursor:pointer;padding:2px 7px;font-size:8px;border:1px solid #333;border-radius:2px;color:#777">${p.l}</span>`).join('')}
        </div>
        <div style="position:relative;margin-left:4px">
          <span id="pred-sort-btn" style="cursor:pointer;padding:2px 9px;font-size:9px;border:1px solid #444;border-radius:2px;color:#ccc;display:flex;align-items:center;gap:4px;user-select:none">
            <span id="pred-sort-label">${sortLabels[activeSort]}</span><span style="font-size:7px;color:#666">▾</span>
          </span>
          <div id="pred-sort-dd" style="display:none;position:absolute;right:0;top:calc(100% + 3px);background:#161616;border:1px solid #333;border-radius:2px;z-index:99;min-width:110px">
            ${Object.entries(sortLabels).map(([k,l])=>`<div class="pred-sort-opt" data-sort="${k}"
              style="padding:5px 12px;font-size:9px;cursor:pointer;color:${k===activeSort?'var(--green)':'#ccc'};white-space:nowrap">${l}</div>`).join('')}
          </div>
        </div>
        <input id="pred-search-${wid}" type="text" placeholder="⌕ search markets…"
          style="background:#0a0a0a;border:1px solid #333;color:#ccc;font-family:var(--font);font-size:9px;padding:2px 8px;border-radius:2px;width:150px;outline:none;margin-left:4px">
        <div style="display:flex;align-items:center;gap:5px;margin-left:4px">
          <span style="font-size:8px;color:#555">KLSH <span style="color:#60a5fa">●</span> POLY <span style="color:#a78bfa">●</span></span>
          <span id="pred-upd-${wid}" style="font-size:9px;color:#555">–</span>
          <span id="pred-cd-${wid}" style="font-size:9px;color:var(--green)">60s</span>
          <button id="pred-ref-${wid}" style="background:none;border:1px solid #333;color:#777;font-size:11px;padding:0 5px;cursor:pointer;border-radius:2px;font-family:var(--font);line-height:16px">↺</button>
          <span class="qm-live-dot" id="pred-dot-${wid}"></span>
        </div>
      </div>
      <div id="pred-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column">${ld('Loading…')}</div>`;

    el.querySelectorAll('.pred-cat').forEach(t=>t.addEventListener('click',()=>{
      activeCat=t.dataset.cat;
      el.querySelectorAll('.pred-cat').forEach(x=>x.classList.remove('pred-cat-a'));
      t.classList.add('pred-cat-a');
      render();
    }));
    el.querySelectorAll('.pred-plat').forEach(p=>p.addEventListener('click',()=>{
      if(activeCat==='arb') return;
      activePlat=p.dataset.plat;
      el.querySelectorAll('.pred-plat').forEach(x=>x.classList.remove('pred-plat-a'));
      p.classList.add('pred-plat-a');
      render();
    }));
    const sortBtn=el.querySelector('#pred-sort-btn');
    const sortDd=el.querySelector('#pred-sort-dd');
    sortBtn.addEventListener('click',e=>{e.stopPropagation();sortOpen=!sortOpen;sortDd.style.display=sortOpen?'block':'none';});
    el.querySelectorAll('.pred-sort-opt').forEach(o=>o.addEventListener('click',()=>{
      activeSort=o.dataset.sort;
      sortOpen=false; sortDd.style.display='none';
      el.querySelector('#pred-sort-label').textContent=sortLabels[activeSort];
      el.querySelectorAll('.pred-sort-opt').forEach(x=>x.style.color=x.dataset.sort===activeSort?'var(--green)':'#ccc');
      render();
    }));
    document.addEventListener('click',()=>{if(sortOpen){sortOpen=false;sortDd.style.display='none';}},{once:false});
    document.getElementById(`pred-ref-${wid}`)?.addEventListener('click',()=>{_countdown=60;load();});
    document.getElementById(`pred-search-${wid}`)?.addEventListener('input',e=>{_search=e.target.value;render();});
  }

  // ── data load (used for auto-refresh) ──
  async function load(){
    try{
      const r=await fetch(`${API}/pred`).then(x=>x.json());
      if(!r.ok) return;
      _data=r; _ts=Date.now();
      render();
      const upd=document.getElementById(`pred-upd-${wid}`);
      if(upd) upd.textContent='just now';
    }catch{}
  }

  try{
    const r=await fetch(`${API}/pred`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    _data=r; _ts=Date.now();
    buildShell();
    render();
    const upd=document.getElementById(`pred-upd-${wid}`);
    if(upd) upd.textContent='just now';
    registerFTimer(wid, setInterval(()=>{
      _countdown--;
      const cd=document.getElementById(`pred-cd-${wid}`);
      if(cd) cd.textContent=`${_countdown}s`;
      const updEl=document.getElementById(`pred-upd-${wid}`);
      if(updEl&&_ts){const ago=Math.round((Date.now()-_ts)/60000);updEl.textContent=ago<1?'just now':`${ago}m ago`;}
      if(_countdown<=0){_countdown=60;load();}
    },1000));
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}
