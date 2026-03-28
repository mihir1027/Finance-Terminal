import { API, fp, ld, dc, charts } from '../../core/utils.js';

export async function doFisc(el,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=ld('Loading institutional fiscal data…');
  let _d=null, tab='overview';

  // ── formatters ──
  const fT=(v,d=2)=>{if(v==null||isNaN(v))return'—';const a=Math.abs(v),s=v<0?'-':'';if(a>=1e12)return s+'$'+(a/1e12).toFixed(d)+'T';if(a>=1e9)return s+'$'+(a/1e9).toFixed(d)+'B';if(a>=1e6)return s+'$'+(a/1e6).toFixed(d)+'M';return s+'$'+a.toFixed(0);};
  const fB=(v,d=2)=>{if(v==null||isNaN(v))return'—';const a=Math.abs(v),s=v<0?'-':'';if(a>=1e3)return s+'$'+(a/1e3).toFixed(d)+'T';if(a>=1)return s+'$'+a.toFixed(d)+'B';return s+'$'+(a*1e3).toFixed(0)+'M';};
  const fM=(v,d=1)=>v!=null?'$'+(v/1e3).toFixed(d)+'B':'—';
  const fPct=(v,d=2)=>v!=null?v.toFixed(d)+'%':'—';
  const fDt=s=>{try{return s.slice(0,7);}catch{return s||'—';}};
  const last=arr=>arr&&arr.length?arr[arr.length-1]:null;
  const prev=(arr,n=1)=>arr&&arr.length>n?arr[arr.length-1-n]:null;
  const delta=arr=>(!arr||arr.length<2)?null:arr[arr.length-1].value-arr[arr.length-2].value;
  const pill=(v,inv=false,fmt=x=>Math.abs(x).toFixed(2))=>{
    if(v==null)return'<span style="color:#444">—</span>';
    const pos=inv?v<0:v>0;const col=pos?'#4ade80':'#f87171';
    return`<span style="color:${col}">${v>0?'▲':'▼'} ${v>0?'+':''}${fmt(v)}</span>`;
  };
  const chHdr=(t,src)=>`<div style="font-size:9px;color:#333;letter-spacing:.1em;margin-bottom:4px;text-transform:uppercase">${t} <span style="color:#222;font-size:8px">${src}</span></div>`;
  const kpi=(label,val,sub,sc='#555')=>`<div class="fisc-kpi"><div class="fk-l">${label}</div><div class="fk-v">${val}</div><div class="fk-s" style="color:${sc}">${sub}</div></div>`;
  const signal=(label,color,text)=>`<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border:1px solid ${color}33;background:${color}0d;font-size:10px;color:${color};letter-spacing:.06em;margin-right:6px;margin-bottom:4px"><span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0"></span>${label}: ${text}</span>`;

  // ── chart helpers ──
  function mkChart(id,type,labels,datasets,yFmt,opts={}){
    dc(id);
    requestAnimationFrame(()=>{
      const ctx=document.getElementById(id)?.getContext('2d');if(!ctx)return;
      charts[id]=new Chart(ctx,{type,data:{labels,datasets},options:{
        responsive:true,maintainAspectRatio:false,
        plugins:{
          legend:{display:datasets.length>1,labels:{color:'#555',font:{family:'JetBrains Mono',size:9},boxWidth:8,padding:8}},
          tooltip:{backgroundColor:'#0f0f0f',borderColor:'#252525',borderWidth:1,titleColor:'#ccc',bodyColor:'#999',titleFont:{family:'JetBrains Mono',size:9},bodyFont:{family:'JetBrains Mono',size:10}}
        },
        scales:{
          x:{grid:{color:'#141414'},ticks:{color:'#333',font:{family:'JetBrains Mono',size:9},maxTicksLimit:10,maxRotation:0},border:{color:'#1e1e1e'}},
          y:{grid:{color:'#141414'},ticks:{color:'#444',font:{family:'JetBrains Mono',size:9},callback:yFmt},border:{color:'#1e1e1e'},...(opts.yMin!=null?{min:opts.yMin}:{}),...(opts.yMax!=null?{max:opts.yMax}:{})}
        },
        animation:{duration:200},...(opts.extra||{})}});
    });
  }
  function ds(label,data,color,opts={}){
    return{label,data,borderColor:color,borderWidth:opts.bw||1.5,pointRadius:opts.pr??0,fill:opts.fill??false,backgroundColor:color+(opts.alpha||'15'),tension:opts.t||.3,borderDash:opts.dash||[]};
  }

  // ── OVERVIEW — Operations Room ──────────────────────
  function renderOverview(){
    const b=document.getElementById('fisc-body-'+wid);if(!b)return;
    const c=_d.curve||{};
    const tgaL=last(_d.tga);
    const debtL=last(_d.debtB), gdpL=last(_d.debtGdp);
    const defL=last(_d.deficit);
    const dpL=_d.debtPenny&&_d.debtPenny.length?_d.debtPenny[_d.debtPenny.length-1]:null;
    const spread21=c['10Y']&&c['2Y']?(c['10Y']-c['2Y']):null;
    const inv=spread21!=null&&spread21<0;
    const tgaOk=tgaL?tgaL.value>=500000:'?';
    const lastAuction=_d.auctions&&_d.auctions.length?_d.auctions[0]:null;
    const bcOk=lastAuction?.bidToCover!=null?lastAuction.bidToCover>=2.0:null;

    // ── warning strip ──
    const tgaColor=tgaL?(tgaL.value<200000?'#f87171':tgaL.value<500000?'#fbbf24':'#4ade80'):'#555';
    const tgaStatus=tgaL?(tgaL.value<200000?'CRITICAL':tgaL.value<500000?'LOW':'ADEQUATE'):'—';
    const spreadColor=inv?'#f87171':spread21!=null&&spread21<0.5?'#fbbf24':'#4ade80';
    const spreadStatus=inv?'INVERTED':spread21!=null&&spread21<0.5?'FLAT':'NORMAL';
    const bcColor=bcOk===false?'#f87171':bcOk?'#4ade80':'#555';
    const bcStatus=lastAuction?.bidToCover!=null?lastAuction.bidToCover.toFixed(2)+'x':'—';

    // interest expense ratio
    const rcL=last(_d.receipts),ouL=last(_d.outlays);
    const intCostPct=rcL&&_d.avgRates&&_d.avgRates.length?(()=>{
      const latestTotal=_d.avgRates.find(r=>r.secDesc==='Total Marketable'||r.secDesc==='Total Interest-bearing Debt');
      return latestTotal?latestTotal.rate.toFixed(2)+'%':'—';
    })():'—';

    b.innerHTML=`
      <div style="padding:6px 10px;border-bottom:1px solid #141414;flex-shrink:0;display:flex;flex-wrap:wrap;align-items:center">
        ${signal('TGA',tgaColor,tgaStatus)}
        ${signal('2Y/10Y',spreadColor,spreadStatus+(spread21!=null?' ('+((spread21)*100).toFixed(0)+'bp)':''))}
        ${signal('LAST AUCTION B/C',bcColor,bcStatus+(lastAuction?' · '+lastAuction.type+' '+lastAuction.term:''))}
        ${signal('DEFICIT',defL?(defL.value<0?'#f87171':'#4ade80'):'#555',defL?fM(defL.value)+' ('+fDt(defL.date)+')':'—')}
      </div>
      <div style="display:flex;gap:0;padding:8px 10px 4px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #0f0f0f">
        ${kpi('TOTAL PUBLIC DEBT',dpL?fT(dpL.total):'—','Debt to Penny · Daily')}
        ${kpi('DEBT / GDP',fPct(gdpL?.value,1),pill(delta(_d.debtGdp))+' QoQ ppt')}
        ${kpi('TGA CASH',tgaL?fM(tgaL.value):'—',`<span style="color:${tgaColor}">${tgaStatus}</span> · WTREGEN`)}
        ${kpi('2Y / 10Y SPREAD',spread21!=null?((spread21*100).toFixed(0))+'bp':'—',`<span style="color:${spreadColor}">${spreadStatus}</span>`)}
        ${kpi('MONTHLY DEFICIT',defL?fM(defL.value):'—',defL?.value<0?'<span style="color:#f87171">Deficit</span>':'<span style="color:#4ade80">Surplus</span>')}
        ${kpi('10Y BREAKEVEN',last(_d.breakeven10y)?last(_d.breakeven10y).value.toFixed(2)+'%':'—','Inflation expectation · T10YIE')}
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:8px 10px;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column">${chHdr('TGA CASH BALANCE ($B)','WTREGEN')}<div style="flex:1;position:relative"><canvas id="fisc-ov-tga-${wid}"></canvas></div></div>
        <div style="display:flex;flex-direction:column">${chHdr('MONTHLY SURPLUS/DEFICIT ($B)','MTSDS133FMS')}<div style="flex:1;position:relative"><canvas id="fisc-ov-def-${wid}"></canvas></div></div>
        <div style="display:flex;flex-direction:column">${chHdr('YIELD CURVE — CURRENT','DGS SERIES')}<div style="flex:1;position:relative"><canvas id="fisc-ov-yc-${wid}"></canvas></div></div>
      </div>`;

    const tgaS=(_d.tga||[]).slice(-52);
    mkChart('fisc-ov-tga-'+wid,'line',tgaS.map(r=>fDt(r.date)),[
      ds('TGA $B',tgaS.map(r=>r.value/1000),'#38bdf8',{fill:true,alpha:'0d',bw:2}),
      ds('$200B Floor',new Array(tgaS.length).fill(200),'#f87171',{bw:1,dash:[3,3],alpha:'00'}),
    ],v=>'$'+v.toFixed(0)+'B',{yMin:0});

    const defS=(_d.deficit||[]).slice(-36);
    mkChart('fisc-ov-def-'+wid,'bar',defS.map(r=>fDt(r.date)),
      [{data:defS.map(r=>r.value/1000),backgroundColor:defS.map(r=>r.value<0?'rgba(248,113,113,0.6)':'rgba(74,222,128,0.6)'),borderColor:defS.map(r=>r.value<0?'#f87171':'#4ade80'),borderWidth:1}],
      v=>'$'+v.toFixed(0)+'B');

    const tenors=['1M','3M','6M','1Y','2Y','5Y','7Y','10Y','20Y','30Y'];
    const vals=tenors.map(t=>c[t]??null);
    mkChart('fisc-ov-yc-'+wid,'line',tenors,
      [{data:vals,borderColor:'#38bdf8',borderWidth:2,pointRadius:3,pointBackgroundColor:'#38bdf8',fill:true,backgroundColor:'rgba(56,189,248,0.06)',tension:.3,segment:{borderColor:ctx=>ctx.p0.parsed.y>ctx.p1.parsed.y?'#f87171':'#38bdf8'}}],
      v=>v.toFixed(2)+'%');
  }

  // ── DEBT — Debt Manager's Console ──────────────────
  function renderDebt(){
    const b=document.getElementById('fisc-body-'+wid);if(!b)return;
    const dpL=_d.debtPenny&&_d.debtPenny.length?_d.debtPenny[_d.debtPenny.length-1]:null;
    const dpP=_d.debtPenny&&_d.debtPenny.length>7?_d.debtPenny[_d.debtPenny.length-8]:null;
    const debtL=last(_d.debtB), gdpL=last(_d.debtGdp);
    const wkChg=dpL&&dpP?dpL.total-dpP.total:null;

    // Latest avg interest rates by security type
    const latestRates=(()=>{
      if(!_d.avgRates||!_d.avgRates.length)return[];
      const latestDate=_d.avgRates[0].date;
      return _d.avgRates.filter(r=>r.date===latestDate&&r.rate>0).slice(0,8);
    })();

    b.innerHTML=`
      <div style="display:flex;gap:0;padding:8px 10px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #0f0f0f">
        ${kpi('TOTAL PUBLIC DEBT',dpL?fT(dpL.total):'—','Debt to Penny · Daily · Treasury')}
        ${kpi('DEBT HELD PUBLIC',dpL?fT(dpL.public):'—','Marketable + external')}
        ${kpi('INTRAGOVERNMENTAL',dpL?fT(dpL.intragov):'—','SS Trust Fund etc.')}
        ${kpi('7-DAY CHANGE',wkChg!=null?fT(wkChg):'—',wkChg!=null?pill(wkChg,false,v=>'$'+(Math.abs(v)/1e9).toFixed(1)+'B'):'Weekly net issuance')}
        ${kpi('DEBT / GDP',fPct(gdpL?.value,1),'GFDEGDP · Quarterly')}
        ${kpi('QoQ DEBT CHANGE',debtL&&prev(_d.debtB)?fB(debtL.value-prev(_d.debtB).value):'—','GFDEBTN quarterly')}
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:8px;padding:8px 10px;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column">${chHdr('DAILY TOTAL DEBT OUTSTANDING ($T)','DEBT TO PENNY')}<div style="flex:1;position:relative"><canvas id="fisc-dp-${wid}"></canvas></div></div>
        <div style="display:flex;flex-direction:column">${chHdr('DEBT / GDP — QUARTERLY','GFDEGDP')}<div style="flex:1;position:relative"><canvas id="fisc-dgdp-${wid}"></canvas></div></div>
        <div style="display:flex;flex-direction:column;overflow:hidden">
          ${chHdr('AVG INTEREST RATE ON OUTSTANDING DEBT','TREASURY')}
          <div style="flex:1;overflow-y:auto">
            ${latestRates.map(r=>`
              <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #111">
                <span style="font-size:10px;color:#888;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.secDesc}</span>
                <span style="font-size:12px;font-weight:600;color:#e0e0e0">${r.rate.toFixed(3)}%</span>
              </div>`).join('')||'<div class="empty">No rate data</div>'}
          </div>
          <div style="font-size:9px;color:#2a2a2a;margin-top:4px">${_d.avgRates&&_d.avgRates.length?_d.avgRates[0].date:''}</div>
        </div>
      </div>`;

    const dpS=(_d.debtPenny||[]).slice(-252);
    mkChart('fisc-dp-'+wid,'line',dpS.map(r=>r.date.slice(0,10)),[
      ds('Public $T',dpS.map(r=>r.public/1e12),'#4ade80',{bw:1.5,fill:true,alpha:'08'}),
      ds('Intragovt $T',dpS.map(r=>r.intragov/1e12),'#fbbf24',{bw:1,fill:false}),
    ],v=>'$'+v.toFixed(2)+'T');

    const gdpAll=(_d.debtGdp||[]);
    mkChart('fisc-dgdp-'+wid,'line',gdpAll.map(r=>fDt(r.date)),[
      ds('Debt/GDP%',gdpAll.map(r=>r.value),'#f87171',{fill:true,alpha:'08',bw:2})
    ],v=>v.toFixed(0)+'%',{yMin:0});
  }

  // ── BUDGET — Fiscal Sustainability ─────────────────
  function renderBudget(){
    const b=document.getElementById('fisc-body-'+wid);if(!b)return;
    const rcL=last(_d.receipts),ouL=last(_d.outlays),deL=last(_d.deficit);
    const N=48;
    const rcS=(_d.receipts||[]).slice(-N),ouS=(_d.outlays||[]).slice(-N),deS=(_d.deficit||[]).slice(-N);

    // YTD cumulative deficit (fiscal year starts Oct)
    const ytdDef=(()=>{
      const now=new Date(); const fy=now.getMonth()>=9?now.getFullYear():now.getFullYear()-1;
      const fyStart=`${fy}-10`;
      return (_d.deficit||[]).filter(r=>r.date>=fyStart).reduce((s,r)=>s+r.value,0);
    })();

    // Interest expense as % of receipts (estimate using avg rate on total debt × debt level)
    const intPct=(()=>{
      if(!rcL||!_d.avgRates||!_d.avgRates.length)return null;
      const tot=_d.avgRates.find(r=>r.secDesc&&(r.secDesc.toLowerCase().includes('total interest'))||r.secDesc.toLowerCase().includes('total marketable'));
      if(!tot||!_d.debtPenny||!_d.debtPenny.length)return null;
      const annualInt=(_d.debtPenny[_d.debtPenny.length-1].public*tot.rate/100)/12;
      return (annualInt/(rcL.value*1e6)*100).toFixed(1)+'%';
    })();

    b.innerHTML=`
      <div style="display:flex;gap:0;padding:8px 10px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #0f0f0f">
        ${kpi('MONTHLY RECEIPTS',rcL?fM(rcL.value):'—',rcL?fDt(rcL.date):'')}
        ${kpi('MONTHLY OUTLAYS',ouL?fM(ouL.value):'—',ouL?fDt(ouL.date):'')}
        ${kpi('MONTHLY DEFICIT',deL?fM(deL.value):'—',deL?.value<0?'<span style="color:#f87171">Deficit</span>':'<span style="color:#4ade80">Surplus</span>')}
        ${kpi('YTD DEFICIT (FY)',fM(ytdDef),'<span style="color:'+(ytdDef<0?'#f87171':'#4ade80')+'">'+(ytdDef<0?'Deficit':'Surplus')+'</span>')}
        ${kpi('OUTLAY/RECEIPT',rcL&&ouL&&rcL.value?((ouL.value/rcL.value)*100).toFixed(1)+'%':'—','Spending vs revenue')}
        ${kpi('EST. INT COST',intPct||'—','Annualized % of receipts')}
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1.5fr 1fr;gap:8px;padding:8px 10px;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column">${chHdr('MONTHLY RECEIPTS vs OUTLAYS ($B)','FRED MTSR/MTSO133FMS')}<div style="flex:1;position:relative"><canvas id="fisc-bud-rv-${wid}"></canvas></div></div>
        <div style="display:flex;flex-direction:column">${chHdr('MONTHLY DEFICIT/SURPLUS ($B)','MTSDS133FMS')}<div style="flex:1;position:relative"><canvas id="fisc-bud-def-${wid}"></canvas></div></div>
      </div>`;

    mkChart('fisc-bud-rv-'+wid,'line',rcS.map(r=>fDt(r.date)),[
      ds('Receipts',rcS.map(r=>r.value/1000),'#4ade80',{bw:1.5}),
      ds('Outlays',ouS.slice(-N).map(r=>r.value/1000),'#f87171',{bw:1.5}),
    ],v=>'$'+v.toFixed(0)+'B');
    mkChart('fisc-bud-def-'+wid,'bar',deS.map(r=>fDt(r.date)),
      [{data:deS.map(r=>r.value/1000),backgroundColor:deS.map(r=>r.value>=0?'rgba(74,222,128,0.55)':'rgba(248,113,113,0.55)'),borderColor:deS.map(r=>r.value>=0?'#4ade80':'#f87171'),borderWidth:1}],
      v=>'$'+v.toFixed(0)+'B');
  }

  // ── AUCTIONS — Debt Issuance Console ───────────────
  function renderAuctions(){
    const b=document.getElementById('fisc-body-'+wid);if(!b)return;
    const aucs=_d.auctions||[];
    if(!aucs.length){b.innerHTML=`<div class="empty">No auction data available</div>`;return;}

    // KPI metrics from auction data
    const recent10=aucs.filter(a=>a.term&&(a.term.includes('10-Year')||a.term.includes('10 Year')));
    const recent2=aucs.filter(a=>a.term&&(a.term.includes('2-Year')||a.term.includes('2 Year')));
    const last10=recent10[0],last2=recent2[0];
    const avg5BC=(aucs.slice(0,5).filter(a=>a.bidToCover).reduce((s,a)=>s+a.bidToCover,0)/Math.max(1,aucs.slice(0,5).filter(a=>a.bidToCover).length));
    const bcColor=v=>v==null?'#555':v<2?'#f87171':v<2.5?'#fbbf24':'#4ade80';

    const typeColor={Note:'#38bdf8',Bill:'#4ade80',Bond:'#fbbf24',TIPS:'#a78bfa',FRN:'#f87171'};
    const tColor=t=>typeColor[Object.keys(typeColor).find(k=>t&&t.includes(k))||'']||'#888';

    const fAmt=v=>{if(v==null)return'—';if(v>=1e9)return'$'+(v/1e9).toFixed(1)+'B';if(v>=1e6)return'$'+(v/1e6).toFixed(0)+'M';if(v>=1e3)return'$'+(v/1e3).toFixed(0)+'K';return'$'+v.toFixed(0);};

    b.innerHTML=`
      <div style="display:flex;gap:0;padding:8px 10px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #0f0f0f">
        ${kpi('LAST AUCTION B/C',aucs[0]?.bidToCover!=null?`<span style="color:${bcColor(aucs[0].bidToCover)}">${aucs[0].bidToCover.toFixed(2)}x</span>`:'—',aucs[0]?(aucs[0].type+' · '+aucs[0].term+' · '+aucs[0].auctionDate.slice(0,10)):'')}
        ${kpi('5-AUCTION AVG B/C',avg5BC?`<span style="color:${bcColor(avg5BC)}">${avg5BC.toFixed(2)}x</span>`:'—','Rolling demand signal')}
        ${kpi('LAST 10Y YIELD',last10?.highYield!=null?last10.highYield.toFixed(3)+'%':'—',last10?'Auction '+last10.auctionDate.slice(0,10):'No 10Y data')}
        ${kpi('LAST 2Y YIELD',last2?.highYield!=null?last2.highYield.toFixed(3)+'%':'—',last2?'Auction '+last2.auctionDate.slice(0,10):'No 2Y data')}
        ${kpi('LAST OFFERING',fAmt(aucs[0]?.offeringAmt),'Total size')}
        ${kpi('ACCEPTANCE RATE',aucs[0]?.tendered&&aucs[0]?.accepted?((aucs[0].accepted/aucs[0].tendered)*100).toFixed(1)+'%':'—','Accepted / Tendered')}
      </div>
      <div style="flex:1;overflow-y:auto;padding:0 10px 8px">
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <thead>
            <tr style="position:sticky;top:0;background:#080808;z-index:1">
              <th style="text-align:left;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">TYPE</th>
              <th style="text-align:left;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">TERM</th>
              <th style="text-align:left;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">AUCTION</th>
              <th style="text-align:left;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">MATURITY</th>
              <th style="text-align:right;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">OFFERING</th>
              <th style="text-align:right;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">TENDERED</th>
              <th style="text-align:right;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">B/C</th>
              <th style="text-align:right;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">HIGH YIELD</th>
              <th style="text-align:right;padding:6px 8px;color:#444;letter-spacing:.08em;font-weight:500;border-bottom:1px solid #1a1a1a">COUPON</th>
            </tr>
          </thead>
          <tbody>
            ${aucs.map(a=>{
              const bc=a.bidToCover;
              const bcCol=bcColor(bc);
              const tc=tColor(a.type);
              return`<tr style="border-bottom:1px solid #0d0d0d">
                <td style="padding:5px 8px;color:${tc};font-weight:600">${a.type||'—'}</td>
                <td style="padding:5px 8px;color:#c0c0c0">${a.term||'—'}</td>
                <td style="padding:5px 8px;color:#666">${a.auctionDate?a.auctionDate.slice(0,10):'—'}</td>
                <td style="padding:5px 8px;color:#555">${a.maturityDate?a.maturityDate.slice(0,10):'—'}</td>
                <td style="padding:5px 8px;text-align:right;color:#999">${fAmt(a.offeringAmt)}</td>
                <td style="padding:5px 8px;text-align:right;color:#777">${fAmt(a.tendered)}</td>
                <td style="padding:5px 8px;text-align:right;font-weight:700;color:${bcCol}">${bc!=null?bc.toFixed(2)+'x':'—'}</td>
                <td style="padding:5px 8px;text-align:right;color:#e0e0e0;font-weight:600">${a.highYield!=null?a.highYield.toFixed(3)+'%':'—'}</td>
                <td style="padding:5px 8px;text-align:right;color:#666">${a.intRate!=null?a.intRate.toFixed(3)+'%':'—'}</td>
              </tr>`;}).join('')}
          </tbody>
        </table>
        <div style="padding:6px 0;font-size:9px;color:#2a2a2a;letter-spacing:.06em">SOURCE: FISCALDATA.TREASURY.GOV · B/C &lt;2.0x = <span style="color:#f87171">WEAK</span> · 2.0-2.5x = <span style="color:#fbbf24">ADEQUATE</span> · &gt;2.5x = <span style="color:#4ade80">STRONG</span></div>
      </div>`;
  }

  // ── YIELDS — Market Stress & Curve ─────────────────
  function renderYields(){
    const b=document.getElementById('fisc-body-'+wid);if(!b)return;
    const c=_d.curve||{};
    const tenors=['1M','3M','6M','1Y','2Y','5Y','7Y','10Y','20Y','30Y'];
    const spread=c['10Y']&&c['2Y']?(c['10Y']-c['2Y'])*100:null;
    const inv=spread!=null&&spread<0;
    const spread530=c['30Y']&&c['5Y']?(c['30Y']-c['5Y'])*100:null;
    const be=last(_d.breakeven10y);

    b.innerHTML=`
      <div style="display:flex;gap:0;padding:8px 10px;flex-shrink:0;flex-wrap:wrap;border-bottom:1px solid #0f0f0f">
        ${kpi('2Y YIELD',c['2Y']?c['2Y'].toFixed(2)+'%':'—','DGS2 · Daily')}
        ${kpi('10Y YIELD',c['10Y']?c['10Y'].toFixed(2)+'%':'—','DGS10 · Daily')}
        ${kpi('30Y YIELD',c['30Y']?c['30Y'].toFixed(2)+'%':'—','DGS30 · Daily')}
        ${kpi('2Y/10Y SPREAD',spread!=null?spread.toFixed(0)+'bp':'—',`<span style="color:${inv?'#f87171':spread!=null&&spread<50?'#fbbf24':'#4ade80'}">${inv?'INVERTED ⚠':spread!=null&&spread<50?'FLAT':'NORMAL'}</span>`)}
        ${kpi('5Y/30Y SPREAD',spread530!=null?spread530.toFixed(0)+'bp':'—','Long-end slope')}
        ${kpi('10Y BREAKEVEN',be?be.value.toFixed(2)+'%':'—','Inflation expectation · T10YIE')}
      </div>
      <div style="flex:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 10px;overflow:hidden;min-height:0">
        <div style="display:flex;flex-direction:column">${chHdr('CURRENT YIELD CURVE','DGS SERIES · LATEST')}<div style="flex:1;position:relative"><canvas id="fisc-yc-${wid}"></canvas></div></div>
        <div style="display:flex;flex-direction:column">${chHdr('2Y / 10Y / 30Y YIELD HISTORY — 1Y','DGS2 · DGS10 · DGS30')}<div style="flex:1;position:relative"><canvas id="fisc-yhist-${wid}"></canvas></div></div>
      </div>`;

    const vals=tenors.map(t=>c[t]??null);
    mkChart('fisc-yc-'+wid,'line',tenors,
      [{data:vals,borderColor:'#38bdf8',borderWidth:2,pointRadius:4,pointBackgroundColor:tenors.map(t=>{const v=c[t];return v!=null&&c['10Y']!=null&&c['2Y']!=null&&v<c['2Y']?'#f87171':'#38bdf8';}),fill:true,backgroundColor:'rgba(56,189,248,0.05)',tension:.3,segment:{borderColor:ctx=>ctx.p0.parsed.y>ctx.p1.parsed.y?'#f87171':'#38bdf8'}}],
      v=>v.toFixed(2)+'%');

    const h=_d.yieldHistory||{};
    const s2=(h['DGS2']||[]).slice(-252),s10=(h['DGS10']||[]).slice(-252),s30=(h['DGS30']||[]).slice(-252);
    const beH=(_d.breakeven10y||[]).slice(-252);
    const lbl=s10.map(r=>r.date.slice(5));
    mkChart('fisc-yhist-'+wid,'line',lbl,[
      ds('2Y',s2.slice(-lbl.length).map(r=>r.value),'#fbbf24',{bw:1.5}),
      ds('10Y',s10.map(r=>r.value),'#38bdf8',{bw:2}),
      ds('30Y',s30.slice(-lbl.length).map(r=>r.value),'#a78bfa',{bw:1.5}),
      ds('BE10Y',beH.slice(-lbl.length).map(r=>r.value),'#4ade80',{bw:1,dash:[3,3]}),
    ],v=>v.toFixed(2)+'%');
  }

  function buildShell(){
    const tabs=[
      {k:'overview',l:'OPERATIONS'},
      {k:'debt',l:'DEBT'},
      {k:'budget',l:'BUDGET'},
      {k:'auctions',l:'AUCTIONS'},
      {k:'yields',l:'YIELDS'},
    ];
    el.innerHTML=`
      <div style="display:flex;gap:3px;padding:5px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center">
        ${tabs.map(t=>`<span class="mac-tab${t.k===tab?' active':''}" data-k="${t.k}">${t.l}</span>`).join('')}
        <span style="margin-left:auto;font-size:9px;color:#252525;letter-spacing:.06em">FRED · FISCALDATA.TREASURY.GOV</span>
      </div>
      <div id="fisc-body-${wid}" style="flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0"></div>`;
    el.querySelectorAll('.mac-tab').forEach(t=>t.addEventListener('click',()=>{
      tab=t.dataset.k;
      el.querySelectorAll('.mac-tab').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      render();
    }));
  }

  function render(){
    ({overview:renderOverview,debt:renderDebt,budget:renderBudget,auctions:renderAuctions,yields:renderYields}[tab]||renderOverview)();
  }

  try{
    const r=await fetch(`${API}/fisc`).then(x=>x.json());
    if(!r.ok){el.innerHTML=`<div class="err">${r.error||'Fiscal data unavailable'}</div>`;return;}
    _d=r; buildShell(); render();
  }catch(e){el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
}

// ── MACRO ──
