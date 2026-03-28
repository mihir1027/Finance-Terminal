// ══════════════════════════════════════════════
//  SHARED UTILITIES — imported by all panels
// ══════════════════════════════════════════════

export const API = 'http://localhost:5001/api';

// canvas-id → Chart.js instance registry
export const charts: Record<string, any> = {};

export function fp(n,d?){if(n==null)return'—';const x=parseFloat(n);if(isNaN(x))return'—';const dec=d!=null?d:(x>=1000?0:x>=10?2:x>=1?3:4);return x.toLocaleString('en-US',{minimumFractionDigits:dec,maximumFractionDigits:dec});}
export function fl(n){if(n==null)return'—';const x=parseFloat(n);if(isNaN(x))return'—';if(x>=1e12)return`$${(x/1e12).toFixed(2)}T`;if(x>=1e9)return`$${(x/1e9).toFixed(2)}B`;if(x>=1e6)return`$${(x/1e6).toFixed(2)}M`;return`$${x.toFixed(0)}`;}
export function fv(n){if(n==null)return'—';const x=parseInt(n);if(isNaN(x))return'—';if(x>=1e9)return`${(x/1e9).toFixed(1)}B`;if(x>=1e6)return`${(x/1e6).toFixed(1)}M`;if(x>=1e3)return`${(x/1e3).toFixed(1)}K`;return String(x);}
export function cd(v){const t=(window as any)._sentThresh||0.05;return v>t?'up':v<-t?'down':'flat';}
export function pill(pct){if(pct==null)return`<span style="color:var(--dim)">—</span>`;const d=cd(pct),s=pct>=0?'+':'',a=pct>0.05?'▲':pct<-0.05?'▼':'●';return`<span class="pill ${d}">${a} ${s}${pct.toFixed(2)}%</span>`;}
export function ld(m='Loading…'){return`<div class="load"><div class="sp"></div><span>${m}</span></div>`;}
export function dc(id){if(charts[id]){try{charts[id].destroy();}catch(e){}delete charts[id];}}
