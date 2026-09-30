/**
 * Бэкенд голосовалки за мерч. Вставляется в таблицу: Расширения → Apps Script.
 * Деплой: Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 */

// OAuth Client ID (Google Cloud Console → Credentials → OAuth client ID → Web application)
const CLIENT_ID = 'PASTE_CLIENT_ID.apps.googleusercontent.com';
// Пароль админки. Вписывается только здесь, в редакторе Apps Script; в публичный репозиторий не попадает.
const ADMIN_PASSWORD = 'PASTE_ADMIN_PASSWORD';
const MAX_ADMIN_FAILS = 10; // неудачных попыток за 10 минут, дальше админка временно блокируется

const MAX_VOTES = 2;
const VARIANT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const MAX_COMMENT = 1000;

function doGet() {
  return json_({ ok: true, open: isOpen_() });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ error: 'bad_request' });
  }
  const action = String(body.action || '');

  if (action.startsWith('admin_')) {
    const admin = { admin_results: adminResults, admin_set_open: adminSetOpen }[action];
    if (!admin) return json_({ error: 'unknown_action' });
    const check = checkAdminPassword_(body.password);
    if (check) return json_({ error: check, status: 403 });
    try {
      return json_(admin(null, body));
    } catch (err) {
      return json_({ error: String(err.message || err) });
    }
  }

  const user = verify_(body.token);
  if (!user) return json_({ error: 'unauthorized', status: 401 });

  const handler = { me, vote, comment }[action];
  if (!handler) return json_({ error: 'unknown_action' });
  try {
    return json_(handler(user, body));
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

// ---------- действия ----------

function me(user) {
  const votes = rows_('votes').filter(r => r[0] === user.email).map(r => Number(r[2]));
  const comments = {};
  rows_('comments').filter(r => r[0] === user.email).forEach(r => { comments[r[2]] = r[3]; });
  return { open: isOpen_(), email: user.email, name: user.name, votes, comments, max: MAX_VOTES };
}

function vote(user, body) {
  if (!isOpen_()) throw new Error('closed');
  const ids = [...new Set((body.ids || []).map(Number))];
  if (ids.length > MAX_VOTES) throw new Error('too_many');
  if (ids.some(id => !VARIANT_IDS.includes(id))) throw new Error('bad_variant');
  return withLock_(() => {
    const sh = sheet_('votes');
    deleteRows_(sh, r => r[0] === user.email);
    const now = new Date();
    ids.forEach(id => sh.appendRow([user.email, user.name, id, now]));
    return { votes: ids };
  });
}

function comment(user, body) {
  if (!isOpen_()) throw new Error('closed');
  const id = Number(body.variant);
  if (!VARIANT_IDS.includes(id)) throw new Error('bad_variant');
  const text = String(body.text || '').trim().slice(0, MAX_COMMENT);
  return withLock_(() => {
    const sh = sheet_('comments');
    deleteRows_(sh, r => r[0] === user.email && Number(r[2]) === id);
    if (text) sh.appendRow([user.email, user.name, id, text, new Date()]);
    return { variant: id, text };
  });
}

function adminResults() {
  const votes = rows_('votes').map(r => ({ email: r[0], name: r[1], variant: Number(r[2]), at: r[3] }));
  const comments = rows_('comments').map(r => ({ email: r[0], name: r[1], variant: Number(r[2]), text: r[3], at: r[4] }));
  const tally = {};
  VARIANT_IDS.forEach(id => { tally[id] = 0; });
  votes.forEach(v => { tally[v.variant] = (tally[v.variant] || 0) + 1; });
  const voters = new Set(votes.map(v => v.email)).size;
  return { open: isOpen_(), tally, voters, votes, comments };
}

function adminSetOpen(user, body) {
  PropertiesService.getScriptProperties().setProperty('closed', body.open ? '' : '1');
  return { open: isOpen_() };
}

// ---------- служебное ----------

function verify_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const key = 'tok_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return null;
  const info = JSON.parse(res.getContentText());
  if (info.aud !== CLIENT_ID || String(info.email_verified) !== 'true') return null;
  if (Number(info.exp) * 1000 < Date.now()) return null;

  const user = { email: String(info.email).toLowerCase(), name: info.name || info.email };
  const ttl = Math.min(600, Math.max(1, Math.floor(Number(info.exp) - Date.now() / 1000)));
  cache.put(key, JSON.stringify(user), ttl);
  return user;
}

// Возвращает код ошибки или '' если пароль верный. Считает неудачные попытки, чтобы пароль нельзя было перебрать.
function checkAdminPassword_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= MAX_ADMIN_FAILS) return 'locked';
  if (ADMIN_PASSWORD !== 'PASTE_ADMIN_PASSWORD' && String(password || '') === ADMIN_PASSWORD) return '';
  cache.put('admin_fails', String(fails + 1), 600);
  return 'forbidden';
}

function isOpen_() {
  return !PropertiesService.getScriptProperties().getProperty('closed');
}

const HEADERS = {
  votes: ['email', 'name', 'variant_id', 'updated_at'],
  comments: ['email', 'name', 'variant_id', 'text', 'updated_at'],
};

function sheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  const sh = sheet_(name);
  const n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, HEADERS[name].length).getValues();
}

function deleteRows_(sh, predicate) {
  const n = sh.getLastRow();
  if (n < 2) return;
  const values = sh.getRange(2, 1, n - 1, sh.getLastColumn()).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (predicate(values[i])) sh.deleteRow(i + 2);
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
