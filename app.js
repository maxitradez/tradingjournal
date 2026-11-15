/* Maxi Trades Journal
   Guest journal data stays in this browser (localStorage).
   Supabase accounts can load and save their own cloud journal. Guest migration is preview-only; importing remains unavailable in the UI. */
(function () {
  'use strict';
  var LS_KEY = 'trading-journal-pro-v1';
  var MINUS = '−';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var EMOTIONS = ['Calm', 'Confident', 'Focused', 'Patient', 'Hesitant', 'Fearful', 'Impatient', 'FOMO', 'Greedy', 'Revenge', 'Bored', 'Tired'];
  var MISTAKES = ['Moved stop', 'Oversized', 'Early exit', 'Late entry', 'No setup', 'Chased price', 'Overtraded', 'Ignored news', 'Averaged down'];
  var VIEWS = ['dashboard', 'calendar', 'trades', 'playbooks', 'reports', 'insights', 'settings'];
  var STARTERS = [
    { name: 'Breakout retest', description: 'Trade the break of a key level only after price comes back to test it.', rules: ['Trade with the higher timeframe trend', 'Wait for the retest, never chase the break', 'Stop loss placed before entry', 'Risk no more than 1% of the account'] },
    { name: 'Trend pullback', description: 'Join an established trend when price pulls back to value.', rules: ['Price is pulling back to a key moving average', 'Confirmation candle has closed', 'Target is at least 2R', 'No trade within 15 minutes of major news'] }
  ];
  var state = { assets: null, shot: { blob: null, preview: '', existing: '', remove: false }, trades: [], playbooks: [], days: [], settings: { balance: null, riskPct: null, currency: '', example: false }, mode: 'local', readOnlyCloud: false, dataState: 'guest-local', cols: null, view: 'dashboard', month: null, selDay: null, editingTrade: null, editingPb: null, filters: { q: '', pb: '', outcome: '', plan: '' }, reviewHTML: null, reviewing: false, lastFocus: null };

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, parent) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(el);
    return el;
  }

  /* ---------- formatting ---------- */
  function num(v) { if (v === '' || v == null) return null; var n = parseFloat(v); return isFinite(n) ? n : null; }
  function fmt(n, d) { d = d == null ? 2 : d; return Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function signed(n, d) {
    d = d == null ? 2 : d;
    var p = Math.pow(10, d), r = Math.round(Math.abs(n) * p) / p;
    if (r === 0) return CUR + fmt(0, d);
    return (n > 0 ? '+' : MINUS) + CUR + fmt(r, d);
  }
  function cp(n) {
    var r = Math.round(n); if (r === 0) return '0';
    var a = Math.abs(r), s = a >= 10000 ? Math.round(a / 1000) + 'k' : a >= 1000 ? (a / 1000).toFixed(1) + 'k' : String(a);
    return (r > 0 ? '+' : MINUS) + s;
  }
  function fmtR(r) {
    if (r == null) return '—';
    var a = Math.round(Math.abs(r) * 100) / 100;
    return (a === 0 ? '' : r > 0 ? '+' : MINUS) + a.toFixed(2) + 'R';
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function cls(n) { var r = Math.round(n * 100); return r > 0 ? 'pos' : r < 0 ? 'neg' : 'flat'; }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseYmd(str) { var p = String(str).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function todayStr() { return ymd(new Date()); }
  function fmtDate(str) { var d = parseYmd(str); return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear(); }
  function weekdayIdx(str) { return (parseYmd(str).getDay() + 6) % 7; }
  function safeUrl(u) {
    if (!u) return null;
    try { var x = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : null; }
    catch (e) { return null; }
  }
  function calcR(side, entry, sl, exit) {
    if (entry == null || sl == null || exit == null) return null;
    var risk = Math.abs(entry - sl); if (risk === 0) return null;
    return Math.round((side === 'sell' ? entry - exit : exit - entry) / risk * 100) / 100;
  }
  function outcome(t) { return t.pnl > 0 ? 'Win' : t.pnl < 0 ? 'Loss' : 'Break-even'; }
  function newId(p) { return (p || 't') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }
  function pbName(id) {
    if (!id) return '';
    var p = state.playbooks.find(function (x) { return x.id === id; });
    return p ? p.name : 'Deleted playbook';
  }

  /* ---------- models ---------- */
  function normTrade(t) {
    return {
      id: String(t.id), date: String(t.date || todayStr()), time: String(t.time || ''), asset: String(t.asset || ''), side: t.side === 'sell' ? 'sell' : 'buy',
      entry: t.entry == null ? '' : String(t.entry), sl: t.sl == null ? '' : String(t.sl), tp: t.tp == null ? '' : String(t.tp), exit: t.exit == null ? '' : String(t.exit),
      pnl: Number(t.pnl) || 0, r: t.r == null || t.r === '' ? null : Number(t.r), risk: t.risk == null || t.risk === '' || !isFinite(Number(t.risk)) ? null : Number(t.risk), playbook: String(t.playbook || ''), emotion: String(t.emotion || ''),
      followed: t.followed !== false, misses: Array.isArray(t.misses) ? t.misses.map(String) : [], lesson: String(t.lesson || ''), shot: String(t.shot || ''), shotId: String(t.shotId || ''), mistakes: Array.isArray(t.mistakes) ? t.mistakes.map(String) : [],
      example: !!t.example, createdAt: Number(t.createdAt) || 0
    };
  }
  function normPb(p) {
    return { id: String(p.id), name: String(p.name || 'Untitled'), description: String(p.description || ''), rules: Array.isArray(p.rules) ? p.rules.map(String) : [], example: !!p.example, createdAt: Number(p.createdAt) || 0 };
  }

  var CUR = '';
  function pcts(x) { var r = Math.round(Math.abs(x) * 10) / 10; return (r === 0 ? '' : x > 0 ? '+' : MINUS) + r.toFixed(1) + '%'; }
  function normDay(d) { var m = Number(d.mood); return { id: String(d.id), date: String(d.date || d.id), plan: String(d.plan || ''), review: String(d.review || ''), mood: m >= 1 && m <= 5 ? Math.round(m) : null, example: !!d.example }; }
  function posNum(v) { var n = Number(v); return v != null && v !== '' && isFinite(n) && n > 0 ? n : null; }
  function normSettings(o) {
    o = o || {}; var b = Number(o.balance), r = Number(o.riskPct);
    return { balance: o.balance != null && o.balance !== '' && isFinite(b) && b > 0 ? b : null, riskPct: o.riskPct != null && o.riskPct !== '' && isFinite(r) && r > 0 ? r : null, currency: String(o.currency || '').trim().slice(0, 4), monthlyTarget: posNum(o.monthlyTarget), maxTradesDay: posNum(o.maxTradesDay) ? Math.round(posNum(o.maxTradesDay)) : null, dailyLoss: posNum(o.dailyLoss), example: !!o.example };
  }
  function applySettings() { CUR = state.settings.currency || ''; }
  function riskLimit() { var s = state.settings; return s.balance && s.riskPct ? s.balance * s.riskPct / 100 : null; }
  function isOver(t) { var l = riskLimit(); return l != null && t.risk != null && t.risk > l * 1.05; }
  function dayOf(date) { return state.days.find(function (d) { return d.id === date; }) || null; }
  function dayHasNote(d) { return !!(d && (d.plan || d.review || d.mood)); }

  /* ---------- analytics ---------- */
  function sortedAsc(ts) {
    return (ts || state.trades).slice().sort(function (a, b) {
      var ka = a.date + (a.time || '00:00'), kb = b.date + (b.time || '00:00');
      return ka < kb ? -1 : ka > kb ? 1 : a.createdAt - b.createdAt;
    });
  }
  function analyze(ts) {
    var sorted = sortedAsc(ts);
    var a = { n: sorted.length, total: 0, wins: 0, losses: 0, be: 0, gw: 0, gl: 0, best: null, worst: null, rSum: 0, rN: 0, followed: 0, maxDD: 0, streakW: 0, streakL: 0, eq: [0], dd: [0], sorted: sorted, days: {} };
    var peak = 0, cw = 0, cl = 0;
    sorted.forEach(function (t) {
      var p = t.pnl;
      a.total += p;
      if (p > 0) { a.wins++; a.gw += p; a.best = a.best == null ? p : Math.max(a.best, p); cw++; cl = 0; }
      else if (p < 0) { a.losses++; a.gl += -p; a.worst = a.worst == null ? p : Math.min(a.worst, p); cl++; cw = 0; }
      else { a.be++; cw = 0; cl = 0; }
      a.streakW = Math.max(a.streakW, cw); a.streakL = Math.max(a.streakL, cl);
      if (t.r != null) { a.rSum += t.r; a.rN++; }
      if (t.followed) a.followed++;
      var e = a.eq[a.eq.length - 1] + p; a.eq.push(e);
      peak = Math.max(peak, e); var dd = peak - e; a.dd.push(-dd); a.maxDD = Math.max(a.maxDD, dd);
      var d = a.days[t.date] || (a.days[t.date] = { net: 0, n: 0, trades: [] });
      d.net += p; d.n++; d.trades.push(t);
    });
    a.winRate = a.n ? a.wins / a.n : 0;
    a.pf = a.gl === 0 ? (a.gw > 0 ? Infinity : null) : a.gw / a.gl;
    a.avgWin = a.wins ? a.gw / a.wins : 0;
    a.avgLoss = a.losses ? -a.gl / a.losses : 0;
    a.avgR = a.rN ? a.rSum / a.rN : 0;
    a.expectancy = a.n ? a.total / a.n : 0;
    var dk = Object.keys(a.days);
    a.dayCount = dk.length;
    a.greenDays = dk.filter(function (k) { return a.days[k].net > 0; }).length;
    a.redDays = dk.filter(function (k) { return a.days[k].net < 0; }).length;
    return a;
  }
  function computeScore(a) {
    if (a.n < 5) return null;
    var wl = a.losses === 0 ? (a.wins > 0 ? Infinity : 0) : (a.wins === 0 ? 0 : a.avgWin / -a.avgLoss);
    var rec = a.maxDD === 0 ? (a.total > 0 ? Infinity : 0) : a.total / a.maxDD;
    var gd = a.dayCount ? a.greenDays / a.dayCount : 0, fr = a.followed / a.n;
    var parts = [
      { label: 'Win rate', value: pct(a.winRate), score: clamp01((a.winRate - 0.30) / 0.30) * 100 },
      { label: 'Profit factor', value: a.pf == null ? '—' : a.pf === Infinity ? '∞' : a.pf.toFixed(2), score: a.pf == null ? 0 : a.pf === Infinity ? 100 : clamp01((a.pf - 0.5) / 2) * 100 },
      { label: 'Avg win vs avg loss', value: wl === Infinity ? '∞' : wl.toFixed(2) + '×', score: wl === Infinity ? 100 : clamp01((wl - 0.5) / 1.5) * 100 },
      { label: 'Drawdown recovery', value: rec === Infinity ? '∞' : rec.toFixed(1) + '×', score: rec === Infinity ? 100 : clamp01(rec / 3) * 100 },
      { label: 'Green days', value: pct(gd), score: clamp01((gd - 0.30) / 0.40) * 100 },
      { label: 'Plan discipline', value: pct(fr), score: fr * 100 }
    ];
    var total = Math.round(parts.reduce(function (s, p) { return s + p.score; }, 0) / parts.length);
    return { total: total, parts: parts, label: total >= 80 ? 'Sharp' : total >= 60 ? 'Solid' : total >= 40 ? 'Building' : 'Needs work' };
  }
  function groupBy(ts, keyFn) {
    var map = {};
    ts.forEach(function (t) {
      var k = keyFn(t); if (k == null || k === '') return;
      var g = map[k] || (map[k] = { key: k, n: 0, wins: 0, pnl: 0, rSum: 0, rN: 0 });
      g.n++; g.pnl += t.pnl; if (t.pnl > 0) g.wins++;
      if (t.r != null) { g.rSum += t.r; g.rN++; }
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }
  function mistakeRows(ts) {
    var mk = {};
    ts.forEach(function (t) {
      t.mistakes.forEach(function (m) {
        var x = mk[m] || (mk[m] = { key: m, n: 0, wins: 0, pnl: 0, rSum: 0, rN: 0 });
        x.n++; x.pnl += t.pnl; if (t.pnl > 0) x.wins++;
        if (t.r != null) { x.rSum += t.r; x.rN++; }
      });
    });
    return Object.keys(mk).map(function (k) { return mk[k]; }).sort(function (x, y) { return x.pnl - y.pnl; });
  }
  function lite(ts) { var n = ts.length, w = 0, tot = 0; ts.forEach(function (t) { tot += t.pnl; if (t.pnl > 0) w++; }); return { n: n, total: tot, winRate: n ? w / n : 0 }; }

  /* ---------- storage ---------- */
  function persistLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ trades: state.trades, playbooks: state.playbooks, days: state.days, settings: state.settings }));
      if (authUser && !state.readOnlyCloud) localSnapshot = captureLocalSnapshot();
    } catch (e) {}
  }
  function loadLocal() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      state.trades = (o.trades || []).map(normTrade); state.playbooks = (o.playbooks || []).map(normPb);
      state.days = (o.days || []).map(normDay); state.settings = normSettings(o.settings);
    } catch (e) { state.trades = []; state.playbooks = []; state.days = []; state.settings = normSettings(null); }
    applySettings();
  }
  function cloudWriteReady() {
    if (state.mode !== 'cloud') return false;
    if (!authUser || !activeCloudUserId || authUser.id !== activeCloudUserId || !activeCloudAdapter) throw new Error('Your account connection changed. Refresh the journal before trying again.');
    return true;
  }
  var cloudWriteQueue = Promise.resolve();
  function cloudWrite(task, apply) {
    var writeUserId = activeCloudUserId, writeSessionToken = authLoadToken;
    var run = cloudWriteQueue.then(function () {
      if (!writeUserId || authLoadToken !== writeSessionToken || !authUser || authUser.id !== writeUserId || activeCloudUserId !== writeUserId || state.mode !== 'cloud') {
        throw new Error('Your account connection changed before this save started. Refresh the journal and try again.');
      }
      setDataState('cloud-syncing');
      return task();
    }).then(function (result) {
      if (authLoadToken !== writeSessionToken || !authUser || authUser.id !== writeUserId || activeCloudUserId !== writeUserId || state.mode !== 'cloud') {
        throw new Error('Your account changed while this save was in progress. Sign in again and refresh to confirm the cloud result.');
      }
      apply(); renderAll(); setDataState('cloud-synced'); return result;
    }).catch(function (error) {
      if (authUser && authUser.id === writeUserId && activeCloudUserId === writeUserId && state.mode === 'cloud') setDataState('cloud-error');
      throw error;
    });
    cloudWriteQueue = run.catch(function () {});
    return run;
  }
  function put(kind, obj) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') return Promise.reject(new Error(state.readOnlyCloud ? 'The cloud journal is read-only in this stage.' : 'The cloud journal is still loading. Please wait before making changes.'));
    if (cloudWriteReady()) { var adapter = activeCloudAdapter; return cloudWrite(function () { return adapter.put(kind, obj); }, function () {
      var list = state[kind], i = list.findIndex(function (x) { return x.id === obj.id; });
      if (i >= 0) list[i] = obj; else list.push(obj);
    }); }
    var list = state[kind], i = list.findIndex(function (x) { return x.id === obj.id; });
    if (i >= 0) list[i] = obj; else list.push(obj);
    persistLocal(); renderAll(); return Promise.resolve();
  }
  function del(kind, id) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') return Promise.reject(new Error(state.readOnlyCloud ? 'The cloud journal is read-only in this stage.' : 'The cloud journal is still loading. Please wait before making changes.'));
    if (cloudWriteReady()) { var adapter = activeCloudAdapter; return cloudWrite(function () { return adapter.del(kind, id); }, function () {
      state[kind] = state[kind].filter(function (x) { return x.id !== id; });
    }); }
    state[kind] = state[kind].filter(function (x) { return x.id !== id; });
    persistLocal(); renderAll(); return Promise.resolve();
  }
  function saveSettings(obj) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') return Promise.reject(new Error(state.readOnlyCloud ? 'The cloud journal is read-only in this stage.' : 'The cloud journal is still loading. Please wait before making changes.'));
    if (cloudWriteReady()) { var adapter = activeCloudAdapter; return cloudWrite(function () { return adapter.saveSettings(obj); }, function () {
      state.settings = obj; applySettings();
    }); }
    state.settings = obj; applySettings(); persistLocal(); renderAll(); return Promise.resolve();
  }

  /* ---------- Supabase journal data adapter (Phase 2A/2B) ---------- */
  // Stage 3 uses the shared adapter for authenticated cloud loading and writes.
  // Guest migration preview uses dedicated RPCs; import and screenshot upload require separate explicit workflows.
  function cloudAdapterFor(userId) {
    if (!window.MaxiCloudAdapterFactory) throw new Error('Supabase data adapter module did not load.');
    return window.MaxiCloudAdapterFactory(authClient, userId, {
      normPb: normPb, normTrade: normTrade, normDay: normDay,
      normSettings: normSettings, num: num
    });
  }

  function seq(items, fn) { return items.reduce(function (p, x) { return p.then(function () { return fn(x); }); }, Promise.resolve()); }
  function failMsg(e) { return 'Could not save: ' + ((e && e.message) || 'try again'); }
  // Explicit data states distinguish local storage, cloud loading and read-only cloud viewing.
  var dataStateText = {
    'guest-local': 'Saved in this browser only',
    'account-local': 'Account connected · data still local',
    'session-error': 'Account status unavailable · journal local',
    'cloud-loading': 'Loading account journal',
    'cloud-syncing': 'Saving to your account',
    'cloud-synced': 'Synced to your account',
    'cloud-error': 'Cloud save not confirmed',
    'cloud-load-error': 'Cloud journal unavailable · local preserved',
    offline: 'Offline · cloud unavailable',
    'cloud-readonly': 'Cloud journal · read-only',
    'cloud-ready': 'Cloud journal · connected'
  };
  var dataStateTitles = {
    'guest-local': 'Journal data is stored only in this browser. It is not backed up or synced to an account.',
    'account-local': 'You are signed in, but journal data remains local to this browser. No cloud journal data has been loaded or saved.',
    'session-error': 'The journal remains local. We could not verify the account session; refresh and try again.',
    'cloud-loading': 'Account journal data is being loaded.',
    'cloud-syncing': 'A journal change is being saved to your account.',
    'cloud-synced': 'The latest journal change was confirmed saved to your account.',
    'cloud-error': 'The latest cloud save was not confirmed. Do not assume this change is synced.',
    'cloud-load-error': 'The cloud journal could not be loaded. Your browser journal remains available and unchanged.',
    offline: 'Network unavailable. Cloud changes cannot currently be confirmed.',
    'cloud-readonly': 'You are viewing records loaded from your Supabase account. Editing, deleting and saving are disabled in this stage.',
    'cloud-ready': 'Your account journal is loaded. New changes are saved to Supabase and confirmed before the screen updates.'
  };
  var authClient = window.maxiSupabase || null;
  var authUser = null;
  var authPanel = null;
  var authFormMode = 'signin';
  var localSnapshot = null;
  var authLoadToken = 0;
  var activeCloudUserId = null;
  var activeCloudAdapter = null;
  var migrationPanel = null;
  var migrationBusy = false;
  var migrationConsentUserId = null;
  function setDataState(kind) {
    if (!Object.prototype.hasOwnProperty.call(dataStateText, kind)) kind = 'guest-local';
    state.dataState = kind;
    var chip = $('sync');
    var visualState = kind === 'cloud-loading' || kind === 'cloud-syncing' ? 'loading'
      : kind === 'cloud-synced' || kind === 'cloud-readonly' || kind === 'cloud-ready' ? 'cloud'
      : kind === 'cloud-error' || kind === 'cloud-load-error' || kind === 'session-error' || kind === 'offline' ? 'error'
      : kind === 'account-local' ? 'account-local' : 'local';
    chip.setAttribute('data-state', visualState);
    chip.setAttribute('aria-label', dataStateText[kind]);
    $('sync-text').textContent = dataStateText[kind];
    chip.title = dataStateTitles[kind];
  }
  // Kept as a narrow alias for existing initialization call sites.
  function setSync(kind) {
    setDataState(kind === 'local' ? 'guest-local' : kind === 'account-local' ? 'account-local' : kind);
  }
  function authNotice(message, isError) {
    if (!authPanel) return;
    var note = authPanel.querySelector('.auth-message');
    note.textContent = message || '';
    note.setAttribute('data-kind', isError ? 'error' : 'info');
  }
  function showAuthForm(mode) {
    authFormMode = mode;
    if (!authPanel) return;
    var form = authPanel.querySelector('.auth-form');
    var heading = authPanel.querySelector('.auth-form-title');
    var submit = authPanel.querySelector('.auth-submit');
    var toggle = authPanel.querySelector('.auth-toggle');
    var email = authPanel.querySelector('#maxi-auth-email');
    var password = authPanel.querySelector('#maxi-auth-password');
    heading.textContent = mode === 'signup' ? 'Create your free account' : 'Sign in to your account';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    toggle.textContent = mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account';
    form.hidden = false;
    authPanel.querySelector('.auth-message').textContent = '';
    if (email) email.focus();
    if (password) { password.value = ''; password.setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password'); }
  }
  function migrationStableString(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(migrationStableString).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + migrationStableString(value[key]);
    }).join(',') + '}';
  }
  function migrationHash(value) {
    var input = typeof value === 'string' ? value : migrationStableString(value);
    function hash(seed) {
      var h = seed >>> 0;
      for (var i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return ('00000000' + h.toString(16)).slice(-8);
    }
    return hash(2166136261) + hash(2246822519);
  }
  function migrationHasSettings(s) {
    s = s || {};
    return s.balance != null || s.riskPct != null || !!s.currency ||
      s.monthlyTarget != null || s.maxTradesDay != null || s.dailyLoss != null;
  }
  function migrationComparable(type, p) {
    if (type === 'playbook') return { name: p.name || '', description: p.description || '', rules: p.rules || [] };
    if (type === 'trade') return {
      date: p.date || '', time: p.time || '', asset: p.asset || '', side: p.side || 'buy',
      entry: p.entry == null ? '' : String(p.entry), sl: p.sl == null ? '' : String(p.sl),
      tp: p.tp == null ? '' : String(p.tp), exit: p.exit == null ? '' : String(p.exit),
      pnl: Number(p.pnl) || 0, r: p.r == null ? null : Number(p.r), risk: p.risk == null ? null : Number(p.risk),
      playbook: p.playbook || '', emotion: p.emotion || '', followed: p.followed !== false,
      misses: p.misses || [], mistakes: p.mistakes || [], lesson: p.lesson || ''
    };
    if (type === 'daily_journal') return { date: p.date || p.id || '', plan: p.plan || '', review: p.review || '', mood: p.mood == null ? null : Number(p.mood) };
    if (type === 'settings') return {
      balance: p.balance == null ? null : Number(p.balance), riskPct: p.riskPct == null ? null : Number(p.riskPct),
      currency: p.currency || '', monthlyTarget: p.monthlyTarget == null ? null : Number(p.monthlyTarget),
      maxTradesDay: p.maxTradesDay == null ? null : Number(p.maxTradesDay),
      dailyLoss: p.dailyLoss == null ? null : Number(p.dailyLoss)
    };
    return p;
  }
  function migrationSourceRecords() {
    if (!localSnapshot) return [];
    var records = [];
    (localSnapshot.playbooks || []).filter(function (p) { return !p.example; }).forEach(function (p) {
      records.push({ type: 'playbook', key: String(p.id), payload: {
        id: String(p.id), name: p.name || 'Untitled', description: p.description || '',
        rules: Array.isArray(p.rules) ? p.rules.slice() : [], example: false
      }});
    });
    (localSnapshot.trades || []).filter(function (t) { return !t.example; }).forEach(function (t) {
      records.push({ type: 'trade', key: String(t.id), payload: {
        id: String(t.id), date: String(t.date || ''), time: String(t.time || ''),
        asset: String(t.asset || ''), side: t.side === 'sell' ? 'sell' : 'buy',
        entry: t.entry, sl: t.sl, tp: t.tp, exit: t.exit, pnl: Number(t.pnl) || 0,
        r: t.r, risk: t.risk, playbook: String(t.playbook || ''), emotion: String(t.emotion || ''),
        followed: t.followed !== false, misses: Array.isArray(t.misses) ? t.misses.slice() : [],
        mistakes: Array.isArray(t.mistakes) ? t.mistakes.slice() : [], lesson: String(t.lesson || ''),
        shot: '', shotId: '', example: false
      }});
      if (t.shot || t.shotId) {
        records.push({ type: 'attachment', key: 'attachment_' + String(t.id), payload: {
          trade_id: String(t.id), has_local_image: !!t.shot, has_legacy_image_id: !!t.shotId,
          storage_upload_required: true
        }});
      }
    });
    (localSnapshot.days || []).filter(function (d) { return !d.example && (d.plan || d.review || d.mood); }).forEach(function (d) {
      records.push({ type: 'daily_journal', key: String(d.date || d.id), payload: {
        id: String(d.date || d.id), date: String(d.date || d.id), plan: d.plan || '',
        review: d.review || '', mood: d.mood == null ? null : Number(d.mood), example: false
      }});
    });
    if (migrationHasSettings(localSnapshot.settings) && !localSnapshot.settings.example) {
      var s = localSnapshot.settings;
      records.push({ type: 'settings', key: 'guest-settings', payload: {
        balance: s.balance, currency: s.currency || '', riskPct: s.riskPct,
        monthlyTarget: s.monthlyTarget, maxTradesDay: s.maxTradesDay,
        dailyLoss: s.dailyLoss, example: false
      }});
    }
    return records;
  }
  function migrationValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
    var date = new Date(String(value) + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === String(value);
  }
  function migrationTradeCore(p) {
    return { date: p.date || '', time: p.time || '', asset: p.asset || '', side: p.side || 'buy',
      entry: p.entry == null ? '' : String(p.entry), sl: p.sl == null ? '' : String(p.sl),
      tp: p.tp == null ? '' : String(p.tp), exit: p.exit == null ? '' : String(p.exit), pnl: Number(p.pnl) || 0 };
  }
  function migrationClassify(record) {
    var type = record.type, p = record.payload, list, found = null;
    if (type === 'attachment') return 'conflict';
    if (type === 'playbook') list = state.playbooks;
    else if (type === 'trade') list = state.trades;
    else if (type === 'daily_journal') list = state.days;
    if (type === 'settings') {
      if (!migrationHasSettings(state.settings)) return 'new';
      return migrationStableString(migrationComparable('settings', p)) ===
        migrationStableString(migrationComparable('settings', state.settings)) ? 'duplicate' : 'conflict';
    }
    if (type === 'daily_journal') {
      found = (list || []).find(function (x) { return !x.example && String(x.date || x.id) === String(p.date); });
    } else {
      found = (list || []).find(function (x) { return !x.example && String(x.id) === String(p.id); });
      if (!found && type === 'trade') {
        found = (list || []).find(function (x) {
          return !x.example && migrationStableString(migrationTradeCore(x)) === migrationStableString(migrationTradeCore(p));
        });
      }
    }
    if (!found) {
      if (type === 'trade' && p.playbook) {
        var guestPb = (localSnapshot.playbooks || []).some(function (x) { return !x.example && String(x.id) === p.playbook; });
        var cloudPb = (state.playbooks || []).some(function (x) { return !x.example && String(x.id) === p.playbook; });
        if (!guestPb && !cloudPb) return 'conflict';
      }
      return 'new';
    }
    return migrationStableString(migrationComparable(type, p)) ===
      migrationStableString(migrationComparable(type, found)) ? 'duplicate' : 'conflict';
  }
  function migrationBuildItems() {
    return migrationSourceRecords().map(function (record) {
      var payload = record.payload;
      var invalid = !record.key || record.key.length > 240;
      if (record.type === 'trade') {
        var numericFields = [payload.entry, payload.sl, payload.tp, payload.exit, payload.risk, payload.r];
        var numericValid = numericFields.every(function (value) { return value == null || value === '' || isFinite(Number(value)); });
        var timeValid = !payload.time || /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(payload.time);
        if (!migrationValidDate(payload.date) || !payload.asset || !['buy', 'sell'].includes(payload.side) || !numericValid || !timeValid) invalid = true;
      }
      if (record.type === 'daily_journal' && (!migrationValidDate(payload.date) || (payload.mood != null && (payload.mood < 1 || payload.mood > 5)))) invalid = true;
      var classification = invalid ? 'invalid' : migrationClassify(record);
      var fingerprint = migrationHash(payload);
      return {
        entity_type: record.type, source_record_key: record.key,
        fingerprint: fingerprint, classification: classification, payload: payload
      };
    });
  }
  function migrationDisplayName(item) {
    var p = item.payload || {};
    return p.name || p.asset || p.date || p.trade_id || item.source_record_key;
  }
  function migrationRenderPreview(batch, items) {
    if (!migrationPanel) return;
    var results = migrationPanel.querySelector('.migration-results');
    results.textContent = '';
    var title = h('h3', { text: 'Preview ready — nothing imported' });
    var counts = h('div', { class: 'migration-counts' });
    [
      ['Total', batch.records_seen || 0], ['New', batch.records_new || 0],
      ['Duplicates', batch.records_duplicate || 0], ['Conflicts', batch.records_conflict || 0],
      ['Invalid', batch.records_invalid || 0]
    ].forEach(function (entry) {
      counts.appendChild(h('div', { class: 'migration-count' },
        h('strong', { text: String(entry[1]) }), h('span', { text: entry[0] })));
    });
    var note = h('p', { class: 'migration-note', text: 'Preview only. These record details have been copied to private migration staging tables for this account; they have not been added to your cloud journal. Before a future import, each trade will need an explicit trading-account choice or confirmation to remain unassigned; settings need separate confirmation. Screenshot attachments require a separate upload step. Your original guest journal remains in this browser.' });
    var list = h('div', { class: 'migration-item-list' });
    items.slice(0, 40).forEach(function (item) {
      list.appendChild(h('div', { class: 'migration-item' },
        h('span', { class: 'migration-item-type', text: item.entity_type.replace('_', ' ') }),
        h('span', { class: 'migration-item-name', text: migrationDisplayName(item) }),
        h('span', { class: 'migration-item-state', 'data-state': item.classification, text: item.classification })));
    });
    if (items.length > 40) list.appendChild(h('p', { class: 'migration-note', text: 'Showing 40 of ' + items.length + ' records. All records are included in the saved preview.' }));
    results.appendChild(title); results.appendChild(counts); results.appendChild(note); results.appendChild(list);
    results.hidden = false;

  }
  async function runGuestMigrationPreview() {
    if (migrationBusy) return;
    if (!authUser || !activeCloudAdapter || state.mode !== 'cloud' || !localSnapshot) {
      migrationPanel.querySelector('.migration-status').textContent = 'Sign in and wait for your cloud journal to finish loading before preparing a preview.';
      return;
    }
    var consent = migrationPanel.querySelector('.migration-consent-check');
    if (!consent || !consent.checked) {
      migrationPanel.querySelector('.migration-status').textContent = 'Please confirm that you want to copy a snapshot of these guest records into private migration staging for preview. No journal import will happen.';
      return;
    }
    var items = migrationBuildItems();
    if (!items.length) {
      migrationPanel.querySelector('.migration-status').textContent = 'No non-example guest records or personal settings were found in this browser.';
      migrationPanel.querySelector('.migration-results').hidden = true;
      return;
    }
    migrationBusy = true;
    var previewUserId = authUser.id;
    var previewSessionToken = authLoadToken;
    function ensurePreviewOwner() {
      if (!authUser || authUser.id !== previewUserId || activeCloudUserId !== previewUserId ||
          authLoadToken !== previewSessionToken || state.mode !== 'cloud') {
        throw new Error('The signed-in account changed during preview. No further migration preview steps were started.');
      }
    }
    var button = migrationPanel.querySelector('.migration-preview-btn');
    button.disabled = true; button.textContent = 'Preparing preview…';
    migrationPanel.querySelector('.migration-status').textContent = 'Comparing your browser journal with this account and staging a read-only preview…';
    try {
      var localHash = migrationHash(items.map(function (x) { return [x.entity_type, x.source_record_key, x.fingerprint]; }));
      var cloudHash = migrationHash({
        trades: (state.trades || []).map(function (x) { return migrationComparable('trade', x); }),
        playbooks: (state.playbooks || []).map(function (x) { return migrationComparable('playbook', x); }),
        days: (state.days || []).map(function (x) { return migrationComparable('daily_journal', x); }),
        settings: migrationComparable('settings', state.settings)
      });
      var manifest = {
        source: 'maxi-trades-journal-local-browser', source_version: 'guest-v1',
        local_snapshot_hash: localHash, cloud_snapshot_hash: cloudHash,
        counts: items.reduce(function (out, x) { out[x.entity_type] = (out[x.entity_type] || 0) + 1; return out; }, {})
      };
      var key = 'guest-v1-' + migrationHash({ local: localHash, cloud: cloudHash });
      var created = await authClient.rpc('create_guest_migration_batch', {
        p_migration_key: key, p_source_version: 'guest-v1', p_manifest: manifest
      });
      if (created.error) throw created.error;
      ensurePreviewOwner();
      var batchId = created.data;
      var batchResult = await authClient.from('guest_migration_batches')
        .select('id,status,summary,records_seen,records_new,records_duplicate,records_conflict,records_invalid')
        .eq('user_id', authUser.id).eq('id', batchId).single();
      if (batchResult.error) throw batchResult.error;
      ensurePreviewOwner();
      if (batchResult.data.status === 'draft') {
        for (var offset = 0; offset < items.length; offset += 250) {
          var staged = await authClient.rpc('stage_guest_migration_items', {
            p_batch_id: batchId, p_items: items.slice(offset, offset + 250)
          });
          if (staged.error) throw staged.error;
          ensurePreviewOwner();
        }
        var finalized = await authClient.rpc('finalize_guest_migration_preview', {
          p_batch_id: batchId, p_preview_notes: { source: 'account-ui', local_snapshot_hash: localHash, cloud_snapshot_hash: cloudHash }
        });
        if (finalized.error) throw finalized.error;
        ensurePreviewOwner();
      } else if (batchResult.data.status !== 'previewed') {
        throw new Error('A previous preview for this exact snapshot is ' + batchResult.data.status + '. Change the guest journal or cloud journal, then prepare a fresh preview.');
      }
      var latest = await authClient.from('guest_migration_batches')
        .select('id,status,summary,records_seen,records_new,records_duplicate,records_conflict,records_invalid')
        .eq('user_id', authUser.id).eq('id', batchId).single();
      if (latest.error) throw latest.error;
      ensurePreviewOwner();
      var rows = await authClient.from('guest_migration_items')
        .select('entity_type,source_record_key,classification,import_status,payload')
        .eq('user_id', authUser.id).eq('batch_id', batchId)
        .order('entity_type', { ascending: true }).order('source_record_key', { ascending: true });
      if (rows.error) throw rows.error;
      ensurePreviewOwner();
      migrationRenderPreview(latest.data, rows.data || []);
      migrationPanel.querySelector('.migration-status').textContent = 'Preview saved to private migration staging for this account. No journal records were imported; browser guest data is unchanged.';
    } catch (error) {
      migrationPanel.querySelector('.migration-status').textContent = 'Preview could not be completed: ' + ((error && error.message) || 'Please try again.');
    } finally {
      migrationBusy = false;
      button.textContent = 'Prepare / refresh migration preview';
      refreshMigrationPanel();
    }
  }
  function refreshMigrationPanel() {
    if (!migrationPanel) return;
    if (!authUser) {
      migrationConsentUserId = null;
      migrationPanel.querySelector('.migration-consent-check').checked = false;
    }
    var ready = !!authUser && state.mode === 'cloud' && !!activeCloudAdapter && !state.readOnlyCloud;
    migrationPanel.hidden = !ready;
    if (!ready) return;
    if (migrationConsentUserId !== authUser.id) {
      migrationPanel.querySelector('.migration-consent-check').checked = false;
      migrationConsentUserId = authUser.id;
    }
    var records = migrationSourceRecords();
    var detail = migrationPanel.querySelector('.migration-description');
    detail.textContent = records.length
      ? records.length + ' guest records or settings are available locally. Review a comparison with your account before deciding whether to migrate.'
      : 'No personal guest records or settings were found in this browser. Example records are excluded.';
    var button = migrationPanel.querySelector('.migration-preview-btn');
    button.disabled = migrationBusy || !records.length || !migrationPanel.querySelector('.migration-consent-check').checked;
  }
  function buildMigrationPanel() {
    migrationPanel = h('section', { class: 'migration-panel', hidden: true, 'aria-label': 'Guest journal migration' },
      h('div', { class: 'migration-heading' },
        h('div', {}, h('strong', { text: 'Guest journal migration' }),
          h('p', { class: 'migration-description', text: 'Your browser journal stays separate until you explicitly choose to prepare a preview.' })),
        h('button', { class: 'btn btn-primary migration-preview-btn', type: 'button', text: 'Prepare migration preview', disabled: true, onclick: function () {
          runGuestMigrationPreview();
        }})),
      h('label', { class: 'migration-consent' },
        h('input', { class: 'migration-consent-check', type: 'checkbox', onchange: function () { refreshMigrationPanel(); } }),
        h('span', { text: 'I understand this copies a snapshot of my guest records into private migration staging tables for preview only. It will not add records to my cloud journal or delete my browser data.' })),
      h('p', { class: 'migration-status', role: 'status', 'aria-live': 'polite', text: 'Preparing a preview will not import or change any journal records.' }),
      h('div', { class: 'migration-results', hidden: true })
    );
    return migrationPanel;
  }
  function refreshAuthPanel() {
    if (!authPanel) return;
    var signedIn = !!authUser;
    authPanel.querySelector('.auth-state-title').textContent = signedIn ? 'Account connected' : 'Guest mode';
    authPanel.querySelector('.auth-state-detail').textContent = signedIn
      ? authUser.email || 'Signed-in account'
      : 'Your journal is saved in this browser. Sign in or create an account to prepare for secure cloud sync.';
    authPanel.querySelector('.auth-open').hidden = signedIn;
    authPanel.querySelector('.auth-signout').hidden = !signedIn;
    authPanel.querySelector('.auth-form').hidden = true;
    if (signedIn) {
      if (state.mode === 'cloud-readonly') {
        authNotice('Your cloud journal is loaded in read-only mode. Changes are disabled; your browser guest journal remains separate and untouched.', false);
        setDataState('cloud-readonly');
      } else if (state.mode === 'cloud') {
        authNotice('Your account journal is connected. Trade, playbook, daily-note and settings changes save to your account. Guest data remains separate. Chart image uploads are not enabled yet.', false);
        if (state.dataState !== 'cloud-syncing' && state.dataState !== 'cloud-error') setDataState('cloud-ready');
      } else if (state.dataState !== 'cloud-loading' && state.dataState !== 'cloud-error' && state.dataState !== 'cloud-load-error') {
        authNotice('Your account is authenticated. Your browser journal remains local unless the cloud journal has loaded successfully.', false);
        setDataState('account-local');
      }
    } else {
      authNotice('Guest data stays on this device. Signing in does not upload, merge, overwrite or delete it.', false);
      if (!state.readOnlyCloud) setDataState('guest-local');
    }
    refreshMigrationPanel();
  }
  function captureLocalSnapshot() {
    return {
      trades: state.trades.map(normTrade), playbooks: state.playbooks.map(normPb),
      days: state.days.map(normDay), settings: normSettings(state.settings)
    };
  }
  function restoreLocalSnapshot() {
    if (!localSnapshot) return;
    state.mode = 'local'; state.readOnlyCloud = false;
    state.trades = localSnapshot.trades.map(normTrade);
    state.playbooks = localSnapshot.playbooks.map(normPb);
    state.days = localSnapshot.days.map(normDay);
    state.settings = normSettings(localSnapshot.settings);
    applySettings(); renderAll();
  }
  async function loadCloudJournal(user) {
    if (!user || !user.id) return;
    if (activeCloudUserId === user.id && (state.dataState === 'cloud-loading' || state.mode === 'cloud-readonly' || state.mode === 'cloud')) return;
    activeCloudUserId = user.id;
    activeCloudAdapter = null;
    var token = ++authLoadToken;
    if (!localSnapshot) localSnapshot = captureLocalSnapshot();
    state.mode = 'local'; state.readOnlyCloud = false;
    setDataState('cloud-loading');
    authNotice('Loading your account journal. Your browser guest data is preserved separately.', false);
    renderAll();
    try {
      var adapter = cloudAdapterFor(user.id);
      var cloud = await adapter.load();
      if (token !== authLoadToken || !authUser || authUser.id !== user.id) return;
      activeCloudAdapter = adapter;
      state.trades = (cloud.trades || []).map(normTrade);
      state.playbooks = (cloud.playbooks || []).map(normPb);
      state.days = (cloud.days || []).map(normDay);
      state.settings = normSettings(cloud.settings);
      state.mode = 'cloud'; state.readOnlyCloud = false;
      applySettings(); setDataState('cloud-ready'); renderAll();
      authNotice('Cloud journal loaded successfully. Trade, playbook, daily-note and settings changes save to your account. Guest data remains separate. Chart image uploads are not enabled yet.', false);
      refreshMigrationPanel();
    } catch (error) {
      if (token !== authLoadToken) return;
      activeCloudAdapter = null; restoreLocalSnapshot(); setDataState('cloud-load-error'); renderAll();
      authNotice('Could not load your cloud journal: ' + ((error && error.message) || 'Please try again. Your browser journal is preserved and unchanged.'), true);
    }
  }
  function handleAuthSession(session) {
    var nextUser = session && session.user ? session.user : null;
    if (!nextUser) {
      authUser = null; authLoadToken++; activeCloudUserId = null; activeCloudAdapter = null;
      restoreLocalSnapshot(); localSnapshot = null; refreshAuthPanel(); renderAll(); return;
    }
    if (authUser && authUser.id !== nextUser.id) {
      authLoadToken++; activeCloudUserId = null; activeCloudAdapter = null; restoreLocalSnapshot();
    }
    authUser = nextUser; refreshAuthPanel(); loadCloudJournal(authUser);
  }
  function buildAuthPanel() {
    if (authPanel) return;
    authPanel = h('section', { id: 'auth-panel', class: 'auth-panel panel', 'aria-label': 'Account access' });
    var summary = h('div', { class: 'auth-summary' },
      h('div', { class: 'auth-copy' },
        h('strong', { class: 'auth-state-title', text: 'Guest mode' }),
        h('p', { class: 'auth-state-detail', text: 'Your journal is saved in this browser.' })),
      h('div', { class: 'auth-actions' },
        h('button', { class: 'btn btn-primary auth-open', type: 'button', text: 'Sign in / Create account', onclick: function () { showAuthForm('signin'); } }),
        h('button', { class: 'btn auth-signout', type: 'button', text: 'Sign out', hidden: true, onclick: async function () {
          if (!authClient) return;
          var b = authPanel.querySelector('.auth-signout');
          b.disabled = true;
          var result = await authClient.auth.signOut();
          b.disabled = false;
          if (result.error) authNotice('Could not sign out: ' + result.error.message, true);
          else { handleAuthSession(null); authNotice('You are signed out. Your local journal has not been changed.', false); }
        } })),
    );
    var form = h('form', { class: 'auth-form', hidden: true, novalidate: true });
    form.appendChild(h('h2', { class: 'auth-form-title', text: 'Sign in to your account' }));
    form.appendChild(h('div', { class: 'auth-fields' },
      h('div', { class: 'field' }, h('label', { for: 'maxi-auth-email', text: 'Email address' }), h('input', { id: 'maxi-auth-email', type: 'email', autocomplete: 'email', required: true, maxlength: '254', placeholder: 'you@example.com' })),
      h('div', { class: 'field' }, h('label', { for: 'maxi-auth-password', text: 'Password' }), h('input', { id: 'maxi-auth-password', type: 'password', autocomplete: 'current-password', required: true, minlength: '6', placeholder: 'At least 6 characters' }))));
    form.appendChild(h('div', { class: 'auth-form-actions' },
      h('button', { class: 'btn btn-primary auth-submit', type: 'submit', text: 'Sign in' }),
      h('button', { class: 'btn auth-toggle', type: 'button', text: 'New here? Create an account', onclick: function () { showAuthForm(authFormMode === 'signin' ? 'signup' : 'signin'); } }),
      h('button', { class: 'btn auth-cancel', type: 'button', text: 'Cancel', onclick: function () { form.hidden = true; authNotice('', false); } })));
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!authClient) { authNotice('Supabase is not configured. Check the project client setup.', true); return; }
      var email = form.querySelector('#maxi-auth-email').value.trim();
      var password = form.querySelector('#maxi-auth-password').value;
      var submit = form.querySelector('.auth-submit');
      if (!email || !password) { authNotice('Enter both your email address and password.', true); return; }
      if (password.length < 6) { authNotice('Your password must contain at least 6 characters.', true); return; }
      submit.disabled = true;
      authNotice(authFormMode === 'signup' ? 'Creating your account…' : 'Signing you in…', false);
      try {
        var result = authFormMode === 'signup'
          ? await authClient.auth.signUp({ email: email, password: password })
          : await authClient.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        if (authFormMode === 'signup' && result.data && result.data.user && !result.data.session) {
          form.hidden = true;
          authNotice('Account created. Check your email for the confirmation link, then return here and sign in. Your journal data has not been uploaded.', false);
        } else {
          authUser = result.data && result.data.user ? result.data.user : null;
          form.hidden = true;
          if (result.data && result.data.session) handleAuthSession(result.data.session);
          else refreshAuthPanel();
          authNotice('Signed in successfully. Your account journal is being checked; browser guest data remains separate.', false);
        }
      } catch (error) {
        authNotice('Authentication failed: ' + (error && error.message ? error.message : 'Please try again.'), true);
      } finally {
        submit.disabled = false;
      }
    });
    authPanel.appendChild(summary);
    authPanel.appendChild(buildMigrationPanel());
    authPanel.appendChild(form);
    authPanel.appendChild(h('p', { class: 'auth-message', role: 'status', 'aria-live': 'polite' }));
    var masthead = document.querySelector('.masthead');
    masthead.insertAdjacentElement('afterend', authPanel);
    refreshAuthPanel();
  }
  async function init() {
    state.mode = 'local';
    loadLocal();
    buildAuthPanel();
    renderAll();
    if (!authClient || !authClient.auth) {
      authNotice('Guest mode is available. Account access is unavailable because Supabase did not initialize.', true);
      setDataState('guest-local');
      return;
    }
    authClient.auth.onAuthStateChange(function (_event, session) { handleAuthSession(session); });
    try {
      var result = await authClient.auth.getSession();
      if (result.error) throw result.error;
      handleAuthSession(result.data && result.data.session ? result.data.session : null);
    } catch (error) {
      authUser = null;
      refreshAuthPanel();
      setDataState('session-error');
      authNotice('Could not verify your account session: ' + (error && error.message ? error.message : 'Please refresh and try again. Your journal remains local.'), true);
    }
  }

  /* ---------- example data ---------- */
  function mulberry(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function exampleData() {
    var rnd = mulberry(20261108), now = new Date(), stamp = Date.now();
    function pick(a) { return a[Math.floor(rnd() * a.length)]; }
    var pbs = STARTERS.map(function (s, i) { return normPb({ id: 'pbx' + stamp.toString(36) + i, name: s.name, description: s.description, rules: s.rules, example: true, createdAt: stamp + i }); });
    var assets = ['EURUSD', 'XAUUSD', 'BTCUSDT', 'NAS100', 'GBPJPY', 'AAPL'], good = ['Calm', 'Confident', 'Focused', 'Patient'], bad = ['Revenge', 'FOMO', 'Impatient'], hours = [8, 9, 9, 10, 10, 11, 13, 14, 15, 16];
    var L = {
      winF: ['Stuck to the plan and let the trade work.', 'Waited for confirmation and it paid off.', 'Sized correctly and left the stop alone.'],
      lossF: ['Valid setup that failed. The stop did its job.', 'Good process, bad outcome. Nothing to change.'],
      broke: ['Broke my rules and it cost me.', 'Entered without confirmation. Skip it next time.', 'Took this out of frustration after the last loss.']
    };
    var trades = [], k = 0;
    for (var back = 30; back >= 1; back--) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back), dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      var cnt = rnd() < 0.2 ? 0 : (rnd() < 0.5 ? 1 : (rnd() < 0.8 ? 2 : 3));
      for (var j = 0; j < cnt; j++) {
        var pb = pick(pbs), isBad = rnd() < 0.38, followed = !isBad || rnd() < 0.15, emo = isBad ? pick(bad) : pick(good);
        var base = pick([50, 60, 80, 100]), risk = followed ? base : Math.round(base * 1.8), win = rnd() < (followed ? 0.64 : 0.28), pnl;
        if (win) pnl = Math.round(risk * (1 + rnd() * 2.2)); else pnl = -Math.round(risk * (followed ? 0.7 + rnd() * 0.3 : 1 + rnd() * 0.9));
        var lesson = !followed ? pick(L.broke) : win ? pick(L.winF) : pick(L.lossF);
        trades.push(normTrade({
          id: 'tx' + stamp.toString(36) + (k++), date: ymd(d), time: String(pick(hours)).padStart(2, '0') + ':' + pick(['00', '15', '30', '45']), asset: pick(assets), side: rnd() < 0.5 ? 'buy' : 'sell',
          pnl: pnl, r: Math.round(pnl / risk * 100) / 100, risk: risk, playbook: pb.id, emotion: emo, followed: followed, misses: followed ? [] : [pick(pb.rules)], mistakes: (!followed ? [pick(['Moved stop', 'Chased price', 'Early exit', 'No setup'])] : []).concat(risk > 100 ? ['Oversized'] : []).concat(followed && rnd() < 0.12 ? ['Early exit'] : []), lesson: lesson, example: true, createdAt: stamp + k
        }));
      }
    }
    var byDay = {};
    trades.forEach(function (t) { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
    var days = Object.keys(byDay).sort().reverse().slice(0, 12).map(function (k) {
      var net = byDay[k], mood = net > 0 ? (rnd() < 0.6 ? 5 : 4) : (rnd() < 0.6 ? 2 : 3);
      return normDay({ id: k, date: k, mood: mood, example: true, plan: 'Only A+ setups. Max two trades. Stop after a loss.', review: net > 0 ? 'Followed the plan and let the winners run.' : 'Rushed an entry and ignored a rule. Slow down tomorrow.' });
    });
    return { playbooks: pbs, trades: trades, days: days };
  }

  /* ---------- toast + drawers ---------- */
  var toastTimer = null;
  function toast(msg) { var el = $('toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.hidden = true; }, 3200); }
  var openDrawerEl = null;
  function openDrawer(el, focusId) {
    state.lastFocus = document.activeElement;
    closeDrawers(true);
    el.hidden = false; $('scrim').hidden = false; document.documentElement.classList.add('lock'); openDrawerEl = el;
    el.scrollTop = 0;
    if (focusId) setTimeout(function () { var f = $(focusId); if (f) f.focus({ preventScroll: true }); }, 30);
  }
  function closeDrawers(silent) {
    ['drawer-trade', 'drawer-pb'].forEach(function (id) { $(id).hidden = true; });
    $('scrim').hidden = true; document.documentElement.classList.remove('lock'); openDrawerEl = null;
    if (!silent && state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* ---------- shared UI pieces ---------- */
  function deleteButton(onConfirm) {
    var armed = false, timer = null;
    var b = h('button', { class: 'btn btn-sm', type: 'button', text: 'Delete' });
    b.addEventListener('click', function () {
      if (!armed) {
        armed = true; b.textContent = 'Sure?'; b.classList.add('btn-danger');
        timer = setTimeout(function () { armed = false; b.textContent = 'Delete'; b.classList.remove('btn-danger'); }, 3000);
        return;
      }
      clearTimeout(timer); onConfirm();
    });
    return b;
  }
  function delTrade(id) { if (state.readOnlyCloud) { toast('Cloud journal is read-only in this stage'); return; } var tr = state.trades.find(function (x) { return x.id === id; }); del('trades', id).then(function () { if (tr && state.mode !== 'cloud') dropAsset(tr.shotId); toast('Trade deleted'); }).catch(function (e) { toast(failMsg(e)); }); }
  function planPill(t) { return h('span', { class: 'pill ' + (t.followed ? 'win' : 'loss'), text: t.followed ? 'Plan kept' : 'Plan broken' }); }
  function emptyHero() {
    return h('div', { class: 'panel hero-empty' },
      h('h2', { text: 'Your journal is empty' }),
      h('p', { text: 'Log your first trade to start building stats, a P&L calendar and a performance score. Or load example data to see how every page looks once it has trades in it.' }),
      h('div', { class: 'row-btns' },
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Log your first trade', onclick: function () { openTradeForm(null); } }),
        h('button', { class: 'btn', type: 'button', text: 'Load example data', onclick: loadExamples })));
  }
  function statTiles(a) {
    var has = a.n > 0, bal = state.settings.balance, box = h('section', { class: 'stats', 'aria-label': 'Performance summary' });
    var tiles = [
      ['Net P&L', has ? signed(a.total) : '—', has ? cls(a.total) : '', has ? a.n + (a.n === 1 ? ' trade' : ' trades') + ' · ' + signed(a.expectancy) + ' avg' : ''],
      ['Win rate', has ? (a.winRate * 100).toFixed(1) + '%' : '—', '', has ? a.wins + 'W · ' + a.losses + 'L · ' + a.be + 'BE' : ''],
      ['Profit factor', !has ? '—' : a.pf == null ? '—' : a.pf === Infinity ? '∞' : a.pf.toFixed(2), '', 'Gross win / gross loss'],
      ['Avg R', a.rN ? fmtR(a.avgR) : '—', a.rN ? cls(a.avgR) : '', a.rN ? 'Over ' + a.rN + (a.rN === 1 ? ' trade' : ' trades') : 'Needs R values'],
      ['Account', bal ? CUR + fmt(bal + a.total) : '—', bal ? cls(a.total) : '', bal ? pcts(a.total / bal * 100) + ' since start' : 'Set it in Settings'],
      ['Max drawdown', has ? (a.maxDD ? MINUS + CUR + fmt(a.maxDD) : CUR + '0.00') : '—', a.maxDD ? 'neg' : '', bal && a.maxDD ? MINUS + (a.maxDD / bal * 100).toFixed(1) + '% of account' : 'Peak to trough']
    ];
    tiles.forEach(function (t) { box.appendChild(h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: t[0] }), h('div', { class: 'stat-value ' + t[2], text: t[1] }), h('div', { class: 'stat-sub', text: t[3] }))); });
    return box;
  }
  function tradeCard(t) {
    var link = safeUrl(t.shot);
    return h('div', { class: 'tcard' },
      h('div', { class: 'tcard-top' },
        h('div', { class: 'asset' }, h('strong', { text: t.asset }), h('span', { class: 'pill', text: t.side === 'sell' ? 'Sell' : 'Buy' }), t.time ? h('span', { class: 'sub', text: t.time }) : null, t.example ? h('span', { class: 'pill ex', text: 'Example' }) : null),
        h('div', { class: 'pn ' + cls(t.pnl), text: signed(t.pnl) + (t.r != null ? '  ' + fmtR(t.r) : '') })),
      h('div', { class: 'asset' }, t.playbook ? h('span', { class: 'pill', text: pbName(t.playbook) }) : null, planPill(t), isOver(t) ? h('span', { class: 'pill loss', text: 'Over risk' }) : null, t.emotion ? h('span', { class: 'pill', text: t.emotion }) : null),
      mistakeRow(t),
      t.lesson ? h('p', { text: t.lesson }) : null,
      t.shotId ? h('a', { class: 'shotthumb', href: '/_blob/' + t.shotId, target: '_blank', rel: 'noopener' }, h('img', { src: '/_blob/' + t.shotId, alt: 'Chart screenshot for ' + t.asset, loading: 'lazy' })) : null,
      t.misses.length ? h('div', { class: 'cell-sub', text: 'Rules missed: ' + t.misses.join('; ') }) : null,
      h('div', { class: 'acts', style: 'justify-content:flex-start' },
        link ? h('a', { class: 'chartlink', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Chart ↗', style: 'margin:0 8px 0 0;align-self:center' }) : null,
        h('button', { class: 'btn btn-sm', type: 'button', text: 'Edit', onclick: function () { openTradeForm(t); } }), deleteButton(function () { delTrade(t.id); })));
  }
  function breakdown(rows, labelFn) {
    if (!rows.length) return h('p', { class: 'empty', text: 'Nothing to show yet.' });
    var max = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.pnl); })) || 1, box = h('div');
    rows.forEach(function (r) {
      box.appendChild(h('div', { class: 'brk' },
        h('div', null, h('div', { class: 'lab', text: labelFn ? labelFn(r.key) : r.key }), h('div', { class: 'meta', text: r.n + (r.n === 1 ? ' trade' : ' trades') + ' · ' + pct(r.wins / r.n) + ' win' + (r.rN ? ' · ' + fmtR(r.rSum / r.rN) : '') })),
        h('div', { class: 'track' }, h('i', { style: 'width:' + Math.max(2, Math.abs(r.pnl) / max * 100) + '%;background:' + (r.pnl >= 0 ? 'var(--win)' : 'var(--loss)') })),
        h('div', { class: 'val ' + cls(r.pnl), text: signed(r.pnl) })));
    });
    return box;
  }

  /* ---------- line chart ---------- */
  function niceTicks(min, max, target) {
    if (min === max) max = min + 1;
    var span = max - min, raw = span / target, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    var step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag, start = Math.floor(min / step) * step, end = Math.ceil(max / step) * step, out = [];
    for (var v = start; v <= end + step / 2; v += step) out.push(Math.round(v * 1e8) / 1e8);
    return out;
  }
  function tickLabel(v) { return (v < 0 ? MINUS : '') + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function lineChart(box, o) {
    box.textContent = '';
    var vals = o.vals, n = vals.length - 1;
    if (n < 1) { box.appendChild(h('p', { class: 'empty', text: o.empty })); return; }
    var W = Math.max(260, Math.floor(box.clientWidth) || 600), H = 250, m = { t: 22, r: 18, b: 30, l: 58 };
    var ticks = niceTicks(Math.min.apply(null, vals.concat(0)), Math.max.apply(null, vals.concat(0)), 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1], pw = W - m.l - m.r, ph = H - m.t - m.b;
    function X(i) { return m.l + (i / n) * pw; }
    function Y(v) { return m.t + (1 - (v - y0) / (y1 - y0)) * ph; }
    var svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': o.aria }), defs = sv('defs', {}, svg), g = sv('linearGradient', { id: o.gid, x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    sv('stop', { offset: '0', style: 'stop-color:var(--accent);stop-opacity:' + (o.flip ? '0' : '.38') }, g);
    sv('stop', { offset: '1', style: 'stop-color:var(--accent);stop-opacity:' + (o.flip ? '.38' : '0') }, g);
    ticks.forEach(function (v) {
      var y = Y(v);
      sv('line', { x1: m.l, x2: W - m.r, y1: y, y2: y, class: v === 0 ? 'zero' : 'gridl' }, svg);
      sv('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'tick' }, svg).textContent = tickLabel(v);
    });
    var step = Math.max(1, Math.ceil(n / 6)), xt = [];
    for (var i = 0; i <= n; i += step) xt.push(i);
    if (xt[xt.length - 1] !== n && n - xt[xt.length - 1] >= step / 2) xt.push(n);
    xt.forEach(function (i) { sv('text', { x: X(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === n ? 'end' : 'middle', class: 'tick' }, svg).textContent = i; });
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' ');
    var edge = o.flip ? m.t : m.t + ph;
    sv('path', { d: d + ' L' + X(n).toFixed(1) + ' ' + edge + ' L' + X(0).toFixed(1) + ' ' + edge + ' Z', class: 'ar', fill: 'url(#' + o.gid + ')' }, svg);
    sv('path', { d: d, class: 'ln' }, svg);
    if (o.pointClass && n <= 40) for (var k = 1; k <= n; k++) sv('circle', { cx: X(k), cy: Y(vals[k]), r: 3.5, class: o.pointClass(k) }, svg);
    sv('circle', { cx: X(n), cy: Y(vals[n]), r: 6, class: 'dot-end' }, svg);
    var ey = Y(vals[n]);
    sv('text', { x: X(n) - 12, y: ey - 12 < m.t - 4 ? ey + 22 : ey - 12, 'text-anchor': 'end', class: 'end-label' }, svg).textContent = signed(vals[n]);
    var guide = sv('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, class: 'guide', visibility: 'hidden' }, svg), hd = sv('circle', { cx: 0, cy: 0, r: 5, class: 'hover-dot', visibility: 'hidden' }, svg);
    var overlay = sv('rect', { x: m.l, y: m.t, width: pw, height: ph, fill: 'transparent' }, svg), tip = h('div', { class: 'tip', hidden: true });
    function show(e) {
      var r = svg.getBoundingClientRect(), i = Math.max(0, Math.min(n, Math.round((e.clientX - r.left - m.l) / pw * n))), x = X(i);
      guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.setAttribute('visibility', 'visible');
      hd.setAttribute('cx', x); hd.setAttribute('cy', Y(vals[i])); hd.setAttribute('visibility', 'visible');
      tip.textContent = '';
      o.tip(i).forEach(function (l, j) { tip.appendChild(h('div', { class: l.cls || '' }, j === 0 ? h('b', { text: l.text }) : l.text)); });
      tip.hidden = false;
      var tw = tip.offsetWidth || 140;
      tip.style.left = (x + 14 + tw > W ? Math.max(0, x - 14 - tw) : x + 14) + 'px';
    }
    function hide() { guide.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); tip.hidden = true; }
    overlay.addEventListener('pointermove', show); overlay.addEventListener('pointerdown', show); overlay.addEventListener('pointerleave', hide);
    box.appendChild(svg); box.appendChild(tip);
  }
  function equityChart(a) {
    var box = h('div', { class: 'chart' });
    setTimeout(function () {
      lineChart(box, {
        vals: a.eq, gid: 'eqfill', empty: 'Your equity curve starts with your first trade.', aria: 'Equity curve across ' + a.n + ' trades, ending at ' + signed(a.eq[a.n]),
        pointClass: function (k) { var p = a.sorted[k - 1].pnl; return p > 0 ? 'pt-pos' : p < 0 ? 'pt-neg' : 'pt-flat'; },
        tip: function (i) {
          if (i === 0) return [{ text: 'Start' }, { text: 'Equity 0.00' }];
          var t = a.sorted[i - 1];
          return [{ text: 'Trade ' + i + ' · ' + fmtDate(t.date) }, { text: t.asset + ' ' + (t.side === 'sell' ? 'SELL' : 'BUY') }, { text: 'P&L ' + signed(t.pnl), cls: cls(t.pnl) }, { text: 'Equity ' + signed(a.eq[i]) }];
        }
      });
    }, 0);
    return box;
  }

  /* ---------- view: dashboard ---------- */
  function viewDashboard(box) {
    var a = analyze(state.trades);
    box.appendChild(statTiles(a));
    if (!a.n) { box.appendChild(emptyHero()); return; }
    box.appendChild(todayPanel());
    var gp = goalsPanel(a); if (gp) box.appendChild(gp);
    var sc = computeScore(a), grid = h('div', { class: 'grid g-dash' });
    grid.appendChild(h('section', { class: 'panel a-eq' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Equity curve' }), h('span', { class: 'sub', text: 'Cumulative P&L by trade number' })), equityChart(a)));
    grid.appendChild(scorePanel(a, sc));
    var recent = h('ul', { class: 'recent' });
    a.sorted.slice(-6).reverse().forEach(function (t) {
      recent.appendChild(h('li', null,
        h('div', null, h('div', { class: 'asset' }, h('strong', { text: t.asset }), h('span', { class: 'pill', text: t.side === 'sell' ? 'Sell' : 'Buy' }), planPill(t)), h('div', { class: 'm', text: fmtDate(t.date) + (t.playbook ? ' · ' + pbName(t.playbook) : '') })),
        h('div', { class: 'p ' + cls(t.pnl), text: signed(t.pnl) + (t.r != null ? ' · ' + fmtR(t.r) : '') })));
    });
    grid.appendChild(h('section', { class: 'panel a-recent' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Recent trades' }), h('a', { class: 'sub', href: '#trades', text: 'View all' })), recent));
    box.appendChild(grid);
  }
  function scorePanel(a, sc) {
    var p = h('section', { class: 'panel a-score' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Journal score' }), h('span', { class: 'sub', text: 'Open formula, no black box' })));
    if (!sc) { p.appendChild(h('p', { class: 'empty', text: 'Log ' + (5 - a.n) + ' more ' + (5 - a.n === 1 ? 'trade' : 'trades') + ' to unlock your score. It needs 5 trades to mean anything.' })); return p; }
    var R = 54, C = 2 * Math.PI * R, ring = sv('svg', { class: 'ring', width: 140, height: 140, viewBox: '0 0 140 140', role: 'img', 'aria-label': 'Journal score ' + sc.total + ' out of 100' });
    sv('circle', { cx: 70, cy: 70, r: R, 'stroke-width': 12, class: 'track' }, ring);
    sv('circle', { cx: 70, cy: 70, r: R, 'stroke-width': 12, class: 'prog', 'stroke-dasharray': (C * sc.total / 100).toFixed(1) + ' ' + C.toFixed(1), transform: 'rotate(-90 70 70)' }, ring);
    var tx = sv('text', { x: 70, y: 80, 'text-anchor': 'middle', style: 'font:800 40px var(--font-display)' }, ring); tx.textContent = sc.total;
    p.appendChild(h('div', { class: 'score-top' }, ring, h('div', null, h('div', { class: 'score-label', text: sc.label }), h('div', { class: 'sub', text: 'Out of 100, average of six measures' }))));
    var parts = h('div', { class: 'parts' });
    sc.parts.forEach(function (x) { parts.appendChild(h('div', { class: 'part-row' }, h('span', { text: x.label }), h('span', { class: 'v', text: x.value }), h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(x.score) + '%' })))); });
    p.appendChild(parts);
    p.appendChild(h('details', { class: 'explain' }, h('summary', { text: 'How the score is calculated' }),
      h('ul', null,
        h('li', { text: 'Each measure scores 0 to 100, then the six are averaged with equal weight.' }),
        h('li', { text: 'Win rate: 30% scores 0, 60% scores 100.' }),
        h('li', { text: 'Profit factor: 0.5 scores 0, 2.5 scores 100.' }),
        h('li', { text: 'Avg win vs avg loss: 0.5× scores 0, 2× scores 100.' }),
        h('li', { text: 'Drawdown recovery (net P&L / max drawdown): 0 scores 0, 3× scores 100.' }),
        h('li', { text: 'Green days: 30% scores 0, 70% scores 100.' }),
        h('li', { text: 'Plan discipline: share of trades where you followed your plan.' }))));
    return p;
  }

  /* ---------- goals ---------- */
  function goalsPanel(a) {
    var s = state.settings;
    if (!s.monthlyTarget && !s.maxTradesDay && !s.dailyLoss) return null;
    var now = new Date(), mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'), key = todayStr(), items = [];
    function bar(fraction, bad) { return h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.round(clamp01(fraction) * 100) + '%;background:' + (bad ? 'var(--loss)' : 'var(--accent)') })); }
    function goal(label, value, vcls, sub, fraction, bad) { return h('div', { class: 'goal' }, h('div', { class: 'stat-label', text: label }), h('div', { class: 'goal-v ' + vcls, text: value }), h('div', { class: 'sub', text: sub }), bar(fraction, bad)); }
    if (s.monthlyTarget) {
      var net = 0; a.sorted.forEach(function (t) { if (t.date.slice(0, 7) === mk) net += t.pnl; });
      items.push(goal(MONTHS[now.getMonth()] + ' target', signed(net), cls(net), net >= s.monthlyTarget ? 'Target of ' + CUR + fmt(s.monthlyTarget) + ' reached' : Math.max(0, Math.round(net / s.monthlyTarget * 100)) + '% of ' + CUR + fmt(s.monthlyTarget), net / s.monthlyTarget, false));
    }
    var today = a.days[key] || { n: 0, net: 0 };
    if (s.maxTradesDay) {
      var atCap = today.n >= s.maxTradesDay;
      items.push(goal('Trades today', today.n + ' / ' + s.maxTradesDay, atCap ? 'neg' : '', today.n > s.maxTradesDay ? 'Over your cap. Stop trading.' : atCap ? 'Cap reached. Stop here.' : (s.maxTradesDay - today.n) + ' left', today.n / s.maxTradesDay, atCap));
    }
    if (s.dailyLoss) {
      var lost = Math.max(0, -today.net), hit = lost >= s.dailyLoss;
      items.push(goal('Loss today', lost ? MINUS + CUR + fmt(lost) : CUR + fmt(0), lost ? 'neg' : '', hit ? 'Daily loss limit reached. Stop here.' : 'Limit ' + CUR + fmt(s.dailyLoss), lost / s.dailyLoss, hit));
    }
    var row = h('div', { class: 'goal-row' });
    items.forEach(function (i) { row.appendChild(i); });
    return h('section', { class: 'panel goals' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Goals and limits' }), h('a', { class: 'sub', href: '#settings', text: 'Edit' })), row);
  }
  function updateLimitWarn() {
    var el = $('limit-warn'), s = state.settings, date = $('f-date').value;
    el.hidden = true;
    if (state.editingTrade || !date) return;
    var info = analyze(state.trades).days[date], n = info ? info.n : 0, net = info ? info.net : 0, msgs = [];
    if (s.maxTradesDay && n >= s.maxTradesDay) msgs.push('You have already logged ' + n + (n === 1 ? ' trade' : ' trades') + ' on this day, at or past your cap of ' + s.maxTradesDay + '.');
    if (s.dailyLoss && -net >= s.dailyLoss) msgs.push('This day is already down ' + CUR + fmt(-net) + ', at or past your loss limit of ' + CUR + fmt(s.dailyLoss) + '.');
    if (msgs.length) { el.textContent = msgs.join(' ') + ' Consider stopping for the day.'; el.hidden = false; }
  }

  /* ---------- screenshots + mistakes ---------- */
  function shrinkImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var sc = Math.min(1, 1600 / Math.max(img.width, img.height)), cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * sc)); cv.height = Math.max(1, Math.round(img.height * sc));
        var cx = cv.getContext('2d'); cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(function (b) { URL.revokeObjectURL(url); if (b) resolve(b); else reject(new Error('Could not read that image.')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not an image this browser can read.')); };
      img.src = url;
    });
  }
  function renderShotPrev() {
    var box = $('shot-prev'), s = state.shot; box.textContent = '';
    var src = s.preview || (s.existing && !s.remove ? '/_blob/' + s.existing : '');
    if (!src) return;
    box.appendChild(h('img', { src: src, alt: 'Chart screenshot preview' }));
    box.appendChild(h('button', { class: 'btn btn-sm', type: 'button', text: 'Remove', onclick: function () {
      if (s.preview) URL.revokeObjectURL(s.preview);
      s.blob = null; s.preview = ''; if (s.existing) s.remove = true;
      $('f-shotfile').value = ''; renderShotPrev();
    } }));
  }
  function resetShot(existing) {
    if (state.shot.preview) URL.revokeObjectURL(state.shot.preview);
    state.shot = { blob: null, preview: '', existing: existing || '', remove: false };
    $('f-shotfile').value = ''; renderShotPrev();
  }
  function shotPrep(existing) {
    var s = state.shot, old = existing ? existing.shotId : '';
    if (state.mode === 'cloud' && s.blob) return Promise.reject(new Error('Chart image uploads are not enabled for cloud journals yet. Close and reopen this trade form to clear the guest image selection, then save without an image.'));
    if (state.mode === 'cloud') return Promise.resolve({ id: '', drop: '' });
    if (s.blob && state.assets) return state.assets.upload(s.blob).then(function (res) { return { id: res.id, drop: old }; });
    if (s.remove) return Promise.resolve({ id: '', drop: old });
    return Promise.resolve({ id: old, drop: '' });
  }
  function dropAsset(id) {
    if (!id || !state.assets || !state.assets.delete) return;
    try { Promise.resolve(state.assets.delete(id)).catch(function () {}); } catch (e) {}
  }
  function pickedMistakes() { return Array.prototype.filter.call($('mchips').querySelectorAll('input'), function (c) { return c.checked; }).map(function (c) { return c.value; }); }
  function setMistakes(list) { Array.prototype.forEach.call($('mchips').querySelectorAll('input'), function (c) { c.checked = list.indexOf(c.value) >= 0; }); }
  function mistakeRow(t) {
    if (!t.mistakes.length) return null;
    var d = h('div', { class: 'asset' });
    t.mistakes.forEach(function (m) { d.appendChild(h('span', { class: 'pill loss', text: m })); });
    return d;
  }

  /* ---------- daily notes ---------- */
  function dayNotesForm(date) {
    var cur = dayOf(date);
    var plan = h('textarea', { id: 'dn-plan', placeholder: 'Setups to take, levels, max trades, rules for the day.' });
    var review = h('textarea', { id: 'dn-review', placeholder: 'End of day: what went well and what to fix.' });
    plan.value = cur ? cur.plan : ''; review.value = cur ? cur.review : '';
    var mood = h('div', { class: 'mood', role: 'radiogroup', 'aria-label': 'Mood today, 1 poor to 5 great' });
    for (var i = 1; i <= 5; i++) {
      var inp = h('input', { type: 'radio', name: 'dn-mood', id: 'dn-mood' + i, value: String(i) });
      if (cur && cur.mood === i) inp.checked = true;
      mood.appendChild(inp); mood.appendChild(h('label', { for: 'dn-mood' + i, text: String(i) }));
    }
    var msg = h('p', { class: 'form-msg', role: 'alert' }), save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save notes' });
    save.addEventListener('click', function () {
      var picked = mood.querySelector('input:checked'), p = plan.value.trim(), r = review.value.trim(), m = picked ? Number(picked.value) : null, empty = !p && !r && !m;
      if (state.readOnlyCloud) { msg.textContent = 'This cloud journal is read-only. Your notes cannot be changed in this stage.'; return; }
      if (state.mode === 'pending') { msg.textContent = 'Still connecting to your saved journal. Try again in a moment.'; return; }
      save.disabled = true; msg.textContent = '';
      var op = empty ? del('days', date) : put('days', normDay({ id: date, date: date, plan: p, review: r, mood: m, example: cur ? cur.example : false }));
      op.then(function () { toast(empty ? 'Notes cleared' : 'Notes saved'); }).catch(function (e) { msg.textContent = failMsg(e); }).then(function () { save.disabled = false; });
    });
    var clr = h('button', { class: 'btn', type: 'button', text: 'Clear mood', onclick: function () { var c = mood.querySelector('input:checked'); if (c) c.checked = false; } });
    return h('div', null,
      h('div', { class: 'fields' },
        h('div', { class: 'field full' }, h('label', { for: 'dn-plan', text: 'Plan for the day' }), plan),
        h('div', { class: 'field full' }, h('label', { for: 'dn-review', text: 'Review of the day' }), review),
        h('div', { class: 'field full' }, h('span', { class: 'lbl', text: 'Mood (1 poor, 5 great)' }), mood)),
      msg, h('div', { class: 'form-actions' }, save, clr));
  }
  function todayPanel() {
    var key = todayStr(), d = dayOf(key), has = dayHasNote(d), showPlan = !!(d && d.plan);
    function go() {
      var n = new Date(); state.month = { y: n.getFullYear(), m: n.getMonth() }; state.selDay = key;
      if (location.hash === '#calendar') renderView(); else location.hash = '#calendar';
    }
    return h('section', { class: 'panel today' },
      h('div', { class: 'grow' }, h('div', { class: 'stat-label', text: showPlan ? "Today's plan" : 'Today' }),
        h('p', { text: showPlan ? d.plan : 'No plan written for today yet. Two lines before the open is enough.' })),
      h('button', { class: 'btn' + (has ? '' : ' btn-primary'), type: 'button', text: has ? 'Open notes' : 'Plan your day', onclick: go }));
  }

  /* ---------- view: calendar ---------- */
  function viewCalendar(box) {
    var now = new Date(), m = state.month || (state.month = { y: now.getFullYear(), m: now.getMonth() });
    var a = analyze(state.trades), first = new Date(m.y, m.m, 1), dim = new Date(m.y, m.m + 1, 0).getDate(), lead = (first.getDay() + 6) % 7, weeks = Math.ceil((lead + dim) / 7);
    var days = [];
    for (var d = 1; d <= dim; d++) { var key = ymd(new Date(m.y, m.m, d)); if (a.days[key]) days.push({ key: key, v: a.days[key] }); }
    var net = 0, nt = 0, g = 0, r = 0, best = null, maxAbs = 1;
    days.forEach(function (x) { net += x.v.net; nt += x.v.n; if (x.v.net > 0) g++; else if (x.v.net < 0) r++; if (!best || x.v.net > best.v.net) best = x; maxAbs = Math.max(maxAbs, Math.abs(x.v.net)); });
    function shift(dm) { var nd = new Date(m.y, m.m + dm, 1); state.month = { y: nd.getFullYear(), m: nd.getMonth() }; state.selDay = null; renderView(); }
    box.appendChild(h('div', { class: 'cal-head' },
      h('div', { class: 'nv' }, h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Previous month', text: '‹', onclick: function () { shift(-1); } }), h('div', { class: 'cal-title', text: MONTHS[m.m] + ' ' + m.y }), h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Next month', text: '›', onclick: function () { shift(1); } })),
      h('button', { class: 'btn btn-sm', type: 'button', text: 'Today', onclick: function () { state.month = null; state.selDay = null; renderView(); } })));
    var tiles = h('div', { class: 'cal-tiles' });
    [['Month P&L', nt ? signed(net) : '—', nt ? cls(net) : ''], ['Trades', String(nt), ''], ['Green / red days', g + ' / ' + r, ''], ['Best day', best ? signed(best.v.net) : '—', best ? cls(best.v.net) : '']].forEach(function (t) {
      tiles.appendChild(h('div', { class: 'mini' }, h('div', { class: 'stat-label', text: t[0] }), h('div', { class: 'stat-value ' + t[2], text: t[1] })));
    });
    var panel = h('section', { class: 'panel' }, tiles), cal = h('div', { class: 'cal' }), todayKey = todayStr();
    DOW.forEach(function (n) { cal.appendChild(h('div', { class: 'cal-h', text: n })); });
    cal.appendChild(h('div', { class: 'cal-h', text: 'Week' }));
    for (var w = 0; w < weeks; w++) {
      var wn = 0, wc = 0;
      for (var c = 0; c < 7; c++) {
        var dn = w * 7 + c - lead + 1;
        if (dn < 1 || dn > dim) { cal.appendChild(h('div', { class: 'day out' })); continue; }
        var k = ymd(new Date(m.y, m.m, dn)), info = a.days[k], cellCls = 'day' + (k === todayKey ? ' today' : '') + (state.selDay === k ? ' sel' : '');
        if (info) {
          wn += info.net; wc += info.n;
          var inten = Math.round(14 + 42 * Math.abs(info.net) / maxAbs), col = info.net > 0 ? 'var(--win)' : info.net < 0 ? 'var(--loss)' : 'var(--muted)';
          cal.appendChild(h('button', { class: cellCls, type: 'button', style: 'background:color-mix(in srgb, ' + col + ' ' + inten + '%, var(--surface-2))', 'aria-label': fmtDate(k) + ': ' + signed(info.net) + ' from ' + info.n + ' trades', onclick: (function (kk) { return function () { state.selDay = state.selDay === kk ? null : kk; renderView(); }; })(k) },
            h('span', { class: 'dn', text: String(dn) }), h('span', { class: 'dp', text: cp(info.net) }), h('span', { class: 'dc', text: info.n + (info.n === 1 ? ' trade' : ' trades') }), dayHasNote(dayOf(k)) ? h('span', { class: 'nd', title: 'Has notes' }) : null));
        } else cal.appendChild(h('button', { class: cellCls, type: 'button', 'aria-label': fmtDate(k) + ': no trades. Open notes', onclick: (function (kk) { return function () { state.selDay = state.selDay === kk ? null : kk; renderView(); }; })(k) }, h('span', { class: 'dn', text: String(dn) }), dayHasNote(dayOf(k)) ? h('span', { class: 'nd', title: 'Has notes' }) : null));
      }
      cal.appendChild(h('div', { class: 'day wk' }, h('span', { class: 'dn', text: 'Wk ' + (w + 1) }), h('span', { class: 'dp ' + (wc ? cls(wn) : ''), text: wc ? cp(wn) : '' }), h('span', { class: 'dc', text: wc ? wc + (wc === 1 ? ' trade' : ' trades') : '' })));
    }
    panel.appendChild(cal);
    box.appendChild(panel);
    if (!state.trades.length) box.appendChild(h('div', { style: 'margin-top:16px' }, emptyHero()));
    if (state.selDay) {
      var info2 = a.days[state.selDay], cards = h('div', { class: 'tcards' });
      if (info2) info2.trades.forEach(function (t) { cards.appendChild(tradeCard(t)); });
      box.appendChild(h('section', { class: 'panel day-detail' },
        h('div', { class: 'panel-head' }, h('h2', { text: fmtDate(state.selDay) }), h('span', { class: 'sub ' + (info2 ? cls(info2.net) : ''), text: info2 ? signed(info2.net) + ' net' : 'No trades' })),
        dayNotesForm(state.selDay),
        info2 ? h('div', { style: 'margin-top:18px' }, h('div', { class: 'lbl', text: 'Trades' }), cards) : null));
    }
  }

  /* ---------- view: trades ---------- */
  function filteredTrades() {
    var f = state.filters, q = f.q.trim().toLowerCase();
    return sortedAsc().reverse().filter(function (t) {
      if (q && (t.asset + ' ' + t.lesson + ' ' + t.emotion + ' ' + pbName(t.playbook)).toLowerCase().indexOf(q) < 0) return false;
      if (f.pb === '_none' ? t.playbook : f.pb && t.playbook !== f.pb) return false;
      if (f.outcome && outcome(t) !== f.outcome) return false;
      if (f.plan === 'kept' && !t.followed) return false;
      if (f.plan === 'broken' && t.followed) return false;
      return true;
    });
  }
  function fillTradeTable(box, count) {
    var ts = filteredTrades(); box.textContent = '';
    count.textContent = ts.length === state.trades.length ? ts.length + (ts.length === 1 ? ' trade' : ' trades') : ts.length + ' of ' + state.trades.length;
    if (!ts.length) { box.appendChild(h('p', { class: 'empty', text: 'No trades match these filters.' })); return; }
    var tbl = h('table', { class: 'tbl-log' }, h('thead', null, h('tr', null, h('th', { text: 'Date' }), h('th', { text: 'Asset' }), h('th', { text: 'Playbook' }), h('th', { text: 'Emotion' }), h('th', { text: 'Plan' }), h('th', { class: 'num', text: 'P&L' }), h('th', { class: 'num', text: 'R' }), h('th', { text: '' }))));
    var body = h('tbody');
    ts.forEach(function (t) {
      var link = safeUrl(t.shot), prices = (t.entry || t.exit) ? (t.entry || '—') + ' → ' + (t.exit || '—') : '';
      body.appendChild(h('tr', null,
        h('td', { class: 'mono nowrap' }, fmtDate(t.date), t.time ? h('div', { class: 'cell-sub', text: t.time }) : null),
        h('td', null, h('div', { class: 'asset' }, h('strong', { text: t.asset }), h('span', { class: 'pill', text: t.side === 'sell' ? 'Sell' : 'Buy' }), t.example ? h('span', { class: 'pill ex', text: 'Example' }) : null),
          prices ? h('div', { class: 'cell-sub', text: prices }) : null, t.shotId ? h('a', { class: 'chartlink', style: 'margin-right:10px', href: '/_blob/' + t.shotId, target: '_blank', rel: 'noopener', text: 'Screenshot' }) : null, link ? h('a', { class: 'chartlink', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Chart ↗' }) : null),
        h('td', { text: t.playbook ? pbName(t.playbook) : '—' }),
        h('td', { text: t.emotion || '—' }),
        h('td', null, planPill(t), isOver(t) ? h('span', { class: 'pill loss', text: 'Over risk', style: 'margin-left:6px' }) : null, t.misses.length ? h('div', { class: 'cell-sub', text: t.misses.join('; ') }) : null, t.mistakes.length ? h('div', { class: 'cell-sub', text: t.mistakes.join(', ') }) : null),
        h('td', { class: 'num ' + cls(t.pnl), text: signed(t.pnl) }),
        h('td', { class: 'num ' + (t.r != null ? cls(t.r) : ''), text: fmtR(t.r) }),
        h('td', null, h('div', { class: 'acts' }, h('button', { class: 'btn btn-sm', type: 'button', text: 'Edit', onclick: function () { openTradeForm(t); } }), deleteButton(function () { delTrade(t.id); })))));
    });
    tbl.appendChild(body); box.appendChild(h('div', { class: 'tablewrap' }, tbl));
  }
  function viewTrades(box) {
    if (!state.trades.length) { box.appendChild(emptyHero()); return; }
    var f = state.filters, count = h('span', { class: 'sub' }), tbox = h('div');
    function sel(key, opts) {
      var s = h('select', { 'aria-label': 'Filter by ' + key });
      opts.forEach(function (o) { s.appendChild(h('option', { value: o[0], text: o[1] })); });
      s.value = f[key]; s.addEventListener('change', function () { f[key] = s.value; fillTradeTable(tbox, count); }); return s;
    }
    var q = h('input', { class: 'q', type: 'search', placeholder: 'Search asset, lesson, emotion', 'aria-label': 'Search trades', value: f.q });
    q.addEventListener('input', function () { f.q = q.value; fillTradeTable(tbox, count); });
    var pbOpts = [['', 'All playbooks'], ['_none', 'No playbook']].concat(state.playbooks.map(function (p) { return [p.id, p.name]; }));
    var bar = h('div', { class: 'toolbar' }, q, sel('pb', pbOpts), sel('outcome', [['', 'All results'], ['Win', 'Wins'], ['Loss', 'Losses'], ['Break-even', 'Break-even']]), sel('plan', [['', 'All plans'], ['kept', 'Plan kept'], ['broken', 'Plan broken']]));
    box.appendChild(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Trade log' }), count), bar, tbox));
    fillTradeTable(tbox, count);
  }

  /* ---------- view: playbooks ---------- */
  function viewPlaybooks(box) {
    var head = h('div', { class: 'panel-head' }, h('h2', { text: 'Playbooks' }), h('div', { class: 'row-btns' },
      state.playbooks.length ? null : h('button', { class: 'btn', type: 'button', text: 'Add starter playbooks', onclick: addStarters }),
      h('button', { class: 'btn btn-primary', type: 'button', text: 'New playbook', onclick: function () { openPbForm(null); } })));
    box.appendChild(head);
    if (!state.playbooks.length) {
      box.appendChild(h('div', { class: 'panel hero-empty' }, h('h2', { text: 'Define how you trade' }), h('p', { text: 'A playbook is a setup with a rules checklist. Attach one to each trade and the journal shows which setups make money and which rules you keep breaking.' }),
        h('div', { class: 'row-btns' }, h('button', { class: 'btn btn-primary', type: 'button', text: 'Create a playbook', onclick: function () { openPbForm(null); } }), h('button', { class: 'btn', type: 'button', text: 'Add starter playbooks', onclick: addStarters }))));
      return;
    }
    var grid = h('div', { class: 'pbgrid' });
    state.playbooks.slice().sort(function (x, y) { return x.createdAt - y.createdAt; }).forEach(function (p) {
      var ts = state.trades.filter(function (t) { return t.playbook === p.id; }), a = analyze(ts), rules = h('ul');
      p.rules.forEach(function (r) { rules.appendChild(h('li', { text: r })); });
      grid.appendChild(h('section', { class: 'panel pb' },
        h('div', { class: 'asset' }, h('h3', { text: p.name }), p.example ? h('span', { class: 'pill ex', text: 'Example' }) : null),
        p.description ? h('p', { class: 'pb-desc', text: p.description }) : null,
        h('div', { class: 'pb-stats' },
          h('div', null, h('b', { text: String(a.n) }), h('span', { text: 'Trades' })), h('div', null, h('b', { text: a.n ? pct(a.winRate) : '—' }), h('span', { text: 'Win rate' })),
          h('div', null, h('b', { class: a.n ? cls(a.total) : '', text: a.n ? signed(a.total) : '—' }), h('span', { text: 'Net P&L' })), h('div', null, h('b', { text: a.n ? pct(a.followed / a.n) : '—' }), h('span', { text: 'Rules kept' }))),
        p.rules.length ? h('div', null, h('div', { class: 'lbl', text: 'Checklist' }), rules) : null,
        h('div', { class: 'acts', style: 'justify-content:flex-start' }, h('button', { class: 'btn btn-sm', type: 'button', text: 'Edit', onclick: function () { openPbForm(p); } }),
          deleteButton(function () { del('playbooks', p.id).then(function () { toast('Playbook deleted'); }).catch(function (e) { toast(failMsg(e)); }); }))));
    });
    box.appendChild(grid);
  }
  function addStarters() {
    var stamp = Date.now();
    seq(STARTERS, function (s) { return put('playbooks', normPb({ id: newId('pb'), name: s.name, description: s.description, rules: s.rules, createdAt: stamp + STARTERS.indexOf(s) })); }).then(function () { toast('Starter playbooks added'); }).catch(function (e) { toast(failMsg(e)); });
  }

  /* ---------- view: reports ---------- */
  function viewReports(box) {
    var a = analyze(state.trades);
    if (!a.n) { box.appendChild(emptyHero()); return; }
    var ts = a.sorted;
    function panel(title, sub, body, extra) { return h('section', { class: 'panel ' + (extra || '') }, h('div', { class: 'panel-head' }, h('h2', { text: title }), sub ? h('span', { class: 'sub', text: sub }) : null), body); }
    var wd = groupBy(ts, function (t) { return weekdayIdx(t.date); }).sort(function (x, y) { return x.key - y.key; });
    var hr = groupBy(ts, function (t) { return t.time ? t.time.slice(0, 2) : ''; }).sort(function (x, y) { return x.key < y.key ? -1 : 1; });
    var asset = groupBy(ts, function (t) { return t.asset; }).sort(function (x, y) { return y.pnl - x.pnl; }).slice(0, 10);
    var pbs = groupBy(ts, function (t) { return t.playbook || '_none'; }).sort(function (x, y) { return y.pnl - x.pnl; });
    var side = groupBy(ts, function (t) { return t.side; }).sort(function (x, y) { return y.pnl - x.pnl; });
    var chart = h('div', { class: 'chart' });
    setTimeout(function () {
      lineChart(chart, { vals: a.dd, gid: 'ddfill', flip: true, empty: 'Drawdown shows once you have a trade.', aria: 'Drawdown from equity peak, worst ' + MINUS + fmt(a.maxDD),
        tip: function (i) { return i === 0 ? [{ text: 'Start' }, { text: 'Drawdown 0.00' }] : [{ text: 'Trade ' + i + ' · ' + fmtDate(ts[i - 1].date) }, { text: 'Drawdown ' + (a.dd[i] === 0 ? '0.00' : signed(a.dd[i])), cls: a.dd[i] < 0 ? 'neg' : '' }]; } });
    }, 0);
    var streaks = h('div', { class: 'cal-tiles', style: 'margin:0 0 4px' });
    [['Best win streak', String(a.streakW), 'pos'], ['Worst loss streak', String(a.streakL), a.streakL ? 'neg' : ''], ['Best trade', a.best == null ? '—' : signed(a.best), 'pos'], ['Worst trade', a.worst == null ? '—' : signed(a.worst), a.worst == null ? '' : 'neg']].forEach(function (t) {
      streaks.appendChild(h('div', { class: 'mini' }, h('div', { class: 'stat-label', text: t[0] }), h('div', { class: 'stat-value ' + t[2], text: t[1] })));
    });
    var g = h('div', { class: 'grid g-two' });
    g.appendChild(panel('Streaks and extremes', null, streaks, 'span2'));
    g.appendChild(panel('Drawdown', 'Distance below your equity peak', chart, 'span2'));
    g.appendChild(panel('By weekday', 'Net P&L', breakdown(wd, function (k) { return DOW[k]; })));
    g.appendChild(panel('By hour of day', 'Needs a time on the trade', hr.length ? breakdown(hr, function (k) { return k + ':00'; }) : h('p', { class: 'empty', text: 'Add a time when you log trades to see which hours work for you.' })));
    g.appendChild(panel('By asset', 'Top 10 by net P&L', breakdown(asset)));
    g.appendChild(panel('By playbook', 'Net P&L', breakdown(pbs, function (k) { return k === '_none' ? 'No playbook' : pbName(k); })));
    g.appendChild(panel('Buy vs sell', null, breakdown(side, function (k) { return k === 'sell' ? 'Sell' : 'Buy'; })));
    var mrows = mistakeRows(ts);
    g.appendChild(panel('Mistakes', 'Net P&L of trades with each tag', mrows.length ? breakdown(mrows) : h('p', { class: 'empty', text: 'Tick mistakes when you log a trade to see what each one costs.' })));
    box.appendChild(g);
  }

  /* ---------- view: insights ---------- */
  function buildInsights(a) {
    var ts = a.sorted, out = [], fol = ts.filter(function (t) { return t.followed; }), brk = ts.filter(function (t) { return !t.followed; });
    if (brk.length) {
      var f = lite(fol), b = lite(brk);
      out.push({ label: 'What breaking your plan cost', value: signed(b.total), c: cls(b.total), text: 'You broke your plan on ' + brk.length + ' of ' + ts.length + ' trades (' + pct(brk.length / ts.length) + '). Those trades won ' + pct(b.winRate) + ' of the time. When you followed your plan you won ' + pct(f.winRate) + ' and netted ' + signed(f.total) + '.' });
    } else out.push({ label: 'Plan discipline', value: '100%', c: 'pos', text: 'You marked every trade as plan-followed. Keep logging honestly, because the value is in spotting the exceptions.' });
    var emo = groupBy(ts, function (t) { return t.emotion; }).filter(function (g) { return g.n >= 2; });
    var worstE = emo.slice().sort(function (x, y) { return x.pnl - y.pnl; })[0], bestE = emo.slice().sort(function (x, y) { return y.pnl - x.pnl; })[0];
    if (worstE && worstE.pnl < 0) out.push({ label: 'Costliest emotion', value: worstE.key, c: 'neg', text: worstE.n + ' trades while ' + worstE.key.toLowerCase() + ', netting ' + signed(worstE.pnl) + ' at a ' + pct(worstE.wins / worstE.n) + ' win rate.' });
    if (bestE && bestE.pnl > 0) out.push({ label: 'Best state of mind', value: bestE.key, c: 'pos', text: bestE.n + ' trades while ' + bestE.key.toLowerCase() + ', netting ' + signed(bestE.pnl) + ' at a ' + pct(bestE.wins / bestE.n) + ' win rate.' });
    var counts = {}; ts.forEach(function (t) { t.misses.forEach(function (m) { counts[m] = (counts[m] || 0) + 1; }); });
    var top = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x]; })[0];
    if (top) out.push({ label: 'Rule you break most', value: counts[top] + '×', c: 'neg', text: '“' + top + '” was missed on ' + counts[top] + (counts[top] === 1 ? ' trade.' : ' trades.') });
    var costly = mistakeRows(ts).filter(function (x) { return x.n >= 2 && x.pnl < 0; });
    if (costly.length) {
      var mw = costly[0], clean = lite(ts.filter(function (t) { return !t.mistakes.length; }));
      out.push({ label: 'Costliest mistake', value: mw.key, c: 'neg', text: mw.n + ' trades, netting ' + signed(mw.pnl) + '.' + (clean.n ? ' Trades with no mistakes netted ' + signed(clean.total) + ' at a ' + pct(clean.winRate) + ' win rate.' : '') });
    }
    var capN = state.settings.maxTradesDay, capDays = capN ? Object.keys(a.days).filter(function (k) { return a.days[k].n > capN; }) : [];
    if (capDays.length) {
      var restDays = Object.keys(a.days).filter(function (k) { return capDays.indexOf(k) < 0; });
      var avgOf = function (keys) { return keys.reduce(function (s, k) { return s + a.days[k].net; }, 0) / keys.length; };
      out.push({ label: 'Overtrading days', value: String(capDays.length), c: cls(avgOf(capDays)), text: capDays.length + (capDays.length === 1 ? ' day' : ' days') + ' went past your ' + capN + '-trade cap. Those days averaged ' + signed(avgOf(capDays)) + (restDays.length ? ', against ' + signed(avgOf(restDays)) + ' on other days.' : '.') });
    }
    if (riskLimit()) {
      var over = ts.filter(isOver);
      if (over.length) {
        var ov = lite(over), within = lite(ts.filter(function (t) { return !isOver(t) && t.risk != null; }));
        out.push({ label: 'Oversized trades', value: signed(ov.total), c: cls(ov.total), text: over.length + ' of ' + ts.length + ' trades risked more than your ' + state.settings.riskPct + '% limit. They won ' + pct(ov.winRate) + ' of the time' + (within.n ? ', against ' + pct(within.winRate) + ' for trades inside the limit.' : '.') });
      }
    }
    var mdays = state.days.filter(function (d) { return d.mood && a.days[d.id]; });
    var hi = mdays.filter(function (d) { return d.mood >= 4; }), lo = mdays.filter(function (d) { return d.mood <= 2; });
    function avgNet(list) { return list.reduce(function (s, d) { return s + a.days[d.id].net; }, 0) / list.length; }
    if (hi.length >= 2 && lo.length >= 2) out.push({ label: 'Mood and results', value: signed(avgNet(hi)), c: cls(avgNet(hi)), text: 'On days you rated your mood 4 or 5 you averaged ' + signed(avgNet(hi)) + ' (' + hi.length + ' days). On days rated 1 or 2 you averaged ' + signed(avgNet(lo)) + ' (' + lo.length + ' days).' });
    var wd = groupBy(ts, function (t) { return weekdayIdx(t.date); }).filter(function (g) { return g.n >= 2; }).sort(function (x, y) { return y.pnl - x.pnl; });
    if (wd.length > 1) {
      out.push({ label: 'Best weekday', value: DOW[wd[0].key], c: cls(wd[0].pnl), text: signed(wd[0].pnl) + ' over ' + wd[0].n + ' trades.' });
      var lw = wd[wd.length - 1]; if (lw.pnl < 0) out.push({ label: 'Weakest weekday', value: DOW[lw.key], c: 'neg', text: signed(lw.pnl) + ' over ' + lw.n + ' trades.' });
    }
    var hr = groupBy(ts, function (t) { return t.time ? t.time.slice(0, 2) : ''; }).filter(function (g) { return g.n >= 2; }).sort(function (x, y) { return y.pnl - x.pnl; });
    if (hr.length) out.push({ label: 'Best hour', value: hr[0].key + ':00', c: cls(hr[0].pnl), text: signed(hr[0].pnl) + ' over ' + hr[0].n + ' trades in that hour.' });
    var pbg = groupBy(ts, function (t) { return t.playbook; }).filter(function (g) { return g.n >= 2; }).sort(function (x, y) { return y.pnl - x.pnl; });
    if (pbg.length) out.push({ label: 'Strongest playbook', value: pbName(pbg[0].key), c: cls(pbg[0].pnl), text: signed(pbg[0].pnl) + ' over ' + pbg[0].n + ' trades, ' + pct(pbg[0].wins / pbg[0].n) + ' win rate.' });
    return out.slice(0, 12);
  }
  function viewInsights(box) {
    var a = analyze(state.trades);
    if (!a.n) { box.appendChild(emptyHero()); return; }
    var cards = h('div', { class: 'icards' });
    buildInsights(a).forEach(function (i) { cards.appendChild(h('div', { class: 'icard' }, h('div', { class: 'stat-label', text: i.label }), h('div', { class: 'stat-value ' + i.c, text: i.value }), h('p', { text: i.text }))); });
    var g = h('div', { class: 'grid g-two' });
    g.appendChild(h('section', { class: 'panel span2' }, h('div', { class: 'panel-head' }, h('h2', { text: 'What your trades say' }), h('span', { class: 'sub', text: a.n < 5 ? 'Sharper after 5+ trades' : a.n + ' trades analysed' })), cards));
    var emo = groupBy(a.sorted, function (t) { return t.emotion; }).sort(function (x, y) { return x.pnl - y.pnl; });
    g.appendChild(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Emotions' }), h('span', { class: 'sub', text: 'Costliest first' })), emo.length ? breakdown(emo) : h('p', { class: 'empty', text: 'Pick an emotion when you log a trade to see what each one costs.' })));
    var fb = [{ key: 'Plan kept', set: a.sorted.filter(function (t) { return t.followed; }) }, { key: 'Plan broken', set: a.sorted.filter(function (t) { return !t.followed; }) }].filter(function (x) { return x.set.length; }).map(function (x) {
      var rows = groupBy(x.set, function () { return x.key; })[0]; return rows;
    });
    g.appendChild(h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Plan kept vs broken' }), h('span', { class: 'sub', text: 'Net P&L' })), breakdown(fb)));
    g.appendChild(reviewPanel(a));
    box.appendChild(g);
  }

  /* ---------- settings + export ---------- */
  function csvCell(v, text) {
    var s = v == null ? '' : String(v);
    if (text && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function buildCsv() {
    var rows = [['date', 'time', 'asset', 'side', 'entry', 'stop_loss', 'take_profit', 'exit', 'pnl', 'r_multiple', 'amount_risked', 'playbook', 'emotion', 'followed_plan', 'rules_missed', 'mistakes', 'lesson', 'screenshot_link'].join(',')];
    sortedAsc().forEach(function (t) {
      rows.push([csvCell(t.date), csvCell(t.time), csvCell(t.asset, true), csvCell(t.side), csvCell(t.entry), csvCell(t.sl), csvCell(t.tp), csvCell(t.exit), csvCell(t.pnl), csvCell(t.r), csvCell(t.risk),
        csvCell(pbName(t.playbook), true), csvCell(t.emotion, true), csvCell(t.followed ? 'yes' : 'no'), csvCell(t.misses.join('; '), true), csvCell(t.mistakes.join('; '), true), csvCell(t.lesson, true), csvCell(t.shot, true)].join(','));
    });
    return rows.join('\n');
  }
  async function exportCsv(parent) {
    if (!state.trades.length) { toast('No trades to export yet'); return; }
    var csv = buildCsv(), dl = null;
    try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    function fallback() {
      var old = parent.querySelector('.csvbox'); if (old) old.remove();
      var ta = h('textarea', { readonly: true, 'aria-label': 'Trades as CSV' }); ta.value = csv;
      parent.appendChild(h('div', { class: 'csvbox' }, h('p', { class: 'hint', text: 'Downloads are not available here. Select all, copy, and paste into a file ending in .csv.' }), ta));
      ta.focus(); ta.select();
    }
    if (!dl) {
      try {
        var url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a');
        a.href = url; a.download = 'trading-journal-' + todayStr() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000); toast('CSV downloaded');
      } catch (e) { fallback(); }
      return;
    }
    try { await dl.save({ filename: 'trading-journal-' + todayStr() + '.csv', data: csv }); toast('CSV saved'); }
    catch (e) { if (e && e.code === 'declined') return; fallback(); }
  }
  function viewSettings(box) {
    var s = state.settings, msg = h('p', { class: 'form-msg', role: 'alert' });
    var bal = h('input', { id: 's-bal', type: 'number', step: 'any', min: '0', inputmode: 'decimal', placeholder: '10000' });
    var risk = h('input', { id: 's-risk', type: 'number', step: 'any', min: '0', inputmode: 'decimal', placeholder: '1' });
    var cur = h('input', { id: 's-cur', maxlength: '4', placeholder: '$' });
    var tgt = h('input', { id: 's-tgt', type: 'number', step: 'any', min: '0', inputmode: 'decimal', placeholder: '1500' });
    var cap = h('input', { id: 's-cap', type: 'number', step: '1', min: '1', inputmode: 'numeric', placeholder: '3' });
    var dls = h('input', { id: 's-dls', type: 'number', step: 'any', min: '0', inputmode: 'decimal', placeholder: '250' });
    tgt.value = s.monthlyTarget == null ? '' : s.monthlyTarget; cap.value = s.maxTradesDay == null ? '' : s.maxTradesDay; dls.value = s.dailyLoss == null ? '' : s.dailyLoss;
    bal.value = s.balance == null ? '' : s.balance; risk.value = s.riskPct == null ? '' : s.riskPct; cur.value = s.currency;
    var lim = riskLimit(), save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save settings' });
    save.addEventListener('click', function () {
      if (state.readOnlyCloud) { msg.textContent = 'Cloud journal is read-only. Settings cannot be changed in this stage.'; return; }
      var b = num(bal.value), r = num(risk.value);
      if (bal.value.trim() && (b == null || b <= 0)) { msg.textContent = 'Starting balance must be a number above zero.'; bal.focus(); return; }
      if (risk.value.trim() && (r == null || r <= 0 || r > 100)) { msg.textContent = 'Risk per trade must be between 0 and 100 percent.'; risk.focus(); return; }
      var goalFields = [[tgt, 'Monthly profit target'], [cap, 'Max trades per day'], [dls, 'Daily loss limit']];
      for (var gi = 0; gi < goalFields.length; gi++) {
        var gv = num(goalFields[gi][0].value);
        if (goalFields[gi][0].value.trim() && (gv == null || gv <= 0)) { msg.textContent = goalFields[gi][1] + ' must be a number above zero.'; goalFields[gi][0].focus(); return; }
      }
      if (state.mode === 'pending') { msg.textContent = 'Still connecting to your saved journal. Try again in a moment.'; return; }
      save.disabled = true; msg.textContent = '';
      saveSettings(normSettings({ balance: b, riskPct: r, currency: cur.value, monthlyTarget: num(tgt.value), maxTradesDay: num(cap.value), dailyLoss: num(dls.value), example: false })).then(function () { toast('Settings saved'); }).catch(function (e) { msg.textContent = failMsg(e); }).then(function () { save.disabled = false; });
    });
    var acct = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Account, risk and goals' })),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('label', { for: 's-bal', text: 'Starting balance' }), bal),
        h('div', { class: 'field' }, h('label', { for: 's-cur', text: 'Currency symbol' }), cur),
        h('div', { class: 'field' }, h('label', { for: 's-risk', text: 'Risk per trade (%)' }), risk),
        h('div', { class: 'field' }, h('label', { for: 's-tgt', text: 'Monthly profit target' }), tgt),
        h('div', { class: 'field' }, h('label', { for: 's-cap', text: 'Max trades per day' }), cap),
        h('div', { class: 'field' }, h('label', { for: 's-dls', text: 'Daily loss limit' }), dls),
        h('div', { class: 'field full' }, h('p', { class: 'hint', style: 'margin:0', text: lim ? 'Your limit is ' + CUR + fmt(lim) + ' per trade, based on your starting balance. Trades that risk more are marked "Over risk".' : 'Set a balance and a risk percent to get a per-trade limit. The symbol appears in front of every amount, for example $ or KSh.' }))),
      msg, h('div', { class: 'form-actions' }, save));
    var data = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Your data' }), h('span', { class: 'sub', text: state.trades.length + (state.trades.length === 1 ? ' trade' : ' trades') })),
      h('p', { class: 'hint', style: 'margin:0 0 12px', text: 'Download every trade as a CSV file you can open in Excel or Google Sheets.' }));
    data.appendChild(h('div', { class: 'form-actions' }, h('button', { class: 'btn', type: 'button', text: 'Download trades as CSV', onclick: function () { exportCsv(data); } })));
    var g = h('div', { class: 'grid g-two' }); g.appendChild(acct); g.appendChild(data); box.appendChild(g);
  }

  /* ---------- Claude review ---------- */
  function renderReviewText(text) {
    var box = h('div', { class: 'review' }), list = null, listTag = null;
    function flush() { list = null; listTag = null; }
    String(text).split('\n').forEach(function (raw) {
      var line = raw.trim().replace(/\*\*/g, '');
      if (!line) { flush(); return; }
      var hd = /^#{1,4}\s+(.*)$/.exec(line), ul = /^[-*•]\s+(.*)$/.exec(line), ol = /^\d+[.)]\s+(.*)$/.exec(line);
      if (hd) { flush(); box.appendChild(h('h3', { text: hd[1] })); }
      else if (ul || ol) {
        var tag = ul ? 'ul' : 'ol';
        if (!list || listTag !== tag) { list = h(tag); listTag = tag; box.appendChild(list); }
        list.appendChild(h('li', { text: (ul || ol)[1] }));
      } else { flush(); box.appendChild(h('p', { text: line })); }
    });
    return box;
  }
  function buildPrompt(a) {
    var ts = a.sorted, sc = computeScore(a);
    function rows(g, lf) { return g.map(function (x) { return { name: lf ? lf(x.key) : x.key, trades: x.n, winRate: pct(x.wins / x.n), net: Math.round(x.pnl * 100) / 100 }; }); }
    var data = {
      totals: { trades: a.n, net: Math.round(a.total * 100) / 100, winRate: pct(a.winRate), profitFactor: a.pf === Infinity ? 'infinite' : a.pf == null ? null : Math.round(a.pf * 100) / 100, avgR: a.rN ? Math.round(a.avgR * 100) / 100 : null, maxDrawdown: Math.round(a.maxDD * 100) / 100, planKeptRate: pct(a.followed / a.n), journalScore: sc ? sc.total : null },
      byEmotion: rows(groupBy(ts, function (t) { return t.emotion; })),
      byPlaybook: rows(groupBy(ts, function (t) { return t.playbook || '_none'; }), function (k) { return k === '_none' ? 'No playbook' : pbName(k); }),
      byWeekday: rows(groupBy(ts, function (t) { return weekdayIdx(t.date); }), function (k) { return DOW[k]; }),
      byHour: rows(groupBy(ts, function (t) { return t.time ? t.time.slice(0, 2) + ':00' : ''; })),
      planBroken: lite(ts.filter(function (t) { return !t.followed; })),
      planKept: lite(ts.filter(function (t) { return t.followed; })),
      byMistake: mistakeRows(ts).map(function (x) { return { name: x.key, trades: x.n, net: Math.round(x.pnl * 100) / 100 }; }),
      goals: { monthlyTarget: state.settings.monthlyTarget || null, maxTradesPerDay: state.settings.maxTradesDay || null, dailyLossLimit: state.settings.dailyLoss || null },
      account: state.settings.balance ? { startingBalance: state.settings.balance, riskLimitPercent: state.settings.riskPct, oversizedTrades: riskLimit() ? lite(ts.filter(isOver)) : null } : null,
      dailyMoods: state.days.filter(function (d) { return d.mood && a.days[d.id]; }).slice(-30).map(function (d) { return { date: d.date, mood: d.mood, net: Math.round(a.days[d.id].net * 100) / 100 }; }),
      recentTrades: ts.slice(-25).map(function (t) { return { date: t.date, asset: t.asset, side: t.side, pnl: t.pnl, r: t.r, playbook: pbName(t.playbook) || null, emotion: t.emotion || null, followedPlan: t.followed, rulesMissed: t.misses, mistakes: t.mistakes, lesson: t.lesson.slice(0, 160) }; })
    };
    return 'You are reviewing a trader\'s journal. Be specific, cite numbers from the data, and say plainly when a sample is too small to conclude anything. Do not predict markets or give financial advice. Write under 280 words in plain text with exactly three headings on their own lines: "What is working", "What is costing you money", "Next three actions". Under the first two use short bullet lines starting with "- ". Under the last use a numbered list.\n\nJOURNAL DATA (JSON):\n' + JSON.stringify(data);
  }
  function reviewPanel(a) {
    var out = h('div'), btn = h('button', { class: 'btn btn-primary', type: 'button', text: 'Review my trades with Claude' }), note = h('p', { class: 'hint', text: 'Claude reads a summary of your trades and replies with patterns and fixes. Your journal data is sent only when you press the button.' });
    if (state.reviewHTML) out.appendChild(renderReviewText(state.reviewHTML));
    btn.addEventListener('click', async function () {
      var sample = null;
      try { sample = window.claude && window.claude.use ? await window.claude.use('sample') : null; } catch (e) { sample = null; }
      if (!sample) { out.textContent = ''; out.appendChild(h('p', { class: 'empty', text: 'Claude review only works when the journal is opened inside claude.ai.' })); return; }
      btn.disabled = true; btn.textContent = 'Reviewing'; out.textContent = '';
      var live = h('div'); out.appendChild(live);
      try {
        var res = await sample(buildPrompt(analyze(state.trades)), { modelTier: 'default', onText: function (u) { live.textContent = ''; live.appendChild(renderReviewText(u.text)); } });
        state.reviewHTML = res.text; out.textContent = ''; out.appendChild(renderReviewText(res.text));
      } catch (e) {
        out.textContent = '';
        out.appendChild(h('p', { class: 'empty', text: e && e.code === 'rate_limited' ? 'Too many reviews in a short time. Wait a minute and try again.' : e && e.code === 'not_granted' ? 'Claude review was not allowed for this page.' : 'The review could not be completed. Try again in a moment.' }));
      }
      btn.disabled = false; btn.textContent = 'Review again';
    });
    if (state.reviewHTML) btn.textContent = 'Review again';
    return h('section', { class: 'panel span2' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Claude review' }), h('span', { class: 'sub', text: 'Plain-language coaching' })), btn, note, out);
  }

  /* ---------- trade form ---------- */
  function sideVal() { return $('side-sell').checked ? 'sell' : 'buy'; }
  function autoR() {
    var risk = num($('f-risk').value), pnl = num($('f-pnl').value);
    if (risk && pnl != null) return Math.round(pnl / risk * 100) / 100;
    return calcR(sideVal(), num($('f-entry').value), num($('f-sl').value), num($('f-exit').value));
  }
  function updateRHint() {
    var r = autoR(), risk = num($('f-risk').value), lim = riskLimit(), el = $('risk-hint'), over = false;
    $('r-hint').textContent = r == null ? 'R is worked out from the amount risked, or from entry, stop loss and exit. Type a value to override it.' : 'Calculated: ' + fmtR(r) + '. Type a value to override it.';
    if (!risk) el.textContent = lim ? 'Your limit is ' + CUR + fmt(lim) + ' per trade (' + state.settings.riskPct + '% of ' + CUR + fmt(state.settings.balance) + ').' : 'Add it to track R-multiple. Set an account size in Settings to check it against a risk limit.';
    else if (lim) { over = risk > lim * 1.05; el.textContent = (risk / state.settings.balance * 100).toFixed(2) + '% of your starting balance. ' + (over ? 'Over your ' + state.settings.riskPct + '% limit.' : 'Within your limit.'); }
    else el.textContent = 'Set an account size in Settings to check this against a risk limit.';
    el.style.color = over ? 'var(--loss)' : '';
  }
  function fillSelects() {
    var pb = $('f-pb'), cur = pb.value; pb.textContent = '';
    pb.appendChild(h('option', { value: '', text: 'No playbook' }));
    state.playbooks.forEach(function (p) { pb.appendChild(h('option', { value: p.id, text: p.name })); });
    pb.value = cur;
    var em = $('f-emotion'), ec = em.value; em.textContent = '';
    em.appendChild(h('option', { value: '', text: 'Select' }));
    EMOTIONS.forEach(function (e) { em.appendChild(h('option', { value: e, text: e })); });
    em.value = ec;
    var dl = $('dl-assets'); dl.textContent = '';
    var seen = {}, recent = [];
    sortedAsc().reverse().forEach(function (t) { if (t.asset && !seen[t.asset]) { seen[t.asset] = 1; recent.push(t.asset); } });
    recent.slice().sort().forEach(function (v) { dl.appendChild(h('option', { value: v })); });
    var chips = $('asset-chips'); chips.textContent = '';
    recent.slice(0, 6).forEach(function (v) { chips.appendChild(h('button', { class: 'chipbtn', type: 'button', text: v, onclick: function () { $('f-asset').value = v; $('f-pnl').focus(); } })); });
    $('asset-chips-wrap').hidden = !recent.length;
  }
  function renderChecks(ticked) {
    var box = $('checks'), pb = state.playbooks.find(function (p) { return p.id === $('f-pb').value; });
    box.textContent = '';
    if (!pb || !pb.rules.length) { box.hidden = true; return; }
    box.hidden = false;
    pb.rules.forEach(function (r, i) {
      var id = 'chk' + i, cb = h('input', { type: 'checkbox', id: id, 'data-rule': r });
      cb.checked = ticked ? ticked.indexOf(r) >= 0 : true;
      cb.addEventListener('change', syncPlan);
      box.appendChild(h('label', { for: id }, cb, h('span', { text: r })));
    });
    syncPlan();
  }
  function syncPlan() {
    var cbs = $('checks').querySelectorAll('input[type=checkbox]');
    if (!cbs.length) return;
    var all = Array.prototype.every.call(cbs, function (c) { return c.checked; });
    $(all ? 'plan-yes' : 'plan-no').checked = true;
  }
  function resetTradeForm(keepDate) {
    var d = $('f-date').value;
    $('trade-form').reset();
    $('f-date').value = keepDate && d ? d : todayStr();
    state.editingTrade = null; $('dt-title').textContent = 'Log a trade'; $('btn-save').textContent = 'Save trade'; $('btn-another').hidden = false; $('form-msg').textContent = '';
    $('checks').textContent = ''; $('checks').hidden = true; $('sec-prices').open = false; resetShot(''); updateRHint();
  }
  function openTradeForm(t) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') { toast(state.readOnlyCloud ? 'Cloud journal is read-only in this stage' : 'Please wait for the account journal to finish loading'); return; }
    fillSelects(); resetTradeForm(false);
    if (t) {
      state.editingTrade = t.id;
      $('f-date').value = t.date; $('f-time').value = t.time; $('f-asset').value = t.asset; $(t.side === 'sell' ? 'side-sell' : 'side-buy').checked = true;
      $('f-pnl').value = t.pnl; $('f-risk').value = t.risk == null ? '' : t.risk; $('f-entry').value = t.entry; $('f-sl').value = t.sl; $('f-tp').value = t.tp; $('f-exit').value = t.exit; $('f-r').value = t.r == null ? '' : t.r;
      $('f-pb').value = state.playbooks.some(function (p) { return p.id === t.playbook; }) ? t.playbook : '';
      $('f-emotion').value = t.emotion; setMistakes(t.mistakes); resetShot(t.shotId); $('f-lesson').value = t.lesson; $('f-shot').value = t.shot;
      renderChecks(t.misses.length ? $('f-pb').value && state.playbooks.find(function (p) { return p.id === $('f-pb').value; }).rules.filter(function (r) { return t.misses.indexOf(r) < 0; }) : null);
      $(t.followed ? 'plan-yes' : 'plan-no').checked = true;
      $('sec-prices').open = !!(t.entry || t.sl || t.tp || t.exit || t.shot);
      $('dt-title').textContent = 'Edit trade'; $('btn-save').textContent = 'Update trade'; $('btn-another').hidden = true; updateRHint();
    }
    $('shot-wrap').hidden = !state.assets || state.mode === 'cloud';
    $('f-shotfile').disabled = state.mode === 'cloud';
    if (t && t.shotId) $('sec-prices').open = true;
    updateLimitWarn();
    openDrawer($('drawer-trade'), t ? null : 'f-asset');
  }
  function submitTrade(another) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') { toast(state.readOnlyCloud ? 'Cloud journal is read-only in this stage' : 'Please wait for the account journal to finish loading'); return; }
    var msg = $('form-msg'); msg.textContent = '';
    var asset = $('f-asset').value.trim().toUpperCase(), pnl = num($('f-pnl').value), date = $('f-date').value;
    if (!asset) { msg.textContent = 'Enter the pair or asset you traded.'; $('f-asset').focus(); return; }
    if (pnl == null) { msg.textContent = 'Enter the P&L amount. Use a minus sign for a loss.'; $('f-pnl').focus(); return; }
    if (!date) { msg.textContent = 'Pick the trade date.'; $('f-date').focus(); return; }
    if (state.mode === 'pending') { msg.textContent = 'Still connecting to your saved journal. Try again in a moment.'; return; }
    var sd = sideVal(), entry = $('f-entry').value.trim(), sl = $('f-sl').value.trim(), exit = $('f-exit').value.trim(), manual = num($('f-r').value);
    var r = manual != null ? manual : autoR();
    var existing = state.editingTrade ? state.trades.find(function (x) { return x.id === state.editingTrade; }) : null;
    var misses = Array.prototype.filter.call($('checks').querySelectorAll('input[type=checkbox]'), function (c) { return !c.checked; }).map(function (c) { return c.getAttribute('data-rule'); });
    var t = normTrade({
      id: existing ? existing.id : newId('t'), date: date, time: $('f-time').value, asset: asset, side: sd, entry: entry, sl: sl, tp: $('f-tp').value.trim(), exit: exit, pnl: pnl, r: r, risk: num($('f-risk').value), mistakes: pickedMistakes(),
      playbook: $('f-pb').value, emotion: $('f-emotion').value, followed: $('plan-yes').checked, misses: misses, lesson: $('f-lesson').value.trim(), shot: $('f-shot').value.trim(), example: false, createdAt: existing ? existing.createdAt : Date.now()
    });
    var wasEdit = !!existing, b1 = $('btn-save'), b2 = $('btn-another'); b1.disabled = b2.disabled = true;
    shotPrep(existing).then(function (sp) { t.shotId = sp.id; return put('trades', t).then(function () { dropAsset(sp.drop); }); }).then(function () {
      toast(wasEdit ? 'Trade updated' : 'Trade saved');
      if (another && !wasEdit) { resetTradeForm(true); fillSelects(); updateLimitWarn(); $('f-asset').focus(); } else { resetTradeForm(false); closeDrawers(); }
    }).catch(function (err) { msg.textContent = failMsg(err); }).then(function () { b1.disabled = b2.disabled = false; });
  }

  /* ---------- playbook form ---------- */
  function openPbForm(p) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') { toast(state.readOnlyCloud ? 'Cloud journal is read-only in this stage' : 'Please wait for the account journal to finish loading'); return; }
    state.editingPb = p ? p.id : null;
    $('p-name').value = p ? p.name : ''; $('p-desc').value = p ? p.description : ''; $('p-rules').value = p ? p.rules.join('\n') : '';
    $('dp-title').textContent = p ? 'Edit playbook' : 'New playbook'; $('pb-msg').textContent = '';
    openDrawer($('drawer-pb'), 'p-name');
  }
  function submitPb() {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') { toast(state.readOnlyCloud ? 'Cloud journal is read-only in this stage' : 'Please wait for the account journal to finish loading'); return; }
    var name = $('p-name').value.trim(), msg = $('pb-msg'); msg.textContent = '';
    if (!name) { msg.textContent = 'Give the playbook a name.'; $('p-name').focus(); return; }
    if (state.mode === 'pending') { msg.textContent = 'Still connecting to your saved journal. Try again in a moment.'; return; }
    var existing = state.editingPb ? state.playbooks.find(function (x) { return x.id === state.editingPb; }) : null;
    var rules = $('p-rules').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
    var p = normPb({ id: existing ? existing.id : newId('pb'), name: name, description: $('p-desc').value.trim(), rules: rules, example: false, createdAt: existing ? existing.createdAt : Date.now() });
    put('playbooks', p).then(function () { toast('Playbook saved'); closeDrawers(); }).catch(function (e) { msg.textContent = failMsg(e); });
  }

  /* ---------- examples ---------- */
  function loadExamples() {
    if (state.readOnlyCloud) { toast('Example data cannot be added in read-only mode'); return; }
    if (state.dataState === 'cloud-loading') { toast('Please wait for the account journal to finish loading'); return; }
    if (state.mode === 'pending') { toast('Still connecting. Try again in a moment.'); return; }
    var ex = exampleData();
    toast('Loading example data');
    seq(ex.playbooks, function (p) { return put('playbooks', p); }).then(function () { return seq(ex.trades, function (t) { return put('trades', t); }); }).then(function () { return seq(ex.days, function (d) { return put('days', d); }); }).then(function () { if (!state.settings.balance) return saveSettings(normSettings({ balance: 10000, riskPct: 1, currency: '$', monthlyTarget: 1500, maxTradesDay: 2, dailyLoss: 250, example: true })); }).then(function () { toast('Example data loaded'); }).catch(function (e) { toast(failMsg(e)); });
  }
  function clearExamples() {
    if (state.readOnlyCloud) { toast('Cloud journal is read-only in this stage'); return; }
    if (state.dataState === 'cloud-loading') { toast('Please wait for the account journal to finish loading'); return; }
    var tr = state.trades.filter(function (t) { return t.example; }), pb = state.playbooks.filter(function (p) { return p.example; });
    seq(tr, function (t) { return del('trades', t.id); }).then(function () { return seq(pb, function (p) { return del('playbooks', p.id); }); }).then(function () { return seq(state.days.filter(function (d) { return d.example; }), function (d) { return del('days', d.id); }); }).then(function () { if (state.settings.example) return saveSettings(normSettings(null)); }).then(function () { toast('Examples cleared'); }).catch(function (e) { toast(failMsg(e)); });
  }

  /* ---------- routing + render ---------- */
  var RENDER = { dashboard: viewDashboard, calendar: viewCalendar, trades: viewTrades, playbooks: viewPlaybooks, reports: viewReports, insights: viewInsights, settings: viewSettings };
  function renderView() {
    var box = $('v-' + state.view); box.textContent = ''; RENDER[state.view](box);
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') Array.prototype.forEach.call(box.querySelectorAll('.hero-empty .row-btns'), function (el) { el.hidden = true; });
  }
  function renderAll() {
    $('fab').hidden = !!state.readOnlyCloud || state.dataState === 'cloud-loading';
    $('btn-clear-ex').hidden = !!state.readOnlyCloud || state.dataState === 'cloud-loading';
    $('banner').hidden = !(state.trades.some(function (t) { return t.example; }) || state.playbooks.some(function (p) { return p.example; }) || state.days.some(function (d) { return d.example; }) || state.settings.example);
    renderView();
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') {
      Array.prototype.forEach.call(document.querySelectorAll('.hero-empty .row-btns'), function (el) { el.hidden = true; });
    }
  }
  function setView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'dashboard';
    state.view = name;
    VIEWS.forEach(function (v) { var el = $('v-' + v); el.hidden = v !== name; if (v !== name) el.textContent = ''; });
    Array.prototype.forEach.call($('nav').querySelectorAll('a'), function (a) { if (a.getAttribute('data-v') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    renderView();
  }

  /* ---------- boot ---------- */
  $('f-date').value = todayStr();
  fillSelects();
  $('trade-form').addEventListener('submit', function (e) { e.preventDefault(); submitTrade(false); });
  $('btn-another').addEventListener('click', function () { submitTrade(true); });
  $('pb-form').addEventListener('submit', function (e) { e.preventDefault(); submitPb(); });
  $('f-pb').addEventListener('change', function () { renderChecks(null); });
  ['f-entry', 'f-sl', 'f-exit', 'f-risk', 'f-pnl'].forEach(function (id) { $(id).addEventListener('input', updateRHint); });
  ['side-buy', 'side-sell'].forEach(function (id) { $(id).addEventListener('change', updateRHint); });
  var mchips = $('mchips');
  MISTAKES.forEach(function (m, i) { mchips.appendChild(h('label', { class: 'mchip', for: 'mk' + i }, h('input', { type: 'checkbox', id: 'mk' + i, value: m }), h('span', { text: m }))); });
  $('f-date').addEventListener('input', updateLimitWarn);
  $('f-shotfile').addEventListener('change', function () {
    var inp = this, f = inp.files && inp.files[0], msg = $('form-msg');
    if (!f) return;
    msg.textContent = '';
    if (f.size > 25 * 1024 * 1024) { msg.textContent = 'That image is over 25 MB. Choose a smaller one.'; inp.value = ''; return; }
    shrinkImage(f).then(function (b) {
      var s = state.shot; if (s.preview) URL.revokeObjectURL(s.preview);
      s.blob = b; s.preview = URL.createObjectURL(b); s.remove = false; renderShotPrev();
    }).catch(function (e) { msg.textContent = (e && e.message) || 'Could not read that image.'; inp.value = ''; });
  });
  $('fab').addEventListener('click', function () { openTradeForm(null); });
  $('btn-clear-ex').addEventListener('click', clearExamples);
  $('scrim').addEventListener('click', function () { closeDrawers(); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) { b.addEventListener('click', function () { closeDrawers(); }); });
  document.addEventListener('keydown', function (e) {
    if (!openDrawerEl) return;
    if (e.key === 'Escape') { closeDrawers(); return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.filter.call(openDrawerEl.querySelectorAll('button, a[href], input, select, textarea, summary'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (!openDrawerEl.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener('hashchange', function () { setView(location.hash.replace('#', '')); });
  var lastW = 0, raf = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function (entries) {
      var w = Math.round(entries[0].contentRect.width);
      if (!lastW) { lastW = w; return; }
      if (w !== lastW) { lastW = w; cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { if (state.view === 'dashboard' || state.view === 'reports') renderView(); }); }
    }).observe(document.querySelector('.wrap'));
  }
  setView(location.hash.replace('#', ''));
  init();
})();
