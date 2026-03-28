// ══════════════════════════════════════════════
//  WINDOW MANAGER
// ══════════════════════════════════════════════

export interface WinEntry {
  el: HTMLElement;
  type: string;
  ticker: string | null;
}

export type FillFn = (bodyEl: HTMLElement, ticker: string | null, winId: string) => void;

// Module-private state
let winZ = 10;
let winN = 0;
const wins: Record<string, WinEntry> = {};
const ftimers: Record<string, ReturnType<typeof setInterval>> = {};

// Active window tracking
let activeWinId: string | null = null;

/** Set the active (keyboard-focused) window by id. */
export function setActiveWin(id: string): void {
  activeWinId = id;
  document.querySelectorAll<HTMLElement>('#desktop .win').forEach(w => {
    w.classList.toggle('active-win', w.id === id);
  });
}

/** Get the current active window id. */
export function getActiveWinId(): string | null {
  return activeWinId;
}

// Closed windows stack for Cmd+Z undo
interface ClosedEntry { cmd: string; ticker: string | null; }
const closedStack: ClosedEntry[] = [];

/** Pop the last closed window entry (for undo). */
export function popClosedWin(): ClosedEntry | null {
  return closedStack.pop() || null;
}

// Simple event bus for cross-module coordination (e.g. QM cleanup on close)
type WindowClosedListener = (id: string) => void;
const closeListeners: WindowClosedListener[] = [];

export function onWindowClosed(fn: WindowClosedListener): void {
  closeListeners.push(fn);
}

/** Open a new floating window. Returns the window id. */
export function ow(
  type: string,
  ticker: string | null,
  title: string,
  w: number,
  h: number,
  fillFn: FillFn
): string {
  const id = `w${++winN}`;
  const desk = document.getElementById('desktop')!;
  const dw = desk.clientWidth, dh = desk.clientHeight;
  const l = Math.max(0, Math.min(30 + winN * 20, dw - w - 20));
  const tp = Math.max(0, Math.min(20 + winN * 16, dh - h - 20));
  const el = document.createElement('div');
  el.className = 'win'; el.id = id; el.dataset.wtype = type;
  el.style.cssText = `left:${l}px;top:${tp}px;width:${w}px;height:${h}px;z-index:${++winZ}`;
  el.innerHTML =
    `<div class="win-bar"><span class="win-title">${title}</span><div class="win-acts"><div class="wb" title="Min" onclick="minWin('${id}')">—</div><div class="wb x" title="Close" onclick="cw('${id}')">✕</div></div></div>` +
    `<div class="wbody" id="wb-${id}"></div>` +
    `<div class="rz rz-n"></div><div class="rz rz-s"></div><div class="rz rz-e"></div><div class="rz rz-w"></div>` +
    `<div class="rz rz-ne"></div><div class="rz rz-nw"></div><div class="rz rz-se"></div><div class="rz rz-sw"></div>`;
  desk.appendChild(el);
  _drag(el); _resize(el);
  el.addEventListener('mousedown', () => {
    el.style.zIndex = String(++winZ);
    setActiveWin(id);
  });
  wins[id] = { el, type, ticker };
  setActiveWin(id);
  fillFn(document.getElementById(`wb-${id}`)!, ticker, id);
  return id;
}

/** Close a window, clear its timers, notify listeners. */
export function cw(id: string): void {
  const entry = wins[id];
  const c = document.getElementById(id);
  if (entry && c) {
    // Save title for undo — titles follow "CMD · TICKER" pattern
    const titleEl = c.querySelector('.win-title');
    const titleText = titleEl?.textContent || '';
    const parts = titleText.split(' · ');
    const cmd = parts[0]?.trim() || entry.type.toUpperCase();
    closedStack.push({ cmd, ticker: entry.ticker });
    if (closedStack.length > 20) closedStack.shift();
  }
  clearInterval(ftimers[id]);
  delete ftimers[id];
  if (c) c.remove();
  delete wins[id];
  if (activeWinId === id) {
    activeWinId = null;
    // Auto-focus the next highest z-index window
    const top = getTopmostWin();
    if (top) setActiveWin(top.id);
  }
  closeListeners.forEach(fn => fn(id));
}

