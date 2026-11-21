/** 非同步小工具：等待、同時執行數量限制 */
import { MAX_CONCURRENT_DOWNLOADS } from '../constants.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 同時執行數量限制（超過的先排隊） */
export function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

/** 下載縮圖、文字時最多 4 個一起跑，避免塞車 */
export const limitDownload = createLimiter(MAX_CONCURRENT_DOWNLOADS);
