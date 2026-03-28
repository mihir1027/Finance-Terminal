import { API, fp, cd, ld } from '../../core/utils.js';
import { tip } from '../../core/tooltip.js';

// ── Shared perf-table renderer (WCR + GLCO) ──────────────────────────
export const _perfWS: Record<string, any> = {};
export async function _renderPerfWin(el, wid, cfg){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  if(!_perfWS[wid]) _perfWS[wid]={period:null,customFrom:'',customTo:'',periodsData:null,customPerf:null,rv:0,enrichCells:null};
  const ws=_perfWS[wid];
  const today=new Date().toISOString().slice(0,10);
  const inpS='background:#111;border:1px solid #252525;color:#bbb;font-family:var(--font);font-size:10px;padding:2px 6px;outline:none;border-radius:2px;';
  const btnS=(on)=>`cursor:pointer;padding:2px 8px;font-size:9px;border:1px solid ${on?'var(--orange)':'var(--bdr)'};border-radius:2px;color:${on?'var(--orange)':'var(--dim)'};font-family:var(--font);letter-spacing:.06em;user-select:none`;
  const pctFmt=(v)=>{if(v==null)return'<span style="color:#3a3a3a">—</span>';const s=v>=0?'+':'';return`<span class="${cd(v)}">${s}${v.toFixed(2)}%</span>`;};

  async function render(){
    ws.rv=(ws.rv||0)+1; const rv=ws.rv;
    const pid=`pwc-${wid}`;
    const pbtns=['1y','2y','3y','5y','10y'].map(p=>`<span class="pw-pb" data-p="${p}" style="${btnS(ws.period===p)}">${p.toUpperCase()}</span>`).join('');
    const showClr=!!(ws.period||(ws.customFrom&&ws.customPerf));
    el.innerHTML=`
      <div style="display:flex;gap:4px;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center;flex-wrap:wrap">
        <span style="font-size:9px;color:#555;letter-spacing:.06em">PERIOD</span>
        ${pbtns}
        <span style="width:1px;height:10px;background:#252525;margin:0 4px"></span>
        <span style="font-size:9px;color:#555;letter-spacing:.06em">FROM</span>
        <input id="${pid}-from" type="date" value="${ws.customFrom||''}" max="${today}" style="${inpS}">
        <span style="font-size:9px;color:#555;letter-spacing:.06em">TO</span>
        <input id="${pid}-to" type="date" value="${ws.customTo||today}" max="${today}" style="${inpS}">
        <span id="${pid}-go" style="${btnS(false)}">GO</span>
        ${showClr?`<span id="${pid}-clr" style="${btnS(false)}">✕</span>`:''}
      </div>
      <div id="${pid}-body" style="flex:1;overflow:hidden;display:flex;flex-direction:column">${ld('Loading…')}</div>`;
    el.querySelectorAll('.pw-pb').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const p=btn.dataset.p;
        if(ws.period===p){ws.period=null;render();return;}
        ws.period=p; ws.customFrom=''; ws.customTo=''; ws.customPerf=null;
        if(!ws.periodsData){
          btn.textContent='…'; btn.style.color='var(--amber)';
          try{const d=await fetch(cfg.periodsUrl).then(x=>x.json());if(d.ok)ws.periodsData=d;}catch(e){}
        }
        render();
      });
    });
    el.querySelector(`#${pid}-go`)?.addEventListener('click',async()=>{
      const from=(el.querySelector(`#${pid}-from`) as HTMLInputElement).value;
      const to=(el.querySelector(`#${pid}-to`) as HTMLInputElement).value||today;
      if(!from)return;
      ws.customFrom=from; ws.customTo=to; ws.period=null;
      const gb=el.querySelector(`#${pid}-go`);
      if(gb){(gb as HTMLElement).textContent='LOADING…';(gb as HTMLElement).style.color='var(--amber)';}
      try{const d=await fetch(`${cfg.perfUrl}?from=${from}&to=${to}`).then(x=>x.json());if(d.ok)ws.customPerf=d;}catch(e){}
      render();
    });
    el.querySelector(`#${pid}-clr`)?.addEventListener('click',()=>{
      ws.period=null; ws.customFrom=''; ws.customTo=''; ws.customPerf=null; render();
    });
    try{
      // Fetch main data and optional enrichment in parallel
      const [mainRes, enrichRes] = await Promise.allSettled([
        fetch(cfg.dataUrl).then(x=>x.json()),
        (cfg.enrichUrl && !ws.enrichCells) ? fetch(cfg.enrichUrl).then(x=>x.json()) : Promise.resolve(null),
      ]);
      if(ws.rv!==rv)return;
      if(mainRes.status==='rejected'||!mainRes.value?.ok){
        const b=el.querySelector(`#${pid}-body`);
        if(b)b.innerHTML=`<div class="err">${mainRes.status==='fulfilled'?mainRes.value?.error:'Backend offline'}</div>`;
        return;
      }
      // Build enrich cell map once, cache in ws
      if(enrichRes.status==='fulfilled'&&enrichRes.value?.ok&&cfg.enrichMap&&!ws.enrichCells){
        ws.enrichCells=cfg.enrichMap(enrichRes.value);
      }
      const r=mainRes.value;
      const items=r[cfg.symKey]||[];
      const map=Object.fromEntries(items.map(x=>[x.sym,x]));
      let extraHdr=''; let getExtra=(_sym)=>'';
      if(ws.period&&ws.periodsData){
        extraHdr=`<th>${ws.period.toUpperCase()}</th>`;
        getExtra=(sym)=>{const v=ws.periodsData?.periods?.[sym]?.[ws.period];return`<td class="glco-num">${pctFmt(v??null)}</td>`;};
      }else if(ws.customPerf&&ws.customFrom){
        const lbl=`${ws.customFrom.slice(5).replace('-','/')}→${ws.customTo.slice(5).replace('-','/')}`;
        extraHdr=`<th style="font-size:9px;letter-spacing:.03em">${lbl}</th>`;
        getExtra=(sym)=>`<td class="glco-num">${pctFmt(ws.customPerf?.perfs?.[sym]??null)}</td>`;
      }
      const hasEnrich=!!(cfg.enrichHdr&&ws.enrichCells);
      const enrichHdrHtml=hasEnrich?`<th style="font-size:9px;letter-spacing:.04em">${cfg.enrichHdr}</th>`:'';
      const totalCols=5+(extraHdr?1:0)+(hasEnrich?1:0)+(cfg.showTicker?1:0);
      let rows='';
      for(const g of cfg.groups){
        const gItems=g.keys?g.keys.map(k=>map[k]).filter(Boolean):items.filter(c=>c.category===g.key);
        if(!gItems.length)continue;
        rows+=`<tr class="glco-cat"><td colspan="${totalCols}">${g.label}</td></tr>`;
        for(const c of gItems){
          const d=cd(c.changePct),s=(c.change||0)>=0?'+':'';
          const dec=cfg.priceDecimals;
          const enrichCell=hasEnrich?(ws.enrichCells[c.sym]||`<td class="glco-num" style="color:#2a2a2a">—</td>`):'';
          const nameCell=cfg.showTicker
            ?`<td class="glco-ticker-cell">${c.sym}</td><td class="glco-name">${c.name}</td>`
            :`<td class="glco-name">${c.name}</td>`;
          rows+=`<tr>${nameCell}<td class="glco-num">${fp(c.price,dec)}</td><td class="glco-num ${d}">${c.change!=null?s+fp(c.change,dec):'—'}</td><td class="glco-num">${pctFmt(c.changePct)}</td><td class="glco-num">${pctFmt(c.ytdPct)}</td>${getExtra(c.sym)}${enrichCell}</tr>`;
        }
      }
      const body=el.querySelector(`#${pid}-body`);
      if(!body||ws.rv!==rv)return;
      const hdr=cfg.headers||{};
      const tickerHdr=cfg.showTicker?`<th style="text-align:left">TICKER</th>`:'';
      const nameTh=cfg.showTicker?`<th style="text-align:left">${cfg.colLabel}</th>`:`<th>${cfg.colLabel}</th>`;
      body.innerHTML=`<div style="flex:1;overflow-y:auto"><table class="glco-tbl"><thead><tr>${tickerHdr}${nameTh}<th>${hdr.price||'PRICE'}</th><th>${hdr.chg||'CHANGE'}</th><th>${hdr.chgPct||'DAY %'}</th><th>${hdr.ytd||'YTD %'}</th>${extraHdr}${enrichHdrHtml}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }catch(e){const b=el.querySelector(`#${pid}-body`);if(b&&ws.rv===rv)b.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }
  await render();
}

