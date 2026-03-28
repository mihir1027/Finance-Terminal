// ══════════════════════════════════════════════════════
//  QUOTE MONITOR — full rebuild with persistence,
//  live refresh, flash ticks, sorting, col picker
// ══════════════════════════════════════════════════════
import { ow, onWindowClosed, getWins } from '../../core/windowManager.js';
import { API, fp, fl, fv, cd, pill, ld } from '../../core/utils.js';

// ── State ────────────────────────────────────────────
export let qmWinId = null;
export let qmData  = {};        // ticker → {price,bid,ask,pct,vol,lat,high,low,open,mktcap,name}
export let qmPrev  = {};        // previous prices for flash detection
export let qmSortKey = 'ticker';
export let qmSortDir = 1;       // 1=asc, -1=desc
export let qmRefreshTimer = null;
export let qmCountdown = 30;
export let qmPaused = false;
export let qmCols = {ticker:true,last:true,chg:true,pctchg:true,bid:true,ask:true,volume:true,high:true,low:true,open:true,mktcap:false,name:false,spark:true,latency:true};
export let activeWL = 'List'; // legacy — kept for batch overlay fallback
export const qmAWL = {};  // per-window active watchlist: id → key
export let _lastQMId = null;
export function getAWL(id){ return qmAWL[id] || getWLOrder()[0] || Object.keys(watchlists)[0] || 'List'; }
export function setAWL(id, wl){ qmAWL[id]=wl; activeWL=wl; _lastQMId=id; }
// Clean up QM state when any window closes
onWindowClosed(id => { delete qmAWL[id]; if(_lastQMId===id) _lastQMId=null; });
// watchlists persisted to localStorage — each entry: {name, tickers[]}
export let watchlists = {};

// ── Persistence helpers ─────────────────────────────
export const LS_WL_KEY  = 'kt_watchlists_v2';
export const LS_COL_KEY = 'kt_qm_cols_v1';
export const LS_WL_ORD  = 'kt_wl_order_v1';

