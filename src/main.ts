import { ow, cw, minWin, registerFTimer, getWins, getTopmostWin, onWindowClosed, setActiveWin, getActiveWinId, cycleFocus, moveActiveWin, resizeActiveWin, snapActiveWin, resizeActiveWinToEdge, popClosedWin } from './core/windowManager.js';
import { GLOBAL_CMDS, TICKER_CMDS, ASSET_CLASSES, PURE, SKIP, TICKER_ALIAS } from './core/commands.js';
import { API, charts, fp, fl, fv, cd, pill, ld, dc } from './core/utils.js';
import { openQM, buildQM, qmAddKey, qmAddRow, qmCycleSortUI, qmDeleteWL, qmNewWL, qmOpenColPicker, qmRemoveTicker, qmRenameTab, qmSortBy, qmTabClick, qmToggleCol, qmTogglePause, closeBatch, doBatch, getWLOrder, watchlists } from './panels/global/qm.js';
import { doHelp } from './panels/global/help.js';
import { doPlaceholder } from './panels/global/placeholder.js';
import { doMost } from './panels/global/most.js';
import { doRate } from './panels/global/rate.js';
import { doEco } from './panels/global/eco.js';
import { doEcal } from './panels/global/ecal.js';
import { doBio } from './panels/global/ni.js';
import { openResPanel } from './panels/global/res.js';
import { loadPrefs, savePrefs, applyPrefs, doPdf, PREFS_KEY, PREFS_DEFAULTS } from './panels/global/pdf.js';
import { doWei } from './panels/global/wei.js';
import { doWcr, doGlco, _renderPerfWin, _perfWS } from './panels/global/perf.js';
// Phase 8: CLI extracted
import { parseRun, dispatch } from './core/cli.js';
// Direct panel imports needed for Object.assign + boot
import { doN } from './panels/ticker/n.js';
import { doFocus } from './panels/ticker/focus.js';
// ══════════════════════════════════════════════
//  GLOBALS
// ══════════════════════════════════════════════
let cmdHist = [], histIdx = -1, _histDraft = '';
// QM state is in panels/global/qm.ts

// ── CLOCK ──────────────────────────────────────
function tickClock(){
  const n=new Date(),p=x=>String(x).padStart(2,'0');
  let h=n.getHours(),ap=h>=12?'PM':'AM';h=h%12||12;
  document.getElementById('clock').textContent=`${h}:${p(n.getMinutes())}:${p(n.getSeconds())} ${ap}`;
}
setInterval(tickClock,1000);tickClock();


// ── CLI ────────────────────────────────────────
const cliWrap=document.getElementById('cli-wrap');
const cliInp=document.getElementById('cli-inp');
const cliHist=document.getElementById('cli-hist');

// ── COMMAND PALETTE ────────────────────────────────
const palette = document.getElementById('cmd-palette');
let paletteIdx = -1;

function paletteBranch(){
  const val=cliInp.value;
  const trimmed=val.trim().toUpperCase();
  const pts=trimmed.split(/\s+/);
  const first=pts[0]||'';

  // Space after ticker → asset class qualifier mode
  if(first&&!PURE.has(first)&&pts.length===1&&val.endsWith(' ')){
    return {cmds:ASSET_CLASSES,ticker:first,mode:'asset_class',filter:''};
  }
  // Multiple tokens → ticker + command filter
  if(first&&!PURE.has(first)&&pts.length>=2){
    const last=pts[pts.length-1];
    const filter=SKIP.has(last)?'':last;
    const filtered=filter?TICKER_CMDS.filter(c=>c.key.startsWith(filter)):TICKER_CMDS;
    return {cmds:filtered,ticker:first,mode:'ticker',filter};
  }
  // Single token: if it doesn't match any global command prefix, treat as ticker
  // This allows "AAPL" alone to immediately show ticker commands (no space required)
  const globalMatches=first?GLOBAL_CMDS.filter(c=>c.key.startsWith(first)):GLOBAL_CMDS;
  if(first&&!PURE.has(first)&&globalMatches.length===0){
    return {cmds:TICKER_CMDS,ticker:first,mode:'ticker',filter:''};
  }
  return {cmds:globalMatches,ticker:null,mode:'global',filter:first};
}

