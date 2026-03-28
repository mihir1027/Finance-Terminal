import { API, fp, fl, ld } from '../../core/utils.js';

window._modl = window._modl || {};
export async function doModl(el, tk, wid) {
  el.style.cssText='display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML = ld(`Building model: ${tk}…`);
  let r;
  try { r = await fetch(`${API}/modl/${tk}`).then(x=>x.json()); }
  catch(e) { el.innerHTML=`<div class="err">Network error: ${e}</div>`; return; }
  if (!r.ok) { el.innerHTML=`<div class="err">${r.error}</div>`; return; }

  let view = 'quarterly'; // 'quarterly' | 'annual'

  // Format helpers
  function fmtNum(v) {
    if (v===null||v===undefined) return '—';
    const abs=Math.abs(v), neg=v<0;
    const str=abs.toFixed(3).replace(/\B(?=(\d{3})+(?!\d))/g,',');
    return neg ? `(${str})` : str;
  }
  function fmtPct(v) { return v===null||v===undefined ? '—' : (v*100).toFixed(1)+'%'; }
  function fmtEps(v) { return v===null||v===undefined ? '—' : (v<0?'-':'')+'$'+Math.abs(v).toFixed(2); }
  function fmtShares(v) { return v===null||v===undefined ? '—' : v.toFixed(3).replace(/\B(?=(\d{3})+(?!\d))/g,','); }

  function cellVal(v, fmt, colType) {
    if (colType==='estimate') return `<td class="est">—</td>`;
    if (v===null||v===undefined) return `<td style="color:var(--dim)">—</td>`;
    let txt, neg=false;
    if      (fmt==='pct')    { txt=fmtPct(v);    neg=v<0; }
    else if (fmt==='eps')    { txt=fmtEps(v);    neg=v<0; }
    else if (fmt==='shares') { txt=fmtShares(v); neg=false; }
    else                     { txt=fmtNum(v);    neg=v<0; }
    const cls=[];
    if (neg)               cls.push('neg');
    if (colType==='annual') cls.push('ann');
    return `<td${cls.length?' class="'+cls.join(' ')+'"':''}>${txt}</td>`;
  }

  function render() {
    // Filter columns and track their original indices into row.values
    const filteredCols = view === 'annual'
      ? r.columns.map((c,i)=>({col:c,idx:i})).filter(({col})=>col.type==='annual')
      : r.columns.map((c,i)=>({col:c,idx:i}));
    const nc = filteredCols.length;

    const thCols = filteredCols.map(({col}) =>
      `<th${col.type==='annual'?' class="ann"':''}>${col.label}</th>`
    ).join('');

    // Frozen (label) column — one td per row, no data cells
    function buildFrozenSection(sec) {
      let html = `<tr class="modl-sec-hdr"><td class="lbl-col">${sec.title}</td></tr>`;
      for (const row of sec.rows) {
        if (row.blank)   { html+=`<tr style="height:4px"><td class="lbl-col"></td></tr>`; continue; }
        if (row.section) { html+=`<tr class="modl-sect"><td class="lbl-col">${row.label}</td></tr>`; continue; }
        html += `<tr${row.bold?' class="modl-bold"':''}><td class="lbl-col">${row.label}</td></tr>`;
      }
      return html;
    }

    // Scrollable data columns — no label cell, empty placeholders keep row heights matched
    function buildScrollSection(sec) {
      let html = `<tr class="modl-sec-hdr"><td colspan="${nc}"></td></tr>`;
      for (const row of sec.rows) {
        if (row.blank)   { html+=`<tr style="height:4px"><td colspan="${nc}"></td></tr>`; continue; }
        if (row.section) { html+=`<tr class="modl-sect"><td colspan="${nc}"></td></tr>`; continue; }
        const cells = filteredCols.map(({col,idx}) => cellVal(row.values[idx], row.fmt, col.type)).join('');
        html += `<tr${row.bold?' class="modl-bold"':''}>${cells}</tr>`;
      }
      return html;
    }

    const toggles = ['quarterly','annual'].map(v=>
      `<button class="sovm-rng${v===view?' active':''}" onclick="window._modl['${wid}'].setView('${v}')">${v.toUpperCase()}</button>`
    ).join('');

    el.innerHTML = `
      <div class="modl-wrap">
        <div class="modl-hdr">
          <span class="modl-hdr-name">${r.name}</span>
          <span class="modl-hdr-sub">${r.ticker} · SEC XBRL · values in millions USD</span>
          <div style="margin-left:auto;display:flex;gap:4px">${toggles}</div>
        </div>
        <div class="modl-body">
          <div class="modl-frozen">
            <table class="modlt">
              <thead><tr><th class="lbl-col"></th></tr></thead>
              <tbody>${r.sections.map(buildFrozenSection).join('')}</tbody>
            </table>
          </div>
          <div class="modl-scroll">
            <table class="modlt">
              <thead><tr>${thCols}</tr></thead>
              <tbody>${r.sections.map(buildScrollSection).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // Sync vertical scroll from data div → frozen label div
    const scrollDiv = el.querySelector('.modl-scroll');
    const frozenDiv = el.querySelector('.modl-frozen');
    if (scrollDiv && frozenDiv) {
      scrollDiv.addEventListener('scroll', () => {
        frozenDiv.scrollTop = scrollDiv.scrollTop;
      }, { passive: true });
    }
  }

  window._modl[wid] = {
    setView(v) { view=v; render(); }
  };
  render();
}

// ══════════════════════════════════════════════
//  SOVM · Sovereign Debt Monitor
// ══════════════════════════════════════════════
