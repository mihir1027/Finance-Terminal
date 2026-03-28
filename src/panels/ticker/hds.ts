import { API, fp, ld } from '../../core/utils.js';

export async function doHds(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Holders: ${tk}`);
  try{
    const r=await fetch(`${API}/hds/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    function mkT(rows){if(!rows.length)return'<div class="empty">No data</div>';const nk=Object.keys(rows[0]).find(k=>k.toLowerCase().includes('holder'))||Object.keys(rows[0])[0];const ks=Object.keys(rows[0]).filter(k=>k!==nk);const h=`<tr><th>INSTITUTION</th>${ks.map(k=>`<th>${k.toUpperCase()}</th>`).join('')}</tr>`;const b=rows.map(row=>{const cs=ks.map(k=>{const v=row[k];if(v==null)return'<td>—</td>';if(typeof v==='number')return`<td>${v>=1e9?(v/1e9).toFixed(2)+'B':v>=1e6?(v/1e6).toFixed(2)+'M':v.toLocaleString()}</td>`;return`<td>${v}</td>`;}).join('');return`<tr><td>${row[nk]||'—'}</td>${cs}</tr>`;}).join('');return`<table class="hdst"><thead>${h}</thead><tbody>${b}</tbody></table>`;}
    let at=0;el.innerHTML=`<div class="fa-tabs"><button class="fat-btn active" onclick="window._hdt(0)">INSTITUTIONAL</button><button class="fat-btn" onclick="window._hdt(1)">MUTUAL FUNDS</button></div><div class="fa-body" id="hdbody">${mkT(r.institutional)}</div>`;
    window._hdt=(i)=>{at=i;document.getElementById('hdbody').innerHTML=mkT(i===0?r.institutional:r.mutualFund);document.querySelectorAll('.fat-btn').forEach((b,j)=>b.classList.toggle('active',j===i));};
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