function renderPalette(){
  if(!cliInp.classList.contains('active')){palette.classList.remove('open');return;}
  palette.classList.add('open');
  const {cmds,ticker,mode}=paletteBranch();
  const body=document.getElementById('cp-body');
  if(!body) return;
  const header=mode==='asset_class'?'Asset Classes':'Commands';
  body.innerHTML=`
    <div class="cp-section">${header}</div>
    ${cmds.length===0
      ?`<div style="padding:10px 16px;font-size:10px;color:var(--dim);">No matches</div>`
      :cmds.map((c,i)=>`
      <div class="cp-row${i===paletteIdx?' cp-active':''}" data-i="${i}" onclick="window._paletteExec(${i})">
        ${mode==='ticker'?`<span class="cp-ticker-pill">${ticker}</span>`:''}
        <span class="${mode==='asset_class'?'cp-ac-key':'cp-key'}">${c.key}</span>
        <span class="cp-desc">${c.desc}${c.fkey?` <span class="cp-fkey">(${c.fkey})</span>`:''}</span>
        <span class="cp-enter">${i===paletteIdx?(mode==='asset_class'?'Tab » to fill':'Enter ↵'):''}</span>
      </div>`).join('')}
  `;
  const active=body.querySelector('.cp-active');
  if(active) active.scrollIntoView({block:'nearest'});
}

window._paletteExec=function(idx){
  const {cmds,ticker,mode}=paletteBranch();
  const cmd=cmds[idx]; if(!cmd) return;
  if(mode==='asset_class'){
    cliInp.value=ticker+' '+cmd.key+' ';
    paletteIdx=0; renderPalette(); cliInp.focus();
    const len=cliInp.value.length; cliInp.setSelectionRange(len,len);
    return;
  }
  const rawInput=cliInp.value.trim().toUpperCase();
  const full=mode==='ticker'&&ticker
    ?`${ticker} ${cmd.key}`
    :(mode==='global'&&rawInput.startsWith(cmd.key+' ')?rawInput:cmd.key);
  cmdHist.unshift(full); histIdx=-1;
  clog(`> ${full}`,'cl-cmd');
  parseRun(full);
  closeTerminal();
};

function paletteMove(dir){
  const {cmds}=paletteBranch();
  if(!cmds.length) return;
  if(paletteIdx===-1) paletteIdx= dir>0 ? 0 : cmds.length-1;
  else paletteIdx=Math.max(0,Math.min(paletteIdx+dir, cmds.length-1));
  renderPalette();
}

// ── OPEN / CLOSE HELPERS ────────────────────────────
const tbCursor=document.getElementById('tb-cursor');

function positionCursor(){
  const mirror=document.getElementById('tb-mirror') as HTMLElement;
  const prompt=document.getElementById('tb-prompt') as HTMLElement;
  mirror.textContent=cliInp.value.toUpperCase();
  const base=prompt.offsetLeft+prompt.offsetWidth+10;
  tbCursor.style.left=(base+mirror.offsetWidth)+'px';
}

function openTerminal(){
  cliInp.classList.add('active');
  document.getElementById('tb-hint').style.display='none';
  tbCursor.classList.add('active');
  cliInp.value='';
  positionCursor();
  cliInp.focus();
  const {cmds}=paletteBranch();
  paletteIdx=cmds.length>0?0:-1;
  renderPalette();
}
function closeTerminal(){
  cliInp.classList.remove('active');
  cliInp.value='';
  tbCursor.classList.remove('active');
  document.getElementById('tb-hint').style.display='';
  palette.classList.remove('open');
  cliWrap.classList.remove('open');
  paletteIdx=-1;
}

