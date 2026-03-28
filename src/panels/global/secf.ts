import { API, fp, cd, ld } from '../../core/utils.js';

const TYPE_COLOR = {stock:'#e0a040',futures:'#22d3ee',forex:'#4ade80',crypto:'#a78bfa',bond:'#fbbf24',index:'#60a5fa'};
const TYPE_LABEL = {stock:'EQ',futures:'FUT',forex:'FX',crypto:'CRY',bond:'BND',index:'IDX'};

const TABS = [
  {k:'all',     l:'ALL'},
  {k:'stock',   l:'EQUITIES'},
  {k:'futures', l:'FUTURES'},
  {k:'forex',   l:'FOREX'},
  {k:'crypto',  l:'CRYPTO'},
  {k:'bond',    l:'BONDS'},
  {k:'index',   l:'INDEX'},
];

const inpSty = 'background:#111;border:1px solid #252525;color:#ddd;font-family:var(--font);font-size:10px;padding:3px 7px;outline:none;border-radius:2px;height:22px;box-sizing:border-box;';
const selSty = inpSty + 'cursor:pointer;';
const btnSty = 'background:#1a1a1a;border:1px solid #333;color:#bbb;font-family:var(--font);font-size:9px;letter-spacing:.08em;padding:3px 9px;cursor:pointer;border-radius:2px;height:22px;white-space:nowrap;';

