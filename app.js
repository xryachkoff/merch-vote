// Общий код для index.html и admin.html: вход через Google, вызовы бэкенда, демо-режим.
(function () {
  const C = window.CONFIG;
  const DEMO = !C.APPS_SCRIPT_URL;
  const TOKEN_KEY = 'mv_token';

  function store(kind) {
    try { return window[kind]; } catch (e) { return null; }
  }
  function sget(key) { try { return store('sessionStorage').getItem(key); } catch (e) { return null; } }
  function sset(key, v) { try { v == null ? store('sessionStorage').removeItem(key) : store('sessionStorage').setItem(key, v); } catch (e) {} }

  function decodeJwt(t) {
    try {
      const p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return null; }
  }

  let token = null;
  let onLoginCb = null;

  function setToken(t) {
    token = t;
    sset(TOKEN_KEY, t);
    if (onLoginCb) onLoginCb(tokenUser());
  }

  function tokenUser() {
    if (!token) return null;
    if (DEMO) return { name: token.slice(5), email: token.slice(5).toLowerCase() + '@demo' };
    const p = decodeJwt(token);
    return p ? { name: p.name || p.email, email: p.email, picture: p.picture } : null;
  }

  function tokenValid(t) {
    if (!t) return false;
    if (DEMO) return t.startsWith('demo:');
    const p = decodeJwt(t);
    return !!p && p.exp * 1000 > Date.now() + 60000;
  }

  // ---------- вход ----------

  function initAuth(buttonEl, onLogin) {
    onLoginCb = onLogin;
    const saved = sget(TOKEN_KEY);
    if (tokenValid(saved)) {
      token = saved;
      onLogin(tokenUser());
    }
    if (DEMO) {
      const b = document.createElement('button');
      b.className = 'btn btn-ghost';
      b.textContent = 'Войти (демо)';
      b.onclick = () => {
        const name = (prompt('Демо-режим: как вас зовут?') || '').trim();
        if (name) setToken('demo:' + name);
      };
      buttonEl.appendChild(b);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => {
      google.accounts.id.initialize({
        client_id: C.GOOGLE_CLIENT_ID,
        callback: r => setToken(r.credential),
        auto_select: true,
        cancel_on_tap_outside: false,
      });
      google.accounts.id.renderButton(buttonEl, { theme: 'filled_black', shape: 'pill', text: 'signin_with', locale: 'ru' });
      if (!token) google.accounts.id.prompt();
    };
    document.head.appendChild(s);
  }

  function logout() {
    token = null;
    sset(TOKEN_KEY, null);
    if (!DEMO && window.google) google.accounts.id.disableAutoSelect();
    location.reload();
  }

  // ---------- API ----------

  async function api(action, data) {
    if (!token) throw new Error('unauthorized');
    if (!DEMO && !tokenValid(token)) {
      sset(TOKEN_KEY, null);
      token = null;
      throw new Error('unauthorized');
    }
    const res = DEMO ? demoApi(action, data || {}) : await fetch(C.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, token }, data)),
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
    return res;
  }

  // Админские вызовы: без Google-входа, по паролю, который проверяет сервер.
  async function adminApi(action, data, password) {
    const res = DEMO ? (password ? demoApi(action, data || {}) : { error: 'forbidden' }) : await fetch(C.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, password }, data)),
    }).then(r => r.json());
    if (res.error) throw new Error(res.error);
    return res;
  }

  const ERRORS = {
    closed: 'Голосование закрыто',
    too_many: 'Можно выбрать максимум ' + C.MAX_VOTES,
    unauthorized: 'Сессия истекла — войдите заново',
    forbidden: 'Неверный пароль',
    locked: 'Слишком много неудачных попыток — подождите 10 минут',
  };
  function errorText(e) {
    const m = e && e.message;
    return ERRORS[m] || ('Не получилось: ' + (m || 'ошибка сети'));
  }

  // ---------- демо-бэкенд в localStorage ----------

  function demoDb() {
    try { return JSON.parse(localStorage.getItem('mv_demo')) || { votes: [], comments: [], closed: false }; }
    catch (e) { return { votes: [], comments: [], closed: false }; }
  }
  function demoSave(db) { try { localStorage.setItem('mv_demo', JSON.stringify(db)); } catch (e) {} }

  function demoApi(action, d) {
    const db = demoDb();
    const u = tokenUser();
    const now = new Date().toISOString();
    switch (action) {
      case 'me': {
        const comments = {};
        db.comments.filter(c => c.email === u.email).forEach(c => { comments[c.variant] = c.text; });
        return { open: !db.closed, email: u.email, name: u.name, votes: db.votes.filter(v => v.email === u.email).map(v => v.variant), comments, max: C.MAX_VOTES };
      }
      case 'vote': {
        if (db.closed) return { error: 'closed' };
        const ids = [...new Set(d.ids.map(Number))];
        if (ids.length > C.MAX_VOTES) return { error: 'too_many' };
        db.votes = db.votes.filter(v => v.email !== u.email).concat(ids.map(id => ({ email: u.email, name: u.name, variant: id, at: now })));
        demoSave(db);
        return { votes: ids };
      }
      case 'comment': {
        if (db.closed) return { error: 'closed' };
        const text = String(d.text || '').trim().slice(0, 1000);
        db.comments = db.comments.filter(c => !(c.email === u.email && c.variant === d.variant));
        if (text) db.comments.push({ email: u.email, name: u.name, variant: d.variant, text, at: now });
        demoSave(db);
        return { variant: d.variant, text };
      }
      case 'admin_results': {
        const tally = {};
        db.votes.forEach(v => { tally[v.variant] = (tally[v.variant] || 0) + 1; });
        return { open: !db.closed, tally, voters: new Set(db.votes.map(v => v.email)).size, votes: db.votes, comments: db.comments };
      }
      case 'admin_set_open':
        db.closed = !d.open;
        demoSave(db);
        return { open: d.open };
    }
    return { error: 'unknown_action' };
  }

  async function loadVariants() {
    return fetch('variants.json').then(r => r.json());
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.MV = { DEMO, initAuth, logout, api, adminApi, errorText, loadVariants, esc, user: tokenUser };
})();
