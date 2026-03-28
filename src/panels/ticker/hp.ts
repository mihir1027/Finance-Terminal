import { API, fp, fv, ld } from '../../core/utils.js';

export async function doHp(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Historical prices: ${tk}`);
  try{
    const r=await fetch(`${API}/hp/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    const rows=r.rows.slice().reverse().map(row=>{const up=row.close>=row.open;return`<tr><td>${row.date}</td><td>${fp(row.open)}</td><td class="up">${fp(row.high)}</td><td class="down">${fp(row.low)}</td><td class="${up?'up':'down'}">${fp(row.close)}</td><td style="color:var(--dim)">${fv(row.volume)}</td></tr>`;}).join('');
    el.innerHTML=`<div style="flex:1;overflow-y:auto"><table class="hpt"><thead><tr><th>DATE</th><th>OPEN</th><th>HIGH</th><th>LOW</th><th>CLOSE</th><th>VOLUME</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

