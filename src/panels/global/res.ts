import { API, ld } from '../../core/utils.js';

export function openResPanel(){
  const PANEL_ID='res-panel';
  const existing=document.getElementById(PANEL_ID);
  if(existing){ existing.remove(); return; }

  const CAT_LABEL={
    central_bank:'CENTRAL BANK', asset_manager:'ASSET MANAGER',
    quant_hf:'QUANT / HF',       pe_credit:'PE / CREDIT',
    academic:'ACADEMIC',          multilateral:'MULTILATERAL',
    bank:'BANK',
  };

  const desk=document.getElementById('desktop');
  const panel=document.createElement('div');
  panel.id=PANEL_ID;
  // Same top-border orange accent as .win-bar; fills desktop completely
  panel.style.cssText=[
    'position:absolute;inset:0;z-index:180;overflow:hidden',
    'display:flex;flex-direction:column',
    'background:var(--bg);',
    'border-top:2px solid rgba(240,140,0,0.75)',
    'animation:resFadeIn .15s ease',
  ].join(';');

  const ctrlStyle='background:var(--bg);border:1px solid var(--bdr);color:var(--dim);padding:3px 7px;font-size:10px;font-family:var(--font);outline:none;cursor:pointer';

  panel.innerHTML=`
    <style>
      @keyframes resFadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
      .res-row{cursor:pointer;border-bottom:1px solid var(--bg2);}
      .res-row:hover .res-title{color:var(--text);}
      .res-row:hover{background:var(--bg1);}
      .res-row.res-active{background:var(--bg1);border-left:2px solid var(--orange);}
      .res-row.res-active .res-title{color:var(--text);}
      .res-row.res-active .res-inst{color:var(--orange);}
    </style>

    <!-- TOP BAR: matches .win-bar height and font -->
    <div style="height:28px;display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#0c0c0c;border-bottom:1px solid var(--bdr);flex-shrink:0">
      <span style="font-size:11px;font-weight:600;color:var(--orange);letter-spacing:.08em">RES · RESEARCH REPORTS</span>
      <div style="display:flex;align-items:center;gap:6px">
        <span id="res-ts" style="font-size:9px;color:var(--muted);letter-spacing:.05em"></span>
        <div class="wb x" onclick="document.getElementById('${PANEL_ID}').remove()" title="Close">✕</div>
      </div>
    </div>

    <!-- BODY: left list + right viewer -->
    <div style="display:flex;flex:1;overflow:hidden;min-height:0">

      <!-- LEFT COLUMN -->
      <div style="width:340px;flex-shrink:0;display:flex;flex-direction:column;border-right:1px solid var(--bdr);background:var(--bg);overflow:hidden">

        <!-- Search + filter strip -->
        <div style="padding:6px 8px;border-bottom:1px solid var(--bdr);display:flex;flex-direction:column;gap:4px;background:#0c0c0c;flex-shrink:0">
          <input id="res-q" placeholder="Search…" style="${ctrlStyle};width:100%;border-color:var(--bdr)"/>
          <div style="display:flex;gap:4px">
            <select id="res-cat" style="${ctrlStyle};flex:1">
              <option value="">ALL CATEGORIES</option>
              <option value="central_bank">CENTRAL BANK</option>
              <option value="asset_manager">ASSET MANAGER</option>
              <option value="quant_hf">QUANT / HF</option>
              <option value="pe_credit">PE / CREDIT</option>
              <option value="academic">ACADEMIC</option>
              <option value="multilateral">MULTILATERAL</option>
              <option value="bank">BANK</option>
            </select>
            <select id="res-inst" style="${ctrlStyle};flex:1;max-width:130px"><option value="">ALL SOURCES</option></select>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <button id="res-ref" style="${ctrlStyle};letter-spacing:.08em" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--dim)'">↻ REFRESH</button>
            <span id="res-count" style="font-size:9px;color:var(--muted)"></span>
          </div>
        </div>

        <!-- Paper list -->
        <div style="flex:1;overflow-y:auto">
          <div id="res-body"></div>
          <div id="res-empty" style="display:none;padding:24px 12px;color:var(--muted);font-size:10px;letter-spacing:.1em">NO RESULTS</div>
        </div>
      </div>

      <!-- RIGHT COLUMN: pdf viewer -->
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg)">

        <!-- PDF title bar — hidden until paper selected -->
        <div id="res-pdf-bar" style="height:28px;display:none;align-items:center;justify-content:space-between;padding:0 10px;background:#0c0c0c;border-bottom:1px solid var(--bdr);flex-shrink:0">
          <span id="res-pdf-title" style="font-size:10px;color:var(--dim);letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin-right:12px"></span>
          <span id="res-pdf-src" style="font-size:9px;color:var(--muted);letter-spacing:.06em;white-space:nowrap"></span>
        </div>

        <!-- Viewer area -->
        <div id="res-viewer" style="flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden">
          <div style="text-align:center;color:var(--muted);font-size:9px;letter-spacing:.14em;line-height:2.4;user-select:none;opacity:.35">
            SELECT A PAPER<br>TO VIEW
          </div>
        </div>
      </div>

    </div>`;

  desk.appendChild(panel);

  const g=(id)=>document.getElementById(id);

  document.addEventListener('keydown',function esc(e){
    if(e.key==='Escape'&&document.getElementById(PANEL_ID)){ panel.remove(); document.removeEventListener('keydown',esc); }
  });

  let _allPapers=[], _cachedAt=0, _tsTimer=null, _activeRow=null, _filtered=[];

  function fmtDate(d){
    if(!d) return '';
    const m=d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m?`${m[2]}/${m[3]}/${m[1].slice(2)}`:d.slice(0,10);
  }

  function fmtAgo(ts){
    if(!ts) return '';
    const s=Math.floor((Date.now()/1000)-ts);
    if(s<60) return 'LIVE';
    if(s<3600) return `${Math.floor(s/60)}M AGO`;
    return `${Math.floor(s/3600)}H AGO`;
  }

  function buildInstDropdown(papers){
    const names=[...new Set(papers.map(p=>p.institution))].sort();
    const dd=g('res-inst');
    if(!dd) return;
    const cur=(dd as HTMLSelectElement).value;
    dd.innerHTML=`<option value="">ALL SOURCES</option>`+names.map(n=>`<option value="${n}"${n===cur?' selected':''}>${n.toUpperCase()}</option>`).join('');
  }

  function openPdf(paper){
    // Update PDF title bar
    const bar=g('res-pdf-bar');
    if(bar){
      (bar as HTMLElement).style.display='flex';
      const tEl=g('res-pdf-title'); if(tEl) tEl.textContent=paper.title;
      const sEl=g('res-pdf-src');   if(sEl) sEl.textContent=paper.institution.toUpperCase()+(paper.date?' · '+fmtDate(paper.date):'');
    }
    const viewer=g('res-viewer');
    if(!viewer) return;
    if(paper.pdf_url){
      const proxyUrl=`${API}/res/pdf?url=${encodeURIComponent(paper.pdf_url)}`;
      // Wrap iframe in a container that gives it terminal-style inset border
      viewer.innerHTML=`
        <div style="width:100%;height:100%;padding:0;position:relative">
          <iframe src="${proxyUrl}"
            style="width:100%;height:100%;border:none;display:block"
            title="${paper.title.replace(/"/g,'&quot;')}">
          </iframe>
        </div>`;
    } else {
      viewer.innerHTML=`
        <div style="text-align:center;color:var(--muted);font-size:10px;letter-spacing:.1em;line-height:2.6;opacity:.5">
          NO PDF AVAILABLE FOR THIS PAPER<br>
          <span style="font-size:9px;color:var(--muted);letter-spacing:.06em;cursor:pointer;text-decoration:underline;text-underline-offset:3px"
            onclick="window.open('${paper.url}','_blank')">VIEW SOURCE PAGE ↗</span>
        </div>`;
    }
  }

  function render(){
    const q=(g('res-q') as HTMLInputElement)?.value?.trim().toLowerCase()||'';
    const cat=(g('res-cat') as HTMLSelectElement)?.value||'';
    const inst=(g('res-inst') as HTMLSelectElement)?.value||'';
    _filtered=_allPapers;
    if(q) _filtered=_filtered.filter(p=>p.title.toLowerCase().includes(q)||(p.summary||'').toLowerCase().includes(q));
    if(cat) _filtered=_filtered.filter(p=>p.category===cat);
    if(inst) _filtered=_filtered.filter(p=>p.institution===inst);

    const body=g('res-body');
    const empty=g('res-empty');
    const count=g('res-count');
    if(!body) return;

    if(count) count.textContent=_filtered.length+' RESULTS';

    if(!_filtered.length){
      body.innerHTML='';
      if(empty) (empty as HTMLElement).style.display='block';
      return;
    }
    if(empty) (empty as HTMLElement).style.display='none';

    body.innerHTML=_filtered.map((p,i)=>{
      const safeT=p.title.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const pdfTag=p.pdf_url
        ?`<span style="font-size:8px;color:var(--green);letter-spacing:.1em;border:1px solid rgba(74,222,128,.25);padding:1px 4px;margin-left:auto;flex-shrink:0">PDF</span>`
        :'';
      return `<div class="res-row" data-idx="${i}" style="padding:9px 10px 8px 12px">
        <div class="res-title" style="font-size:12px;color:var(--dim);line-height:1.45;margin-bottom:4px">${safeT}</div>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="res-inst" style="font-size:9px;color:var(--muted);letter-spacing:.07em">${p.institution.toUpperCase()}</span>
          <span style="font-size:9px;color:#2e2e2e;letter-spacing:.08em">${CAT_LABEL[p.category]||''}</span>
          ${fmtDate(p.date)?`<span style="font-size:9px;color:#2c2c2c;margin-left:auto">${fmtDate(p.date)}</span>`:''}
          ${pdfTag}
        </div>
      </div>`;
    }).join('');

    body.querySelectorAll('.res-row').forEach(row=>{
      row.addEventListener('click',()=>{
        if(_activeRow) _activeRow.classList.remove('res-active');
        row.classList.add('res-active');
        _activeRow=row;
        openPdf(_filtered[parseInt((row as HTMLElement).dataset.idx)]);
      });
    });
  }

  async function load(refresh=false){
    const body=g('res-body');
    const ts=g('res-ts');
    if(body) body.innerHTML=`<div style="padding:24px 12px;color:var(--muted);font-size:10px;letter-spacing:.1em;text-align:center">${ld(refresh?'Refreshing feeds\u2026':'Loading research\u2026')}</div>`;
    if(ts) ts.textContent='';
    try{
      const url=refresh?`${API}/res/refresh`:`${API}/res`;
      const r=await fetch(url).then(x=>x.json());
      if(!r.ok) throw new Error(r.error||'Failed');
      _allPapers=r.papers||[];
      _cachedAt=r.cached_at||0;
      buildInstDropdown(_allPapers);
      render();
      if(ts) ts.textContent=fmtAgo(_cachedAt);
      if(_tsTimer) clearInterval(_tsTimer);
      _tsTimer=setInterval(()=>{ if(ts&&document.getElementById(PANEL_ID)) ts.textContent=fmtAgo(_cachedAt); else clearInterval(_tsTimer); },30000);
    }catch(e){
      if(body) body.innerHTML=`<div style="padding:16px 12px"><div class="err">${(e as Error).message}</div></div>`;
    }
  }

  ['res-q','res-cat','res-inst'].forEach(id=>{
    const e=g(id);
    if(e){ e.addEventListener('input',render); e.addEventListener('change',render); }
  });
  g('res-ref').addEventListener('click',()=>load(true));

  load(false);
}
