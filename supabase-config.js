/* Maxi Trades Journal — Supabase public client configuration.
   Only use the project's publishable key here. NEVER put a secret/service_role key in frontend code. */
window.MAXI_SUPABASE_CONFIG = Object.freeze({
  url: 'https://dnhpoimokvmpwvlvtqrh.supabase.co',
  publishableKey: 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE'
});

(function () {
  'use strict';
  var cfg = window.MAXI_SUPABASE_CONFIG;
  if (!window.supabase || !cfg || !cfg.url || !cfg.publishableKey ||
      cfg.publishableKey === 'PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE') {
    console.warn('[Maxi Trades Journal] Supabase client not initialized. Add the publishable key in supabase-config.js.');
    return;
  }
  window.maxiSupabase = window.supabase.createClient(cfg.url, cfg.publishableKey);
  console.info('[Maxi Trades Journal] Supabase client initialized.');
})();
