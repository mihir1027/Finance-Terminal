import { API, fp, ld } from '../../core/utils.js';
import { createChart, destroyChart } from '../../core/chart.js';
import { tip, initTooltips } from '../../core/tooltip.js';

export async function doGc(el,wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';

  // Duration order for treasury display
  const TENOR_ORDER=['1M','2M','3M','6M','1Y','2Y','3Y','5Y','7Y','10Y','20Y','30Y'];
  const COMMOD_KEYS=['crude','gold','natgas','corn','wheat','soybeans','copper','silver','coffee','sugar'];
  const COMMOD_LABELS:Record<string,string>={crude:'CRUDE',gold:'GOLD',natgas:'NAT GAS',electricity:'POWER',corn:'CORN',wheat:'WHEAT',soybeans:'SOYBEANS',copper:'COPPER',silver:'SILVER',platinum:'PLATINUM',coffee:'COFFEE',sugar:'SUGAR'};
  const COMMOD_COLORS:Record<string,string>={crude:'#fbbf24',gold:'#f59e0b',natgas:'#60a5fa',electricity:'#4ade80',corn:'#86efac',wheat:'#d1d5db',soybeans:'#a3e635',copper:'#fb923c',silver:'#94a3b8',platinum:'#e2e8f0',coffee:'#92400e',sugar:'#fde68a'};

  let active='TREASURY';

  function gcKillAll(){
    // Treasury charts
    [`gc-snap-${wid}`,`gc-ts2-${wid}`,`gc-spr-${wid}`,`gc-spreads-${wid}`,`gc-real-${wid}`].forEach(destroyChart);
    // Commodity curve + workspace panels
    destroyChart(`gc-commod-${wid}`);
    for(const k of COMMOD_KEYS){
      const ws=_workspace[k];
      if(ws)ws.panels.forEach((p:any)=>destroyChart(`gc-panel-${p.id}-${wid}`));
    }
  }

  // ── Workspace Architecture ─────────────────────────────────────────────────
  interface Panel{id:string;type:string;label:string;datasets:any[];config?:any;kpi?:boolean;}
  interface WorkspaceState{panels:Panel[];addDdOpen:boolean;curve:any;eiaData:any;}

  // Series catalog: all available data points per commodity key
  const SERIES_CATALOG:Record<string,Array<{key:string;label:string;color:string}>>={
    natgas:[
      {key:'storage.l48',               label:'STORAGE L48 (BCF)',      color:'#fbbf24'},
      {key:'storage.east',              label:'STORAGE EAST (BCF)',     color:'#60a5fa'},
      {key:'storage.south',             label:'STORAGE SOUTH (BCF)',    color:'#fb923c'},
      {key:'storage.west',              label:'STORAGE WEST (BCF)',     color:'#4ade80'},
      {key:'production.total',          label:'PRODUCTION (BCF/D)',     color:'#4ade80'},
      {key:'consumption.electric_power',label:'POWER BURN (BCF/D)',     color:'#fbbf24'},
      {key:'consumption.industrial',    label:'INDUSTRIAL (BCF/D)',     color:'#60a5fa'},
      {key:'consumption.residential',   label:'RESIDENTIAL (BCF/D)',    color:'#f87171'},
      {key:'consumption.total',         label:'TOTAL CONSUMPTION',      color:'#888888'},
      {key:'prices.henryHub',           label:'HENRY HUB ($/MMBTU)',    color:'#a78bfa'},
    ],
    crude:[
      {key:'stocks.crude',              label:'CRUDE STOCKS (MBBL)',    color:'#fbbf24'},
      {key:'stocks.cushing',            label:'CUSHING (MBBL)',         color:'#f59e0b'},
      {key:'stocks.gasoline',           label:'GASOLINE STOCKS',        color:'#a3e635'},
      {key:'stocks.distillate',         label:'DISTILLATE STOCKS',      color:'#fb923c'},
      {key:'production',                label:'PRODUCTION (KBD)',       color:'#4ade80'},
      {key:'refinery.utilization',      label:'REFINERY UTIL %',        color:'#f87171'},
      {key:'productSupplied.gasoline',  label:'GASOLINE DEMAND',        color:'#86efac'},
      {key:'productSupplied.distillate',label:'DISTILLATE DEMAND',      color:'#fde68a'},
      {key:'trade.imports',             label:'CRUDE IMPORTS (KBD)',    color:'#f87171'},
      {key:'trade.exports',             label:'CRUDE EXPORTS (KBD)',    color:'#4ade80'},
      {key:'prices.wti',                label:'WTI ($/BBL)',            color:'#fbbf24'},
      {key:'prices.brent',              label:'BRENT ($/BBL)',          color:'#60a5fa'},
    ],
    electricity:[
      {key:'generation.gas',            label:'GAS GEN (MWH)',          color:'#fbbf24'},
      {key:'generation.coal',           label:'COAL GEN (MWH)',         color:'#78716c'},
      {key:'generation.nuclear',        label:'NUCLEAR GEN (MWH)',      color:'#60a5fa'},
      {key:'generation.wind',           label:'WIND GEN (MWH)',         color:'#4ade80'},
      {key:'generation.solar',          label:'SOLAR GEN (MWH)',        color:'#facc15'},
      {key:'generation.hydro',          label:'HYDRO GEN (MWH)',        color:'#38bdf8'},
      {key:'generation.total',          label:'TOTAL GEN (MWH)',        color:'#e2e8f0'},
      {key:'nuclear.capacityOfflinePct',label:'NUCLEAR % OF MIX',       color:'#a78bfa'},
    ],
  };
  (SERIES_CATALOG as any).brent = SERIES_CATALOG.crude;

  const PANEL_REGISTRY:Record<string,Panel[]>={
    natgas:[
      {id:'ng-custom',     type:'custom',     label:'FUNDAMENTALS CHART',
        datasets:[], config:{_catalog:'natgas',_defaults:['storage.l48','production.total','prices.henryHub']}},
      {id:'ng-storage',    type:'seasonal',   label:'GAS STORAGE vs 5-YR RANGE',
        datasets:[{key:'storage.l48',color:'#fbbf24',axis:'left',label:'US L48 Storage'}]},
      {id:'ng-stor-region',type:'timeseries', label:'REGIONAL STORAGE',
        datasets:[
          {key:'storage.east', color:'#60a5fa',axis:'left',label:'East'},
          {key:'storage.south',color:'#fbbf24',axis:'left',label:'South Central'},
          {key:'storage.west', color:'#4ade80',axis:'left',label:'West'},
        ]},
      {id:'ng-prod-price', type:'timeseries', label:'PRODUCTION vs HENRY HUB',
        datasets:[
          {key:'production.total',color:'#4ade80',axis:'left', label:'Prod (Bcf/d)'},
          {key:'prices.henryHub', color:'#fbbf24',axis:'right',label:'HH ($/MMBtu)'},
        ]},
      {id:'ng-consumption',type:'timeseries', label:'CONSUMPTION BY SECTOR',
        datasets:[
          {key:'consumption.electric_power',color:'#fbbf24',axis:'left',label:'Power Burn'},
          {key:'consumption.industrial',    color:'#60a5fa',axis:'left',label:'Industrial'},
          {key:'consumption.residential',   color:'#f87171',axis:'left',label:'Residential'},
        ]},
      {id:'ng-hhprice',    type:'timeseries', label:'HENRY HUB PRICE',
        datasets:[{key:'prices.henryHub',color:'#60a5fa',axis:'left',label:'Henry Hub'}]},
    ],
    crude:[
      {id:'cl-custom',     type:'custom',     label:'FUNDAMENTALS CHART',
        datasets:[], config:{_catalog:'crude',_defaults:['stocks.crude','prices.wti','production']}},
      {id:'cl-inv',        type:'seasonal',   label:'CRUDE INVENTORY vs 5-YR',
        datasets:[{key:'stocks.crude',   color:'#fbbf24',axis:'left',label:'US Crude'}]},
      {id:'cl-cush',       type:'seasonal',   label:'CUSHING STORAGE',
        datasets:[{key:'stocks.cushing', color:'#fbbf24',axis:'left',label:'Cushing'}]},
      {id:'cl-prod-price', type:'timeseries', label:'PRODUCTION vs WTI',
        datasets:[
          {key:'production',  color:'#4ade80',axis:'left', label:'Prod (Kbd)'},
          {key:'prices.wti',  color:'#fbbf24',axis:'right',label:'WTI ($/bbl)'},
        ]},
      {id:'cl-refinery',   type:'timeseries', label:'REFINERY UTILIZATION',
        datasets:[{key:'refinery.utilization',color:'#fb923c',axis:'left',label:'Util %'}]},
      {id:'cl-product-sup',type:'timeseries', label:'PRODUCT SUPPLIED (DEMAND PROXY)',
        datasets:[
          {key:'productSupplied.gasoline',  color:'#4ade80',axis:'left',label:'Gasoline'},
          {key:'productSupplied.distillate',color:'#f87171',axis:'left',label:'Distillate'},
        ]},
      {id:'cl-wbspread',   type:'spread',     label:'WTI − BRENT SPREAD',
        datasets:[{key:'prices.wtisBrent',color:'#888888',axis:'left',label:'WTI-Brent'}]},
      {id:'cl-gasoline',   type:'seasonal',   label:'GASOLINE STOCKS',
        datasets:[{key:'stocks.gasoline', color:'#a3e635',axis:'left',label:'Gasoline'}]},
      {id:'cl-distillate', type:'seasonal',   label:'DISTILLATE STOCKS',
        datasets:[{key:'stocks.distillate',color:'#fb923c',axis:'left',label:'Distillate'}]},
      {id:'cl-trade',      type:'timeseries', label:'IMPORTS vs EXPORTS',
        datasets:[
          {key:'trade.imports',color:'#f87171',axis:'left',label:'Imports'},
          {key:'trade.exports',color:'#4ade80',axis:'left',label:'Exports'},
        ]},
    ],
    electricity:[
      {id:'pwr-custom',  type:'custom',     label:'FUNDAMENTALS CHART',
        datasets:[], config:{_catalog:'electricity',_defaults:['generation.gas','generation.coal','generation.nuclear','generation.wind']}},
      {id:'pwr-genmix',  type:'timeseries', label:'GENERATION MIX · 24-MONTH',
        datasets:[
          {key:'generation.gas',    color:'#fbbf24',axis:'left',label:'Gas'},
          {key:'generation.coal',   color:'#78716c',axis:'left',label:'Coal'},
          {key:'generation.nuclear',color:'#60a5fa',axis:'left',label:'Nuclear'},
          {key:'generation.wind',   color:'#4ade80',axis:'left',label:'Wind'},
          {key:'generation.solar',  color:'#facc15',axis:'left',label:'Solar'},
        ]},
      {id:'pwr-total-gen',type:'timeseries', label:'TOTAL GENERATION TREND',
        datasets:[{key:'generation.total',color:'#fbbf24',axis:'left',label:'Total GWh'}]},
      {id:'pwr-nuclear', type:'timeseries', label:'NUCLEAR % OF GENERATION',
        datasets:[{key:'nuclear.capacityOfflinePct',color:'#60a5fa',axis:'left',label:'Nuclear %'}]},
    ],
    brent:[
      {id:'brent-custom',type:'custom',     label:'FUNDAMENTALS CHART',
        datasets:[], config:{_catalog:'crude',_defaults:['stocks.crude','prices.brent','trade.imports']}},
      {id:'brent-inv',   type:'seasonal',   label:'CRUDE INVENTORY vs 5-YR',
        datasets:[{key:'stocks.crude',  color:'#60a5fa',axis:'left',label:'US Crude'}]},
      {id:'brent-wbspr',type:'spread',    label:'WTI − BRENT SPREAD',
        datasets:[{key:'prices.wtisBrent',color:'#888888',axis:'left',label:'WTI-Brent'}]},
      {id:'brent-prod', type:'timeseries',label:'PRODUCTION vs BRENT',
        datasets:[
          {key:'production',  color:'#4ade80',axis:'left', label:'Prod (Kbd)'},
          {key:'prices.brent',color:'#60a5fa',axis:'right',label:'Brent ($/bbl)'},
        ]},
    ],
  };

  const _workspace:Record<string,WorkspaceState>={};
  let _ngData:any=null,_petroData:any=null,_elecData:any=null;

  function _dGet(obj:any,path:string):any{return path.split('.').reduce((o:any,k:string)=>o?.[k],obj);}

  async function _fetchEia(key:string):Promise<any>{
    if(key==='natgas'){
      if(_ngData?.ok)return _ngData;
      // Try dedicated endpoint, fall back to /api/energy
      try{
        const d=await fetch(`${API}/eia/ng`).then(x=>x.json());
        if(d?.ok){_ngData=d;return d;}
      }catch{}
      try{
        const e=await fetch(`${API}/energy`).then(x=>x.json());
        if(e?.ok){
          // Normalize /api/energy → /api/eia/ng shape so strip + panels work
          _ngData={ok:true,_src:'energy',
            storage:{l48:{...(e.gasStorage||{}),history:e.gasStorage?.history||[]}},
            prices:{henryHub:e.prices?.henryHub||{}},
            production:{total:{}},consumption:{}};
          return _ngData;
        }
      }catch{}
      return null;
    }
    if(key==='crude'||key==='brent'){
      if(_petroData?.ok)return _petroData;
      try{
        const d=await fetch(`${API}/eia/petroleum`).then(x=>x.json());
        if(d?.ok){_petroData=d;return d;}
      }catch{}
      try{
        const e=await fetch(`${API}/energy`).then(x=>x.json());
        if(e?.ok){
          // Normalize /api/energy → /api/eia/petroleum shape
          _petroData={ok:true,_src:'energy',
            stocks:{
              crude:{...(e.crude||{}),history:e.crude?.history||[]},
              cushing:{...(e.cushing||{}),history:e.cushing?.history||[]},
              gasoline:{...(e.gasoline||{}),history:e.gasoline?.history||[]},
              distillate:{...(e.distillate||{}),history:e.distillate?.history||[]},
            },
            production:{history:[]},
            refinery:{utilization:{history:[]},inputs:{value:e.refinery?.crudeInputs}},
            productSupplied:{gasoline:{history:[]},distillate:{history:[]}},
            trade:{imports:{history:[]},exports:{history:[]}},
            prices:{
              wti:{...(e.prices?.wti||{})},
              brent:{...(e.prices?.brent||{})},
              wtisBrent:{value:e.prices?.wtisBrentSpread,history:[]},
              crack321:e.prices?.crack321,
            }};
          return _petroData;
        }
      }catch{}
      return null;
    }
    if(key==='electricity'){
      if(_elecData?.ok)return _elecData;
      try{
        const d=await fetch(`${API}/eia/electricity`).then(x=>x.json());
        if(d?.ok){_elecData=d;return d;}
      }catch{}
      try{
        const e=await fetch(`${API}/energy`).then(x=>x.json());
        if(e?.ok&&e.electricity){
          _elecData={ok:true,_src:'energy',
            generation:{...(e.electricity||{}),gasPct:e.electricity?.gasPct},
            demand:{actual:{history:[]},forecast:{history:[]}},
            nuclear:{capacityOfflinePct:{history:[]}}};
          return _elecData;
        }
      }catch{}
      return null;
    }
    return null;
  }

  async function renderTreasury(){
    const tbody=document.getElementById('gc-body');if(!tbody)return;
    tbody.innerHTML=ld('Fetching Treasury yields…');
    let r:any;
    try{r=await fetch(`${API}/gc_fred`).then(x=>x.json());}
    catch(e){tbody.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;return;}
    if(!r.ok){tbody.innerHTML=`<div class="err">${r.error||'Failed to load curve'}</div>`;return;}

    const ALL_TENORS=['1M','2M','3M','6M','1Y','2Y','3Y','5Y','7Y','10Y','20Y','30Y'];
    const cur=r.current||{},m1=r.m1ago||{},y1=r.y1ago||{};
    const hist=r.history||{};
    const tipsHist=r.tips_history||{},tipsCur=r.tips_current||{};
    const sprHist=r.spread_history||{},beHist=r.breakeven_history||{};

    const fv=(v:any)=>v!=null?(+v).toFixed(2)+'%':'—';
    const bp=(a:any,b:any)=>{if(a==null||b==null)return'—';const d=Math.round((a-b)*100);return`<span style="color:${d>=0?'#4ade80':'#f87171'}">${d>0?'+':''}${d}bp</span>`;};
    const chgBp=(c:any,ago:any)=>{if(c==null||ago==null)return'';const d=Math.round((c-ago)*100);return`<span style="color:${d<=0?'#4ade80':'#f87171'};font-size:9px">${d>0?'+':''}${d}bp</span>`;};
    const inverted=cur['2Y']!=null&&cur['10Y']!=null&&cur['2Y']>cur['10Y'];
    const status=inverted?'<span style="color:#f87171;font-weight:700">INVERTED</span>':'<span style="color:#4ade80">NORMAL</span>';

    const snid=`gc-snap-${wid}`,t2id=`gc-ts2-${wid}`,sprid=`gc-spr-${wid}`;

    // Build a snapshot from history at N days ago
    function clientSnap(daysAgo:number):Record<string,number|null>{
      const d=new Date();d.setDate(d.getDate()-daysAgo);
      const tgt=d.toISOString().slice(0,10);
      const res:any={};
      for(const t of ALL_TENORS){
        const obs=(hist[t]||[]).filter((x:any)=>x.date<=tgt).sort((a:any,b:any)=>b.date.localeCompare(a.date));
        res[t]=obs.length?(+obs[0].value):null;
      }
      return res;
    }

    // All snapshot curve presets
    const SNAP_PRESETS:Record<string,{label:string;color:string;dashed?:boolean;getData:()=>any;tenors?:string[]}>={
      'current':{label:'Current',  color:'#38bdf8',getData:()=>cur},
      'm1':     {label:'1M Ago',   color:'#fbbf24',dashed:true,getData:()=>m1},
      'y1':     {label:'1Y Ago',   color:'#888888',dashed:true,getData:()=>y1},
      'm3':     {label:'3M Ago',   color:'#a78bfa',dashed:true,getData:()=>clientSnap(90)},
      'm6':     {label:'6M Ago',   color:'#34d399',dashed:true,getData:()=>clientSnap(180)},
      'tips':   {label:'TIPS Real',color:'#f87171',dashed:true,getData:()=>tipsCur,tenors:['5Y','7Y','10Y','20Y','30Y']},
    };

    // All time-series options with colors
    const TS_COLORS:Record<string,string>={
      '1M':'#64748b','2M':'#475569','3M':'#94a3b8','6M':'#a78bfa','1Y':'#c084fc',
      '2Y':'#f87171','3Y':'#fb923c','5Y':'#fbbf24','7Y':'#a3e635','10Y':'#4ade80',
      '20Y':'#22d3ee','30Y':'#818cf8',
      'TIPS 5Y':'#c4b5fd','TIPS 10Y':'#7dd3fc','TIPS 30Y':'#fde68a',
      'Breakeven':'#fca5a5','10Y−2Y':'#86efac','10Y−3M':'#67e8f9',
    };

    interface SnapSer{id:string;label:string;color:string;dashed?:boolean;tenors?:string[];}
    interface TsSer{id:string;label:string;color:string;}

    let snapSeries:SnapSer[]=[
      {id:'current',label:'Current',color:'#38bdf8'},
      {id:'m1',label:'1M Ago',color:'#fbbf24',dashed:true},
      {id:'y1',label:'1Y Ago',color:'#888888',dashed:true},
    ];
    let tsSeries:TsSer[]=[
      {id:'2Y',label:'2Y',color:'#f87171'},
      {id:'10Y',label:'10Y',color:'#4ade80'},
      {id:'30Y',label:'30Y',color:'#818cf8'},
    ];
    let snapDd=false,tsDd=false;

    function getTsData(id:string):{time:string,value:number}[]{
      if(id.startsWith('TIPS ')){const t=id.slice(5);return(tipsHist[t]||[]).map((d:any)=>({time:d.date,value:+d.value}));}
      if(id==='Breakeven')return(beHist['10Y']||[]).map((d:any)=>({time:d.date,value:+d.value}));
      if(id==='10Y−2Y')return(sprHist['10Y2Y']||[]).map((d:any)=>({time:d.date,value:+d.value}));
      if(id==='10Y−3M')return(sprHist['10Y3M']||[]).map((d:any)=>({time:d.date,value:+d.value}));
      return(hist[id]||[]).map((d:any)=>({time:d.date,value:+d.value}));
    }

    function renderSnapLegend(){
      const el=document.getElementById(`gc-snap-legend-${wid}`);if(!el)return;
      el.innerHTML=snapSeries.map(s=>`<span style="color:${s.color}">${s.dashed?'&#8943;':'──'} ${s.label}</span>`).join('');
    }

    function renderSnapChart(){
      destroyChart(snid);
      requestAnimationFrame(()=>{
        const snEl=document.getElementById(snid);if(!snEl)return;
        const mkDs=(data:any,tenors?:string[])=>(tenors||ALL_TENORS)
          .map(t=>({time:ALL_TENORS.indexOf(t),value:data[t]??null}))
          .filter((d:any)=>d.value!=null&&d.time>=0);
        createChart(snid,{
          container:snEl,pctFormat:true,categories:ALL_TENORS,
          series:snapSeries.map(s=>{
            const p=SNAP_PRESETS[s.id];
            return{type:'line' as const,data:mkDs(p?p.getData():{},s.tenors),color:s.color,lineWidth:s.id==='current'?2:1.5,dashed:!!s.dashed};
          }),
        });
      });
    }

    function renderTsCharts(){
      destroyChart(t2id);destroyChart(sprid);
      const col=document.getElementById(`gc-ts-col-${wid}`);if(!col)return;
      const leg=tsSeries.map(s=>`<span style="color:${s.color}">── ${s.label}</span>`).join('');
      col.innerHTML=`
        <div style="display:flex;gap:10px;padding:4px 8px 3px;font-size:9px;flex-shrink:0;border-bottom:1px solid #111;flex-wrap:wrap">${leg}</div>
        <div style="flex:1.5;position:relative;min-height:0"><div id="${t2id}" style="position:absolute;inset:0"></div></div>
        <div style="padding:4px 8px 3px;font-size:9px;color:#444;letter-spacing:.08em;border-top:1px solid #111;border-bottom:1px solid #111;flex-shrink:0">10Y − 2Y SPREAD</div>
        <div style="flex:1;position:relative;min-height:0"><div id="${sprid}" style="position:absolute;inset:0"></div></div>`;
      requestAnimationFrame(()=>setTimeout(()=>{
        const t2El=document.getElementById(t2id);if(!t2El)return;
        createChart(t2id,{container:t2El,pctFormat:true,timeVisible:true,
          series:tsSeries.map(s=>({type:'line' as const,data:getTsData(s.id),color:s.color,lineWidth:1.5})),
        });
        const sprEl=document.getElementById(sprid);if(!sprEl)return;
        const h2=hist['2Y']||[],h10=hist['10Y']||[];
        const map2:any=Object.fromEntries(h2.map((d:any)=>[d.date,+d.value]));
        const sprData=h10.filter((d:any)=>map2[d.date]!=null).map((d:any)=>({
          time:d.date,value:+(+d.value-map2[d.date]).toFixed(3),
          color:(+d.value-map2[d.date])>=0?'rgba(74,222,128,0.7)':'rgba(248,113,113,0.7)',
        }));
        createChart(sprid,{container:sprEl,pctFormat:true,series:[{type:'histogram',data:sprData,color:'#4ade80'}]});
      },0));
    }

    function renderSidebar(){
      const sb=document.getElementById(`gc-sidebar-${wid}`);if(!sb)return;
      const activeSnap=new Set(snapSeries.map(s=>s.id));
      const activeTs=new Set(tsSeries.map(s=>s.id));
      const snapRows=snapSeries.map(s=>`
        <div class="gc-sb-row">
          <div class="gc-sb-swatch" style="background:${s.color}"></div>
          <div class="gc-sb-lbl">${s.label}</div>
          ${s.id!=='current'?`<span class="gc-sb-rm" onclick="window._gcr_${wid}('snap','${s.id}')">×</span>`:''}
        </div>`).join('');
      const availSnap=Object.entries(SNAP_PRESETS).filter(([id])=>!activeSnap.has(id));
      const snapDdHtml=snapDd&&availSnap.length?`<div class="gc-sb-dd">${
        availSnap.map(([id,p])=>`<div class="gc-sb-ddi" onclick="window._gca_${wid}('snap','${id}')"><div class="gc-sb-swatch" style="background:${p.color}"></div>${p.label}</div>`).join('')
      }</div>`:'';
      const tsRows=tsSeries.map(s=>`
        <div class="gc-sb-row">
          <div class="gc-sb-swatch" style="background:${s.color}"></div>
          <div class="gc-sb-lbl">${s.label}</div>
          <span class="gc-sb-rm" onclick="window._gcr_${wid}('ts','${s.id}')">×</span>
        </div>`).join('');
      const availTs=Object.keys(TS_COLORS).filter(id=>!activeTs.has(id));
      const tsDdHtml=tsDd&&availTs.length?`<div class="gc-sb-dd">${
        availTs.map(id=>`<div class="gc-sb-ddi" onclick="window._gca_${wid}('ts','${id}')"><div class="gc-sb-swatch" style="background:${TS_COLORS[id]}"></div>${id}</div>`).join('')
      }</div>`:'';
      sb.innerHTML=`
        <div class="gc-sb-sec">SNAPSHOT CURVES</div>
        ${snapRows}
        <button class="gc-sb-add" onclick="window._gcd_${wid}('snap')">${snapDd?'▲ CANCEL':'+ ADD CURVE'}</button>
        ${snapDdHtml}
        <div class="gc-sb-sec" style="margin-top:4px">TIME SERIES</div>
        ${tsRows}
        <button class="gc-sb-add" onclick="window._gcd_${wid}('ts')">${tsDd?'▲ CANCEL':'+ ADD SERIES'}</button>
        ${tsDdHtml}
        <div style="margin-top:auto;padding:5px 8px;font-size:8px;color:#2a2a2a;border-top:1px solid #0e0e0e">AS OF ${r.asOf||'—'}<br>SRC: FRED</div>`;
    }

    tbody.innerHTML=`
      <div style="display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden">
        <div class="gc-hdr" style="background:#3d0c0c">
          <span>US TREASURY YIELD CURVE</span>
          <span class="gc-hdr-right"><span>Y-Axis: Mid YTM</span><span style="color:#5a1a1a">·</span><span style="color:#7a3333">FRED DGS</span></span>
        </div>
        <div class="curve-metrics" style="grid-template-columns:repeat(4,1fr)">
          <div class="cm-cell"><div class="cm-k">2Y</div><div class="cm-v" style="color:#38bdf8">${fv(cur['2Y'])} <span style="font-size:9px">${chgBp(cur['2Y'],y1['2Y'])}</span></div></div>
          <div class="cm-cell"><div class="cm-k">5Y</div><div class="cm-v" style="color:#38bdf8">${fv(cur['5Y'])} <span style="font-size:9px">${chgBp(cur['5Y'],y1['5Y'])}</span></div></div>
          <div class="cm-cell"><div class="cm-k">10Y</div><div class="cm-v" style="color:#38bdf8">${fv(cur['10Y'])} <span style="font-size:9px">${chgBp(cur['10Y'],y1['10Y'])}</span></div></div>
          <div class="cm-cell"><div class="cm-k">30Y</div><div class="cm-v" style="color:#38bdf8">${fv(cur['30Y'])} <span style="font-size:9px">${chgBp(cur['30Y'],y1['30Y'])}</span></div></div>
        </div>
        <div class="curve-metrics" style="grid-template-columns:repeat(4,1fr);margin-top:1px">
          <div class="cm-cell"><div class="cm-k">3M / 10Y</div><div class="cm-v" style="font-size:11px">${bp(cur['10Y'],cur['3M'])}</div></div>
          <div class="cm-cell"><div class="cm-k">2Y / 10Y</div><div class="cm-v" style="font-size:11px">${bp(cur['10Y'],cur['2Y'])}</div></div>
          <div class="cm-cell"><div class="cm-k">2Y / 30Y</div><div class="cm-v" style="font-size:11px">${bp(cur['30Y'],cur['2Y'])}</div></div>
          <div class="cm-cell"><div class="cm-k">STATUS</div><div class="cm-v" style="font-size:11px">${status}</div></div>
        </div>
        <div style="flex:1;display:flex;min-height:0;overflow:hidden">
          <div style="flex:1;display:flex;flex-direction:column;border-right:1px solid #1a1a1a;min-width:0">
            <div style="padding:3px 8px;font-size:8px;color:#444;letter-spacing:.1em;border-bottom:1px solid #111;flex-shrink:0">SNAPSHOT CURVE · ${r.asOf||'—'}</div>
            <div id="gc-snap-legend-${wid}" style="display:flex;gap:12px;padding:3px 8px;font-size:9px;flex-shrink:0;flex-wrap:wrap"></div>
            <div style="flex:1;position:relative;min-height:0"><div id="${snid}" style="position:absolute;inset:0"></div></div>
          </div>
          <div id="gc-ts-col-${wid}" style="flex:1;display:flex;flex-direction:column;min-width:0;border-right:1px solid #1a1a1a"></div>
          <div id="gc-sidebar-${wid}" class="gc-sidebar" style="width:155px;flex-shrink:0;border-left:1px solid #1a1a1a"></div>
        </div>
      </div>`;

    (window as any)[`_gcr_${wid}`]=(sec:string,id:string)=>{
      if(sec==='snap'){snapSeries=snapSeries.filter(s=>s.id!==id);snapDd=false;renderSnapLegend();renderSnapChart();}
      else{tsSeries=tsSeries.filter(s=>s.id!==id);tsDd=false;renderTsCharts();}
      renderSidebar();
    };
    (window as any)[`_gca_${wid}`]=(sec:string,id:string)=>{
      if(sec==='snap'){
        const p=SNAP_PRESETS[id];if(!p||snapSeries.find(s=>s.id===id))return;
        snapSeries=[...snapSeries,{id,label:p.label,color:p.color,dashed:p.dashed,tenors:p.tenors}];
        snapDd=false;renderSnapLegend();renderSnapChart();
      }else{
        const c=TS_COLORS[id];if(!c||tsSeries.find(s=>s.id===id))return;
        tsSeries=[...tsSeries,{id,label:id,color:c}];
        tsDd=false;renderTsCharts();
      }
      renderSidebar();
    };
    (window as any)[`_gcd_${wid}`]=(sec:string)=>{
      if(sec==='snap'){snapDd=!snapDd;tsDd=false;}
      else{tsDd=!tsDd;snapDd=false;}
      renderSidebar();
    };

    renderSnapLegend();
    renderSnapChart();
    renderTsCharts();
    renderSidebar();
  }

  async function renderCommod(key:string){
    const tbody=document.getElementById('gc-body');if(!tbody)return;
    const lbl=COMMOD_LABELS[key]||key.toUpperCase();
    tbody.innerHTML=ld(`Loading ${lbl} forward curve…`);
    const AGRI_KEYS=['corn','wheat','soybeans','sugar','coffee'];
    const EIA_KEYS=['crude','brent','natgas','electricity'];
    const AGRI_NAME:Record<string,string>={corn:'Corn',wheat:'Wheat',soybeans:'Soybeans',sugar:'Sugar',coffee:'Coffee'};
    try{
      const [curveRes,extraData]=await Promise.all([
        fetch(`${API}/commodity_curve/${key}`).then(x=>x.json()),
        EIA_KEYS.includes(key)?_fetchEia(key):
        AGRI_KEYS.includes(key)?fetch(`${API}/agri`).then(x=>x.json()):
        Promise.resolve(null),
      ]);
      if(!curveRes.ok){tbody.innerHTML=`<div class="err">${curveRes.error||'No curve data'}<br><span style="color:var(--dim)">Extended futures may require a data subscription.</span></div>`;return;}
      if(!_workspace[key]){
        _workspace[key]={panels:[],addDdOpen:false,curve:curveRes,eiaData:null};
      }
      _workspace[key].curve=curveRes;
      _workspace[key].eiaData=extraData;

      // Build agri data strip
      if(AGRI_KEYS.includes(key)&&extraData?.ok){
        const agriName=AGRI_NAME[key];
        const item=extraData.commodities?.find((c:any)=>c.name===agriName);
        if(item){
          const yoyCol=(item.yoy??0)>=0?'#4ade80':'#f87171';
          const momCol=(item.mom??0)>=0?'#4ade80':'#f87171';
          _workspace[key].eiaData={...(extraData||{}),_agriStrip:`<div class="commod-data-strip"><span class="ds-lbl">WORLD BANK</span><span class="ds-val">$${item.price} / ${item.unit}</span><span class="ds-sep">·</span><span class="ds-lbl">YoY</span><span style="color:${yoyCol}">${item.yoy>=0?'+':''}${item.yoy}%</span><span class="ds-sep">·</span><span class="ds-lbl">MoM</span><span style="color:${momCol}">${item.mom>=0?'+':''}${item.mom}%</span><span class="ds-sep">·</span><span class="ds-lbl" style="color:#555">${item.date?.slice(0,7)||''}</span></div>`};
        }
      }
      _renderWorkspace(key);
    }catch(e){tbody.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`;}
  }

  function _renderWorkspace(key:string){
    const tbody=document.getElementById('gc-body');if(!tbody)return;
    const ws=_workspace[key];if(!ws)return;
    const {curve,eiaData,panels,addDdOpen}=ws;
    const col=COMMOD_COLORS[key]||'#888';
    const lbl=COMMOD_LABELS[key]||key.toUpperCase();
    const pts=curve.points||[];
    const labels=pts.map((p:any)=>p.label);
    const pxData=pts.map((p:any)=>p.price);
    const cid=`gc-commod-${wid}`;
    const sp=curve.spreadPct;

    // Data strip: agri, natgas, crude
    let stripHtml=eiaData?._agriStrip||'';
    if(!stripHtml&&key==='natgas'&&eiaData?.ok){
      const g=eiaData.storage?.l48||{};
      if(g.value!=null){
        const wc=(g.wowChange??0)<0?'#4ade80':'#f87171';
        const sc=(g.surplus??0)<0?'#4ade80':'#f87171';
        stripHtml=`<div class="commod-data-strip"><span class="ds-lbl">GAS STORAGE (L48)</span><span class="ds-val">${Math.round(g.value).toLocaleString()} BCF</span><span class="ds-sep">·</span><span class="ds-lbl">WoW</span><span style="color:${wc}">${g.wowChange!=null?(g.wowChange>=0?'+':'')+Math.round(g.wowChange):''} BCF</span><span class="ds-sep">·</span><span class="ds-lbl">vs 5yr avg</span><span style="color:${sc}">${g.surplus!=null?(g.surplus>=0?'+':'')+Math.round(g.surplus):''} BCF</span>${g.signal?`<span class="ds-sep">·</span><span style="color:${g.signalDir==='bullish'?'#4ade80':'#f87171'};font-weight:600">${g.signal}</span>`:''}</div>`;
      }
    } else if(!stripHtml&&key==='electricity'&&eiaData?.ok){
      const gen=eiaData.generation||{};
      const gPct=gen.gasPct;
      const gasG=gen.gas||{};
      const nucG=gen.nuclear||{};
      if(gasG.value!=null){
        const yoyCol=(gasG.yoy??0)>=0?'#f87171':'#4ade80';
        stripHtml=`<div class="commod-data-strip"><span class="ds-lbl">GAS GENERATION</span><span class="ds-val">${(gasG.value/1000).toFixed(1)}B MWh</span><span class="ds-sep">·</span><span class="ds-lbl">GAS % MIX</span><span style="color:#fbbf24">${gPct!=null?gPct.toFixed(1)+'%':'—'}</span><span class="ds-sep">·</span><span class="ds-lbl">YoY</span><span style="color:${yoyCol}">${gasG.yoyPct!=null?(gasG.yoyPct>=0?'+':'')+gasG.yoyPct+'%':'—'}</span>${nucG.value!=null?`<span class="ds-sep">·</span><span class="ds-lbl">NUCLEAR</span><span style="color:#60a5fa">${(nucG.value/1000).toFixed(1)}B MWh</span>`:''}${gasG.asOf?`<span class="ds-sep">·</span><span style="color:#333">${gasG.asOf}</span>`:''}</div>`;
      }
    } else if(!stripHtml&&(key==='crude'||key==='brent')&&eiaData?.ok){
      const c=eiaData.stocks?.crude||{};
      if(c.value!=null){
        const wc=(c.wowChange??0)<0?'#4ade80':'#f87171';
        const sc=(c.surplusPct??0)<0?'#4ade80':'#f87171';
        const pWti=eiaData.prices?.wti;
        const crackStr=eiaData.prices?.crack321!=null?`<span class="ds-sep">·</span><span class="ds-lbl">3-2-1 CRACK</span><span style="color:${eiaData.prices.crack321>=20?'#4ade80':eiaData.prices.crack321<10?'#f87171':'#888'}">$${eiaData.prices.crack321.toFixed(2)}/bbl</span>`:'';
        stripHtml=`<div class="commod-data-strip"><span class="ds-lbl">CRUDE STOCKS</span><span class="ds-val">${c.value.toFixed(1)} Mbbl</span><span class="ds-sep">·</span><span class="ds-lbl">WoW</span><span style="color:${wc}">${c.wowChange!=null?(c.wowChange>=0?'+':'')+c.wowChange:''} Mbbl</span><span class="ds-sep">·</span><span class="ds-lbl">vs 5yr avg</span><span style="color:${sc}">${c.surplusPct!=null?(c.surplusPct>=0?'+':'')+c.surplusPct+'%':''}</span>${c.signal?`<span class="ds-sep">·</span><span style="color:${c.signalDir==='bullish'?'#4ade80':'#f87171'};font-weight:600">${c.signal}</span>`:''}<span class="ds-sep">·</span><span class="ds-lbl">WTI</span><span style="color:#fbbf24">${pWti?.value!=null?'$'+fp(pWti.value):''}</span>${crackStr}</div>`;
      }
    }

    // Registry and available panels
    const registry=PANEL_REGISTRY[key]||[];
    const addedIds=new Set(panels.map((p:Panel)=>p.id));
    const available=registry.filter((p:Panel)=>!addedIds.has(p.id));

    // Workspace panel slots
    let panelSlotsHtml='';
    panels.forEach((panel:Panel)=>{
      const chartId=`gc-panel-${panel.id}-${wid}`;
      const isCustom=panel.type==='custom';

      if(isCustom){
        const catalog:string=panel.config?._catalog||'';
        const allSeries=SERIES_CATALOG[catalog]||[];
        const selKeys:string[]=panel.config?._selected||(panel.config?._defaults||[]);
        const editOpen=!!panel.config?._editOpen;
        const chartType:string=panel.config?._chartType||'timeseries';
        const timeRange:string=panel.config?._timeRange||'ALL';
        const available=allSeries.filter((s:any)=>!selKeys.includes(s.key));

        // Series picker dropdown
        const pickerDd=editOpen?`<div style="position:absolute;top:calc(100% + 4px);left:0;background:#1a1a1a;border:1px solid #3a3a3a;min-width:210px;z-index:400;box-shadow:0 8px 24px rgba(0,0,0,.8);max-height:220px;overflow-y:auto">
          ${available.length?available.map((s:any)=>`<div onclick="window._gcseries_${wid}('${panel.id}','${s.key}')" style="padding:6px 10px;font-size:9px;color:#a0aab8;cursor:pointer;border-bottom:1px solid #252525;display:flex;align-items:center;gap:7px" onmouseenter="this.style.color='#e2e8f0';this.style.background='#222'" onmouseleave="this.style.color='#a0aab8';this.style.background=''"><span style="width:8px;height:8px;border-radius:50%;background:${s.color};flex-shrink:0"></span>${s.label}</div>`).join(''):
          `<div style="padding:8px 10px;font-size:9px;color:#666;letter-spacing:.08em">ALL SERIES ACTIVE</div>`}
        </div>`:'';

        // Active series chips (with inline × to remove)
        const chipsHtml=selKeys.length?`
          <div style="padding:5px 10px;display:flex;flex-wrap:wrap;gap:4px;border-bottom:1px solid #252525;background:#161616;flex-shrink:0">
            ${selKeys.map((k:string)=>{const meta=allSeries.find((s:any)=>s.key===k);if(!meta)return'';return`<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border:1px solid ${meta.color}44;background:${meta.color}11;font-size:9px;color:${meta.color};letter-spacing:.05em"><span style="width:10px;height:2px;background:${meta.color};display:inline-block;flex-shrink:0"></span>${meta.label}<span onclick="window._gcseries_${wid}('${panel.id}','${k}')" style="color:${meta.color}aa;cursor:pointer;margin-left:2px;font-size:11px;line-height:1;padding:0 1px" onmouseenter="this.style.color='${meta.color}'" onmouseleave="this.style.color='${meta.color}aa'">×</span></span>`;}).join('')}
          </div>`:'';

        // Legend footer
        const legendHtml=selKeys.length?`
          <div style="padding:4px 10px;display:flex;flex-wrap:wrap;gap:10px;border-top:1px solid #252525;background:#161616;flex-shrink:0">
            ${selKeys.map((k:string)=>{const meta=allSeries.find((s:any)=>s.key===k);if(!meta)return'';return`<span style="font-size:9px;color:${meta.color};letter-spacing:.05em;display:inline-flex;align-items:center;gap:4px"><span style="width:16px;height:2px;background:${meta.color};display:inline-block"></span>${meta.label}</span>`;}).join('')}
          </div>`:'';

        panelSlotsHtml+=`
          <div style="flex:1;min-height:260px;display:flex;flex-direction:column;border-top:1px solid #2c2c2c">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;flex-shrink:0;background:#1a1a1a;border-bottom:1px solid #2c2c2c;gap:6px">
              <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;min-width:0">
                <span style="font-size:9px;color:#e2e8f0;letter-spacing:.12em;font-weight:700;white-space:nowrap">${panel.label}</span>
                <select onchange="window._gctype_${wid}('${panel.id}',this.value)" style="background:#111;border:1px solid #3a3a3a;color:#c0c8d8;font-size:9px;padding:2px 5px;font-family:inherit;outline:none;cursor:pointer;letter-spacing:.04em">
                  <option value="timeseries"${chartType==='timeseries'?' selected':''}>LINE</option>
                  <option value="seasonal"${chartType==='seasonal'?' selected':''}>SEASONAL</option>
                  <option value="spread"${chartType==='spread'?' selected':''}>SPREAD</option>
                </select>
                <div style="display:flex;gap:2px">${['1Y','2Y','5Y','ALL'].map(t=>`<span onclick="window._gctime_${wid}('${panel.id}','${t}')" style="font-size:9px;padding:1px 6px;cursor:pointer;border:1px solid ${timeRange===t?'#60a5fa':'#3a3a3a'};color:${timeRange===t?'#60a5fa':'#8791a1'};letter-spacing:.04em;user-select:none">${t}</span>`).join('')}</div>
                <div style="position:relative">
                  <span onclick="window._gcedit_${wid}('${panel.id}')" style="font-size:9px;padding:2px 8px;cursor:pointer;border:1px solid ${editOpen?'#4ade80':'#3a3a3a'};color:${editOpen?'#4ade80':'#c0c8d8'};letter-spacing:.05em;user-select:none;transition:border-color .12s,color .12s">+ SERIES</span>
                  ${pickerDd}
                </div>
              </div>
              <span style="color:#666;cursor:pointer;font-size:15px;line-height:1;padding:0 3px;flex-shrink:0;transition:color .1s" onmouseenter="this.style.color='#e2e8f0'" onmouseleave="this.style.color='#666'" onclick="window._gcx_${wid}('${panel.id}')">×</span>
            </div>
            ${chipsHtml}
            <div style="flex:1;position:relative;min-height:0"><div id="${chartId}" style="position:absolute;inset:0"></div></div>
            ${legendHtml}
          </div>`;
      } else {
        // Standard panel (timeseries / seasonal / spread)
        panelSlotsHtml+=`
          <div style="flex:1;min-height:160px;display:flex;flex-direction:column;border-top:1px solid #2c2c2c">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;flex-shrink:0;background:#1a1a1a;border-bottom:1px solid #2c2c2c">
              <span style="font-size:9px;color:#e2e8f0;letter-spacing:.12em;font-weight:600">${panel.label}</span>
              <span style="color:#666;cursor:pointer;font-size:15px;line-height:1;padding:0 3px;transition:color .1s" onmouseenter="this.style.color='#e2e8f0'" onmouseleave="this.style.color='#666'" onclick="window._gcx_${wid}('${panel.id}')">×</span>
            </div>
            <div style="flex:1;position:relative;min-height:0"><div id="${chartId}" style="position:absolute;inset:0"></div></div>
          </div>`;
      }
    });

    // Dropdown
    const ddHtml=addDdOpen?`
      <div style="position:absolute;bottom:calc(100% + 4px);right:0;background:#1a1a1a;border:1px solid #3a3a3a;min-width:240px;z-index:200;box-shadow:0 -8px 24px rgba(0,0,0,.8)">
        ${available.length?available.map((p:Panel)=>`<div style="padding:8px 14px;font-size:9px;color:#a0aab8;letter-spacing:.08em;cursor:pointer;border-bottom:1px solid #252525" onmouseenter="this.style.color='#e2e8f0';this.style.background='#222'" onmouseleave="this.style.color='#a0aab8';this.style.background=''" onclick="window._gcadd_${wid}('${p.id}')">${p.label}</div>`).join(''):
        `<div style="padding:8px 14px;font-size:9px;color:#555;letter-spacing:.08em">ALL PANELS ACTIVE</div>`}
      </div>`:'';

    // Footer spread
    const spreadHtml=sp!=null?`<span style="font-size:9px;color:#8791a1;letter-spacing:.05em">M1-M12</span> <span style="font-size:9px;color:${sp>0?'#f87171':'#4ade80'};font-weight:600">${sp>0?'+':''}${sp}%</span>`:'';

    tbody.innerHTML=`
      <div style="display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden">
        <div style="flex:1;display:flex;flex-direction:column;overflow-y:auto;min-height:0">
          <div style="flex:1;min-height:220px;display:flex;flex-direction:column">
            <div class="gc-hdr">
              <span>${lbl} FORWARD CURVE · ${curve.unit||''}</span>
              <span class="gc-hdr-right">${pts.length} contracts</span>
            </div>
            ${stripHtml}
            <div style="flex:1;position:relative;min-height:0"><div id="${cid}" style="position:absolute;inset:0"></div></div>
          </div>
          ${panelSlotsHtml}
        </div>
        <div style="flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:5px 10px;border-top:1px solid #2c2c2c;background:#161616;min-height:28px">
          <div>${spreadHtml}</div>
          <div style="position:relative">
            ${ddHtml}
            <button onclick="window._gctogdd_${wid}()" style="font-size:9px;color:${addDdOpen?'#e2e8f0':'#c0c8d8'};background:none;border:1px solid ${addDdOpen?'#3a3a3a':'#3a3a3a'};padding:3px 10px;cursor:pointer;letter-spacing:.08em;font-family:inherit;transition:color .12s,border-color .12s">+ ADD PANEL ▾</button>
          </div>
        </div>
      </div>`;

    // Render curve chart
    requestAnimationFrame(()=>{
      const cEl=document.getElementById(cid);
      if(cEl&&pxData.length)createChart(cid,{container:cEl,categories:labels,
        series:[{type:'line',data:pxData.map((v:number,i:number)=>({time:i,value:v})),color:col,lineWidth:2.5}]});
      panels.forEach((panel:Panel)=>{
        const el2=document.getElementById(`gc-panel-${panel.id}-${wid}`);
        if(el2)_renderPanel(panel,el2,eiaData);
      });
    });

    (window as any)[`_gcx_${wid}`]=(pid:string)=>{
      ws.panels=ws.panels.filter((p:Panel)=>p.id!==pid);
      destroyChart(`gc-panel-${pid}-${wid}`);
      ws.addDdOpen=false;
      _renderWorkspace(key);
    };
    (window as any)[`_gcadd_${wid}`]=(pid:string)=>{
      const p=registry.find((r:Panel)=>r.id===pid);
      if(p&&!ws.panels.find((x:Panel)=>x.id===pid)){
        // Clone panel so custom config mutations (_selected, _editOpen) are per-instance
        ws.panels.push({...p,config:p.config?{...p.config}:undefined});
        ws.addDdOpen=false;_renderWorkspace(key);
      }
    };
    (window as any)[`_gctogdd_${wid}`]=()=>{ws.addDdOpen=!ws.addDdOpen;_renderWorkspace(key);};
    (window as any)[`_gcedit_${wid}`]=(pid:string)=>{
      const panel=ws.panels.find((p:Panel)=>p.id===pid);
      if(panel?.config)panel.config._editOpen=!panel.config._editOpen;
      _renderWorkspace(key);
    };
    (window as any)[`_gcseries_${wid}`]=(pid:string,serKey:string)=>{
      const panel=ws.panels.find((p:Panel)=>p.id===pid);
      if(!panel?.config)return;
      if(!panel.config._selected)panel.config._selected=[...(panel.config._defaults||[])];
      const sel:string[]=panel.config._selected;
      const idx=sel.indexOf(serKey);
      if(idx>=0)sel.splice(idx,1);
      else{sel.push(serKey);panel.config._editOpen=false;} // auto-close picker on add
      _renderWorkspace(key);
    };
    (window as any)[`_gctype_${wid}`]=(pid:string,type:string)=>{
      const panel=ws.panels.find((p:Panel)=>p.id===pid);
      if(panel?.config)panel.config._chartType=type;
      _renderWorkspace(key);
    };
    (window as any)[`_gctime_${wid}`]=(pid:string,range:string)=>{
      const panel=ws.panels.find((p:Panel)=>p.id===pid);
      if(panel?.config)panel.config._timeRange=range;
      _renderWorkspace(key);
    };
  }

  function _renderPanel(panel:Panel,el2:HTMLElement,data:any){
    if(!data?.ok){
      el2.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:9px;color:#222;letter-spacing:.1em">NO DATA</div>`;
      return;
    }
    if(panel.kpi){_renderKpi(panel,el2,data);return;}
    const toDate=(p:string)=>{if(!p)return'';if(p.length===6)return p.slice(0,4)+'-'+p.slice(4,6)+'-01';if(p.length===7)return p+'-01';return p;};
    // Custom panel: multi-series chart built from SERIES_CATALOG + user selection
    if(panel.type==='custom'){
      const catalog:string=panel.config?._catalog||'';
      const allSeries=SERIES_CATALOG[catalog]||[];
      if(panel.config&&!panel.config._selected)panel.config._selected=[...(panel.config._defaults||[])];
      const selected:string[]=(panel.config?._selected||[]) as string[];
      const timeRange:string=panel.config?._timeRange||'ALL';
      const chartType:string=panel.config?._chartType||'timeseries';
      // Cutoff date for time range
      const _n=new Date();
      const cutoff=timeRange==='1Y'?new Date(_n.getFullYear()-1,_n.getMonth(),_n.getDate()).toISOString().slice(0,10):
        timeRange==='2Y'?new Date(_n.getFullYear()-2,_n.getMonth(),_n.getDate()).toISOString().slice(0,10):
        timeRange==='5Y'?new Date(_n.getFullYear()-5,_n.getMonth(),_n.getDate()).toISOString().slice(0,10):'';
      const customArr:any[]=[];
      let addedSeasonal=false;
      for(const k of selected){
        const meta=allSeries.find((s:any)=>s.key===k);if(!meta)continue;
        const raw=_dGet(data,k);if(!raw)continue;
        let h=raw.history||[];if(!h.length)continue;
        if(cutoff)h=h.filter((r:any)=>{const t=toDate(r.period||r.time);return t>=cutoff;});
        if(!h.length)continue;
        // Auto-assign axis: prices + utilization% → right, volumes/stocks → left
        const axis:('left'|'right')=k.startsWith('prices.')||k.endsWith('Pct')||k.includes('utilization')?'right':'left';
        if(chartType==='seasonal'&&!addedSeasonal&&h.some((r:any)=>r.min5yr!=null)){
          customArr.push({type:'band',data:h.filter((r:any)=>r.max5yr!=null).map((r:any)=>({time:toDate(r.period||r.time),value:r.max5yr})),bandMin:h.filter((r:any)=>r.min5yr!=null).map((r:any)=>({time:toDate(r.period||r.time),value:r.min5yr})),color:meta.color});
          customArr.push({type:'area',data:h.map((r:any)=>({time:toDate(r.period||r.time),value:r.value})),color:meta.color});
          customArr.push({type:'line',data:h.filter((r:any)=>r.avg5yr!=null).map((r:any)=>({time:toDate(r.period||r.time),value:r.avg5yr})),color:'#3a3a3a',dashed:true,lineWidth:1});
          addedSeasonal=true;
        } else if(chartType==='spread'){
          customArr.push({type:'histogram',data:h.map((r:any)=>({time:toDate(r.period||r.time),value:r.value,color:r.value>=0?'rgba(74,222,128,.65)':'rgba(248,113,113,.65)'})),color:'#888'});
        } else {
          customArr.push({type:'line',data:h.map((r:any)=>({time:toDate(r.period||r.time),value:r.value})),color:meta.color,lineWidth:1.5,axis});
        }
      }
      if(customArr.length)createChart(el2.id,{container:el2,timeVisible:true,series:customArr});
      else el2.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:9px;color:#222;letter-spacing:.1em">NO DATA</div>`;
      return;
    }
    const seriesArr:any[]=[];
    for(const ds of panel.datasets){
      const raw=_dGet(data,ds.key);
      if(!raw)continue;
      if(panel.type==='seasonal'){
        const h=raw.history||[];if(!h.length)continue;
        seriesArr.push({type:'band',data:h.filter((r:any)=>r.max5yr!=null).map((r:any)=>({time:toDate(r.period),value:r.max5yr})),bandMin:h.filter((r:any)=>r.min5yr!=null).map((r:any)=>({time:toDate(r.period),value:r.min5yr})),color:ds.color});
        seriesArr.push({type:'area',data:h.map((r:any)=>({time:toDate(r.period),value:r.value})),color:ds.color});
        seriesArr.push({type:'line',data:h.filter((r:any)=>r.avg5yr!=null).map((r:any)=>({time:toDate(r.period),value:r.avg5yr})),color:'#3a3a3a',dashed:true,lineWidth:1});
      } else if(panel.type==='spread'){
        const h=raw.history||[];if(!h.length)continue;
        seriesArr.push({type:'histogram',data:h.map((r:any)=>({time:toDate(r.period||r.time),value:r.value,color:r.value>=0?'rgba(74,222,128,.65)':'rgba(248,113,113,.65)'})),color:'#888'});
      } else {
        const h=raw.history||[];if(!h.length)continue;
        seriesArr.push({type:'line',data:h.map((r:any)=>({time:toDate(r.period||r.time),value:r.value})),color:ds.color,lineWidth:ds.lineWidth||1.5,dashed:!!ds.dashed});
      }
    }
    if(seriesArr.length)createChart(el2.id,{container:el2,timeVisible:true,series:seriesArr});
    else el2.innerHTML=`<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:9px;color:#222;letter-spacing:.1em">NO DATA</div>`;
  }

  function _renderKpi(panel:Panel,el2:HTMLElement,data:any){
    const ds=panel.datasets[0];
    const raw=_dGet(data,ds.key)||{};
    const val=raw.value??raw.value_bcfd;
    const sigCol=raw.signalDir==='bullish'?'#4ade80':'#f87171';
    el2.innerHTML=`<div style="padding:12px;display:flex;flex-direction:column;gap:3px">
      <div style="color:${ds.color};font-size:15px;font-weight:600;letter-spacing:-.01em">${val!=null?Number(val).toLocaleString('en-US',{maximumFractionDigits:2}):'—'}</div>
      ${raw.signal?`<div style="color:${sigCol};font-size:9px;font-weight:700;letter-spacing:.1em">${raw.signal}</div>`:''}
      ${raw.surplusPct!=null?`<div style="font-size:9px;color:${raw.surplusPct>=0?'#f87171':'#4ade80'}">${raw.surplusPct>=0?'+':''}${raw.surplusPct.toFixed(1)}% vs 5yr avg</div>`:''}
      ${raw.zScore!=null?`<div style="font-size:9px;color:#3a3a3a">${raw.zScore>=0?'+':''}${raw.zScore.toFixed(2)}σ</div>`:''}
      <div style="font-size:8px;color:#252525;margin-top:2px">${raw.asOf||''}</div>
    </div>`;
  }

  // Build tab bar
  el.innerHTML=`
    <div class="ctabs" id="gc-tabs-${wid}">
      <button class="pb active" data-c="TREASURY" onclick="window._gct_${wid}('TREASURY')">US TREASURY</button>
      ${COMMOD_KEYS.map(k=>`<button class="pb" data-c="${k}" onclick="window._gct_${wid}('${k}')">${COMMOD_LABELS[k]}</button>`).join('')}
    </div>
    <div id="gc-body" style="flex:1;overflow:auto;display:flex;flex-direction:column">${ld('Loading…')}</div>
  `;

  (window as any)[`_gct_${wid}`]=(c:string)=>{
    active=c;
    gcKillAll();
    document.querySelectorAll(`#gc-tabs-${wid} .pb`).forEach(b=>b.classList.toggle('active',(b as any).dataset.c===c));
    if(c==='TREASURY')renderTreasury();
    else renderCommod(c);
  };
  renderTreasury();
}

// ══════════════════════════════════════════════
//  SOVG — WORLDWIDE SOVEREIGN BOND MONITOR
//  Bloomberg-style SOVG / WB / GOVT commands
// ══════════════════════════════════════════════

// Rating → CSS class
