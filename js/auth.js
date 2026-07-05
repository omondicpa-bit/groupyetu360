// GroupYetu360 — js/auth.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── SUPABASE ──
const SUPABASE_URL = 'https://eengldzvvgplgzvbutal.supabase.co';
const SUPABASE_KEY = 'sb_publishable_YMCrMAvAeQEhVV3dC-8jjw_pVzFDyPH';
const FUNCTIONS_URL = 'https://eengldzvvgplgzvbutal.supabase.co/functions/v1';
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
  // Detect a signup-confirmation redirect BEFORE anything consumes the URL hash.
  // Supabase appends #access_token=...&type=signup to the confirmation link's redirect.
  // Without this check, getSession()/onAuthStateChange below just silently establish
  // a session and load the app straight in — no acknowledgment the email was even
  // confirmed. This is what makes registration feel unfinished/unprofessional.
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const isSignupConfirmation = hashParams.get('type') === 'signup';

  const { data: { session } } = await sb.auth.getSession();

  if (isSignupConfirmation && session) {
    // Clear the hash so a refresh doesn't re-trigger this
    history.replaceState(null, '', window.location.pathname + window.location.search);
    currentUser = session.user;
    window._suppressAuthScreenOnce = true; // see SIGNED_OUT handler below — signOut() inside
                                            // showEmailConfirmedScreen() would otherwise fire
                                            // SIGNED_OUT and overwrite our custom confirmed UI
    showEmailConfirmedScreen();
  }

  if (session && !isSignupConfirmation) {
    currentUser = session.user;
    await loadProfileAndOrg();
  } else if (!session) {
    showAuthScreen();
  }
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (!session) return;
      // While signIn() is still checking whether this account needs 2FA, don't let
      // this listener race ahead and load the real app — that race was the cause of
      // the "flashes into the app before showing OTP" bug. signIn()/verify2FA() drive
      // the load explicitly once they know which path they're on.
      if (window._suppressAuthAutoLoad) return;
      // Avoid double-loading if we already have a matching session
      if (event === 'INITIAL_SESSION' && currentProfile) return;
      // Guard: if SIGNED_IN fires but the session user differs from currentUser,
      // it means a signUp() call (e.g. admin inviting a member) triggered this.
      // Do NOT switch the current admin's session.
      if (event === 'SIGNED_IN' && currentUser && session.user.id !== currentUser.id) {
        console.log('[GY360] Ignoring SIGNED_IN for different user (invite signUp side-effect)');
        return;
      }
      currentUser = session.user;
      try {
        await loadProfileAndOrg();
      } catch(e) {
        console.error('[GY360] loadProfileAndOrg error:', e);
        showAuthScreen();
      }
    } else if (event === 'PASSWORD_RECOVERY') {
      // Triggered when user clicks a reset/invite/confirmation link
      if (!session) return;
      currentUser = session.user;
      const meta = session.user.user_metadata || {};
      if (meta.invite_org_id) {
        // Invited member — show set password screen (they have no password yet)
        showPasswordResetScreen();
      } else {
        // Self-registered user confirming email OR forgot password reset
        // If profile exists → they registered with a password → show confirmed screen
        // If no profile → treat as reset/invite → show set password screen
        try {
          const { data: profile } = await sb.from('profiles').select('id').eq('id', session.user.id).maybeSingle();
          if (profile) {
            showEmailConfirmedScreen();
          } else {
            showPasswordResetScreen();
          }
        } catch(e) {
          showPasswordResetScreen();
        }
      }
    } else if (event === 'SIGNED_OUT') {
      if (window._suppressAuthScreenOnce) {
        window._suppressAuthScreenOnce = false;
        return;
      }
      showAuthScreen();
    }
  });
}

async function loadProfileAndOrg() {
  // Guard: prevent concurrent execution — onAuthStateChange can fire INITIAL_SESSION
  // and SIGNED_IN almost simultaneously before currentProfile is set
  if (window._loadProfileInProgress) {
    console.log('[GY360] loadProfileAndOrg already in progress — skipping duplicate call');
    return;
  }
  window._loadProfileInProgress = true;
  try {
    await _loadProfileAndOrgInner();
  } finally {
    window._loadProfileInProgress = false;
  }
}

async function _loadProfileAndOrgInner() {
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
  if (profile) {
    // Self-healing backfill: some members (especially those who joined before the
    // invite-linkage flow existed) have a profile but their members.user_id was
    // never set. This silently breaks "Set Role" later (members.js promoteToAdmin
    // falls back to a fragile phone/name match). Fix it here, once, cheaply —
    // by matching on portal_email if a member row exists with no user_id yet.
    (async () => {
      try {
        const { data: unlinked } = await sb.from('members')
          .select('id').eq('portal_email', profile.email).is('user_id', null).limit(1).maybeSingle();
        if (unlinked?.id) {
          await sb.from('members').update({ user_id: currentUser.id }).eq('id', unlinked.id);
        }
      } catch(e) { /* non-critical, never block login on this */ }
    })();
  }
  if (!profile) {
    // No profile yet — try to auto-link via invite metadata or portal_email
    try {
      const email = currentUser.email;
      const meta = currentUser.user_metadata || {};

      // Priority 1: invite metadata embedded in signUp options.data
      let inviteOrgId = meta.invite_org_id || null;
      let inviteMemberId = meta.invite_member_id || null;

      // Priority 2: fallback — look up members table by portal_email
      if (!inviteOrgId) {
        const { data: memberRow } = await sb.from('members')
          .select('id,org_id,portal_email').eq('portal_email', email).maybeSingle();
        if (memberRow?.org_id) {
          inviteOrgId = memberRow.org_id;
          inviteMemberId = memberRow.id;
        }
      }

      if (inviteOrgId) {
        const { data: orgData } = await sb.from('organisations').select('*').eq('id', inviteOrgId).single();
        const role = meta.invite_role || 'member';
        await sb.from('profiles').upsert({
          id: currentUser.id,
          full_name: meta.full_name || email.split('@')[0],
          email,
          org_id: inviteOrgId,
          role
        });
        await sb.from('user_orgs').upsert({
          user_id: currentUser.id,
          org_id: inviteOrgId,
          role
        });
        if (inviteMemberId) {
          await sb.from('members').update({ user_id: currentUser.id }).eq('id', inviteMemberId);
        }
        const { data: newProfile } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
        currentProfile = newProfile;
        currentOrg = orgData;
        currentOrgRole = role;
        _userOrgs = [{ ...orgData, _role: role }];
        showApp();
        buildOrgSwitcherDropdown();
        return;
      }
    } catch(e) { console.warn('[GY360] invite link-up error:', e); }
    showAuthScreen();
    return;
  }

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

  if (!profile.org_id || userOrgCount >= 1) {
    // Always show picker — single or multiple orgs
    showOrgPicker();
    return;
  }

  // Single org — go straight in
  const { data: org } = await sb.from('organisations').select('*').eq('id', profile.org_id).single();
  currentOrg = org;
  // Resolve per-org role from user_orgs — don't trust profiles.role for org-specific role
  let resolvedRole = profile.role || 'member';
  // Superadmins acting as org admins should be treated as 'admin' in the org context
  if (resolvedRole === 'superadmin') resolvedRole = 'admin';
  try {
    const { data: uoRow } = await sb.from('user_orgs')
      .select('role').eq('user_id', currentUser.id).eq('org_id', org.id).maybeSingle();
    if (uoRow?.role) {
      resolvedRole = uoRow.role;
    } else {
      await sb.from('user_orgs').upsert({
        user_id: currentUser.id, org_id: org.id, role: resolvedRole
      });
    }
  } catch(e) {}
  currentOrgRole = resolvedRole;
  currentProfile = { ...profile, role: resolvedRole };
  _userOrgs = [{ ...org, _role: resolvedRole }];
  showApp();
  buildOrgSwitcherDropdown();
}

