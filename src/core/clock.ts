export function tickClock(): void {
  const n = new Date(), p = (x: number) => String(x).padStart(2, '0');
  let h = n.getHours(), ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const el = document.getElementById('clock');
  if (el) el.textContent = `${h}:${p(n.getMinutes())}:${p(n.getSeconds())} ${ap}`;
}

export function startClock(): void {
  setInterval(tickClock, 1000);
  tickClock();
}
