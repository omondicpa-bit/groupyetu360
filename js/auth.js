// GroupYetu360 — js/auth.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── SUPABASE ──
const SUPABASE_URL = 'https://eengldzvvgplgzvbutal.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YMCrMAvAeQEhVV3dC-8jjw_pVzFDyPH';
const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── STATE ──
let currentUser = null;
let currentProfile = null;
let currentOrg = null;
let allMembers = [];
let allContribTypes = [];
let allProjects = [];
let selectedMeetingId = null;
let attState = {};

// ── INIT ──
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadProfileAndOrg();
  } else {
    showAuthScreen();
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (!session) return;
      // Avoid double-loading if we already have a matching session
      if (event === 'INITIAL_SESSION' && currentProfile) return;
      currentUser = session.user;
      try {
        await loadProfileAndOrg();
      } catch(e) {
        console.error('[GY360] loadProfileAndOrg error:', e);
        // Don't sign out on error — just show auth screen
        showAuthScreen();
      }
    } else if (event === 'SIGNED_OUT') {
      showAuthScreen();
    }
  });
}

async function loadProfileAndOrg() {
  // If pending org from org code login, use that profile
  let profile;
  try {
    if (_pendingOrgId) {
      const { data: p } = await sb.from('profiles').select('*')
        .eq('id', currentUser.id).eq('org_id', _pendingOrgId).maybeSingle();
      profile = p;
      _pendingOrgId = null;
    }
    if (!profile) {
      const { data: p } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
      profile = p;
    }
  } catch(e) {
    console.error('[GY360] Profile fetch error:', e);
    showAuthScreen();
    return;
  }
  currentProfile = profile;
  if (!profile) { showAuthScreen(); return; }

  // Superadmin
  if (profile.role === 'superadmin') {
    currentOrg = { name: 'EPH Technologies', reg_number: 'Platform Admin', plan: 'superadmin' };
    showApp();
    return;
  }

  // Pending approval — show waiting screen
  if (profile.role === 'pending') {
    showPendingScreen();
    return;
  }

  // Declined — show message and sign out
  if (profile.role === 'declined') {
    handleDeclinedRole();
    return;
  }

  // Check how many orgs this user belongs to
  let userOrgCount = 0;
  try {
    const { data: uoRows } = await sb.from('user_orgs')
      .select('org_id').eq('user_id', currentUser.id);
    userOrgCount = uoRows?.length || 0;
    if (uoRows?.length) {
      _userOrgs = []; // will be populated in showOrgPicker
    }
  } catch(e) { /* user_orgs table may not exist yet */ }

  if (!profile.org_id || userOrgCount > 1) {
    // Multiple orgs or no org — show picker
    showOrgPicker();
    return;
  }

  // Single org — go straight in
  const { data: org } = await sb.from('organisations').select('*').eq('id', profile.org_id).single();
  currentOrg = org;
  // Ensure user_orgs entry exists
  try {
    await sb.from('user_orgs').upsert({
      user_id: currentUser.id, org_id: org.id, role: profile.role
    });
    _userOrgs = [{ ...org, _role: profile.role }];
  } catch(e) {}
  showApp();
  buildOrgSwitcherDropdown();
}

// ── AUTH SCREEN ──
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-screen').classList.remove('visible');
  document.getElementById('auth-step-1').style.display = 'block';
  document.getElementById('auth-step-2').style.display = 'none';
}

function showPendingScreen() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.remove('visible');
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  const idx = {login:0, join:1, register:2, forgot:0};
  document.querySelectorAll('.auth-tab')[idx[tab]]?.classList.add('active');
  document.getElementById('auth-'+tab)?.classList.add('active');
  const headings = {
    login:    { h:'Welcome back',        s:'Sign in to manage your group' },
    join:     { h:'Join your group',     s:'Request access to your organisation on GroupYetu360' },
    register: { h:'Get started free',    s:'Set up your chama or investment group in minutes' },
    forgot:   { h:'Reset your password', s:"We'll send you a secure reset link" }
  };
  const hd = headings[tab];
  if (hd) {
    const hEl = document.getElementById('auth-form-heading');
    const sEl = document.getElementById('auth-form-sub');
    if (hEl) hEl.textContent = hd.h;
    if (sEl) sEl.textContent = hd.s;
  }
}

// ── JOIN ORG FLOW ──
let joinSelectedOrgId = null;

async function searchOrgsForJoin(q) {
  const resultsEl = document.getElementById('join-org-results');
  if (q.length < 2) { resultsEl.innerHTML = ''; return; }
  resultsEl.innerHTML = '<div style="font-size:.75rem;color:var(--ink-faint);padding:.5rem">Searching…</div>';
  try {
    // Use REST API directly with anon key — no auth required since orgs are public
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/organisations?select=id,name,reg_number,plan,status&name=ilike.*' + encodeURIComponent(q) + '*&status=eq.active&limit=5',
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } }
    );
    const data = await res.json();
    if (!data?.length) {
      resultsEl.innerHTML = '<div style="font-size:.78rem;color:var(--ink-faint);padding:.5rem">No organisations found. Try a different name.</div>';
      return;
    }
    resultsEl.innerHTML = '<div class="org-select-list">' + data.map(o => `
      <div class="org-option" onclick="selectJoinOrg('${o.id}','${o.name.replace(/'/g,"&apos;")}')">
        <div class="org-option-name">${o.name}</div>
        <div class="org-option-meta">${o.reg_number||''} · ${o.plan} plan</div>
      </div>`).join('') + '</div>';
  } catch(e) {
    resultsEl.innerHTML = '<div style="font-size:.78rem;color:var(--danger);padding:.5rem">Search failed. Please try again.</div>';
  }
}

function selectJoinOrg(id, name) {
  joinSelectedOrgId = id;
  document.getElementById('join-org-results').innerHTML = '';
  document.getElementById('join-search').value = name;
  document.getElementById('join-org-selected').style.display = 'block';
  document.getElementById('join-org-selected-name').textContent = name;
}

async function joinOrg() {
  const name = document.getElementById('join-name').value.trim();
  const phone = document.getElementById('join-phone').value.trim();
  const email = document.getElementById('join-email').value.trim();
  const password = document.getElementById('join-password').value;
  const errEl = document.getElementById('join-error');
  const sucEl = document.getElementById('join-success');
  errEl.classList.remove('show'); sucEl.classList.remove('show');
  if (!joinSelectedOrgId) { errEl.textContent='Please search and select your organisation'; errEl.classList.add('show'); return; }
  if (!name||!email||!password) { errEl.textContent='Please fill all fields'; errEl.classList.add('show'); return; }
  if (password.length < 6) { errEl.textContent='Password must be at least 6 characters'; errEl.classList.add('show'); return; }

  // Create auth account
  const { data: authData, error: authErr } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name } }
  });
  if (authErr) { errEl.textContent = authErr.message; errEl.classList.add('show'); return; }

  // Create profile with pending role
  await sb.from('profiles').upsert({
    id: authData.user.id,
    org_id: joinSelectedOrgId,
    role: 'pending',
    full_name: name,
    phone
  });

  // Add to user_orgs as pending
  try {
    await sb.from('user_orgs').upsert({
      user_id: authData.user.id, org_id: joinSelectedOrgId, role: 'pending'
    });
  } catch(e) {}

  // Create pending member request
  await sb.from('pending_members').insert({
    org_id: joinSelectedOrgId,
    user_id: authData.user.id,
    full_name: name,
    phone,
    email,
    status: 'pending'
  });

  sucEl.textContent = 'Request submitted! Your group admin will review and approve your access. You will be notified once approved.';
  sucEl.classList.add('show');

  // Clear form
  ['join-name','join-phone','join-email','join-password','join-search'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  joinSelectedOrgId = null;
  document.getElementById('join-org-selected').style.display = 'none';
}

