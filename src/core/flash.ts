type FlashDirection = 'up' | 'down';

/**
 * Flash a DOM element by ID with the green/red price-change animation.
 * Forces a reflow to restart the animation even if the class is already present.
 */
export function flashRow(elementId: string, direction: FlashDirection, removeAfterMs = 700): void {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.remove('flash-up', 'flash-dn');
  void (el as HTMLElement).offsetWidth; // force reflow
  el.classList.add(direction === 'up' ? 'flash-up' : 'flash-dn');
  setTimeout(() => el.classList.remove('flash-up', 'flash-dn'), removeAfterMs);
}

/**
 * Flash an arbitrary element by direct reference.
 * Used by SOVM's flashRows where element references are already available.
 * Default 800ms matches existing SOVM behavior.
 */
export function flashElement(el: HTMLElement, direction: FlashDirection, removeAfterMs = 800): void {
  el.classList.remove('flash-up', 'flash-dn');
  void el.offsetWidth;
  el.classList.add(direction === 'up' ? 'flash-up' : 'flash-dn');
  setTimeout(() => el.classList.remove('flash-up', 'flash-dn'), removeAfterMs);
}
