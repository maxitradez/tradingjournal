/* Maxi Trades Journal — account profile and first-login onboarding. */
(function () {
  'use strict';
  var api = window.maxiSupabase;
  var home = document.getElementById('public-home');
  var onboarding = document.getElementById('profile-onboarding');
  var currentUser = null;
  var cachedProfile = null;
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function field(label, name, type, value, placeholder) {
    var wrap = el('div', { class: 'field' });
    var id = 'profile-' + name;
    wrap.appendChild(el('label', { for: id }, label));
    var input = type === 'select' ? document.createElement('select') : el('input', { id: id, name: name, type: type || 'text', maxlength: name === 'username' ? '24' : '100', placeholder: placeholder || '' });
    if (type === 'select') { input.id = id; input.name = name; }
    if (type === 'select') {
      var options = name === 'experience_level' ? [['','Select experience'],['beginner','Beginner'],['intermediate','Intermediate'],['advanced','Advanced'],['professional','Professional']] :
        name === 'trading_style' ? [['','Select trading style'],['scalping','Scalping'],['day_trading','Day trading'],['swing','Swing trading'],['position','Position trading'],['investing','Investing'],['other','Other']] : [];
      options.forEach(function (o) { var op = el('option', { value: o[0] }, o[1]); input.appendChild(op); });
    }
    input.value = value || '';
    wrap.appendChild(input);
    return wrap;
  }
  function buildOnboarding(user, profile) {
    onboarding.textContent = '';
    var card = el('div', { class: 'profile-card' });
    card.appendChild(el('p', { class: 'eyebrow' }, 'YOUR WORKSPACE STARTS HERE'));
    card.appendChild(el('h2', {}, 'Let’s set up your profile.'));
    card.appendChild(el('p', { class: 'profile-intro' }, 'A few details help us shape your journal around the way you trade. You can update these later.'));
    var form = el('form', { class: 'profile-form' });
    var grid = el('div', { class: 'auth-fields' });
    grid.appendChild(field('Display name', 'display_name', 'text', profile.display_name || user.user_metadata && user.user_metadata.full_name || '', 'How should we address you?'));
    grid.appendChild(field('Username', 'username', 'text', profile.username || '', 'Choose a unique username'));
    grid.appendChild(field('Country', 'country', 'text', profile.country || '', 'e.g. Kenya'));
    grid.appendChild(field('Experience level', 'experience_level', 'select', profile.experience_level || ''));
    grid.appendChild(field('Trading style', 'trading_style', 'select', profile.trading_style || ''));
    grid.appendChild(field('Preferred markets', 'preferred_markets', 'text', (profile.preferred_markets || []).join(', '), 'Forex, Gold, Indices, Crypto…'));
    grid.appendChild(field('Timezone', 'timezone', 'text', profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', 'e.g. Africa/Nairobi'));
    form.appendChild(grid);
    var note = el('p', { class: 'profile-message', role: 'status' });
    var submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save profile & open journal');
    form.appendChild(note); form.appendChild(submit);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var username = String(data.get('username') || '').trim().toLowerCase();
      var displayName = String(data.get('display_name') || '').trim();
      if (!displayName || !/^[a-z0-9_]{3,24}$/.test(username)) {
        note.textContent = 'Add a display name and a username (3–24 letters, numbers or underscores).';
        return;
      }
      submit.disabled = true; note.textContent = 'Saving your profile…';
      var payload = {
        display_name: displayName, username: username,
        country: String(data.get('country') || '').trim(),
        experience_level: String(data.get('experience_level') || ''),
        trading_style: String(data.get('trading_style') || ''),
        preferred_markets: String(data.get('preferred_markets') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 12),
        timezone: String(data.get('timezone') || 'UTC').trim(),
        onboarding_completed: true, updated_at: new Date().toISOString()
      };
      try {
        var saved = await api.from('profiles').update(payload).eq('id', user.id).select('*').single();
        if (saved.error) throw saved.error;
        cachedProfile = saved.data;
        document.body.classList.remove('profile-required');
        onboarding.hidden = true; home.hidden = true;
        document.querySelector('.wrap').hidden = false;
        document.getElementById('fab').hidden = false;
        if (location.hash === '#profile') window.MaxiProfileUI.render(document.getElementById('v-profile'));
        note.textContent = 'Profile saved.';
      } catch (error) {
        note.textContent = error && error.code === '23505' ? 'That username is already taken. Try another.' : (error.message || 'Could not save your profile. Check the profile database migration.');
        submit.disabled = false;
      }
    });
    card.appendChild(form); onboarding.appendChild(card);
  }
  async function handleSession(session) {
    currentUser = session && session.user ? session.user : null;
    if (!currentUser) {
      cachedProfile = null;
      document.body.classList.add('account-required');
      document.body.classList.remove('profile-required');
      home.hidden = false; onboarding.hidden = true;
      document.querySelector('.wrap').hidden = true;
      document.getElementById('fab').hidden = true;
      return;
    }
    home.hidden = true;
    document.body.classList.add('profile-required');
    document.querySelector('.wrap').hidden = true;
    document.getElementById('fab').hidden = true;
    onboarding.hidden = false;
    onboarding.textContent = 'Loading your profile…';
    try {
      var result = await api.from('profiles').select('*').eq('id', currentUser.id).single();
      if (result.error) throw result.error;
      cachedProfile = result.data;
      if (cachedProfile.onboarding_completed) {
        document.body.classList.remove('profile-required');
        onboarding.hidden = true;
        document.querySelector('.wrap').hidden = false;
        document.getElementById('fab').hidden = false;
      } else buildOnboarding(currentUser, cachedProfile);
    } catch (error) {
      onboarding.textContent = '';
      var card = el('div', { class: 'profile-card' });
      card.appendChild(el('h2', {}, 'One setup step remains'));
      card.appendChild(el('p', { class: 'profile-intro' }, 'The profile fields are ready in the app, but the database update must be applied before onboarding can continue.'));
      card.appendChild(el('p', { class: 'profile-message' }, 'Database response: ' + (error.message || 'Profile could not be loaded.')));
      onboarding.appendChild(card);
    }
  }
  window.MaxiProfileUI = {
    render: function (box) {
      box.textContent = '';
      if (!currentUser) return;
      var p = cachedProfile || {};
      var card = el('div', { class: 'panel profile-view' });
      card.appendChild(el('p', { class: 'eyebrow' }, 'YOUR ACCOUNT'));
      card.appendChild(el('h2', {}, 'Profile & identity'));
      var uid = el('div', { class: 'profile-uid' });
      uid.appendChild(el('span', {}, 'YOUR UNIQUE ACCOUNT ID'));
      var code = el('code', {}, currentUser.id);
      uid.appendChild(code);
      var copy = el('button', { class: 'btn btn-sm', type: 'button' }, 'Copy UID');
      copy.addEventListener('click', function () { navigator.clipboard && navigator.clipboard.writeText(currentUser.id).then(function () { copy.textContent = 'Copied'; }).catch(function () {}); });
      uid.appendChild(copy); card.appendChild(uid);
      var form = el('form', { class: 'profile-form' });
      var grid = el('div', { class: 'auth-fields' });
      grid.appendChild(field('Display name', 'display_name', 'text', p.display_name || ''));
      grid.appendChild(field('Username', 'username', 'text', p.username || ''));
      grid.appendChild(field('Country', 'country', 'text', p.country || ''));
      grid.appendChild(field('Experience level', 'experience_level', 'select', p.experience_level || ''));
      grid.appendChild(field('Trading style', 'trading_style', 'select', p.trading_style || ''));
      grid.appendChild(field('Preferred markets', 'preferred_markets', 'text', (p.preferred_markets || []).join(', ')));
      grid.appendChild(field('Timezone', 'timezone', 'text', p.timezone || 'UTC'));
      form.appendChild(grid);
      var msg = el('p', { class: 'profile-message', role: 'status' });
      var save = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save changes');
      form.appendChild(msg); form.appendChild(save);
      form.addEventListener('submit', async function (e) {
        e.preventDefault(); save.disabled = true; msg.textContent = 'Saving…';
        var d = new FormData(form);
        var payload = {
          display_name: String(d.get('display_name') || '').trim(),
          username: String(d.get('username') || '').trim().toLowerCase(),
          country: String(d.get('country') || '').trim(),
          experience_level: String(d.get('experience_level') || ''),
          trading_style: String(d.get('trading_style') || ''),
          preferred_markets: String(d.get('preferred_markets') || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0,12),
          timezone: String(d.get('timezone') || 'UTC').trim(), updated_at: new Date().toISOString()
        };
        var result = await api.from('profiles').update(payload).eq('id', currentUser.id).select('*').single();
        save.disabled = false;
        if (result.error) msg.textContent = result.error.code === '23505' ? 'Username already taken.' : result.error.message;
        else { cachedProfile = result.data; msg.textContent = 'Profile updated.'; }
      });
      card.appendChild(form); box.appendChild(card);
    }
  };
  if (!api || !api.auth) return;
  api.auth.onAuthStateChange(function (_event, session) { setTimeout(function () { handleSession(session); }, 0); });
  api.auth.getSession().then(function (r) { if (!r.error) handleSession(r.data.session); });
})();