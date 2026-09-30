// Общий код для index.html и admin.html: вызовы бэкенда, ID голосующего, мелкие утилиты.
(function () {
  const C = window.CONFIG;

  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch (e) {} }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ID браузера: по нему сервер узнаёт голосующего при повторном заходе.
  let voter = lsGet('mv_voter');
  if (!voter) {
    voter = uuid();
    lsSet('mv_voter', voter);
  }

  const identity = {
    voter,
    get name() { return lsGet('mv_name') || ''; },
    set name(v) { lsSet('mv_name', v || null); },
  };

  async function call(payload) {
    if (!C.APPS_SCRIPT_URL) throw new Error('not_configured');
    let res;
    try {
      res = await fetch(C.APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
      }).then(r => r.json());
    } catch (e) {
      throw new Error('network');
    }
    if (res.error) throw new Error(res.error);
    return res;
  }

  function api(action, data) {
    return call(Object.assign({ action, voter, name: identity.name }, data));
  }

  function adminApi(action, data, password) {
    return call(Object.assign({ action, password }, data));
  }

  const ERRORS = {
    closed: 'Голосование закрыто',
    too_many: 'Можно выбрать максимум ' + C.MAX_VOTES,
    no_name: 'Сначала представьтесь',
    forbidden: 'Неверный пароль',
    locked: 'Слишком много неудачных попыток — подождите 10 минут',
    network: 'Нет связи с сервером — попробуйте ещё раз',
    not_configured: 'Голосование ещё не подключено',
  };
  function errorText(e) {
    const m = e && e.message;
    return ERRORS[m] || ('Не получилось: ' + (m || 'ошибка'));
  }

  function loadVariants() {
    return fetch('variants.json?v=' + C.VERSION).then(r => r.json());
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 2400);
  }

  window.MV = { identity, api, adminApi, errorText, loadVariants, esc, toast };
})();
