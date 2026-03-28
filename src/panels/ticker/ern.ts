import { API, fp, ld } from '../../core/utils.js';

export async function doErn(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Earnings: ${tk}`);
  try{
    const r=await fetch(`${API}/ern/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    // Header: next earnings date
    let hdr='';
    if(r.next_date){
      const ms=new Date(r.next_date)-new Date();
      const daysUntil=Math.round(ms/86400000);
      const wen=(r.when||'').toLowerCase();
      const whenLabel=wen.includes('before')||wen.includes('open')?'BMO':wen.includes('after')||wen.includes('close')?'AMC':'TBD';
      const wc=whenLabel==='BMO'?'var(--cyan)':whenLabel==='AMC'?'var(--amber)':'var(--dim)';
      const dLabel=daysUntil>0?`in ${daysUntil}d`:daysUntil===0?'TODAY':`${Math.abs(daysUntil)}d ago`;
      hdr=`<div style="display:flex;align-items:center;gap:12px;padding:7px 12px;border-bottom:1px solid var(--bdr);flex-shrink:0;background:var(--bg1)">
        <span style="font-size:9px;color:var(--dim);letter-spacing:.12em">NEXT EARNINGS</span>
        <span style="font-size:13px;color:var(--fg);font-weight:600">${r.next_date}</span>
        <span style="font-size:9px;color:${wc};border:1px solid ${wc};padding:1px 5px">${whenLabel}</span>
        <span style="margin-left:auto;font-size:10px;color:var(--amber)">${dLabel}</span>
      </div>`;
    }else{
      hdr=`<div style="padding:7px 12px;border-bottom:1px solid var(--bdr);flex-shrink:0;font-size:10px;color:var(--dim)">No upcoming earnings date on record</div>`;
    }
    // EPS history
    function feps(v){const n=parseFloat(v);if(isNaN(n))return'—';return(n>=0?'':'')+n.toFixed(2);}
    function surp(rep,est){
      const rv=parseFloat(rep),ev=parseFloat(est);
      if(isNaN(rv)||isNaN(ev))return{$:'—',pct:'—',cls:''};
      const d=rv-ev,p=ev!==0?(d/Math.abs(ev))*100:0;
      return{$:(d>=0?'+':'')+d.toFixed(2),pct:(p>=0?'+':'')+p.toFixed(1)+'%',cls:d>=0?'up':'down'};
    }
    let hRows='';
    if(r.eps_history&&r.eps_history.length){
      hRows=r.eps_history.map(h=>{
        const s=surp(h.reported,h.estimate);
        const repCls=parseFloat(h.reported)>=parseFloat(h.estimate)?'up':'down';
        return`<tr><td style="color:var(--dim)">${h.period_end_date}</td><td>${feps(h.estimate)}</td><td class="${repCls}">${feps(h.reported)}</td><td class="${s.cls}">${s.$}</td><td class="${s.cls}">${s.pct}</td></tr>`;
      }).join('');
    }
    const histTable=`<div style="flex-shrink:0;border-bottom:1px solid var(--bdr)">
      <div style="font-size:9px;letter-spacing:.12em;color:var(--dim);padding:5px 10px;border-bottom:1px solid var(--bdr)">EPS HISTORY</div>
      ${hRows?`<div style="overflow-x:auto"><table class="fat"><thead><tr><th>PERIOD END</th><th>ESTIMATE</th><th>REPORTED</th><th>SURPRISE $</th><th>SURPRISE %</th></tr></thead><tbody>${hRows}</tbody></table></div>`:'<div class="empty">No EPS history</div>'}
    </div>`;
    // Forward estimate panels
    function mkEst(title,rows,unit){
      if(!rows||!rows.length)return`<div style="flex:1;display:flex;flex-direction:column"><div style="font-size:9px;letter-spacing:.12em;color:var(--dim);padding:5px 10px;border-bottom:1px solid var(--bdr)">${title}</div><div class="empty">No estimates</div></div>`;
      const tr=rows.map(e=>`<tr><td style="color:var(--dim)">${e.period||e.period_end_date}</td><td style="color:var(--green)">${feps(e.consensus)}</td><td class="up">${feps(e.high)}</td><td class="down">${feps(e.low)}</td><td style="color:var(--dim)">${e.count||'—'}</td><td style="color:var(--dim)">${feps(e.year_ago)}</td></tr>`).join('');
      return`<div style="flex:1;overflow:auto;display:flex;flex-direction:column"><div style="font-size:9px;letter-spacing:.12em;color:var(--dim);padding:5px 10px;border-bottom:1px solid var(--bdr)">${title}${unit?` <span style="font-weight:normal">(${unit})</span>`:''}</div><table class="fat"><thead><tr><th>PERIOD</th><th>CONSENSUS</th><th>HIGH</th><th>LOW</th><th>#</th><th>YR AGO</th></tr></thead><tbody>${tr}</tbody></table></div>`;
    }
    const estimates=`<div style="flex:1;display:flex;gap:1px;background:var(--bdr);min-height:0;overflow:hidden">${mkEst('EPS ESTIMATES',r.eps_estimates,'')}${mkEst('REVENUE ESTIMATES',r.sales_estimates,'$M')}</div>`;
    el.innerHTML=hdr+histTable+estimates;
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

