import { API, fp, ld, dc, charts } from '../../core/utils.js';

export async function doGp(el, wid) {
  el.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%';

  // ── catalog ──
  const GP_CATALOG = [
    { group: 'LABOR', items: [
      {label:'Unemployment Rate',        id:'UNRATE'},
      {label:'Non-Farm Payrolls',        id:'PAYEMS'},
      {label:'Participation Rate',       id:'CIVPART'},
      {label:'Initial Jobless Claims',   id:'ICSA'},
      {label:'Job Openings (JOLTS)',     id:'JTSJOL'},
      {label:'ADP Private Payrolls',     id:'ADPMNUSNERSA'},
    ]},
    { group: 'INFLATION', items: [
      {label:'CPI (All Items)',          id:'CPIAUCSL'},
      {label:'Core CPI',                id:'CPILFESL'},
      {label:'PCE Price Index',         id:'PCEPI'},
      {label:'Core PCE',                id:'PCEPILFE'},
      {label:'PPI (All Commodities)',   id:'PPIACO'},
      {label:'Breakeven Inflation 5Y',  id:'T5YIE'},
      {label:'Breakeven Inflation 10Y', id:'T10YIE'},
    ]},
    { group: 'GROWTH', items: [
      {label:'Real GDP',                id:'GDPC1'},
      {label:'Nominal GDP',            id:'GDP'},
      {label:'Real GDP Growth Rate',   id:'A191RL1Q225SBEA'},
      {label:'Real Personal Consumption',id:'PCEC96'},
      {label:'Industrial Production',  id:'INDPRO'},
      {label:'Retail Sales',           id:'RSAFS'},
    ]},
    { group: 'RATES', items: [
      {label:'Fed Funds Rate',         id:'FEDFUNDS'},
      {label:'Effective FFR (Daily)',  id:'DFF'},
      {label:'SOFR',                   id:'SOFR'},
      {label:'3M Treasury',           id:'DGS3MO'},
      {label:'2Y Treasury',           id:'DGS2'},
      {label:'5Y Treasury',           id:'DGS5'},
      {label:'10Y Treasury',          id:'DGS10'},
      {label:'30Y Treasury',          id:'DGS30'},
      {label:'5Y Real Yield (TIPS)',  id:'DFII5'},
      {label:'10Y Real Yield (TIPS)', id:'DFII10'},
    ]},
    { group: 'MONEY & CREDIT', items: [
      {label:'M1 Money Supply',        id:'M1SL'},
      {label:'M2 Money Supply',        id:'M2SL'},
      {label:'Fed Reserve Balance Sheet',id:'WALCL'},
      {label:'Reserve Balances (Fed)', id:'WRESBAL'},
      {label:'IG Corp Spread (OAS)',   id:'BAMLC0A0CM'},
      {label:'HY Corp Spread (OAS)',   id:'BAMLH0A0HYM2'},
      {label:'10Y-2Y Curve',          id:'T10Y2Y'},
      {label:'10Y-3M Curve',          id:'T10Y3M'},
    ]},
    { group: 'FISCAL', items: [
      {label:'Federal Debt ($B)',      id:'GFDEBTN'},
      {label:'Debt / GDP (%)',        id:'GFDEGDP'},
      {label:'Budget Deficit',        id:'MTSDS133FMS'},
      {label:'TGA Balance',           id:'WTREGEN'},
    ]},
    { group: 'DEBT & CREDIT', items: [
      {label:'Household Debt ($B)',    id:'HHMSDODNS'},
      {label:'Consumer Credit',        id:'TOTALSL'},
      {label:'30Y Mortgage Rate',      id:'MORTGAGE30US'},
      {label:'15Y Mortgage Rate',      id:'MORTGAGE15US'},
      {label:'Credit Card Delinquency',id:'DRCCLACBS'},
      {label:'Auto Loan Delinquency',  id:'DRAUTOACBS'},
      {label:'Commercial Bank Loans',  id:'TOTLL'},
      {label:'Bank Credit (Total)',    id:'TOTBKCR'},
    ]},
    { group: 'HOUSING', items: [
      {label:'Housing Starts',         id:'HOUST'},
      {label:'Building Permits',       id:'PERMIT'},
      {label:'Existing Home Sales',    id:'EXCSRSA'},
      {label:'Case-Shiller HPI',       id:'CSUSHPINSA'},
    ]},
    { group: 'SENTIMENT', items: [
      {label:'VIX (CBOE Volatility)',  id:'VIXCLS'},
      {label:'Consumer Sentiment (UoM)',id:'UMCSENT'},
      {label:'AAII Bull %',            id:'AAIIBULL'},
      {label:'AAII Bear %',            id:'AAIIBEAR'},
      {label:'NFIB Small Biz Optimism',id:'NFCI'},
    ]},
    { group: 'CUSTOM', items: [
      {label:'Enter FRED ID or ticker…',id:'__CUSTOM__'},
    ]},
  ];

  const GP_FLAT = [];
  GP_CATALOG.forEach(g => { if (g.group !== 'CUSTOM') g.items.forEach(it => GP_FLAT.push({...it, group: g.group})); });

  // ── state ──
  const today = new Date().toISOString().slice(0,10);
  function addYrs(n){ const d=new Date(today+'T12:00'); d.setFullYear(d.getFullYear()+n); return d.toISOString().slice(0,10); }
  let _mode  = 'overlay';
  let _from  = addYrs(-10), _to = today;
  let _seriesIds: string[] = [];
  let _maPeriods = [50, 100, 200];
  let _maEnabled = {50:true, 100:true, 200:true};
  let _gpCache   = {};
  let _gpChart   = null;
  let _acGetters = {};

  const inpSty = `background:#0a0a0a;border:1px solid #252525;color:#ccc;font-family:var(--font);font-size:11px;padding:3px 6px;border-radius:2px;outline:none;width:94px;`;
  const COLORS = ['#2563eb','#dc2626','#d97706','#16a34a','#7c3aed','#0891b2','#be185d','#65a30d'];
  const MA_COLS = ['#7c3aed','#059669','#ea580c','#0284c7','#be185d','#ca8a04','#475569','#9333ea'];
  function maCol(i){ return MA_COLS[i % MA_COLS.length]; }

  // ── helpers ──
  function byDate(data){ return (data||[]).filter(r=>r.date>=_from&&r.date<=_to); }

  function calcMA(data, period){
    const out=[];
    for(let i=period-1;i<data.length;i++){
      let s=0; for(let j=i-period+1;j<=i;j++) s+=data[j].value;
      out.push({date:data[i].date,value:s/period});
    }
    return out;
  }

  function calcRatio(s1d, s2d){
    const m=new Map(s2d.map(d=>[d.date,d.value]));
    return s1d.filter(d=>m.has(d.date)&&m.get(d.date)!==0).map(d=>({date:d.date,value:d.value/m.get(d.date)}));
  }

  function gpFmt(meta){
    if(!meta) return v=>(+v).toFixed(4);
    const u=(meta.units||'').toLowerCase();
    if(u.includes('percent')||u==='%') return v=>(+v).toFixed(2)+'%';
    if(u==='ratio')                    return v=>(+v).toFixed(3);
    if(u.includes('billion'))          return v=>'$'+(+v).toFixed(1)+'B';
    if(u.includes('thousand'))         return v=>(+v).toFixed(0)+'K';
    if(meta.source==='yfinance')       return v=>'$'+(+v).toFixed(2);
    return v=>(+v).toFixed(2);
  }

  // ── fetch ──
  async function fetchSeries(id){
    if(!id||id==='__CUSTOM__') return null;
    if(_gpCache[id]) return _gpCache[id];
    try{
      const r=await fetch(`${API}/gp?series=${encodeURIComponent(id)}`).then(x=>x.json());
      if(!r.ok) throw new Error(r.error);
      _gpCache[id]=r.series[0];
      return _gpCache[id];
    }catch(e){ return null; }
  }

  // ── chart ──
  function destroyChart(){
    if(_gpChart){try{_gpChart.remove();}catch(e){} _gpChart=null;}
  }

  async function renderChart(){
    destroyChart();
    const chartEl=document.getElementById('gp-chart-'+wid);
    const footer =document.getElementById('gp-footer-'+wid);
    if(!chartEl) return;

    const activeIds=_seriesIds.filter(id=>id&&id!=='__CUSTOM__');
    if(!activeIds.length){
      chartEl.innerHTML='';
      if(footer) footer.innerHTML='';
      return;
    }

    chartEl.innerHTML='<div style="color:#555;font-size:11px;padding:20px">Loading…</div>';
    const results=await Promise.all(activeIds.map(id=>fetchSeries(id).catch(()=>null)));
    const active=results.filter(Boolean);

    if(!active.length){
      chartEl.innerHTML='<div style="color:#f87171;font-size:10px;padding:20px">No data available. Check the series ID.</div>';
      return;
    }
    chartEl.innerHTML='';

    const lwOpts={
      width: chartEl.clientWidth||800,
      height:chartEl.clientHeight||400,
      layout:{background:{type:'solid',color:'#111827'},textColor:'#9ca3af',fontSize:11,fontFamily:"'JetBrains Mono',monospace"},
      grid:{vertLines:{color:'#1f2937'},horzLines:{color:'#1a2332'}},
      timeScale:{borderColor:'#2d3748',timeVisible:true,fixLeftEdge:false,fixRightEdge:false},
      rightPriceScale:{visible:true,borderColor:'#2d3748',scaleMargins:{top:0.1,bottom:0.1}},
      leftPriceScale:{visible:false,borderColor:'#2d3748',scaleMargins:{top:0.1,bottom:0.1}},
      crosshair:{vertLine:{color:'#4b5563',labelBackgroundColor:'#1f2937'},horzLine:{color:'#4b5563',labelBackgroundColor:'#1f2937'}},
    };

    requestAnimationFrame(()=>setTimeout(()=>{
      const chart=LightweightCharts.createChart(chartEl,lwOpts);
      _gpChart=chart;

      if(_mode==='overlay'){
        const filt=active.filter(s=>byDate(s.data).length>0);
        const multi=filt.length>1;
        // Apply left scale config BEFORE adding series so the chart is ready
        if(multi) chart.applyOptions({leftPriceScale:{visible:true,borderColor:'#2d3748',scaleMargins:{top:0.1,bottom:0.1}}});
        filt.forEach((s,i)=>{
          // S1 on 'right' (primary), S2 on 'left', S3+ on hidden named scales
          const scaleId = i===0 ? 'right' : i===1 ? 'left' : `s${i}`;
          const ls=chart.addLineSeries({
            color:COLORS[i%COLORS.length],lineWidth:2,
            priceScaleId:multi?scaleId:'right',
            lastValueVisible:true,priceLineVisible:false,
            priceFormat:{type:'custom',formatter:gpFmt(s)},
          });
          ls.setData(byDate(s.data).map(r=>({time:r.date,value:+r.value})));
        });
        if(footer) footer.innerHTML=filt.map((s,i)=>
          `<span style="color:${COLORS[i%COLORS.length]};font-weight:600">${s.id}</span> <span style="color:#6b7280">${s.label}</span> <span style="color:#9ca3af">${s.frequency} · ${s.source.toUpperCase()}</span>`
        ).join('<span style="color:#555;padding:0 8px">·</span>');

      } else if(_mode==='ratio'){
        const s1=active[0], s2=active[1];
        if(!s2){chartEl.innerHTML='<div style="color:#fbbf24;font-size:10px;padding:20px">Add a second series for ratio mode.</div>';chart.remove();_gpChart=null;return;}
        const rd=calcRatio(byDate(s1.data),byDate(s2.data));
        if(!rd.length){chartEl.innerHTML='<div style="color:#444;font-size:10px;padding:20px">No overlapping dates between series.</div>';chart.remove();_gpChart=null;return;}
        const ls=chart.addLineSeries({color:COLORS[0],lineWidth:2,priceScaleId:'right',lastValueVisible:true,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>(+v).toFixed(4)}});
        ls.setData(rd.map(r=>({time:r.date,value:+r.value})));
        if(rd.length>=50){
          const ma=calcMA(rd,50);
          const lm=chart.addLineSeries({color:'#555',lineWidth:1,lineStyle:2,priceScaleId:'right',lastValueVisible:false,priceLineVisible:false,priceFormat:{type:'custom',formatter:v=>(+v).toFixed(4)}});
          lm.setData(ma.map(r=>({time:r.date,value:+r.value})));
        }
        const last=rd[rd.length-1]?.value, avg=rd.reduce((s,r)=>s+r.value,0)/rd.length;
        if(footer) footer.innerHTML=`<span style="color:${COLORS[0]};font-weight:600">${s1.id} / ${s2.id}</span> <span style="color:#6b7280">Last: ${(+last).toFixed(4)} · Avg: ${(+avg).toFixed(4)}</span> <span style="color:#9ca3af">· ${s1.source.toUpperCase()} / ${s2.source.toUpperCase()}</span>`;

      } else if(_mode==='mas'){
        const s1=active[0];
        const pd=byDate(s1.data);
        if(!pd.length){chartEl.innerHTML='<div style="color:#444;font-size:10px;padding:20px">No data in selected range.</div>';chart.remove();_gpChart=null;return;}
        const lsP=chart.addLineSeries({color:'#e2e8f0',lineWidth:2,priceScaleId:'right',lastValueVisible:true,priceLineVisible:false,priceFormat:{type:'custom',formatter:gpFmt(s1)}});
        lsP.setData(pd.map(r=>({time:r.date,value:+r.value})));
        _maPeriods.forEach((period,pi)=>{
          if(!_maEnabled[period]) return;
          const md=calcMA(s1.data,period).filter(r=>r.date>=_from&&r.date<=_to);
          if(!md.length) return;
          const lm=chart.addLineSeries({color:maCol(pi),lineWidth:1,priceScaleId:'right',lastValueVisible:true,priceLineVisible:false,priceFormat:{type:'custom',formatter:gpFmt(s1)}});
          lm.setData(md.map(r=>({time:r.date,value:+r.value})));
        });
        if(footer) footer.innerHTML=
          `<span style="color:#e2e8f0;font-weight:600">${s1.id}</span> <span style="color:#6b7280">${s1.label}</span> <span style="color:#9ca3af">${s1.frequency} · ${s1.source.toUpperCase()}</span>`+
          _maPeriods.filter(p=>_maEnabled[p]).map((p,pi)=>`<span style="color:${maCol(pi)};padding-left:10px;font-weight:600">${p}d MA</span>`).join('');
      }

      chart.timeScale().fitContent();
      new ResizeObserver(()=>chart.applyOptions({width:chartEl.clientWidth,height:chartEl.clientHeight})).observe(chartEl);
    },0));
  }

  // ── autocomplete factory ──
  function makeAC(key, defaultId, ph){
    return {
      html:`<span class="gp-ac" id="gp-acw${key}-${wid}"><input class="gp-ac-inp" id="gp-aci${key}-${wid}" autocomplete="off" spellcheck="false" placeholder="${ph||'Search…'}"><div class="gp-ac-dd" id="gp-acd${key}-${wid}"></div></span>`,
      wire(onChange){
        const inp=document.getElementById(`gp-aci${key}-${wid}`);
        const dd =document.getElementById(`gp-acd${key}-${wid}`);
        let _val=defaultId||'',_items=[],_hi=-1;
        function lbl(id){const f=GP_FLAT.find(x=>x.id===id);return f?f.id+' · '+f.label:id;}
        function display(){inp.value=_val?lbl(_val):'';}
        display();
        function filter(q){
          if(!q) return GP_FLAT;
          const ql=q.toLowerCase();
          return GP_FLAT.map(x=>({...x,sc:x.id.toLowerCase().startsWith(ql)?0:x.id.toLowerCase().includes(ql)?1:x.label.toLowerCase().includes(ql)?2:99})).filter(x=>x.sc<99).sort((a,b)=>a.sc-b.sc);
        }
        function renderDD(items){
          _items=items;_hi=-1;
          if(!items.length){dd.innerHTML='<div class="gp-ac-none">No match — press Enter to use as custom ID</div>';}
          else{
            let h='',lg=null;
            items.forEach((it,i)=>{if(it.group!==lg){h+=`<div class="gp-ac-grp">${it.group}</div>`;lg=it.group;}h+=`<div class="gp-ac-it" data-i="${i}"><span class="gp-ac-id">${it.id}</span><span class="gp-ac-lb">${it.label}</span></div>`;});
            dd.innerHTML=h;
            dd.querySelectorAll('.gp-ac-it').forEach(el=>el.addEventListener('mousedown',e=>{e.preventDefault();commit(_items[+el.dataset.i]);}));
          }
          dd.style.display='block';
        }
        function setHi(i){_hi=i;dd.querySelectorAll('.gp-ac-it').forEach((e,j)=>e.classList.toggle('hi',j===_hi));const h=dd.querySelector('.gp-ac-it.hi');if(h)h.scrollIntoView({block:'nearest'});}
        function commit(item){if(item){_val=item.id;}else{_val='';}display();dd.style.display='none';onChange(_val);}
        function commitRaw(){const v=inp.value.trim().toUpperCase();if(v){_val=v;inp.value=v;dd.style.display='none';onChange(_val);}else{display();dd.style.display='none';}}
        inp.addEventListener('focus',()=>{inp.select();renderDD(filter(''));});
        inp.addEventListener('input',()=>{const q=inp.value;renderDD(filter(q.includes('·')?'':q));});
        inp.addEventListener('keydown',e=>{
          if(e.key==='ArrowDown'){e.preventDefault();setHi(Math.min(_hi+1,_items.length-1));}
          else if(e.key==='ArrowUp'){e.preventDefault();setHi(Math.max(_hi-1,-1));}
          else if(e.key==='Enter'){e.preventDefault();if(_hi>=0&&_items[_hi])commit(_items[_hi]);else if(_items.length===1)commit(_items[0]);else commitRaw();}
          else if(e.key==='Escape'){dd.style.display='none';display();}
          else if(e.key==='Backspace'&&inp.value===''){commit(null);}
        });
        inp.addEventListener('blur',()=>setTimeout(()=>{dd.style.display='none';display();},160));
        return ()=>_val;
      }
    };
  }

  // ── MA row ──
  function rebuildMaRow(){
    const maw=document.getElementById(`gp-mawrap-${wid}`);
    if(!maw) return;
    const togs=_maPeriods.map((p,pi)=>{
      const on=_maEnabled[p];
      return `<span style="display:inline-flex;align-items:center;margin-right:2px">`+
        `<span class="gp-matog${on?' active':''}" data-p="${p}" title="Toggle visibility" style="border-radius:2px 0 0 2px">${p}d</span>`+
        `<span class="gp-ma-rmv" data-p="${p}" style="cursor:pointer;color:#555;font-size:10px;font-weight:700;border:1px solid #252525;border-left:none;border-radius:0 2px 2px 0;padding:2px 5px;line-height:1.3;transition:color .12s,border-color .12s" onmouseover="this.style.color='#f87171';this.style.borderColor='#f87171'" onmouseout="this.style.color='#555';this.style.borderColor='#252525'" title="Remove MA">×</span>`+
        `</span>`;
    }).join('');
    maw.innerHTML=`<span style="font-size:10px;color:var(--dim);margin-right:3px;letter-spacing:.05em">MA</span>${togs}<input id="gp-maadd-${wid}" type="number" min="2" max="999" placeholder="period" style="${inpSty}width:64px;padding:2px 5px;"><span id="gp-maaddbtn-${wid}" style="cursor:pointer;color:var(--orange);font-size:12px;font-weight:700;border:1px solid var(--orange);border-radius:2px;padding:1px 7px;line-height:1.5;transition:opacity .12s;opacity:.7" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='.7'">+</span>`;

    maw.querySelectorAll('.gp-matog').forEach(b=>{
      b.addEventListener('click',e=>{
        if(e.target.classList.contains('gp-ma-rmv')) return;
        const p=+b.dataset.p; _maEnabled[p]=!_maEnabled[p]; b.classList.toggle('active',_maEnabled[p]); renderChart();
      });
    });
    maw.querySelectorAll('.gp-ma-rmv').forEach(x=>{
      x.addEventListener('click',e=>{
        e.stopPropagation();
        const p=+x.dataset.p;
        _maPeriods=_maPeriods.filter(v=>v!==p);
        delete _maEnabled[p];
        rebuildMaRow(); renderChart();
      });
    });
    const addI=document.getElementById(`gp-maadd-${wid}`);
    const addB=document.getElementById(`gp-maaddbtn-${wid}`);
    function tryAdd(){
      const v=parseInt(addI.value,10);
      if(!v||v<2||v>999||_maPeriods.includes(v)){addI.value='';return;}
      _maPeriods.push(v); _maPeriods.sort((a,b)=>a-b); _maEnabled[v]=true;
      addI.value=''; rebuildMaRow(); renderChart();
    }
    addB.addEventListener('click',tryAdd);
    addI.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();tryAdd();}});
  }

  // ── Series row ──
  function rebuildSeriesRow(){
    const row=document.getElementById(`gp-srow-${wid}`);
    if(!row) return;
    const maxS=_mode==='mas'?1:_mode==='ratio'?2:8;
    while(_seriesIds.length>maxS) _seriesIds.pop();
    const widgets=_seriesIds.map((id,i)=>({key:`k${i}`,id,i,ac:makeAC(`k${i}`,id,i===0?'Search series…':'— none —')}));
    const rmv=`cursor:pointer;color:#444;font-size:13px;padding:0 3px;line-height:1;transition:color .12s`;
    let html=widgets.map(({key,i,ac})=>
      `<span class="gp-slot" style="display:inline-flex;align-items:center;gap:2px">`+
      `<span style="font-size:10px;color:${COLORS[i%COLORS.length]};letter-spacing:.05em;min-width:16px">S${i+1}</span>`+
      ac.html+
      (i>0?`<span class="gp-rmv" data-i="${i}" style="${rmv}" onmouseover="this.style.color='#f87171'" onmouseout="this.style.color='#444'" title="Remove">×</span>`:'')+
      `</span>`
    ).join('');
    if(_seriesIds.length<maxS){
      html+=`<span id="gp-add-${wid}" style="cursor:pointer;color:var(--orange);font-size:13px;font-weight:700;border:1px solid var(--orange);border-radius:3px;padding:2px 9px;line-height:1.4;transition:opacity .12s,background .12s;flex-shrink:0;opacity:.75;letter-spacing:.05em" onmouseover="this.style.opacity='1';this.style.background='rgba(240,140,0,.12)'" onmouseout="this.style.opacity='.75';this.style.background=''" title="Add series">+ ADD</span>`;
    }
    row.innerHTML=html;
    _acGetters={};
    widgets.forEach(({key,i,ac})=>{
      _acGetters[i]=ac.wire(v=>{_seriesIds[i]=v||'';renderChart();});
    });
    row.querySelectorAll('.gp-rmv').forEach(btn=>{
      btn.addEventListener('click',()=>{_seriesIds.splice(+btn.dataset.i,1);rebuildSeriesRow();renderChart();});
    });
    const addBtn=document.getElementById(`gp-add-${wid}`);
    if(addBtn){
      addBtn.addEventListener('click',()=>{
        _seriesIds.push('');
        rebuildSeriesRow();
        const ni=document.getElementById(`gp-acik${_seriesIds.length-1}-${wid}`);
        if(ni) setTimeout(()=>ni.focus(),30);
      });
    }
  }

  // ── mode handler ──
  function applyMode(mode){
    _mode=mode;
    const maw=document.getElementById(`gp-mawrap-${wid}`);
    if(maw) maw.style.display=mode==='mas'?'inline-flex':'none';
    rebuildSeriesRow();
  }

  // ── toolbar HTML ──
  const modeSty=`background:#0a0a0a;border:1px solid #252525;color:var(--orange);font-family:var(--font);font-size:11px;padding:3px 6px;border-radius:2px;outline:none;cursor:pointer;letter-spacing:.06em`;
  const btnSty=`font-size:10px;color:var(--dim);letter-spacing:.08em;cursor:pointer;padding:2px 7px;border:1px solid var(--bdr);border-radius:2px;transition:color .12s,border-color .12s`;
  el.innerHTML=`
    <div style="display:flex;gap:5px;padding:7px 10px;border-bottom:1px solid var(--bdr);flex-shrink:0;align-items:center;flex-wrap:wrap;row-gap:5px">
      <select id="gp-mode-${wid}" style="${modeSty}">
        <option value="overlay">OVERLAY</option>
        <option value="ratio">RATIO</option>
        <option value="mas">MAs</option>
      </select>
      <span style="width:1px;height:14px;background:var(--bdr);margin:0 2px;flex-shrink:0"></span>
      <div id="gp-srow-${wid}" style="display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap"></div>
      <span id="gp-mawrap-${wid}" style="display:none;align-items:center;gap:3px;flex-wrap:wrap"></span>
      <span style="margin-left:auto;display:flex;align-items:center;gap:5px;flex-shrink:0">
        <span style="font-size:10px;color:#444;letter-spacing:.06em">FROM</span>
        <input id="gp-from-${wid}" type="date" value="${_from}" style="${inpSty}width:116px;">
        <span style="font-size:10px;color:#444;letter-spacing:.06em">TO</span>
        <input id="gp-to-${wid}" type="date" value="${_to}" style="${inpSty}width:116px;">
        <span id="gp-reset-${wid}" style="${btnSty}" onmouseover="this.style.color='var(--orange)';this.style.borderColor='var(--orange)'" onmouseout="this.style.color='var(--dim)';this.style.borderColor='var(--bdr)'">RESET</span>
        <span id="gp-clear-${wid}" style="${btnSty}" onmouseover="this.style.color='#f87171';this.style.borderColor='#f87171'" onmouseout="this.style.color='var(--dim)';this.style.borderColor='var(--bdr)'">CLEAR</span>
      </span>
    </div>
    <div style="flex:1;position:relative;min-height:0">
      <div id="gp-chart-${wid}" style="position:absolute;inset:0"></div>
    </div>
    <div id="gp-footer-${wid}" style="padding:5px 10px;font-size:10px;color:var(--dim);flex-shrink:0;border-top:1px solid var(--bdr);letter-spacing:.05em;display:flex;align-items:center;gap:8px;flex-wrap:wrap"></div>
  `;

  rebuildSeriesRow();
  rebuildMaRow();

  document.getElementById(`gp-mode-${wid}`).addEventListener('change',e=>{applyMode(e.target.value);renderChart();});

  const fromI=document.getElementById(`gp-from-${wid}`);
  const toI  =document.getElementById(`gp-to-${wid}`);
  fromI.addEventListener('change',()=>{_from=fromI.value||_from;renderChart();});
  toI.addEventListener('change',  ()=>{_to  =toI.value  ||_to;  renderChart();});

  document.getElementById(`gp-reset-${wid}`).addEventListener('click',()=>{
    _from=addYrs(-10);_to=today;fromI.value=_from;toI.value=_to;renderChart();
  });
  document.getElementById(`gp-clear-${wid}`).addEventListener('click',()=>{
    _seriesIds=[];
    rebuildSeriesRow();
    destroyChart();
    const footer=document.getElementById(`gp-footer-${wid}`);
    if(footer) footer.innerHTML='';
    const chartEl=document.getElementById(`gp-chart-${wid}`);
    if(chartEl) chartEl.innerHTML='';
  });

  renderChart();
}

// ══════════════════════════════════════════════
//  MODL · Historical Financial Model
// ══════════════════════════════════════════════
window._modl = window._modl || {};
