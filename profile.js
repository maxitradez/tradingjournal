/* Maxi Trades Journal — account profile and first-login onboarding. */
(function () {
  'use strict';
  var api = window.maxiSupabase;
  var home = document.getElementById('public-home');
  var onboarding = document.getElementById('profile-onboarding');
  var currentUser = null;
  var cachedProfile = null;
  var savingOnboarding = false;
  var showingWelcome = false;
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
    var meta = user.user_metadata || {};
    var card = el('div', { class: 'profile-card pipbook-onboard-card' });
    card.appendChild(el('p', { class: 'eyebrow' }, 'WELCOME TO PIPBOOK'));
    card.appendChild(el('h2', {}, 'Let’s make this journal yours.'));
    card.appendChild(el('p', { class: 'profile-intro' }, 'A few thoughtful details help PIPBOOK understand the markets you follow and the reason you started.'));
    var form = el('form', { class: 'profile-form', autocomplete: 'off' });
    var steps = [
      { title: 'First, the basics', intro: 'Tell us a little about yourself.', fields: [
        field('Your name', 'display_name', 'text', profile.display_name || meta.full_name || '', 'How should we address you?'),
        field('Username', 'username', 'text', profile.username || '', 'Choose a unique username'),
        field('Country', 'country', 'text', profile.country || '', 'Your country')
      ]},
      { title: 'Your trading world', intro: 'Choose the markets and sessions that are part of your routine.', fields: [] }
    ];
    steps[0].fields.forEach(function (control) { form.appendChild(control); });
    var panels = [el('section', { class: 'onboard-step is-current', 'data-step': '0' })];
    panels[0].appendChild(el('h3', {}, steps[0].title));
    panels[0].appendChild(el('p', { class: 'profile-intro' }, steps[0].intro));
    var identityGrid = el('div', { class: 'auth-fields' });
    steps[0].fields.forEach(function (control) { identityGrid.appendChild(control); });
    panels[0].appendChild(identityGrid);

    var marketPanel = el('section', { class: 'onboard-step', 'data-step': '1' });
    marketPanel.appendChild(el('h3', {}, steps[1].title));
    marketPanel.appendChild(el('p', { class: 'profile-intro' }, steps[1].intro));
    function choiceGroup(title, name, choices, selected) {
      var wrap = el('div', { class: 'onboard-choice-group' });
      wrap.appendChild(el('span', { class: 'lbl' }, title));
      var grid = el('div', { class: 'onboard-choice-grid' });
      choices.forEach(function (choice) {
        var label = el('label', { class: 'onboard-choice' });
        var input = el('input', { type: 'checkbox', name: name, value: choice });
        input.checked = (selected || []).indexOf(choice) >= 0;
        label.appendChild(input);
        label.appendChild(el('span', {}, choice));
        grid.appendChild(label);
      });
      wrap.appendChild(grid);
      return wrap;
    }
    var marketChoices = ['Forex', 'XAUUSD', 'XAGUSD', 'Indices', 'US30', 'NAS100', 'Crypto', 'Stocks', 'Futures', 'Options'];
    var sessionChoices = ['Asian', 'London', 'New York', 'Sydney', 'Other'];
    marketPanel.appendChild(choiceGroup('Markets and instruments · select all that apply', 'pip_markets', marketChoices, profile.preferred_markets || []));
    var custom = field('Other instruments (optional)', 'custom_markets', 'text', '', 'e.g. GBPJPY, DAX40, BTCUSD');
    marketPanel.appendChild(custom);
    marketPanel.appendChild(choiceGroup('Trading sessions · select all that apply', 'pip_sessions', sessionChoices, meta.preferred_sessions || []));
    marketPanel.appendChild(choiceGroup('Why did you start trading? · select all that apply', 'pip_reasons', [
      'Financial freedom', 'Supporting my family', 'Building a trading career',
      'Personal growth and discipline', 'Building long-term wealth', 'Creating more opportunities', 'Other'
    ], meta.motivation_reasons || []));
    var personal = el('div', { class: 'field full onboard-motivation-note' });
    personal.appendChild(el('label', { for: 'pip-motivation-note' }, 'Your personal reason (optional)'));
    var noteInput = el('textarea', { id: 'pip-motivation-note', name: 'motivation_note', placeholder: 'In your own words, what made you start this journey?' });
    noteInput.value = meta.motivation_note || '';
    personal.appendChild(noteInput);
    marketPanel.appendChild(personal);
    panels.push(marketPanel);
    panels.forEach(function (panel) { form.appendChild(panel); });

    var stepper = el('div', { class: 'onboard-stepper', 'aria-label': 'Onboarding progress' });
    ['01', '02'].forEach(function (n, i) { stepper.appendChild(el('span', { class: 'onboard-step-dot' + (i ? '' : ' is-current') }, n)); });
    form.insertBefore(stepper, form.firstChild);
    var note = el('p', { class: 'profile-message', role: 'status', 'aria-live': 'polite' });
    var actions = el('div', { class: 'onboard-actions' });
    var back = el('button', { class: 'btn', type: 'button' }, 'Back');
    var next = el('button', { class: 'btn btn-primary', type: 'button' }, 'Continue');
    var submit = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Finish setup');
    back.hidden = true; submit.hidden = true;
    actions.appendChild(back); actions.appendChild(next); actions.appendChild(submit);
    form.appendChild(note); form.appendChild(actions);
    var activeStep = 0;
    function showStep(index) {
      activeStep = Math.max(0, Math.min(1, index));
      panels.forEach(function (panel, i) { panel.hidden = i !== activeStep; });
      Array.prototype.forEach.call(stepper.children, function (dot, i) {
        dot.classList.toggle('is-current', i === activeStep);
        dot.classList.toggle('is-done', i < activeStep);
      });
      back.hidden = activeStep === 0;
      next.hidden = activeStep === 1;
      submit.hidden = activeStep !== 1;
      note.textContent = '';
      onboarding.scrollTop = 0;
    }
    function validIdentity() {
      var username = String(form.querySelector('[name="username"]').value || '').trim().toLowerCase();
      var displayName = String(form.querySelector('[name="display_name"]').value || '').trim();
      var country = String(form.querySelector('[name="country"]').value || '').trim();
      if (!displayName || !country || !/^[a-z0-9_]{3,24}$/.test(username)) {
        note.textContent = 'Enter your name and country, and choose a username (3–24 letters, numbers or underscores).';
        return false;
      }
      return true;
    }
    next.addEventListener('click', function () {
      if (!validIdentity()) return;
      showStep(1);
    });
    back.addEventListener('click', function () { showStep(0); });
    showStep(0);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      if (!validIdentity()) { showStep(0); return; }
      var data = new FormData(form);
      var username = String(data.get('username') || '').trim().toLowerCase();
      var displayName = String(data.get('display_name') || '').trim();
      var markets = data.getAll('pip_markets');
      String(data.get('custom_markets') || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean).forEach(function (x) { if (markets.indexOf(x) < 0) markets.push(x); });
      var sessions = data.getAll('pip_sessions');
      var reasons = data.getAll('pip_reasons');
      var personalReason = String(data.get('motivation_note') || '').trim();
      submit.disabled = true; savingOnboarding = true; note.textContent = 'Saving your PIPBOOK profile…';
      try {
        var metaUpdate = await api.auth.updateUser({ data: {
          preferred_sessions: sessions,
          motivation_reasons: reasons,
          motivation_note: personalReason
        }});
        if (metaUpdate.error) throw metaUpdate.error;
        var payload = {
          display_name: displayName, username: username,
          country: String(data.get('country') || '').trim(),
          preferred_markets: markets.slice(0, 24),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          onboarding_completed: true, updated_at: new Date().toISOString()
        };
        var saved = await api.from('profiles').update(payload).eq('id', user.id).select('*').single();
        if (saved.error) throw saved.error;
        cachedProfile = saved.data;
        savingOnboarding = false;
        var updatedUser = metaUpdate.data && metaUpdate.data.user ? metaUpdate.data.user : user;
        buildWelcomeScreen(updatedUser, reasons, personalReason);
      } catch (error) {
        savingOnboarding = false;
        note.textContent = error && error.code === '23505' ? 'That username is already taken. Try another.' : (error.message || 'Could not save your profile. Please try again.');
        submit.disabled = false;
      }
    });
    card.appendChild(form); onboarding.appendChild(card);
  }
  function buildWelcomeScreen(user, reasons, personalReason) {
    showingWelcome = true;
    onboarding.textContent = '';
    var card = el('div', { class: 'profile-card pipbook-welcome-card' });
    card.appendChild(el('span', { class: 'brand-mark' }, 'P'));
    card.appendChild(el('p', { class: 'eyebrow' }, 'YOUR JOURNEY STARTS HERE'));
    card.appendChild(el('h2', {}, 'Welcome to PIPBOOK, ' + ((cachedProfile && cachedProfile.display_name) || 'trader') + '.'));
    card.appendChild(el('p', { class: 'profile-intro' }, 'You started this journey for a reason. Keep it close, especially on the days that test your patience.'));
    if (reasons && reasons.length) card.appendChild(el('div', { class: 'welcome-reasons' }, reasons.join(' · ')));
    if (personalReason) card.appendChild(el('blockquote', { class: 'welcome-quote' }, '“' + personalReason + '”'));
    else card.appendChild(el('blockquote', { class: 'welcome-quote' }, 'Your trading journey, documented. Your progress, understood.'));
    var enter = el('button', { class: 'btn btn-primary welcome-enter', type: 'button' }, 'Enter My Dashboard');
    enter.addEventListener('click', function () {
      showingWelcome = false;
      onboarding.hidden = true;
      home.hidden = true;
      document.body.classList.remove('profile-required');
      document.querySelector('.wrap').hidden = false;
      document.getElementById('fab').hidden = false;
      if (location.hash !== '#dashboard') location.hash = '#dashboard';
      else window.dispatchEvent(new Event('hashchange'));
    });
    card.appendChild(enter);
    onboarding.appendChild(card);
  }
  async function handleSession(session) {
    var nextUser = session && session.user ? session.user : null;
    if ((savingOnboarding || showingWelcome) && currentUser && nextUser && currentUser.id === nextUser.id) { currentUser = nextUser; return; }
    currentUser = nextUser;
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
      grid.appendChild(field('Name', 'display_name', 'text', p.display_name || ''));
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
      card.appendChild(el('p', { class: 'profile-message' }, 'Signed in as ' + (currentUser.email || 'your account')));
      var signout = el('button', { class: 'btn', type: 'button' }, 'Sign out');
      signout.addEventListener('click', async function () {
        signout.disabled = true;
        var result = await api.auth.signOut();
        if (result.error) { signout.disabled = false; msg.textContent = result.error.message; }
      });
      card.appendChild(form);

      var passwordCard = el('section', { class: 'password-card' });
      var passwordToggle = el('button', { class: 'btn', type: 'button', 'aria-expanded': 'false' }, 'Change password');
      var passwordForm = el('form', { class: 'profile-form' });
      passwordForm.hidden = true;
      passwordCard.appendChild(passwordToggle);
      var passwordIntro = el('p', { class: 'profile-intro' }, 'Enter your current password and choose a new one.');
      passwordIntro.hidden = true;
      passwordCard.appendChild(passwordIntro);
      var passwordGrid = el('div', { class: 'auth-fields' });
      passwordGrid.appendChild(field('Current password', 'current_password', 'password', '', 'Enter your current password'));
      passwordGrid.appendChild(field('New password', 'new_password', 'password', '', 'At least 8 characters'));
      passwordForm.appendChild(passwordGrid);
      var passwordMsg = el('p', { class: 'profile-message', role: 'status' });
      var passwordSave = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Save new password');
      passwordForm.appendChild(passwordMsg);
      passwordForm.appendChild(passwordSave);
      passwordToggle.addEventListener('click', function () {
        var opening = passwordForm.hidden;
        passwordForm.hidden = !opening;
        passwordIntro.hidden = !opening;
        passwordToggle.setAttribute('aria-expanded', String(opening));
        passwordToggle.textContent = opening ? 'Cancel' : 'Change password';
        if (opening) passwordForm.querySelector('[name="current_password"]').focus();
        else { passwordForm.reset(); passwordMsg.textContent = ''; }
      });
      passwordForm.addEventListener('submit', async function (e) {
        e.preventDefault();
        var currentPassword = passwordForm.querySelector('[name="current_password"]').value;
        var nextPassword = passwordForm.querySelector('[name="new_password"]').value;
        if (!currentPassword) { passwordMsg.textContent = 'Enter your current password to verify your account.'; return; }
        if (nextPassword.length < 8) { passwordMsg.textContent = 'Use a password with at least 8 characters.'; return; }
        if (nextPassword === currentPassword) { passwordMsg.textContent = 'Choose a password different from your current one.'; return; }
        passwordSave.disabled = true; passwordMsg.textContent = 'Updating password…';
        try {
          var changed = await api.auth.updateUser({ password: nextPassword, current_password: currentPassword });
          if (changed.error) throw changed.error;
          passwordForm.reset();
          passwordForm.hidden = true;
          passwordIntro.hidden = true;
          passwordToggle.setAttribute('aria-expanded', 'false');
          passwordToggle.textContent = 'Change password';
          passwordMsg.textContent = 'Password updated successfully. Your account remains signed in.';
        } catch (error) {
          passwordMsg.textContent = 'Could not update password: ' + (error && error.message ? error.message : 'Please try again.');
        } finally { passwordSave.disabled = false; }
      });
      card.appendChild(passwordCard);
      card.appendChild(signout); box.appendChild(card);
    }
  };
  if (!api || !api.auth) return;
  api.auth.onAuthStateChange(function (_event, session) { setTimeout(function () { handleSession(session); }, 0); });
  api.auth.getSession().then(function (r) { if (!r.error) handleSession(r.data.session); });
})();