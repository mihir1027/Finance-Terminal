import { API, fp, fl, fv, cd, pill, ld } from '../../core/utils.js';

export async function doQ(el,tk){
  el.innerHTML=`<div class="pbody">${ld(`Quote: ${tk}`)}</div>`;
  try{
    const r=await fetch(`${API}/quote/${tk}`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="pbody"><div class="err">${r.error}</div></div>`;return;}
    const d=cd(r.changePct),s=r.change>=0?'+':'',dec=r.price>1000?0:2;
    const col=d==='up'?'var(--green)':d==='down'?'var(--red)':'var(--dim)';
    el.innerHTML=`<div class="pbody">
      <div style="text-align:center;padding:14px 10px 8px">
        <div style="font-size:10px;color:var(--dim);letter-spacing:.18em">${r.ticker} · ${r.exchange}</div>
        <div style="font-size:11px;color:var(--text);margin:2px 0">${r.name}</div>
        <div style="font-size:36px;font-weight:800;color:${col}">${fp(r.price,dec)}</div>
        <div style="font-size:13px;font-weight:600;color:${col}">${s}${fp(r.change,dec)} (${s}${fp(r.changePct,2)}%)</div>
        <div style="font-size:8px;color:var(--dim);margin-top:3px">~10-15min delay</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--bdr)">
        ${[['OPEN',fp(r.open,dec)],['HIGH',fp(r.high,dec)],['LOW',fp(r.low,dec)],['PREV',fp(r.prev,dec)],['BID',fp(r.bid,dec)],['ASK',fp(r.ask,dec)],['VOLUME',fv(r.volume)],['AVG VOL',fv(r.avgVolume)],['MKT CAP',fl(r.marketCap)]]
          .map(([k,v])=>`<div style="background:var(--bg1);padding:5px 10px"><div style="font-size:7px;color:var(--dim);letter-spacing:.1em">${k}</div><div style="font-size:12px;font-weight:600;margin-top:1px">${v}</div></div>`).join('')}
      </div>
    </div>`;
  }catch(e){el.innerHTML=`<div class="pbody"><div class="err">Backend offline. Run app.py<br>${e}</div></div>`;}
}

