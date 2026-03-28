import { API, fp, ld, dc, charts } from '../../core/utils.js';
import { registerFTimer } from '../../core/windowManager.js';

window._sovm = window._sovm || {};

export async function doSOVM(el, country, wid) {
  el.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%';
  const code = (country || 'US').toUpperCase();
  window._sovm[wid] = { range: '3M', data: null, load: null, setRange: null };

  function buildSparkline(pts) {
    if (!pts || pts.length < 2) return '<span class="sovm-dim">—</span>';
    const W=56, H=16, mn=Math.min(...pts), mx=Math.max(...pts), rng=mx-mn||0.001;
    const coords = pts.map((v,i)=>`${((i/(pts.length-1))*W).toFixed(1)},${(H-((v-mn)/rng)*H).toFixed(1)}`).join(' ');
    const col = pts[pts.length-1] >= pts[0] ? 'var(--red)' : 'var(--green)';
    return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${coords}" fill="none" stroke="${col}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
  }

  function buildBar(cur, lo, hi, avg) {
    if (lo==null||hi==null) return '<span class="sovm-dim">—</span>';
    const W=72, rng=hi-lo||0.001;
    const cp = Math.max(3, Math.min(W-3, ((cur-lo)/rng)*W));
    const ap = avg!=null ? Math.max(1, Math.min(W-1, ((avg-lo)/rng)*W)) : null;
    let s = `<rect x="0" y="6" width="${W}" height="3" rx="1.5" fill="var(--bg3)"/>`;
    if (ap!=null) s += `<polygon points="${ap.toFixed(1)},2 ${(ap-3.5).toFixed(1)},12 ${(ap+3.5).toFixed(1)},12" fill="var(--amber)"/>`;
    s += `<circle cx="${cp.toFixed(1)}" cy="7.5" r="3.8" fill="var(--cyan)" opacity="0.9"/>`;
    return `<svg width="${W}" height="16" viewBox="0 0 ${W} 16">${s}</svg>`;
  }

  function sdCell(v) {
    if (v==null) return '<span class="sovm-dim">—</span>';
    const s = (v>0?'+':'')+v.toFixed(2);
    if (Math.abs(v) >= 2)   return `<span class="sovm-up">${s}</span>`;
    if (Math.abs(v) >= 1.5) return `<span style="color:var(--amber)">${s}</span>`;
    return `<span class="sovm-dim">${s}</span>`;
  }

  function rsiCell(v) {
    if (v==null) return `<td class="sovm-n sovm-dim">—</td>`;
    const s = v.toFixed(1);
    if (v >= 70) return `<td class="sovm-n sovm-hi">${s}</td>`;
    if (v <= 30) return `<td class="sovm-n sovm-lo">${s}</td>`;
    return `<td class="sovm-n sovm-dim">${s}</td>`;
  }

  function buildRow(row, range) {
    const isBps = row.unit === 'bps';
    const st = row.stats?.[range] || {};
    const cur = isBps ? (row.current>=0?'+':'')+row.current.toFixed(1) : row.current.toFixed(3);
    const chg = st.chg_bps;
    const chgS = chg!=null ? (chg>0?'+':'')+chg.toFixed(1) : '—';
    const chgCls = chg>0 ? 'sovm-up' : chg<0 ? 'sovm-dn' : 'sovm-dim';
    const diff = st.diff_bps;
    const diffS = diff!=null ? (diff>0?'+':'')+diff.toFixed(1) : '—';
    const diffCls = diff>0 ? 'sovm-up' : diff<0 ? 'sovm-dn' : 'sovm-dim';
    const fmt = (v) => v!=null ? (isBps ? v.toFixed(1) : v.toFixed(3)) : '—';
    const rowId = `sovm-r-${wid}-${row.label.replace(/[^a-z0-9]/gi,'')}`;
    return `<tr class="sovm-row" id="${rowId}">
      <td>${row.label}</td>
      <td class="sovm-n">${cur}</td>
      <td class="sovm-n ${chgCls}">${chgS}</td>
      <td class="sovm-c">${buildSparkline(row.sparkline)}</td>
      <td class="sovm-n">${sdCell(st.sd_day)}</td>
      <td class="sovm-n sovm-dim">${fmt(st.low)}</td>
      <td class="sovm-c">${buildBar(row.current, st.low, st.high, st.avg)}</td>
      <td class="sovm-n sovm-dim">${fmt(st.high)}</td>
      <td class="sovm-n sovm-dim">${fmt(st.avg)}</td>
      <td class="sovm-n ${diffCls}">${diffS}</td>
      <td class="sovm-n">${sdCell(st.sd_from_avg)}</td>
      ${rsiCell(row.rsi)}
    </tr>`;
  }

  function buildTable(d, range) {
    const hdr = `<tr>
      <th style="text-align:left;min-width:110px">Security</th>
      <th>Yield</th><th>Chg</th><th style="text-align:center">~~~</th>
      <th title="Std devs of today's daily move (${range} window)">#SDΔ/d</th>
      <th>Low</th><th style="text-align:center;min-width:80px">Range (${range})</th>
      <th>High</th><th>Avg</th><th>+/- bps</th>
      <th title="Std devs from ${range} average">#SD</th><th>RSI</th>
    </tr>`;
    const sect = (t) => `<tr class="sovm-sect"><td colspan="12">${t}</td></tr>`;
    const na   = (t) => `<tr class="sovm-row"><td colspan="12" class="sovm-na">${t}</td></tr>`;
    let body = '';
    if (d.benchmarks?.length)  { body += sect('── BENCHMARKS');            body += d.benchmarks.map(r=>buildRow(r,range)).join(''); }
    if (d.curves?.length)      { body += sect('── CURVES (bps)');           body += d.curves.map(r=>buildRow(r,range)).join(''); }
    if (d.butterflies?.length) { body += sect('── BUTTERFLIES (bps)');      body += d.butterflies.map(r=>buildRow(r,range)).join(''); }
    body += sect('── INFLATION');
    body += d.inflation?.length ? d.inflation.map(r=>buildRow(r,range)).join('') : na('TIPS breakeven — premium data required');
    body += sect('── CDS SPREAD');
    body += d.cds?.length ? d.cds.map(r=>buildRow(r,range)).join('') : na('CDS data — premium data required');
    return `<table class="sovmt"><thead>${hdr}</thead><tbody>${body}</tbody></table>`;
  }

  function render() {
    const d = window._sovm[wid].data;
    if (!d) return;
    const range = window._sovm[wid].range;
    const COUNTRIES = ['US','DE','GB','JP','FR','IT','ES','CA','AU','CN','CH'];
    const copts = COUNTRIES.map(c=>`<option value="${c}" ${c===d.country?'selected':''}>${c}${c===d.country?' '+d.flag:''}</option>`).join('');
    const rngs  = ['1M','3M','6M','1Y'].map(r=>`<button class="sovm-rng ${r===range?'active':''}" onclick="window._sovm['${wid}'].setRange('${r}')">${r}</button>`).join('');
    const rCls  = d.rating?.startsWith('AAA')?'rAAA':d.rating?.startsWith('AA')?'rAAm':d.rating?.startsWith('BBB')?'rBBB':'rBBp';
    el.innerHTML = `
      <div class="sovm-topbar">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <select class="sovm-sel" onchange="window._sovm['${wid}'].load(this.value)">${copts}</select>
          <span style="font-size:14px">${d.flag}</span>
          <span style="color:var(--text);font-size:11px;font-weight:600">${d.name}</span>
          <span class="rating-badge ${rCls}">${d.rating}</span>
          ${d.debt_gdp!=null?`<span class="sovm-dim" style="font-size:9px">Debt/GDP <span style="color:var(--amber)">${d.debt_gdp}%</span></span>`:''}
          <span class="sovm-dim" style="font-size:9px">${d.currency}</span>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <span class="sovm-dim" style="font-size:9px;margin-right:4px">RANGE</span>
          ${rngs}
          <span class="sovm-dim" style="font-size:9px;margin-left:10px">${d.ts?d.ts.substring(0,10):''}</span>
          <span class="sovm-dim" style="font-size:9px;margin-left:6px">↻ <span id="sovm-cd-${wid}">5m00s</span></span>
        </div>
      </div>
      <div class="sovm-body">${buildTable(d, range)}</div>
    `;
  }

  function flashRows(oldData, newData) {
    const allSections = ['benchmarks','curves','butterflies'];
    const oldMap = {};
    for (const sec of allSections)
      for (const row of (oldData[sec]||[])) oldMap[row.label] = row.current;
    for (const sec of allSections) {
      for (const row of (newData[sec]||[])) {
        const prev = oldMap[row.label];
        if (prev == null || row.current === prev) continue;
        const rowEl = document.getElementById(`sovm-r-${wid}-${row.label.replace(/[^a-z0-9]/gi,'')}`);
        if (!rowEl) continue;
        rowEl.classList.remove('flash-up','flash-dn');
        void rowEl.offsetWidth;
        // Yield up = bad (red = flash-dn), yield down = good (green = flash-up)
        rowEl.classList.add(row.current > prev ? 'flash-dn' : 'flash-up');
        setTimeout(()=>rowEl.classList.remove('flash-up','flash-dn'), 800);
      }
    }
  }

  async function load(c) {
    const prevData = window._sovm[wid].data;
    const isRefresh = !!prevData && prevData.country === c;
    const body = el.querySelector('.sovm-body');
    if (!isRefresh) {
      if (body) body.innerHTML = ld(`Loading ${c}…`);
      else el.innerHTML = ld(`Loading SOVM · ${c}…`);
    }
    try {
      const r = await fetch(`${API}/sovm/${c}`).then(x=>x.json());
      if (!r.ok) { el.innerHTML = `<div class="err">${r.error}</div>`; return; }
      window._sovm[wid].data = r;
      render();
      if (isRefresh) flashRows(prevData, r);
    } catch(e) { el.innerHTML = `<div class="err">Backend offline.<br>${e}</div>`; }
  }

  window._sovm[wid].load     = load;
  window._sovm[wid].setRange = function(r) {
    window._sovm[wid].range = r;
    render();
  };

  await load(code);

  // ── Auto-refresh: 1-second tick, reload every 5 min ──────────────────
  const REFRESH_SECS = 300;
  let countdown = REFRESH_SECS;
  registerFTimer(wid, setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      countdown = REFRESH_SECS;
      load((window._sovm[wid].data?.country) || code);
    }
    const cd = document.getElementById(`sovm-cd-${wid}`);
    if (cd) cd.textContent = `${Math.floor(countdown/60)}m${String(countdown%60).padStart(2,'0')}s`;
  }, 1000));
}
