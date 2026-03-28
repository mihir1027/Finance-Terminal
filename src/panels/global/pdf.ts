export const PREFS_KEY='kt_prefs_v1';
export const PREFS_DEFAULTS={
  font:"'Oxygen Mono', monospace",
  fontSize:13,
  density:'normal',
  scrollW:4,
  orange:'#F08C00',
  green:'#4ade80',
  red:'#f87171',
  amber:'#fbbf24',
  cyan:'#38bdf8',
  winBdrAlpha:18,
  winTopAlpha:75,
  winShadow:'strong',
  bgPreset:'dark',
  chartUp:'#4ade80',
  chartDown:'#f87171',
  sentThresh:5,
};
export function loadPrefs(){return{...PREFS_DEFAULTS,...JSON.parse(localStorage.getItem(PREFS_KEY)||'{}')};}
export function savePrefs(p){localStorage.setItem(PREFS_KEY,JSON.stringify(p));}
export function applyPrefs(p){
  const r=document.documentElement;
  r.style.setProperty('--font',p.font);
  document.body.style.fontSize=p.fontSize+'px';
  r.style.setProperty('--orange',p.orange);
  r.style.setProperty('--green',p.green);
  r.style.setProperty('--red',p.red);
  r.style.setProperty('--amber',p.amber);
  r.style.setProperty('--cyan',p.cyan);
  // Window chrome dynamic style
  let s=document.getElementById('pdf-chrome-style');
  if(!s){s=document.createElement('style');s.id='pdf-chrome-style';document.head.appendChild(s);}
  const shadows={off:'none',soft:'0 4px 20px rgba(0,0,0,.5)',strong:'0 10px 50px rgba(0,0,0,.85)'};
  const bgs={pitch:'#000000',dark:'#0a0a0a',charcoal:'#141414'};
  s.textContent=`.win{border:1px solid rgba(251,191,36,${p.winBdrAlpha/100})!important;box-shadow:${shadows[p.winShadow]}!important;}`+
    `.win-bar{border-top:2px solid rgba(240,140,0,${p.winTopAlpha/100})!important;}`+
    `#desktop,#topbar+*,body{background:${bgs[p.bgPreset]}!important;}#desktop{background:${bgs[p.bgPreset]}!important;}`;
  // Density class
  document.body.classList.remove('density-compact','density-relaxed');
  if(p.density!=='normal')document.body.classList.add(`density-${p.density}`);
  // Scrollbar width
  let sw=document.getElementById('pdf-scroll-style');
  if(!sw){sw=document.createElement('style');sw.id='pdf-scroll-style';document.head.appendChild(sw);}
  sw.textContent=`::-webkit-scrollbar{width:${p.scrollW}px;height:${p.scrollW}px;}`;
  // Chart & sentiment
  (window as any)._pdfChartUp=p.chartUp;
  (window as any)._pdfChartDown=p.chartDown;
  (window as any)._sentThresh=p.sentThresh/100;
}

