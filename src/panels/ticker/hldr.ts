import { API, fl, fp, ld } from '../../core/utils.js';

export async function doHldr(el, tk, wid) {
  el.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%';
  el.innerHTML = ld(`HLDR: ${tk}`);
  try {
    const r = await fetch(`${API}/hldr/${tk}`).then(x => x.json());
    if (!r.ok) { el.innerHTML = `<div class="err">${r.error}</div>`; return; }

    const expPct = r.expenseRatio != null
      ? (r.expenseRatio < 1 ? (r.expenseRatio * 100).toFixed(2) : r.expenseRatio.toFixed(2)) + '%'
      : '—';

    const rows = r.holdings.map((h, i) => {
      const chgHtml = h.sharesChg != null
        ? `<span class="${h.sharesChg >= 0 ? 'up' : 'down'}">${h.sharesChg >= 0 ? '+' : ''}${h.sharesChg.toLocaleString()}</span>`
        : '<span style="color:var(--dim)">—</span>';
      const posHtml = h.shares != null
        ? h.shares.toLocaleString()
        : '<span style="color:var(--dim)">—</span>';
      const mvHtml  = h.marketValue != null ? fl(h.marketValue) : '<span style="color:var(--dim)">—</span>';
      const wPct    = h.weight != null ? fp(h.weight, 2) + '%' : '—';
      return `<tr>
        <td class="hldr-n">${i + 1}</td>
        <td class="hldr-sec">${h.name}</td>
        <td class="hldr-tk">${h.ticker || '—'}</td>
        <td style="color:var(--dim)">ETF</td>
        <td class="hldr-num">${posHtml}</td>
        <td class="hldr-num">${chgHtml}</td>
        <td class="hldr-num">${wPct}</td>
        <td class="hldr-num">${mvHtml}</td>
        <td class="hldr-date">${r.filingDate || '—'}</td>
      </tr>`;
    }).join('');

    const insightsHtml = r.trades && r.trades.length
      ? r.trades.map(t => {
          const buy = t.direction === 'Buy';
          const col = buy ? 'var(--green)' : 'var(--red)';
          const sign = buy ? '+' : '-';
          const note = t.note ? `<span style="color:var(--dim);font-size:9px;margin-left:6px">${t.note}</span>` : '';
          return `<div class="hldr-ins-row">
            <span class="hldr-ins-dir" style="color:${col}">${t.direction.toUpperCase()}</span>
            <span class="hldr-ins-body">
              <b>${t.company}</b>${t.ticker ? ` <span style="color:var(--cyan)">${t.ticker}</span>` : ''} &nbsp;${sign}${(t.shares || 0).toLocaleString()} shares
              <span style="color:var(--dim)">(${sign}${Math.abs(t.etfPct || 0).toFixed(2)}% of fund)</span>${note}
            </span>
          </div>`;
        }).join('')
      : '';

    el.innerHTML = `
      <div class="hldr-hdr">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div>
            <div class="hldr-name">${r.name}</div>
            <div class="hldr-sub">${r.ticker} &nbsp;·&nbsp; ${r.legalType || r.quoteType || 'ETF'} &nbsp;·&nbsp; ${r.fundFamily}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="hldr-aum">${r.totalAssetsFmt}</div>
            <div class="hldr-meta">Exp ${expPct} &nbsp;·&nbsp; ${r.numHoldings} holdings${r.filingDate ? ' &nbsp;·&nbsp; ' + r.filingDate : ''}${r.prevDate ? '<span style="color:var(--dim)"> vs ' + r.prevDate + '</span>' : ''}${r.holdingsSource ? ' &nbsp;·&nbsp; <span style="color:var(--cyan)">' + r.holdingsSource + '</span>' : ''}</div>
          </div>
        </div>
      </div>
      <div class="hldr-scroll">
        <table class="hldrt">
          <thead><tr>
            <th class="hldr-n">#</th>
            <th style="text-align:left">SECURITY</th>
            <th>TICKER</th>
            <th>SOURCE</th>
            <th>POSITION</th>
            <th>POS CHG</th>
            <th>% NET</th>
            <th>CURR MV</th>
            <th>FILING DATE</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:var(--dim);padding:20px">No holdings data available</td></tr>'}</tbody>
        </table>
      </div>
      ${insightsHtml ? `
      <div class="hldr-ins-wrap">
        <div class="hldr-ins-hdr">INSIGHTS &nbsp;·&nbsp; ${r.isArk ? "TODAY'S TRADES" : 'NOTABLE CHANGES' + (r.prevDate ? ' vs ' + r.prevDate : '')}</div>
        <div class="hldr-ins-body-wrap">${insightsHtml}</div>
      </div>` : ''}
    `;
  } catch(e) { el.innerHTML = `<div class="err">Backend offline.<br>${e}</div>`; }
}