async function showInlineQuote(tk){
  const el=document.getElementById('tb-hint');
  try{
    const r=await fetch(`${API}/quote/${tk}`).then(x=>x.json());
    if(!r.ok)return;
    const d=cd(r.changePct);
    const col=d==='up'?'var(--green)':d==='down'?'var(--red)':'var(--dim)';
    const arr=r.changePct>0.05?'▲':r.changePct<-0.05?'▼':'●';
    const chg=(r.change>=0?'+':'')+r.change.toFixed(2);
    const dec=r.price>1000?0:2;
    const dt=r.date?r.date.slice(0,10).replace(/-/g,'/'):'';
    el.innerHTML=
      `<span style="color:#fff;font-weight:700;font-size:15px;letter-spacing:.05em">${tk}</span>`+
      `<span style="color:#666;font-size:12px;margin-left:6px">${r.exchange||''}</span>`+
      `<span style="color:${col};font-size:15px;font-weight:600;margin-left:12px">${arr} $${r.price.toFixed(dec)} ${chg} ${(r.changePct>=0?'+':'')+r.changePct.toFixed(2)}%</span>`+
      `<span style="color:#aaa;font-size:13px;margin-left:12px">Vol <span style="color:#fff;font-weight:600">${fv(r.volume)}</span></span>`+
      `<span style="color:#aaa;font-size:13px;margin-left:12px">At: <span style="color:#fff;font-weight:600">${dt}</span></span>`;
  }catch{/* keep existing hint content */}
}

// ── BLOOMBERG FUNCTION KEY HANDLER ──────────────────
// Bloomberg F-key definitions: sector overview + optional asset-class qualifier
const FKEY_SECTOR:{[n:number]:{overview:string,qualifier?:string}}={
  1: {overview:'HELP'},
  2: {overview:'GOVT',  qualifier:'GOVT'},
  3: {overview:'CORP',  qualifier:'CORP'},
  4: {overview:'MTGE'},
  5: {overview:'M-MKT'},
  6: {overview:'MUNI'},
  7: {overview:'PFD'},
  8: {overview:'EQS',   qualifier:'EQ'},
  9: {overview:'GLCO',  qualifier:'FUT'},
  10:{overview:'WEI',   qualifier:'IDX'},
  11:{overview:'FX',    qualifier:'CUR'},
  12:{overview:'PORT'},
};
function fkPress(n:number){
  const def=FKEY_SECTOR[n]; if(!def) return;
  const isOpen=cliInp.classList.contains('active');
  const val=cliInp.value.trim();
  const ticker=val.split(/\s+/)[0];

  // Ticker is typed → qualify it and show ticker commands (don't discard input)
  if(isOpen && ticker && def.qualifier){
    cliInp.value=ticker+' '+def.qualifier+' ';
    const {cmds}=paletteBranch();
    paletteIdx=cmds.length>0?0:-1;
    renderPalette();
    positionCursor();
    cliInp.focus();
    return;
  }

  // No ticker (or F-key has no qualifier) → open sector overview
  if(isOpen) closeTerminal();
  parseRun(def.overview);
}

function clog(msg,cls='cl-out'){const d=document.createElement('div');d.className=`cl-line ${cls}`;d.textContent=msg;cliHist.appendChild(d);cliHist.parentElement.scrollTop=9999;if(cliHist.children.length>60)cliHist.removeChild(cliHist.firstChild);}
function runCmd(cmd){parseRun(cmd.toUpperCase());}

// ── TYPEWRITER HINT ─────────────────────────────────
(function(){
  const el=document.getElementById('tb-hint');
  const txt='Backtick to open terminal';
  let i=0;
  el.innerHTML='<b style="color:#3d3d3d;font-weight:400">` </b><span class="tw-cursor">_</span>';
  const t=setInterval(()=>{
    i++;
    el.innerHTML=`<b style="color:#3d3d3d;font-weight:400">\` </b><span style="color:var(--dim)">${txt.slice(0,i)}</span>${i<txt.length?'<span class="tw-cursor">_</span>':''}`;
    if(i>=txt.length) clearInterval(t);
  },45);
})();

