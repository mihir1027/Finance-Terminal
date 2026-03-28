import { API, fp, cd, pill, ld } from '../../core/utils.js';
import { registerFTimer } from '../../core/windowManager.js';

export async function doFocus(el,tk,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  let prevPrice=null;
  async function refresh(){try{
    const r=await fetch(`${API}/focus/${tk}`).then(x=>x.json());if(!r.ok)return;
    const d=cd(r.changePct),s=r.change>=0?'+':'',dec=r.price>1000?0:2;
    el.innerHTML=`<div class="foc-wrap" id="foc-wrap-${wid}"><div class="foc-sym">${r.ticker}</div><div class="foc-right"><div class="foc-price ${d}" id="foc-pr-${wid}">${fp(r.price,dec)}</div><div class="foc-chg ${d}"><span>${s}${fp(r.changePct,2)}%</span><span>${s}${fp(r.change,dec)}</span></div></div></div>`;
    if(prevPrice!==null && prevPrice!==r.price){
      const prEl=document.getElementById(`foc-pr-${wid}`);
      if(prEl){
        const cls=r.price>prevPrice?'flash-up':'flash-dn';
        prEl.classList.add(cls);
        setTimeout(()=>prEl.classList.remove(cls),700);
      }
    }
    prevPrice=r.price;
  }catch(e){}}
  el.innerHTML=ld(`FOCUS: ${tk}`);await refresh();registerFTimer(wid, setInterval(refresh,60000));
}

// ── FX ──
