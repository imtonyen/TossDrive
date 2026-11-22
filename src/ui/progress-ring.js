/** 讀取中的藍色旋轉圈（樣式見 style.css 的 .ring） */
const NS = 'http://www.w3.org/2000/svg';

function circle(cls) {
  const c = document.createElementNS(NS, 'circle');
  c.setAttribute('class', cls);
  c.setAttribute('cx', '18');
  c.setAttribute('cy', '18');
  c.setAttribute('r', '15');
  c.setAttribute('pathLength', '100');   // 讓 stroke-dasharray 直接用百分比
  return c;
}

export function progressRing() {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 36 36');
  svg.setAttribute('class', 'ring-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.append(circle('ring-track'), circle('ring-bar'));

  const el = document.createElement('div');
  el.className = 'ring';
  el.setAttribute('role', 'progressbar');
  el.setAttribute('aria-label', '讀取中');
  el.append(svg);
  return el;
}