// ── KEYBOARD HANDLERS ───────────────────────────────
let _lastEscTime = 0;
let _topbarH = 51; // track dynamic topbar height for Ctrl+Option+Arrow

document.addEventListener('keydown',e=>{
  const inTerminal = cliInp.classList.contains('active');
  const inInput = (e.target as Element).matches('input,textarea');

  // ── Backtick: toggle terminal ──
  if(e.key==='`'||e.key==='~'){
    e.preventDefault();
    inTerminal ? closeTerminal() : openTerminal();
    return;
  }

  // ── F-keys ──
  if(e.key.startsWith('F')&&e.key.length<=3&&!isNaN(+(e.key.slice(1)))){
    const n=parseInt(e.key.slice(1),10);
    if(n>=1&&n<=12){e.preventDefault();fkPress(n);return;}
  }

  // ── PageUp: scroll topmost window ──
  if(e.key==='PageUp'&&!inInput){
    e.preventDefault();
    const w=getTopmostWin();
    if(w){const s=w.querySelector('.wbody,.qm-scroll');if(s)(s as HTMLElement).scrollTop-=200;}
    return;
  }

  // ── Escape: single = close terminal; double-tap = close active window ──
  if(e.key==='Escape'){
    if(inTerminal){closeTerminal();return;}
    const now=Date.now();
    if(now-_lastEscTime<400){
      // double-tap
      const wid=getActiveWinId();
      if(wid) cw(wid); else { const w=getTopmostWin(); if(w) cw(w.id); }
      _lastEscTime=0;
    } else {
      _lastEscTime=now;
    }
    return;
  }

  // ── Tab / Shift+Tab: cycle window focus (only outside terminal/inputs) ──
  if(e.key==='Tab'&&!inTerminal&&!inInput){
    e.preventDefault();
    cycleFocus(e.shiftKey ? -1 : 1);
    return;
  }

  // ── Cmd+Z / Ctrl+Z: undo last window close ──
  if(e.key==='z'&&(e.metaKey||e.ctrlKey)&&!inTerminal&&!inInput){
    e.preventDefault();
    const entry=popClosedWin();
    if(entry) dispatch(entry.ticker, entry.cmd, []);
    return;
  }

  // ── Arrow-key shortcuts (skip if in terminal/input) ──
  const arrowMap:{[k:string]:[number,number,'up'|'down'|'left'|'right']} = {
    ArrowUp:   [0,-20,'up'],
    ArrowDown: [0, 20,'down'],
    ArrowLeft: [-20,0,'left'],
    ArrowRight:[20, 0,'right'],
  };
  if(arrowMap[e.key]&&!inTerminal&&!inInput){
    const [dx,dy,dir]=arrowMap[e.key];

    // Ctrl+Option+Up/Down: resize topbar height
    if(e.ctrlKey&&e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){
      e.preventDefault();
      _topbarH=Math.max(36,Math.min(80,_topbarH+(e.key==='ArrowUp'?-4:4)));
      const tb=document.getElementById('topbar') as HTMLElement;
      const desk=document.getElementById('desktop') as HTMLElement;
      const cliW=document.getElementById('cli-wrap') as HTMLElement;
      tb.style.height=_topbarH+'px';
      const cwH=cliW?parseInt(getComputedStyle(cliW).height)||24:24;
      desk.style.height=`calc(100vh - ${_topbarH}px - ${cwH}px)`;
      return;
    }

    // Option+Shift+Arrow: resize active window to edge
    if(e.altKey&&e.shiftKey&&!e.ctrlKey){
      e.preventDefault();
      resizeActiveWinToEdge(dir);
      return;
    }

    // Ctrl+Shift+Arrow: snap active window to edge
    if(e.ctrlKey&&e.shiftKey&&!e.altKey){
      e.preventDefault();
      snapActiveWin(dir);
      return;
    }

    // Option+Arrow: resize active window
    if(e.altKey&&!e.shiftKey&&!e.ctrlKey){
      e.preventDefault();
      resizeActiveWin(dx===0?0:dx*2, dy===0?0:dy*2);
      return;
    }

    // Shift+Arrow: move active window
    if(e.shiftKey&&!e.ctrlKey&&!e.altKey){
      e.preventDefault();
      moveActiveWin(dx,dy);
      return;
    }
  }

  // ── Re-focus CLI if typing while terminal is open ──
  if(inTerminal&&e.target!==cliInp&&!inInput) cliInp.focus();
});

