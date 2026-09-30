/**
 * Бэкенд голосовалки за мерч. Вставляется в таблицу: Расширения → Apps Script.
 * Деплой: Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 *
 * Голосующий определяется случайным ID, который страница хранит в браузере, и именем.
 * Голоса пишутся на вкладку `votes`, комментарии — на `comments`.
 */

// Пароль админки. Вписывается только здесь, в редакторе Apps Script; в публичный репозиторий не попадает.
const ADMIN_PASSWORD = 'PASTE_ADMIN_PASSWORD';
const MAX_ADMIN_FAILS = 10; // неудачных попыток за 10 минут, дальше админка временно блокируется

const MAX_VOTES = 2;
const VARIANT_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const MAX_COMMENT = 1000;
const MAX_NAME = 60;
const VOTER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

  try {
    if (action.startsWith('admin_')) {
      const admin = { admin_results: adminResults, admin_set_open: adminSetOpen }[action];
      if (!admin) return json_({ error: 'unknown_action' });
      const check = checkAdminPassword_(body.password);
      if (check) return json_({ error: check });
      return json_(admin(body));
    }

    const handler = { me, vote, comment }[action];
    if (!handler) return json_({ error: 'unknown_action' });
    const voter = String(body.voter || '').toLowerCase();
    if (!VOTER_RE.test(voter)) return json_({ error: 'bad_voter' });
    return json_(handler(voter, body));
  } catch (err) {
    return json_({ error: String(err.message || err) });
  }
}

// ---------- голосующие ----------

function me(voter) {
  const votes = rows_('votes').filter(r => r[0] === voter).map(r => Number(r[2]));
  const comments = {};
  rows_('comments').filter(r => r[0] === voter).forEach(r => { comments[r[2]] = r[3]; });
  return { open: isOpen_(), votes, comments, max: MAX_VOTES };
}

function vote(voter, body) {
  if (!isOpen_()) throw new Error('closed');
  const name = cleanName_(body.name);
  const ids = [...new Set((body.ids || []).map(Number))];
  if (ids.length > MAX_VOTES) throw new Error('too_many');
  if (ids.some(id => !VARIANT_IDS.includes(id))) throw new Error('bad_variant');
  return withLock_(() => {
    const sh = sheet_('votes');
    deleteRows_(sh, r => r[0] === voter);
    const now = new Date();
    if (ids.length) sh.getRange(sh.getLastRow() + 1, 1, ids.length, 4).setValues(ids.map(id => [voter, name, id, now]));
    return { votes: ids };
  });
}

function comment(voter, body) {
  if (!isOpen_()) throw new Error('closed');
  const name = cleanName_(body.name);
  const id = Number(body.variant);
  if (!VARIANT_IDS.includes(id)) throw new Error('bad_variant');
  const text = String(body.text || '').trim().slice(0, MAX_COMMENT);
  return withLock_(() => {
    const sh = sheet_('comments');
    deleteRows_(sh, r => r[0] === voter && Number(r[2]) === id);
    if (text) sh.appendRow([voter, name, id, safeCell_(text), new Date()]);
    return { variant: id, text };
  });
}

// ---------- админка ----------

function adminResults() {
  const votes = rows_('votes').map(r => ({ voter: r[0], name: r[1], variant: Number(r[2]), at: r[3] }));
  const comments = rows_('comments').map(r => ({ voter: r[0], name: r[1], variant: Number(r[2]), text: r[3], at: r[4] }));
  const tally = {};
  VARIANT_IDS.forEach(id => { tally[id] = 0; });
  votes.forEach(v => { tally[v.variant] = (tally[v.variant] || 0) + 1; });
  const voters = new Set(votes.map(v => v.voter)).size;
  return { open: isOpen_(), tally, voters, votes, comments };
}

function adminSetOpen(body) {
  PropertiesService.getScriptProperties().setProperty('closed', body.open ? '' : '1');
  return { open: isOpen_() };
}

// Возвращает код ошибки или '' если пароль верный. Считает неудачные попытки, чтобы пароль нельзя было перебрать.
function checkAdminPassword_(password) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('admin_fails') || 0);
  if (fails >= MAX_ADMIN_FAILS) return 'locked';
  // пока пароль не вписан (заглушка PASTE_…), админка закрыта для всех
  const configured = !/^PASTE_/.test(ADMIN_PASSWORD);
  if (configured && String(password || '') === ADMIN_PASSWORD) return '';
  cache.put('admin_fails', String(fails + 1), 600);
  return 'forbidden';
}

// ---------- служебное ----------

function cleanName_(name) {
  const s = String(name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (!s) throw new Error('no_name');
  return safeCell_(s);
}

// Текст, начинающийся с =, +, -, @, таблица приняла бы за формулу.
function safeCell_(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function isOpen_() {
  return !PropertiesService.getScriptProperties().getProperty('closed');
}

const HEADERS = {
  votes: ['voter_id', 'name', 'variant_id', 'updated_at'],
  comments: ['voter_id', 'name', 'variant_id', 'text', 'updated_at'],
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