export function doPdf(el, wid){
  // Set up wbody as the flex container (same pattern as doHelp/doEco)
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%;font-family:var(--font);';

  let P=loadPrefs();

  const FONTS=[
    {label:'Oxygen Mono',  val:"'Oxygen Mono', monospace"},
    {label:'JetBrains Mono',val:"'JetBrains Mono', monospace"},
    {label:'IBM Plex Mono',val:"'IBM Plex Mono', monospace"},
  ];
  const ACCENT_PRESETS=['#F08C00','#e67e22','#f59e0b','#38bdf8','#a78bfa','#4ade80','#f87171','#ec4899'];
  const GREEN_PRESETS=['#4ade80','#22c55e','#10b981','#34d399','#86efac','#6ee7b7'];
  const RED_PRESETS  =['#f87171','#ef4444','#dc2626','#fb923c','#fca5a5','#fda4af'];
  const AMBER_PRESETS=['#fbbf24','#f59e0b','#d97706','#fcd34d','#fde68a'];
  const CYAN_PRESETS =['#38bdf8','#0ea5e9','#06b6d4','#67e8f9','#a5f3fc'];

  const SEC='color:#71717a;font-size:8px;letter-spacing:.18em;text-transform:uppercase;padding:10px 0 6px;border-bottom:1px solid #1a1a1a;margin-bottom:14px;display:block;';
  const ROW='display:flex;align-items:center;margin-bottom:12px;gap:10px;';
  const RLBL='color:#a1a1aa;font-size:10px;width:150px;flex-shrink:0;';
  const SEGBASE='cursor:pointer;padding:3px 10px;font-size:9px;border:1px solid #2c2c2c;border-radius:2px;letter-spacing:.08em;font-family:var(--font);background:transparent;transition:color .1s,border-color .1s;outline:none;';
  const SEGI=SEGBASE+'color:#555;';
  const SEGA=SEGBASE+'color:var(--amber);border-color:var(--amber);';

  function swatchRow(presets,current,cssVar){
    const spans=presets.map(c=>{
      const active=c.toLowerCase()===current.toLowerCase();
      return `<span data-sw="${cssVar}" data-val="${c}" title="${c}" style="display:inline-block;width:22px;height:22px;border-radius:3px;background:${c};cursor:pointer;margin-right:4px;border:2px solid ${active?'#fff':'transparent'};flex-shrink:0;"></span>`;
    }).join('');
    return spans+`<input type="color" data-sw="${cssVar}" value="${current}" title="Custom" style="width:22px;height:22px;border:1px solid #333;border-radius:3px;background:#111;cursor:pointer;padding:1px;margin-left:2px;vertical-align:middle;">`;
  }

  function seg(opts,current,action){
    return opts.map(o=>`<button data-seg-val="${o}" data-seg-action="${action}" style="${o===current?SEGA:SEGI}">${o.toUpperCase()}</button>`).join('');
  }

  function tabContent(tab){
    if(tab==='DISPLAY') return `
      <span style="${SEC}">TYPOGRAPHY</span>
      <div style="${ROW}"><span style="${RLBL}">Font Family</span><div style="display:flex;gap:6px;">
        ${FONTS.map(f=>`<button data-seg-val="${f.val}" data-seg-action="font" style="${P.font===f.val?SEGA:SEGI}">${f.label}</button>`).join('')}
      </div></div>
      <div style="${ROW}"><span style="${RLBL}">Base Font Size</span>
        <input type="range" min="11" max="15" step="0.5" value="${P.fontSize}" data-rng="fontSize" style="width:160px;accent-color:var(--amber);">
        <span data-lbl="fontSize" style="color:#a1a1aa;font-size:10px;width:36px;">${P.fontSize}px</span>
      </div>
      <span style="${SEC}">DATA DENSITY</span>
      <div style="${ROW}"><span style="${RLBL}">Table Density</span>${seg(['compact','normal','relaxed'],P.density,'density')}</div>
      <div style="${ROW}"><span style="${RLBL}">Scrollbar Width</span>${seg(['2','4','6'],String(P.scrollW),'scrollW')}
        <span style="color:#555;font-size:9px;margin-left:4px;">px</span>
      </div>`;

    if(tab==='COLORS') return `
      <span style="${SEC}">ACCENT & THEME</span>
      <div style="${ROW}"><span style="${RLBL}">Primary Accent</span>${swatchRow(ACCENT_PRESETS,P.orange,'orange')}</div>
      <div style="${ROW}"><span style="${RLBL}">Secondary Accent</span>${swatchRow(CYAN_PRESETS,P.cyan,'cyan')}</div>
      <span style="${SEC}">DIRECTIONAL INDICATORS</span>
      <div style="${ROW}"><span style="${RLBL}">Up / Gain</span>${swatchRow(GREEN_PRESETS,P.green,'green')}</div>
      <div style="${ROW}"><span style="${RLBL}">Down / Loss</span>${swatchRow(RED_PRESETS,P.red,'red')}</div>
      <div style="${ROW}"><span style="${RLBL}">Neutral / Flat</span>${swatchRow(AMBER_PRESETS,P.amber,'amber')}</div>`;

    if(tab==='WINDOWS') return `
      <span style="${SEC}">WINDOW CHROME</span>
      <div style="${ROW}"><span style="${RLBL}">Border Opacity</span>
        <input type="range" min="0" max="40" step="2" value="${P.winBdrAlpha}" data-rng="winBdrAlpha" style="width:160px;accent-color:var(--amber);">
        <span data-lbl="winBdrAlpha" style="color:#a1a1aa;font-size:10px;width:36px;">${P.winBdrAlpha}%</span>
      </div>
      <div style="${ROW}"><span style="${RLBL}">Titlebar Accent</span>
        <input type="range" min="20" max="100" step="5" value="${P.winTopAlpha}" data-rng="winTopAlpha" style="width:160px;accent-color:var(--amber);">
        <span data-lbl="winTopAlpha" style="color:#a1a1aa;font-size:10px;width:36px;">${P.winTopAlpha}%</span>
      </div>
      <div style="${ROW}"><span style="${RLBL}">Drop Shadow</span>${seg(['off','soft','strong'],P.winShadow,'winShadow')}</div>
      <span style="${SEC}">BACKGROUND</span>
      <div style="${ROW}"><span style="${RLBL}">Desktop</span>${seg(['pitch','dark','charcoal'],P.bgPreset,'bgPreset')}</div>`;

    if(tab==='CHARTS') return `
      <span style="${SEC}">CANDLESTICK COLORS</span>
      <p style="color:#555;font-size:9px;letter-spacing:.05em;margin-bottom:14px;">Changes apply to new charts opened after saving.</p>
      <div style="${ROW}"><span style="${RLBL}">Candle Up</span>${swatchRow(GREEN_PRESETS,P.chartUp,'chartUp')}</div>
      <div style="${ROW}"><span style="${RLBL}">Candle Down</span>${swatchRow(RED_PRESETS,P.chartDown,'chartDown')}</div>
      <span style="${SEC}">SENTIMENT THRESHOLD</span>
      <div style="${ROW}"><span style="${RLBL}">Up/Down Threshold</span>
        <input type="range" min="0.5" max="10" step="0.5" value="${P.sentThresh}" data-rng="sentThresh" style="width:160px;accent-color:var(--amber);">
        <span data-lbl="sentThresh" style="color:#a1a1aa;font-size:10px;width:36px;">${P.sentThresh}%</span>
      </div>
      <p style="color:#555;font-size:9px;letter-spacing:.05em;margin-top:4px;">Prices within &plusmn;${P.sentThresh}% of zero shown as neutral.</p>`;

    return '';
  }

  let activeTab='DISPLAY';
  const TABS=['DISPLAY','COLORS','WINDOWS','CHARTS'];
  const TABBAR_STYLE='display:flex;align-items:center;border-bottom:1px solid #1a1a1a;padding:0 14px;flex-shrink:0;background:#0a0a0a;';
  const FOOTER_STYLE='display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:8px 14px;border-top:1px solid #1a1a1a;flex-shrink:0;background:#0a0a0a;';

  function render(){
    const tabBar=TABS.map(t=>`<button data-tab="${t}" style="${t===activeTab?
      'cursor:pointer;padding:5px 14px;font-size:9px;border:none;border-bottom:2px solid var(--amber);background:transparent;color:var(--amber);letter-spacing:.1em;font-family:var(--font);outline:none;':
      'cursor:pointer;padding:5px 14px;font-size:9px;border:none;border-bottom:2px solid transparent;background:transparent;color:#555;letter-spacing:.1em;font-family:var(--font);outline:none;'
    }">${t}</button>`).join('');

    // Write directly into el (the wbody) — no outer wrapper div needed
    el.innerHTML=
      `<div style="${TABBAR_STYLE}">${tabBar}<div style="flex:1;"></div>`+
      `<button data-pdf-reset style="cursor:pointer;padding:3px 10px;font-size:9px;border:1px solid #2c2c2c;border-radius:2px;background:transparent;color:#555;letter-spacing:.08em;font-family:var(--font);outline:none;">RESET DEFAULTS</button></div>`+
      `<div style="flex:1;overflow-y:auto;padding:18px 20px;">${tabContent(activeTab)}</div>`+
      `<div style="${FOOTER_STYLE}"><span style="color:#555;font-size:9px;letter-spacing:.05em;">Changes apply immediately — click SAVE to persist.</span>`+
      `<button data-pdf-save style="cursor:pointer;padding:4px 16px;font-size:9px;border:1px solid var(--amber);border-radius:2px;background:transparent;color:var(--amber);letter-spacing:.1em;font-family:var(--font);outline:none;">SAVE</button></div>`;

    // Tab switching
    el.querySelectorAll('[data-tab]').forEach(btn=>{
      btn.addEventListener('click',()=>{activeTab=btn.dataset.tab;render();});
    });

    // Segmented controls & font buttons
    el.querySelectorAll('[data-seg-action]').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const action=btn.dataset.segAction;
        const val=btn.dataset.segVal;
        if(action==='font')          P.font=val;
        else if(action==='density')  P.density=val;
        else if(action==='scrollW')  P.scrollW=parseInt(val);
        else if(action==='winShadow')P.winShadow=val;
        else if(action==='bgPreset') P.bgPreset=val;
        applyPrefs(P);
        render();
      });
    });

    // Range sliders — live update label + apply
    el.querySelectorAll('[data-rng]').forEach(inp=>{
      inp.addEventListener('input',()=>{
        const key=inp.dataset.rng;
        const v=parseFloat(inp.value);
        P[key]=v;
        const suffix=key==='fontSize'?'px':'%';
        const lbl=el.querySelector(`[data-lbl="${key}"]`);
        if(lbl)lbl.textContent=v+suffix;
        applyPrefs(P);
      });
    });

    // Color swatches (spans) and color pickers (inputs)
    el.querySelectorAll('[data-sw]').forEach(sw=>{
      const evt=sw.tagName==='INPUT'?'input':'click';
      sw.addEventListener(evt,()=>{
        const key=sw.dataset.sw;
        P[key]=sw.tagName==='INPUT'?sw.value:sw.dataset.val;
        applyPrefs(P);
        if(sw.tagName!=='INPUT')render();
      });
    });

    // Save & Reset — scoped to el
    el.querySelector('[data-pdf-save]')?.addEventListener('click',()=>{
      savePrefs(P);
      (window as any).clog?.('PDF: Preferences saved.','cl-info');
    });
    el.querySelector('[data-pdf-reset]')?.addEventListener('click',()=>{
      P={...PREFS_DEFAULTS};
      applyPrefs(P);
      savePrefs(P);
      render();
      (window as any).clog?.('PDF: Reset to defaults.','cl-info');
    });
  }

  render();
}