async function sendPasswordReset() {
  const email = document.getElementById('forgot-email')?.value?.trim();
  const errEl = document.getElementById('forgot-error');
  const sucEl = document.getElementById('forgot-success');
  if (errEl) errEl.classList.remove('show');
  if (sucEl) sucEl.classList.remove('show');
  if (!email) {
    if (errEl) { errEl.textContent='Please enter your email'; errEl.classList.add('show'); }
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://groupyetu.org/'
  });
  if (error) {
    if (errEl) { errEl.textContent = error.message; errEl.classList.add('show'); }
    return;
  }
  if (sucEl) { sucEl.textContent = 'Reset link sent to ' + email + '. Check your inbox.'; sucEl.classList.add('show'); }
}

function showForgotPassword() {
  switchAuthTab('forgot');
}

// ── 2FA STATE ──
let _pendingOrgId = null;
let _2faCode = null;
let _2faProfile = null;
let _2faSession = null;

async function signInWithGoogle() {
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { access_type: 'offline', prompt: 'consent' }
      }
    });
    if (error) {
      const errEl = document.getElementById('login-error');
      if (errEl) { errEl.textContent = error.message; errEl.classList.add('show'); }
      toast('Google sign-in error: ' + error.message);
    }
    // Supabase redirects the browser — no further code needed here
  } catch(e) {
    toast('Google sign-in unavailable. Please enable Google OAuth in your Supabase dashboard.');
    console.error('Google OAuth error:', e);
  }
}

async function signIn() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const orgCode = document.getElementById('login-org-code')?.value?.trim().toUpperCase();
  const errEl = document.getElementById('login-error');
  errEl.classList.remove('show');
  if (!email || !password) { errEl.textContent='Please enter email and password'; errEl.classList.add('show'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { errEl.textContent = error.message; errEl.classList.add('show'); return; }

  // If org code provided, verify and switch to that org
  if (orgCode) {
    const { data: org } = await sb.from('organisations')
      .select('id,name').eq('org_code', orgCode).maybeSingle();
    if (!org) {
      await sb.auth.signOut();
      errEl.textContent = `Organisation code "${orgCode}" not found. Check the code from your admin.`;
      errEl.classList.add('show');
      return;
    }
    // Check if user has an approved profile in this org
    const { data: orgProfile } = await sb.from('profiles')
      .select('*').eq('id', data.user.id).eq('org_id', org.id).maybeSingle();
    if (!orgProfile) {
      // Check if they have a profile in ANY org (admin of another org trying member access)
      await sb.auth.signOut();
      errEl.textContent = `You don't have access to ${org.name}. Contact the group admin to be added.`;
      errEl.classList.add('show');
      return;
    }
    if (orgProfile.role === 'pending') {
      await sb.auth.signOut();
      errEl.textContent = `Your access to ${org.name} is pending admin approval.`;
      errEl.classList.add('show');
      return;
    }
    // Force this org context
    _pendingOrgId = org.id;
  }

  // Check if this user needs 2FA (admin roles)
  const { data: profile } = await sb.from('profiles').select('role,full_name,org_id').eq('id', data.user.id).maybeSingle();

  const needs2FA = ['admin','treasurer','officer'].includes(profile?.role);
  // Superadmin bypasses 2FA — OTP delivery not yet configured
  // Regular admins only trigger 2FA if their org has it enabled

  if (needs2FA) {
    let twoFAEnabled = false;
    if (profile?.org_id) {
      const { data: org } = await sb.from('organisations').select('two_fa_enabled').eq('id', profile.org_id).maybeSingle();
      twoFAEnabled = org?.two_fa_enabled || false;
    }

    if (twoFAEnabled) {
      // Sign out temporarily, show 2FA screen
      _2faSession = data;
      _2faProfile = profile;
      await sb.auth.signOut();

      // Generate and send OTP via Supabase magic link (use email OTP)
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      _2faCode = otp;

      // Send OTP via SMS if phone available, or show in toast for now
      const { data: fullProfile } = await sb.from('profiles').select('phone').eq('id', data.user.id).maybeSingle();

      // Log OTP (in production this goes via SMS/email)
      console.log('[2FA] OTP for', email, ':', otp);

      // Try to send via SMS
      try {
        const { data: ps } = await sb.from('platform_settings').select('at_api_key,at_username').maybeSingle();
        if (ps?.at_api_key && fullProfile?.phone) {
          await fetch('https://eengldzvvgplgzvbutal.supabase.co/functions/v1/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
            body: JSON.stringify({
              username: ps.at_username || 'sandbox',
              apiKey: ps.at_api_key,
              to: [formatPhone(fullProfile.phone)],
              message: `Your GroupYetu360 verification code is: ${otp}. Valid for 5 minutes.`
            })
          });
        }
      } catch(e) { console.log('2FA SMS failed:', e); }

      // Show 2FA screen
      document.getElementById('auth-step-1').style.display = 'none';
      document.getElementById('auth-step-2fa').style.display = 'block';
      document.getElementById('2fa-sub').textContent =
        `Code sent to ${fullProfile?.phone ? '0***' + fullProfile.phone.slice(-3) : email}`;
      document.getElementById('2fa-code').value = '';
      document.getElementById('2fa-code').focus();

      // Set 5 minute expiry
      setTimeout(() => { _2faCode = null; }, 5 * 60 * 1000);
      return;
    }
  }
  // No 2FA needed - proceed normally (onAuthStateChange handles the rest)
}

async function verify2FA() {
  const entered = document.getElementById('2fa-code').value.trim();
  const errEl = document.getElementById('2fa-error');
  errEl.classList.remove('show');

  if (!entered || entered.length !== 6) {
    errEl.textContent = 'Please enter the 6-digit code';
    errEl.classList.add('show');
    return;
  }

  if (!_2faCode) {
    errEl.textContent = 'Code expired. Please sign in again.';
    errEl.classList.add('show');
    return;
  }

  if (entered !== _2faCode) {
    errEl.textContent = 'Incorrect code. Please try again.';
    errEl.classList.add('show');
    return;
  }

  // Code correct — sign back in
  const loginEmail = document.getElementById('login-email').value.trim();
  const loginPass = document.getElementById('login-password').value;

  const { error } = await sb.auth.signInWithPassword({ email: loginEmail, password: loginPass });
  if (error) {
    errEl.textContent = 'Could not sign in: ' + error.message;
    errEl.classList.add('show');
    return;
  }

  // Reset 2FA state
  _2faCode = null;
  _2faProfile = null;
  _2faSession = null;

  // Hide 2FA screen
  document.getElementById('auth-step-2fa').style.display = 'none';
  document.getElementById('auth-step-1').style.display = 'block';
}

async function resend2FACode() {
  _2faCode = null;
  document.getElementById('2fa-success').textContent = 'Signing in again to resend code...';
  document.getElementById('2fa-success').classList.add('show');
  document.getElementById('auth-step-2fa').style.display = 'none';
  document.getElementById('auth-step-1').style.display = 'block';
  toast('Please sign in again to get a new code');
}

function cancel2FA() {
  _2faCode = null;
  _2faProfile = null;
  _2faSession = null;
  document.getElementById('auth-step-2fa').style.display = 'none';
  document.getElementById('auth-step-1').style.display = 'block';
}

// signIn defined above

