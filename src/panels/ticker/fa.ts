import { API, fp, fl, ld } from '../../core/utils.js';

export async function doFa(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Financials: ${tk}`);
  try{
    const r=await fetch(`${API}/fa/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    let at=0;const tabs=[['INCOME',r.income,r.incomeCols],['BALANCE SHEET',r.balance,r.balanceCols],['CASH FLOW',r.cashflow,r.cfCols]];
    function mkT(rows,cols){if(!rows.length)return'<div class="empty">No data</div>';const h=`<tr><th>LINE ITEM</th>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>`;const b=rows.map(row=>{const cs=cols.map(c=>{const v=row[c];if(v==null)return'<td>—</td>';const fmtd=Math.abs(v)>=1e9?`${(v/1e9).toFixed(2)}B`:Math.abs(v)>=1e6?`${(v/1e6).toFixed(1)}M`:v.toFixed(0);return`<td class="${v>0?'up':v<0?'down':''}">${fmtd}</td>`;}).join('');return`<tr><td title="${row.label}">${row.label}</td>${cs}</tr>`;}).join('');return`<table class="fat"><thead>${h}</thead><tbody>${b}</tbody></table>`;}
    el.innerHTML=`<div class="fa-tabs" id="fatabs">${tabs.map(([n],i)=>`<button class="fat-btn${i===0?' active':''}" onclick="window._fat(${i})">${n}</button>`).join('')}</div><div class="fa-body" id="fabody">${mkT(...tabs[0].slice(1))}</div>`;
    window._fat=(i)=>{at=i;document.getElementById('fabody').innerHTML=mkT(...tabs[i].slice(1));document.querySelectorAll('.fat-btn').forEach((b,j)=>b.classList.toggle('active',j===i));};
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

// ── G ──
// ── TRADINGVIEW SYMBOL MAPPER ──────────────────────────────────────────
