import { API, fp, cd, ld, dc, charts } from '../../core/utils.js';

const _fxWS = {};  // persistent state per window id: {tab, inverted, fxmData}
export async function doFx(el, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  if(!_fxWS[wid]) _fxWS[wid]={tab:'matrix',inverted:false,fxmData:null,rv:0};
  const ws=_fxWS[wid];

  const FLAGS={USD:'🇺🇸',EUR:'🇪🇺',GBP:'🇬🇧',
    JPY:'🇯🇵',CHF:'🇨🇭',CAD:'🇨🇦',
    AUD:'🇦🇺',NZD:'🇳🇿',HKD:'🇭🇰',
    NOK:'🇳🇴',SEK:'🇸🇪',CNY:'🇨🇳',
    RUB:'🇷🇺',INR:'🇮🇳'};

  const bodyId=`fx-body-${wid}`;

  function tabBar(){
    return `<div style="display:flex;gap:3px;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center">
      <span class="fx-tab${ws.tab==='matrix'?' active':''}" data-t="matrix">MATRIX</span>
      <span class="fx-tab${ws.tab==='pairs'?' active':''}" data-t="pairs">PAIRS</span>
    </div>`;
  }

  function wireTabBar(){
    el.querySelectorAll('.fx-tab').forEach(t=>t.addEventListener('click',()=>{
      ws.tab=t.dataset.t; render();
    }));
  }

  function heatStyle(val, rowVals){
    const nums=rowVals.filter(v=>v!=null);
    if(!nums.length) return 'color:#fff;';
    const mn=Math.min(...nums), mx=Math.max(...nums);
    if(mx===mn) return 'color:#fff;';
    const t=(val-mn)/(mx-mn);
    if(t>0.80) return 'background:rgba(74,222,128,.28);color:#fff;';
    if(t>0.60) return 'background:rgba(74,222,128,.14);color:#fff;';
    if(t<0.20) return 'background:rgba(248,113,113,.28);color:#fff;';
    if(t<0.40) return 'background:rgba(248,113,113,.14);color:#fff;';
    return 'color:#fff;';
  }

  async function renderMatrix(body, rv){
    body.innerHTML=ld('Loading matrix…');
    try{
      if(!ws.fxmData){
        const r=await fetch(`${API}/fxmatrix`).then(x=>x.json());
        if(ws.rv!==rv) return;  // superseded by a newer render
        if(!r.ok){body.innerHTML=`<div class="err">${r.error}</div>`;return;}
        ws.fxmData=r;
      }
      if(ws.rv!==rv) return;
      const {currencies,usdRates}=ws.fxmData;
      const inpS='background:#111;border:1px solid #252525;color:#ddd;font-family:var(--font);font-size:10px;padding:3px 6px;outline:none;border-radius:2px;';
      const selOpts=currencies.map(c=>`<option value="${c}">${FLAGS[c]||''} ${c}</option>`).join('');
      const mid=`fxh-${wid||0}`;
      const toolbar=`<div style="display:flex;gap:6px;padding:6px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center;background:#0a0a0a">
        <span id="${mid}-inv" style="cursor:pointer;padding:2px 8px;font-size:9px;border:1px solid var(--bdr);border-radius:2px;color:var(--dim);font-family:var(--font);letter-spacing:.06em;user-select:none">⇄ INVERT</span>
        <span style="width:1px;height:12px;background:var(--bdr);margin:0 2px"></span>
        <select id="${mid}-from" tabindex="1" style="${inpS}">${selOpts}</select>
        <input  id="${mid}-amt"  tabindex="2" type="number" value="100" style="${inpS}width:72px">
        <span style="color:var(--dim);font-size:11px">→</span>
        <select id="${mid}-to"   tabindex="3" style="${inpS}">${selOpts}</select>
        <span id="${mid}-res" style="font-size:13px;font-weight:700;color:#fff;min-width:90px;font-variant-numeric:tabular-nums">—</span>
      </div>`;
      const colHdrs=currencies.map(c=>`<th>${FLAGS[c]||''} ${c}</th>`).join('');
      let rows='';
      for(const base of currencies){
        const rowVals=currencies.map(q=>base===q?null:usdRates[base]/usdRates[q]);
        let cells='';
        for(let qi=0;qi<currencies.length;qi++){
          const quote=currencies[qi];
          if(base===quote){cells+=`<td class="fxm-self">—</td>`;continue;}
          const val=ws.inverted ? usdRates[quote]/usdRates[base] : usdRates[base]/usdRates[quote];
          const normVals=ws.inverted ? currencies.map(q2=>base===q2?null:usdRates[q2]/usdRates[base]) : rowVals;
          cells+=`<td style="${heatStyle(val,normVals)}">${fp(val)}</td>`;
        }
        rows+=`<tr><td class="fxm-row-hdr">${FLAGS[base]||''} ${base}</td>${cells}</tr>`;
      }
      body.innerHTML=toolbar+`<div style="flex:1;overflow:auto"><table class="fxm">
        <thead><tr><th class="fxm-row-hdr"></th>${colHdrs}</tr></thead>
        <tbody>${rows}</tbody></table></div>`;
      const fromSel=body.querySelector(`#${mid}-from`);
      const toSel=body.querySelector(`#${mid}-to`);
      fromSel.value='USD'; toSel.value='EUR';
      function doConvert(){
        const amt=parseFloat(body.querySelector(`#${mid}-amt`).value)||0;
        const from=fromSel.value, to=toSel.value;
        if(!usdRates[from]||!usdRates[to]) return;
        const rate=usdRates[from]/usdRates[to];
        body.querySelector(`#${mid}-res`).textContent=fp(amt*rate,4)+' '+to;
      }
      body.querySelector(`#${mid}-amt`).addEventListener('input',doConvert);
      fromSel.addEventListener('change',doConvert);
      toSel.addEventListener('change',doConvert);
      doConvert();
      body.querySelector(`#${mid}-inv`).addEventListener('click',()=>{
        ws.inverted=!ws.inverted;
        ws.rv = (ws.rv||0) + 1;
        renderMatrix(body, ws.rv);
      });
    }catch(e){body.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  async function renderPairs(body, rv){
    if(!ws.pairs) ws.pairs={period:null,customFrom:'',customTo:'',periodsData:null,customPerf:null};
    const ps=ws.pairs;
    const today=new Date().toISOString().slice(0,10);
    const inpS='background:#111;border:1px solid #252525;color:#bbb;font-family:var(--font);font-size:10px;padding:2px 6px;outline:none;border-radius:2px;';
    const btnS=(on)=>`cursor:pointer;padding:2px 8px;font-size:9px;border:1px solid ${on?'var(--orange)':'var(--bdr)'};border-radius:2px;color:${on?'var(--orange)':'var(--dim)'};font-family:var(--font);letter-spacing:.06em;user-select:none`;
    const pctFmt=(v)=>{if(v==null)return'<span style="color:#3a3a3a">—</span>';const s=v>=0?'+':'';return`<span class="${cd(v)}">${s}${v.toFixed(2)}%</span>`;};
    const pid=`fxp-${wid||0}`;
    const pbtns=['1y','2y','3y','5y','10y'].map(p=>`<span class="fxp-pb" data-p="${p}" style="${btnS(ps.period===p)}">${p.toUpperCase()}</span>`).join('');
    const showClr=!!(ps.period||(ps.customFrom&&ps.customPerf));
    body.innerHTML=`
      <div style="display:flex;gap:4px;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center;flex-wrap:wrap">
        <span style="font-size:9px;color:#555;letter-spacing:.06em">PERIOD</span>
        ${pbtns}
        <span style="width:1px;height:10px;background:#252525;margin:0 4px"></span>
        <span style="font-size:9px;color:#555;letter-spacing:.06em">FROM</span>
        <input id="${pid}-from" type="date" value="${ps.customFrom||''}" max="${today}" style="${inpS}">
        <span style="font-size:9px;color:#555;letter-spacing:.06em">TO</span>
        <input id="${pid}-to" type="date" value="${ps.customTo||today}" max="${today}" style="${inpS}">
        <span id="${pid}-go" style="${btnS(false)}">GO</span>
        ${showClr?`<span id="${pid}-clr" style="${btnS(false)}">✕</span>`:''}
      </div>
      <div id="${pid}-tbl" style="flex:1;overflow:hidden;display:flex;flex-direction:column">${ld('Loading…')}</div>`;
    // Period buttons
    body.querySelectorAll('.fxp-pb').forEach(btn=>{
      btn.addEventListener('click',async()=>{
        const p=btn.dataset.p;
        if(ps.period===p){ps.period=null;ws.rv=(ws.rv||0)+1;renderPairs(body,ws.rv);return;}
        ps.period=p; ps.customFrom=''; ps.customTo=''; ps.customPerf=null;
        if(!ps.periodsData){
          btn.textContent='…'; btn.style.color='var(--amber)';
          try{const d=await fetch(`${API}/fx/periods`).then(x=>x.json());if(d.ok)ps.periodsData=d;}catch(e){}
        }
        ws.rv=(ws.rv||0)+1; renderPairs(body,ws.rv);
      });
    });
    body.querySelector(`#${pid}-go`)?.addEventListener('click',async()=>{
      const from=body.querySelector(`#${pid}-from`).value;
      const to=body.querySelector(`#${pid}-to`).value||today;
      if(!from)return;
      ps.customFrom=from; ps.customTo=to; ps.period=null;
      const gb=body.querySelector(`#${pid}-go`);
      if(gb){gb.textContent='LOADING…';gb.style.color='var(--amber)';}
      try{const d=await fetch(`${API}/fx/perf?from=${from}&to=${to}`).then(x=>x.json());if(d.ok)ps.customPerf=d;}catch(e){}
      ws.rv=(ws.rv||0)+1; renderPairs(body,ws.rv);
    });
    body.querySelector(`#${pid}-clr`)?.addEventListener('click',()=>{
      ps.period=null; ps.customFrom=''; ps.customTo=''; ps.customPerf=null;
      ws.rv=(ws.rv||0)+1; renderPairs(body,ws.rv);
    });
    // Fetch data and fill table
    try{
      const r=await fetch(`${API}/fx`).then(x=>x.json());
      if(ws.rv!==rv)return;
      if(!r.ok){const t=body.querySelector(`#${pid}-tbl`);if(t)t.innerHTML=`<div class="err">${r.error}</div>`;return;}
      const groups=[
        {label:'G10 MAJORS',       keys:['EURUSD=X','GBPUSD=X','USDJPY=X','USDCHF=X','AUDUSD=X','USDCAD=X','NZDUSD=X']},
        {label:'EMERGING MARKETS', keys:['USDCNY=X','USDINR=X','USDBRL=X','USDMXN=X','USDKRW=X']},
      ];
      const map=Object.fromEntries(r.pairs.map(p=>[p.sym,p]));
      let extraHdr=''; let getExtra=()=>'';
      if(ps.period&&ps.periodsData){
        extraHdr=`<th>${ps.period.toUpperCase()}</th>`;
        getExtra=(sym)=>{const v=ps.periodsData?.periods?.[sym]?.[ps.period];return`<td class="glco-num">${pctFmt(v??null)}</td>`;};
      }else if(ps.customPerf&&ps.customFrom){
        const lbl=`${ps.customFrom.slice(5).replace('-','/')}→${ps.customTo.slice(5).replace('-','/')}`;
        extraHdr=`<th style="font-size:9px;letter-spacing:.03em">${lbl}</th>`;
        getExtra=(sym)=>`<td class="glco-num">${pctFmt(ps.customPerf?.perfs?.[sym]??null)}</td>`;
      }
      const totalCols=5+(extraHdr?1:0);
      let rows='';
      ws.prevPrices = ws.prevPrices || {};
      for(const g of groups){
        rows+=`<tr class="glco-cat"><td colspan="${totalCols}">${g.label}</td></tr>`;
        for(const key of g.keys){
          const c=map[key];if(!c)continue;
          ws.prevPrices[key]=c.price;
          const sid=key.replace(/[^a-zA-Z0-9]/g,'_');
          const d=cd(c.changePct),s=(c.change||0)>=0?'+':'';
          rows+=`<tr>`+
            `<td class="glco-name">${c.name}</td>`+
            `<td class="glco-num" id="${pid}-p-${sid}">${fp(c.price,4)}</td>`+
            `<td class="glco-num ${d}" id="${pid}-c-${sid}">${c.change!=null?s+fp(c.change,4):'—'}</td>`+
            `<td class="glco-num" id="${pid}-cp-${sid}">${pctFmt(c.changePct)}</td>`+
            `<td class="glco-num" id="${pid}-y-${sid}">${pctFmt(c.ytdPct)}</td>`+
            `${getExtra(key)}</tr>`;
        }
      }
      const tbl=body.querySelector(`#${pid}-tbl`);
      if(!tbl||ws.rv!==rv)return;
      tbl.innerHTML=`<div style="flex:1;overflow-y:auto"><table class="glco-tbl"><thead><tr><th>PAIR</th><th>RATE</th><th>DAY CHG</th><th>DAY %</th><th>YTD %</th>${extraHdr}</tr></thead><tbody>${rows}</tbody></table></div>`;

      // Live polling — update cells in-place and flash on price change
      if(ws.pollTimer) clearInterval(ws.pollTimer);
      ws.pollTimer = setInterval(async()=>{
        if(ws.rv!==rv){clearInterval(ws.pollTimer);return;}
        try{
          const pr=await fetch(`${API}/fx`).then(x=>x.json());
          if(!pr.ok||ws.rv!==rv) return;
          for(const pair of pr.pairs){
            const sid=pair.sym.replace(/[^a-zA-Z0-9]/g,'_');
            const priceEl=document.getElementById(`${pid}-p-${sid}`);
            if(!priceEl){clearInterval(ws.pollTimer);return;}  // panel gone
            const prev=ws.prevPrices[pair.sym];
            const cur=pair.price;
            if(cur!=null && prev!=null && cur!==prev){
              const fc=cur>prev?'fx-flash-up':'fx-flash-dn';
              priceEl.classList.remove('fx-flash-up','fx-flash-dn');
              void priceEl.offsetWidth;
              priceEl.classList.add(fc);
              ws.prevPrices[pair.sym]=cur;
            }
            if(cur!=null) priceEl.textContent=fp(cur,4);
            const chgEl=document.getElementById(`${pid}-c-${sid}`);
            const pctEl=document.getElementById(`${pid}-cp-${sid}`);
            const ytdEl=document.getElementById(`${pid}-y-${sid}`);
            const s=(pair.change||0)>=0?'+':'';
            if(chgEl){chgEl.className=`glco-num ${cd(pair.changePct)}`;chgEl.innerHTML=pair.change!=null?s+fp(pair.change,4):'—';}
            if(pctEl) pctEl.innerHTML=pctFmt(pair.changePct);
            if(ytdEl) ytdEl.innerHTML=pctFmt(pair.ytdPct);
          }
        }catch(_){}
      }, 15000);
    }catch(e){const t=body.querySelector(`#${pid}-tbl`);if(t&&ws.rv===rv)t.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  async function renderConverter(body){
    body.innerHTML=ld('Loading…');
    try{
      const r=await fetch(`${API}/fxmatrix`).then(x=>x.json());
      if(!r.ok){body.innerHTML=`<div class="err">${r.error}</div>`;return;}
      const {currencies,usdRates}=r;
      const inpSty='background:#111;border:1px solid #252525;color:#ddd;font-family:var(--font);font-size:11px;padding:4px 7px;outline:none;border-radius:2px;';
      const selOpts=currencies.map(c=>`<option value="${c}">${FLAGS[c]||''} ${c}</option>`).join('');
      const cvid=`fxcv-${wid||0}`;
      body.innerHTML=`<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px">
        <div style="font-size:9px;color:var(--dim);letter-spacing:.1em">CURRENCY CONVERTER</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:center">
          <input id="${cvid}-amt" type="number" value="100" tabindex="1" style="${inpSty}width:90px">
          <select id="${cvid}-from" tabindex="2" style="${inpSty}">${selOpts}</select>
          <span style="color:var(--dim);font-size:13px">=</span>
          <span id="${cvid}-result" style="font-size:22px;font-weight:700;color:#fff;min-width:130px;text-align:right">—</span>
          <select id="${cvid}-to" tabindex="3" style="${inpSty}">${selOpts}</select>
        </div>
        <div id="${cvid}-label" style="font-size:9px;color:var(--dim)"></div>
        <div style="margin-top:12px;width:100%;max-width:460px">
          <div style="font-size:8px;color:var(--dim);letter-spacing:.1em;margin-bottom:6px;border-bottom:1px solid var(--bdr);padding-bottom:4px">QUICK CROSS RATES</div>
          <table style="width:100%;font-size:10px;border-collapse:collapse" id="${cvid}-xtbl"></table>
        </div>
      </div>`;
      const fromSel=body.querySelector(`#${cvid}-from`);
      const toSel=body.querySelector(`#${cvid}-to`);
      fromSel.value='USD'; toSel.value='EUR';
      function convert(){
        const amt=parseFloat(body.querySelector(`#${cvid}-amt`).value)||0;
        const from=fromSel.value, to=toSel.value;
        if(!usdRates[from]||!usdRates[to]) return;
        const rate=usdRates[from]/usdRates[to];
        body.querySelector(`#${cvid}-result`).textContent=fp(amt*rate,4);
        body.querySelector(`#${cvid}-label`).textContent=`1 ${from} = ${fp(rate,6)} ${to}  ·  1 ${to} = ${fp(1/rate,6)} ${from}`;
        const xtbl=body.querySelector(`#${cvid}-xtbl`);
        xtbl.innerHTML=currencies.filter(c=>c!==from).map(c=>{
          const r2=usdRates[from]/usdRates[c];
          return`<tr>
            <td style="color:var(--dim);padding:3px 0">${FLAGS[c]||''} ${c}</td>
            <td style="text-align:right;color:#ccc;font-variant-numeric:tabular-nums">${fp(r2,4)}</td>
            <td style="text-align:right;color:#3a3a3a;padding-left:16px">1 ${c} = ${fp(1/r2,4)} ${from}</td>
          </tr>`;
        }).join('');
      }
      body.querySelector(`#${cvid}-amt`).addEventListener('input', convert);
      fromSel.addEventListener('change', convert);
      toSel.addEventListener('change', convert);
      convert();
    }catch(e){body.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  async function render(){
    const body=el.querySelector(`#${bodyId}`);
    if(!body) return;
    ws.rv = (ws.rv||0) + 1;
    const rv = ws.rv;
    el.querySelectorAll('.fx-tab').forEach(t=>t.classList.toggle('active',t.dataset.t===ws.tab));
    if(ws.tab==='matrix') await renderMatrix(body, rv);
    else await renderPairs(body, rv);
  }

  el.innerHTML=tabBar()+`<div id="${bodyId}" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>`;
  wireTabBar();
  await render();
}