async function registerOrg() {
  const orgName = document.getElementById('reg-org-name').value.trim();
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const plan = document.getElementById('reg-plan').value;
  const errEl = document.getElementById('register-error');
  const sucEl = document.getElementById('register-success');
  errEl.classList.remove('show'); sucEl.classList.remove('show');
  if (!orgName||!name||!email||!password) { errEl.textContent='Please fill all fields'; errEl.classList.add('show'); return; }
  if (password.length < 6) { errEl.textContent='Password must be at least 6 characters'; errEl.classList.add('show'); return; }

  // Create auth user
  const { data: authData, error: authErr } = await sb.auth.signUp({ email, password, options: { data: { full_name: name } } });
  if (authErr) { errEl.textContent = authErr.message; errEl.classList.add('show'); return; }

  // Create organisation
  // Generate unique org code: GY + 4 random chars
  const orgCode = 'GY' + Math.random().toString(36).toUpperCase().slice(2,6);

  const { data: org, error: orgErr } = await sb.from('organisations')
    .insert({ name: orgName, plan, status: 'active', org_code: orgCode })
    .select().single();
  if (orgErr) { errEl.textContent = 'Error creating organisation: ' + orgErr.message; errEl.classList.add('show'); return; }

  // Set profile — admin role, linked to org directly
  const { error: profileErr } = await sb.from('profiles').upsert({
    id: authData.user.id,
    org_id: org.id,
    role: 'admin',
    full_name: name,
    phone
  });
  if (profileErr) console.error('Profile error:', profileErr);

  // Add to user_orgs junction table
  try {
    await sb.from('user_orgs').upsert({
      user_id: authData.user.id, org_id: org.id, role: 'admin'
    });
  } catch(e) { console.log('user_orgs upsert:', e.message); }

  sucEl.textContent = 'Organisation created! Signing you in…';
  sucEl.classList.add('show');

  // Sign in automatically
  setTimeout(async () => {
    const { error: signInErr } = await sb.auth.signInWithPassword({ email, password });
    if (signInErr) {
      errEl.textContent = 'Created but could not sign in: ' + signInErr.message;
      errEl.classList.add('show');
    }
  }, 1200);
}

/* ════════════════════════════════════════════════
   MULTI-ORG WORKSPACE SYSTEM
════════════════════════════════════════════════ */

let _userOrgs = []; // all orgs this user belongs to
let currentOrgRole = 'member'; // role in the CURRENT org (from user_orgs, not profiles)

async function loadUserOrgs() {
  if (!currentUser?.id) return [];
  // Try user_orgs table first
  try {
    const { data: rows } = await sb.from('user_orgs')
      .select('org_id, role, organisations(*)')
      .eq('user_id', currentUser.id);
    if (rows?.length) {
      _userOrgs = rows.map(r => ({ ...r.organisations, _role: r.role }));
      return _userOrgs;
    }
  } catch(e) { /* table may not exist yet */ }

  // Fallback: use profile's org_id
  if (currentProfile?.org_id) {
    const { data: org } = await sb.from('organisations').select('*').eq('id', currentProfile.org_id).single();
    if (org) {
      _userOrgs = [{ ...org, _role: currentProfile.role }];
      return _userOrgs;
    }
  }
  return [];
}

