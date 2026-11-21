/* Maxi Trades Journal
   Account-first journal: authenticated users load and save their private Supabase journal.
   No local-only journal is available. */
(function () {
  'use strict';
  var MINUS = '−';
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var EMOTIONS = ['Calm', 'Confident', 'Focused', 'Patient', 'Hesitant', 'Fearful', 'Impatient', 'FOMO', 'Greedy', 'Revenge', 'Bored', 'Tired'];
  var MISTAKES = ['Moved stop', 'Oversized', 'Early exit', 'Late entry', 'No setup', 'Chased price', 'Overtraded', 'Ignored news', 'Averaged down'];
  var VIEWS = ['dashboard', 'calendar', 'trades', 'playbooks', 'reports', 'insights', 'settings', 'profile'];
  var STARTERS = [
    { name: 'Breakout retest', description: 'Trade the break of a key level only after price comes back to test it.', rules: ['Trade with the higher timeframe trend', 'Wait for the retest, never chase the break', 'Stop loss placed before entry', 'Risk no more than 1% of the account'] },
    { name: 'Trend pullback', description: 'Join an established trend when price pulls back to value.', rules: ['Price is pulling back to a key moving average', 'Confirmation candle has closed', 'Target is at least 2R', 'No trade within 15 minutes of major news'] }
  ];
  var state = { assets: null, shot: { blob: null, preview: '', existing: '', remove: false }, trades: [], playbooks: [], days: [], accounts: [], activeAccount: null, settings: { balance: null, riskPct: null, currency: '', example: false }, mode: 'signed-out', readOnlyCloud: false, dataState: 'account-required', cols: null, view: 'dashboard', month: null, selDay: null, editingTrade: null, editingPb: null, filters: { q: '', pb: '', outcome: '', plan: '' }, reviewHTML: null, reviewing: false, lastFocus: null };

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
      followed: t.followed !== false, misses: Array.isArray(t.misses) ? t.misses.map(String) : [], lesson: String(t.lesson || ''), shot: String(t.shot || ''), shotId: String(t.shotId || ''), shotUrl: String(t.shotUrl || ''), mistakes: Array.isArray(t.mistakes) ? t.mistakes.map(String) : [],
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
    return { balance: o.balance != null && o.balance !== '' && isFinite(b) && b > 0 ? b : null, riskPct: o.riskPct != null && o.riskPct !== '' && isFinite(r) && r > 0 ? r : null, currency: String(o.currency || '').trim().slice(0, 4), monthlyTarget: posNum(o.monthlyTarget), maxTradesDay: posNum(o.maxTradesDay) ? Math.round(posNum(o.maxTradesDay)) : null, dailyLoss: posNum(o.dailyLoss), lossStreakThreshold: Math.min(10, Math.max(2, Math.round(Number(o.lossStreakThreshold) || 3))), example: !!o.example };
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
    if (!cloudWriteReady()) return Promise.reject(new Error('Create an account or sign in before changing your journal.'));
    { var adapter = activeCloudAdapter; return cloudWrite(function () { return adapter.put(kind, obj); }, function () {
      var list = state[kind], i = list.findIndex(function (x) { return x.id === obj.id; });
      if (i >= 0) list[i] = obj; else list.push(obj);
    }); }
  }
  function del(kind, id) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') return Promise.reject(new Error(state.readOnlyCloud ? 'The cloud journal is read-only in this stage.' : 'The cloud journal is still loading. Please wait before making changes.'));
    if (!cloudWriteReady()) return Promise.reject(new Error('Create an account or sign in before changing your journal.'));
    { var adapter = activeCloudAdapter; return cloudWrite(function () { return adapter.del(kind, id); }, function () {
      state[kind] = state[kind].filter(function (x) { return x.id !== id; });
    }); }
  }
  function saveSettings(obj) {
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') return Promise.reject(new Error(state.readOnlyCloud ? 'The cloud journal is read-only in this stage.' : 'The cloud journal is still loading. Please wait before making changes.'));
    if (!cloudWriteReady()) return Promise.reject(new Error('Create an account or sign in before changing your journal.'));
    { var adapter = activeCloudAdapter; return cloudWrite(function () { return adapter.saveSettings(obj); }, function () {
      state.settings = obj; applySettings();
      if (state.activeAccount) {
        state.activeAccount.starting_balance = obj.balance || 0;
        state.activeAccount.currency = obj.currency || 'USD';
        state.activeAccount.prop_rules = Object.assign({}, state.activeAccount.prop_rules || {}, {
          riskPct: obj.riskPct, dailyLossLimit: obj.dailyLoss, maxTradesDay: obj.maxTradesDay, profitTarget: obj.monthlyTarget
        });
      }
    }); }
  }

  /* ---------- Supabase journal data adapter (Phase 2A/2B) ---------- */
  // Stage 3 uses the shared adapter for authenticated cloud loading and writes.
  // Authenticated journal access uses the shared Supabase adapter.
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
    'account-local': 'Account connected · data still local',
    'session-error': 'Account status unavailable · journal local',
    'cloud-loading': 'Loading account journal',
    'cloud-syncing': 'Saving to your account',
    'cloud-synced': 'Synced to your account',
    'cloud-error': 'Cloud save not confirmed',
    'cloud-load-error': 'Cloud journal unavailable · local preserved',
    offline: 'Offline · cloud unavailable',
    'cloud-readonly': 'Cloud journal · read-only',
    'cloud-ready': 'Cloud journal · connected',
    'account-required': 'Sign in to access your journal'
  };
  var dataStateTitles = {
    'account-local': 'You are signed in, but journal data remains local to this browser. No cloud journal data has been loaded or saved.',
    'session-error': 'The journal remains local. We could not verify the account session; refresh and try again.',
    'cloud-loading': 'Account journal data is being loaded.',
    'cloud-syncing': 'A journal change is being saved to your account.',
    'cloud-synced': 'The latest journal change was confirmed saved to your account.',
    'cloud-error': 'The latest cloud save was not confirmed. Do not assume this change is synced.',
    'cloud-load-error': 'The cloud journal could not be loaded. Your browser journal remains available and unchanged.',
    offline: 'Network unavailable. Cloud changes cannot currently be confirmed.',
    'cloud-readonly': 'You are viewing records loaded from your Supabase account. Editing, deleting and saving are disabled in this stage.',
    'cloud-ready': 'Your account journal is loaded. New changes are saved to Supabase and confirmed before the screen updates.',
    'account-required': 'Create an account or sign in to access your private trading journal.'
  };
  var authClient = window.maxiSupabase || null;
  var authUser = null;
  var authPanel = null;
  var authFormMode = 'signin';
  var authLoadToken = 0;
  var activeCloudUserId = null;
  var activeCloudAdapter = null;
  function setDataState(kind) {
    if (!Object.prototype.hasOwnProperty.call(dataStateText, kind)) kind = 'account-required';
    state.dataState = kind;
    var chip = $('sync');
    chip.hidden = kind === 'cloud-ready';
    var visualState = kind === 'cloud-loading' || kind === 'cloud-syncing' ? 'loading'
      : kind === 'cloud-synced' || kind === 'cloud-readonly' || kind === 'cloud-ready' ? 'cloud'
      : kind === 'cloud-error' || kind === 'cloud-load-error' || kind === 'session-error' || kind === 'offline' || kind === 'account-required' ? 'error'
      : kind === 'account-local' ? 'account-local' : 'local';
    chip.setAttribute('data-state', visualState);
    chip.setAttribute('aria-label', dataStateText[kind]);
    $('sync-text').textContent = dataStateText[kind];
    chip.title = dataStateTitles[kind];
  }
  // Kept as a narrow alias for existing initialization call sites.
  function setSync(kind) {
    setDataState(kind === 'local' ? 'account-required' : kind);
  }
  function setAccountGate(open) {
    document.body.classList.toggle('account-required', !open);
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
    var forgot = authPanel.querySelector('.auth-forgot');
    var email = authPanel.querySelector('#maxi-auth-email');
    var password = authPanel.querySelector('#maxi-auth-password');
    var introHeading = document.querySelector('.auth-screen-intro h1');
    var introCopy = document.querySelector('.auth-intro-copy');
    var stageMode = document.querySelector('.auth-stage-heading span:last-child');
    if (introHeading) introHeading.textContent = mode === 'signup' ? 'Start with a clean journal.' : mode === 'recovery' ? 'Get back to your journal.' : 'Welcome back.';
    if (introCopy) introCopy.textContent = mode === 'signup'
      ? 'Create your free account. We’ll guide you through your profile, the markets you follow and the reason you started.'
      : mode === 'recovery'
        ? 'Choose a new password to securely return to your PIPBOOK account.'
        : 'Sign in to return to your trade history, playbooks and the lessons you have recorded.';
    if (stageMode) stageMode.textContent = mode === 'signup' ? 'CREATE ACCOUNT' : mode === 'recovery' ? 'PASSWORD RECOVERY' : 'WELCOME BACK';
    heading.textContent = mode === 'signup' ? 'Create your free account' : mode === 'recovery' ? 'Set a new password' : 'Sign in to your account';
    submit.textContent = mode === 'signup' ? 'Create account' : mode === 'recovery' ? 'Update password' : 'Sign in';
    toggle.textContent = mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account';
    toggle.hidden = mode === 'recovery';
    if (forgot) forgot.hidden = mode !== 'signin';
    if (email) { email.hidden = mode === 'recovery'; email.required = mode !== 'recovery'; }
    form.hidden = false;
    authPanel.querySelector('.auth-message').textContent = '';
    if (email && mode !== 'recovery') email.focus();
    if (password) { password.value = ''; password.setAttribute('autocomplete', mode === 'signup' || mode === 'recovery' ? 'new-password' : 'current-password'); }
  }
  function refreshAuthPanel() {
    if (!authPanel) return;
    var signedIn = !!authUser;
    authPanel.querySelector('.auth-state-title').textContent = signedIn ? 'Account connected' : 'Account required';
    authPanel.querySelector('.auth-state-detail').textContent = signedIn
      ? authUser.email || 'Signed-in account'
      : 'Create a free account or sign in to access your private trading journal.';
    authPanel.querySelector('.auth-open').hidden = true;
    authPanel.querySelector('.auth-signout').hidden = !signedIn;
    authPanel.querySelector('.auth-form').hidden = signedIn && authFormMode !== 'recovery';
    if (signedIn) {
      if (state.mode === 'cloud-readonly') {
        authNotice('Your cloud journal is loaded in read-only mode. Changes are disabled.', false);
        setDataState('cloud-readonly');
      } else if (state.mode === 'cloud') {
        authNotice('Your account journal is connected. Trades, playbooks, daily notes, settings and private chart screenshots save to your account.', false);
        if (state.dataState !== 'cloud-syncing' && state.dataState !== 'cloud-error') setDataState('cloud-ready');
      } else if (state.dataState !== 'cloud-loading' && state.dataState !== 'cloud-error' && state.dataState !== 'cloud-load-error') {
        authNotice('Your account is authenticated. Your journal will open once cloud data has loaded.', false);
        setDataState('account-local');
      }
    } else {
      authNotice('An account is required. Create a free account or sign in to open your journal.', false);
      if (!state.readOnlyCloud) setDataState('account-required');
    }
  }
  async function loadCloudJournal(user) {
    if (!user || !user.id) return;
    if (activeCloudUserId === user.id && (state.dataState === 'cloud-loading' || state.mode === 'cloud-readonly' || state.mode === 'cloud')) return;
    activeCloudUserId = user.id;
    activeCloudAdapter = null;
    setAccountGate(false);
    var token = ++authLoadToken;
    state.mode = 'pending'; state.readOnlyCloud = false;
    setDataState('cloud-loading');
    authNotice('Loading your private account journal…', false);
    renderAll();
    try {
      var adapter = cloudAdapterFor(user.id);
      var cloud = await adapter.load();
      if (token !== authLoadToken || !authUser || authUser.id !== user.id) return;
      activeCloudAdapter = adapter;
      state.accounts = cloud.accounts || []; state.activeAccount = cloud.activeAccount || null;
      state.trades = (cloud.trades || []).map(normTrade);
      state.playbooks = (cloud.playbooks || []).map(normPb);
      state.days = (cloud.days || []).map(normDay);
      var accountRules = state.activeAccount && state.activeAccount.prop_rules || {};
      state.settings = normSettings(Object.assign({}, cloud.settings, {
        balance: state.activeAccount ? state.activeAccount.starting_balance : cloud.settings.balance,
        currency: state.activeAccount ? state.activeAccount.currency : cloud.settings.currency,
        riskPct: accountRules.riskPct != null ? accountRules.riskPct : cloud.settings.riskPct,
        dailyLoss: accountRules.dailyLossLimit != null ? accountRules.dailyLossLimit : cloud.settings.dailyLoss,
        maxTradesDay: accountRules.maxTradesDay != null ? accountRules.maxTradesDay : cloud.settings.maxTradesDay,
        monthlyTarget: accountRules.profitTarget != null ? accountRules.profitTarget : cloud.settings.monthlyTarget
      }));
      state.mode = 'cloud'; state.readOnlyCloud = false;
      applySettings(); setDataState('cloud-ready'); renderAll(); setAccountGate(true);
      authNotice('Your private journal is ready. Trades, playbooks, daily notes, settings and private chart screenshots save to your account.', false);
    } catch (error) {
      if (token !== authLoadToken) return;
      activeCloudAdapter = null; state.mode = 'signed-out'; state.trades = []; state.playbooks = []; state.days = []; state.accounts = []; state.activeAccount = null; state.settings = normSettings(null); applySettings(); setDataState('cloud-load-error'); renderAll(); setAccountGate(false);
      authNotice('Could not load your cloud journal: ' + ((error && error.message) || 'Please try again. Your journal remains locked; refresh or sign out and try again.'), true);
    }
  }
  function handleAuthSession(session) {
    var nextUser = session && session.user ? session.user : null;
    if (!nextUser) {
      authUser = null; authLoadToken++; activeCloudUserId = null; activeCloudAdapter = null;
      state.mode = 'signed-out'; state.readOnlyCloud = false;
      state.trades = []; state.playbooks = []; state.days = []; state.accounts = []; state.activeAccount = null; state.settings = normSettings(null); applySettings();
      setAccountGate(false); setDataState('account-required'); refreshAuthPanel(); renderAll();
      if (window.PipbookAuthPage) window.PipbookAuthPage.close();
      return;
    }
    if (authUser && authUser.id !== nextUser.id) {
      authLoadToken++; activeCloudUserId = null; activeCloudAdapter = null;
      state.trades = []; state.playbooks = []; state.days = []; state.accounts = []; state.activeAccount = null; state.settings = normSettings(null); applySettings(); setAccountGate(false);
    }
    authUser = nextUser; refreshAuthPanel(); loadCloudJournal(authUser);
  }
  function buildAuthPanel() {
    if (authPanel) return;
    authPanel = h('section', { id: 'auth-panel', class: 'auth-panel panel', 'aria-label': 'Account access' });
    var summary = h('div', { class: 'auth-summary' },
      h('div', { class: 'auth-copy' },
        h('strong', { class: 'auth-state-title', text: 'Account required' }),
        h('p', { class: 'auth-state-detail', text: 'Sign in or create an account to access your private journal.' })),
      h('div', { class: 'auth-actions' },
        h('button', { class: 'btn btn-primary auth-open', type: 'button', text: 'Sign in / Create account', onclick: function () { showAuthForm('signin'); } }),
        h('button', { class: 'btn auth-signout', type: 'button', text: 'Sign out', hidden: true, onclick: async function () {
          if (!authClient) return;
          var b = authPanel.querySelector('.auth-signout');
          b.disabled = true;
          var result = await authClient.auth.signOut();
          b.disabled = false;
          if (result.error) authNotice('Could not sign out: ' + result.error.message, true);
          else { handleAuthSession(null); authNotice('You are signed out. Sign in to access your account journal.', false); }
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
      h('button', { class: 'btn auth-forgot', type: 'button', text: 'Forgot password?', hidden: true, onclick: async function () {
        if (!authClient) { authNotice('Account services are unavailable. Please try again later.', true); return; }
        var emailInput = form.querySelector('#maxi-auth-email');
        var email = emailInput.value.trim();
        if (!email) { authNotice('Enter your email address first, then select Forgot password again.', true); emailInput.focus(); return; }
        var forgotButton = form.querySelector('.auth-forgot');
        forgotButton.disabled = true;
        authNotice('Sending password reset email…', false);
        try {
          var reset = await authClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
          if (reset.error) throw reset.error;
          authNotice('If an account exists for that email, a password reset link has been sent. Check your inbox and spam folder.', false);
        } catch (error) {
          authNotice('Could not send the reset email: ' + (error && error.message ? error.message : 'Please try again.'), true);
        } finally { forgotButton.disabled = false; }
      } })));
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!authClient) { authNotice('Supabase is not configured. Check the project client setup.', true); return; }
      var email = form.querySelector('#maxi-auth-email').value.trim();
      var password = form.querySelector('#maxi-auth-password').value;
      var submit = form.querySelector('.auth-submit');
      if (authFormMode !== 'recovery' && !email) { authNotice('Enter your email address.', true); return; }
      if (!password || password.length < 6) { authNotice('Your password must contain at least 6 characters.', true); return; }
      submit.disabled = true;
      authNotice(authFormMode === 'signup' ? 'Creating your account…' : authFormMode === 'recovery' ? 'Updating your password…' : 'Signing you in…', false);
      try {
        var result = authFormMode === 'signup'
          ? await authClient.auth.signUp({ email: email, password: password })
          : authFormMode === 'recovery'
            ? await authClient.auth.updateUser({ password: password })
            : await authClient.auth.signInWithPassword({ email: email, password: password });
        if (result.error) throw result.error;
        if (authFormMode === 'recovery') {
          showAuthForm('signin');
          authNotice('Your password has been updated. Sign in with your new password.', false);
        } else if (authFormMode === 'signup' && result.data && result.data.user && !result.data.session) {
          showAuthForm('signin');
          var confirmationTitle = document.querySelector('.auth-screen-intro h1');
          var confirmationCopy = document.querySelector('.auth-intro-copy');
          var confirmationMode = document.querySelector('.auth-stage-heading span:last-child');
          if (confirmationTitle) confirmationTitle.textContent = 'Check your inbox.';
          if (confirmationCopy) confirmationCopy.textContent = 'Your account is created. Confirm your email using the link we sent, then return here to sign in and complete your PIPBOOK setup.';
          if (confirmationMode) confirmationMode.textContent = 'EMAIL CONFIRMATION';
          authNotice('Account created. Check your email for the confirmation link, then sign in here to open your journal.', false);
        } else {
          authUser = result.data && result.data.user ? result.data.user : null;
          form.hidden = true;
          if (result.data && result.data.session) handleAuthSession(result.data.session);
          else refreshAuthPanel();
          authNotice('Signed in successfully. Loading your account journal…', false);
        }
      } catch (error) {
        authNotice('Authentication failed: ' + (error && error.message ? error.message : 'Please try again.'), true);
      } finally {
        submit.disabled = false;
      }
    });
    authPanel.appendChild(summary);
    authPanel.appendChild(form);
    authPanel.appendChild(h('p', { class: 'auth-message', role: 'status', 'aria-live': 'polite' }));
    var publicAuth = document.getElementById('public-auth');
    if (publicAuth) publicAuth.appendChild(authPanel);
    else document.querySelector('.masthead').insertAdjacentElement('afterend', authPanel);
    function openAuthPage(mode) {
      var marketing = document.getElementById('public-marketing');
      var screen = document.getElementById('auth-screen');
      if (marketing) marketing.hidden = true;
      if (screen) screen.hidden = false;
      showAuthForm(mode);
      window.scrollTo(0, 0);
    }
    function closeAuthPage() {
      var marketing = document.getElementById('public-marketing');
      var screen = document.getElementById('auth-screen');
      if (marketing) marketing.hidden = false;
      if (screen) screen.hidden = true;
      if (authPanel) authPanel.querySelector('.auth-form').hidden = true;
      window.scrollTo(0, 0);
    }
    window.PipbookAuthPage = { open: openAuthPage, close: closeAuthPage };
    var createButton = document.getElementById('public-create');
    var createBottom = document.getElementById('public-create-bottom');
    var loginButton = document.getElementById('public-login');
    var backButton = document.getElementById('auth-back');
    if (createButton) createButton.addEventListener('click', function () { openAuthPage('signup'); });
    if (createBottom) createBottom.addEventListener('click', function () { openAuthPage('signup'); });
    if (loginButton) loginButton.addEventListener('click', function () { openAuthPage('signin'); });
    if (backButton) backButton.addEventListener('click', closeAuthPage);
    refreshAuthPanel();
  }
  async function init() {
    state.mode = 'signed-out';
    state.trades = []; state.playbooks = []; state.days = []; state.settings = normSettings(null); applySettings();
    try { localStorage.removeItem('trading-journal-pro-v1'); } catch (e) {}
    buildAuthPanel();
    renderAll();
    // Supabase recovery links return a recovery type in the URL fragment. Preserve
    // recovery mode even if the auth event is delivered as a generic sign-in event.
    var recoveryLink = false;
    try { recoveryLink = new URLSearchParams((window.location.hash || '').replace(/^#/, '')).get('type') === 'recovery'; } catch (e) {}
    if (recoveryLink) {
      showAuthForm('recovery');
      authNotice('Choose a new password for your account.', false);
    }
    if (!authClient || !authClient.auth) {
      authNotice('Account services are unavailable. Journal access is locked until a secure account connection can be established.', true);
      setDataState('account-required'); setAccountGate(false);
      return;
    }
    authClient.auth.onAuthStateChange(function (event, session) {
      if (event === 'PASSWORD_RECOVERY') {
        handleAuthSession(session);
        showAuthForm('recovery');
        authNotice('Choose a new password for your account.', false);
        return;
      }
      handleAuthSession(session);
    });
    try {
      var result = await authClient.auth.getSession();
      if (result.error) throw result.error;
      handleAuthSession(result.data && result.data.session ? result.data.session : null);
    } catch (error) {
      authUser = null;
      refreshAuthPanel();
      setDataState('session-error'); setAccountGate(false);
      authNotice('Could not verify your account session: ' + (error && error.message ? error.message : 'Please refresh and try again. Journal access remains locked.'), true);
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
  function delTrade(id) { if (state.readOnlyCloud) { toast('Cloud journal is read-only in this stage'); return; } del('trades', id).then(function (result) { toast(result && result.screenshotCleanupError ? 'Trade deleted, but its screenshot could not be removed from storage. Contact support if it remains.' : 'Trade deleted'); }).catch(function (e) { toast(failMsg(e)); }); }
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
      ['Account', bal ? CUR + fmt(bal + a.total) : '—', bal ? cls(a.total) : '', bal ? pcts(a.total / bal * 100) + ' since start' : 'Set it in Trading Setup'],
      ['Max drawdown', has ? (a.maxDD ? MINUS + CUR + fmt(a.maxDD) : CUR + '0.00') : '—', a.maxDD ? 'neg' : '', bal && a.maxDD ? MINUS + (a.maxDD / bal * 100).toFixed(1) + '% of account' : 'Peak to trough']
    ];
    tiles.forEach(function (t) { box.appendChild(h('div', { class: 'stat' }, h('div', { class: 'stat-label', text: t[0] }), h('div', { class: 'stat-value ' + t[2], text: t[1] }), h('div', { class: 'stat-sub', text: t[3] }))); });
    return box;
  }
  function tradeCard(t) {
    var link = safeUrl(t.shot);
    return h('div', { class: 'tcard' + (state.focusTradeId === t.id ? ' is-focused' : ''), id: 'trade-card-' + t.id },
      h('div', { class: 'tcard-top' },
        h('div', { class: 'asset' }, h('strong', { text: t.asset }), h('span', { class: 'pill', text: t.side === 'sell' ? 'Sell' : 'Buy' }), t.time ? h('span', { class: 'sub', text: t.time }) : null, t.example ? h('span', { class: 'pill ex', text: 'Example' }) : null),
        h('div', { class: 'pn ' + cls(t.pnl), text: signed(t.pnl) + (t.r != null ? '  ' + fmtR(t.r) : '') })),
      h('div', { class: 'asset' }, t.playbook ? h('span', { class: 'pill', text: pbName(t.playbook) }) : null, planPill(t), isOver(t) ? h('span', { class: 'pill loss', text: 'Over risk' }) : null, t.emotion ? h('span', { class: 'pill', text: t.emotion }) : null),
      mistakeRow(t),
      t.lesson ? h('p', { text: t.lesson }) : null,
      screenshotSource(t) ? h('a', { class: 'shotthumb', href: screenshotSource(t), target: '_blank', rel: 'noopener noreferrer' }, h('img', { src: screenshotSource(t), alt: 'Chart screenshot for ' + t.asset, loading: 'lazy' })) : null,
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
  function motivationReminderPanel() {
    var userMeta = authUser && authUser.user_metadata ? authUser.user_metadata : {};
    var ordered = sortedAsc(state.trades), threshold = state.settings.lossStreakThreshold || 3, streak = 0;
    for (var i = ordered.length - 1; i >= 0; i--) {
      if (ordered[i].pnl < 0) streak++;
      else break;
    }
    var dates = [];
    ordered.slice().reverse().forEach(function (trade) { if (dates.indexOf(trade.date) < 0) dates.push(trade.date); });
    var declining = false;
    if (dates.length >= 14) {
      var recentDates = dates.slice(0, 7), previousDates = dates.slice(7, 14);
      var recent = lite(ordered.filter(function (t) { return recentDates.indexOf(t.date) >= 0; }));
      var previous = lite(ordered.filter(function (t) { return previousDates.indexOf(t.date) >= 0; }));
      declining = recent.total < previous.total && (recent.winRate <= previous.winRate - 0.10 || (recent.total < 0 && previous.total >= 0));
    }
    if (streak < threshold && !declining) return null;
    var why = String(userMeta.motivation_note || '').trim();
    var reasons = Array.isArray(userMeta.motivation_reasons) ? userMeta.motivation_reasons.join(' · ') : '';
    var heading = streak >= threshold ? 'Take a moment before the next trade.' : 'Your recent performance has shifted.';
    var detail = streak >= threshold
      ? 'You have recorded ' + streak + ' consecutive losing trades. Consider stepping back, protecting your capital and reviewing your process.'
      : 'Your most recent 7 trading days are weaker than the 7 before them. Pause to review your decisions before increasing activity.';
    return h('section', { class: 'panel motivation-reminder' },
      h('p', { class: 'eyebrow', text: 'A REMINDER FROM YOUR WHY' }),
      h('h2', { text: heading }),
      h('p', { text: detail }),
      why ? h('blockquote', { class: 'motivation-quote', text: '“' + why + '”' }) : null,
      !why && reasons ? h('p', { class: 'motivation-reasons', text: reasons }) : null,
      h('p', { class: 'motivation-footer', text: 'One difficult stretch does not define you. You can pause, review and return with a clearer plan.' }));
  }
  function viewDashboard(box) {
    var a = analyze(state.trades);
    var today = todayStr();
    var todaysTrades = state.trades.filter(function (t) { return t.date === today; });
    var todaysNet = todaysTrades.reduce(function (sum, t) { return sum + t.pnl; }, 0);
    var activity = h('section', { class: 'panel dashboard-today' },
      h('div', { class: 'dashboard-today-head' },
        h('div', null, h('p', { class: 'eyebrow', text: 'YOUR DAY, AT A GLANCE' }), h('h2', { text: 'Today’s activity' }), h('p', { class: 'sub', text: fmtDate(today) })),
        h('button', { class: 'btn btn-primary', type: 'button', text: '+ Add trade', onclick: function () { openTradeForm(null); } })),
      h('div', { class: 'dashboard-today-metrics' },
        h('div', null, h('span', { class: 'stat-label', text: 'Today’s P&L' }), h('strong', { class: 'dashboard-today-value ' + (todaysTrades.length ? cls(todaysNet) : ''), text: todaysTrades.length ? signed(todaysNet) : '—' })),
        h('div', null, h('span', { class: 'stat-label', text: 'Trades logged' }), h('strong', { class: 'dashboard-today-value', text: String(todaysTrades.length) })),
        h('div', null, h('span', { class: 'stat-label', text: 'Daily status' }), h('strong', { class: 'dashboard-today-status', text: todaysTrades.length ? 'Activity recorded' : 'Not started yet' }))));
    box.appendChild(activity);
    var reminder = motivationReminderPanel(); if (reminder) box.appendChild(reminder);
    if (!a.n) {
      box.appendChild(h('section', { class: 'panel hero-empty pipbook-empty' },
        h('p', { class: 'eyebrow', text: 'A CLEAR START' }),
        h('h2', { text: 'Your journal starts with one trade.' }),
        h('p', { text: 'Record your first trade to begin building a personal history of your decisions, results and lessons. Your dashboard will grow as your journal does.' }),
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Record your first trade', onclick: function () { openTradeForm(null); } })));
      return;
    }
    box.appendChild(statTiles(a));
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
    var rules = state.activeAccount && state.activeAccount.prop_rules || {}, stats = analyze(state.trades);
    if (Number(rules.maxDrawdownAmount) > 0 && stats.maxDD >= Number(rules.maxDrawdownAmount)) msgs.push('This account has reached its maximum drawdown amount of ' + CUR + fmt(Number(rules.maxDrawdownAmount)) + '.');
    if (Number(rules.maxDrawdownPercent) > 0 && s.balance > 0 && stats.maxDD / s.balance * 100 >= Number(rules.maxDrawdownPercent)) msgs.push('This account has reached its maximum drawdown of ' + rules.maxDrawdownPercent + '%.');
    if (Number(rules.profitTarget) > 0 && stats.total >= Number(rules.profitTarget)) msgs.push('The account profit target of ' + CUR + fmt(Number(rules.profitTarget)) + ' has been reached. Check your firm’s remaining requirements before trading further.');
    if (Number(rules.minimumTradingDays) > 0 && stats.dayCount < Number(rules.minimumTradingDays)) msgs.push('Trading-day requirement: ' + stats.dayCount + ' of ' + Number(rules.minimumTradingDays) + ' days logged.');
    if (Number(rules.consistencyPercent) > 0 && stats.total > 0) {
      var bestDay = Object.keys(stats.days).reduce(function (best, key) { return Math.max(best, stats.days[key].net); }, 0);
      if (bestDay > 0 && bestDay / stats.total * 100 > Number(rules.consistencyPercent)) msgs.push('Your best day is ' + Math.round(bestDay / stats.total * 100) + '% of total profit, above the ' + rules.consistencyPercent + '% consistency limit.');
    }
    if (msgs.length) { el.textContent = msgs.join(' ') + ' Review this account’s rules before placing another trade.'; el.hidden = false; }
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
  function screenshotSource(t) { return state.mode === 'cloud' ? (t.shotUrl || '') : (t.shotId ? '/_blob/' + t.shotId : ''); }
  function renderShotPrev() {
    var box = $('shot-prev'), s = state.shot; box.textContent = '';
    var src = s.preview || (s.existing && !s.remove ? s.existingUrl : '');
    if (src) box.appendChild(h('img', { src: src, alt: 'Chart screenshot preview' }));
    if (!s.blob && (!s.existing || s.remove)) return;
    box.appendChild(h('button', { class: 'btn btn-sm', type: 'button', text: 'Remove screenshot', 'aria-label': 'Remove screenshot only; keep this trade and its P&L', title: 'Remove only the screenshot. The trade and P&L will be kept.', onclick: function () {
      if (s.preview) URL.revokeObjectURL(s.preview);
      s.blob = null; s.preview = ''; if (s.existing) s.remove = true;
      $('f-shotfile').value = ''; renderShotPrev();
    } }));
  }
  function resetShot(existing, existingUrl) {
    if (state.shot.preview) URL.revokeObjectURL(state.shot.preview);
    state.shot = { blob: null, preview: '', existing: existing || '', existingUrl: existingUrl || '', remove: false };
    $('f-shotfile').value = ''; renderShotPrev();
  }
  function shotPrep(existing, tradeId) {
    var s = state.shot, old = existing ? existing.shotId : '';
    if (state.mode === 'cloud') {
      if (!activeCloudAdapter) return Promise.reject(new Error('Your cloud connection is not ready. Refresh and try again.'));
      if (s.blob) return activeCloudAdapter.uploadScreenshot(s.blob, tradeId).then(function (path) {
        return activeCloudAdapter.getScreenshotUrl(path).then(function (url) {
          if (!url) throw new Error('Could not create a secure screenshot preview. Please try uploading again.');
          return { id: path, drop: old, url: url };
        }).catch(function (error) {
          return activeCloudAdapter.deleteScreenshot(path).catch(function () {}).then(function () { throw error; });
        });
      });
      if (s.remove) return Promise.resolve({ id: '', drop: old, url: '' });
      return Promise.resolve({ id: old, drop: '', url: existing ? (existing.shotUrl || '') : '' });
    }
    if (s.blob && state.assets) return state.assets.upload(s.blob).then(function (res) { return { id: res.id, drop: old, url: '' }; });
    if (s.remove) return Promise.resolve({ id: '', drop: old, url: '' });
    return Promise.resolve({ id: old, drop: '', url: '' });
  }
  function dropAsset(id) {
    if (!id) return Promise.resolve();
    if (activeCloudAdapter && activeCloudAdapter.deleteScreenshot) {
      return Promise.resolve().then(function () { return activeCloudAdapter.deleteScreenshot(id); });
    }
    if (!state.assets || !state.assets.delete) return Promise.resolve();
    return Promise.resolve().then(function () { return state.assets.delete(id); });
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
          prices ? h('div', { class: 'cell-sub', text: prices }) : null, screenshotSource(t) ? h('a', { class: 'chartlink', style: 'margin-right:10px', href: screenshotSource(t), target: '_blank', rel: 'noopener noreferrer', text: 'Screenshot' }) : null, link ? h('a', { class: 'chartlink', href: link, target: '_blank', rel: 'noopener noreferrer', text: 'Chart ↗' }) : null),
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
    if (!state.trades.length) {
      box.appendChild(h('section', { class: 'panel hero-empty pipbook-empty' },
        h('p', { class: 'eyebrow', text: 'YOUR TRADE HISTORY' }),
        h('h2', { text: 'Every trade has a lesson.' }),
        h('p', { text: 'Your saved trades will appear here. Start with a quick entry, then add the details that help you learn from it.' }),
        h('button', { class: 'btn btn-primary', type: 'button', text: 'Record your first trade', onclick: function () { openTradeForm(null); } })));
      return;
    }
    var f = state.filters, count = h('span', { class: 'sub' }), tbox = h('div'), viewMode = state.focusTradeId ? 'cards' : 'list';
    function sel(key, opts) {
      var select = h('select', { 'aria-label': 'Filter by ' + key });
      opts.forEach(function (o) { select.appendChild(h('option', { value: o[0], text: o[1] })); });
      select.value = f[key]; select.addEventListener('change', function () { f[key] = select.value; refresh(); }); return select;
    }
    function refresh() {
      var filtered = filteredTrades();
      count.textContent = filtered.length === state.trades.length ? filtered.length + (filtered.length === 1 ? ' trade' : ' trades') : filtered.length + ' of ' + state.trades.length;
      tbox.textContent = '';
      if (!filtered.length) { tbox.appendChild(h('p', { class: 'empty', text: 'No trades match these filters.' })); return; }
      if (viewMode === 'cards') {
        var cards = h('div', { class: 'trade-card-grid' });
        filtered.forEach(function (trade) { cards.appendChild(tradeCard(trade)); });
        tbox.appendChild(cards);
      } else fillTradeTable(tbox, count);
    }
    var q = h('input', { class: 'q', type: 'search', placeholder: 'Search asset, lesson, emotion', 'aria-label': 'Search trades', value: f.q });
    q.addEventListener('input', function () { f.q = q.value; refresh(); });
    var pbOpts = [['', 'All playbooks'], ['_none', 'No playbook']].concat(state.playbooks.map(function (p) { return [p.id, p.name]; }));
    var filters = h('div', { class: 'toolbar' }, q, sel('pb', pbOpts), sel('outcome', [['', 'All results'], ['Win', 'Wins'], ['Loss', 'Losses'], ['Break-even', 'Break-even']]), sel('plan', [['', 'All plans'], ['kept', 'Plan kept'], ['broken', 'Plan broken']]));
    var listButton = h('button', { class: 'btn btn-sm' + (viewMode === 'list' ? ' is-selected' : ''), type: 'button', text: 'List', 'aria-pressed': String(viewMode === 'list') });
    var cardsButton = h('button', { class: 'btn btn-sm' + (viewMode === 'cards' ? ' is-selected' : ''), type: 'button', text: 'Cards', 'aria-pressed': String(viewMode === 'cards') });
    listButton.addEventListener('click', function () { viewMode = 'list'; state.focusTradeId = null; listButton.classList.add('is-selected'); cardsButton.classList.remove('is-selected'); listButton.setAttribute('aria-pressed','true'); cardsButton.setAttribute('aria-pressed','false'); refresh(); });
    cardsButton.addEventListener('click', function () { viewMode = 'cards'; cardsButton.classList.add('is-selected'); listButton.classList.remove('is-selected'); cardsButton.setAttribute('aria-pressed','true'); listButton.setAttribute('aria-pressed','false'); refresh(); });
    var panel = h('section', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('h2', { text: 'Trade history' }), count),
      h('div', { class: 'trade-view-tools' }, filters, h('div', { class: 'trade-view-switch', 'aria-label': 'Trade display mode' }, listButton, cardsButton)),
      tbox);
    box.appendChild(panel);
    refresh();
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
    var streak = h('input', { id: 's-streak', type: 'number', step: '1', min: '2', max: '10', inputmode: 'numeric', placeholder: '3' });
    tgt.value = s.monthlyTarget == null ? '' : s.monthlyTarget; cap.value = s.maxTradesDay == null ? '' : s.maxTradesDay; dls.value = s.dailyLoss == null ? '' : s.dailyLoss;
    bal.value = s.balance == null ? '' : s.balance; risk.value = s.riskPct == null ? '' : s.riskPct; cur.value = s.currency; streak.value = s.lossStreakThreshold || 3;
    var lim = riskLimit(), save = h('button', { class: 'btn btn-primary', type: 'button', text: 'Save trading setup' });
    save.addEventListener('click', function () {
      if (state.readOnlyCloud) { msg.textContent = 'Cloud journal is read-only. Settings cannot be changed in this stage.'; return; }
      var b = num(bal.value), r = num(risk.value), streakValue = num(streak.value);
      if (bal.value.trim() && (b == null || b <= 0)) { msg.textContent = 'Starting balance must be a number above zero.'; bal.focus(); return; }
      if (risk.value.trim() && (r == null || r <= 0 || r > 100)) { msg.textContent = 'Risk per trade must be between 0 and 100 percent.'; risk.focus(); return; }
      var goalFields = [[tgt, 'Monthly profit target'], [cap, 'Max trades per day'], [dls, 'Daily loss limit']];
      for (var gi = 0; gi < goalFields.length; gi++) {
        var gv = num(goalFields[gi][0].value);
        if (goalFields[gi][0].value.trim() && (gv == null || gv <= 0)) { msg.textContent = goalFields[gi][1] + ' must be a number above zero.'; goalFields[gi][0].focus(); return; }
      }
      if (streakValue == null || streakValue < 2 || streakValue > 10 || Math.floor(streakValue) !== streakValue) { msg.textContent = 'Choose a loss-streak reminder threshold from 2 to 10 trades.'; streak.focus(); return; }
      if (state.mode === 'pending') { msg.textContent = 'Still connecting to your saved journal. Try again in a moment.'; return; }
      save.disabled = true; msg.textContent = '';
      saveSettings(normSettings({ balance: b, riskPct: r, currency: cur.value, monthlyTarget: num(tgt.value), maxTradesDay: num(cap.value), dailyLoss: num(dls.value), lossStreakThreshold: streakValue, example: false })).then(function () { toast('Trading setup saved'); }).catch(function (e) { msg.textContent = failMsg(e); }).then(function () { save.disabled = false; });
    });
    var acct = h('section', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h2', { text: 'Account, risk and goals' })),
      h('div', { class: 'fields' },
        h('div', { class: 'field' }, h('label', { for: 's-bal', text: 'Starting balance' }), bal),
        h('div', { class: 'field' }, h('label', { for: 's-cur', text: 'Currency symbol' }), cur),
        h('div', { class: 'field' }, h('label', { for: 's-risk', text: 'Risk per trade (%)' }), risk),
        h('div', { class: 'field' }, h('label', { for: 's-tgt', text: 'Monthly profit target' }), tgt),
        h('div', { class: 'field' }, h('label', { for: 's-cap', text: 'Max trades per day' }), cap),
        h('div', { class: 'field' }, h('label', { for: 's-dls', text: 'Daily loss limit' }), dls),
        h('div', { class: 'field' }, h('label', { for: 's-streak', text: 'Motivation reminder after consecutive losses' }), streak),
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
    else el.textContent = 'Set an account size in Trading Setup to check this against a risk limit.';
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
      $('f-emotion').value = t.emotion; setMistakes(t.mistakes); resetShot(t.shotId, t.shotUrl); $('f-lesson').value = t.lesson; $('f-shot').value = t.shot;
      renderChecks(t.misses.length ? $('f-pb').value && state.playbooks.find(function (p) { return p.id === $('f-pb').value; }).rules.filter(function (r) { return t.misses.indexOf(r) < 0; }) : null);
      $(t.followed ? 'plan-yes' : 'plan-no').checked = true;
      $('sec-prices').open = !!(t.entry || t.sl || t.tp || t.exit || t.shot);
      $('dt-title').textContent = 'Edit trade'; $('btn-save').textContent = 'Update trade'; $('btn-another').hidden = true; updateRHint();
    }
    $('shot-wrap').hidden = state.mode === 'cloud' ? !activeCloudAdapter : !state.assets;
    $('f-shotfile').disabled = state.mode === 'cloud' ? !activeCloudAdapter : !state.assets;
    if (t && t.shotId) $('sec-prices').open = true;
    updateLimitWarn();
    showTradeStep(0);
    openDrawer($('drawer-trade'), t ? null : 'f-asset');
  }
  function showTradeSuccess(tradeId) {
    state.lastSavedTradeId = tradeId;
    var modal = $('trade-success');
    if (modal) modal.hidden = false;
  }
  function closeTradeSuccess() {
    var modal = $('trade-success');
    if (modal) modal.hidden = true;
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
    var uploadedScreenshot = '', tradeSaved = false, screenshotCleanupFailed = false;
    shotPrep(existing, t.id).then(function (sp) {
      t.shotId = sp.id; t.shotUrl = sp.url || '';
      if (sp.id && sp.id !== (existing ? existing.shotId : '')) uploadedScreenshot = sp.id;
      return put('trades', t).then(function () {
        tradeSaved = true;
        if (sp.drop) return dropAsset(sp.drop).catch(function () { screenshotCleanupFailed = true; });
      });
    }).then(function () {
      toast(screenshotCleanupFailed
        ? (wasEdit ? 'Trade updated, but the old screenshot could not be removed from storage.' : 'Trade saved, but an old screenshot could not be removed from storage.')
        : (wasEdit ? 'Trade updated' : 'Trade saved'));
      if (another && !wasEdit) { resetTradeForm(true); fillSelects(); updateLimitWarn(); showTradeStep(0); $('f-asset').focus(); } else { resetTradeForm(false); closeDrawers(); showTradeSuccess(t.id); }
    }).catch(function (err) {
      if (uploadedScreenshot && !tradeSaved) {
        dropAsset(uploadedScreenshot).catch(function () { screenshotCleanupFailed = true; }).then(function () {
          msg.textContent = failMsg(err) + (screenshotCleanupFailed ? ' The unused uploaded screenshot may still remain in storage.' : '');
        });
      } else if (tradeSaved) {
        toast('Trade saved, but screenshot cleanup needs attention.');
        resetTradeForm(false); closeDrawers();
      } else msg.textContent = failMsg(err);
    }).then(function () { b1.disabled = b2.disabled = false; });
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
    var screenshotCleanupFailures = 0;
    seq(tr, function (t) { return del('trades', t.id).then(function (result) { if (result && result.screenshotCleanupError) screenshotCleanupFailures++; }); }).then(function () { return seq(pb, function (p) { return del('playbooks', p.id); }); }).then(function () { return seq(state.days.filter(function (d) { return d.example; }), function (d) { return del('days', d.id); }); }).then(function () { if (state.settings.example) return saveSettings(normSettings(null)); }).then(function () { toast(screenshotCleanupFailures ? 'Examples cleared, but ' + screenshotCleanupFailures + ' screenshot(s) could not be removed from storage.' : 'Examples cleared'); }).catch(function (e) { toast(failMsg(e)); });
  }

  /* ---------- routing + render ---------- */
  var RENDER = { dashboard: viewDashboard, calendar: viewCalendar, trades: viewTrades, playbooks: viewPlaybooks, reports: viewReports, insights: viewInsights, settings: viewSettings, profile: function (box) { if (window.MaxiProfileUI) window.MaxiProfileUI.render(box); else box.textContent = 'Profile is loading…'; } };
  function renderView() {
    var box = $('v-' + state.view); box.textContent = ''; RENDER[state.view](box);
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') Array.prototype.forEach.call(box.querySelectorAll('.hero-empty .row-btns'), function (el) { el.hidden = true; });
  }
  async function switchTradingAccount(accountId) {
    if (!activeCloudAdapter || !accountId || !authUser || state.dataState === 'cloud-loading' || state.dataState === 'cloud-syncing') return;
    var token = ++authLoadToken;
    setDataState('cloud-loading'); renderAll();
    try {
      var cloud = await activeCloudAdapter.load(accountId);
      if (token !== authLoadToken || !authUser) return;
      state.accounts = cloud.accounts || []; state.activeAccount = cloud.activeAccount || null;
      state.trades = (cloud.trades || []).map(normTrade);
      state.playbooks = (cloud.playbooks || []).map(normPb);
      state.days = (cloud.days || []).map(normDay);
      var rules = state.activeAccount && state.activeAccount.prop_rules || {};
      state.settings = normSettings(Object.assign({}, cloud.settings, {
        balance: state.activeAccount ? state.activeAccount.starting_balance : cloud.settings.balance,
        currency: state.activeAccount ? state.activeAccount.currency : cloud.settings.currency,
        riskPct: rules.riskPct != null ? rules.riskPct : cloud.settings.riskPct,
        dailyLoss: rules.dailyLossLimit != null ? rules.dailyLossLimit : cloud.settings.dailyLoss,
        maxTradesDay: rules.maxTradesDay != null ? rules.maxTradesDay : cloud.settings.maxTradesDay,
        monthlyTarget: rules.profitTarget != null ? rules.profitTarget : cloud.settings.monthlyTarget
      }));
      state.mode = 'cloud'; applySettings(); setDataState('cloud-ready'); renderAll();
      toast('Switched to ' + (state.activeAccount.account_name || 'account'));
    } catch (error) {
      if (token !== authLoadToken) return;
      state.mode = 'cloud'; setDataState('cloud-error'); renderAll();
      toast('Could not switch account: ' + ((error && error.message) || 'Please try again.'));
    }
  }
  function renderAccountWorkspace() {
    var topbar = document.querySelector('.workspace-topbar');
    if (!topbar) return;
    if (!authUser) { var oldPanel = document.getElementById('account-workspace'); if (oldPanel) oldPanel.hidden = true; return; }
    var panel = document.getElementById('account-workspace');
    if (!panel) {
      panel = h('div', { id: 'account-workspace', class: 'account-workspace' });
      panel.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-left:auto;margin-right:12px;';
      var select = h('select', { id: 'account-workspace-select', 'aria-label': 'Active trading account', class: 'account-select' });
      select.style.cssText = 'min-height:40px;max-width:210px;padding:8px 12px;border:1px solid var(--line,#333);border-radius:10px;background:var(--panel,#111);color:inherit;font:inherit;';
      select.addEventListener('change', function () { switchTradingAccount(select.value); });
      var add = h('button', { type: 'button', class: 'btn btn-sm', text: '+ Account', title: 'Create a trading account' });
      add.addEventListener('click', async function () {
        if (!activeCloudAdapter || state.dataState !== 'cloud-ready' && state.dataState !== 'cloud-synced') return;
        var name = window.prompt('Name this trading account (for example, GoFund 10K):');
        if (!name || !name.trim()) return;
        var kind = window.prompt('Account type: live, demo, or prop', 'prop');
        if (kind == null) return;
        var firm = window.prompt('Broker or prop firm (optional):', '');
        if (firm == null) return;
        var balanceText = window.prompt('Starting balance (numbers only):', '10000');
        if (balanceText == null) return;
        var balance = Number(balanceText);
        if (!isFinite(balance) || balance < 0) { toast('Enter a valid starting balance.'); return; }
        try {
          var created = await activeCloudAdapter.createAccount({
            account_name: name.trim(), account_type: ['live','demo','prop'].indexOf(kind.toLowerCase()) >= 0 ? kind.toLowerCase() : 'live',
            broker: firm.trim(), starting_balance: balance,
            currency: state.activeAccount && state.activeAccount.currency || 'USD',
            prop_rules: { riskPct: state.settings.riskPct || null, dailyLossLimit: null, maxDrawdownAmount: null, maxDrawdownPercent: null, profitTarget: null, consistencyPercent: null, minimumTradingDays: null, maxTradesDay: null, newsTradingAllowed: null, weekendHoldingAllowed: null }
          });
          await switchTradingAccount(created.id);
        } catch (error) { toast('Account could not be created: ' + ((error && error.message) || 'Please try again.')); }
      });
      var rules = h('button', { type: 'button', class: 'btn btn-sm', text: 'Rules', title: 'Edit custom prop-firm rules for this account' });
      rules.addEventListener('click', async function () {
        if (!state.activeAccount || !activeCloudAdapter) return;
        var current = state.activeAccount.prop_rules || {};
        var raw = window.prompt('Edit this account’s custom rules as JSON. Supported keys: riskPct, dailyLossLimit, maxDrawdownAmount, maxDrawdownPercent, profitTarget, consistencyPercent, minimumTradingDays, maxTradesDay, newsTradingAllowed, weekendHoldingAllowed. Use numbers for limits and true/false for permissions.', JSON.stringify(current, null, 2));
        if (raw == null) return;
        try {
          var parsed = JSON.parse(raw);
          if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Rules must be a JSON object.');
          var updated = await activeCloudAdapter.updateAccount(state.activeAccount.id, { prop_rules: parsed });
          state.activeAccount = updated;
          state.settings = normSettings(Object.assign({}, state.settings, {
            riskPct: parsed.riskPct != null ? parsed.riskPct : state.settings.riskPct,
            dailyLoss: parsed.dailyLossLimit != null ? parsed.dailyLossLimit : state.settings.dailyLoss,
            maxTradesDay: parsed.maxTradesDay != null ? parsed.maxTradesDay : state.settings.maxTradesDay,
            monthlyTarget: parsed.profitTarget != null ? parsed.profitTarget : state.settings.monthlyTarget
          }));
          applySettings(); renderAll(); toast('Account rules saved.');
        } catch (error) { toast('Rules not saved: ' + ((error && error.message) || 'Check the JSON and try again.')); }
      });
      panel.appendChild(select); panel.appendChild(add); panel.appendChild(rules);
      var heading = topbar.querySelector('.workspace-heading');
      if (heading && heading.nextSibling) topbar.insertBefore(panel, heading.nextSibling); else topbar.insertBefore(panel, topbar.firstChild);
    }
    var picker = document.getElementById('account-workspace-select');
    if (!picker) return;
    picker.textContent = '';
    (state.accounts || []).forEach(function (account) {
      picker.appendChild(h('option', { value: account.id, text: account.account_name + (account.account_type ? ' · ' + account.account_type : '') }));
    });
    if (state.activeAccount) picker.value = state.activeAccount.id;
    picker.disabled = state.dataState === 'cloud-loading' || state.dataState === 'cloud-syncing';
    panel.hidden = !state.accounts || !state.accounts.length;
  }
  function renderAll() {
    $('fab').hidden = !!state.readOnlyCloud || state.dataState === 'cloud-loading';
    $('btn-clear-ex').hidden = !!state.readOnlyCloud || state.dataState === 'cloud-loading';
    renderAccountWorkspace();
    $('banner').hidden = !(state.trades.some(function (t) { return t.example; }) || state.playbooks.some(function (p) { return p.example; }) || state.days.some(function (d) { return d.example; }) || state.settings.example);
    renderView();
    if (state.readOnlyCloud || state.dataState === 'cloud-loading') {
      Array.prototype.forEach.call(document.querySelectorAll('.hero-empty .row-btns'), function (el) { el.hidden = true; });
    }
  }
  function setView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'dashboard';
    state.view = name;
    $('fab').hidden = !!state.readOnlyCloud || state.dataState === 'cloud-loading';
    var pageTitles = { dashboard: 'Dashboard', trades: 'Trade Log', calendar: 'Calendar', playbooks: 'Playbooks', reports: 'Reports', insights: 'Analytics', settings: 'Trading Setup', profile: 'Profile' };
    var pageTitle = $('workspace-title');
    if (pageTitle) pageTitle.textContent = pageTitles[name] || 'Dashboard';
    VIEWS.forEach(function (v) { var el = $('v-' + v); el.hidden = v !== name; if (v !== name) el.textContent = ''; });
    Array.prototype.forEach.call($('nav').querySelectorAll('a'), function (a) { if (a.getAttribute('data-v') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var moreNav = $('nav').querySelector('.nav-more');
    if (moreNav) {
      var moreActive = ['playbooks', 'reports', 'insights', 'settings', 'profile'].indexOf(name) >= 0;
      moreNav.open = false;
      moreNav.querySelector('summary').classList.toggle('is-active', moreActive);
    }
    document.body.classList.remove('mobile-nav-open');
    var menuButton = $('mobile-menu-toggle');
    if (menuButton) menuButton.setAttribute('aria-expanded', 'false');
    renderView();
  }

  /* ---------- boot ---------- */
  $('f-date').value = todayStr();
  fillSelects();
  var tradeStep = 0;
  var tradeStepNames = ['BASICS', 'EXECUTION', 'STRATEGY', 'REVIEW'];
  function tradeReviewRow(label, value) {
    var row = h('div', { class: 'trade-review-row' });
    row.appendChild(h('span', { class: 'trade-review-label', text: label }));
    row.appendChild(h('strong', { text: value || '—' }));
    return row;
  }
  function refreshTradeReview() {
    var box = $('trade-review-summary');
    if (!box) return;
    box.textContent = '';
    var side = sideVal();
    box.appendChild(tradeReviewRow('Instrument', $('f-asset').value.trim().toUpperCase()));
    box.appendChild(tradeReviewRow('Direction', side === 'sell' ? 'Sell' : 'Buy'));
    box.appendChild(tradeReviewRow('P&L', $('f-pnl').value ? CUR + $('f-pnl').value : 'Not entered'));
    box.appendChild(tradeReviewRow('Trade date', $('f-date').value));
    box.appendChild(tradeReviewRow('Entry / stop / exit', [$('f-entry').value, $('f-sl').value, $('f-exit').value].map(function (v) { return v || '—'; }).join(' / ')));
    box.appendChild(tradeReviewRow('Risk amount', $('f-risk').value ? CUR + $('f-risk').value : 'Not entered'));
    box.appendChild(tradeReviewRow('Playbook', $('f-pb').selectedOptions[0] ? $('f-pb').selectedOptions[0].textContent : 'None selected'));
    box.appendChild(tradeReviewRow('Emotion', $('f-emotion').value));
    box.appendChild(tradeReviewRow('Plan followed', $('plan-yes').checked ? 'Yes' : 'No'));
  }
  function showTradeStep(index) {
    tradeStep = Math.max(0, Math.min(3, index));
    Array.prototype.forEach.call(document.querySelectorAll('[data-trade-step]'), function (panel) {
      var active = Number(panel.getAttribute('data-trade-step')) === tradeStep;
      panel.hidden = !active;
      panel.classList.toggle('is-current', active);
    });
    $('trade-step-label').textContent = String(tradeStep + 1).padStart(2, '0') + ' / 04 · ' + tradeStepNames[tradeStep];
    $('trade-step-count').textContent = 'Step ' + (tradeStep + 1) + ' of 4';
    $('trade-progress-fill').style.width = ((tradeStep + 1) * 25) + '%';
    $('trade-back').hidden = tradeStep === 0;
    $('trade-quick-save').hidden = tradeStep !== 0 || !!state.editingTrade;
    $('trade-next').hidden = tradeStep === 3;
    $('btn-save').hidden = tradeStep !== 3;
    $('btn-another').hidden = tradeStep !== 3 || !!state.editingTrade;
    if (tradeStep === 3) refreshTradeReview();
    $('drawer-trade').scrollTop = 0;
  }
  function validateTradeBasics() {
    var msg = $('form-msg');
    if (!$('f-asset').value.trim()) { msg.textContent = 'Enter the pair or asset you traded.'; $('f-asset').focus(); return false; }
    if (num($('f-pnl').value) == null) { msg.textContent = 'Enter the P&L amount. Use a minus sign for a loss.'; $('f-pnl').focus(); return false; }
    if (!$('f-date').value) { msg.textContent = 'Pick the trade date.'; $('f-date').focus(); return false; }
    msg.textContent = '';
    return true;
  }
  $('trade-quick-save').addEventListener('click', function () { submitTrade(false); });
  $('trade-success-view').addEventListener('click', function () {
    closeTradeSuccess();
    state.focusTradeId = state.lastSavedTradeId;
    if (location.hash !== '#trades') location.hash = '#trades';
    else setView('trades');
  });
  $('trade-success-dashboard').addEventListener('click', function () {
    closeTradeSuccess();
    state.focusTradeId = null;
    if (location.hash !== '#dashboard') location.hash = '#dashboard';
    else setView('dashboard');
  });
  $('trade-next').addEventListener('click', function () {
    if (tradeStep === 0 && !validateTradeBasics()) return;
    showTradeStep(tradeStep + 1);
  });
  $('trade-back').addEventListener('click', function () { showTradeStep(tradeStep - 1); });
  $('trade-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (tradeStep < 3) {
      if (tradeStep === 0 && !validateTradeBasics()) return;
      showTradeStep(tradeStep + 1);
      return;
    }
    submitTrade(false);
  });
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
    if (!/^image\/(jpeg|png|webp)$/i.test(f.type)) { msg.textContent = 'Choose a JPEG, PNG or WebP image.'; inp.value = ''; return; }
    if (f.size > 25 * 1024 * 1024) { msg.textContent = 'That image is over 25 MB. Choose a smaller one.'; inp.value = ''; return; }
    shrinkImage(f).then(function (b) {
      if (b.size > 10 * 1024 * 1024) throw new Error('The compressed image is over the 10 MB storage limit. Choose a smaller image.');
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
  var mobileMenuButton = $('mobile-menu-toggle');
  if (mobileMenuButton) mobileMenuButton.addEventListener('click', function () {
    var open = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', open);
    mobileMenuButton.setAttribute('aria-expanded', String(open));
  });
  $('nav').addEventListener('click', function (event) {
    if (event.target.closest('a[data-v]')) {
      document.body.classList.remove('mobile-nav-open');
      if (mobileMenuButton) mobileMenuButton.setAttribute('aria-expanded', 'false');
    }
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