// ── AUTH SCREEN ──
function showAuthScreen() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('app-screen').classList.remove('visible');
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'none';
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
let _resendCooldownTimer = null;

// ── OTP box UI (Paystack-style auto-advancing input) ──
function otpBoxInput(el, idx) {
  el.value = el.value.replace(/[^0-9]/g, '').slice(0, 1);
  el.classList.toggle('filled', !!el.value);
  el.classList.remove('otp-error');
  if (el.value && idx < 5) {
    const next = document.querySelector(`.otp-box[data-idx="${idx+1}"]`);
    if (next) next.focus();
  }
  syncOtpHiddenField();
  // Auto-submit once all 6 are filled
  const allFilled = Array.from(document.querySelectorAll('.otp-box')).every(b => b.value);
  if (allFilled) verify2FA();
}

function otpBoxKeydown(e, idx) {
  if (e.key === 'Backspace' && !e.target.value && idx > 0) {
    const prev = document.querySelector(`.otp-box[data-idx="${idx-1}"]`);
    if (prev) { prev.focus(); prev.value = ''; prev.classList.remove('filled'); syncOtpHiddenField(); }
  }
}

function otpBoxPaste(e) {
  e.preventDefault();
  const digits = (e.clipboardData.getData('text') || '').replace(/[^0-9]/g, '').slice(0, 6);
  const boxes = document.querySelectorAll('.otp-box');
  digits.split('').forEach((d, i) => {
    if (boxes[i]) { boxes[i].value = d; boxes[i].classList.add('filled'); }
  });
  syncOtpHiddenField();
  if (digits.length === 6) { verify2FA(); }
  else if (boxes[digits.length]) boxes[digits.length].focus();
}

function syncOtpHiddenField() {
  const code = Array.from(document.querySelectorAll('.otp-box')).map(b => b.value).join('');
  const hidden = document.getElementById('2fa-code');
  if (hidden) hidden.value = code;
}

function clearOtpBoxes() {
  document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.classList.remove('filled','otp-error'); });
  syncOtpHiddenField();
  const first = document.querySelector('.otp-box[data-idx="0"]');
  if (first) first.focus();
}

function shakeOtpBoxes() {
  document.querySelectorAll('.otp-box').forEach(b => {
    b.classList.add('otp-error');
    setTimeout(() => b.classList.remove('otp-error'), 350);
  });
}

function startResendCooldown(seconds) {
  const link = document.getElementById('resend-2fa-link');
  if (!link) return;
  let remaining = seconds;
  clearInterval(_resendCooldownTimer);
  link.classList.add('disabled');
  link.textContent = `Resend code (${remaining}s)`;
  _resendCooldownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(_resendCooldownTimer);
      link.classList.remove('disabled');
      link.textContent = 'Resend code';
    } else {
      link.textContent = `Resend code (${remaining}s)`;
    }
  }, 1000);
}

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

  // Suppress the onAuthStateChange listener's auto-load while we check whether this
  // account needs 2FA. Without this, signInWithPassword() immediately fires SIGNED_IN,
  // which was racing ahead and loading the real app UI for a moment before this function
  // got to the 2FA check below and yanked it back to show the OTP screen — that flash
  // was the "looks like it's logging in" bug. Cleared further down once we know which
  // path we're actually on.
  window._suppressAuthAutoLoad = true;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    window._suppressAuthAutoLoad = false;
    errEl.textContent = error.message; errEl.classList.add('show'); return;
  }

  // If org code provided, verify and switch to that org
  if (orgCode) {
    const { data: org } = await sb.from('organisations')
      .select('id,name').eq('org_code', orgCode).maybeSingle();
    if (!org) {
      window._suppressAuthAutoLoad = false;
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
      window._suppressAuthAutoLoad = false;
      await sb.auth.signOut();
      errEl.textContent = `You don't have access to ${org.name}. Contact the group admin to be added.`;
      errEl.classList.add('show');
      return;
    }
    if (orgProfile.role === 'pending') {
      window._suppressAuthAutoLoad = false;
      await sb.auth.signOut();
      errEl.textContent = `Your access to ${org.name} is pending admin approval.`;
      errEl.classList.add('show');
      return;
    }
    // Force this org context
    _pendingOrgId = org.id;
  }

  // Check if this user needs 2FA — only for founder/admin/treasurer roles
  const { data: profile } = await sb.from('profiles')
    .select('role,full_name,org_id,two_fa_enabled')
    .eq('id', data.user.id).maybeSingle();

  // 2FA is account-level (profile.two_fa_enabled), for admin/treasurer/superadmin roles.
  // Superadmin is included deliberately (Jul 2026 security decision) — platform admin
  // access is the highest-value target on the system and must be 2FA-capable.
  const isElevatedRole = ['admin','treasurer','superadmin'].includes(profile?.role);
  const twoFAEnabled = isElevatedRole && (profile?.two_fa_enabled === true);

  if (twoFAEnabled) {
    // Sign out temporarily, hold session for after OTP
    _2faSession = data;
    _2faProfile = profile;
    await sb.auth.signOut();

    // Send OTP via Edge Function — generated and stored server-side, emailed via Resend
    try {
      const otpRes = await fetch(`${FUNCTIONS_URL}/send-2fa-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ email })
      });
      const otpData = await otpRes.json();
      if (!otpRes.ok || !otpData.success) throw new Error(otpData.error || 'Failed to send code');
    } catch(e) {
      const errEl = document.getElementById('login-error');
      if (errEl) { errEl.textContent = 'Could not send verification code. Please try again.'; errEl.classList.add('show'); }
      _2faSession = null; _2faProfile = null;
      window._suppressAuthAutoLoad = false;
      return;
    }

    // Show 2FA screen
    document.getElementById('auth-step-1').style.display = 'none';
    document.getElementById('auth-step-2fa').style.display = 'block';
    document.getElementById('2fa-sub').textContent =
      `A 6-digit code has been sent to ${email}. Check your inbox.`;
    clearOtpBoxes();
    startResendCooldown(30);
    return;
  }
  // No 2FA needed — the auth listener was suppressed above, so we drive the load
  // ourselves here instead of relying on the SIGNED_IN event.
  window._suppressAuthAutoLoad = false;
  currentUser = data.user;
  await loadProfileAndOrg();
}

async function verify2FA() {
  if (window._verifying2FA) return;
  const entered = document.getElementById('2fa-code').value.trim();
  const errEl = document.getElementById('2fa-error');
  errEl.classList.remove('show');

  if (!entered || entered.length !== 6) {
    errEl.textContent = 'Please enter the 6-digit code';
    errEl.classList.add('show');
    return;
  }

  window._verifying2FA = true;
  const loginEmail = document.getElementById('login-email').value.trim();

  // Verify OTP server-side via Edge Function
  let verifyData;
  try {
    const verifyRes = await fetch(`${FUNCTIONS_URL}/verify-2fa-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ email: loginEmail, code: entered })
    });
    verifyData = await verifyRes.json();
  } catch(e) {
    errEl.textContent = 'Verification failed. Please try again.';
    errEl.classList.add('show');
    shakeOtpBoxes();
    window._verifying2FA = false;
    return;
  }

  if (!verifyData.valid) {
    errEl.textContent = verifyData.error || 'Incorrect code. Please try again.';
    errEl.classList.add('show');
    shakeOtpBoxes();
    setTimeout(clearOtpBoxes, 400);
    window._verifying2FA = false;
    return;
  }

  // Code correct — sign back in with original credentials
  window._suppressAuthAutoLoad = true;
  const loginPass = document.getElementById('login-password').value;
  const { data: signInData, error } = await sb.auth.signInWithPassword({ email: loginEmail, password: loginPass });
  if (error) {
    window._suppressAuthAutoLoad = false;
    window._verifying2FA = false;
    errEl.textContent = 'Could not sign in: ' + error.message;
    errEl.classList.add('show');
    return;
  }

  // Reset 2FA state
  _2faCode = null;
  _2faProfile = null;
  _2faSession = null;
  window._verifying2FA = false;

  // Hide 2FA screen, then drive the load ourselves (listener was suppressed above)
  document.getElementById('auth-step-2fa').style.display = 'none';
  document.getElementById('auth-step-1').style.display = 'block';
  window._suppressAuthAutoLoad = false;
  currentUser = signInData.user;
  await loadProfileAndOrg();
}

