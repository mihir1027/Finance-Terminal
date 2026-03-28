/** Format price: auto-selects decimal places based on magnitude */
export function fp(n: any, d?: number): string {
  if (n == null) return '—';
  const x = parseFloat(n);
  if (isNaN(x)) return '—';
  const dec = d != null ? d : (x >= 1000 ? 0 : x >= 10 ? 2 : x >= 1 ? 3 : 4);
  return x.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** Format large dollar number (T/B/M) */
export function fl(n: any): string {
  if (n == null) return '—';
  const x = parseFloat(n);
  if (isNaN(x)) return '—';
  if (x >= 1e12) return `$${(x / 1e12).toFixed(2)}T`;
  if (x >= 1e9)  return `$${(x / 1e9).toFixed(2)}B`;
  if (x >= 1e6)  return `$${(x / 1e6).toFixed(2)}M`;
  return `$${x.toFixed(0)}`;
}

/** Format volume (K/M/B) */
export function fv(n: any): string {
  if (n == null) return '—';
  const x = parseInt(n);
  if (isNaN(x)) return '—';
  if (x >= 1e9) return `${(x / 1e9).toFixed(1)}B`;
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}K`;
  return String(x);
}

/** Change direction: 'up' | 'down' | 'flat' */
export function cd(v: number): 'up' | 'down' | 'flat' {
  const t = (window as any)._sentThresh ?? 0.05;
  return v > t ? 'up' : v < -t ? 'down' : 'flat';
}

/** Percentage change pill HTML */
export function pill(pct: number | null): string {
  if (pct == null) return `<span style="color:var(--dim)">—</span>`;
  const d = cd(pct), s = pct >= 0 ? '+' : '', a = pct > 0.05 ? '▲' : pct < -0.05 ? '▼' : '●';
  return `<span class="pill ${d}">${a} ${s}${pct.toFixed(2)}%</span>`;
}

/** Loading spinner HTML */
export function ld(m = 'Loading…'): string {
  return `<div class="load"><div class="sp"></div><span>${m}</span></div>`;
}
