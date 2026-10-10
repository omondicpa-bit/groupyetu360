// GroupYetu360 - js/env.js
// Which backend this copy of the app talks to, chosen by the web address.
//   app.groupyetu.org (and anything else)  -> LIVE   (real groups, real money)
//   staging.groupyetu.org, localhost, *.pages.dev previews -> STAGING
// STAGING must never fall back to LIVE: if its settings are missing, the app
// stops with a message instead of touching real data.
(function () {
  const LIVE = {
    name: 'live',
    supabaseUrl: 'https://eengldzvvgplgzvbutal.supabase.co',
    supabaseKey: 'sb_publishable_YMCrMAvAeQEhVV3dC-8jjw_pVzFDyPH',
  };
  const STAGING = {
    name: 'staging',
    supabaseUrl: 'https://zrjctzauufromazxrpvb.supabase.co',   // groupyetu360-staging
    supabaseKey: 'sb_publishable_P3HhidhXpV4p9sBZlr02wg_69Em0csz',
  };
  const host = (location.hostname || '').toLowerCase();
  const isStaging = host.startsWith('staging.') || host === 'localhost' || host === '127.0.0.1' || host.endsWith('.pages.dev');
  const env = isStaging ? STAGING : LIVE;
  if (isStaging && (!env.supabaseUrl || !env.supabaseKey)) {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.innerHTML = '<div style="font-family:system-ui;padding:40px;max-width:560px;margin:auto"><h2>Staging is not connected yet</h2><p>This is the GroupYetu360 test site. Its own test database has not been set up, so it will not start (it never uses live data).</p></div>';
    });
    throw new Error('GY360 staging: no staging backend configured');
  }
  window.GY_ENV = env;
  if (isStaging) {
    document.addEventListener('DOMContentLoaded', () => {
      const b = document.createElement('div');
      b.textContent = 'STAGING · test data only';
      b.setAttribute('style', 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:99999;background:#c49a30;color:#16181a;font:800 11px/1 system-ui;padding:5px 12px;border-radius:0 0 10px 10px;letter-spacing:.06em;pointer-events:none');
      document.body.appendChild(b);
    });
  }
})();
