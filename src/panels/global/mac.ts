import { API, fp, ld, dc, charts } from '../../core/utils.js';
import { tip, initTooltips } from '../../core/tooltip.js';

export async function doMacro(el,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld('Fetching FRED macroeconomic data…');
  let _d=null, tab='overview', _energyData:any=null;
  const _lw={};  // Lightweight Charts instances keyed by container id
  // date filter state — default: 10 years back to today
  const today=new Date().toISOString().slice(0,10);
  function addYears(iso,n){const d=new Date(iso+'T12:00');d.setFullYear(d.getFullYear()+n);return d.toISOString().slice(0,10);}
  let _from=addYears(today,-10), _to=today;

  // ── data helpers ──
  const last  =arr=>arr?.length?arr[arr.length-1]:null;
  const prev  =(arr,n=1)=>arr?.length>n?arr[arr.length-1-n]:null;
  const fPct  =(v,d=2)=>v!=null?v.toFixed(d)+'%':'—';
  const fNum  =(v,d=0,suf='')=>v!=null?v.toLocaleString('en-US',{maximumFractionDigits:d})+suf:'—';
  const delta =arr=>(!arr||arr.length<2)?null:arr[arr.length-1].value-arr[arr.length-2].value;
  const mom   =arr=>{if(!arr||arr.length<2)return null;const c=arr[arr.length-1].value,p=arr[arr.length-2].value;return((c-p)/Math.abs(p))*100;};
  const yoy   =arr=>{if(!arr||arr.length<13)return null;const c=arr[arr.length-1].value,a=arr[arr.length-13].value;return((c-a)/Math.abs(a))*100;};
  const buildYoy=arr=>arr.slice(13).map((r,i)=>({date:r.date,value:((r.value-arr[i].value)/Math.abs(arr[i].value))*100}));
  const byDate =arr=>(arr||[]).filter(r=>r.date>=_from&&r.date<=_to);
  const chgPill=(v,inv=false)=>{
    if(v==null)return'<span style="color:#444">—</span>';
    const pos=inv?v<0:v>0;
    return`<span style="color:${pos?'#4ade80':'#f87171'}">${v>0?'▲':'▼'} ${v>0?'+':''}${v.toFixed(2)}</span>`;
  };
  const kpi=(label,val,sub,src,date)=>`
    <div class="mac-kpi">
      <div class="mk-l">${label}</div>
      <div class="mk-v">${val}</div>
      <div class="mk-d">${sub}</div>
      <div class="mac-src">FRED · ${src} · ${date}</div>
    </div>`;

  // ── Lightweight Charts helpers ──
  function lwKillAll(){
    Object.keys(_lw).forEach(id=>{try{_lw[id].remove();}catch(e){}delete _lw[id];});
  }
  function lwBase(el){
    return{
      width:el.clientWidth||400, height:el.clientHeight||200,
      layout:{background:{type:'solid',color:'#020202'},textColor:'#888',fontSize:10,fontFamily:"'JetBrains Mono',monospace"},
      grid:{vertLines:{color:'#0e0e0e'},horzLines:{color:'#111111'}},
      timeScale:{borderColor:'#1e1e1e',timeVisible:false,fixLeftEdge:true,fixRightEdge:true},
      rightPriceScale:{borderColor:'#1e1e1e',scaleMargins:{top:0.12,bottom:0.12}},
      crosshair:{vertLine:{color:'#2a2a2a',labelBackgroundColor:'#111'},horzLine:{color:'#2a2a2a',labelBackgroundColor:'#111'}},
      handleScroll:false,handleScale:false,
    };
  }
  function pctFmt(d=2){return{type:'custom',formatter:p=>(+p).toFixed(d)+'%'};}
  function numFmt(suf='',d=0){return{type:'custom',formatter:p=>(+p).toFixed(d)+suf};}

  function mkArea(id,data,color,fmt){
    const el=document.getElementById(id); if(!el||!data?.length)return;
    requestAnimationFrame(()=>setTimeout(()=>{
      const chart=LightweightCharts.createChart(el,lwBase(el));
      const s=chart.addAreaSeries({lineColor:color,topColor:color+'28',bottomColor:color+'04',lineWidth:2,lastValueVisible:true,priceLineVisible:false,...(fmt?{priceFormat:fmt}:{})});
      s.setData(data.map(r=>({time:r.date,value:+r.value})));
      chart.timeScale().fitContent();
      _lw[id]=chart;
      new ResizeObserver(()=>chart.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el);
    },0));
  }

  function mkHistogram(id,data,fmt){
    const el=document.getElementById(id); if(!el||!data?.length)return;
    requestAnimationFrame(()=>setTimeout(()=>{
      const chart=LightweightCharts.createChart(el,lwBase(el));
      const s=chart.addHistogramSeries({priceLineVisible:false,lastValueVisible:true,...(fmt?{priceFormat:fmt}:{})});
      s.setData(data.map(r=>({time:r.date,value:+r.value,color:+r.value>=0?'rgba(74,222,128,0.75)':'rgba(248,113,113,0.75)'})));
      chart.timeScale().fitContent();
      _lw[id]=chart;
      new ResizeObserver(()=>chart.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el);
    },0));
  }

  function mkLines(id,seriesList,fmt){
    const el=document.getElementById(id); if(!el||!seriesList?.length)return;
    requestAnimationFrame(()=>setTimeout(()=>{
      const chart=LightweightCharts.createChart(el,lwBase(el));
      seriesList.forEach(s=>{
        const ls=chart.addLineSeries({color:s.color,lineWidth:s.w||2,lineStyle:s.dash?2:0,lastValueVisible:true,priceLineVisible:false,...(fmt?{priceFormat:fmt}:{})});
        ls.setData((s.data||[]).map(r=>({time:r.date,value:+r.value})));
      });
      chart.timeScale().fitContent();
      _lw[id]=chart;
      new ResizeObserver(()=>chart.applyOptions({width:el.clientWidth,height:el.clientHeight})).observe(el);
    },0));
  }

  // ── layout helpers ──
  const cTitle=(t)=>`<div style="font-size:11px;color:#bbb;letter-spacing:.1em;padding:5px 6px 7px;flex-shrink:0;text-transform:uppercase;border-bottom:1px solid #222;margin-bottom:4px;font-weight:600">${t}</div>`;
  const cBox  =id=>`<div style="flex:1;position:relative;min-height:0"><div id="${id}" style="position:absolute;inset:0"></div></div>`;
  const cWrap =(id,title)=>`<div style="display:flex;flex-direction:column;flex:1;min-width:0;min-height:0">${cTitle(title)}${cBox(id)}</div>`;
  const lgnd  =items=>`<div style="display:flex;gap:16px;padding:0 4px 5px;flex-shrink:0">${items.map(([l,c])=>`<span style="font-size:10px;color:${c};letter-spacing:.06em">${l}</span>`).join('')}</div>`;

  // ── tab renderers ──
  function renderOverview(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    const gdpR=last(_d.gdpReal),unrL=last(_d.unrate),ffL=last(_d.fedFunds),cpiYoy=yoy(_d.cpi);
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('REAL GDP GROWTH',gdpR?fPct(gdpR.value):'—',chgPill(delta(_d.gdpReal))+' vs prior qtr','A191RL1Q225SBEA',gdpR?.date||'—')}
        ${kpi('UNEMPLOYMENT',unrL?fPct(unrL.value):'—',chgPill(mom(_d.unrate),true)+' MoM','UNRATE',unrL?.date||'—')}
        ${kpi('CPI YoY',cpiYoy!=null?fPct(cpiYoy):'—','Headline inflation','CPIAUCSL',last(_d.cpi)?.date||'—')}
        ${kpi('FED FUNDS',ffL?fPct(ffL.value):'—',chgPill(delta(_d.fedFunds))+' MoM','FEDFUNDS',ffL?.date||'—')}
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;padding:0 10px 10px;min-height:0">
        ${cWrap('mac-ov-gdp-'+wid,'REAL GDP GROWTH  ·  QoQ ANNUALIZED  (A191RL1Q225SBEA)')}
        ${cWrap('mac-ov-unr-'+wid,'UNEMPLOYMENT RATE  (UNRATE)')}
        ${cWrap('mac-ov-cpi-'+wid,'CPI  ·  YoY %  (CPIAUCSL)')}
        ${cWrap('mac-ov-ff-'+wid,'FED FUNDS RATE  (FEDFUNDS)')}
      </div>`;
    mkHistogram('mac-ov-gdp-'+wid,byDate(_d.gdpReal),pctFmt(1));
    mkArea('mac-ov-unr-'+wid,byDate(_d.unrate),'#fbbf24',pctFmt(1));
    mkArea('mac-ov-cpi-'+wid,byDate(buildYoy(_d.cpi||[])),'#38bdf8',pctFmt(1));
    mkArea('mac-ov-ff-'+wid,byDate(_d.fedFunds),'#a78bfa',pctFmt(2));
  }

  function renderGrowth(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    const gdpR=last(_d.gdpReal),gdpN=last(_d.gdpNom),pceL=last(_d.pce);
    const payL=last(_d.payems),payP=prev(_d.payems);
    const payChg=payL&&payP?payL.value-payP.value:null;
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('REAL GDP GROWTH',fPct(gdpR?.value),chgPill(delta(_d.gdpReal))+' vs prior qtr','A191RL1Q225SBEA',gdpR?.date||'—')}
        ${kpi('NOMINAL GDP',gdpN?'$'+(gdpN.value/1000).toFixed(2)+'T':'—','Quarterly SAAR','GDP',gdpN?.date||'—')}
        ${kpi('REAL PCE',pceL?'$'+(pceL.value/1000).toFixed(2)+'T':'—','Personal consumption','PCEC96',pceL?.date||'—')}
        ${kpi('NFP MoM',payChg!=null?(payChg>0?'+':'')+fNum(payChg,0,'K'):'—','Nonfarm payrolls chg','PAYEMS',payL?.date||'—')}
      </div>
      <div style="flex:1;display:flex;gap:10px;padding:0 10px 10px;min-height:0">
        ${cWrap('mac-gr-gdp-'+wid,'REAL GDP GROWTH  ·  QoQ ANNUALIZED  (A191RL1Q225SBEA)')}
        ${cWrap('mac-gr-pay-'+wid,'NONFARM PAYROLLS  ·  MoM CHANGE  THOUSANDS  (PAYEMS)')}
      </div>`;
    mkHistogram('mac-gr-gdp-'+wid,byDate(_d.gdpReal),pctFmt(1));
    const pays=_d.payems||[];
    const payDiff=pays.slice(1).map((r,i)=>({date:r.date,value:r.value-pays[i].value}));
    mkHistogram('mac-gr-pay-'+wid,byDate(payDiff),numFmt('K',0));
  }

  function renderLabor(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    const unrL=last(_d.unrate),civL=last(_d.civpart),icsaL=last(_d.icsa),joltsL=last(_d.jolts);
    const icsaChg=icsaL&&prev(_d.icsa)?icsaL.value-prev(_d.icsa).value:null;
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('UNEMPLOYMENT RATE',fPct(unrL?.value),chgPill(mom(_d.unrate),true)+' MoM','UNRATE',unrL?.date||'—')}
        ${kpi('PARTICIPATION RATE',fPct(civL?.value),chgPill(mom(_d.civpart))+' MoM','CIVPART',civL?.date||'—')}
        ${kpi('INIT. CLAIMS (WK)',icsaL?fNum(icsaL.value,0,'K'):'—',chgPill(icsaChg,true)+' WoW','ICSA',icsaL?.date||'—')}
        ${kpi('JOB OPENINGS (JOLTS)',joltsL?(joltsL.value/1000).toFixed(2)+'M':'—','JOLTS monthly survey','JTSJOL',joltsL?.date||'—')}
      </div>
      <div style="flex:1;display:flex;gap:10px;padding:0 10px 10px;min-height:0">
        <div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle('UNEMPLOYMENT + PARTICIPATION RATE  (UNRATE / CIVPART)')}
          ${lgnd([['── UNRATE','#fbbf24'],['── CIVPART','#38bdf8']])}
          ${cBox('mac-lb-unr-'+wid)}
        </div>
        ${cWrap('mac-lb-icsa-'+wid,'INITIAL JOBLESS CLAIMS  ·  WEEKLY  (ICSA)')}
      </div>`;
    mkLines('mac-lb-unr-'+wid,[{data:byDate(_d.unrate),color:'#fbbf24',w:2},{data:byDate(_d.civpart),color:'#38bdf8',w:1.5,dash:true}],pctFmt(1));
    mkArea('mac-lb-icsa-'+wid,byDate((_d.icsa||[]).map(r=>({date:r.date,value:r.value/1000}))),'#a78bfa',numFmt('K',0));
  }

  function renderInflation(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    const cpiYS=buildYoy(_d.cpi||[]),coreYS=buildYoy(_d.coreCpi||[]);
    const pceYS=buildYoy(_d.pce||[]),corePYS=buildYoy(_d.corePce||[]),ppiYS=buildYoy(_d.ppi||[]);
    const cpiN=last(cpiYS),coreN=last(coreYS),pceN=last(pceYS),corePceN=last(corePYS),ppiN=last(ppiYS);
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('CPI YoY',fPct(cpiN?.value),'Core: '+fPct(coreN?.value),'CPIAUCSL',cpiN?.date||'—')}
        ${kpi('PCE YoY',fPct(pceN?.value),'Core PCE: '+fPct(corePceN?.value),'PCEPI',pceN?.date||'—')}
        ${kpi('PPI YoY',fPct(ppiN?.value),'All commodities','PPIACO',ppiN?.date||'—')}
        ${kpi('CORE PCE',fPct(corePceN?.value),'<span style="color:#555">Fed target: 2.0%</span>','PCEPILFE',corePceN?.date||'—')}
      </div>
      <div style="flex:1;display:flex;gap:10px;padding:0 10px 10px;min-height:0">
        <div style="flex:1.5;display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle('CPI / CORE CPI / PCE / CORE PCE  ·  YoY %')}
          ${lgnd([['── CPI','#f87171'],['── Core CPI','#fbbf24'],['── PCE','#4ade80'],['── Core PCE','#38bdf8']])}
          ${cBox('mac-inf-cpi-'+wid)}
        </div>
        ${cWrap('mac-inf-ppi-'+wid,'PPI YoY %  ·  ALL COMMODITIES  (PPIACO)')}
      </div>`;
    mkLines('mac-inf-cpi-'+wid,[
      {data:byDate(cpiYS),color:'#f87171',w:2},
      {data:byDate(coreYS),color:'#fbbf24',w:1.5,dash:true},
      {data:byDate(pceYS),color:'#4ade80',w:1.5},
      {data:byDate(corePYS),color:'#38bdf8',w:1.5,dash:true},
    ],pctFmt(1));
    mkArea('mac-inf-ppi-'+wid,byDate(ppiYS),'#a78bfa',pctFmt(1));
  }

  function renderRates(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    const ffL=last(_d.fedFunds),tipsL=last(_d.tips10),primeL=last(_d.prime);
    const spread=ffL&&tipsL?ffL.value-tipsL.value:null;
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('FED FUNDS RATE',fPct(ffL?.value),chgPill(delta(_d.fedFunds))+' MoM','FEDFUNDS',ffL?.date||'—')}
        ${kpi('10Y REAL YIELD',fPct(tipsL?.value),'TIPS-implied real rate','DFII10',tipsL?.date||'—')}
        ${kpi('PRIME RATE',fPct(primeL?.value),'Spread vs FF: '+fPct(primeL&&ffL?primeL.value-ffL.value:null),'PRIME',primeL?.date||'—')}
        ${kpi('FF − TIPS SPREAD',fPct(spread),'Nominal − real rate gap','DFF/DFII10',ffL?.date||'—')}
      </div>
      <div style="flex:1;display:flex;gap:10px;padding:0 10px 10px;min-height:0">
        <div style="flex:1.5;display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle('FED FUNDS (DFF) + 10Y REAL YIELD (DFII10)  ·  DAILY')}
          ${lgnd([['── DFF (Nominal)','#a78bfa'],['── DFII10 (Real)','#38bdf8']])}
          ${cBox('mac-rt-ff-'+wid)}
        </div>
        ${cWrap('mac-rt-spr-'+wid,'FF − TIPS SPREAD  ·  REAL RATE GAP  (DAILY)')}
      </div>`;
    const ffD=byDate(_d.dff),tipsD=byDate(_d.tips10);
    mkLines('mac-rt-ff-'+wid,[{data:ffD,color:'#a78bfa',w:2},{data:tipsD,color:'#38bdf8',w:1.5}],pctFmt(2));
    // build spread only over dates where both series have data
    const tipsMap=Object.fromEntries((tipsD).map(r=>[r.date,r.value]));
    const sprS=ffD.filter(r=>tipsMap[r.date]!=null).map(r=>({date:r.date,value:r.value-tipsMap[r.date]}));
    mkArea('mac-rt-spr-'+wid,sprS,'#fbbf24',pctFmt(2));
  }

  async function renderEnergy(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    if(!_energyData){
      b.innerHTML=ld('Loading energy market data…');
      try{
        const r=await fetch(`${API}/energy`).then(x=>x.json());
        if(!r.ok){b.innerHTML=`<div class="err">${r.error||'Energy data unavailable'}</div>`;return;}
        _energyData=r;
      }catch(e){b.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;return;}
    }
    const d=_energyData;
    const p=d.prices||{},c=d.crude||{},g=d.gasStorage||{};
    const wti=p.wti||{},brent=p.brent||{},hh=p.henryHub||{};
    const pChg=(v:number|null)=>v==null?'<span style="color:#444">—</span>':`<span style="color:${v>=0?'#4ade80':'#f87171'}">${v>=0?'▲':'▼'} ${v>=0?'+':''}${v.toFixed(2)}%</span>`;
    const sColor=(v:number|null)=>v==null?'#888':v>=0?'#f87171':'#4ade80';
    const surpLine=(v:number|null,suf:string)=>v==null?'—':`<span style="color:${sColor(v)}">${v>=0?'SURPLUS +':'DEFICIT '}${Math.abs(Math.round(v as number)).toLocaleString()} ${suf}</span>`;
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('WTI CRUDE',wti.value!=null?'$'+wti.value.toFixed(2):'—',pChg(wti.changePct)+' DaD','NYMEX CL1',wti.asOf||'—')}
        ${kpi('BRENT CRUDE',brent.value!=null?'$'+brent.value.toFixed(2):'—',pChg(brent.changePct)+' DaD','ICE BZ1',brent.asOf||'—')}
        ${kpi('HENRY HUB',hh.value!=null?'$'+hh.value.toFixed(3)+'/MMBtu':'—',pChg(hh.changePct)+' DaD','NYMEX NG1',hh.asOf||'—')}
        ${kpi(tip('3-2-1 CRACK','Refinery gross margin: estimated profit from converting 3 barrels of crude into 2 barrels of gasoline and 1 barrel of distillate. Formula: (2×RBOB + 1×Distillate − 3×WTI) ÷ 3. Higher = stronger refining demand for crude.'),p.crack321!=null?'$'+p.crack321.toFixed(2)+'/bbl':'—','Refining margin','EIA v2',wti.asOf||'—')}
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;gap:10px;padding:0 10px 10px;min-height:0">
        <div style="display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle(`${tip('CRUDE OIL STOCKS','Total US commercial crude oil inventory, excluding the Strategic Petroleum Reserve. Reported weekly by EIA.')} · 52-WEEK · Mbbl  <span style="color:${sColor(c.surplusPct)};font-size:9px;font-weight:400">${surpLine(c.surplus,'Mbbl')}</span>`)}
          ${lgnd([['── Current','#fbbf24'],['── 5-Yr Avg','#444']])}
          ${cBox('mac-en-crude-'+wid)}
        </div>
        <div style="display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle(`${tip('NAT GAS STORAGE','Total US natural gas in underground storage, Lower 48 states. Reported weekly by EIA.')} · 52-WEEK · BCF  <span style="color:${sColor(g.surplusPct)};font-size:9px;font-weight:400">${surpLine(g.surplus,'BCF')}</span>`)}
          ${lgnd([['── Current','#60a5fa'],['── 5-Yr Avg','#444']])}
          ${cBox('mac-en-gas-'+wid)}
        </div>
        ${cWrap('mac-en-wti-'+wid,'WTI CRUDE OIL  ·  1Y DAILY  ·  USD/BBL')}
        ${cWrap('mac-en-hh-'+wid,'HENRY HUB NATURAL GAS  ·  1Y DAILY  ·  USD/MMBtu')}
      </div>`;
    // Kill any stale energy charts
    ['mac-en-crude-','mac-en-gas-','mac-en-wti-','mac-en-hh-'].forEach(pre=>{
      const id=pre+wid;if(_lw[id]){try{_lw[id].remove();}catch{}delete _lw[id];}
    });
    const ch=c.history||[],gh=g.history||[];
    mkLines('mac-en-crude-'+wid,[
      {data:ch.map((r:any)=>({date:r.period,value:r.value})),color:'#fbbf24',w:2},
      {data:ch.filter((r:any)=>r.avg5yr!=null).map((r:any)=>({date:r.period,value:r.avg5yr})),color:'#444444',w:1,dash:true},
    ],numFmt('M',1));
    mkLines('mac-en-gas-'+wid,[
      {data:gh.map((r:any)=>({date:r.period,value:r.value})),color:'#60a5fa',w:2},
      {data:gh.filter((r:any)=>r.avg5yr!=null).map((r:any)=>({date:r.period,value:r.avg5yr})),color:'#444444',w:1,dash:true},
    ],numFmt('',0));
    mkArea('mac-en-wti-'+wid,(wti.history||[]).map((r:any)=>({date:r.period,value:r.value})),'#fbbf24',numFmt('',2));
    mkArea('mac-en-hh-'+wid,(hh.history||[]).map((r:any)=>({date:r.period,value:r.value})),'#60a5fa',numFmt('',3));
    initTooltips(b);
  }

  function buildShell(){
    const tabs=[{k:'overview',l:'OVERVIEW'},{k:'growth',l:'GROWTH'},{k:'labor',l:'LABOR'},{k:'inflation',l:'INFLATION'},{k:'rates',l:'RATES'},{k:'credit',l:'CREDIT'},{k:'energy',l:'ENERGY'}];
    const inpSty=`background:#0a0a0a;border:1px solid #252525;color:#ccc;font-family:var(--font);font-size:10px;padding:2px 6px;border-radius:2px;outline:none;width:100px;`;
    el.innerHTML=`
      <div style="display:flex;gap:3px;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center;flex-wrap:wrap;row-gap:4px">
        ${tabs.map(t=>`<span class="mac-tab${t.k===tab?' active':''}" data-k="${t.k}">${t.l}</span>`).join('')}
        <span style="margin-left:auto;display:flex;align-items:center;gap:6px">
          <span style="font-size:9px;color:#444;letter-spacing:.06em">FROM</span>
          <input id="mac-from-${wid}" type="date" value="${_from}" style="${inpSty}">
          <span style="font-size:9px;color:#444;letter-spacing:.06em">TO</span>
          <input id="mac-to-${wid}" type="date" value="${_to}" style="${inpSty}">
          <span id="mac-reset-${wid}" style="font-size:9px;color:#444;letter-spacing:.08em;cursor:pointer;padding:2px 6px;border:1px solid #1e1e1e;border-radius:2px" onmouseover="this.style.color='#ccc'" onmouseout="this.style.color='#444'">RESET</span>
          <span style="font-size:8px;color:#222;letter-spacing:.06em">FRED</span>
        </span>
      </div>
      <div id="mac-body-${wid}" style="flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0"></div>`;
    el.querySelectorAll('.mac-tab').forEach(t=>t.addEventListener('click',()=>{
      lwKillAll();
      tab=t.dataset.k;
      el.querySelectorAll('.mac-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      render();
    }));
    function applyDates(){
      const f=document.getElementById('mac-from-'+wid),t2=document.getElementById('mac-to-'+wid);
      if(!f||!t2)return;
      _from=f.value||_from; _to=t2.value||_to;
      lwKillAll(); render();
    }
    document.getElementById('mac-from-'+wid).addEventListener('change',applyDates);
    document.getElementById('mac-to-'+wid).addEventListener('change',applyDates);
    document.getElementById('mac-reset-'+wid).addEventListener('click',()=>{
      _from=addYears(today,-10); _to=today;
      document.getElementById('mac-from-'+wid).value=_from;
      document.getElementById('mac-to-'+wid).value=_to;
      lwKillAll(); render();
    });
  }

  function renderCredit(){
    const b=document.getElementById('mac-body-'+wid);if(!b)return;
    const igL=last(_d.igOas),hyL=last(_d.hyOas),bbbL=last(_d.bbbOas),aaL=last(_d.aaOas);
    const t10y2yL=last(_d.t10y2y),t10y3mL=last(_d.t10y3m);
    const hyIgSpr=hyL&&igL?hyL.value-igL.value:null;
    b.innerHTML=`
      <div style="display:flex;gap:6px;padding:10px;flex-shrink:0;flex-wrap:wrap">
        ${kpi('IG OAS',igL?fPct(igL.value):'—',chgPill(delta(_d.igOas),true)+' vs prior','BAMLC0A0CM',igL?.date||'—')}
        ${kpi('HY OAS',hyL?fPct(hyL.value):'—',chgPill(delta(_d.hyOas),true)+' vs prior','BAMLH0A0HYM2',hyL?.date||'—')}
        ${kpi('HY − IG SPREAD',hyIgSpr!=null?fPct(hyIgSpr):'—','Excess risk premium','BAMLH0A0HYM2 − C0A0CM',hyL?.date||'—')}
        ${kpi('10Y − 2Y SPREAD',t10y2yL?fPct(t10y2yL.value):'—','Yield curve slope','T10Y2Y',t10y2yL?.date||'—')}
      </div>
      <div style="flex:1;display:flex;gap:10px;padding:0 10px 10px;min-height:0">
        <div style="flex:1.5;display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle('CORPORATE CREDIT SPREADS  ·  OAS  (ICE BofA / FRED)')}
          ${lgnd([['── IG','#4ade80'],['── BBB','#fbbf24'],['── AAA','#38bdf8'],['── HY','#f87171']])}
          ${cBox('mac-cr-oas-'+wid)}
        </div>
        <div style="flex:1;display:flex;flex-direction:column;min-width:0;min-height:0">
          ${cTitle('TREASURY YIELD CURVE  ·  10Y − 2Y / 10Y − 3M')}
          ${lgnd([['── 10Y−2Y','#a78bfa'],['── 10Y−3M','#38bdf8']])}
          ${cBox('mac-cr-yc-'+wid)}
        </div>
      </div>`;
    mkLines('mac-cr-oas-'+wid,[
      {data:byDate(_d.igOas),  color:'#4ade80',w:2},
      {data:byDate(_d.bbbOas), color:'#fbbf24',w:1.5},
      {data:byDate(_d.aaOas),  color:'#38bdf8',w:1.5,dash:true},
      {data:byDate(_d.hyOas),  color:'#f87171',w:1.5},
    ],pctFmt(2));
    mkLines('mac-cr-yc-'+wid,[
      {data:byDate(_d.t10y2y),color:'#a78bfa',w:2},
      {data:byDate(_d.t10y3m),color:'#38bdf8',w:1.5,dash:true},
    ],pctFmt(2));
  }

  function render(){
    ({overview:renderOverview,growth:renderGrowth,labor:renderLabor,inflation:renderInflation,rates:renderRates,credit:renderCredit,energy:renderEnergy}[tab]||renderOverview)();
  }

  try{
    const r=await fetch(`${API}/macro`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error||'FRED API unavailable'}</div>`;return;}
    _d=r; buildShell(); render();
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

// ── PRED ──
