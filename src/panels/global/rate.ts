import { API, fp, cd, pill, ld } from '../../core/utils.js';

export async function doRate(el){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld('Fetching rates…');

  const fv=v=>v!=null?v.toFixed(2)+'%':'—';
  const chg=(arr)=>{
    if(!arr||arr.length<2)return'';
    const d=arr[arr.length-1].value-arr[arr.length-2].value;
    if(Math.abs(d)<0.0001)return`<span style="color:#444">unch</span>`;
    return`<span style="color:${d>0?'#f87171':'#4ade80'}">${d>0?'▲':'▼'}${Math.abs(d).toFixed(2)}</span>`;
  };
  const lat=(arr)=>arr?.length?arr[arr.length-1]:null;

  function row(label, arr, src){
    const l=lat(arr);
    return`<div style="display:grid;grid-template-columns:1fr 72px 52px 90px;align-items:center;padding:5px 14px;border-bottom:1px solid #0f0f0f">
      <span style="font-size:11px;color:#aaa">${label}</span>
      <span style="font-size:13px;color:#e0e0e0;font-weight:600;text-align:right">${fv(l?.value)}</span>
      <span style="font-size:10px;text-align:right;padding:0 6px">${chg(arr)}</span>
      <span style="font-size:8px;color:#333;text-align:right;letter-spacing:.04em">${src}  ${l?.date||''}</span>
    </div>`;
  }

  function section(title){
    return`<div style="padding:6px 14px 4px;font-size:9px;color:#555;letter-spacing:.18em;background:#060606;border-bottom:1px solid #1a1a1a;border-top:1px solid #141414;margin-top:4px">${title}</div>`;
  }

  try{
    const r=await fetch(`${API}/rate`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error||'FRED unavailable'}</div>`;return;}

    const sofr30=lat(r.sofr30),sofr90=lat(r.sofr90),sofr180=lat(r.sofr180);
    // compute sofr term spread inline
    const termSpr=(sofr180&&sofr30)?sofr180.value-sofr30.value:null;
    const hyIg=(lat(r.hyOas)&&lat(r.igOas))?lat(r.hyOas).value-lat(r.igOas).value:null;

    el.innerHTML=`
      <div style="padding:5px 14px;border-bottom:1px solid var(--bdr);font-size:8px;color:#333;letter-spacing:.06em;flex-shrink:0">FRED · STLOUISFED.ORG  ·  ${new Date().toUTCString().slice(0,16).toUpperCase()}</div>
      <div style="flex:1;overflow-y:auto">
        ${section('SOFR')}
        ${row('SOFR (Overnight)',      r.sofr,    'SOFR')}
        ${row('SOFR 30-Day Avg',       r.sofr30,  'SOFR30DAYAVG')}
        ${row('SOFR 90-Day Avg',       r.sofr90,  'SOFR90DAYAVG')}
        ${row('SOFR 180-Day Avg',      r.sofr180, 'SOFR180DAYAVG')}
        ${section('POLICY & SHORT-TERM')}
        ${row('Fed Funds (Daily)',      r.dff,     'DFF')}
        ${row('3-Month T-Bill',         r.dtb3,    'DTB3')}
        ${row('Prime Rate',             r.prime,   'PRIME')}
        ${section('US TREASURY YIELDS')}
        ${row('1-Month',  r.dgs1mo, 'DGS1MO')}
        ${row('3-Month',  r.dgs3mo, 'DGS3MO')}
        ${row('6-Month',  r.dgs6mo, 'DGS6MO')}
        ${row('1-Year',   r.dgs1,   'DGS1')}
        ${row('2-Year',   r.dgs2,   'DGS2')}
        ${row('3-Year',   r.dgs3,   'DGS3')}
        ${row('5-Year',   r.dgs5,   'DGS5')}
        ${row('7-Year',   r.dgs7,   'DGS7')}
        ${row('10-Year',  r.dgs10,  'DGS10')}
        ${row('20-Year',  r.dgs20,  'DGS20')}
        ${row('30-Year',  r.dgs30,  'DGS30')}
        ${section('REAL YIELDS  (TIPS)')}
        ${row('5-Year Real',   r.dfii5,  'DFII5')}
        ${row('7-Year Real',   r.dfii7,  'DFII7')}
        ${row('10-Year Real',  r.dfii10, 'DFII10')}
        ${row('20-Year Real',  r.dfii20, 'DFII20')}
        ${row('30-Year Real',  r.dfii30, 'DFII30')}
        ${section('CURVE SPREADS')}
        ${row('10Y − 2Y',  r.t10y2y, 'T10Y2Y')}
        ${row('10Y − 3M',  r.t10y3m, 'T10Y3M')}
        ${row('SOFR 180D − 30D', termSpr!=null?[{date:sofr30.date,value:termSpr},{date:sofr180.date,value:termSpr}]:[], 'COMPUTED')}
        ${section('CREDIT SPREADS  (ICE BofA OAS)')}
        ${row('AAA OAS',      r.aaOas,  'BAMLC0A1CAAA')}
        ${row('IG OAS',       r.igOas,  'BAMLC0A0CM')}
        ${row('BBB OAS',      r.bbbOas, 'BAMLC0A4CBBB')}
        ${row('HY OAS',       r.hyOas,  'BAMLH0A0HYM2')}
        ${row('HY − IG Spread', hyIg!=null?[{date:lat(r.hyOas).date,value:hyIg},{date:lat(r.igOas).date,value:hyIg}]:[], 'COMPUTED')}
      </div>`;
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}
