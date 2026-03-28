import { API, fp, ld } from '../../core/utils.js';

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

export async function doEm(el,tk,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld(`Earnings Matrix: ${tk}`);
  try{
    const d=await fetch(`${API}/em/${tk}`).then(x=>x.json());
    if(!d.ok){el.innerHTML=`<div class="err">${d.error}</div>`;return;}

    const _lw={};
    function lwKill(){
      Object.keys(_lw).forEach(k=>{try{_lw[k].remove();}catch(e){}delete _lw[k];});
      const t=document.getElementById(`em-tip-${wid}`);if(t)t.remove();
    }

    let metric='eps', growthMode='yoy', chartView='values';

    function qFrom(s){const m=new Date(s+'T00:00:00').getMonth()+1;return m<=3?1:m<=6?2:m<=9?3:4;}
    function yrFrom(s){return parseInt(s.slice(0,4));}
    const QL=['Q1 Mar','Q2 Jun','Q3 Sep','Q4 Dec'];

    function buildCells(){
      const c={eps:{},rev:{}};
      for(const h of d.eps_hist){
        const yr=yrFrom(h.date),q=qFrom(h.date);
        if(!c.eps[yr])c.eps[yr]={};
        c.eps[yr][q]={val:parseFloat(h.reported),type:'hist',sec:h.sec,prior:parseFloat(h.estimate),date:h.date};
      }
      for(const e of d.eps_est){
        if(!e.period_end_date)continue;
        const yr=yrFrom(e.period_end_date),q=qFrom(e.period_end_date),p=(e.period||'').toLowerCase();
        if(!c.eps[yr])c.eps[yr]={};
        if(p.includes('quarter')&&!c.eps[yr][q])c.eps[yr][q]={val:parseFloat(e.consensus),type:'est',high:e.high,low:e.low,count:e.count};
        if(p.includes('year')&&!c.eps[yr][0])c.eps[yr][0]={val:parseFloat(e.consensus),type:'est',high:e.high,low:e.low,count:e.count};
      }
      for(const yr of Object.keys(c.eps)){
        if(c.eps[yr][0])continue;
        let sum=0,cnt=0,allH=true;
        for(let q=1;q<=4;q++){const x=c.eps[yr][q];if(x&&x.val!=null&&!isNaN(x.val)){sum+=x.val;cnt++;if(x.type!=='hist')allH=false;}}
        if(cnt===4)c.eps[yr][0]={val:sum,type:allH?'hist':'est'};
      }
      for(const h of (d.rev_hist||[])){
        const yr=yrFrom(h.date),q=qFrom(h.date);
        if(!c.rev[yr])c.rev[yr]={};
        c.rev[yr][q]={val:parseFloat(h.sales),type:'hist',sec:h.sec,date:h.date};
      }
      for(const h of (d.rev_ann||[])){
        const yr=yrFrom(h.date);
        if(!c.rev[yr])c.rev[yr]={};
        c.rev[yr][0]={val:parseFloat(h.sales),type:'hist'};
      }
      for(const e of d.rev_est){
        if(!e.period_end_date)continue;
        const yr=yrFrom(e.period_end_date),q=qFrom(e.period_end_date),p=(e.period||'').toLowerCase();
        if(!c.rev[yr])c.rev[yr]={};
        if(p.includes('quarter')&&!c.rev[yr][q])c.rev[yr][q]={val:parseFloat(e.consensus),type:'est',high:e.high,low:e.low,count:e.count};
        if(p.includes('year')&&!c.rev[yr][0])c.rev[yr][0]={val:parseFloat(e.consensus),type:'est',high:e.high,low:e.low,count:e.count};
      }
      return c;
    }
    const cells=buildCells();

    // Latest confirmed historical quarter (for "white" styling)
    const latestEpsDate=d.eps_hist.length?d.eps_hist[d.eps_hist.length-1].date:null;
    const latestRevDate=(d.rev_hist||[]).length?d.rev_hist[d.rev_hist.length-1].date:null;

    const ALL_YRS=[...new Set([
      ...d.eps_hist.map(h=>yrFrom(h.date)),
      ...(d.rev_hist||[]).map(h=>yrFrom(h.date)),
      ...d.eps_est.filter(e=>e.period_end_date).map(e=>yrFrom(e.period_end_date)),
      ...d.rev_est.filter(e=>e.period_end_date).map(e=>yrFrom(e.period_end_date)),
    ])].sort((a,b)=>a-b);
    let startIdx=Math.max(0,ALL_YRS.length-6);
    function visYrs(){return ALL_YRS.slice(startIdx,startIdx+6);}

    function fE(v){if(v==null||isNaN(v))return'—';return parseFloat(v).toFixed(2);}
    function fR(v){if(v==null||isNaN(v))return'—';const b=v/1e9;return b>=100?b.toFixed(0)+'B':b>=10?b.toFixed(1)+'B':b>=1?b.toFixed(2)+'B':(v/1e6).toFixed(0)+'M';}
    function fM(v){return(v!=null&&!isNaN(v)&&isFinite(v))?parseFloat(v).toFixed(1)+'x':'—';}
    function fP(v){if(v==null||isNaN(v)||!isFinite(v))return'—';return(v>=0?'+':'')+v.toFixed(1)+'%';}

    // amber=old hist, white=latest hist, green=estimate, red=negative
    function vClr(cell,isLatest){
      if(!cell||cell.val==null||isNaN(cell.val))return'#3f3f46';
      if(cell.type==='hist') return cell.val<0?'#f87171':isLatest?'#e5e7eb':'#fbbf24';
      return cell.val<0?'rgba(248,113,113,.7)':'#4ade80';
    }
    function gClr(gv,isEst){
      if(gv==null)return'#3f3f46';
      const base=gv>=0?'#4ade80':'#f87171';
      return isEst?base+'bb':base;
    }
    function mkMat(isGrowth){
      const isE=metric==='eps';
      const cd=cells[metric];
      const yrs=visYrs();
      const fmt=isE?fE:fR;
      const latestDate=isE?latestEpsDate:latestRevDate;
      const latestYr=latestDate?yrFrom(latestDate):null;
      const latestQ=latestDate?qFrom(latestDate):null;

      const CELL='padding:7px 14px;text-align:right;border-bottom:1px solid #111;font-size:12px;cursor:default;';
      const HDR='padding:7px 14px;text-align:right;border-bottom:1px solid #222;font-size:12px;color:#a1a1aa;font-weight:500;letter-spacing:.02em;';
      const ROW_LBL='padding:7px 10px;white-space:nowrap;border-bottom:1px solid #111;font-size:11px;color:#a1a1aa;';
      const ANN_LBL='padding:8px 10px;font-size:11px;color:#e5e7eb;font-weight:600;border-top:1px solid #222;';
      const ANN_CELL='padding:8px 14px;text-align:right;font-size:12px;font-weight:600;border-top:1px solid #222;cursor:default;';

      let h=`<table style="width:100%;border-collapse:collapse;table-layout:fixed"><thead><tr>`;
      h+=`<th style="${HDR}text-align:left;width:72px"></th>`;
      for(const yr of yrs)h+=`<th style="${HDR}">${yr}</th>`;
      h+=`</tr></thead><tbody>`;

      for(let q=1;q<=4;q++){
        h+=`<tr><td style="${ROW_LBL}">${QL[q-1]}</td>`;
        for(const yr of yrs){
          const cell=(cd[yr]||{})[q];
          const isLatest=yr===latestYr&&q===latestQ;
          const tipKey=`${yr}_${q}`;
          // Always look up both EPS and Rev cells independently of current metric
          {
            const ec=(cells.eps[yr]||{})[q];
            const rc=(cells.rev[yr]||{})[q];
            if(ec||rc){
              window[`_emTips_${wid}`][tipKey]={
                lbl:`${QL[q-1]} ${yr}`,
                epsType:ec?.type,
                epsR:ec?.type==='hist'?ec.val:null,
                epsE:ec?.prior??null,
                epsCon:ec?.type==='est'?ec.val:null,
                epsH:ec?.high,epsL:ec?.low,epsCnt:ec?.count,
                revType:rc?.type,
                revR:rc?.type==='hist'?rc.val:null,
                revCon:rc?.type==='est'?rc.val:null,
                revH:rc?.high,revL:rc?.low,revCnt:rc?.count,
              };
            }
          }
          if(!isGrowth){
            const clr=vClr(cell,isLatest);
            const fw=isLatest?'600':'400';
            const v=cell&&cell.val!=null&&!isNaN(cell.val)?fmt(cell.val):'—';
            const hover=cell?`onmouseenter="window._emTipSh_${wid}(event,'${tipKey}')" onmouseleave="window._emTipHi_${wid}()"`:'' ;
            h+=`<td ${hover} style="${CELL}color:${clr};font-weight:${fw}">${v}</td>`;
          } else {
            const cv=cell?.val;
            let gv=null;
            if(growthMode==='yoy'){const pv=(cd[yr-1]||{})[q]?.val;if(cv!=null&&pv!=null&&pv!==0)gv=(cv-pv)/Math.abs(pv)*100;}
            else{const pq=q>1?(cd[yr]||{})[q-1]:(cd[yr-1]||{})[4];if(cv!=null&&pq?.val!=null&&pq.val!==0)gv=(cv-pq.val)/Math.abs(pq.val)*100;}
            const hover=cell?`onmouseenter="window._emTipSh_${wid}(event,'${tipKey}')" onmouseleave="window._emTipHi_${wid}()"`:'' ;
            h+=`<td ${hover} style="${CELL}color:${gClr(gv,cell?.type==='est')}">${fP(gv)}</td>`;
          }
        }
        h+=`</tr>`;
      }

      // Annual row
      h+=`<tr><td style="${ANN_LBL}">Annual</td>`;
      for(const yr of yrs){
        const cell=(cd[yr]||{})[0];
        if(!isGrowth){
          const clr=vClr(cell,false);
          // Small EST tag for estimate annual cells
          const tag=cell?.type==='est'?`<span style="font-size:7px;color:#4ade80;opacity:.7;margin-right:3px;letter-spacing:.06em">EST</span>`:'';
          h+=`<td style="${ANN_CELL}color:${clr}">${tag}${cell&&cell.val!=null?fmt(cell.val):'—'}</td>`;
        } else {
          const cv=cell?.val,pv=(cd[yr-1]||{})[0]?.val;
          const gv=cv!=null&&pv!=null&&pv!==0?(cv-pv)/Math.abs(pv)*100:null;
          h+=`<td style="${ANN_CELL}color:${gClr(gv,cell?.type==='est')}">${fP(gv)}</td>`;
        }
      }
      h+=`</tr></tbody></table>`;
      return h;
    }

    function render(){
      lwKill();
      window[`_emTips_${wid}`]={};
      const isE=metric==='eps';
      const cd=cells[metric];
      const canP=startIdx>0,canN=startIdx+6<ALL_YRS.length;

      function navBtn(dir,ok,lbl){
        return`<button onclick="window._emN_${wid}(${dir})" ${ok?'':'disabled'} style="background:none;border:1px solid ${ok?'#27272a':'#111'};color:${ok?'#71717a':'#1e1e1e'};font-family:var(--font);font-size:9px;padding:4px 12px;cursor:${ok?'pointer':'default'};letter-spacing:.05em;border-radius:2px">${lbl}</button>`;
      }
      function metBtn(key,lbl){
        const a=metric===key;
        return`<button onclick="window._emM_${wid}('${key}')" style="background:${a?'rgba(251,191,36,.08)':'none'};border:1px solid ${a?'#fbbf24':'#27272a'};color:${a?'#fbbf24':'#71717a'};font-family:var(--font);font-size:9px;padding:4px 12px;cursor:pointer;letter-spacing:.05em;border-radius:2px">${lbl}</button>`;
      }
      function grwBtn(key,lbl){
        const a=growthMode===key;
        return`<button onclick="window._emG_${wid}('${key}')" style="background:${a?'rgba(74,222,128,.1)':'none'};border:1px solid ${a?'#4ade80':'#27272a'};color:${a?'#4ade80':'#71717a'};font-family:var(--font);font-size:9px;padding:4px 12px;cursor:pointer;letter-spacing:.05em;border-radius:2px">${lbl}</button>`;
      }
      function chrBtn(key,lbl){
        const a=chartView===key;
        return`<button onclick="window._emC_${wid}('${key}')" style="background:${a?'rgba(74,222,128,.1)':'none'};border:1px solid ${a?'#4ade80':'#27272a'};color:${a?'#4ade80':'#71717a'};font-family:var(--font);font-size:9px;padding:4px 12px;cursor:pointer;letter-spacing:.05em;border-radius:2px">${lbl}</button>`;
      }

      // Valuation
      const V=d.valuation||{};
      const fy1=V.fy1_year||new Date().getFullYear(),fy2=(V.fy2_year||fy1+1);
      const VH='padding:6px 10px;font-size:9px;color:#52525b;text-align:right;border-bottom:1px solid #111;';
      const VL='padding:6px 10px;font-size:10px;color:#52525b;border-bottom:1px solid #111;';
      const VC_H='padding:6px 10px;font-size:11px;text-align:right;border-bottom:1px solid #111;color:#fbbf24;';
      const VC_D='padding:6px 10px;font-size:11px;text-align:right;border-bottom:1px solid #111;color:#71717a;';
      const vRows=[
        ['P/E',V.pe?.ltm,V.pe?.ntm,V.pe?.fy1,V.pe?.fy2],
        ['P/S',V.ps?.ltm,V.ps?.ntm,V.ps?.fy1,V.ps?.fy2],
        ['P/B',V.pb?.ltm,null,null,null],
        ['P/CF',null,null,null,null]
      ].map(([l,a,b,c,e])=>`<tr>
        <td style="${VL}">${l}</td>
        <td style="${VC_H}">${fM(a)}</td>
        <td style="${VC_D}">${fM(b)}</td>
        <td style="${VC_D}">${fM(c)}</td>
        <td style="${VC_D}">${fM(e)}</td>
      </tr>`).join('');

      // Chart data
      const yrlyData=[],qData=[];
      for(const yr of ALL_YRS){const c=(cd[yr]||{})[0];if(c&&c.val!=null&&!isNaN(c.val))yrlyData.push({time:`${yr}-12-31`,value:isE?c.val:c.val/1e9});}
      const histSrc=isE?d.eps_hist:(d.rev_hist||[]);
      const estSrc=(isE?d.eps_est:d.rev_est).filter(e=>e.period_end_date&&(e.period||'').toLowerCase().includes('quarter'));
      const histDates=new Set(histSrc.map(h=>h.date));
      for(const h of histSrc)qData.push({time:h.date,value:isE?parseFloat(h.reported):parseFloat(h.sales)/1e9,est:false});
      for(const e of estSrc)if(!histDates.has(e.period_end_date))qData.push({time:e.period_end_date,value:isE?parseFloat(e.consensus):parseFloat(e.consensus)/1e9,est:true});
      qData.sort((a,b)=>a.time<b.time?-1:1);

      el.innerHTML=`
        <div style="display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid #1a1a1a;flex-shrink:0;background:#050505">
          <span style="font-size:9px;color:#71717a;letter-spacing:.06em;margin-right:4px">METRIC</span>
          ${metBtn('eps','EPS')}${metBtn('rev','REVENUE')}
          <div style="flex:1"></div>
          ${grwBtn('yoy','YoY % Growth')}${grwBtn('pop','PoP % Growth')}
        </div>
        <div style="font-size:9px;color:#71717a;padding:3px 12px;border-bottom:1px solid #111;flex-shrink:0;background:#050505">
          All values in ${isE?'USD ($)':'USD ($B)'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;background:#111;gap:1px;flex-shrink:0">
          <div style="background:#050505">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #111">
              ${navBtn(-1,canP,'← Previous')}
              <span style="font-size:9px;color:#71717a;letter-spacing:.06em">${isE?'EPS ($)':'REVENUE'} · VALUES</span>
              ${navBtn(1,canN,'Next →')}
            </div>
            ${mkMat(false)}
          </div>
          <div style="background:#050505">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-bottom:1px solid #111">
              ${navBtn(-1,canP,'← Previous')}
              <span style="font-size:9px;color:#71717a;letter-spacing:.06em">${growthMode==='yoy'?'YoY':'PoP'} % GROWTH</span>
              ${navBtn(1,canN,'Next →')}
            </div>
            ${mkMat(true)}
          </div>
        </div>
        <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;background:#111;gap:1px;min-height:0;overflow:hidden">
          <div style="background:#050505;display:flex;flex-direction:column;overflow:hidden">
            <div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid #111;flex-shrink:0">
              ${chrBtn('values','Values Chart')}${chrBtn('growth','Growth Chart')}
            </div>
            <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden">
              <div style="font-size:9px;color:#71717a;padding:3px 10px;flex-shrink:0;letter-spacing:.08em">Yearly</div>
              <div style="flex:1;position:relative;min-height:0"><div id="em-yl-${wid}" style="position:absolute;inset:0"></div></div>
              <div style="font-size:9px;color:#71717a;padding:3px 10px;flex-shrink:0;letter-spacing:.08em;border-top:1px solid #111">Quarterly</div>
              <div style="flex:1;position:relative;min-height:0"><div id="em-qt-${wid}" style="position:absolute;inset:0"></div></div>
            </div>
          </div>
          <div style="background:#050505;display:flex;flex-direction:column;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:flex-end;gap:16px;padding:5px 12px;border-bottom:1px solid #111;flex-shrink:0">
              <span style="font-size:9px;color:#71717a;display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:9px;height:9px;background:#fbbf24"></span>Historical</span>
              <span style="font-size:9px;color:#71717a;display:flex;align-items:center;gap:5px"><span style="display:inline-block;width:9px;height:9px;background:#4ade80"></span>Estimates</span>
            </div>
            <div style="overflow-y:auto;flex:1">
              <table style="width:100%;border-collapse:collapse">
                <thead><tr>
                  <th style="${VH}text-align:left"></th>
                  <th style="${VH}">Last 4Q</th>
                  <th style="${VH}">Next 4Q</th>
                  <th style="${VH}">FY ${fy1}</th>
                  <th style="${VH}">FY ${fy2}</th>
                </tr></thead>
                <tbody>${vRows}</tbody>
              </table>
              ${V.price?`<div style="padding:8px 12px;font-size:9px;color:#52525b;border-top:1px solid #111;margin-top:2px">Price <span style="color:#e5e7eb;font-size:12px;font-weight:500">$${parseFloat(V.price).toFixed(2)}</span></div>`:''}
            </div>
          </div>
        </div>`;

      // Tooltip
      {
        const tip=document.createElement('div');
        tip.id=`em-tip-${wid}`;
        tip.style.cssText='position:fixed;display:none;z-index:10000;background:#0a0a0a;border:1px solid #27272a;padding:10px 12px;font-family:var(--font);pointer-events:none;min-width:160px;box-shadow:0 8px 24px rgba(0,0,0,.8)';
        document.body.appendChild(tip);
      }
      window[`_emTipSh_${wid}`]=(e,key)=>{
        const tip=document.getElementById(`em-tip-${wid}`);
        if(!tip)return;
        const t=(window[`_emTips_${wid}`]||{})[key];
        if(!t){tip.style.display='none';return;}
        const isEpsView=metric==='eps'; // reads current metric — updated on every render
        let html=`<div style="font-size:8px;color:#52525b;letter-spacing:.1em;margin-bottom:8px">${t.lbl.toUpperCase()}</div>`;

        // Helper: render a hist row (reported + estimate + beat/miss)
        function histEps(){
          if(t.epsR==null)return'';
          let s=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:3px">
            <span style="font-size:9px;color:#52525b">EPS</span>
            <span style="font-size:12px;color:#fbbf24;font-weight:600">${parseFloat(t.epsR).toFixed(2)}</span></div>`;
          if(t.epsE!=null&&!isNaN(t.epsE)){
            const surp=t.epsR-t.epsE,sc=surp>=0?'#4ade80':'#f87171';
            s+=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:2px">
              <span style="font-size:9px;color:#3f3f46"> est</span>
              <span style="font-size:10px;color:#52525b">${parseFloat(t.epsE).toFixed(2)}</span></div>`;
            s+=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:2px">
              <span style="font-size:9px;color:#3f3f46"> Δ</span>
              <span style="font-size:10px;color:${sc};font-weight:600">${surp>=0?'+':''}${surp.toFixed(2)} ${surp>=0?'beat':'miss'}</span></div>`;
          }
          return s;
        }
        function histRev(){
          if(t.revR==null||isNaN(t.revR))return'';
          const b=t.revR/1e9,rf=b>=100?b.toFixed(0)+'B':b>=10?b.toFixed(1)+'B':b.toFixed(2)+'B';
          return`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px">
            <span style="font-size:9px;color:#52525b">Revenue</span>
            <span style="font-size:12px;color:#fbbf24;font-weight:600">$${rf}</span></div>`;
        }
        function estEps(){
          if(t.epsCon==null)return'';
          let s=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:3px">
            <span style="font-size:9px;color:#52525b">EPS est</span>
            <span style="font-size:12px;color:#4ade80;font-weight:600">${parseFloat(t.epsCon).toFixed(2)}</span></div>`;
          if(t.epsH!=null||t.epsL!=null){
            const hi=t.epsH!=null?parseFloat(t.epsH).toFixed(2):'—',lo=t.epsL!=null?parseFloat(t.epsL).toFixed(2):'—';
            s+=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:2px">
              <span style="font-size:9px;color:#3f3f46"> range</span>
              <span style="font-size:9px;color:#52525b">${lo} – ${hi}</span></div>`;
          }
          if(t.epsCnt!=null)s+=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:2px">
            <span style="font-size:9px;color:#3f3f46"> analysts</span>
            <span style="font-size:9px;color:#52525b">${t.epsCnt}</span></div>`;
          return s;
        }
        function estRev(){
          if(t.revCon==null||isNaN(t.revCon))return'';
          const b=t.revCon/1e9,rf=b>=100?b.toFixed(0)+'B':b>=10?b.toFixed(1)+'B':b.toFixed(2)+'B';
          let s=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:3px">
            <span style="font-size:9px;color:#52525b">Rev est</span>
            <span style="font-size:12px;color:#4ade80;font-weight:600">$${rf}</span></div>`;
          if(t.revH!=null||t.revL!=null){
            const hi2=t.revH!=null?fR(parseFloat(t.revH)):'—',lo2=t.revL!=null?fR(parseFloat(t.revL)):'—';
            s+=`<div style="display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:2px">
              <span style="font-size:9px;color:#3f3f46"> range</span>
              <span style="font-size:9px;color:#52525b">${lo2} – ${hi2}</span></div>`;
          }
          return s;
        }
        const div='<div style="border-top:1px solid #1a1a1a;margin:7px 0 5px"></div>';

        if(isEpsView){
          // EPS metric view: primary=EPS, secondary=Revenue
          const epsIsHist=t.epsType==='hist';
          html+=epsIsHist?histEps():estEps();
          const revPart=t.revType==='hist'?histRev():estRev();
          if(revPart)html+=div+revPart;
        } else {
          // Revenue metric view: primary=Revenue, secondary=EPS
          const revIsHist=t.revType==='hist';
          html+=revIsHist?histRev():estRev();
          const epsPart=t.epsType==='hist'?histEps():estEps();
          if(epsPart)html+=div+epsPart;
        }

        tip.innerHTML=html;
        const tx=e.clientX+16,ty=e.clientY-8;
        const tw=tip.offsetWidth||170,th2=tip.offsetHeight||100;
        tip.style.left=(tx+tw>window.innerWidth?e.clientX-tw-8:tx)+'px';
        tip.style.top=(ty+th2>window.innerHeight?e.clientY-th2-10:ty)+'px';
        tip.style.display='block';
      };
      window[`_emTipHi_${wid}`]=()=>{const t=document.getElementById(`em-tip-${wid}`);if(t)t.style.display='none';};

      requestAnimationFrame(()=>setTimeout(()=>{
        const ylEl=document.getElementById(`em-yl-${wid}`);
        if(ylEl&&yrlyData.length){
          const c=LightweightCharts.createChart(ylEl,{...lwBase(ylEl),handleScroll:false,handleScale:false});
          if(chartView==='growth'){
            const gs=c.addHistogramSeries({priceLineVisible:false,lastValueVisible:false});
            const gd=yrlyData.map((p,i)=>{
              if(!i)return null;
              const pv=yrlyData[i-1].value;
              const gv=pv&&pv!==0?(p.value-pv)/Math.abs(pv)*100:null;
              return gv!=null?{time:p.time,value:gv,color:gv>=0?'rgba(251,191,36,.7)':'rgba(248,113,113,.7)'}:null;
            }).filter(Boolean);
            gs.setData(gd);
          } else {
            const s=c.addLineSeries({color:'#fbbf24',lineWidth:2,priceLineVisible:false,lastValueVisible:true});
            s.setData(yrlyData);
          }
          c.timeScale().fitContent();_lw[`em-yl-${wid}`]=c;
          new ResizeObserver(()=>c.applyOptions({width:ylEl.clientWidth,height:ylEl.clientHeight})).observe(ylEl);
        }
        const qtEl=document.getElementById(`em-qt-${wid}`);
        if(qtEl&&qData.length){
          const c=LightweightCharts.createChart(qtEl,{...lwBase(qtEl),handleScroll:false,handleScale:false});
          const s=c.addHistogramSeries({priceLineVisible:false,lastValueVisible:false});
          s.setData(qData.map(p=>({time:p.time,value:p.value,color:p.est?'rgba(74,222,128,.5)':p.value>=0?'rgba(251,191,36,.75)':'rgba(248,113,113,.75)'})));
          c.timeScale().fitContent();_lw[`em-qt-${wid}`]=c;
          new ResizeObserver(()=>c.applyOptions({width:qtEl.clientWidth,height:qtEl.clientHeight})).observe(qtEl);
        }
      },50));
    }

    window[`_emN_${wid}`]=(dir)=>{startIdx=Math.max(0,Math.min(ALL_YRS.length-6,startIdx+dir));render();};
    window[`_emM_${wid}`]=(key)=>{metric=key;render();};
    window[`_emG_${wid}`]=(key)=>{growthMode=key;render();};
    window[`_emC_${wid}`]=(key)=>{chartView=key;render();};
    render();
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