async function showOrgPicker() {
  // Hide all screens, show picker
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.remove('visible');
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'flex';

  // Set user name
  const nameEl = document.getElementById('org-picker-user-name');
  if (nameEl) nameEl.textContent = currentProfile?.full_name || currentUser?.email || 'there';

  // Load orgs
  const orgs = await loadUserOrgs();
  const listEl = document.getElementById('org-picker-list');
  if (!listEl) return;

  if (!orgs.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:2rem;color:rgba(255,255,255,.5)">
      <div style="font-size:1.5rem;margin-bottom:.5rem">🏛</div>
      <div style="font-size:.82rem">You're not part of any organisation yet.</div>
      <div style="font-size:.75rem;margin-top:.35rem">Register a new one below.</div>
    </div>`;
    return;
  }

  listEl.innerHTML = orgs.map((org, i) => {
    const initials = org.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const roleClass = ['admin','officer','treasurer'].includes(org._role) ? 'admin' : 'member';
    const roleLabel = org._role?.charAt(0).toUpperCase() + org._role?.slice(1) || 'Member';
    const plan = (org.plan||'starter').toUpperCase();
    return `<div class="org-picker-item" onclick="selectOrg('${org.id}')" style="animation-delay:${i*0.06}s">
      <div class="opi-icon ${roleClass === 'admin' ? '' : 'teal'}">${initials}</div>
      <div style="flex:1;min-width:0">
        <div class="opi-name">${org.name}</div>
        <div class="opi-meta">
          <span>${org.org_code || org.reg_number || '—'}</span>
          <span>·</span>
          <span>${plan}</span>
          <span class="opi-role ${roleClass}">${roleLabel}</span>
        </div>
      </div>
      <div class="opi-arrow">›</div>
    </div>`;
  }).join('');
}

async function selectOrg(orgId) {
  // Reset member cache — crucial for multi-org so My Profile/Contributions reload fresh
  window._myMemberId = null;

  // Update active org in profile
  await sb.from('profiles').update({ org_id: orgId }).eq('id', currentUser.id);
  const { data: org } = await sb.from('organisations').select('*').eq('id', orgId).single();
  currentOrg = org;
  const { data: profile } = await sb.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
  currentProfile = profile;

  // Always resolve role from user_orgs for this specific org
  // This prevents admin role from one org bleeding into another org
  currentOrgRole = profile?.role || 'member'; // start with profile role
  try {
    const { data: uoRow } = await sb.from('user_orgs')
      .select('role').eq('user_id', currentUser.id).eq('org_id', orgId).maybeSingle();
    if (uoRow?.role) {
      currentOrgRole = uoRow.role; // override with org-specific role
      // Also patch currentProfile so all existing code reading currentProfile.role works
      if (currentProfile) currentProfile = { ...currentProfile, role: uoRow.role };
    }
  } catch(e) {}

  // Hide picker, show app
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'none';
  showApp();
  buildOrgSwitcherDropdown();
  // Reload financial profile for new org
  try { await loadOrgFinancialProfile(); } catch(e) {}
}

async function switchOrg(orgId) {
  if (orgId === currentOrg?.id) { closeOrgSwitcher(); return; }
  toast('Switching workspace…');
  await selectOrg(orgId);
  showPage('dashboard');
}

function toggleOrgSwitcher() {
  const dd = document.getElementById('org-switcher-dropdown');
  const arrow = document.getElementById('org-switcher-arrow');
  const isOpen = dd?.classList.contains('open');
  if (isOpen) { closeOrgSwitcher(); return; }
  dd?.classList.add('open');
  if (arrow) arrow.style.transform = 'rotate(180deg)';
  buildOrgSwitcherDropdown();
}

function closeOrgSwitcher() {
  const dd = document.getElementById('org-switcher-dropdown');
  const arrow = document.getElementById('org-switcher-arrow');
  dd?.classList.remove('open');
  if (arrow) arrow.style.transform = '';
}

function buildOrgSwitcherDropdown() {
  const dd = document.getElementById('org-switcher-dropdown');
  if (!dd) return;
  const orgs = _userOrgs.filter(o => o.id !== currentOrg?.id);
  let html = '';
  if (orgs.length) {
    html += '<div style="font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:rgba(255,255,255,.3);padding:.2rem .4rem .4rem">Switch to</div>';
    html += orgs.map(o => {
      const initials = o.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
      return `<div class="osd-item" onclick="switchOrg('${o.id}')">
        <div style="width:20px;height:20px;border-radius:4px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:.55rem;font-weight:700;color:#fff;flex-shrink:0">${initials}</div>
        <span>${o.name}</span>
      </div>`;
    }).join('');
    html += '<div style="height:1px;background:rgba(255,255,255,.1);margin:.35rem 0"></div>';
  }
  html += `<div class="osd-item osd-add" onclick="registerAnotherOrg()">＋ Add organisation</div>`;
  html += `<div class="osd-item" onclick="showAllOrgs()">⊞ All workspaces</div>`;
  dd.innerHTML = html;
}

function showAllOrgs() {
  closeOrgSwitcher();
  showOrgPicker();
}

function registerAnotherOrg() {
  closeOrgSwitcher();
  showModal('registerNewOrg');
}

function showOrgPickerRegister() {
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'none';
  showModal('registerNewOrg');
}

async function registerNewOrg() {
  const name = document.getElementById('new-org-name').value.trim();
  const plan = document.getElementById('new-org-plan').value;
  const role = document.getElementById('new-org-role').value;
  const errEl = document.getElementById('new-org-error');
  const sucEl = document.getElementById('new-org-success');
  errEl.classList.remove('show'); sucEl.classList.remove('show');

  if (!name) { errEl.textContent='Please enter an organisation name'; errEl.classList.add('show'); return; }

  const orgCode = 'GY' + Math.random().toString(36).toUpperCase().slice(2,6);
  const { data: org, error: orgErr } = await sb.from('organisations')
    .insert({ name, plan, status:'active', org_code: orgCode, subscription_status:'trial' })
    .select().single();

  if (orgErr) { errEl.textContent='Error: '+orgErr.message; errEl.classList.add('show'); return; }

  // Add to user_orgs
  await sb.from('user_orgs').upsert({ user_id: currentUser.id, org_id: org.id, role });

  // Update profile role for this new org
  await sb.from('profiles').upsert({
    id: currentUser.id, org_id: org.id, role,
    full_name: currentProfile?.full_name || ''
  });

  sucEl.textContent = '✓ Organisation created! Switching to it now…';
  sucEl.classList.add('show');

  // Auto-create founder as Member #001 — use latest profile data
  const founderName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'Founder';
  const founderPhone = currentProfile?.phone || null;
  const { data: founderMember, error: founderErr } = await sb.from('members').insert({
    org_id: org.id,
    full_name: founderName,
    phone: founderPhone,
    portal_email: currentUser.email,
    member_number: '001',
    status: 'active',
    registration_paid: true,
    join_date: new Date().toISOString().split('T')[0],
    notes: 'Founding member'
  }).select().single();
  if (founderErr) console.error('Founder member creation failed:', founderErr.message);
  else console.log('Founder member created:', founderMember.id);

  // Log activity
  await logActivity('ORG CREATED', `New organisation created: ${name}`);

  setTimeout(async () => {
    closeModal('registerNewOrg');
    // Reload user orgs and switch to new one
    await loadUserOrgs();
    buildOrgSwitcherDropdown();
    await selectOrg(org.id);
    showPage('dashboard');
    toast(`✓ Welcome to ${name}!`);
  }, 1200);
}

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const main = document.querySelector('.main');
  const toggle = document.getElementById('sidebar-toggle');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
  main.classList.toggle('expanded');
  if (toggle) {
    toggle.classList.toggle('collapsed');
    toggle.innerHTML = sidebar.classList.contains('collapsed') ? '&#9776;' : '&#10005;';
    toggle.style.left = sidebar.classList.contains('collapsed') ? '8px' : '248px';
  }
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null; currentProfile = null; currentOrg = null;
  allMembers = []; allContribTypes = []; allProjects = [];
  showAuthScreen();
}

// ── APP ──
function showApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');
  // Resolve role from _userOrgs cache (populated by loadUserOrgs before showApp is called)
  // This ensures the correct per-org role is used immediately, no async delay
  const cachedOrgEntry = _userOrgs.find(o => o.id === currentOrg?.id);
  if (cachedOrgEntry?._role) {
    currentOrgRole = cachedOrgEntry._role;
    if (currentProfile) currentProfile = { ...currentProfile, role: cachedOrgEntry._role };
  } else {
    currentOrgRole = currentProfile?.role || 'member';
  }
  buildNav();
  updateSidebar();
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(el => { if(!el.value) el.value = today; });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { loadDashboard(); } catch(e) { console.error('[GY360] Dashboard error:', e); }
    try { prefetchData(); } catch(e) { console.error('[GY360] Prefetch error:', e); }
  try { loadOrgFinancialProfile(); } catch(e) { console.error('[GY360] FinProfile error:', e); }
    try { checkSubscriptionAccess(); } catch(e) { console.error('[GY360] Sub check error:', e); }
  }));
}


function updateTopbarActions(page) {
  const topbar = document.getElementById('topbar-actions');
  if (!topbar) return;
  const role = currentProfile?.role || 'member';
  const isSuperAdmin = role === 'superadmin';
  const isAdmin = ['admin','officer','treasurer'].includes(role);

  if (isSuperAdmin) {
    topbar.innerHTML = `<button class="topbar-btn" onclick="showModal('addOrg')">+ Onboard Organisation</button>`;
    return;
  }

  // Member portal pages — show Make Payment
  const memberPages = ['my_profile','my_contributions','my_meetings','my_notices','my_account','faq'];
  if (memberPages.includes(page) || role === 'member') {
    topbar.innerHTML = `
      <span style="font-size:.75rem;color:var(--ink-soft);font-weight:500;padding:.35rem .75rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:middle" title="${currentOrg?.name||''}">${(currentOrg?.name||'').replace(/\b\w/g,c=>c.toUpperCase()).toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}</span>
      <button class="topbar-btn" onclick="openMemberPaymentModal();showModal('memberPayment')" style="margin-left:.75rem">💳 Make Payment</button>`;
    return;
  }

  // Admin pages — contextual actions per page
  if (isAdmin) {
    switch(page) {
      case 'members':
        topbar.innerHTML = `
          <button class="topbar-btn outline" onclick="showModal('recordPayment')">+ Record Payment</button>
          <button class="topbar-btn" onclick="showModal('addMember')">+ Add Member</button>`;
        break;
      case 'finance':
        topbar.innerHTML = `
          <button class="topbar-btn outline" onclick="switchFinTab(document.querySelector('[onclick*=tab-expense-record]'),'tab-expense-record')">+ Expense</button>
          <button class="topbar-btn" onclick="showModal('recordPayment')">+ Record Payment</button>`;
        break;
      case 'meetings':
        topbar.innerHTML = `
          <button class="topbar-btn outline" onclick="sendMeetingReminders()">📱 Send Reminders</button>
          <button class="topbar-btn" onclick="showModal('scheduleMeeting')">+ Schedule Meeting</button>`;
        break;
      case 'welfare':
        topbar.innerHTML = `<button class="topbar-btn" onclick="showModal('welfareEvent')">+ New Welfare Event</button>`;
        break;
      case 'projects':
        topbar.innerHTML = `<button class="topbar-btn" onclick="showModal('addProject')">+ Add Project</button>`;
        break;
      case 'messages':
        topbar.innerHTML = `<button class="topbar-btn outline" onclick="testSms()">Test SMS</button>
          <button class="topbar-btn" onclick="sendSms()">📤 Send SMS</button>`;
        break;
      case 'mgr':
        topbar.innerHTML = `<button class="topbar-btn" onclick="showModal('createRound')">+ New Cycle</button>`;
        break;
      case 'table_banking':
        topbar.innerHTML = `
          <button class="topbar-btn outline" onclick="showModal('tbNewPool')">+ New Pool</button>
          <button class="topbar-btn" onclick="showModal('tbNewLoan')">+ Issue Loan</button>`;
        break;
      case 'approvals':
        topbar.innerHTML = `<span id="topbar-approvals-count" style="font-size:.78rem;color:var(--ink-faint)"></span>`;
        break;
      default:
        // Dashboard and other pages — no clutter
        topbar.innerHTML = `
          <button class="topbar-btn outline" onclick="showModal('recordPayment')">+ Record Payment</button>
          <button class="topbar-btn" onclick="showModal('addMember')">+ Add Member</button>`;
    }
  }
}

function buildNav() {
  // Use currentOrgRole (set by selectOrg from user_orgs) — NOT currentProfile.role
  // currentProfile.role reflects the user's role in their ORIGINAL/primary org
  // currentOrgRole is always the role for the currently active org
  const role = currentOrgRole || currentProfile?.role || 'member';
  const isSuperAdmin = role === 'superadmin';
  const isAdmin = role === 'admin' || role === 'officer' || role === 'treasurer' || isSuperAdmin;
  const isTreasurer = role === 'treasurer';
  let nav = '';
  if (!isSuperAdmin) {
    if (role === 'member') {
      // Member portal - restricted view, own data only
      nav += `<div class="nav-label">My Portal</div>
      <a class="nav-item active" onclick="showPage('my_profile')" href="#"><span class="nav-icon">◉</span> My Profile</a>
      <a class="nav-item" onclick="showPage('my_contributions')" href="#"><span class="nav-icon">₭</span> My Contributions</a>
      <a class="nav-item" onclick="showPage('my_meetings')" href="#"><span class="nav-icon">◷</span> Meetings</a>
      <a class="nav-item" onclick="showPage('my_notices')" href="#"><span class="nav-icon">✉</span> Notices</a>
      <a class="nav-item" onclick="showPage('faq')" href="#"><span class="nav-icon">❓</span> Help & FAQs</a>
      <a class="nav-item" onclick="showPage('my_account')" href="#"><span class="nav-icon">⚙</span> My Account</a>`;
    } else {
      nav += `<div class="nav-label">Main</div>
      <a class="nav-item active" onclick="showPage('dashboard')" href="#"><span class="nav-icon">⊞</span> Dashboard</a>
      <a class="nav-item" onclick="showPage('members')" href="#"><span class="nav-icon">◉</span> Members</a>`;
    }
    if (isAdmin) {
      const plan = currentOrg?._effectivePlan || currentOrg?.plan || 'starter';
      const hasBasic = ['basic','standard','pro'].includes(plan);
      const gatedLink = (page,icon,label,ok) => ok
        ? `<a class="nav-item" onclick="showPage('${page}')" href="#"><span class="nav-icon">${icon}</span> ${label}</a>`
        : `<a class="nav-item" style="opacity:.5;pointer-events:auto;cursor:default" onclick="showUpgradePrompt('${page}');return false" href="#"><span class="nav-icon">${icon}</span> ${label} <span style="margin-left:auto;font-size:.7rem">🔒</span></a>`;
      nav += `
    <a class="nav-item" onclick="showPage('finance')" href="#"><span class="nav-icon">₭</span> Finance</a>
    <a class="nav-item" onclick="showPage('meetings')" href="#"><span class="nav-icon">◷</span> Meetings</a>
    <a class="nav-item" onclick="showPage('mgr')" href="#"><span class="nav-icon">🔄</span> Rotating Savings</a>`;
      nav += gatedLink('welfare','♡','Welfare',hasBasic);
      nav += gatedLink('projects','⚑','Projects',hasBasic);
      nav += gatedLink('table_banking','🏦','Table Banking',hasBasic);
      nav += `
    <a class="nav-item" onclick="showPage('messages')" href="#"><span class="nav-icon">✉</span> Messages</a>
    <div class="nav-label" style="margin-top:.5rem">My Portal</div>
    <a class="nav-item" onclick="showPage('my_profile')" href="#"><span class="nav-icon">◉</span> My Profile</a>
    <a class="nav-item" onclick="showPage('my_contributions')" href="#"><span class="nav-icon">₭</span> My Contributions</a>
    <a class="nav-item" onclick="showPage('faq')" href="#"><span class="nav-icon">❓</span> Help & FAQs</a>
    <div class="nav-label" style="margin-top:.5rem">Admin</div>
    <a class="nav-item" onclick="showPage('approvals')" href="#"><span class="nav-icon">✓</span> Approvals <span class="nav-badge" id="approvals-badge" style="display:none">0</span></a>
    <a class="nav-item" onclick="showPage('settings')" href="#"><span class="nav-icon">⚙</span> Settings</a>
    <a class="nav-item" onclick="showPage('billing')" href="#"><span class="nav-icon">💳</span> Billing & SMS</a>

    <a class="nav-item" onclick="showPage('my_account')" href="#"><span class="nav-icon">👤</span> My Account</a>`;
    }
  } else {
    // Remove any stray page-dashboard active class
    document.querySelectorAll('.page.active').forEach(p => p.classList.remove('active'));
    nav += `<div class="nav-label">Super Admin</div>
    <a class="nav-item active" onclick="showPage('superadmin')" href="#"><span class="nav-icon">⊞</span> Platform Overview</a>
    <a class="nav-item" onclick="showPage('sa_members')" href="#"><span class="nav-icon">◉</span> All Members</a>
    <a class="nav-item" onclick="showPage('sa_finance')" href="#"><span class="nav-icon">₭</span> Revenue</a>
    <a class="nav-item" onclick="showPage('sa_billing')" href="#"><span class="nav-icon">💳</span> Billing</a>
    <a class="nav-item" onclick="showPage('sa_activity')" href="#"><span class="nav-icon">📋</span> Activity Log</a>
    <a class="nav-item" onclick="showPage('sa_support')" href="#"><span class="nav-icon">⚙</span> Platform Settings</a>
    <div class="nav-label" style="margin-top:.5rem">Account</div>
    <a class="nav-item" onclick="showPage('my_account')" href="#"><span class="nav-icon">👤</span> My Account</a>`;
  }
  document.getElementById('sidebar-nav').innerHTML = nav;
  buildMobileNav();
  const topbar = document.getElementById('topbar-actions');
  if (isSuperAdmin) {
    topbar.innerHTML = `<button class="topbar-btn" onclick="showModal('addOrg')">+ Onboard Organisation</button>`;
  } else if (role === 'admin' || role === 'officer') {
    topbar.innerHTML = `
      <button class="topbar-btn outline" onclick="showModal('recordPayment')">+ Record Payment</button>
      <button class="topbar-btn" onclick="showModal('addMember')">+ Add Member</button>`;
  } else {
    // member portal
    topbar.innerHTML = `
      <span style="font-size:.75rem;color:var(--maroon);font-weight:600;padding:.4rem .75rem;background:var(--maroon-pale);border:1px solid var(--maroon-muted)">${currentOrg?.name||'My Organisation'}</span>
      <button class="topbar-btn" onclick="showModal('memberPayment')" style="margin-left:.75rem">💳 Make Payment</button>`;
  }
}

function updateSidebar() {
  const rawName = currentOrg?.name || '—';
  const titleName = rawName.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  document.getElementById('sidebar-org-name').textContent = titleName;
  document.getElementById('sidebar-org-reg').textContent = currentOrg?.reg_number || '';
  document.getElementById('sidebar-org-plan').textContent = (currentOrg?.plan || 'starter').toUpperCase();
  document.getElementById('sidebar-user-name').textContent = currentProfile?.full_name || currentUser?.email || '—';
  document.getElementById('sidebar-user-role').textContent = currentProfile?.role || 'member';
  // Update "Start a New Group" label based on role
  const newGroupLabel = document.getElementById('sidebar-new-group-label');
  if (newGroupLabel) {
    const r = currentProfile?.role;
    if (r === 'admin' || r === 'officer' || r === 'treasurer') {
      newGroupLabel.textContent = '✦ Register Another Group';
    } else if (r === 'member') {
      newGroupLabel.textContent = '🌱 Start Your Own Group';
    } else {
      newGroupLabel.textContent = '🌱 Start a New Group';
    }
  }
}

async function prefetchData() {
  if (!currentOrg?.id) return;
  const [membersRes, typesRes, projsRes] = await Promise.all([
    sb.from('members').select('*').eq('org_id', currentOrg.id).order('member_number'),
    sb.from('contribution_types').select('*').eq('org_id', currentOrg.id),
    sb.from('projects').select('*').eq('org_id', currentOrg.id)
  ]);
  allMembers = membersRes.data || [];
  allContribTypes = typesRes.data || [];
  allProjects = projsRes.data || [];
  populateSelects();
}

function populateSelects() {
  const memberOpts = '<option value="">Select member…</option>' + allMembers.map(m => `<option value="${m.id}">${m.full_name}</option>`).join('');
  const typeOpts = '<option value="">Select type…</option>' + allContribTypes.map(t => `<option value="${t.id}">${t.name} ${t.is_variable?'(variable)':'(Ksh '+t.amount+')'}</option>`).join('');
  ['pay-member','modal-pay-member','wel-member','fine-member'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=memberOpts; });
  ['pay-type','modal-pay-type'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=typeOpts; });
  const projOpts = '<option value="">None</option>' + allProjects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  const ep = document.getElementById('exp-project'); if(ep) ep.innerHTML = projOpts;
}

// ── NAVIGATION ──
const pageTitles = {
  dashboard: ['Dashboard', ''],
  sa_members: ['All Members', 'Platform-wide member directory'],
  sa_finance: ['Revenue', 'Subscription & billing overview'],
  my_profile: ['My Profile', 'Your member details'],
  my_account: ['My Account', 'Personal information & password'],
  billing: ['Billing & SMS', 'Subscription and usage'],
  support: ['Support', 'Get help with GroupYetu360'],
  faq: ['Help & FAQs', 'Common questions answered'],
  sa_billing: ['Billing Management', 'Review payments and subscriptions'],
  sa_org_detail: ['Organisation Detail', 'Platform management'],
  sa_support: ['Platform Settings', 'Contact details, payment info & Daraja'],
  sa_activity: ['Activity Log', 'Audit trail of all admin actions'],
  my_meetings: ['Meetings', 'Scheduled meetings and attendance'],
  my_notices: ['Notices', 'Messages from your group admin'],
  my_contributions: ['My Contributions', 'Your payment history'],
  approvals: ['Member Approvals', 'Review and approve access requests'],
  members: ['Members', 'Member register'],
  finance: ['Finance', 'Transactions & expenses'],
  meetings: ['Meetings', 'Schedule & attendance'],
  welfare: ['Welfare', 'Bereavement contributions'],
  projects: ['Projects & Investments', 'Active investments'],
  messages: ['Messages', 'SMS communication'],
  settings: ['Settings', 'Organisation configuration'],
  superadmin: ['Platform Control', 'EPH Technologies — Super Admin'],
};

let currentPage = 'dashboard';

// ── MOBILE NAVIGATION ─────────────────────────────────────────────────────

function openMobileMenu() {
  document.querySelector('.sidebar')?.classList.add('mob-open');
  document.getElementById('mob-backdrop')?.classList.add('visible');
  document.body.style.overflow = 'hidden';
}

function closeMobileMenu() {
  document.querySelector('.sidebar')?.classList.remove('mob-open');
  document.getElementById('mob-backdrop')?.classList.remove('visible');
  document.body.style.overflow = '';
}

function buildMobileNav() {
  const nav = document.getElementById('mob-bottom-nav');
  if (!nav) return;
  const role = currentProfile?.role;
  const isMember = role === 'member';
  const isAdmin = ['admin','officer','treasurer'].includes(role);
  const isSuperAdmin = role === 'superadmin';

  // Show bottom nav only on mobile (CSS handles display:none on desktop)
  nav.style.display = '';

  if (isSuperAdmin) {
    nav.innerHTML = buildMobNavItems([
      { icon:'⊞', label:'Overview', page:'superadmin' },
      { icon:'◉', label:'Members', page:'sa_members' },
      { icon:'₭', label:'Revenue', page:'sa_finance' },
      { icon:'💳', label:'Billing', page:'sa_billing' },
    ]);
  } else if (isMember) {
    nav.innerHTML = buildMobNavItems([
      { icon:'👤', label:'Profile', page:'my_profile' },
      { icon:'₭', label:'Payments', page:'my_contributions' },
      { icon:'📅', label:'Meetings', page:'my_meetings' },
      { icon:'❓', label:'Help', page:'faq' },
    ]);
  } else if (isAdmin) {
    nav.innerHTML = buildMobNavItems([
      { icon:'⊞', label:'Dashboard', page:'dashboard' },
      { icon:'◉', label:'Members', page:'members' },
      { icon:'₭', label:'Finance', page:'finance' },
      { icon:'👤', label:'Profile', page:'my_profile' },
      { icon:'⚙', label:'More', page:'_menu' },
    ]);
  }
}

function buildMobNavItems(items) {
  return items.map(item => {
    if (item.page === '_menu') {
      return `<button class="mob-nav-item" onclick="openMobileMenu()">
        <span class="mob-nav-icon">${item.icon}</span>
        <span class="mob-nav-label">${item.label}</span>
      </button>`;
    }
    return `<button class="mob-nav-item" onclick="showPage('${item.page}');closeMobileMenu()" id="mob-nav-${item.page}">
      <span class="mob-nav-icon">${item.icon}</span>
      <span class="mob-nav-label">${item.label}</span>
    </button>`;
  }).join('');
}

function updateMobileNavActive(page) {
  document.querySelectorAll('.mob-nav-item').forEach(el => {
    el.classList.remove('active');
  });
  const active = document.getElementById('mob-nav-' + page);
  if (active) active.classList.add('active');
}

function showPage(id) {
  updateMobileNavActive(id);
  // Close mobile menu when navigating
  closeMobileMenu();
  const gatedPages={welfare:'welfare',projects:'projects',table_banking:'table_banking'};
  if(gatedPages[id]&&typeof planHas==='function'&&!planHas(gatedPages[id])){showUpgradePrompt(id);return;}
  currentPage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const page = document.getElementById('page-'+id);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => { if(n.getAttribute('onclick')?.includes("'"+id+"'")) n.classList.add('active'); });
  const info = pageTitles[id] || [id, ''];
  document.getElementById('page-title').textContent = info[0];
  document.getElementById('page-sub').textContent = info[1] || currentOrg?.name || '';
  const loaders = { members: loadMembers, finance: loadFinance, meetings: loadMeetings, welfare: loadWelfare, projects: loadProjects, mgr: loadMGR, table_banking: loadTableBanking, messages: loadMessages, settings: loadSettings, superadmin: loadSuperAdmin, sa_org_detail: ()=>{}, sa_members: loadSAMembers, sa_finance: loadSAFinance, my_profile: loadMyProfile, my_contributions: loadMyContributions, approvals: loadApprovals, my_account: loadMyAccount, billing: loadBilling, support: loadSupport, sa_billing: loadSABilling, sa_support: loadSASupport, sa_activity: loadSAActivity, my_meetings: loadMyMeetings, my_notices: loadMyNotices, faq: loadMyHelp };
  if (loaders[id]) loaders[id]();
  updateTopbarActions(id);
}


/* ════════════════════════════════════════════════════════════════
   MEMBER PORTAL — Mobile renderers & helpers
   These run AFTER portal.js (via window.load) so they override
   portal.js's loadMyContributions and loadMyMeetings safely
════════════════════════════════════════════════════════════════ */

// ── FAQ toggle (new design) ──────────────────────────────────────
function pfaqToggle(el) {
  const item = el.closest('.pfaq-item');
  const answer = item.querySelector('.pfaq-a');
  const arrow = el.querySelector('.pfaq-arrow');
  const isOpen = item.classList.contains('open');
  // Close all
  document.querySelectorAll('.pfaq-item.open').forEach(i => {
    i.classList.remove('open');
    i.querySelector('.pfaq-a').style.display = 'none';
    i.querySelector('.pfaq-arrow').style.transform = '';
  });
  if (!isOpen) {
    item.classList.add('open');
    answer.style.display = 'block';
    arrow.style.transform = 'rotate(180deg)';
  }
}

// ── Help page loader ────────────────────────────────────────────
async function loadMyHelp() {
  try {
    if (!currentOrg?.id) return;
    const { data: adminProfile } = await sb.from('profiles')
      .select('full_name').eq('org_id', currentOrg.id).eq('role','admin').maybeSingle();
    const aName = adminProfile?.full_name || (currentOrg?.name ? currentOrg.name + ' Admin' : 'Group Admin');
    const initials = aName.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
    const nameEl = document.getElementById('faq-admin-name');
    const avatarEl = document.getElementById('faq-admin-avatar');
    if (nameEl) nameEl.textContent = aName;
    if (avatarEl) avatarEl.textContent = initials;
  } catch(e) {}
}

// ── Override portal.js loaders after all scripts are loaded ─────
window.addEventListener('load', () => {

  // ── loadMyContributions override ──────────────────────────────
  window.loadMyContributions = async function() {
    if (!currentOrg?.id || !currentProfile) return;
    if (!window._myMemberId && typeof loadMyProfile === 'function') {
      await loadMyProfile();
    }
    const memberId = window._myMemberId;
    const timelineEl = document.getElementById('mc-timeline');

    if (!memberId) {
      if (timelineEl) timelineEl.innerHTML = `
        <div style="padding:2.5rem;text-align:center;color:var(--ink-faint)">
          <div style="font-size:2rem;margin-bottom:.5rem">🔗</div>
          <div style="font-size:.88rem;font-weight:600;margin-bottom:.35rem">Not linked to a member record</div>
          <div style="font-size:.78rem">Contact your group admin to link your account.</div>
        </div>`;
      return;
    }

    try {
      const [txnRes, adjRes] = await Promise.all([
        sb.from('transactions')
          .select('*,contribution_types(name,income_type)')
          .eq('member_id', memberId)
          .order('transaction_date', {ascending: false}),
        sb.from('balance_adjustments')
          .select('*').eq('member_id', memberId)
          .order('created_at', {ascending: false})
      ]);
      const txns = txnRes.data || [];
      const adjs = adjRes.data || [];
      const thisYear = new Date().getFullYear().toString();
      const total = txns.reduce((s,t) => s + Number(t.amount||0), 0);
      const yearTotal = txns
        .filter(t => (t.transaction_date || t.created_at || '').startsWith(thisYear))
        .reduce((s,t) => s + Number(t.amount||0), 0);

      // ── Hero amount ──
      const totalEl = document.getElementById('mc-total');
      if (totalEl) totalEl.textContent = 'Ksh ' + total.toLocaleString();

      // ── Type chips in hero ──
      const chipsEl = document.getElementById('mc-type-chips');
      if (chipsEl && txns.length) {
        const cats = {};
        txns.forEach(t => {
          const c = t.contribution_types?.name || 'Payment';
          cats[c] = (cats[c]||0) + Number(t.amount||0);
        });
        chipsEl.innerHTML = Object.entries(cats)
          .map(([c,a]) => `<div class="pmc-chip">${c} · <strong>Ksh ${a.toLocaleString()}</strong></div>`)
          .join('');
      }

      // ── Year card ──
      const yearEl = document.getElementById('mc-year');
      if (yearEl) yearEl.textContent = 'Ksh ' + yearTotal.toLocaleString();

      // ── Count label ──
      const countEl = document.getElementById('mc-count-label');
      if (countEl) countEl.textContent = txns.length + ' payment' + (txns.length===1?'':'s') + ' recorded';

      // ── History sub label ──
      const subEl = document.getElementById('mc-history-sub');
      if (subEl) subEl.textContent = txns.length + ' total';

      // ── Monthly bar chart (last 6 months) ──
      const chartEl = document.getElementById('mc-chart');
      const labelsEl = document.getElementById('mc-chart-labels');
      if (chartEl) {
        const months = [];
        for (let i=5; i>=0; i--) {
          const d = new Date();
          d.setDate(1);
          d.setMonth(d.getMonth()-i);
          months.push({ key: d.toISOString().slice(0,7), label: d.toLocaleString('default',{month:'short'}) });
        }
        const monthData = months.map(m => ({
          label: m.label,
          total: txns.filter(t => (t.transaction_date||'').startsWith(m.key))
            .reduce((s,t) => s + Number(t.amount||0), 0)
        }));
        const maxVal = Math.max(...monthData.map(m => m.total), 1);
        const colors = ['#800020','#9a1c35','#0f6e56','#c49a30','#5a0016','#1d9e75'];
        chartEl.innerHTML = monthData.map((m, i) => {
          const h = Math.round((m.total/maxVal)*80);
          return `<div class="pmc-bar-col">
            <div class="pmc-bar-val">${m.total>0?'Ksh '+(m.total>=1000?(m.total/1000).toFixed(0)+'K':m.total):''}</div>
            <div class="pmc-bar" style="height:${h||3}px;background:${colors[i%colors.length]}"></div>
          </div>`;
        }).join('');
        if (labelsEl) labelsEl.innerHTML = monthData.map(m =>
          `<div style="flex:1;text-align:center;font-size:.6rem;color:var(--ink-faint)">${m.label}</div>`).join('');
      }

      // ── By category ──
      const catEl = document.getElementById('mc-by-category');
      if (catEl) {
        const cats = {};
        txns.forEach(t => {
          const c = t.contribution_types?.name || 'Payment';
          cats[c] = (cats[c]||0) + Number(t.amount||0);
        });
        const entries = Object.entries(cats).sort((a,b) => b[1]-a[1]);
        const grandTotal = entries.reduce((s,[,v]) => s+v, 0);
        const catColors = ['var(--maroon)','var(--teal)','var(--gold)','#9a1c35','#085041'];
        catEl.innerHTML = entries.length ? entries.map(([cat,amt],i) => {
          const pct = grandTotal ? Math.round((amt/grandTotal)*100) : 0;
          return `<div class="pmc-cat-row">
            <div class="pmc-cat-dot" style="background:${catColors[i%catColors.length]}"></div>
            <div style="flex:1">
              <div style="display:flex;justify-content:space-between;margin-bottom:.25rem">
                <span style="font-size:.78rem;font-weight:500;color:var(--ink)">${cat}</span>
                <span style="font-size:.78rem;font-weight:700;color:${catColors[i%catColors.length]}">Ksh ${amt.toLocaleString()}</span>
              </div>
              <div class="pmc-cat-bar"><div class="pmc-cat-fill" style="width:${pct}%;background:${catColors[i%catColors.length]}"></div></div>
            </div>
          </div>`;
        }).join('') : '<div style="padding:1rem;color:var(--ink-faint);font-size:.82rem">No contributions yet</div>';
      }

      // ── Payment history timeline ──
      if (!timelineEl) return;
      const all = [
        ...txns.map(t => ({
          date: t.transaction_date || t.created_at?.split('T')[0] || '',
          name: t.contribution_types?.name || 'Payment',
          amount: Number(t.amount||0),
          ref: t.mpesa_ref || '—',
          isCredit: true,
          created: t.created_at || t.transaction_date || ''
        })),
        ...adjs.map(a => ({
          date: a.created_at?.split('T')[0] || '',
          name: (a.direction==='credit' ? '✓ Credit' : '↓ Debit') + (a.adjustment_type ? ' — '+a.adjustment_type : ''),
          amount: Number(a.amount||0),
          ref: '—',
          isCredit: a.direction === 'credit',
          created: a.created_at || ''
        }))
      ].sort((a,b) => new Date(b.created) - new Date(a.created));

      if (!all.length) {
        timelineEl.innerHTML = `
          <div style="padding:3rem;text-align:center">
            <div style="font-size:2.5rem;margin-bottom:.75rem">₭</div>
            <div style="font-size:.9rem;font-weight:600;color:var(--ink);margin-bottom:.35rem">No payments yet</div>
            <div style="font-size:.78rem;color:var(--ink-faint);margin-bottom:1rem">Your payment history will appear here.</div>
            <button class="pmc-pay-btn" onclick="openMemberPaymentModal();showModal('memberPayment')" style="max-width:200px;margin:0 auto">💳 Make a Payment</button>
          </div>`;
        return;
      }

      // Group by month
      const groups = {};
      all.forEach(item => {
        const d = item.date ? new Date(item.date) : new Date();
        const key = d.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
        if (!groups[key]) groups[key] = [];
        groups[key].push(item);
      });

      timelineEl.innerHTML = Object.entries(groups).map(([month, items]) => {
        const monthTotal = items.filter(i=>i.isCredit).reduce((s,i)=>s+i.amount,0);
        return `
          <div class="pmc-month-group">
            <div class="pmc-month-header">
              <span>${month}</span>
              <span style="color:var(--teal);font-weight:700">+Ksh ${monthTotal.toLocaleString()}</span>
            </div>
            ${items.map(item => {
              const initials = item.name.replace(/[^A-Za-z]/g,'').substring(0,2).toUpperCase() || '₭';
              const dateStr = item.date ? new Date(item.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—';
              const color = item.isCredit ? 'var(--teal)' : 'var(--danger)';
              const bg = item.isCredit ? 'var(--teal-pale)' : 'var(--danger-pale)';
              return `
                <div class="pmc-txn-row">
                  <div class="pmc-txn-avatar" style="background:${bg};color:${color}">${initials}</div>
                  <div class="pmc-txn-body">
                    <div class="pmc-txn-name">${item.name}</div>
                    <div class="pmc-txn-meta">${dateStr}${item.ref!=='—'?' · <span style="font-family:monospace;font-size:.7rem">'+item.ref+'</span>':''}</div>
                  </div>
                  <div class="pmc-txn-amount" style="color:${color}">
                    ${item.isCredit?'+':'−'}Ksh ${item.amount.toLocaleString()}
                  </div>
                </div>`;
            }).join('')}
          </div>`;
      }).join('');

    } catch(e) {
      console.error('loadMyContributions error:', e);
      const el = document.getElementById('mc-timeline');
      if (el) el.innerHTML = `<div style="padding:1.5rem;text-align:center;color:var(--danger)">Error loading contributions: ${e.message}</div>`;
    }
  };

  // ── loadMyMeetings override ───────────────────────────────────
  window.loadMyMeetings = async function() {
    if (!currentOrg?.id) return;
    const today = new Date().toISOString().split('T')[0];
    const memberId = window._myMemberId;

    try {
      const [upRes, pastRes] = await Promise.all([
        sb.from('meetings').select('*').eq('org_id', currentOrg.id)
          .gte('meeting_date', today).order('meeting_date').limit(5),
        sb.from('meetings').select('*').eq('org_id', currentOrg.id)
          .lt('meeting_date', today).order('meeting_date',{ascending:false}).limit(10)
      ]);
      const upcoming = upRes.data || [];
      const past = pastRes.data || [];

      // ── Next meeting hero ──
      const titleEl = document.getElementById('mtg-next-title');
      const metaEl = document.getElementById('mtg-next-meta');
      const chipsEl = document.getElementById('mtg-next-chips');
      if (upcoming.length) {
        const m = upcoming[0];
        const d = new Date(m.meeting_date);
        const daysAway = Math.ceil((d - new Date()) / (1000*60*60*24));
        if (titleEl) titleEl.textContent = m.agenda?.split('\n')[0] || m.name || 'General Meeting';
        if (metaEl) metaEl.textContent = d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}) + (m.meeting_time ? ' · ' + m.meeting_time : '');
        if (chipsEl) chipsEl.innerHTML = [
          m.venue ? `<div class="pmm-chip">📍 ${m.venue}</div>` : '',
          `<div class="pmm-chip">👥 All members</div>`,
          daysAway === 0 ? '<div class="pmm-chip urgent">Today!</div>' :
          daysAway === 1 ? '<div class="pmm-chip soon">Tomorrow</div>' :
          `<div class="pmm-chip">In ${daysAway} days</div>`
        ].join('');
      } else {
        if (titleEl) titleEl.textContent = 'No upcoming meetings scheduled';
        if (metaEl) metaEl.textContent = 'Your admin will schedule the next meeting soon';
        if (chipsEl) chipsEl.innerHTML = '';
      }

      // ── Attendance summary ──
      const attEl = document.getElementById('my-attendance-record');
      if (attEl) {
        let present = 0, absent = 0, apology = 0;
        if (memberId && past.length) {
          const { data: attData } = await sb.from('attendance')
            .select('status').eq('member_id', memberId)
            .in('meeting_id', past.map(m=>m.id));
          (attData||[]).forEach(a => {
            if (a.status === 'present') present++;
            else if (a.status === 'absent') absent++;
            else if (a.status === 'apology') apology++;
          });
        }
        const total = past.length;
        const rate = total > 0 ? Math.round((present/total)*100) : 0;
        const rateColor = rate >= 75 ? 'var(--teal)' : rate >= 50 ? 'var(--gold)' : 'var(--danger)';
        attEl.innerHTML = `
          <div class="pmm-att-card">
            <div class="pmm-att-val" style="color:var(--ink)">${total}</div>
            <div class="pmm-att-lbl">Meetings held</div>
          </div>
          <div class="pmm-att-card">
            <div class="pmm-att-val" style="color:var(--teal)">${present}</div>
            <div class="pmm-att-lbl">I attended</div>
          </div>
          <div class="pmm-att-card">
            <div class="pmm-att-val" style="color:${rateColor}">${total>0?rate+'%':'—'}</div>
            <div class="pmm-att-lbl">Rate</div>
          </div>`;
      }

      // ── Upcoming meetings ──
      const upEl = document.getElementById('my-upcoming-meetings');
      if (upEl) {
        upEl.innerHTML = upcoming.length ? upcoming.map((m,i) => {
          const d = new Date(m.meeting_date);
          const days = Math.ceil((d - new Date()) / (1000*60*60*24));
          const urgency = days === 0 ? 'today' : days <= 3 ? 'soon' : '';
          return `
            <div class="pmm-upcoming-card" style="animation-delay:${i*.05}s">
              <div class="pmm-upcoming-date">
                <div class="pmm-date-day">${d.getDate()}</div>
                <div class="pmm-date-mon">${d.toLocaleString('default',{month:'short'})}</div>
              </div>
              <div style="flex:1">
                <div class="pmm-upcoming-title">${m.agenda?.split('\n')[0] || 'General Meeting'}</div>
                <div class="pmm-upcoming-meta">🕐 ${m.meeting_time||'TBA'} · 📍 ${m.venue||'TBA'}</div>
                ${urgency ? `<div class="pmm-urgency ${urgency}">${days===0?'📍 Today!':days===1?'⏰ Tomorrow':'⏰ In '+days+' days'}</div>` : ''}
              </div>
            </div>`;
        }).join('') : `<div style="padding:1.25rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No upcoming meetings</div>`;
      }

      // ── Past meetings ──
      const pastEl = document.getElementById('my-past-meetings');
      if (pastEl) {
        let attMap = {};
        if (memberId && past.length) {
          const { data: attData } = await sb.from('attendance')
            .select('meeting_id,status').eq('member_id', memberId)
            .in('meeting_id', past.map(m=>m.id));
          (attData||[]).forEach(a => attMap[a.meeting_id] = a.status);
        }
        pastEl.innerHTML = past.length ? past.map(m => {
          const d = new Date(m.meeting_date);
          const s = attMap[m.id];
          const statusLabel = s === 'present' ? '✓ Present' : s === 'apology' ? '~ Apology' : s === 'absent' ? '✗ Absent' : '—';
          const statusColor = s === 'present' ? 'var(--teal)' : s === 'apology' ? 'var(--gold)' : s === 'absent' ? 'var(--danger)' : 'var(--ink-faint)';
          return `
            <div class="pmm-past-card">
              <div class="pmm-past-left">
                <div class="pmm-past-date">${d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
                <div class="pmm-past-venue">📍 ${m.venue||'—'}</div>
              </div>
              <div class="pmm-past-status" style="color:${statusColor}">${statusLabel}</div>
            </div>`;
        }).join('') : `<div style="padding:1.25rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No past meetings recorded</div>`;
      }

    } catch(e) {
      console.error('loadMyMeetings error:', e);
    }
  };

}); // end window.addEventListener('load')
