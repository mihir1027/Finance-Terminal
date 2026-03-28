import { API, fp, cd, pill, ld } from '../../core/utils.js';
import { ow } from '../../core/windowManager.js';

export function ratingClass(r){
  if(!r) return '';
  const c=r.replace(/[^A-Za-z+\-]/g,'').replace('+','p').replace('-','m');
  return `r${c}`;
}

// Basis point change color
function bpColor(v){ return v==null?'':v>0?'down':v<0?'up':'flat'; } // rising yields = negative for bonds
function bpSign(v){ return v==null?'—':(v>0?'+':'')+v.toFixed(1)+'bp'; }

// ── SOVG World Monitor ──────────────────────────────────────────────────
export async function doSovgWorld(el, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=`
    <div class="sovg-toolbar" id="sovg-tb-${wid}">
      <span style="font-size:9px;color:var(--dim);letter-spacing:.1em;margin-right:4px">REGION:</span>
      ${['All','Americas','Europe','Asia-Pacific','Middle East','Africa'].map(r=>`
        <button class="rg-btn${r==='All'?' active':''}" data-r="${r==='All'?'all':r}" onclick="window._sovgReg_${wid}('${r==='All'?'all':r}')">${r.toUpperCase()}</button>
      `).join('')}
      <span style="color:var(--bdr2);margin:0 6px">|</span>
      <input class="sovg-search" id="sovg-srch-${wid}" type="text" placeholder="Search country…" oninput="window._sovgSearch_${wid}(this.value)">
      <span style="color:var(--bdr2);margin:0 6px">|</span>
      <button class="rg-btn" onclick="window._sovgRefresh_${wid}()">↻ REFRESH</button>
      <span style="font-size:8px;color:var(--dim);margin-left:auto">Click country for full curve · Sorted by 10Y yield ↓</span>
    </div>
    <div style="flex:1;overflow-y:auto" id="sovg-table-wrap-${wid}">
      <div class="load"><div class="sp"></div><span>Loading world bond data… (may take 30-60s for all countries)</span></div>
    </div>
  `;

  let allData = null;
  let curRegion = 'all';
  let curSearch = '';
  let sortKey = 'yield10y';
  let sortDir = -1; // -1 = desc

  async function load(region){
    const wrap = document.getElementById(`sovg-table-wrap-${wid}`);
    if(!wrap) return;
    if(!allData){
      wrap.innerHTML=`<div class="load"><div class="sp"></div><span>Fetching sovereign yields for ${region==='all'?'all 40+ countries':'region'}…</span></div>`;
    }
    try{
      const r = await fetch(`${API}/sovg?region=${region}`).then(x=>x.json());
      if(!r.ok){ wrap.innerHTML=`<div class="err">${r.error}</div>`; return; }
      allData = r.bonds;
      renderTable();
    }catch(e){ wrap.innerHTML=`<div class="err">Backend offline. Run app.py<br>${e}</div>`; }
  }

  function renderTable(){
    const wrap = document.getElementById(`sovg-table-wrap-${wid}`);
    if(!wrap || !allData) return;

    let data = allData.filter(b => {
      if(curSearch){
        const q = curSearch.toLowerCase();
        return b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q);
      }
      return true;
    });

    // Sort
    data.sort((a,b)=>{
      let av = a[sortKey], bv = b[sortKey];
      if(av==null) return 1; if(bv==null) return -1;
      return sortDir * (av - bv);
    });

    const usYield = allData.find(b=>b.code==='US')?.yield10y;

    const rows = data.map(b => {
      const y = b.yield10y;
      const yStr = y!=null ? y.toFixed(2)+'%' : '—';
      const d1  = b.chg1d;  const d1c  = bpColor(d1);
      const d1w = b.chg1w;  const d1wc = bpColor(d1w);
      const d1m = b.chg1m;  const d1mc = bpColor(d1m);
      const sp  = b.spreadVsUS;
      const spStr = sp!=null ? (sp>0?'+':'')+sp.toFixed(0)+'bp' : '—';
      const spColor = sp!=null ? (sp>50?'var(--red)':sp<-50?'var(--green)':'var(--text)') : 'var(--dim)';
      const rc = ratingClass(b.rating);
      // Sparkline in canvas
      const sparkId = `spk-${wid}-${b.code}`;
      return `<tr class="data-row" onclick="window._sovgDrill_${wid}('${b.code}')">
        <td><span class="bond-flag">${b.flag}</span></td>
        <td>
          <div class="bond-name">${b.name}</div>
          <div class="bond-ccy">${b.code} · ${b.currency} · ${b.region}</div>
        </td>
        <td><span class="rating-badge ${rc}">${b.rating||'—'}</span></td>
        <td style="font-size:13px;font-weight:700;color:var(--cyan)">${yStr}</td>
        <td class="${d1c}">${d1!=null?bpSign(d1*100):'—'}</td>
        <td class="${d1wc}">${d1w!=null?bpSign(d1w*100):'—'}</td>
        <td class="${d1mc}">${d1m!=null?bpSign(d1m*100):'—'}</td>
        <td style="color:${spColor}">${spStr}</td>
        <td class="spark-cell"><canvas id="${sparkId}" width="80" height="22" class="sovg-spark"></canvas></td>
      </tr>`;
    }).join('');

    wrap.innerHTML=`<table class="sovgt">
      <thead><tr>
        <th></th>
        <th class="${sortKey==='name'?`sort-${sortDir>0?'asc':'desc'}`:''}">COUNTRY</th>
        <th>RATING</th>
        <th class="${sortKey==='yield10y'?`sort-${sortDir>0?'asc':'desc'}`:''}">10Y YIELD</th>
        <th class="${sortKey==='chg1d'?`sort-${sortDir>0?'asc':'desc'}`:''}">1D CHG</th>
        <th class="${sortKey==='chg1w'?`sort-${sortDir>0?'asc':'desc'}`:''}">1W CHG</th>
        <th class="${sortKey==='chg1m'?`sort-${sortDir>0?'asc':'desc'}`:''}">1M CHG</th>
        <th class="${sortKey==='spreadVsUS'?`sort-${sortDir>0?'asc':'desc'}`:''}">VS US (bp)</th>
        <th>1Y TREND</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

    // Draw sparklines
    requestAnimationFrame(()=>{
      data.forEach(b => {
        const canvas = document.getElementById(`spk-${wid}-${b.code}`);
        if(!canvas || !b.sparkline.length) return;
        const ctx = canvas.getContext('2d');
        const vals = b.sparkline.filter(v=>v!=null);
        if(vals.length < 2) return;
        const mn=Math.min(...vals), mx=Math.max(...vals), rng=mx-mn||0.001;
        const last=vals[vals.length-1], first=vals[0];
        const col = last >= first ? '#f87171' : '#4ade80'; // rising yield = red for bond price, green = rally
        ctx.clearRect(0,0,80,22);
        ctx.strokeStyle=col; ctx.lineWidth=1.2;
        ctx.shadowColor=col; ctx.shadowBlur=2;
        ctx.beginPath();
        vals.forEach((v,i)=>{
          const x=(i/(vals.length-1))*78+1;
          const y=22-((v-mn)/rng)*19-1.5;
          i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
        });
        ctx.stroke();
      });
    });
  }

  // Sort on column click
  const tableWrap = document.getElementById(`sovg-table-wrap-${wid}`);
  if(tableWrap) tableWrap.style.cssText='flex:1;overflow-y:auto';
  document.getElementById(`sovg-table-wrap-${wid}`)?.addEventListener('click', e=>{
    const th = e.target.closest('th');
    if(!th) return;
    const colMap = {2:'name',3:'yield10y',4:'chg1d',5:'chg1w',6:'chg1m',7:'spreadVsUS'};
    const ci = Array.from(th.parentElement.children).indexOf(th);
    if(colMap[ci]){
      if(sortKey===colMap[ci]) sortDir*=-1; else {sortKey=colMap[ci];sortDir=-1;}
      renderTable();
    }
  });

  window[`_sovgReg_${wid}`]=(r)=>{
    curRegion=r;
    document.querySelectorAll(`#sovg-tb-${wid} .rg-btn`).forEach(b=>b.classList.toggle('active',b.dataset.r===r));
    allData=null; load(r);
  };
  window[`_sovgSearch_${wid}`]=(q)=>{ curSearch=q; renderTable(); };
  window[`_sovgRefresh_${wid}`]=()=>{ allData=null; load(curRegion); };
  window[`_sovgDrill_${wid}`]=(code)=>{
    ow('sovg',code,`SOVG · ${code}`,680,580,(e,tk,id)=>doSovgCountry(e,code,id));
  };

  load('all');
}

