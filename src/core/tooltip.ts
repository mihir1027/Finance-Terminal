/**
 * tooltip.ts — Shared hover-definition system for the finance terminal.
 *
 * Usage:
 *   import { tip, initTooltips } from '../../core/tooltip';
 *
 *   // In HTML template strings:
 *   `<div class="cm-k">${tip('Z-SCORE', 'How far inventory is from the 5-year average...')}</div>`
 *
 *   // After setting innerHTML on a panel:
 *   initTooltips();
 */

const TIP_BOX_ID = 'tt-box';

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/**
 * Wraps a label with a hover-definition trigger.
 * The label renders normally; hovering shows the definition in a tooltip.
 */
export function tip(label: string, definition: string): string {
  return `<span class="tt" data-tip="${escHtml(definition)}" style="cursor:default;border-bottom:1px dotted #333">${label}</span>`;
}

function getOrCreateBox(): HTMLElement {
  let box = document.getElementById(TIP_BOX_ID);
  if (!box) {
    box = document.createElement('div');
    box.id = TIP_BOX_ID;
    Object.assign(box.style, {
      position:      'fixed',
      zIndex:        '9999',
      background:    '#111',
      color:         '#aaa',
      fontSize:      '11px',
      lineHeight:    '1.5',
      padding:       '6px 9px',
      maxWidth:      '240px',
      pointerEvents: 'none',
      display:       'none',
      whiteSpace:    'normal',
      letterSpacing: '0',
      fontWeight:    '400',
      fontFamily:    'inherit',
    });
    document.body.appendChild(box);
  }
  return box;
}

/**
 * Attaches the tooltip hover handler via event delegation on `root`.
 * Safe to call multiple times — re-registers cleanly.
 * Call once after setting innerHTML on each panel mount.
 */
export function initTooltips(root: HTMLElement = document.body): void {
  const box = getOrCreateBox();

  root.addEventListener('mouseover', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.tt') as HTMLElement | null;
    if (!target) return;
    const text = target.getAttribute('data-tip');
    if (!text) return;

    box.textContent = text;
    box.style.display = 'block';

    const rect   = target.getBoundingClientRect();
    const bw     = box.offsetWidth  || 240;
    const bh     = box.offsetHeight || 40;
    const margin = 6;

    // Prefer above; flip below if near top
    let top  = rect.top - bh - margin;
    if (top < 4) top = rect.bottom + margin;

    // Keep horizontally within viewport
    let left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - bw - 4));

    box.style.top  = `${top}px`;
    box.style.left = `${left}px`;
  });

  root.addEventListener('mouseout', (e: MouseEvent) => {
    const target = (e.target as HTMLElement).closest('.tt');
    if (!target) return;
    box.style.display = 'none';
  });
}