async function resend2FACode() {
  const loginEmail = document.getElementById('login-email').value.trim();
  const sucEl = document.getElementById('2fa-success');
  const errEl = document.getElementById('2fa-error');
  if (sucEl) { sucEl.textContent = 'Sending a new code…'; sucEl.classList.add('show'); }
  if (errEl) errEl.classList.remove('show');

  try {
    const otpRes = await fetch(`${FUNCTIONS_URL}/send-2fa-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({ email: loginEmail })
    });
    const otpData = await otpRes.json();
    if (!otpRes.ok || !otpData.success) throw new Error(otpData.error || 'Failed');
    if (sucEl) { sucEl.textContent = '✓ New code sent. Check your inbox.'; }
    clearOtpBoxes();
    startResendCooldown(30);
  } catch(e) {
    if (sucEl) sucEl.classList.remove('show');
    if (errEl) { errEl.textContent = 'Could not resend code. Please sign in again.'; errEl.classList.add('show'); }
  }
}

function cancel2FA() {
  _2faCode = null;
  _2faProfile = null;
  _2faSession = null;
  document.getElementById('auth-step-2fa').style.display = 'none';
  document.getElementById('auth-step-1').style.display = 'block';
}

// signIn defined above

// ── Account-only registration (Step 1) ──
// ── Password strength (min 6 chars, upper, lower, number) — shared by registration
// and any future password-set flows so the rule is consistent everywhere.
function validatePasswordStrength(pw) {
  const checks = {
    len: pw.length >= 6,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    num: /[0-9]/.test(pw),
  };
  const valid = checks.len && checks.upper && checks.lower && checks.num;
  let message = '';
  if (!valid) {
    const missing = [];
    if (!checks.len) missing.push('at least 6 characters');
    if (!checks.upper) missing.push('an uppercase letter');
    if (!checks.lower) missing.push('a lowercase letter');
    if (!checks.num) missing.push('a number');
    message = 'Password needs ' + missing.join(', ');
  }
  return { valid, checks, message };
}

function updatePasswordChecklist(pw) {
  const { checks } = validatePasswordStrength(pw || '');
  const set = (id, met) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle('met', met);
    el.textContent = (met ? '✓ ' : '○ ') + el.textContent.replace(/^[✓○]\s*/, '');
  };
  set('pw-check-len', checks.len);
  set('pw-check-upper', checks.upper);
  set('pw-check-lower', checks.lower);
  set('pw-check-num', checks.num);
}

async function registerAccount() {
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm-password')?.value;
  const errEl = document.getElementById('register-error');
  const sucEl = document.getElementById('register-success');
  errEl.classList.remove('show'); sucEl.classList.remove('show');

  if (!name || !email || !password) { errEl.textContent = 'Please fill in all required fields'; errEl.classList.add('show'); return; }
  const strength = validatePasswordStrength(password);
  if (!strength.valid) { errEl.textContent = strength.message; errEl.classList.add('show'); return; }
  if (confirm !== undefined && confirm !== '' && confirm !== password) { errEl.textContent = 'Passwords do not match'; errEl.classList.add('show'); return; }

  sucEl.textContent = 'Creating your account…'; sucEl.classList.add('show');

  const { data: authData, error: authErr } = await sb.auth.signUp({
    email, password,
    options: {
      data: { full_name: name },
      emailRedirectTo: 'https://app.groupyetu.org/'
    }
  });
  if (authErr) { sucEl.classList.remove('show'); errEl.textContent = authErr.message; errEl.classList.add('show'); return; }

  // Create profile immediately — no org linked yet
  await sb.from('profiles').upsert({
    id: authData.user.id, full_name: name, phone: phone || null, role: 'member'
  });

  sucEl.textContent = '✓ Account created! Check your email to confirm and get started.';
  sucEl.classList.add('show');
  // Do NOT auto sign-in — user must confirm email first (Supabase "Confirm email" is ON)
  // They will be redirected back to the app after clicking the confirmation link.
}

// Backwards-compatible alias
async function registerOrg() { return registerAccount(); }

// ── Org Picker inline helpers ──
function togglePickerCreate() {
  const form = document.getElementById('picker-create-form');
  const joinForm = document.getElementById('picker-join-form');
  if (joinForm) joinForm.style.display = 'none';
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function togglePickerJoin() {
  const form = document.getElementById('picker-join-form');
  const createForm = document.getElementById('picker-create-form');
  if (createForm) createForm.style.display = 'none';
  form.style.display = form.style.display === 'none' ? 'block' : 'none';
}

function selectPickerPlan(el) {
  document.querySelectorAll('.picker-plan-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  const plan = el.dataset.plan;
  document.getElementById('picker-plan-val').value = plan;

  const prompt = document.getElementById('picker-payment-prompt');
  const detailsEl = document.getElementById('picker-payment-details');
  const btn = document.getElementById('picker-create-btn');
  if (!prompt) return;

  if (plan !== 'starter' && !isPromoActive()) {
    const price = (typeof PLAN_PRICES !== 'undefined' && PLAN_PRICES[plan]) || 0;
    const s = _platformSettings || {};
    prompt.style.display = '';
    if (detailsEl) detailsEl.innerHTML = 'Pay Ksh ' + price.toLocaleString() + ' to activate ' + plan.toUpperCase() + ':<br><strong>' + (s.bank_name||'KCB Bank') + '</strong> · Account: <strong>' + (s.bank_account||'—') + '</strong>' + (s.paybill ? ' · Paybill: <strong>' + s.paybill + '</strong>' : '');
    if (btn) btn.textContent = 'Create Group & Submit Payment →';
  } else {
    prompt.style.display = 'none';
    const label = typeof PLAN_LABELS !== 'undefined' ? (PLAN_LABELS[plan]||plan) : plan;
    if (btn) btn.textContent = plan === 'starter' ? 'Create Group →' : 'Create Group & Activate ' + label + ' Free →';
  }
}

function updatePickerPromoTags() {
  const promoOn = isPromoActive();
  const promoDays = parseInt(_platformSettings['promo_days'] || '60');
  document.querySelectorAll('.picker-promo-tag').forEach(el => {
    if (promoOn) {
      el.textContent = `🎉 ${promoDays} days free`;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  });
}

async function pickerCreateOrg() {
  const orgName = document.getElementById('picker-org-name')?.value?.trim();
  const plan    = document.getElementById('picker-plan-val')?.value || 'starter';
  const errEl   = document.getElementById('picker-create-error');
  const sucEl   = document.getElementById('picker-create-success');
  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  if (sucEl) { sucEl.style.display = 'none'; }

  if (!orgName) { if (errEl) { errEl.textContent = 'Please enter a group name'; errEl.style.display = 'block'; } return; }
  if (!currentUser?.id) { if (errEl) { errEl.textContent = 'Session error — please sign in again'; errEl.style.display = 'block'; } return; }

  if (sucEl) { sucEl.textContent = 'Creating group…'; sucEl.style.display = 'block'; }

  const isPaidPlan = plan !== 'starter';
  const promoOn    = isPromoActive();
  const promoDays  = parseInt(_platformSettings['promo_days'] || '60');
  const payRef     = document.getElementById('picker-pay-ref')?.value?.trim();

  // Always create org on Starter first
  const nameInput = document.getElementById('new-org-name');
  const planInput = document.getElementById('new-org-plan');
  const roleInput = document.getElementById('new-org-role');
  if (nameInput) nameInput.value = orgName;
  if (planInput) planInput.value = 'starter'; // always start on starter
  if (roleInput) roleInput.value = 'admin';

  await registerNewOrg();

  // After org created, handle paid plan activation
  if (isPaidPlan && currentOrg?.id) {
    if (promoOn) {
      // Promo ON: activate free trial immediately
      const expires = new Date();
      expires.setDate(expires.getDate() + promoDays);
      const expiresStr = expires.toISOString().split('T')[0];
      try {
        await sb.from('organisations').update({
          plan,
          subscription_status: 'trial',
          subscription_expires: expiresStr,
          trial_used: true,
          trial_start_date: new Date().toISOString().split('T')[0]
        }).eq('id', currentOrg.id);
        Object.assign(currentOrg, { plan, subscription_status:'trial', subscription_expires: expiresStr, trial_used: true });
        buildSidebar();
        toast('✓ ' + (typeof PLAN_LABELS!=='undefined'?PLAN_LABELS[plan]:plan) + ' plan activated free until ' + expires.toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'}));
      } catch(e) { console.error('Trial activation failed:', e); }
    } else if (payRef) {
      // Promo OFF + ref provided: submit payment request
      const price = (typeof PLAN_PRICES!=='undefined' && PLAN_PRICES[plan]) || 0;
      try {
        await sb.from('payment_requests').insert({
          org_id: currentOrg.id,
          user_id: currentUser.id,
          payment_type: 'subscription_' + plan,
          amount: price,
          mpesa_ref: payRef,
          status: 'pending',
          notes: 'New group registration payment'
        });
        toast('✓ Group created on Starter. Payment submitted — ' + (typeof PLAN_LABELS!=='undefined'?PLAN_LABELS[plan]:plan) + ' will be activated after verification.');
      } catch(e) { console.error('Payment request failed:', e); }
    } else {
      // Promo OFF + no ref: just notify them
      setTimeout(() => {
        showBanner('Your group is on Starter. Visit Billing & SMS to upgrade to ' + plan.toUpperCase() + '.', 'info');
      }, 1500);
    }
  }
}

async function pickerJoinOrg() {
  const code = document.getElementById('picker-org-code')?.value?.trim().toUpperCase();
  const errEl = document.getElementById('picker-join-error');
  const sucEl = document.getElementById('picker-join-success');
  if (errEl) { errEl.style.display = 'none'; }
  if (sucEl) { sucEl.style.display = 'none'; }

  if (!code) {
    if (errEl) { errEl.textContent = 'Please enter an org code'; errEl.style.display = 'block'; }
    return;
  }

  // Find org by code
  const { data: org, error } = await sb.from('organisations').select('id,name').eq('org_code', code).maybeSingle();
  if (error || !org) {
    if (errEl) { errEl.textContent = 'Organisation not found. Check the code and try again.'; errEl.style.display = 'block'; }
    return;
  }

  // Submit a pending member request
  try {
    await sb.from('pending_members').insert({
      org_id: org.id,
      user_id: currentUser.id,
      full_name: currentProfile?.full_name || currentUser.email,
      email: currentUser.email,
      phone: currentProfile?.phone || null,
      status: 'pending'
    });
    if (sucEl) { sucEl.textContent = `✓ Request sent to ${org.name}. Your admin will approve you shortly.`; sucEl.style.display = 'block'; }
    if (errEl) errEl.style.display = 'none';
    if (document.getElementById('picker-org-code')) document.getElementById('picker-org-code').value = '';
  } catch(e) {
    if (errEl) { errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block'; }
  }
}

/* ════════════════════════════════════════════════
   MULTI-ORG WORKSPACE SYSTEM
════════════════════════════════════════════════ */

let _userOrgs = []; // all orgs this user belongs to
var currentOrgRole = 'member'; // role in the CURRENT org (from user_orgs, not profiles) — var for global scope

async function loadUserOrgs() {
  if (!currentUser?.id) return [];
  // Step 1: get all user_orgs rows for this user
  try {
    const { data: rows } = await sb.from('user_orgs')
      .select('org_id, role')
      .eq('user_id', currentUser.id);
    if (rows?.length) {
      // Step 2: fetch each org individually — avoids RLS join restriction where
      // policy on organisations checks profiles.org_id (single-org) not user_orgs (multi-org)
      const orgResults = await Promise.all(
        rows.map(r => sb.from('organisations').select('*').eq('id', r.org_id).maybeSingle())
      );
      const loaded = [];
      rows.forEach((r, i) => {
        const org = orgResults[i]?.data;
        if (org && org.id) loaded.push({ ...org, _role: r.role });
      });
      if (loaded.length) {
        _userOrgs = loaded;
        return _userOrgs;
      }
    }
  } catch(e) { console.warn('[GY360] loadUserOrgs error:', e.message); }

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

  // Load platform settings for dynamic promo tags
  await loadPlatformSettings();
  updatePickerPromoTags();

  // Set user name
  const nameEl = document.getElementById('org-picker-user-name');
  if (nameEl) nameEl.textContent = currentProfile?.full_name || currentUser?.email || 'there';

  // Populate left panel stats from platform settings if available
  try {
    const statOrgs = document.getElementById('picker-stat-orgs');
    const statMembers = document.getElementById('picker-stat-members');
    if (statOrgs && _platformSettings) {
      statOrgs.textContent = _platformSettings.total_orgs || '—';
      statMembers.textContent = _platformSettings.total_members || '—';
    }
  } catch(e) {}

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

// ── PLAN GATING UTILITIES ─────────────────────────────────────────────────────

var PLAN_LIMITS = PLAN_LIMITS || { starter: 15, basic: 30, standard: 75, pro: Infinity };
var PLAN_ORDER  = PLAN_ORDER  || ['starter','basic','standard','pro'];

function getEffectivePlan(org) {
  if (!org) return 'starter';
  const plan = org.plan || 'starter';
  const status = org.subscription_status || 'active';
  // If expired → drop to starter regardless of paid plan
  if (status === 'expired') return 'starter';
  return plan;
}

function getPlanMemberLimit(org) {
  return PLAN_LIMITS[getEffectivePlan(org)] ?? 15;
}

function planHasFeature(org, requiredPlan) {
  const effective = getEffectivePlan(org);
  return PLAN_ORDER.indexOf(effective) >= PLAN_ORDER.indexOf(requiredPlan);
}

// Called on app load and org switch — checks expiry and downgrades if lapsed
async function checkSubscriptionStatus() {
  if (!currentOrg?.id || currentOrg.plan === 'starter') return;
  const expires = currentOrg.subscription_expires;
  if (!expires) return;
  const now = new Date(); now.setHours(0,0,0,0);
  const exp = new Date(expires);
  if (exp < now && currentOrg.subscription_status !== 'expired') {
    // Mark expired in DB
    await sb.from('organisations').update({ subscription_status: 'expired' }).eq('id', currentOrg.id);
    currentOrg.subscription_status = 'expired';
    // Rebuild sidebar to reflect downgrade
    buildSidebar();
    showBanner('⚠ Your subscription has expired. You have been moved to the Starter plan. <a href="#" onclick="showPage(\'billing\')">Upgrade now →</a>', 'warning');
  }
}

// Fetch platform settings (promo toggle, payment mode, payment details)
// SECURITY: this runs on every login for every role. platform_settings itself is now
// locked to superadmin-only SELECT at the RLS level, so regular users query the
// platform_settings_public VIEW instead — it only exposes non-sensitive columns
// (no API keys, no Paystack secret, no Daraja credentials).
let _platformSettings = {};
async function loadPlatformSettings() {
  try {
    const { data } = await sb.from('platform_settings_public').select('*').limit(1).maybeSingle();
    _platformSettings = data || {};
  } catch(e) {}
}

function isPromoActive() {
  return _platformSettings['promo_active'] === true || _platformSettings['promo_active'] === 'true';
}

function getPaymentMode() {
  return _platformSettings['payment_mode'] || 'manual';
}
function getManualEnabled() {
  // manual_enabled defaults true unless explicitly disabled
  const v = _platformSettings['manual_enabled'];
  return v === undefined || v === null || v === true || v === 'true';
}
function getPaystackEnabled() {
  const v = _platformSettings['paystack_enabled'];
  return v === true || v === 'true';
}
function getPaystackPublicKey() {
  return _platformSettings['paystack_public_key'] || '';
}

function showBanner(html, type='info') {
  let el = document.getElementById('app-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-banner';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:.6rem 1.2rem;font-size:.82rem;display:flex;align-items:center;justify-content:space-between;gap:1rem';
    document.body.appendChild(el);
  }
  const colors = { warning:'#7c2d12', info:'#1e3a5f', success:'#14532d' };
  const bgs    = { warning:'#fef3c7', info:'#dbeafe', success:'#dcfce7' };
  el.style.background = bgs[type]||bgs.info;
  el.style.color = colors[type]||colors.info;
  el.style.borderBottom = `2px solid ${colors[type]||colors.info}`;
  el.innerHTML = `<span>${html}</span><button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;font-size:1rem;color:inherit">✕</button>`;
}

// showUpgradePrompt() is defined in portal.js (canonical full-page upgrade UX).

async function selectOrg(orgId) {
  // Reset member cache — crucial for multi-org so My Profile/Contributions reload fresh
  window._myMemberId = null;

  // Update active org in profile
  await sb.from('profiles').update({ org_id: orgId }).eq('id', currentUser.id);
  const { data: org } = await sb.from('organisations').select('*').eq('id', orgId).single();
  currentOrg = org;

  // DO NOT re-fetch the raw profiles row here — it stores the global role which can
  // differ from the per-org role in user_orgs (e.g. a user whose profiles.role = 'superadmin'
  // but is 'admin' in a specific org). Re-fetching it caused the brief superadmin flash.
  // currentProfile is already correctly set from the initial login flow.

  currentOrgRole = 'member'; // safe default until user_orgs confirms
  try {
    const { data: uoRow } = await sb.from('user_orgs')
      .select('role').eq('user_id', currentUser.id).eq('org_id', orgId).maybeSingle();
    if (uoRow?.role) {
      currentOrgRole = uoRow.role;
      // Patch currentProfile.role so all downstream checks read the correct per-org role
      if (currentProfile) currentProfile = { ...currentProfile, role: uoRow.role };
    } else {
      // No user_orgs row yet — upsert one using what we know and use it
      const fallbackRole = currentProfile?.role || 'member';
      currentOrgRole = ['superadmin','admin','officer','treasurer','member'].includes(fallbackRole)
        ? (fallbackRole === 'superadmin' ? 'admin' : fallbackRole)
        : 'member';
      await sb.from('user_orgs').upsert({
        user_id: currentUser.id, org_id: orgId, role: currentOrgRole
      }).catch(() => {});
      if (currentProfile) currentProfile = { ...currentProfile, role: currentOrgRole };
    }
  } catch(e) { console.warn('[GY360] user_orgs role fetch failed:', e); }

  // Keep _userOrgs cache in sync
  const cached = _userOrgs.find(o => o.id === orgId);
  if (cached) cached._role = currentOrgRole;
  else _userOrgs.push({ ...org, _role: currentOrgRole });

  // Hide picker, show app
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'none';
  showApp();
  buildOrgSwitcherDropdown();
  // Reload financial profile for new org
  try { await loadOrgFinancialProfile(); } catch(e) {}
  window._finProfileLoadedForOrg = currentOrg?.id; // signal showApp not to reload it

  // Check subscription expiry and enforce plan
  await loadPlatformSettings();
  await checkSubscriptionStatus();

  // Resolve my member record for this org (for self-view detection and founder guard)
  try {
    const email = currentUser?.email;
    const uid = currentUser?.id;
    // Try user_id match first, then fall back to portal_email
    let myMember = null;
    if (uid) {
      const { data: byUid } = await sb.from('members')
        .select('id,is_founder').eq('org_id', orgId).eq('user_id', uid).maybeSingle();
      myMember = byUid;
    }
    if (!myMember && email) {
      const { data: byEmail } = await sb.from('members')
        .select('id,is_founder').eq('org_id', orgId).eq('portal_email', email).maybeSingle();
      myMember = byEmail;
    }
    window._myMemberId = myMember?.id || null;
    window._myMemberIsFounder = myMember?.is_founder || false;
  } catch(e) { console.warn('[GY360] my member lookup failed:', e); }
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
  const errEl = document.getElementById('new-org-error');
  const sucEl = document.getElementById('new-org-success');
  errEl.classList.remove('show'); sucEl.classList.remove('show');

  if (!name) { errEl.textContent='Please enter an organisation name'; errEl.classList.add('show'); return; }

  const orgCode = 'GY' + Math.random().toString(36).toUpperCase().slice(2,6);
  // Always create on Starter — pickerCreateOrg handles paid plan activation separately
  const { data: org, error: orgErr } = await sb.from('organisations')
    .insert({ name, plan: 'starter', status:'active', org_code: orgCode, subscription_status:'active', sms_bundle: 0 })
    .select().single();

  if (orgErr) { errEl.textContent='Error: '+orgErr.message; errEl.classList.add('show'); return; }

  // Founder always gets admin role in their own org regardless of form selection
  await sb.from('user_orgs').upsert({ user_id: currentUser.id, org_id: org.id, role: 'admin' });

  // Update profile role for this new org
  await sb.from('profiles').upsert({
    id: currentUser.id, org_id: org.id, role: 'admin',
    full_name: currentProfile?.full_name || ''
  });

  // Auto-create founder as Member #001 with full founder rule fields
  const founderName = currentProfile?.full_name || currentUser?.email?.split('@')[0] || 'Founder';
  const founderPhone = currentProfile?.phone || null;
  // Auto-create founder as Member #001 via SECURITY DEFINER function (bypasses RLS)
  const { data: founderMember, error: founderErr } = await sb.rpc('insert_founder_member', {
    p_org_id: org.id,
    p_user_id: currentUser.id,
    p_full_name: founderName,
    p_phone: founderPhone,
    p_email: currentUser.email,
    p_join_date: new Date().toISOString().split('T')[0]
  });

  if (founderErr) {
    console.error('[GY360] Founder member insert failed:', founderErr.message);
    errEl.textContent = 'Group created but member auto-enrol failed: ' + founderErr.message;
    errEl.classList.add('show');
  } else {
    window._myMemberId = founderMember || null;
    console.log('[GY360] Founder member created:', founderMember);
  }

  sucEl.textContent = '✓ Organisation created! Switching to it now…';
  sucEl.classList.add('show');

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

function showPasswordResetScreen() {
  // Show auth screen configured for setting a new password after invite/reset link
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.remove('visible');
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'none';
  // Show forgot panel reused for new password entry
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  const forgotPanel = document.getElementById('auth-forgot');
  if (forgotPanel) {
    forgotPanel.classList.add('active');
    // Replace with set-new-password form
    forgotPanel.innerHTML = `
      <div style="margin-bottom:1rem;font-size:.82rem;color:rgba(255,255,255,.7);line-height:1.6">
        Welcome to GroupYetu360! Set a password to complete your account setup.
      </div>
      <div class="form-group">
        <input class="form-input" type="password" id="new-password-input" placeholder="Choose a password (min 6 characters)" style="background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15);color:#fff"/>
      </div>
      <div class="form-group">
        <input class="form-input" type="password" id="new-password-confirm" placeholder="Confirm your password" style="background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.15);color:#fff"/>
      </div>
      <div id="new-password-error" class="auth-error" style="display:none"></div>
      <div id="new-password-success" class="auth-error" style="display:none;color:#4ade80"></div>
      <button class="btn btn-primary" onclick="setNewPassword()" style="width:100%;margin-top:.5rem">
        Set Password & Enter App →
      </button>`;
  }
  const hEl = document.getElementById('auth-form-heading');
  const sEl = document.getElementById('auth-form-sub');
  if (hEl) hEl.textContent = 'Set your password';
  if (sEl) sEl.textContent = 'You were invited to GroupYetu360. Set a password to get started.';
}

async function showEmailConfirmedScreen() {
  // Self-registered user clicked confirmation link — email confirmed, prompt login.
  // _suppressAuthAutoLoad stays true across this signOut() so a still-pending
  // INITIAL_SESSION event (fired from the same session that got us here) can't
  // race in and call loadProfileAndOrg() before we're done showing this screen.
  window._suppressAuthAutoLoad = true;
  await sb.auth.signOut();
  window._suppressAuthAutoLoad = false;
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.remove('visible');
  const picker = document.getElementById('org-picker-screen');
  if (picker) picker.style.display = 'none';
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
  const forgotPanel = document.getElementById('auth-forgot');
  if (forgotPanel) {
    forgotPanel.classList.add('active');
    forgotPanel.innerHTML = `
      <div style="text-align:center;margin-bottom:1.25rem">
        <div style="font-size:2.5rem;margin-bottom:.5rem">✅</div>
        <div style="font-size:.9rem;font-weight:700;color:#fff;margin-bottom:.5rem">Email confirmed!</div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.6);line-height:1.6">
          Your GroupYetu360 account is now active.<br>Sign in with the password you set during registration.
        </div>
      </div>
      <button class="btn btn-primary" onclick="switchAuthTab('login')" style="width:100%;margin-top:.75rem">
        Sign In →
      </button>`;
  }
  const hEl = document.getElementById('auth-form-heading');
  const sEl = document.getElementById('auth-form-sub');
  if (hEl) hEl.textContent = 'Email confirmed';
  if (sEl) sEl.textContent = "You're all set — sign in to get started.";
}

async function setNewPassword() {
  const pw = document.getElementById('new-password-input')?.value?.trim();
  const conf = document.getElementById('new-password-confirm')?.value?.trim();
  const errEl = document.getElementById('new-password-error');
  const sucEl = document.getElementById('new-password-success');
  if (!pw || pw.length < 6) { if(errEl){errEl.textContent='Password must be at least 6 characters';errEl.style.display='block';} return; }
  if (pw !== conf) { if(errEl){errEl.textContent='Passwords do not match';errEl.style.display='block';} return; }
  if(errEl) errEl.style.display='none';
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) { if(errEl){errEl.textContent=error.message;errEl.style.display='block';} return; }
  if(sucEl){sucEl.textContent='✓ Password set! Loading your workspace…';sucEl.style.display='block';}
  setTimeout(async () => {
    try { await loadProfileAndOrg(); } catch(e) { showAuthScreen(); }
  }, 1200);
}

// ── Workspace Picker — My Account panel ──
async function showPickerMyAccount() {
  const panel = document.getElementById('picker-my-account');
  if (!panel) return;
  // Populate fields from currentProfile
  document.getElementById('picker-full-name').value = currentProfile?.full_name || '';
  document.getElementById('picker-phone').value = currentProfile?.phone || '';
  document.getElementById('picker-email').value = currentUser?.email || '';
  // Show 2FA toggle only for admin/treasurer roles
  const twoFaRow = document.getElementById('picker-2fa-row');
  const isElevated = ['admin','treasurer','superadmin'].includes(currentProfile?.role);
  if (twoFaRow) {
    twoFaRow.style.display = isElevated ? 'flex' : 'none';
    if (isElevated) {
      const cb = document.getElementById('picker-2fa');
      cb.checked = currentProfile?.two_fa_enabled || false;
      document.getElementById('picker-2fa-label').textContent = cb.checked ? 'On' : 'Off';
      cb.onchange = () => {
        document.getElementById('picker-2fa-label').textContent = cb.checked ? 'On' : 'Off';
      };
    }
  }
  panel.style.display = 'block';
}

function hidePickerMyAccount() {
  const panel = document.getElementById('picker-my-account');
  if (panel) panel.style.display = 'none';
}

async function savePickerMyAccount() {
  const msgEl = document.getElementById('picker-account-msg');
  const fullName = document.getElementById('picker-full-name').value.trim();
  const phone = document.getElementById('picker-phone').value.trim();
  const email = document.getElementById('picker-email').value.trim();
  const twoFa = document.getElementById('picker-2fa')?.checked || false;
  const isElevated = ['admin','treasurer','superadmin'].includes(currentProfile?.role);

  if (!fullName) { msgEl.textContent = 'Name is required'; msgEl.style.color = 'var(--warning)'; return; }

  try {
    // Update profile
    const updates = { full_name: fullName, phone };
    if (isElevated) updates.two_fa_enabled = twoFa;
    await sb.from('profiles').update(updates).eq('id', currentUser.id);

    // Update email if changed
    if (email && email !== currentUser.email) {
      await sb.auth.updateUser({ email });
    }

    // Update local state
    if (currentProfile) {
      currentProfile.full_name = fullName;
      currentProfile.phone = phone;
      if (isElevated) currentProfile.two_fa_enabled = twoFa;
    }

    msgEl.textContent = '✓ Saved';
    msgEl.style.color = 'var(--teal)';
    setTimeout(() => { msgEl.textContent = ''; hidePickerMyAccount(); }, 1500);
  } catch(e) {
    msgEl.textContent = 'Error: ' + e.message;
    msgEl.style.color = 'var(--warning)';
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
  if (typeof gateQuickActions === 'function') gateQuickActions();
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('input[type="date"]').forEach(el => { if(!el.value) el.value = today; });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    // loadOrgFinancialProfile is called by selectOrg before showApp on multi-org path.
    // On single-org / invite paths (no selectOrg), call it here instead.
    if (!window._finProfileLoadedForOrg || window._finProfileLoadedForOrg !== currentOrg?.id) {
      try { loadOrgFinancialProfile(); } catch(e) { console.error('[GY360] FinProfile error:', e); }
    }
    window._finProfileLoadedForOrg = null; // reset for next org switch
    const _role = currentOrgRole || currentProfile?.role || 'member';
    if (_role === 'superadmin') {
      showPage('superadmin');
    } else if (_role === 'member') {
      // Log member login
      try { logActivity('MEMBER LOGIN', `${currentProfile?.full_name || 'Member'} signed in`, 'member', window._myMemberId || null); } catch(e) {}
      showPage('my_profile');
    } else {
      // Log admin login
      try { logActivity('ADMIN LOGIN', `${currentProfile?.full_name || 'User'} (${_role}) signed in`, 'profile', currentUser?.id || null); } catch(e) {}
      try { loadDashboard(); } catch(e) { console.error('[GY360] Dashboard error:', e); }
    }
    try { prefetchData(); } catch(e) { console.error('[GY360] Prefetch error:', e); }
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
          <button class="topbar-btn outline" onclick="openRecordPaymentModal()">+ Record Payment</button>
          <button class="topbar-btn" onclick="showModal('addMember')">+ Add Member</button>`;
        break;
      case 'finance':
        topbar.innerHTML = `
          <button class="topbar-btn outline" onclick="switchFinTab(document.querySelector('[onclick*=tab-expense-record]'),'tab-expense-record')">+ Expense</button>
          <button class="topbar-btn" onclick="openRecordPaymentModal()">+ Record Payment</button>`;
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
          <button class="topbar-btn outline" onclick="openRecordPaymentModal()">+ Record Payment</button>
          <button class="topbar-btn" onclick="showModal('addMember')">+ Add Member</button>`;
    }
  }
}

function buildNav() {
  const role = currentOrgRole || currentProfile?.role || 'member';
  const isSuperAdmin = role === 'superadmin';
  const isAdmin = role === 'admin' || role === 'officer' || role === 'treasurer' || isSuperAdmin;

  let nav = '';

  if (isSuperAdmin) {
    nav += `<div class="nav-label">Super Admin</div>
    <a class="nav-item active" onclick="showPage('superadmin')" href="#"><span class="nav-icon">⊞</span> Platform Overview</a>
    <a class="nav-item" onclick="showPage('sa_organisations')" href="#"><span class="nav-icon">🏢</span> Organisations</a>
    <a class="nav-item" onclick="showPage('sa_members')" href="#"><span class="nav-icon">◉</span> All Members</a>
    <a class="nav-item" onclick="showPage('sa_finance')" href="#"><span class="nav-icon">₭</span> Revenue</a>
    <a class="nav-item" onclick="showPage('sa_billing')" href="#"><span class="nav-icon">💳</span> Billing</a>
    <a class="nav-item" onclick="showPage('sa_activity')" href="#"><span class="nav-icon">📋</span> Activity Log</a>
    <a class="nav-item" onclick="showPage('sa_support')" href="#"><span class="nav-icon">⚙</span> Platform Settings</a>
    <div class="nav-label" style="margin-top:.5rem">Account</div>
    <a class="nav-item" onclick="showPage('my_account')" href="#"><span class="nav-icon">🔐</span> Account Settings</a>
`;

  } else if (role === 'member') {
    nav += `
    <div class="nav-label">My Portal</div>
    <a class="nav-item active" onclick="showPage('my_profile')" href="#"><span class="nav-icon">◉</span> My Profile</a>
    <a class="nav-item" onclick="showPage('my_contributions')" href="#"><span class="nav-icon">₭</span> My Contributions</a>
    <a class="nav-item" onclick="showPage('my_meetings')" href="#"><span class="nav-icon">◷</span> Meetings</a>
    <a class="nav-item" onclick="showPage('my_notices')" href="#"><span class="nav-icon">✉</span> Notices</a>
    <a class="nav-item" onclick="showPage('faq')" href="#"><span class="nav-icon">❓</span> Help & FAQs</a>
`;

  } else {
    // Admin / officer / treasurer
    const plan = getEffectivePlan(currentOrg);
    const hasBasic = planHasFeature(currentOrg, 'basic');
    const gatedLink = (page, icon, label, ok) => ok
      ? `<a class="nav-item" onclick="showPage('${page}')" href="#"><span class="nav-icon">${icon}</span> ${label}</a>`
      : `<a class="nav-item nav-item-locked" onclick="showUpgradePrompt('${page}');return false" href="#"><span class="nav-icon">${icon}</span> ${label} <span style="margin-left:auto;font-size:.7rem">🔒</span></a>`;

    // ── MAIN (always visible) ──
    nav += `<div class="nav-label">Main</div>
    <a class="nav-item active" onclick="showPage('dashboard')" href="#"><span class="nav-icon">⊞</span> Dashboard</a>
    <a class="nav-item" onclick="showPage('members')" href="#"><span class="nav-icon">◉</span> Members</a>
    <a class="nav-item" onclick="showPage('finance')" href="#"><span class="nav-icon">₭</span> Finance</a>
    <a class="nav-item" onclick="showPage('meetings')" href="#"><span class="nav-icon">◷</span> Meetings</a>`;

    // ── POWER TOOLS (collapsible) ──
    // Officer: read-only, hide SMS/messages; Treasurer: finance tools only
    const showPowerTools = canDo('sendSms') || canDo('manageMGR') || canDo('manageProjects');
    if (showPowerTools) {
      nav += `
      <button class="nav-collapsible" onclick="toggleNavSection('nav-power-tools',this)" aria-expanded="false">
        <span>⚡ Power Tools</span>
        <span class="nav-caret">▾</span>
      </button>
      <div class="nav-collapsible-body" id="nav-power-tools" style="display:none">
        ${canDo('manageMGR') ? `<a class="nav-item nav-item-sub" onclick="showPage('mgr')" href="#"><span class="nav-icon">🔄</span> Rotating Savings</a>` : ''}
        ${canDo('manageMGR') ? gatedLink('welfare','♡','Welfare',hasBasic) : ''}
        ${canDo('manageProjects') ? gatedLink('projects','⚑','Projects',hasBasic) : ''}
        ${canDo('manageMGR') ? gatedLink('table_banking','🏦','Table Banking',hasBasic) : ''}
        ${canDo('sendSms') ? `<a class="nav-item nav-item-sub" onclick="showPage('messages')" href="#"><span class="nav-icon">✉</span> Messages</a>` : ''}
      </div>`;
    }

    // ── MY PORTAL (collapsible) ──
    nav += `
    <button class="nav-collapsible" onclick="toggleNavSection('nav-my-portal',this)" aria-expanded="false">
      <span>◉ My Portal</span>
      <span class="nav-caret">▾</span>
    </button>
    <div class="nav-collapsible-body" id="nav-my-portal" style="display:none">
      <a class="nav-item nav-item-sub" onclick="showPage('my_profile')" href="#"><span class="nav-icon">◉</span> My Profile</a>
      <a class="nav-item nav-item-sub" onclick="showPage('my_contributions')" href="#"><span class="nav-icon">₭</span> My Contributions</a>
      <a class="nav-item nav-item-sub" onclick="showPage('faq')" href="#"><span class="nav-icon">❓</span> Help & FAQs</a>
    </div>`;

    // ── ADMIN (collapsible) ──
    const hasAdminNavItems = canDo('viewApprovals') || canDo('editSettings') || canDo('viewBilling');
    nav += `
    <button class="nav-collapsible" onclick="toggleNavSection('nav-admin-tools',this)" aria-expanded="false">
      <span>⚙ Admin</span>
      <span class="nav-caret">▾</span>
    </button>
    <div class="nav-collapsible-body" id="nav-admin-tools" style="display:none">
      ${canDo('viewApprovals') ? `<a class="nav-item nav-item-sub" onclick="showPage('approvals')" href="#"><span class="nav-icon">✓</span> Approvals <span class="nav-badge" id="approvals-badge" style="display:none">0</span></a>` : ''}
      ${canDo('editSettings') ? `<a class="nav-item nav-item-sub" onclick="showPage('settings')" href="#"><span class="nav-icon">⚙</span> Settings</a>` : ''}
      ${canDo('viewBilling') ? `<a class="nav-item nav-item-sub" onclick="showPage('billing')" href="#"><span class="nav-icon">💳</span> Billing & SMS</a>` : ''}
    </div>`;
  }

  document.getElementById('sidebar-nav').innerHTML = nav;
  buildMobileNav();
  const topbar = document.getElementById('topbar-actions');
  if (isSuperAdmin) {
    topbar.innerHTML = `<button class="topbar-btn" onclick="showModal('addOrg')">+ Onboard Organisation</button>`;
  } else if (role === 'admin' || role === 'officer' || role === 'treasurer') {
    const canAdd = canDo('addMember');
    const canPay = canDo('recordPayment');
    topbar.innerHTML =
      (canPay ? `<button class="topbar-btn outline" onclick="openRecordPaymentModal()">+ Record Payment</button>` : '') +
      (canAdd ? `<button class="topbar-btn" onclick="showModal('addMember')">+ Add Member</button>` : '');
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
  sa_organisations: ['Organisations', 'Every organisation on the platform'],
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
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('mob-backdrop');
  if (sidebar) sidebar.classList.add('mob-open');
  if (backdrop) backdrop.classList.add('visible');
  document.body.style.overflow = 'hidden';
  // Ensure sidebar pull tab shows correct state
  const pull = document.getElementById('sidebar-pull-tab');
  if (pull) pull.classList.add('open');
}

function closeMobileMenu() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('mob-backdrop');
  if (sidebar) sidebar.classList.remove('mob-open');
  if (backdrop) backdrop.classList.remove('visible');
  document.body.style.overflow = '';
  const pull = document.getElementById('sidebar-pull-tab');
  if (pull) pull.classList.remove('open');
}

function toggleNavSection(id, btn) {
  const body = document.getElementById(id);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  btn.setAttribute('aria-expanded', String(!isOpen));
  const caret = btn.querySelector('.nav-caret');
  if (caret) caret.style.transform = isOpen ? '' : 'rotate(180deg)';
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
  // Superadmin: currentOrg gets temporarily set to whatever org they're viewing
  // (via saViewMember / openOrgDetail) so Save/Invite/etc. work correctly while
  // that view is open. Reset it back to the platform placeholder the moment SA
  // navigates to any other SA page, so sidebar branding and other SA pages don't
  // stay stuck showing the last-viewed org.
  if (currentProfile?.role === 'superadmin' && id !== 'sa_org_detail' && currentOrg?.plan !== 'superadmin') {
    currentOrg = { name: 'EPH Technologies', reg_number: 'Platform Admin', plan: 'superadmin' };
  }
  updateMobileNavActive(id);
  // Close mobile menu when navigating
  closeMobileMenu();
  // Mobile member app: add body class to kill topbar/sidebar
  const memberMobPages = ['my_profile','my_contributions','my_meetings','my_notices','my_account'];
  if (memberMobPages.includes(id) && window.innerWidth <= 768) {
    document.body.classList.add('member-mob-active');
    document.body.classList.remove('admin-mob-active');
    setTimeout(updateMobOrgPills, 50);
  } else if (id === 'dashboard' && window.innerWidth <= 768) {
    document.body.classList.add('admin-mob-active');
    document.body.classList.remove('member-mob-active');
    // Set shell height after paint
    setTimeout(() => { if (typeof setAdmMobHeight === 'function') setAdmMobHeight(); }, 80);
  } else {
    document.body.classList.remove('member-mob-active');
    document.body.classList.remove('admin-mob-active');
  }
  // Remove content top padding for pages that start with a full-bleed hero
  const heroPages = ['table_banking','mgr','finance','welfare'];
  if (heroPages.includes(id)) {
    document.body.classList.add('hero-page-active');
  } else {
    document.body.classList.remove('hero-page-active');
  }
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
  const loaders = { members: loadMembers, finance: loadFinance, meetings: loadMeetings, welfare: loadWelfare, projects: loadProjects, mgr: loadMGR, table_banking: loadTableBanking, messages: loadMessages, settings: ()=>typeof loadSettings==='function'&&loadSettings(), superadmin: ()=>typeof loadSuperAdmin==='function'&&loadSuperAdmin(), sa_org_detail: ()=>{}, sa_members: ()=>typeof loadSAMembers==='function'&&loadSAMembers(), sa_finance: ()=>typeof loadSAFinance==='function'&&loadSAFinance(), sa_organisations: ()=>typeof loadSAOrganisations==='function'&&loadSAOrganisations(), my_profile: ()=>typeof loadMyProfile==='function'&&loadMyProfile(), my_contributions: ()=>typeof loadMyContributions==='function'&&loadMyContributions(), approvals: ()=>typeof loadApprovals==='function'&&loadApprovals(), my_account: ()=>typeof loadMyAccount==='function'&&loadMyAccount(), billing: ()=>typeof loadBilling==='function'&&loadBilling(), support: ()=>typeof loadSupport==='function'&&loadSupport(), sa_billing: ()=>typeof loadSABilling==='function'&&loadSABilling(), sa_support: ()=>typeof loadSASupport==='function'&&loadSASupport(), sa_activity: ()=>typeof loadSAActivity==='function'&&loadSAActivity(), my_meetings: ()=>typeof loadMyMeetings==='function'&&loadMyMeetings(), my_notices: ()=>typeof loadMyNotices==='function'&&loadMyNotices() };
  if (loaders[id]) loaders[id]();
  updateTopbarActions(id);
}


// ── Mobile member UI helpers ──
function updateMobOrgPills() {
  const orgName = currentOrg?.name
    ? currentOrg.name.replace(/\b\w/g, c => c.toUpperCase())
    : 'Group';
  const initial = orgName.charAt(0).toUpperCase();
  const shortName = orgName.length > 20 ? orgName.slice(0, 20) + '…' : orgName;

  // Set all org pills
  [['mob-org-dot','mob-org-name'],
   ['mob-fin-org-dot','mob-fin-org-name'],
   ['mob-mtg-org-dot','mob-mtg-org-name'],
   ['mob-notices-org-dot','mob-notices-org-name'],
   ['ma-mob-org-dot','ma-mob-org-name']
  ].forEach(([dotId, nameId]) => {
    const dot = document.getElementById(dotId);
    const name = document.getElementById(nameId);
    if (dot) dot.textContent = initial;
    if (name) name.textContent = shortName;
  });

  // Set greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';
  const greetEl = document.getElementById('mob-greeting');
  if (greetEl) greetEl.textContent = greeting;

  // Set member name
  const firstName = (currentProfile?.full_name || 'Member').split(' ')[0];
  const nameEl = document.getElementById('mob-member-name');
  if (nameEl) nameEl.textContent = firstName;
}