export async function doSecf(el, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  if(!window._secfWS) window._secfWS={};
  if(!window._secfWS[wid]) window._secfWS[wid]={q:'',type:'all',country:'',sector:'',timer:null,meta:null};
  const ws=window._secfWS[wid];

  const QID=`secf-q-${wid}`, BID=`secf-bd-${wid}`, CID=`secf-ct-${wid}`;
  const FID=`secf-fb-${wid}`;

  function tabHtml(){
    return TABS.map(t=>{
      const on=ws.type===t.k;
      return `<span class="secf-tab" data-t="${t.k}" style="cursor:pointer;padding:2px 10px;font-size:9px;border:1px solid ${on?'var(--orange)':'var(--bdr)'};border-radius:2px;color:${on?'var(--orange)':'var(--dim)'};font-family:var(--font);letter-spacing:.08em;user-select:none;white-space:nowrap">${t.l}</span>`;
    }).join('');
  }

  function filterBarHtml(){
    const show = ws.type==='stock'||ws.type==='all';
    if(!show) return `<div id="${FID}" style="display:none"></div>`;
    const m=ws.meta;
    const cOpts=m?m.countries.map(c=>`<option value="${c}"${ws.country===c?' selected':''}>${c}</option>`).join(''):'';
    const sOpts=m?m.sectors.map(s=>`<option value="${s}"${ws.sector===s?' selected':''}>${s}</option>`).join(''):'';
    return `<div id="${FID}" style="display:flex;gap:5px;align-items:center;padding:4px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;flex-wrap:wrap">
      <span style="font-size:9px;color:#333;letter-spacing:.08em">EQUITY FILTERS</span>
      <select id="secf-co-${wid}" style="${selSty}max-width:130px"><option value="">All Countries</option>${cOpts}</select>
      <select id="secf-sec-${wid}" style="${selSty}max-width:140px"><option value="">All Sectors</option>${sOpts}</select>
      <button id="secf-go-${wid}" style="${btnSty}color:var(--orange);border-color:var(--orange)">FILTER</button>
      <button id="secf-cl-${wid}" style="${btnSty}">CLEAR</button>
    </div>`;
  }

  el.innerHTML=`
    <div style="padding:7px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;display:flex;align-items:center;gap:8px;background:#050505">
      <span style="font-size:9px;color:#444;letter-spacing:.12em">SECF</span>
      <input id="${QID}" type="text" value="${ws.q}" placeholder="Search ticker or name across all markets…"
        style="flex:1;background:#0d0d0d;border:1px solid #252525;color:#e5e5e5;font-family:var(--font);font-size:12px;padding:5px 10px;outline:none;border-radius:2px;">
    </div>
    <div style="display:flex;gap:3px;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center;flex-wrap:wrap">
      ${tabHtml()}
      <span id="${CID}" style="margin-left:auto;font-size:9px;color:#333;letter-spacing:.06em"></span>
    </div>
    ${filterBarHtml()}
    <div id="${BID}" style="flex:1;overflow:hidden;display:flex;flex-direction:column"></div>`;

  function setCount(n){const c=el.querySelector(`#${CID}`);if(c)c.textContent=n?`${n} RESULT${n!==1?'S':''}`:'';;}

  function rebuildFilterBar(){
    const old=el.querySelector(`#${FID}`);
    if(!old) return;
    const tmp=document.createElement('div');
    tmp.innerHTML=filterBarHtml();
    old.replaceWith(tmp.firstElementChild);
    wireFilterBar();
  }

  function wireFilterBar(){
    const goBtn=el.querySelector(`#secf-go-${wid}`);
    const clBtn=el.querySelector(`#secf-cl-${wid}`);
    if(goBtn) goBtn.addEventListener('click',()=>{
      ws.country=(el.querySelector(`#secf-co-${wid}`) as HTMLSelectElement)?.value||'';
      ws.sector=(el.querySelector(`#secf-sec-${wid}`) as HTMLSelectElement)?.value||'';
      fetchAndRender();
    });
    if(clBtn) clBtn.addEventListener('click',()=>{
      ws.country=''; ws.sector='';
      const co=el.querySelector(`#secf-co-${wid}`) as HTMLSelectElement;
      const se=el.querySelector(`#secf-sec-${wid}`) as HTMLSelectElement;
      if(co) co.value='';
      if(se) se.value='';
      fetchAndRender();
    });
  }

  el.querySelectorAll('.secf-tab').forEach(tab=>tab.addEventListener('click',()=>{
    ws.type=(tab as HTMLElement).dataset.t;
    el.querySelectorAll('.secf-tab').forEach((tt:any)=>{
      const on=tt.dataset.t===ws.type;
      tt.style.borderColor=on?'var(--orange)':'var(--bdr)';
      tt.style.color=on?'var(--orange)':'var(--dim)';
    });
    rebuildFilterBar();
    fetchAndRender();
  }));

  const inp=el.querySelector(`#${QID}`) as HTMLInputElement;
  inp.addEventListener('input',()=>{
    ws.q=inp.value.trim();
    clearTimeout(ws.timer);
    ws.timer=setTimeout(fetchAndRender,350);
  });
  inp.addEventListener('keydown',(e:KeyboardEvent)=>{if(e.key==='Enter'){clearTimeout(ws.timer);fetchAndRender();}});
  inp.focus();
  wireFilterBar();

  function fmtCap(v){
    if(!v||v<1e6) return '—';
    if(v>=1e12) return (v/1e12).toFixed(1)+'T';
    if(v>=1e9)  return (v/1e9).toFixed(1)+'B';
    return (v/1e6).toFixed(0)+'M';
  }

  function pct(v){
    if(v==null) return '<span style="color:#2a2a2a">—</span>';
    const s=v>=0?'+':'';
    return `<span class="${cd(v)}">${s}${v.toFixed(2)}%</span>`;
  }

  function renderRows(results){
    const bd=el.querySelector(`#${BID}`);if(!bd)return;
    if(!results.length){
      bd.innerHTML='<div style="padding:32px;text-align:center;color:#2a2a2a;font-size:11px">No results found</div>';
      setCount(0);return;
    }
    setCount(results.length);
    const rows=results.map(r=>{
      const tc=TYPE_COLOR[r.type]||'#888';
      const tl=TYPE_LABEL[r.type]||r.type?.toUpperCase()||'?';
      const dec=r.type==='forex'?4:r.type==='bond'?3:2;
      const price=r.price!=null?`<span style="color:#e5e5e5">${fp(r.price,dec)}</span>`:'<span style="color:#2a2a2a">—</span>';
      const chg=r.change!=null
        ?`<span class="${cd(r.changePct)}">${r.change>=0?'+':''}${r.change.toFixed(dec)}</span>`
        :'<span style="color:#2a2a2a">—</span>';
      const cmd=r.type==='forex'?'FX'
               :r.type==='stock'||r.type==='index'?`${r.sym} DES`
               :`${r.sym} Q`;
      const sectorCell=`<td style="color:#555;font-size:10px;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis">${r.sector||'—'}</td>`;
      const mcapCell=`<td style="font-variant-numeric:tabular-nums;text-align:right;color:#555;font-size:10px">${fmtCap(r.market_cap)}</td>`;
      const bondExtra=r.type==='bond'&&r.maturity
        ?`<td style="color:#555;font-size:10px">${String(r.maturity).slice(0,7)}</td>`
        :`<td></td>`;
      return `<tr style="cursor:pointer" onclick="runCmd('${cmd}')">
        <td style="color:${tc};font-weight:700;white-space:nowrap;letter-spacing:.04em">${r.sym}</td>
        <td style="color:#444;font-size:10px;white-space:nowrap">${r.exchange||'—'}</td>
        <td style="color:#bbb;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name||'—'}</td>
        ${sectorCell}
        <td style="text-align:center;padding:3px 8px"><span style="font-size:8px;padding:1px 5px;border:1px solid ${tc}44;color:${tc};border-radius:2px;letter-spacing:.06em">${tl}</span></td>
        ${mcapCell}
        <td style="font-variant-numeric:tabular-nums;text-align:right">${price}</td>
        <td style="font-variant-numeric:tabular-nums;text-align:right">${chg}</td>
        <td style="font-variant-numeric:tabular-nums;text-align:right">${pct(r.changePct)}</td>
        ${bondExtra}
      </tr>`;
    }).join('');
    bd.innerHTML=`<div style="flex:1;overflow-y:auto"><table class="glco-tbl" style="width:100%">
      <thead><tr>
        <th style="text-align:left">TICKER</th>
        <th style="text-align:left">VENUE</th>
        <th style="text-align:left">NAME</th>
        <th style="text-align:left">SECTOR</th>
        <th style="text-align:center">TYPE</th>
        <th style="text-align:right">MCAP</th>
        <th>LAST</th><th>CHG</th><th>CHG%</th><th>MAT.</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  async function fetchAndRender(){
    const bd=el.querySelector(`#${BID}`);if(!bd)return;
    bd.innerHTML=ld(ws.q?`Searching ${ws.type==='all'?'all markets':ws.type}…`:'Loading top securities…');
    try{
      const p=new URLSearchParams({q:ws.q,type:ws.type,limit:'75'});
      if(ws.country) p.set('country',ws.country);
      if(ws.sector)  p.set('sector', ws.sector);
      const r=await fetch(`${API}/secf?${p}`).then(x=>x.json());
      if(!r.ok){bd.innerHTML=`<div class="err">${r.error}</div>`;return;}
      renderRows(r.results);
    }catch(e){bd.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  // Load metadata for filter dropdowns, then fetch data
  if(!ws.meta){
    try{
      const m=await fetch(`${API}/eqs/meta`).then(x=>x.json());
      if(m.ok){ ws.meta=m; rebuildFilterBar(); }
    }catch(_){}
  }
  fetchAndRender();
}