// ── GLCO ──
export async function doGlco(el, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';

  const tabBtnS=(active:boolean)=>`cursor:pointer;padding:2px 10px;font-size:9px;border:none;border-bottom:2px solid ${active?'var(--orange)':'transparent'};background:transparent;color:${active?'var(--orange)':'var(--dim)'};font-family:var(--font);letter-spacing:.06em;user-select:none`;

  el.innerHTML=`
    <div style="display:flex;gap:0;padding:0 6px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:#0a0a0a">
      <button id="glco-tab-prices-${wid}" style="${tabBtnS(true)}"  onclick="window._glcoTab_${wid}('prices')">PRICES</button>
      <button id="glco-tab-agri-${wid}"   style="${tabBtnS(false)}" onclick="window._glcoTab_${wid}('agri')">AGRICULTURAL</button>
    </div>
    <div id="glco-prices-${wid}" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>
    <div id="glco-agri-${wid}"   style="flex:1;overflow:hidden;display:none;flex-direction:column"></div>`;

  let usdaLoaded = false;

  // Render the existing prices tab
  const pricesEl = document.getElementById(`glco-prices-${wid}`) as HTMLElement;
  await _renderPerfWin(pricesEl, wid, {
    dataUrl:`${API}/glco`, periodsUrl:`${API}/glco/periods`, perfUrl:`${API}/glco/perf`,
    symKey:'commodities', colLabel:'COMMODITY', priceDecimals:null, showTicker:true,
    headers:{price:'PRICE',chg:'CHANGE',chgPct:'DAY %',ytd:'YTD %'},
    groups:[{label:'METALS',key:'METALS'},{label:'ENERGY',key:'ENERGY'},{label:'AGRICULTURE',key:'AGRI'},{label:'LIVESTOCK',key:'LIVESTOCK'}],
    enrichUrl:`${API}/glco/inventories`,
    enrichHdr:tip('STOCKS / INV','Energy: weekly EIA inventory (crude in Mbbl, nat gas in BCF, arrow = WoW change). Agriculture: USDA WASDE ending stocks for current marketing year (MMT = million metric tons, % = year-over-year change).'),
    enrichMap:(d:any)=>{
      const c=(d.energy||{}).crude||{}, g=(d.energy||{}).gasStorage||{};
      const ag:Record<string,any>=d.agStocks||{};

      // Energy — EIA weekly
      const fmbbl=(v:number|null,wow:number|null)=>{
        if(v==null)return`<td class="glco-num" style="color:#2a2a2a">—</td>`;
        const wowStr=wow!=null?` <span style="color:${wow<0?'#4ade80':'#f87171'};font-size:9px">${wow>=0?'+':''}${wow.toFixed(1)}</span>`:'';
        return`<td class="glco-num" style="color:#888">${v.toFixed(1)}M${wowStr}</td>`;
      };
      const fbcf=(v:number|null,wow:number|null)=>{
        if(v==null)return`<td class="glco-num" style="color:#2a2a2a">—</td>`;
        const wowStr=wow!=null?` <span style="color:${wow<0?'#4ade80':'#f87171'};font-size:9px">${wow>=0?'+':''}${Math.round(wow)}</span>`:'';
        return`<td class="glco-num" style="color:#888">${Math.round(v).toLocaleString()} BCF${wowStr}</td>`;
      };

      // Ag — USDA WASDE ending stocks
      const fagr=(sym:string)=>{
        const s=ag[sym];
        if(!s||s.value==null)return`<td class="glco-num" style="color:#2a2a2a">—</td>`;
        const yoyCol=s.yoy==null?'#555':s.yoy<=0?'#4ade80':'#f87171';
        const yoyStr=s.yoy!=null?` <span style="color:${yoyCol};font-size:9px">${s.yoy>=0?'+':''}${s.yoy}%</span>`:'';
        const myr=s.marketYear?` <span style="color:#333;font-size:8px">${s.marketYear}</span>`:'';
        return`<td class="glco-num" style="color:#888">${s.value.toFixed(s.value>=100?0:1)} ${s.unit||'MMT'}${yoyStr}${myr}</td>`;
      };

      return{
        'CL=F':fmbbl(c.value,c.wowChange),
        'NG=F':fbcf(g.value,g.wowChange),
        'ZC=F':fagr('ZC=F'),
        'ZW=F':fagr('ZW=F'),
        'ZS=F':fagr('ZS=F'),
        'CT=F':fagr('CT=F'),
        'SB=F':fagr('SB=F'),
        'KC=F':fagr('KC=F'),
        'CC=F':fagr('CC=F'),
      };
    },
  });

  // Agricultural prices tab loader (FRED/World Bank data)
  async function loadAgri(){
    if(usdaLoaded) return;
    usdaLoaded=true;
    const agEl=document.getElementById(`glco-agri-${wid}`) as HTMLElement;
    agEl.innerHTML=`<div style="padding:20px;color:#555;font-size:11px">Loading agricultural data…</div>`;
    try{
      const d=await fetch(`${API}/agri`).then(x=>x.json());
      if(!d.ok||!d.commodities?.length){
        agEl.innerHTML=`<div style="padding:20px;color:#555;font-size:11px">No data returned.<br><span style="color:#333;font-size:10px">${d.error||''}</span></div>`;
        return;
      }
      const pctCell=(v:number|null)=>{
        if(v==null) return`<td class="glco-num" style="color:#333">—</td>`;
        const col=v>=0?'#4ade80':'#f87171';
        return`<td class="glco-num" style="color:${col}">${v>=0?'+':''}${v.toFixed(2)}%</td>`;
      };
      const rows=d.commodities.map((r:any)=>`
        <tr>
          <td class="glco-name">${r.name}</td>
          <td class="glco-num" style="color:#ccc">${r.price.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
          <td class="glco-num" style="color:#555;font-size:9px">${r.unit}</td>
          ${pctCell(r.mom)}
          ${pctCell(r.yoy)}
          <td class="glco-num" style="color:#333;font-size:9px">${r.date}</td>
        </tr>`).join('');
      agEl.innerHTML=`
        <div style="padding:6px 10px 4px;font-size:8px;color:#444;letter-spacing:.08em;border-bottom:1px solid var(--bdr);flex-shrink:0">
          GLOBAL AGRICULTURAL COMMODITY PRICES &nbsp;·&nbsp; <span style="color:#333">World Bank / IMF via FRED</span>
        </div>
        <div style="flex:1;overflow-y:auto">
          <table class="glco-tbl">
            <thead><tr>
              <th>COMMODITY</th><th>PRICE</th><th>UNIT</th><th>MOM %</th><th>YOY %</th><th>AS OF</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="padding:4px 10px;font-size:8px;color:#2a2a2a;flex-shrink:0">Source: World Bank Commodity Price Data via FRED · Monthly</div>`;
    }catch(e){
      const agEl2=document.getElementById(`glco-agri-${wid}`);
      if(agEl2) agEl2.innerHTML=`<div style="padding:20px;color:#f87171;font-size:11px">Failed to load: ${e}</div>`;
    }
  }

  // Tab switcher
  window[`_glcoTab_${wid}`]=(tab:string)=>{
    const pricesPnl=document.getElementById(`glco-prices-${wid}`);
    const agriPnl  =document.getElementById(`glco-agri-${wid}`);
    const pricesBtn=document.getElementById(`glco-tab-prices-${wid}`);
    const agriBtn  =document.getElementById(`glco-tab-agri-${wid}`);
    if(!pricesPnl||!agriPnl||!pricesBtn||!agriBtn) return;
    if(tab==='prices'){
      pricesPnl.style.display='flex';
      agriPnl.style.display='none';
      pricesBtn.style.cssText=tabBtnS(true);
      agriBtn.style.cssText=tabBtnS(false);
    } else {
      pricesPnl.style.display='none';
      agriPnl.style.display='flex';
      pricesBtn.style.cssText=tabBtnS(false);
      agriBtn.style.cssText=tabBtnS(true);
      loadAgri();
    }
  };
}

// ── WCR ──
export async function doWcr(el, wid){
  await _renderPerfWin(el,wid,{
    dataUrl:`${API}/fx`, periodsUrl:`${API}/fx/periods`, perfUrl:`${API}/fx/perf`,
    symKey:'pairs', colLabel:'PAIR', priceDecimals:4,
    groups:[
      {label:'G10 MAJORS',       keys:['EURUSD=X','GBPUSD=X','USDJPY=X','USDCHF=X','AUDUSD=X','USDCAD=X','NZDUSD=X']},
      {label:'EMERGING MARKETS', keys:['USDCNY=X','USDINR=X','USDBRL=X','USDMXN=X','USDKRW=X']},
    ],
  });
}
