import { API, fp, fv, cd, pill, ld } from '../../core/utils.js';

export async function doMost(el){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld('Most active…');
  let allRows=[];
  let sortKey='volume';
  try{
    const r=await fetch(`${API}/most`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    allRows=r.results;
    function renderTable(){
      let rows=[...allRows];
      if(sortKey==='gainers') rows.sort((a,b)=>(b.changePct??-Infinity)-(a.changePct??-Infinity));
      else if(sortKey==='losers') rows.sort((a,b)=>(a.changePct??Infinity)-(b.changePct??Infinity));
      else rows.sort((a,b)=>(b.volume||0)-(a.volume||0));
      const tbody=el.querySelector('#most-tbody');
      if(tbody) tbody.innerHTML=rows.map((s,i)=>`<tr><td style="color:var(--dim)">${i+1}</td><td class="ms" onclick="runCmd('${s.sym} DES')" style="cursor:pointer">${s.sym}</td><td class="mn">${(s.name||'').substring(0,16)}</td><td>${fp(s.price)}</td><td>${pill(s.changePct)}</td><td style="color:var(--dim)">${fv(s.volume)}</td></tr>`).join('');
      el.querySelectorAll('.most-tab').forEach(t=>t.classList.toggle('active',t.dataset.sort===sortKey));
    }
    el.innerHTML=`
      <div style="display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid var(--bdr);flex-shrink:0">
        <span class="most-tab active" data-sort="volume" style="cursor:pointer;padding:2px 8px;font-size:9px;border:1px solid var(--bdr);border-radius:2px;color:var(--dim)">VOLUME</span>
        <span class="most-tab" data-sort="gainers" style="cursor:pointer;padding:2px 8px;font-size:9px;border:1px solid var(--bdr);border-radius:2px;color:var(--dim)">GAINERS</span>
        <span class="most-tab" data-sort="losers" style="cursor:pointer;padding:2px 8px;font-size:9px;border:1px solid var(--bdr);border-radius:2px;color:var(--dim)">LOSERS</span>
      </div>
      <div style="flex:1;overflow-y:auto"><table class="mont"><thead><tr><th>#</th><th>SYM</th><th>NAME</th><th>LAST</th><th>CHG%</th><th>VOLUME</th></tr></thead><tbody id="most-tbody"></tbody></table></div>`;
    el.querySelectorAll('.most-tab').forEach(t=>t.addEventListener('click',()=>{sortKey=t.dataset.sort;renderTable();}));
    renderTable();
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}
