import { API, ld } from '../../core/utils.js';

export async function doCf(el,tk){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`SEC filings: ${tk}`);
  try{
    const r=await fetch(`${API}/cf/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error}</div>`;return;}
    const rows=r.filings.map(f=>{const ft=(f.form||'').replace(/[\s\/\-]/g,'');const cls=ft==='10K'?'f10K':ft==='10Q'?'f10Q':ft==='8K'?'f8K':'foth';return`<div class="fr"><span class="fbdg ${cls}">${f.form||'—'}</span><span style="color:var(--dim)">${f.period||'—'}</span><span>${f.filed||'—'}</span><span style="color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.company||'—'}</span></div>`;}).join('');
    el.innerHTML=`<div style="padding:5px 10px;border-bottom:1px solid var(--bdr);font-size:9px;color:var(--dim);flex-shrink:0">EDGAR · <b style="color:var(--green)">${tk}</b> · <a href="${r.edgarUrl}" target="_blank" style="color:var(--cyan);text-decoration:none">Open EDGAR ↗</a></div><div style="display:grid;grid-template-columns:60px 90px 95px 1fr;gap:8px;padding:3px 10px;font-size:8px;color:var(--muted);letter-spacing:.1em;border-bottom:1px solid var(--bdr);flex-shrink:0"><span>FORM</span><span>PERIOD</span><span>FILED</span><span>COMPANY</span></div><div style="flex:1;overflow-y:auto">${rows||'<div class="empty">No filings found</div>'}</div>`;
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

