// ── PLACEHOLDER ──
export function doPlaceholder(el, label, desc) {
  el.style.cssText='display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:8px;';
  el.innerHTML=`
    <div style="font-size:28px;color:#1c1c1c;">◈</div>
    <div style="font-size:11px;color:#fbbf24;letter-spacing:.15em;font-weight:700;">${label}</div>
    <div style="font-size:9px;color:var(--dim);">${desc}</div>
    <div style="margin-top:8px;font-size:8px;color:#2a2a2a;letter-spacing:.08em;">NOT IMPLEMENTED</div>
  `;
}
