export const PREFS_KEY = 'kt_prefs_v1';

export interface Prefs {
  font: string;
  fontSize: number;
  density: 'compact' | 'normal' | 'relaxed';
  scrollW: number;
  orange: string;
  green: string;
  red: string;
  amber: string;
  cyan: string;
  winBdrAlpha: number;
  winTopAlpha: number;
  winShadow: 'off' | 'soft' | 'strong';
  bgPreset: 'pitch' | 'dark' | 'charcoal';
  chartUp: string;
  chartDown: string;
  sentThresh: number;
}

export const PREFS_DEFAULTS: Prefs = {
  font: "'Oxygen Mono', monospace",
  fontSize: 13,
  density: 'normal',
  scrollW: 4,
  orange: '#F08C00',
  green: '#4ade80',
  red: '#f87171',
  amber: '#fbbf24',
  cyan: '#38bdf8',
  winBdrAlpha: 18,
  winTopAlpha: 75,
  winShadow: 'strong',
  bgPreset: 'dark',
  chartUp: '#4ade80',
  chartDown: '#f87171',
  sentThresh: 5,
};

export function loadPrefs(): Prefs {
  return { ...PREFS_DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
}

export function savePrefs(p: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(p));
}

export function applyPrefs(p: Prefs): void {
  const r = document.documentElement;
  r.style.setProperty('--font', p.font);
  document.body.style.fontSize = p.fontSize + 'px';
  r.style.setProperty('--orange', p.orange);
  r.style.setProperty('--green', p.green);
  r.style.setProperty('--red', p.red);
  r.style.setProperty('--amber', p.amber);
  r.style.setProperty('--cyan', p.cyan);

  let s = document.getElementById('pdf-chrome-style') as HTMLStyleElement | null;
  if (!s) { s = document.createElement('style'); s.id = 'pdf-chrome-style'; document.head.appendChild(s); }
  const shadows: Record<string, string> = { off: 'none', soft: '0 4px 20px rgba(0,0,0,.5)', strong: '0 10px 50px rgba(0,0,0,.85)' };
  const bgs: Record<string, string> = { pitch: '#000000', dark: '#0a0a0a', charcoal: '#141414' };
  s.textContent =
    `.win{border:1px solid rgba(251,191,36,${p.winBdrAlpha / 100})!important;box-shadow:${shadows[p.winShadow]}!important;}` +
    `.win-bar{border-top:2px solid rgba(240,140,0,${p.winTopAlpha / 100})!important;}` +
    `#desktop,#topbar+*,body{background:${bgs[p.bgPreset]}!important;}#desktop{background:${bgs[p.bgPreset]}!important;}`;

  document.body.classList.remove('density-compact', 'density-relaxed');
  if (p.density !== 'normal') document.body.classList.add(`density-${p.density}`);

  let sw = document.getElementById('pdf-scroll-style') as HTMLStyleElement | null;
  if (!sw) { sw = document.createElement('style'); sw.id = 'pdf-scroll-style'; document.head.appendChild(sw); }
  sw.textContent = `::-webkit-scrollbar{width:${p.scrollW}px;height:${p.scrollW}px;}`;

  (window as any)._pdfChartUp = p.chartUp;
  (window as any)._pdfChartDown = p.chartDown;
  (window as any)._sentThresh = p.sentThresh / 100;
}