cliInp.addEventListener('keydown',e=>{
  if(e.key==='ArrowUp'){e.preventDefault(); paletteMove(-1); return;}
  if(e.key==='ArrowDown'){e.preventDefault(); paletteMove(1); return;}
  if(e.key==='Enter'){
    if(paletteIdx>=0){e.preventDefault();window._paletteExec(paletteIdx);return;}
    const r=cliInp.value.trim(); if(!r)return;
    cmdHist.unshift(r); histIdx=-1;
    clog(`> ${r}`,'cl-cmd');
    parseRun(r.toUpperCase());
    closeTerminal();
    return;
  }
  if(e.key==='Tab'){e.preventDefault();if(paletteBranch().mode==='asset_class'&&paletteIdx>=0){window._paletteExec(paletteIdx);}else{closeTerminal();cycleFocus(e.shiftKey?-1:1);}return;}
  if(e.key==='Escape'){closeTerminal();return;}
});

cliInp.addEventListener('input',()=>{histIdx=-1; const {cmds}=paletteBranch(); paletteIdx=cmds.length>0?0:-1; renderPalette(); positionCursor();});
cliInp.addEventListener('focus',()=>{ if(!cliInp.classList.contains('active')) openTerminal(); });


// parseRun and dispatch are imported from core/cli.ts

// QM and FORMAT HELPERS are imported from panels/global/qm.ts and core/utils.ts

// ══════════════════════════════════════════════
//  COMMANDS
// ══════════════════════════════════════════════


// ══════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════
applyPrefs(loadPrefs());
function boot(){
  // Open QM on the left — wider to accommodate more columns
  openQM();
  const qmEl=document.getElementById(qmWinId);
  if(qmEl){qmEl.style.left='10px';qmEl.style.top='10px';qmEl.style.width='560px';qmEl.style.height='480px';}

  // Lay out FOCUS cards on the right, like the screenshot
  const desk=document.getElementById('desktop');
  const dw=desk.clientWidth;
  const cards=['EWY','LTH','SPY','AENA','LYFT'];
  const cx=dw-270;
  cards.forEach((sym,i)=>{
    const wid=ow('foc',sym,`FOCUS · ${sym}`,260,100,(e,tk,id)=>doFocus(e,tk,id));
    const el=document.getElementById(wid);
    if(el){el.style.left=cx+'px';el.style.top=(10+i*102)+'px';el.style.width='260px';el.style.height='100px';}
  });
}
requestAnimationFrame(()=>requestAnimationFrame(boot));

// ══════════════════════════════════════════════
//  EXPOSE GLOBALS FOR INLINE EVENT HANDLERS
//  (These are called from onclick=, onmousedown=, etc. in generated HTML)
// ══════════════════════════════════════════════
Object.assign(window, {
  // Window manager
  cw, minWin,
  // QM functions
  qmAddKey, qmAddRow, qmCycleSortUI, qmDeleteWL, qmNewWL,
  qmOpenColPicker, qmRemoveTicker, qmRenameTab, qmSortBy,
  qmTabClick, qmToggleCol, qmTogglePause,
  // CLI & dispatch — runCmd is the root; parseRun/dispatch/all panels are
  // reachable transitively, but we also expose dispatch+openQM for direct calls
  runCmd, dispatch, parseRun, openQM,
  doBatch, closeBatch,
  // Panels called directly from inline HTML (not via dispatch)
  doN,
  // CLI log (used by pdf.ts for save/reset feedback)
  clog,
});
