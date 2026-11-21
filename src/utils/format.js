/** 格式化：檔案大小、時間、日期分隔線文字 */

const pad = (n) => String(n).padStart(2, '0');

export function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export function fmtTime(ts) {
  const d = new Date(ts);
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 檔名用的時間戳：20261121_103012 */
export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 日期分隔線文字：今天、昨天、11月19日（週四） */
export function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date();
  const key = dayKey(ts);
  if (key === dayKey(today)) return '今天';
  if (key === dayKey(today.getTime() - 86400000)) return '昨天';
  const wk = '日一二三四五六'[d.getDay()];
  const y = d.getFullYear() === today.getFullYear() ? '' : d.getFullYear() + '年';
  return `${y}${d.getMonth() + 1}月${d.getDate()}日（週${wk}）`;
}
