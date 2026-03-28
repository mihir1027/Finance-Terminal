import { API, ld } from '../../core/utils.js';

export async function doEcal(el){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  function getMonday(d){const dt=new Date(d);const day=dt.getDay();const diff=dt.getDate()-day+(day===0?-6:1);return new Date(dt.setDate(diff));}
  function toISO(d){return d.toISOString().slice(0,10);}
  function fmtDate(d){return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
  function normWhen(w){if(!w)return'tbd';const wl=w.toLowerCase();if(wl.includes('before')||wl.includes('pre')||wl.includes('open'))return'bmo';if(wl.includes('after')||wl.includes('post')||wl.includes('close'))return'amc';return'tbd';}
  function fmtMcap(m){if(m==null)return'';return m>=1000000?`$${(m/1000000).toFixed(2)}T`:m>=1000?`$${(m/1000).toFixed(1)}B`:`$${m.toFixed(0)}M`;}

  let monday=getMonday(new Date());
  let mcapData={};
  let filterOp='>=';
  let filterVal=0;
  let byDate={};
  let days=[];
  let loadGen=0;                  // increments on each load() to cancel stale fetches
  let mcapLoading=false;          // true while background mcap fetch is in flight
  const mcapCache={};             // weekStr → mcapData, so nav back is instant

  const DAY_NAMES=['MON','TUE','WED','THU','FRI'];
  const BTNBASE='cursor:pointer;font-family:var(--font);font-size:9px;padding:2px 10px;letter-spacing:.08em;border-radius:2px;outline:none;';
  const BTNDIM=BTNBASE+'background:none;border:1px solid var(--bdr);color:var(--dim);';
  const BTNAMB=BTNBASE+'background:none;border:1px solid var(--amber);color:var(--amber);';

  function passesFilter(sym){
    if(filterVal<=0)return true;
    const mc=mcapData[sym];
    if(mc==null)return true;
    if(filterOp==='>')  return mc> filterVal;
    if(filterOp==='>=') return mc>=filterVal;
    if(filterOp==='<')  return mc< filterVal;
    if(filterOp==='<=') return mc<=filterVal;
    return true;
  }
  function sortedByMcap(syms){
    return [...syms].sort((a,b)=>(mcapData[b]??-1)-(mcapData[a]??-1));
  }
  function chip(sym){
    const mc=mcapData[sym];
    const tip=mc?`${sym} · ${fmtMcap(mc)}`:sym;
    return`<span class="ecal-chip" title="${tip}" onclick="runCmd('${sym} ERN')">${sym}</span>`;
  }
  function sec(label,color,symsRaw){
    const syms=sortedByMcap(symsRaw).filter(passesFilter);
    if(!syms.length)return'';
    return`<div class="ecal-sec" style="color:${color}">${label}</div><div class="ecal-chips">${syms.map(chip).join('')}</div>`;
  }

  function fmtFilterLabel(){
    const v=filterVal>=1000?`$${(filterVal/1000).toFixed(filterVal%1000===0?0:1)}B`:`$${filterVal.toLocaleString()}M`;
    return`${filterOp} ${v}`;
  }
  function setStatus(text,color?){
    const s=el.querySelector('#ecal-status');
    if(!s)return;
    (s as HTMLElement).textContent=text;
    (s as HTMLElement).style.color=color||'var(--dim)';
  }

  function renderGrid(){
    const gridEl=el.querySelector('#ecal-grid');
    if(!gridEl)return;

    // Filter is active but mcap data hasn't arrived yet — show loading overlay
    if(filterVal>0&&mcapLoading){
      gridEl.innerHTML=`<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;background:var(--bg0);">
        <div style="font-size:9px;letter-spacing:.2em;color:var(--amber);">MARKET CAP FILTER PENDING</div>
        <div style="font-size:22px;color:var(--amber);letter-spacing:.05em;">${fmtFilterLabel()}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px;">
          <div style="width:6px;height:6px;border-radius:50%;background:var(--amber);opacity:.9;animation:ecal-pulse 1.2s ease-in-out infinite;"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:var(--amber);opacity:.9;animation:ecal-pulse 1.2s ease-in-out .4s infinite;"></div>
          <div style="width:6px;height:6px;border-radius:50%;background:var(--amber);opacity:.9;animation:ecal-pulse 1.2s ease-in-out .8s infinite;"></div>
        </div>
        <div style="font-size:9px;color:var(--dim);letter-spacing:.1em;margin-top:4px;">Loading market cap data — filter will apply automatically</div>
      </div>`;
      return;
    }

    gridEl.innerHTML=days.map(d=>{
      const b=byDate[toISO(d)];
      return`<div class="ecal-col">${sec('BMO','var(--cyan)',b.bmo)}${sec('AMC','var(--amber)',b.amc)}${sec('TBD','var(--dim)',b.tbd)}</div>`;
    }).join('');
  }

  function buildShell(weekLabel){
    const navBar=`<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 12px;border-bottom:1px solid var(--bdr);flex-shrink:0">
      <button onclick="window._ecalNav(-1)" style="${BTNDIM}">&#9664; PREV</button>
      <span style="font-size:10px;color:var(--text);letter-spacing:.12em">EARNINGS CALENDAR &middot; ${weekLabel}</span>
      <button onclick="window._ecalNav(1)" style="${BTNDIM}">NEXT &#9654;</button>
    </div>`;
    const filterBar=`<div style="display:flex;align-items:center;gap:8px;padding:5px 12px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:#0a0a0a;">
      <span style="font-size:9px;color:var(--dim);letter-spacing:.1em;">MKTCAP</span>
      <select id="ecal-op" style="font-family:var(--font);font-size:9px;background:#111;border:1px solid #2c2c2c;color:#a1a1aa;padding:2px 5px;border-radius:2px;outline:none;">
        <option value=">=">&gt;=</option>
        <option value=">">&gt;</option>
        <option value="<=">&lt;=</option>
        <option value="<">&lt;</option>
      </select>
      <input id="ecal-val" type="number" min="0" placeholder="e.g. 10000" style="font-family:var(--font);font-size:9px;background:#111;border:1px solid #2c2c2c;color:#a1a1aa;padding:2px 7px;width:110px;border-radius:2px;outline:none;">
      <span style="font-size:9px;color:var(--dim);">$M</span>
      <button id="ecal-apply" style="${BTNAMB}">APPLY</button>
      <button id="ecal-clear" style="${BTNDIM}">CLEAR</button>
      <span id="ecal-status" style="font-size:9px;color:var(--dim);margin-left:6px;"></span>
    </div>`;
    const dayHdrs=`<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--bdr);flex-shrink:0">${days.map((d,i)=>`<div style="background:var(--bg1);padding:4px 6px;text-align:center"><div style="font-size:8px;letter-spacing:.12em;color:var(--dim)">${DAY_NAMES[i]}</div><div style="font-size:11px;color:var(--text)">${fmtDate(d)}</div></div>`).join('')}</div>`;
    const grid=`<div id="ecal-grid" style="flex:1;display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:1fr;gap:1px;background:var(--bdr);overflow:hidden;min-height:0"></div>`;
    el.innerHTML=navBar+filterBar+dayHdrs+grid;

    // Restore filter UI state from closure (persists across nav)
    const opSelect=el.querySelector('#ecal-op');
    const valInput=el.querySelector('#ecal-val') as HTMLInputElement;
    const applyBtn=el.querySelector('#ecal-apply');
    const clearBtn=el.querySelector('#ecal-clear');
    if(opSelect)(opSelect as HTMLSelectElement).value=filterOp;
    if(valInput&&filterVal>0)valInput.value=String(filterVal);

    applyBtn?.addEventListener('click',()=>{
      filterOp=(opSelect as HTMLSelectElement).value;
      filterVal=parseFloat(valInput.value)||0;
      if(!mcapLoading&&filterVal>0){
        const n=Object.keys(mcapData).length;
        setStatus(n>0?`filter ${fmtFilterLabel()} · ${n} caps`:`filter ${fmtFilterLabel()} — loading caps...`,'var(--amber)');
      }
      renderGrid();
    });
    clearBtn?.addEventListener('click',()=>{
      filterVal=0;
      if(valInput)valInput.value='';
      renderGrid();
    });
    valInput?.addEventListener('keydown',e=>{
      if(e.key==='Enter')(applyBtn as HTMLElement)?.click();
    });
  }

  async function load(){
    const gen=++loadGen;
    el.innerHTML=ld('Earnings Calendar...');
    const weekStr=toISO(monday);
    try{
      const r=await fetch(`${API}/ecal?week=${weekStr}`).then(x=>x.json());
      if(gen!==loadGen)return;
      if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
      days=[];for(let i=0;i<5;i++){const d=new Date(monday);d.setDate(d.getDate()+i);days.push(d);}
      byDate={};for(const d of days)byDate[toISO(d)]={bmo:[],amc:[],tbd:[]};
      for(const ev of r.events){const b=byDate[ev.date];if(!b)continue;b[normWhen(ev.when)].push(ev.act_symbol);}
      const lastDay=days[4];
      const weekLabel=`${fmtDate(monday)} \u2013 ${fmtDate(lastDay)}, ${lastDay.getFullYear()}`;

      // Restore cached mcaps immediately so filter works right away on nav
      mcapData=mcapCache[weekStr]||{};
      buildShell(weekLabel);
      renderGrid();

      // Only fetch mcaps if not already cached
      if(!mcapCache[weekStr]){
        const allTickers=[...new Set(r.events.map(e=>e.act_symbol))].join(',');
        mcapLoading=true;
        renderGrid(); // show overlay immediately if filter is active
        setStatus(filterVal>0?`filter ${fmtFilterLabel()} — loading caps...`:'loading caps...',
                  filterVal>0?'var(--amber)':undefined);
        fetch(`${API}/ecal/mcap?tickers=${encodeURIComponent(allTickers)}`)
          .then(x=>x.json())
          .then(mc=>{
            if(gen!==loadGen)return;
            mcapLoading=false;
            if(!mc.ok){setStatus('caps unavailable');return;}
            mcapData=mc.mcap;
            mcapCache[weekStr]=mcapData;
            const n=Object.keys(mcapData).length;
            setStatus(filterVal>0?`filter ${fmtFilterLabel()} · ${n} caps`:`${n} caps`,
                      filterVal>0?'var(--green)':undefined);
            renderGrid();
          })
          .catch(()=>{
            if(gen!==loadGen)return;
            mcapLoading=false;
            setStatus('caps failed');
            renderGrid();
          });
      } else {
        mcapLoading=false;
        const n=Object.keys(mcapData).length;
        setStatus(filterVal>0?`filter ${fmtFilterLabel()} · ${n} caps`:`${n} caps`,
                  filterVal>0?'var(--green)':undefined);
      }
    }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  (window as any)._ecalNav=async(dir)=>{monday=new Date(monday);monday.setDate(monday.getDate()+dir*7);await load();};
  await load();
}
