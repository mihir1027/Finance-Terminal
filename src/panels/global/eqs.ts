import { API, fp, fv, cd, pill, ld } from '../../core/utils.js';

export async function doEqs(el, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';

  if(!window._eqsWS) window._eqsWS={};
  if(!window._eqsWS[wid]) window._eqsWS[wid]={
    q:'', country:'', sector:'', market_cap:'', minMktCap:'', page:1, meta:null,
    period:'ytd', perfData:null
  };
  const ws=window._eqsWS[wid];

  const inpSty='background:#111;border:1px solid #252525;color:#ddd;font-family:var(--font);font-size:10px;padding:3px 7px;outline:none;border-radius:2px;height:22px;box-sizing:border-box;';
  const selSty=inpSty+'cursor:pointer;';
  const btnSty='background:#1a1a1a;border:1px solid #333;color:#bbb;font-family:var(--font);font-size:9px;letter-spacing:.08em;padding:3px 9px;cursor:pointer;border-radius:2px;height:22px;white-space:nowrap;';
  const toolbarId=`eqs-tb-${wid}`, bodyId=`eqs-bd-${wid}`, pagerId=`eqs-pg-${wid}`;
  const PERIODS=['ytd','1m','6m','1y','5y'];

  function fmtCap(v){
    if(!v) return '—';
    if(v>=1e12) return (v/1e12).toFixed(2)+'T';
    if(v>=1e9)  return (v/1e9).toFixed(2)+'B';
    if(v>=1e6)  return (v/1e6).toFixed(2)+'M';
    return v.toLocaleString();
  }

  function buildToolbar(){
    const m=ws.meta;
    const cOpts=m?m.countries.map(c=>`<option value="${c}"${ws.country===c?' selected':''}>${c}</option>`).join(''):'';
    const sOpts=m?m.sectors.map(s=>`<option value="${s}"${ws.sector===s?' selected':''}>${s}</option>`).join(''):'';
    const mcOpts=m?m.market_caps.map(c=>`<option value="${c}"${ws.market_cap===c?' selected':''}>${c}</option>`).join(''):'';
    const pbSty=(p)=>`background:none;border:1px solid ${ws.period===p?'var(--orange)':'#252525'};color:${ws.period===p?'var(--orange)':'#555'};font-family:var(--font);font-size:9px;letter-spacing:.06em;padding:2px 7px;cursor:pointer;border-radius:2px;`;
    const pBtns=PERIODS.map(p=>`<button id="eqs-pb-${p}-${wid}" style="${pbSty(p)}">${p.toUpperCase()}</button>`).join('');
    return `<div id="${toolbarId}" style="display:flex;flex-direction:column;flex-shrink:0;border-bottom:1px solid var(--bdr)">
      <div style="display:flex;gap:5px;align-items:center;padding:6px 10px;flex-wrap:wrap">
        <input id="eqs-q-${wid}" type="text" placeholder="Search ticker or name…" value="${ws.q}" style="${inpSty}width:175px">
        <select id="eqs-co-${wid}" style="${selSty}max-width:125px"><option value="">All Countries</option>${cOpts}</select>
        <select id="eqs-sec-${wid}" style="${selSty}max-width:135px"><option value="">All Sectors</option>${sOpts}</select>
        <select id="eqs-mc-${wid}" style="${selSty}max-width:90px"><option value="">All Caps</option>${mcOpts}</select>
        <input id="eqs-minmc-${wid}" type="number" placeholder="Min $M" value="${ws.minMktCap}" style="${inpSty}width:68px" title="Minimum market cap in millions (e.g. 50000 = $50B)">
        <button id="eqs-go-${wid}" style="${btnSty}color:var(--orange);border-color:var(--orange)">SCREEN</button>
        <button id="eqs-cl-${wid}" style="${btnSty}">CLEAR</button>
        <span id="eqs-ct-${wid}" style="margin-left:auto;font-size:9px;color:var(--dim)"></span>
      </div>
      <div style="display:flex;gap:4px;align-items:center;padding:2px 10px 5px">
        <span style="font-size:9px;color:#333;letter-spacing:.08em;margin-right:3px">PERIOD</span>
        ${pBtns}
      </div>
    </div>`;
  }

  function wireToolbar(){
    el.querySelector(`#eqs-go-${wid}`).addEventListener('click', screen);
    el.querySelector(`#eqs-cl-${wid}`).addEventListener('click',()=>{
      ws.q=''; ws.country=''; ws.sector=''; ws.market_cap=''; ws.minMktCap=''; ws.page=1;
      ws.perfData=null;
      el.querySelector(`#eqs-q-${wid}`).value='';
      const co=el.querySelector(`#eqs-co-${wid}`); if(co) co.value='';
      const se=el.querySelector(`#eqs-sec-${wid}`); if(se) se.value='';
      const mc=el.querySelector(`#eqs-mc-${wid}`); if(mc) mc.value='';
      el.querySelector(`#eqs-minmc-${wid}`).value='';
      fetchAndRender();
    });
    el.querySelector(`#eqs-q-${wid}`).addEventListener('keydown',e=>{if(e.key==='Enter') screen();});
    PERIODS.forEach(p=>{
      const btn=el.querySelector(`#eqs-pb-${p}-${wid}`);
      if(!btn) return;
      btn.addEventListener('click',()=>{
        ws.period=p; ws.perfData=null;
        PERIODS.forEach(pp=>{
          const b=el.querySelector(`#eqs-pb-${pp}-${wid}`);
          if(b){b.style.borderColor=pp===p?'var(--orange)':'#252525';b.style.color=pp===p?'var(--orange)':'#555';}
        });
        if(lastResults.length) fetchPerf(lastResults.map(r=>r.sym));
      });
    });
  }

  function screen(){
    ws.q=el.querySelector(`#eqs-q-${wid}`).value.trim();
    ws.country=el.querySelector(`#eqs-co-${wid}`)?.value||'';
    ws.sector=el.querySelector(`#eqs-sec-${wid}`)?.value||'';
    ws.market_cap=el.querySelector(`#eqs-mc-${wid}`)?.value||'';
    ws.minMktCap=el.querySelector(`#eqs-minmc-${wid}`).value.trim();
    ws.page=1; ws.perfData=null;
    fetchAndRender();
  }

  function pctStyle(v){ return v==null?'color:#555':v>=0?'color:#4ade80':'color:#f87171'; }
  function pctFmt(v){ if(v==null) return '—'; return (v>=0?'+':'')+v.toFixed(2)+'%'; }

  let lastResults=[], lastTotal=0, lastPage=1, lastTotalPages=1;

  function renderTable(results, total, page, totalPages){
    let rows=results;
    if(ws.minMktCap){
      const thr=parseFloat(ws.minMktCap)*1_000_000;
      rows=results.filter(r=>r.marketCap==null||r.marketCap>=thr);
    }
    const bd=el.querySelector(`#${bodyId}`);
    if(!bd) return;
    if(!rows.length){bd.innerHTML='<div style="padding:20px;color:var(--dim);font-size:11px;text-align:center">No results</div>';return;}

    const perfHdr=ws.period?`<th style="color:var(--orange);border-left:1px solid #1a1a1a">${ws.period.toUpperCase()}</th>`:'';
    const trs=rows.map(r=>{
      const pc=pctStyle(r.changePct);
      const pv=ws.perfData?.[r.sym]??null;
      const perfCell=ws.period?`<td style="font-variant-numeric:tabular-nums;text-align:right;${pctStyle(pv)};border-left:1px solid #1a1a1a">${pctFmt(pv)}</td>`:'';
      return `<tr style="cursor:pointer" onclick="runCmd('${r.sym} DES')">
        <td style="color:#e0a040;font-weight:600;white-space:nowrap">${r.sym}</td>
        <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#ccc">${r.name}</td>
        <td style="color:#777;font-size:10px;white-space:nowrap">${r.sector==='nan'?'—':r.sector}</td>
        <td style="color:#888;font-size:10px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.industry==='nan'?'—':r.industry}</td>
        <td style="color:#666;font-size:10px">${r.country==='nan'?'—':r.country}</td>
        <td style="color:#555;font-size:10px">${r.exchange==='nan'?'—':r.exchange}</td>
        <td style="color:#777;font-size:10px;white-space:nowrap">${r.market_cap==='nan'?'—':r.market_cap}</td>
        <td style="font-variant-numeric:tabular-nums;text-align:right;color:#aaa;font-size:10px">${fmtCap(r.marketCap)}</td>
        <td style="font-variant-numeric:tabular-nums;text-align:right">${r.price!=null?fp(r.price):'—'}</td>
        <td style="font-variant-numeric:tabular-nums;text-align:right;${pc}">${pctFmt(r.changePct)}</td>
        ${perfCell}
      </tr>`;
    }).join('');

    bd.innerHTML=`<div style="flex:1;overflow-y:auto"><table class="glco-tbl">
      <thead><tr>
        <th style="text-align:left">SYM</th>
        <th style="text-align:left">NAME</th>
        <th style="text-align:left">SECTOR</th>
        <th style="text-align:left">INDUSTRY</th>
        <th style="text-align:left">COUNTRY</th>
        <th style="text-align:left">EXCH</th>
        <th style="text-align:left">CAP TIER</th>
        <th>MCAP</th><th>PRICE</th><th>CHG%</th>${perfHdr}
      </tr></thead>
      <tbody>${trs}</tbody>
    </table></div>`;

    const ct=el.querySelector(`#eqs-ct-${wid}`);
    if(ct) ct.textContent=`${total.toLocaleString()} results`;

    const pg=el.querySelector(`#${pagerId}`);
    if(!pg) return;
    if(totalPages<=1){pg.innerHTML='';return;}
    const bP=`background:#111;border:1px solid #252525;color:#bbb;font-family:var(--font);font-size:9px;padding:2px 8px;cursor:pointer;border-radius:2px;`;
    const s2=Math.max(1,page-2), e2=Math.min(totalPages,page+2);
    let btns='';
    if(page>1) btns+=`<button style="${bP}" onclick="window._eqsGo_${wid}(${page-1})">◀</button>`;
    for(let i=s2;i<=e2;i++) btns+=`<button style="${bP}${i===page?'color:var(--orange);border-color:var(--orange);':''}" onclick="window._eqsGo_${wid}(${i})">${i}</button>`;
    if(page<totalPages) btns+=`<button style="${bP}" onclick="window._eqsGo_${wid}(${page+1})">▶</button>`;
    btns+=`<span style="font-size:9px;color:var(--dim);margin-left:6px">p.${page}/${totalPages}</span>`;
    pg.innerHTML=`<div style="display:flex;gap:4px;align-items:center;padding:5px 10px">${btns}</div>`;
  }

  async function fetchPerf(syms){
    if(!syms||!syms.length||!ws.period) return;
    try{
      const r=await fetch(`${API}/eqs/perf?syms=${syms.join(',')}&period=${ws.period}`).then(x=>x.json());
      if(r.ok){ws.perfData=r.perfs; renderTable(lastResults,lastTotal,lastPage,lastTotalPages);}
    }catch(_){}
  }

  async function fetchAndRender(){
    const bd=el.querySelector(`#${bodyId}`);
    if(bd) bd.innerHTML=ld('Screening…');
    ws.perfData=null;
    const p=new URLSearchParams({page:ws.page});
    if(ws.q)          p.set('q',ws.q);
    if(ws.country)    p.set('country',ws.country);
    if(ws.sector)     p.set('sector',ws.sector);
    if(ws.market_cap) p.set('market_cap',ws.market_cap);
    try{
      const r=await fetch(`${API}/eqs?${p}`).then(x=>x.json());
      if(!r.ok){if(bd) bd.innerHTML=`<div class="err">${r.error}</div>`;return;}
      lastResults=r.results; lastTotal=r.total; lastPage=r.page; lastTotalPages=r.totalPages;
      renderTable(r.results,r.total,r.page,r.totalPages);
      if(ws.period&&r.results.length) fetchPerf(r.results.map(x=>x.sym));
    }catch(e){if(bd) bd.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  window[`_eqsGo_${wid}`]=function(p){ws.page=p;fetchAndRender();};

  el.innerHTML=buildToolbar()+
    `<div id="${bodyId}" style="flex:1;overflow:hidden;display:flex;flex-direction:column">${ld('Loading…')}</div>`+
    `<div id="${pagerId}" style="flex-shrink:0;border-top:1px solid var(--bdr)"></div>`;
  wireToolbar();

  if(!ws.meta){
    try{
      const m=await fetch(`${API}/eqs/meta`).then(x=>x.json());
      if(m.ok){
        ws.meta=m;
        const tb=el.querySelector(`#${toolbarId}`);
        if(tb){tb.outerHTML=buildToolbar(); wireToolbar();}
      }
    }catch(_){}
  }
  fetchAndRender();
}

// ══════════════════════════════════════════════
//  GC — TREASURY YIELD CURVE + COMMODITY FORWARD CURVES
//  ✓ Ascending duration order
//  ✓ Commodity forward curves (contango/backwardation)
// ══════════════════════════════════════════════