/** Minimize / restore a window. */
export function minWin(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const wb = el.querySelector('.wbody') as HTMLElement | null;
  const rzEls = el.querySelectorAll('.rz');
  if ((el as any).dataset.min === '1') {
    (el as any).dataset.min = '0';
    if (wb) wb.style.display = '';
    rzEls.forEach((r: Element) => (r as HTMLElement).style.display = '');
    el.style.height = (el as any).dataset.rh || '300px';
  } else {
    (el as any).dataset.min = '1';
    (el as any).dataset.rh = el.style.height;
    if (wb) wb.style.display = 'none';
    rzEls.forEach((r: Element) => (r as HTMLElement).style.display = 'none');
    el.style.height = '24px';
  }
}

/** Register an interval timer for a window so it gets cleared on cw(). */
export function registerFTimer(id: string, timer: ReturnType<typeof setInterval>): void {
  ftimers[id] = timer;
}

/** Get a snapshot of all open windows (read-only). */
export function getWins(): Readonly<Record<string, WinEntry>> {
  return wins;
}

/** Return the topmost (highest z-index) window element, or null. */
export function getTopmostWin(): HTMLElement | null {
  let top: HTMLElement | null = null, topZ = -1;
  document.querySelectorAll<HTMLElement>('#desktop .win').forEach(w => {
    const z = parseInt(w.style.zIndex, 10) || 0;
    if (z > topZ) { topZ = z; top = w; }
  });
  return top;
}

/** Cycle keyboard focus through open windows. dir=1 forward, dir=-1 backward. */
export function cycleFocus(dir: 1 | -1): void {
  const all = Array.from(document.querySelectorAll<HTMLElement>('#desktop .win'))
    .sort((a, b) => {
      const an = parseInt(a.id.slice(1), 10);
      const bn = parseInt(b.id.slice(1), 10);
      return an - bn;
    });
  if (!all.length) return;
  const cur = all.findIndex(w => w.id === activeWinId);
  const next = all[(cur + dir + all.length) % all.length];
  next.style.zIndex = String(++winZ);
  setActiveWin(next.id);
}

/** Move the active window by dx, dy pixels (with soft boundary). */
export function moveActiveWin(dx: number, dy: number): void {
  if (!activeWinId) return;
  const el = document.getElementById(activeWinId);
  if (!el) return;
  const desk = document.getElementById('desktop')!;
  const dw = desk.clientWidth, dh = desk.clientHeight;
  const w = el.offsetWidth;
  const newLeft = el.offsetLeft + dx;
  const newTop  = el.offsetTop  + dy;
  el.style.left = Math.max(-(w - 60), Math.min(newLeft, dw - 60)) + 'px';
  el.style.top  = Math.max(0, Math.min(newTop, dh - 28)) + 'px';
}

/** Resize the active window by dw, dh pixels. */
export function resizeActiveWin(dw: number, dh: number): void {
  if (!activeWinId) return;
  const el = document.getElementById(activeWinId);
  if (!el) return;
  el.style.width  = Math.max(200, el.offsetWidth  + dw) + 'px';
  el.style.height = Math.max(80,  el.offsetHeight + dh) + 'px';
}

/** Snap the active window flush to a desktop edge. */
export function snapActiveWin(dir: 'up' | 'down' | 'left' | 'right'): void {
  if (!activeWinId) return;
  const el = document.getElementById(activeWinId);
  if (!el) return;
  const desk = document.getElementById('desktop')!;
  const dw = desk.clientWidth, dh = desk.clientHeight;
  if (dir === 'up')    el.style.top  = '0px';
  if (dir === 'down')  el.style.top  = (dh - el.offsetHeight) + 'px';
  if (dir === 'left')  el.style.left = '0px';
  if (dir === 'right') el.style.left = (dw - el.offsetWidth) + 'px';
}

