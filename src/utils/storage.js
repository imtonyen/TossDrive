/** Web Storage 包一層，隱私模式或被禁用時不會丟例外。所有 key 加上 tossdrive. 前綴。 */
function wrap(getStorage) {
  return {
    get(k) { try { return getStorage().getItem('tossdrive.' + k); } catch (e) { return null; } },
    set(k, v) { try { getStorage().setItem('tossdrive.' + k, v); } catch (e) { /* 忽略 */ } },
    remove(k) { try { getStorage().removeItem('tossdrive.' + k); } catch (e) { /* 忽略 */ } },
  };
}

/** 長期保存（裝置 ID、email、設定）：關掉瀏覽器也還在 */
export const store = wrap(() => localStorage);

/** 只在這個分頁有效（登入憑證）：重新整理還在，關掉分頁或瀏覽器就清掉 */
export const sessionStore = wrap(() => sessionStorage);
