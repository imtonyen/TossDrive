/** 讀取中的藍色旋轉圈（樣式見 style.css 的 .ring） */
const NS = 'http://www.w3.org/2000/svg';

function circle(cls) {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('class', cls);
  c.setAttribute('cx', '18');
  c.setAttribute('cy', '18');
  c.setAttribute('r', '15');
  c.setAttribute('pathLength', '100');   // 讓 stroke-dasharray 直接用百分比
  // 線條樣式也寫成屬性：CSS 還沒載到（或是舊版快取）時，至少是個圈而不是黑色圓點
  c.setAttribute('fill', 'none');
  c.setAttribute('stroke-width', '3.5');
  return c;
}

export function progressRing() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', 'ring-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '36');    // 預設大小，CSS 還沒載到（或是舊版快取）時也不會撐成一大塊
  svg.setAttribute('height', '36');
  const track = circle('ring-track');
  track.setAttribute('stroke', 'rgba(127, 127, 127, .25)');
  const bar = circle('ring-bar');
  bar.setAttribute('stroke', '#2f6fed');
  bar.setAttribute('stroke-linecap', 'round');
  bar.setAttribute('stroke-dasharray', '28 100');
  svg.append(track, bar);

  const el = document.createElement('div');
  el.className = 'ring';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-label', '讀取中');
  el.append(svg);
  return el;
}