/** Resize the active window so its edge reaches the desktop boundary. */
export function resizeActiveWinToEdge(dir: 'up' | 'down' | 'left' | 'right'): void {
  if (!activeWinId) return;
  const el = document.getElementById(activeWinId);
  if (!el) return;
  const desk = document.getElementById('desktop')!;
  const dw = desk.clientWidth, dh = desk.clientHeight;
  if (dir === 'up') {
    const bottom = el.offsetTop + el.offsetHeight;
    el.style.top    = '0px';
    el.style.height = Math.max(80, bottom) + 'px';
  }
  if (dir === 'down')  el.style.height = Math.max(80, dh - el.offsetTop) + 'px';
  if (dir === 'left') {
    const right = el.offsetLeft + el.offsetWidth;
    el.style.left  = '0px';
    el.style.width = Math.max(200, right) + 'px';
  }
  if (dir === 'right') el.style.width = Math.max(200, dw - el.offsetLeft) + 'px';
}

// ── Private drag / resize helpers ──

function _drag(winEl: HTMLElement): void {
  // For headless windows (bar hidden), the whole window body is the drag handle
  const isHeadless = winEl.dataset.wtype === 'foc';
  const handle = isHeadless ? winEl : (winEl.querySelector('.win-bar') as HTMLElement);
  let ox: number, oy: number, sx: number, sy: number;
  let dragging = false;
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('wb')) return;
    // Don't start drag from resize handles
    if (t.classList.contains('rz') || t.closest('.rz')) return;
    dragging = false;
    const startX = e.clientX, startY = e.clientY;
    ox = winEl.offsetLeft; oy = winEl.offsetTop; sx = e.clientX; sy = e.clientY;
    const desk = document.getElementById('desktop')!;
    const mv = (e2: MouseEvent) => {
      if (!dragging && (Math.abs(e2.clientX - startX) > 3 || Math.abs(e2.clientY - startY) > 3)) {
        dragging = true;
        winEl.style.zIndex = String(++winZ);
        document.body.style.userSelect = 'none';
      }
      if (!dragging) return;
      const dw = desk.clientWidth, dh = desk.clientHeight;
      const w = winEl.offsetWidth;
      const newLeft = ox + e2.clientX - sx;
      const newTop  = oy + e2.clientY - sy;
      winEl.style.left = Math.max(-(w - 60), Math.min(newLeft, dw - 60)) + 'px';
      winEl.style.top  = Math.max(0, Math.min(newTop, dh - 28)) + 'px';
      e2.preventDefault();
    };
    const up = () => { document.body.style.userSelect = ''; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv);
    document.addEventListener('mouseup', up);
  });
}

function _resize(winEl: HTMLElement): void {
  type Dir = 'n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw';
  const handles: Dir[] = ['n','s','e','w','ne','nw','se','sw'];
  handles.forEach(dir => {
    const h = winEl.querySelector(`.rz-${dir}`) as HTMLElement;
    if (!h) return;
    h.addEventListener('mousedown', (e: MouseEvent) => {
      e.preventDefault(); e.stopPropagation();
      document.body.style.userSelect = 'none';
      const startW = winEl.offsetWidth;
      const startH = winEl.offsetHeight;
      const startL = winEl.offsetLeft;
      const startT = winEl.offsetTop;
      const startX = e.clientX;
      const startY = e.clientY;
      const mv = (e2: MouseEvent) => {
        const dx = e2.clientX - startX;
        const dy = e2.clientY - startY;
        const hasN = dir === 'n' || dir === 'ne' || dir === 'nw';
        const hasS = dir === 's' || dir === 'se' || dir === 'sw';
        const hasE = dir === 'e' || dir === 'ne' || dir === 'se';
        const hasW = dir === 'w' || dir === 'nw' || dir === 'sw';
        if (hasE) winEl.style.width  = Math.max(200, startW + dx) + 'px';
        if (hasS) winEl.style.height = Math.max(80,  startH + dy) + 'px';
        if (hasW) {
          const newW = Math.max(200, startW - dx);
          winEl.style.width = newW + 'px';
          winEl.style.left  = (startL + startW - newW) + 'px';
        }
        if (hasN) {
          const newH = Math.max(80, startH - dy);
          winEl.style.height = newH + 'px';
          winEl.style.top    = (startT + startH - newH) + 'px';
        }
      };
      const up = () => { document.body.style.userSelect = ''; document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', mv);
      document.addEventListener('mouseup', up);
    });
  });
}