// ── SOVG Country Detail ─────────────────────────────────────────────────
export async function doSovgCountry(el, code, wid){
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML=`<div class="load"><div class="sp"></div><span>Loading ${code} sovereign yield curve…</span></div>`;

  const curveCid   = `sovg-curve-${wid}`;
  const historyCid = `sovg-hist-${wid}`;
  dc(curveCid); dc(historyCid);

  try{
    const r = await fetch(`${API}/sovg/${code}`).then(x=>x.json());
    if(!r.ok){ el.innerHTML=`<div class="err">${r.error}</div>`; return; }

    const by = r.benchmarkYield;
    const byStr = by!=null ? by.toFixed(3)+'%' : '—';
    const byColor = by!=null ? 'var(--cyan)' : 'var(--dim)';
    const rc = ratingClass(r.rating);
    const slopeCls = r.isInverted ? 'down' : 'up';
    const spreadCls = r.spreadVsUSbp!=null ? (r.spreadVsUSbp>100?'down':r.spreadVsUSbp<-50?'up':'') : '';

    // Tenor row — only tenors with data
    const validCurve = r.curve.filter(p=>p.yield!=null);
    const tenorCells = validCurve.map(p=>`
      <div class="ct">
        <div class="ct-t">${p.tenor}</div>
        <div class="ct-y">${p.yield.toFixed(3)}%</div>
      </div>
    `).join('');

    el.innerHTML=`
      <div class="sovg-hdr">
        <div class="sovg-flag-name">
          <div class="sovg-flag-lg">${r.flag}</div>
          <div>
            <div class="sovg-ctry-name">${r.name}</div>
            <div class="sovg-ctry-sub">
              ${r.code} · ${r.currency} · ${r.region}<br>
              Rating: <span class="rating-badge ${rc}">${r.rating||'—'}</span>
              &nbsp;·&nbsp; 52W: <span class="up">${r.lo52!=null?r.lo52.toFixed(2)+'%':'—'}</span>
              &nbsp;–&nbsp; <span class="down">${r.hi52!=null?r.hi52.toFixed(2)+'%':'—'}</span>
            </div>
          </div>
        </div>
        <div>
          <div class="sovg-bench-yield" style="color:${byColor}">${byStr}</div>
          <div class="sovg-bench-lbl">${r.benchmarkTenor} BENCHMARK YIELD</div>
          <div style="font-size:9px;text-align:right;margin-top:4px">
            <button class="pb" onclick="runCmd('SOVG')" style="font-size:8px">← ALL COUNTRIES</button>
          </div>
        </div>
      </div>

      <div class="sovg-metrics" style="grid-template-columns:repeat(5,1fr)">
        <div class="sm"><div class="sm-k">CURVE SLOPE</div><div class="sm-v ${slopeCls}">${r.slopeBp!=null?(r.slopeBp>0?'+':'')+r.slopeBp+'bp':'—'}</div></div>
        <div class="sm"><div class="sm-k">SHAPE</div><div class="sm-v ${slopeCls}">${r.isInverted===true?'INVERTED':r.isInverted===false?'NORMAL':'—'}</div></div>
        <div class="sm"><div class="sm-k">SPREAD VS US</div><div class="sm-v ${spreadCls}">${r.spreadVsUSbp!=null?(r.spreadVsUSbp>0?'+':'')+r.spreadVsUSbp+'bp':'—'}</div></div>
        <div class="sm"><div class="sm-k">52W HIGH</div><div class="sm-v down">${r.hi52!=null?r.hi52.toFixed(2)+'%':'—'}</div></div>
        <div class="sm"><div class="sm-k">52W LOW</div><div class="sm-v up">${r.lo52!=null?r.lo52.toFixed(2)+'%':'—'}</div></div>
      </div>

      <div class="sovg-section-lbl">YIELD CURVE — ALL AVAILABLE TENORS (ASCENDING DURATION)</div>
      <div class="curve-tenors" style="grid-template-columns:repeat(${validCurve.length},1fr)">${tenorCells}</div>

      <div class="sovg-section-lbl">YIELD CURVE CHART</div>
      <div class="sovg-chart-wrap" style="height:140px"><canvas id="${curveCid}"></canvas></div>

      <div class="sovg-section-lbl">${r.benchmarkTenor} YIELD — 2Y HISTORY</div>
      <div class="sovg-chart-wrap" style="height:110px"><canvas id="${historyCid}"></canvas></div>

      <div style="padding:6px 10px;font-size:8px;color:var(--dim);flex-shrink:0;line-height:1.7;border-top:1px solid var(--bdr)">
        ${r.isInverted===true
          ? `<b style="color:var(--red)">INVERTED CURVE:</b> Short-end rates exceed long-end — potential late-cycle signal. Historical recession predictor with 12-18mo lag.`
          : `<b style="color:var(--green)">NORMAL CURVE:</b> Long-end yields exceed short-end — typical expansion regime with positive carry.`}
        ${r.spreadVsUSbp!=null ? ` Spread vs US 10Y: <b style="color:${r.spreadVsUSbp>100?'var(--red)':r.spreadVsUSbp<0?'var(--green)':'var(--text)'}">${r.spreadVsUSbp>0?'+':''}${r.spreadVsUSbp}bp</b>.` : ''}
      </div>
    `;

    // Draw yield curve chart
    requestAnimationFrame(()=>{
      const ctx1 = document.getElementById(curveCid)?.getContext('2d');
      if(ctx1 && validCurve.length >= 2){
        charts[curveCid] = new Chart(ctx1, {
          type:'line',
          data:{
            labels: validCurve.map(p=>p.tenor),
            datasets:[{
              data: validCurve.map(p=>p.yield),
              borderColor:'#38bdf8', borderWidth:2,
              pointRadius:4, pointBackgroundColor:'#38bdf8', pointBorderColor:'#0d0d0d',
              fill:true, backgroundColor:'rgba(56,189,248,0.06)', tension:.3
            }]
          },
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:false},tooltip:{backgroundColor:'#111',borderColor:'#252525',borderWidth:1,titleColor:'#38bdf8',bodyColor:'#d1d5db',titleFont:{family:'JetBrains Mono',size:9},bodyFont:{family:'JetBrains Mono',size:10},callbacks:{label:ctx=>`  ${ctx.parsed.y.toFixed(3)}%`}}},
            scales:{
              x:{grid:{color:'#161616'},ticks:{color:'#6b7280',font:{family:'JetBrains Mono',size:9}},border:{color:'#252525'}},
              y:{grid:{color:'#161616'},ticks:{color:'#6b7280',font:{family:'JetBrains Mono',size:9},callback:v=>v.toFixed(2)+'%'},border:{color:'#252525'}}
            },animation:{duration:300}}
        });
      }

      // Draw 2Y history chart
      const ctx2 = document.getElementById(historyCid)?.getContext('2d');
      const hDates = r.history.dates, hVals = r.history.values;
      if(ctx2 && hVals.length >= 2){
        const first = hVals.find(v=>v!=null), last = hVals.filter(v=>v!=null).pop();
        const risingYield = last >= first; // rising yield = bond price falling
        const col = risingYield ? '#f87171' : '#4ade80';
        charts[historyCid] = new Chart(ctx2, {
          type:'line',
          data:{
            labels: hDates,
            datasets:[{data:hVals, borderColor:col, borderWidth:1.5, pointRadius:0, fill:true, backgroundColor:risingYield?'rgba(248,113,113,.04)':'rgba(74,222,128,.04)', tension:.2}]
          },
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{legend:{display:false},tooltip:{mode:'index',intersect:false,backgroundColor:'#111',borderColor:'#252525',borderWidth:1,titleColor:col,bodyColor:'#d1d5db',titleFont:{family:'JetBrains Mono',size:9},bodyFont:{family:'JetBrains Mono',size:10},callbacks:{label:ctx=>`  ${ctx.parsed.y?.toFixed(3)}%`}}},
            scales:{
              x:{display:true,grid:{color:'#0d0d0d'},ticks:{color:'#4b5563',font:{family:'JetBrains Mono',size:8},maxTicksLimit:8,maxRotation:0},border:{color:'#252525'}},
              y:{display:true,grid:{color:'#0d0d0d'},ticks:{color:'#4b5563',font:{family:'JetBrains Mono',size:8},maxTicksLimit:4,callback:v=>v.toFixed(2)+'%'},border:{color:'#252525'}}
            },animation:{duration:250}}
        });
      }
    });

  }catch(e){ el.innerHTML=`<div class="err">Backend offline.<br>${e}</div>`; }
}


// ── GP · GRAPH PLOT ──
