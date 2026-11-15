/* Maxi Trades Journal — Supabase data adapter
   Shared adapter implementation for the app and isolated live tests.
   This file defines the adapter only; it does not authenticate, load data,
   migrate guest records, or activate cloud sync by itself. */
(function (global) {
  'use strict';
  function createCloudAdapter(api, userId, helpers) {
    if (!api || !userId) throw new Error('A signed-in Supabase user is required.');
    var normPb = helpers.normPb, normTrade = helpers.normTrade;
    var normDay = helpers.normDay, normSettings = helpers.normSettings;
    var num = helpers.num;
      if (!api || !userId) throw new Error('A signed-in Supabase user is required.');
      var normPb = helpers.normPb, normTrade = helpers.normTrade;
      var normDay = helpers.normDay, normSettings = helpers.normSettings;
      var num = helpers.num;
      var ids = { playbooks: {} };
  
      function own(table) { return api.from(table).select('*').eq('user_id', userId); }
      async function legacyRow(table, legacyId) {
        var key = String(legacyId);
        var found = await own(table).eq('legacy_id', key).maybeSingle();
        if (found.error || found.data) return found;
        // Older cloud rows may predate legacy_id and use their database UUID
        // as the journal ID. Resolve those rows by primary key without sending
        // arbitrary non-UUID journal IDs to a UUID column.
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
          return own(table).eq('id', key).maybeSingle();
        }
        return found;
      }
      function jsonArray(value) { return Array.isArray(value) ? value : []; }
  
      function fromCloudPlaybook(row) {
        ids.playbooks[String(row.legacy_id || row.id)] = row.id;
        return normPb({
          id: String(row.legacy_id || row.id), name: row.name,
          description: row.description, rules: jsonArray(row.rules),
          example: row.is_example, createdAt: row.created_at ? Date.parse(row.created_at) : 0
        });
      }
      function fromCloudTrade(row) {
        var extra = row.notes && typeof row.notes === 'object' ? row.notes : {};
        return normTrade({
          id: String(row.legacy_id || row.id), date: row.trade_date,
          time: row.trade_time || '', asset: row.instrument_symbol,
          side: String(row.side).toLowerCase() === 'short' ? 'sell' : row.side,
          entry: row.entry_price, sl: row.stop_loss, tp: row.take_profit,
          exit: row.exit_price, pnl: row.net_pnl, r: row.r_multiple,
          risk: row.risk_amount, playbook: row.playbook_id || extra.playbook_legacy_id || '',
          emotion: row.emotion, followed: row.followed_rules,
          misses: jsonArray(row.misses), mistakes: jsonArray(row.mistakes),
          lesson: row.lesson, shot: extra.legacy_shot || '',
          shotId: extra.legacy_shot_id || '', example: row.is_example,
          createdAt: row.created_at ? Date.parse(row.created_at) : 0
        });
      }
      function fromCloudDay(row) {
        return normDay({
          id: String(row.journal_date), date: row.journal_date,
          plan: row.plan, review: row.review, mood: row.mood, example: row.is_example
        });
      }
      function toCloudTrade(t) {
        var pbCloudId = t.playbook ? ids.playbooks[t.playbook] : null;
        return {
          user_id: userId, legacy_id: String(t.id),
          instrument_symbol: t.asset || 'UNKNOWN', trade_date: t.date,
          trade_time: t.time || null, side: t.side === 'sell' ? 'sell' : 'buy',
          status: 'closed', entry_price: num(t.entry), stop_loss: num(t.sl),
          take_profit: num(t.tp), exit_price: num(t.exit),
          net_pnl: Number(t.pnl) || 0, risk_amount: t.risk,
          r_multiple: t.r, playbook_id: pbCloudId || null,
          emotion: t.emotion || null, followed_rules: !!t.followed,
          misses: jsonArray(t.misses), mistakes: jsonArray(t.mistakes),
          lesson: t.lesson || null, is_example: !!t.example,
          notes: { legacy_shot: t.shot || '', legacy_shot_id: t.shotId || '',
            playbook_legacy_id: t.playbook || '' }
        };
      }
      async function saveLegacyRow(table, legacyId, payload) {
        var found = await legacyRow(table, legacyId);
        if (found.error) throw found.error;
        if (found.data) {
          if (table === 'trades' && payload.notes && typeof payload.notes === 'object') {
            var existingNotes = found.data.notes && typeof found.data.notes === 'object' ? found.data.notes : {};
            payload.notes = Object.assign({}, existingNotes, payload.notes);
          }
          var updated = await api.from(table).update(payload).eq('id', found.data.id).eq('user_id', userId);
          if (updated.error) throw updated.error;
          return found.data.id;
        }
        var inserted = await api.from(table).insert(payload).select('id').single();
        if (inserted.error) throw inserted.error;
        return inserted.data.id;
      }
  
      return {
        async load() {
          var results = await Promise.all([
            own('playbooks').order('created_at', { ascending: true }),
            own('trades').order('trade_date', { ascending: true }),
            own('daily_journals').order('journal_date', { ascending: true }),
            api.from('user_settings').select('*').eq('user_id', userId).maybeSingle()
          ]);
          results.forEach(function (r) { if (r.error) throw r.error; });
          var pbs = (results[0].data || []).map(fromCloudPlaybook);
          var trs = (results[1].data || []).map(fromCloudTrade);
          // Resolve playbook UUIDs to the journal's stable legacy IDs.
          (results[0].data || []).forEach(function (p) { ids.playbooks[String(p.id)] = p.id; });
          trs.forEach(function (t) {
            if (!t.playbook) return;
            var pbRow = (results[0].data || []).find(function (p) {
              return p.id === t.playbook || String(p.legacy_id || p.id) === t.playbook;
            });
            // Keep an unresolved legacy reference so the UI can label it
            // "Deleted playbook" instead of silently erasing the trade history.
            if (pbRow) t.playbook = String(pbRow.legacy_id || pbRow.id);
          });
          var settingsRow = results[3].data;
          var prefs = settingsRow && settingsRow.preferences && typeof settingsRow.preferences === 'object' ? settingsRow.preferences : {};
          return {
            trades: trs, playbooks: pbs,
            days: (results[2].data || []).map(fromCloudDay),
            settings: normSettings({
              balance: settingsRow ? settingsRow.default_starting_balance : null,
              currency: settingsRow ? settingsRow.default_currency : '',
              riskPct: prefs.riskPct, monthlyTarget: prefs.monthlyTarget,
              maxTradesDay: prefs.maxTradesDay, dailyLoss: prefs.dailyLoss,
              example: prefs.example
            })
          };
        },
        async put(kind, obj) {
          if (kind === 'playbooks') {
            var pb = await saveLegacyRow('playbooks', obj.id, {
              user_id: userId, legacy_id: String(obj.id), name: obj.name,
              description: obj.description || '', rules: jsonArray(obj.rules),
              is_example: !!obj.example
            });
            ids.playbooks[String(obj.id)] = pb;
            return;
          }
          if (kind === 'trades') {
            // Resolve the playbook reference before persisting its foreign key.
            if (obj.playbook && !ids.playbooks[obj.playbook]) {
              var p = await legacyRow('playbooks', obj.playbook);
              if (p.error) throw p.error;
              if (p.data) ids.playbooks[obj.playbook] = p.data.id;
            }
            return saveLegacyRow('trades', obj.id, toCloudTrade(obj));
          }
          if (kind === 'days') {
            var existing = await own('daily_journals').eq('journal_date', obj.date || obj.id).is('account_id', null).maybeSingle();
            if (existing.error) throw existing.error;
            var payload = {
              user_id: userId, legacy_id: String(obj.id), journal_date: obj.date || obj.id,
              plan: obj.plan || '', review: obj.review || '', mood: obj.mood,
              is_example: !!obj.example
            };
            var result = existing.data
              ? await api.from('daily_journals').update(payload).eq('id', existing.data.id).eq('user_id', userId)
              : await api.from('daily_journals').insert(payload);
            if (result.error) throw result.error;
            return;
          }
          throw new Error('Unsupported cloud record type: ' + kind);
        },
        async del(kind, id) {
          if (kind === 'playbooks') {
            var playbook = await legacyRow('playbooks', id);
            if (playbook.error) throw playbook.error;
            if (!playbook.data) return;
            var linked = await api.from('trades').select('id,notes')
              .eq('user_id', userId).eq('playbook_id', playbook.data.id);
            if (linked.error) throw linked.error;
            // The database protects referenced playbooks with ON DELETE RESTRICT.
            // Detach each trade but retain its legacy label for historical display.
            for (var i = 0; i < (linked.data || []).length; i++) {
              var trade = linked.data[i];
              var notes = trade.notes && typeof trade.notes === 'object' ? trade.notes : {};
              notes.playbook_legacy_id = String(id);
              var detached = await api.from('trades').update({
                playbook_id: null, notes: notes
              }).eq('user_id', userId).eq('id', trade.id);
              if (detached.error) throw detached.error;
            }
            var removed = await api.from('playbooks').delete()
              .eq('user_id', userId).eq('id', playbook.data.id);
            if (removed.error) throw removed.error;
            return;
          }
          var table = kind === 'trades' ? 'trades' : kind === 'days' ? 'daily_journals' : null;
          if (!table) throw new Error('Unsupported cloud record type: ' + kind);
          if (kind === 'days') {
            var dayRows = await own(table).eq('journal_date', String(id)).is('account_id', null).select('id');
            if (dayRows.error) throw dayRows.error;
            var dayIds = (dayRows.data || []).map(function (row) { return row.id; });
            if (!dayIds.length) return;
            var dayDelete = await api.from(table).delete().eq('user_id', userId).in('id', dayIds);
            if (dayDelete.error) throw dayDelete.error;
            return;
          }
          var found = await legacyRow(table, id);
          if (found.error) throw found.error;
          if (!found.data) return;
          var result = await api.from(table).delete().eq('user_id', userId).eq('id', found.data.id);
          if (result.error) throw result.error;
        },
        async saveSettings(settings) {
          var prefs = {
            riskPct: settings.riskPct, monthlyTarget: settings.monthlyTarget,
            maxTradesDay: settings.maxTradesDay, dailyLoss: settings.dailyLoss,
            example: !!settings.example
          };
          // Signup creates this row. Merge preferences and update only fields
          // owned by this app so unrelated preferences and timezone are preserved.
          var current = await api.from('user_settings').select('preferences')
            .eq('user_id', userId).maybeSingle();
          if (current.error) throw current.error;
          if (!current.data) throw new Error('Your account settings row was not found. Please sign out and sign in again.');
          var existingPrefs = current.data.preferences && typeof current.data.preferences === 'object'
            ? current.data.preferences : {};
          var mergedPrefs = Object.assign({}, existingPrefs, prefs);
          var result = await api.from('user_settings').update({
            default_currency: settings.currency || 'USD',
            default_starting_balance: settings.balance, preferences: mergedPrefs
          }).eq('user_id', userId).select('user_id').maybeSingle();
          if (result.error) throw result.error;
          if (!result.data) throw new Error('Your account settings row was not found. Please sign out and sign in again.');
        }
      };
   
  }
  global.MaxiCloudAdapterFactory = createCloudAdapter;
})(window);
