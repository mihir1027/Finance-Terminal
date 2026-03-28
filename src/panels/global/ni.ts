import { API, ld } from '../../core/utils.js';

export async function doBio(el, query){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%;box-sizing:border-box';
  if(!query){
    el.innerHTML=`<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:11px;color:#444;letter-spacing:.08em">TYPE: BIO &lt;NAME&gt;</div>`;
    return;
  }
  el.innerHTML=`<div style="flex:1;display:flex;align-items:center;justify-content:center">${ld(`Searching for "${query}"\u2026`)}</div>`;
  try{
    const r=await fetch(`${API}/bio?q=${encodeURIComponent(query)}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div style="padding:16px"><div class="err">${r.error}</div></div>`;return;}

    const img=r.thumbnail
      ?`<img src="${r.thumbnail}" style="width:90px;height:118px;object-fit:cover;border:1px solid #2a2a2a;flex-shrink:0"/>`
      :`<div style="width:90px;height:118px;background:#0d0d0d;border:1px solid #1e1e1e;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:30px;color:#222">\u25CF</div>`;

    const factsHtml=(r.facts&&r.facts.length)
      ?`<div style="display:grid;grid-template-columns:1fr 1fr;gap:9px 18px;margin-top:10px;padding-top:10px;border-top:1px solid #1a1a1a">
          ${r.facts.map(f=>`<div>
            <div style="font-size:9px;color:#555;letter-spacing:.08em;text-transform:uppercase;margin-bottom:3px">${f.label}</div>
            ${f.values.slice(0,4).map(v=>`<div style="font-size:11px;color:#c0c0c0;line-height:1.5">${v}</div>`).join('')}
          </div>`).join('')}
        </div>`:'';

    const paras=(r.extract||'').split('\n').filter(p=>p.trim());
    const bioHtml=paras.map(p=>`<p style="margin:0 0 10px 0">${p}</p>`).join('');

    el.innerHTML=`
      <div style="padding:12px 14px;border-bottom:1px solid #1a1a1a;flex-shrink:0">
        <div style="display:flex;gap:14px;align-items:flex-start">
          ${img}
          <div style="flex:1;min-width:0">
            <div style="font-size:16px;font-weight:700;color:#e8e8e8;line-height:1.2;letter-spacing:-.01em">${r.title}</div>
            ${r.description?`<div style="font-size:10px;color:var(--amber);letter-spacing:.08em;text-transform:uppercase;margin-top:5px">${r.description}</div>`:''}
            ${factsHtml}
          </div>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto;padding:12px 14px;font-size:12px;color:#b8b8b8;line-height:1.75">${bioHtml}</div>
      <div style="padding:5px 14px;border-top:1px solid #141414;display:flex;justify-content:space-between;align-items:center;flex-shrink:0">
        <span style="font-size:9px;color:#333;letter-spacing:.06em">SOURCE: WIKIPEDIA</span>
        <a href="${r.url}" target="_blank" style="font-size:9px;color:var(--cyan);text-decoration:none;letter-spacing:.06em">FULL ARTICLE \u2197</a>
      </div>`;
  }catch(e){el.innerHTML=`<div style="padding:16px"><div class="err">Request failed: ${e}</div></div>`;}
}
