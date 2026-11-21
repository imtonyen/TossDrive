/** 裝置資訊：判斷手機或電腦、裝置名稱、產生裝置 ID（用來判斷訊息要靠左還是靠右） */
import { store } from './utils/storage.js';

function createDevice() {
  let id = store.get('devid');
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    id = Array.from(bytes, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36).slice(-3);
    store.set('devid', id);
  }
  const ua = navigator.userAgent;
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1; // iPadOS 的 UA 會偽裝成 Mac
  const mobile = /iPhone|iPad|iPod|Android|Mobi/i.test(ua) || iPadOS;
  let name = '裝置';
  if (/iPhone/.test(ua)) name = 'iPhone';
  else if (/iPad/.test(ua) || iPadOS) name = 'iPad';
  else if (/Android/.test(ua)) name = 'Android';
  else if (/Macintosh/.test(ua)) name = 'Mac';
  else if (/Windows/.test(ua)) name = 'Windows';
  else if (/CrOS/.test(ua)) name = 'Chromebook';
  else if (/Linux/.test(ua)) name = 'Linux';
  return { id, name, type: store.get('devtype') || (mobile ? 'phone' : 'desktop') };
}

export const device = createDevice();
