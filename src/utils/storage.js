/** localStorage 包一層，隱私模式或被禁用時不會丟例外。所有 key 加上 tossdrive. 前綴。 */
export const store = {
  get(k) { try { return localStorage.getItem('tossdrive.' + k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem('tossdrive.' + k, v); } catch (e) { /* 忽略 */ } },
  remove(k) { try { localStorage.removeItem('tossdrive.' + k); } catch (e) { /* 忽略 */ } },
};
