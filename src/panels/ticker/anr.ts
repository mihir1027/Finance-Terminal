import { API, fp, ld } from '../../core/utils.js';

export async function doAnr(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Analyst: ${tk}`);
  try{
    const r=await fetch(`${API}/anr/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    const rec=(r.recommendation||'').toUpperCase();
    const pc=rec.includes('BUY')?'buy':rec.includes('HOLD')||rec.includes('NEUTRAL')?'hold':rec.includes('SELL')||rec.includes('UNDER')?'sell':'neutral';
    const uds=r.upgrades.map(u=>{const up=(u.action||'').toLowerCase().includes('up')||(u.toGrade||'').toLowerCase().includes('buy');return`<div class="ud-row"><span style="color:var(--dim)">${u.date}</span><span class="ud-f">${u.firm}</span><span style="color:var(--dim)">${u.fromGrade||'—'}</span><span class="${up?'up':'down'}">→ ${u.toGrade}</span></div>`;}).join('');
    el.innerHTML=`
      <div class="anr-consensus"><span class="anr-pill ${pc}">${rec||'—'}</span><span style="font-size:9px;color:var(--dim)">${r.numAnalysts?r.numAnalysts+' analysts':''}</span></div>
      <div class="anr-tg">${[['TARGET LOW',r.targetLow,'down'],['TARGET MEAN',r.targetMean,''],['TARGET MEDIAN',r.targetMedian,''],['TARGET HIGH',r.targetHigh,'up']].map(([k,v,c])=>`<div class="at"><div class="at-k">${k}</div><div class="at-v ${c}">${fp(v,2)}</div></div>`).join('')}</div>
      <div class="ud-hdr"><span>DATE</span><span>FIRM</span><span>FROM</span><span>TO</span></div>
      <div style="flex:1;overflow-y:auto">${uds||'<div class="empty">No recent ratings</div>'}</div>
    `;
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