export function saveWatchlists(){
  try{ localStorage.setItem(LS_WL_KEY, JSON.stringify(watchlists)); }catch(e){}
}
export function loadWatchlists(){
  try{
    const raw = localStorage.getItem(LS_WL_KEY);
    if(raw){
      watchlists = JSON.parse(raw);
      return;
    }
  }catch(e){}
  // Default watchlists on first load
  watchlists = {
    List:    { name:'List',    tickers:['ADBE','ARKK','ERII','IGV','LTH','LYFT','MELI','PLNT','RDDT','TCPC','UBER','WDAY'] },
    Crypto:  { name:'Crypto',  tickers:['BTC-USD','ETH-USD','SOL-USD','BNB-USD','AVAX-USD'] },
    Futs:    { name:'Futs',    tickers:['ES=F','NQ=F','YM=F','CL=F','GC=F','NG=F'] },
    Main:    { name:'Main',    tickers:['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','V','SPY'] },
    Indices: { name:'Indices', tickers:['^GSPC','^DJI','^IXIC','^RUT','^VIX','^TNX'] },
  };
  saveWatchlists();
}
export function saveColPrefs(){
  try{ localStorage.setItem(LS_COL_KEY, JSON.stringify(qmCols)); }catch(e){}
}
export function loadColPrefs(){
  try{
    const raw = localStorage.getItem(LS_COL_KEY);
    if(raw){ qmCols = {...qmCols, ...JSON.parse(raw)}; }
  }catch(e){}
}
export function getWLOrder(){
  try{
    const raw = localStorage.getItem(LS_WL_ORD);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return Object.keys(watchlists);
}
export function saveWLOrder(order){
  try{ localStorage.setItem(LS_WL_ORD, JSON.stringify(order)); }catch(e){}
}

// Initialise on load
loadWatchlists();
loadColPrefs();

// ── QM column definitions ────────────────────────────
export const QM_COLS = [
  { key:'ticker',  label:'TICKER',   align:'left',  sortFn: r=>r.sym },
  { key:'name',    label:'NAME',     align:'left',  sortFn: r=>r.name||'' },
  { key:'last',    label:'LAST',     align:'right', sortFn: r=>r.price??-Infinity },
  { key:'chg',     label:'CHG',      align:'right', sortFn: r=>r.change??-Infinity },
  { key:'pctchg',  label:'CHG %',    align:'right', sortFn: r=>r.pct??-Infinity },
  { key:'bid',     label:'BID',      align:'right', sortFn: r=>r.bid??-Infinity },
  { key:'ask',     label:'ASK',      align:'right', sortFn: r=>r.ask??-Infinity },
  { key:'open',    label:'OPEN',     align:'right', sortFn: r=>r.open??-Infinity },
  { key:'high',    label:'HIGH',     align:'right', sortFn: r=>r.high??-Infinity },
  { key:'low',     label:'LOW',      align:'right', sortFn: r=>r.low??-Infinity },
  { key:'volume',  label:'VOLUME',   align:'right', sortFn: r=>r.vol??-Infinity },
  { key:'mktcap',  label:'MKT CAP',  align:'right', sortFn: r=>r.mktcap??-Infinity },
  { key:'spark',   label:'TREND',    align:'center',sortFn: null },
  { key:'latency', label:'LATENCY',  align:'right', sortFn: r=>r.lat??-Infinity },
];

// ── Open / focus QM ─────────────────────────────────
export function openQM(){
  qmWinId=ow('qm',null,'Quote Monitor',560,420,(el,_,id)=>buildQM(el,id));
}

// ── Build QM window ──────────────────────────────────
export function buildQM(el, id){
  setAWL(id, getWLOrder()[0] || Object.keys(watchlists)[0] || 'List');

  el.innerHTML=`
    <div class="qm-tabs" id="qtabs-${id}"></div>
    <div class="qm-toolbar" id="qtbar-${id}">
      <button class="qm-tb-btn" onclick="qmAddRow('${id}')" title="Add ticker">＋ ADD</button>
      <button class="qm-tb-btn" onclick="document.getElementById('batch-ov').classList.add('open')" title="Batch import">BATCH</button>
      <button class="qm-tb-btn" id="qm-sort-btn-${id}" onclick="qmCycleSortUI('${id}')" title="Sort options">SORT</button>
      <button class="qm-tb-btn" onclick="qmOpenColPicker('${id}')" title="Column visibility">COLS ▾</button>
      <button class="qm-tb-btn" id="qm-pause-btn-${id}" onclick="qmTogglePause('${id}')" title="Pause/resume auto-refresh">⏸ PAUSE</button>
      <div class="qm-status-area">
        <div class="qm-live-dot" id="qm-dot-${id}"></div>
        <span id="qm-status-txt-${id}" style="font-size:8px;color:var(--dim)">Loading…</span>
        <span id="qm-count-${id}" class="qm-countdown" title="Next refresh in..."></span>
      </div>
    </div>
    <div class="qm-scroll">
      <table class="qmt" id="qtbl-${id}">
        <thead id="qhead-${id}"></thead>
        <tbody id="qtbody-${id}"></tbody>
      </table>
    </div>
    <div class="qm-foot">
      <span class="qadd" onclick="qmAddRow('${id}')">＋ Add a new ticker</span>
      <span style="color:var(--bdr2)">|</span>
      <span class="qbatch" onclick="document.getElementById('batch-ov').classList.add('open')">Batch Import</span>
      <span style="margin-left:auto;font-size:8px;color:var(--dim)" id="qm-count-label-${id}"></span>
    </div>
    <div id="qadd-row-${id}" style="display:none;padding:4px 8px;border-top:1px solid var(--bdr)">
      <span style="font-size:9px;color:var(--dim);margin-right:6px">TICKER:</span>
      <input class="qadd-inp" id="qadd-inp-${id}" type="text" placeholder="e.g. AAPL, BTC-USD, GC=F" onkeydown="qmAddKey(event,'${id}')">
      <span style="font-size:8px;color:var(--dim);margin-left:8px">[ENTER] add · [ESC] cancel</span>
    </div>
  `;

  renderQMTabs(id);
  renderQMHeader(id);
  renderQMT(id);
  qmRefreshAll(id);
  qmStartAutoRefresh(id);
}

// ── Render tab bar ───────────────────────────────────
export function renderQMTabs(id){
  const bar = document.getElementById(`qtabs-${id}`); if(!bar) return;
  const order = getWLOrder().filter(k => watchlists[k]);
  bar.innerHTML = order.map(wl => `
    <button class="qt${wl===getAWL(id)?' active':''}" id="qtt-${id}-${wl}"
      onclick="qmTabClick(event,'${id}','${wl}')"
      ondblclick="qmRenameTab('${id}','${wl}')"
      title="Double-click to rename">
      ${watchlists[wl]?.name||wl}
      <span class="qt-close-x" onclick="event.stopPropagation();qmDeleteWL('${id}','${wl}')">✕</span>
    </button>
  `).join('') + `<button class="qt add-wl" onclick="qmNewWL('${id}')" title="New watchlist">＋</button>`;
}

export function qmTabClick(e, id, wl){
  if(e.target.classList.contains('qt-close-x')) return;
  setAWL(id, wl);
  renderQMTabs(id);
  renderQMHeader(id);
  renderQMT(id);
  qmRefreshAll(id);
}

export function qmNewWL(id){
  const name = prompt('Watchlist name:');
  if(!name) return;
  const key = name.trim().replace(/\s+/g,'_').toUpperCase();
  if(watchlists[key]){ alert('Already exists'); return; }
  watchlists[key] = { name: name.trim(), tickers:[] };
  const order = getWLOrder(); order.push(key); saveWLOrder(order);
  saveWatchlists();
  setAWL(id, key);
  renderQMTabs(id);
  renderQMHeader(id);
  renderQMT(id);
}

export function qmDeleteWL(id, wl){
  if(Object.keys(watchlists).length <= 1){ alert('Cannot delete the last watchlist.'); return; }
  if(!confirm(`Delete watchlist "${watchlists[wl]?.name||wl}"?`)) return;
  delete watchlists[wl];
  const order = getWLOrder().filter(k=>k!==wl); saveWLOrder(order);
  saveWatchlists();
  setAWL(id, order[0] || Object.keys(watchlists)[0]);
  renderQMTabs(id);
  renderQMHeader(id);
  renderQMT(id);
  qmRefreshAll(id);
}

export function qmRemoveTicker(sym, id){
  const wl = watchlists[getAWL(id)];
  if(!wl) return;
  wl.tickers = wl.tickers.filter(t => t !== sym);
  saveWatchlists();
  delete qmData[sym];
  renderQMT(id);
}

export function qmRenameTab(id, wl){
  const el = document.getElementById(`qtt-${id}-${wl}`);
  if(!el) return;
  const cur = watchlists[wl]?.name || wl;
  const inp = document.createElement('input');
  inp.className = 'qt-rename';
  inp.value = cur;
  inp.style.cssText = 'background:transparent;border:none;border-bottom:1px solid var(--green);color:var(--text);font-family:var(--font);font-size:9px;width:70px;outline:none;padding:0 2px;';
  el.innerHTML = '';
  el.appendChild(inp);
  inp.focus(); inp.select();
  const done = () => {
    const val = inp.value.trim();
    if(val && watchlists[wl]){ watchlists[wl].name = val; saveWatchlists(); }
    renderQMTabs(id);
  };
  inp.addEventListener('keydown', e => { if(e.key==='Enter') done(); if(e.key==='Escape') renderQMTabs(id); });
  inp.addEventListener('blur', done);
}

// ── Render table header ──────────────────────────────
export function renderQMHeader(id){
  const head = document.getElementById(`qhead-${id}`); if(!head) return;
  const cols = QM_COLS.filter(c => qmCols[c.key]);
  head.innerHTML = `<tr>${cols.map(c=>{
    const isSorted = qmSortKey === c.key;
    const sortCls  = isSorted ? (qmSortDir===1?' sort-asc':' sort-desc') : '';
    return `<th class="${sortCls}" style="text-align:${c.align}" onclick="qmSortBy('${id}','${c.key}')">${c.label}</th>`;
  }).join('')}<th></th></tr>`;
}

// ── Sort ─────────────────────────────────────────────
export function qmSortBy(id, key){
  if(qmSortKey===key) qmSortDir *= -1;
  else { qmSortKey=key; qmSortDir = key==='ticker'||key==='name' ? 1 : -1; }
  renderQMHeader(id);
  renderQMT(id);
}
export function qmCycleSortUI(id){
  // Quick sort cycle: by ticker → by chg% desc → by volume desc → by ticker
  const cycle = ['ticker','pctchg','volume'];
  const ci = cycle.indexOf(qmSortKey);
  const next = cycle[(ci+1)%cycle.length];
  qmSortKey = next;
  qmSortDir = next==='ticker' ? 1 : -1;
  renderQMHeader(id);
  renderQMT(id);
}

// ── Column picker ────────────────────────────────────
export function qmOpenColPicker(id){
  let picker = document.getElementById('col-picker');
  if(!picker){
    picker = document.createElement('div');
    picker.id = 'col-picker';
    document.body.appendChild(picker);
    document.addEventListener('click', e=>{
      if(!picker.contains(e.target)&&!e.target.closest('.qm-tb-btn')) picker.classList.remove('open');
    });
  }
  picker.innerHTML = `<h4 style="font-size:8px;letter-spacing:.15em;color:var(--dim);margin-bottom:8px;">SHOW COLUMNS</h4>` +
    QM_COLS.filter(c=>c.key!=='ticker').map(c=>`
      <div class="cpr" onclick="qmToggleCol('${id}','${c.key}')">
        <div class="cpc">${qmCols[c.key]?'✓':''}</div>
        <span>${c.label}</span>
      </div>`).join('');
  const btn = document.querySelector(`#qtbar-${id} .qm-tb-btn:nth-child(4)`);
  if(btn){
    const r=btn.getBoundingClientRect();
    picker.style.top=(r.bottom+4)+'px';
    picker.style.left=r.left+'px';
  }
  picker.classList.toggle('open');
}
export function qmToggleCol(id, key){
  if(key==='ticker') return;
  qmCols[key] = !qmCols[key];
  saveColPrefs();
  const picker = document.getElementById('col-picker');
  if(picker) picker.querySelectorAll('.cpc').forEach((el,i)=>{
    const colKey = QM_COLS.filter(c=>c.key!=='ticker')[i]?.key;
    if(colKey) el.textContent = qmCols[colKey]?'✓':'';
  });
  renderQMHeader(id);
  renderQMT(id);
}

// ── Auto-refresh ─────────────────────────────────────
export function qmStartAutoRefresh(id){
  clearInterval(qmRefreshTimer);
  qmCountdown = 30;
  qmRefreshTimer = setInterval(()=>{
    if(qmPaused){ updateQMCountdown(id); return; }
    qmCountdown--;
    updateQMCountdown(id);
    if(qmCountdown<=0){
      qmCountdown=30;
      qmRefreshAll(id);
    }
  }, 1000);
}
export function updateQMCountdown(id){
  const el=document.getElementById(`qm-count-${id}`);
  const lbl=document.getElementById(`qm-count-label-${id}`);
  if(el){
    if(qmPaused){ el.textContent='PAUSED'; el.style.color='var(--amber)'; }
    else{ el.textContent=`${qmCountdown}s`; el.style.color=qmCountdown<8?'var(--amber)':'var(--green)'; }
  }
  if(lbl) lbl.textContent=qmPaused?'Auto-refresh paused':`${Object.keys(qmData).length} instruments tracked`;
}
export function qmTogglePause(id){
  qmPaused=!qmPaused;
  const btn=document.getElementById(`qm-pause-btn-${id}`);
  const dot=document.getElementById(`qm-dot-${id}`);
  if(btn){ btn.textContent=qmPaused?'▶ RESUME':'⏸ PAUSE'; btn.classList.toggle('on',qmPaused); }
  if(dot){ dot.classList.toggle('stale',qmPaused); }
  updateQMCountdown(id);
}

// ── Render rows ──────────────────────────────────────
export function renderQMT(id){
  const tbody=document.getElementById(`qtbody-${id}`); if(!tbody) return;
  const tks=(watchlists[getAWL(id)]?.tickers)||[];
  if(!tks.length){
    tbody.innerHTML=`<tr><td colspan="20" style="text-align:center;padding:24px;color:var(--dim);font-size:10px">
      No tickers in this watchlist.<br><span style="font-size:8px;margin-top:4px;display:block">Click <b style="color:var(--green)">＋ ADD</b> below to start tracking</span>
    </td></tr>`;
    return;
  }

  // Build data rows
  let rows = tks.map(sym => ({ sym, ...(qmData[sym]||{}) }));

  // Sort
  const col = QM_COLS.find(c=>c.key===qmSortKey);
  if(col?.sortFn){
    rows.sort((a,b)=>{
      const av=col.sortFn(a), bv=col.sortFn(b);
      if(av==null||av===-Infinity) return 1;
      if(bv==null||bv===-Infinity) return -1;
      if(typeof av==='string') return qmSortDir*(av.localeCompare(bv));
      return qmSortDir*(av-bv);
    });
  }

  const activeCols = QM_COLS.filter(c=>qmCols[c.key]);

  tbody.innerHTML = rows.map(r=>{
    const dir = r.pct!=null ? (r.pct>0?'up':r.pct<0?'down':'flat') : '';
    const s   = r.pct>=0?'+':'';
    const dec = r.price!=null ? (r.price>=1000?0:r.price>=10?2:r.price>=1?3:4) : 2;

    const cells = activeCols.map(c=>{
      switch(c.key){
        case 'ticker':  return `<td onclick="runCmd('${r.sym.replace(/'/g,"\\'")} DES')">${r.sym}</td>`;
        case 'name':    return `<td style="color:var(--dim);font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">${r.name||'—'}</td>`;
        case 'last':    return `<td class="${dir}" style="font-weight:700">${r.price!=null?fp(r.price,dec):'<span style="color:var(--dim)">—</span>'}</td>`;
        case 'chg':     return `<td class="${dir}">${r.change!=null?(r.change>=0?'+':'')+fp(r.change,dec):'<span style="color:var(--dim)">—</span>'}</td>`;
        case 'pctchg':  return `<td class="${dir}">${r.pct!=null?s+r.pct.toFixed(2)+'%':'<span style="color:var(--dim)">—</span>'}</td>`;
        case 'bid':     return `<td style="color:var(--dim)">${r.bid!=null?fp(r.bid,dec):'<span style="opacity:.4">—</span>'}</td>`;
        case 'ask':     return `<td style="color:var(--dim)">${r.ask!=null?fp(r.ask,dec):'<span style="opacity:.4">—</span>'}</td>`;
        case 'open':    return `<td style="color:var(--dim)">${r.open!=null?fp(r.open,dec):'—'}</td>`;
        case 'high':    return `<td class="up">${r.high!=null?fp(r.high,dec):'—'}</td>`;
        case 'low':     return `<td class="down">${r.low!=null?fp(r.low,dec):'—'}</td>`;
        case 'volume':  return `<td style="color:var(--dim)">${r.vol!=null?fv(r.vol):'—'}</td>`;
        case 'mktcap':  return `<td style="color:var(--dim)">${r.mktcap!=null?fl(r.mktcap):'—'}</td>`;
        case 'spark':   return `<td><canvas id="spk-qm-${r.sym.replace(/[^a-z0-9]/gi,'')}" width="72" height="20" style="vertical-align:middle"></canvas></td>`;
        case 'latency': return `<td style="color:var(--dim);font-size:11px">${r.lat!=null?r.lat+'ms':'—'}</td>`;
        default: return '<td>—</td>';
      }
    }).join('');

    const delCell = `<td class="qm-del" onclick="event.stopPropagation();qmRemoveTicker('${r.sym.replace(/'/g,"\'")}','${id}')" title="Remove ${r.sym}">&#215;</td>`;
    return `<tr class="qmr" id="qmr-${r.sym.replace(/[^a-z0-9]/gi,'')}">${cells}${delCell}</tr>`;
  }).join('');

  // Draw sparklines after DOM settles
  requestAnimationFrame(()=>{
    rows.forEach(r=>{
      if(!qmCols.spark) return;
      const hist = r.hist||[];
      if(hist.length<2) return;
      const cid=`spk-qm-${r.sym.replace(/[^a-z0-9]/gi,'')}`;
      const canvas=document.getElementById(cid); if(!canvas) return;
      const ctx=canvas.getContext('2d');
      const mn=Math.min(...hist),mx=Math.max(...hist),rng=mx-mn||0.001;
      const col=(r.pct||0)>=0?'#4ade80':'#f87171';
      ctx.clearRect(0,0,72,20);
      ctx.strokeStyle=col; ctx.lineWidth=1.2;
      ctx.shadowColor=col; ctx.shadowBlur=2;
      ctx.beginPath();
      hist.forEach((v,i)=>{
        const x=(i/(hist.length-1))*70+1;
        const y=20-((v-mn)/rng)*17-1.5;
        i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      });
      ctx.stroke();
    });
  });
}

// ── Fetch prices for active watchlist ────────────────
export async function qmRefreshAll(id){
  const tks=(watchlists[getAWL(id)]?.tickers)||[];
  if(!tks.length) return;
  const dot=document.getElementById(`qm-dot-${id}`);
  const statusTxt=document.getElementById(`qm-status-txt-${id}`);
  if(statusTxt) statusTxt.textContent='Refreshing…';
  qmCountdown=30;

  // Fetch all in parallel
  const fetches = tks.map(async sym => {
    const t0=Date.now();
    try{
      const r=await fetch(`${API}/quote/${sym}`).then(x=>x.json());
      if(!r.ok) return;
      const prev = qmPrev[sym];
      const newPrice = r.price;
      // Flash detection
      if(prev!=null && newPrice!=null && newPrice!==prev){
        const rowId=`qmr-${sym.replace(/[^a-z0-9]/gi,'')}`;
        const row=document.getElementById(rowId);
        if(row){
          row.classList.remove('flash-up','flash-dn');
          void row.offsetWidth;
          row.classList.add(newPrice>prev?'flash-up':'flash-dn');
          setTimeout(()=>row.classList.remove('flash-up','flash-dn'),700);
        }
      }
      qmPrev[sym]=newPrice;
      // Store sparkline (last 20 points)
      const existHist=(qmData[sym]?.hist)||[];
      if(newPrice) existHist.push(newPrice);
      if(existHist.length>20) existHist.shift();
      qmData[sym]={
        price:   newPrice,
        change:  r.change,
        pct:     r.changePct,
        bid:     r.bid,
        ask:     r.ask,
        open:    r.open,
        high:    r.high,
        low:     r.low,
        vol:     r.volume,
        mktcap:  r.marketCap,
        name:    r.name,
        lat:     Date.now()-t0,
        hist:    existHist,
      };
    }catch(e){}
  });

  await Promise.all(fetches);
  renderQMT(id);
  const now=new Date();
  const ts=`${now.getHours()}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  if(statusTxt) statusTxt.textContent=`Updated ${ts}`;
  if(dot) dot.classList.remove('stale');
}

// ── Add / remove tickers ─────────────────────────────
export function qmAddRow(id){
  const row=document.getElementById(`qadd-row-${id}`);
  const inp=document.getElementById(`qadd-inp-${id}`);
  if(row) row.style.display='flex';
  if(inp){ inp.value=''; inp.focus(); }
}
export function qmAddKey(e, id){
  if(e.key==='Enter'){
    const sym=e.target.value.trim().toUpperCase();
    if(sym){
      const _awl=getAWL(id);
      if(!watchlists[_awl]) watchlists[_awl]={name:_awl,tickers:[]};
      if(!watchlists[_awl].tickers.includes(sym)){
        watchlists[_awl].tickers.push(sym);
        saveWatchlists();
        renderQMT(id);
        // Fetch just this ticker
        (async()=>{
          const t0=Date.now();
          try{
            const r=await fetch(`${API}/quote/${sym}`).then(x=>x.json());
            if(r.ok){ qmData[sym]={price:r.price,change:r.change,pct:r.changePct,bid:r.bid,ask:r.ask,open:r.open,high:r.high,low:r.low,vol:r.volume,mktcap:r.marketCap,name:r.name,lat:Date.now()-t0,hist:[r.price].filter(Boolean)}; renderQMT(id); }
          }catch(e){}
        })();
      }
    }
    e.target.value='';
    document.getElementById(`qadd-row-${id}`).style.display='none';
  }
  if(e.key==='Escape'){
    e.target.value='';
    document.getElementById(`qadd-row-${id}`).style.display='none';
  }
}

// Batch import
export function closeBatch(){ document.getElementById('batch-ov').classList.remove('open'); }
export function doBatch(){
  const v=document.getElementById('batch-ta').value;
  const syms=v.split('\n').map(s=>s.trim().toUpperCase()).filter(Boolean);
  const _bawl=(_lastQMId&&qmAWL[_lastQMId])||activeWL;
  if(!watchlists[_bawl]) watchlists[_bawl]={name:_bawl,tickers:[]};
  syms.forEach(s=>{ if(!watchlists[_bawl].tickers.includes(s)) watchlists[_bawl].tickers.push(s); });
  saveWatchlists();
  closeBatch();
  Object.keys(getWins()).forEach(k=>{ if(getWins()[k]?.type==='qm'){ renderQMT(k); qmRefreshAll(k); } });
}
