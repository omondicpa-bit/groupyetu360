

// ── XSS SANITISATION (canonical — utils.js loads before all other page-specific
//    files, so this single definition is safely available to settings.js, auth.js,
//    dashboard.js, finance.js, members.js, portal.js, modules.js) ──
// Use h() on ALL user-supplied strings before interpolating into innerHTML.
function h(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── PLAN CARD SELECTOR ── */
function selectRegPlan(el) {
  document.querySelectorAll('.reg-plan-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const hidden = document.getElementById('reg-plan');
  if (hidden) hidden.value = el.dataset.plan;
}

/* ── PAY PILL SELECTOR ── */
function selectPayPill(el, group) {
  // Toggle the clicked pill (can select one plan + one SMS bundle simultaneously)
  if (el.classList.contains('active')) {
    el.classList.remove('active');
  } else {
    // Deselect others in same group only
    if (group === 'plan') {
      document.querySelectorAll('#pay-plan-pills .pay-pill').forEach(p => p.classList.remove('active'));
    } else {
      document.querySelectorAll('#pay-sms-pills .pay-pill').forEach(p => p.classList.remove('active'));
    }
    el.classList.add('active');
  }
  // Build combined payment type from all active pills
  const planVal = document.querySelector('#pay-plan-pills .pay-pill.active')?.dataset.val || '';
  const smsVal  = document.querySelector('#pay-sms-pills .pay-pill.active')?.dataset.val || '';
  const combined = [planVal, smsVal].filter(Boolean).join('+');
  const hidden = document.getElementById('pay-req-type');
  if (hidden) hidden.value = combined;
  updatePaymentAmount();
}

function toggleFaq(el) {
  const answer = el.nextElementSibling;
  const isOpen = el.classList.contains('open');
  // Close all others in same card
  const card = el.closest('.card-body');
  if (card) {
    card.querySelectorAll('.faq-q.open').forEach(q => {
      q.classList.remove('open');
      q.nextElementSibling.classList.remove('open');
    });
  }
  if (!isOpen) {
    el.classList.add('open');
    answer.classList.add('open');
  }
}

// GroupYetu360 — js/utils.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── HANDLE PASSWORD RESET ──
async function handleAuthRedirect() {
  const hash = window.location.hash;
  // Check for password recovery token in URL
  if (hash && (hash.includes('type=recovery') || hash.includes('type=signup'))) {
    // Let Supabase process the token from URL
    const { data: { session }, error } = await sb.auth.getSession();
    console.log('Auth redirect session:', session, error);
    if (session) {
      // Show password reset form
      document.getElementById('auth-screen').style.display = 'flex';
      document.getElementById('pending-screen').style.display = 'none';
      document.getElementById('app-screen').classList.remove('visible');
      document.querySelectorAll('.auth-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      const loginPanel = document.getElementById('auth-login');
      if (loginPanel) {
        loginPanel.classList.add('active');
        loginPanel.innerHTML = `
          <div style="text-align:center;margin-bottom:1.25rem">
            <div class="auth-logo" style="font-size:1.4rem">GroupYetu<span style="color:var(--gold)">360</span></div>
          </div>
          <div class="auth-error" id="reset-error" style="display:none"></div>
          <div class="auth-success" id="reset-success" style="display:none"></div>
          <div style="font-size:.95rem;font-weight:700;color:var(--ink);margin-bottom:.25rem">Set New Password</div>
          <div style="font-size:.78rem;color:var(--ink-faint);margin-bottom:1.25rem">Enter your new password below.</div>
          <div class="form-group">
            <label class="form-label">New Password</label>
            <input class="form-input" type="password" id="new-password" placeholder="Minimum 6 characters"/>
          </div>
          <div class="form-group">
            <label class="form-label">Confirm Password</label>
            <input class="form-input" type="password" id="confirm-password" placeholder="Repeat new password"/>
          </div>
          <button class="btn btn-primary" onclick="updatePassword()">Update Password</button>`;
      }
      return true;
    }
  }
  return false;
}

async function updatePassword() {
  const newPass = document.getElementById('new-password').value;
  const confirmPass = document.getElementById('confirm-password').value;
  const errEl = document.getElementById('reset-error');
  const sucEl = document.getElementById('reset-success');
  errEl.classList.remove('show'); sucEl.classList.remove('show');
  if (!newPass || newPass.length < 6) { errEl.textContent='Password must be at least 6 characters'; errEl.classList.add('show'); return; }
  if (newPass !== confirmPass) { errEl.textContent='Passwords do not match'; errEl.classList.add('show'); return; }
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) { errEl.textContent = error.message; errEl.classList.add('show'); return; }
  sucEl.textContent = 'Password updated! Signing you in…';
  sucEl.classList.add('show');
  setTimeout(() => window.location.href = window.location.pathname, 2000);
}

// ── BANK BALANCE AUTO-UPDATE ──
async function updateBankBalance(orgId, amount, direction) {
  // direction: 'credit' for income, 'debit' for expense
  // Uses atomic Postgres RPC — no read-modify-write race condition
  try {
    const change = parseFloat(amount) || 0;
    if (!change) return;
    const today = new Date().toISOString().split('T')[0];
    const { data: newBalance, error } = await sb.rpc('update_bank_balance', {
      p_org_id: orgId,
      p_amount: change,
      p_direction: direction,
      p_date: today
    });
    if (error) throw error;
    // Update local org object so dashboard reflects new balance immediately
    if (currentOrg?.id === orgId && newBalance !== null) {
      currentOrg.bank_balance = newBalance;
    }
  } catch(e) {
    console.log('Bank balance update skipped:', e.message);
  }
}

// ── ACTIVITY LOG (Audit Trail) ──
// ── ACCORDION TOGGLE (SA Platform Settings) ──────────────────────────────────
function toggleAccordion(header) {
  const body    = header.nextElementSibling;
  const chevron = header.querySelector('.ps-acc-chevron');
  const isOpen  = body.classList.contains('open');
  // Close all in same page
  const page = header.closest('.page') || document;
  page.querySelectorAll('.ps-accordion-body').forEach(b => b.classList.remove('open'));
  page.querySelectorAll('.ps-accordion-header').forEach(h => h.classList.remove('open'));
  page.querySelectorAll('.ps-acc-chevron').forEach(c => c.classList.remove('open'));
  if (!isOpen) {
    body.classList.add('open');
    header.classList.add('open');
    if (chevron) chevron.classList.add('open');
  }
}

// ── PAYMENT TOGGLE UI (used by SA settings page) ──────────────────────────────
function updatePaymentToggleUI() {
  const manualOn   = document.getElementById('sp-manual-enabled')?.checked !== false;
  const psToggle   = document.getElementById('sp-paystack-enabled-toggle');
  const psModeToggle = document.getElementById('sp-paystack-mode-toggle');
  const paystackOn = psToggle?.checked === true || psModeToggle?.checked === true;

  const setToggle = (uiId, knobId, on) => {
    const ui   = document.getElementById(uiId);
    const knob = document.getElementById(knobId);
    if (ui)   ui.style.background  = on ? 'var(--maroon)' : '#ccc';
    if (knob) knob.style.transform = on ? 'translateX(20px)' : 'translateX(2px)';
  };
  setToggle('sp-manual-toggle-ui',   'sp-manual-knob',        manualOn);
  setToggle('sp-paystack-mode-ui',   'sp-paystack-mode-knob', paystackOn);
  setToggle('sp-paystack-toggle-ui', 'sp-paystack-knob',      paystackOn);

  // Keep both Paystack toggle checkboxes in sync
  if (psToggle)     psToggle.checked     = paystackOn;
  if (psModeToggle) psModeToggle.checked = paystackOn;

  // Webhook hint
  const hint = document.getElementById('sp-paystack-webhook-hint');
  if (hint) hint.style.display = paystackOn ? '' : 'none';

  // Paystack badge
  const badge = document.getElementById('sp-paystack-badge');
  if (badge) {
    badge.textContent       = paystackOn ? 'Live' : 'Disabled';
    badge.style.background  = paystackOn ? '#e8f4fd' : '#f5f5f5';
    badge.style.color       = paystackOn ? '#0d5c8a' : '#999';
  }
}

async function logActivity(action, details, targetType = null, targetId = null) {
  try {
    if (!currentUser?.id) return;
    await sb.from('activity_log').insert({
      org_id: currentOrg?.id || null,
      user_id: currentUser.id,
      user_name: currentProfile?.full_name || currentUser.email,
      user_role: currentProfile?.role || 'unknown',
      action,
      details,
      target_type: targetType,
      target_id: targetId,
      created_at: new Date().toISOString()
    });
  } catch(e) {
    // Silently fail if table doesn't exist yet
    console.log('Activity log skipped:', e.message);
  }
}

// ── ACTIVITY LOG LOADER ──
// loadSAActivity is defined in settings.js (canonical version with proper table/tbody structure)


// ── SUPPORT PAGE ──
async function loadSupport() {
  const el = document.getElementById('support-contact-content');
  if (!el) return;
  // Default values in case platform_settings table doesn't exist yet
  let phone = '0702903544';
  let email = 'info@groupyetu.org';
  let whatsapp = 'https://wa.me/254702903544?text=Hello%20GroupYetu360%20Support';
  try {
    // SECURITY: every user (member, officer, admin) calls this page, and the real
    // platform_settings table is now superadmin-only at the RLS level. Query the
    // public view instead — it only ever exposes non-sensitive columns by design.
    const { data: settings } = await sb.from('platform_settings_public')
      .select('support_phone,support_email,whatsapp').maybeSingle();
    if (settings) {
      phone = settings.support_phone || phone;
      email = settings.support_email || email;
      whatsapp = settings.whatsapp || `https://wa.me/${phone.replace(/^0/,'254').replace(/\s/g,'')}`;
    }
  } catch(e) { console.log('Platform settings not yet created'); }
  const wa = whatsapp || `https://wa.me/${phone.replace(/^0/,'254').replace(/\s/g,'')}`;
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:1.25rem">
      <div style="display:flex;align-items:center;gap:1rem;padding:1rem;background:var(--surface-2);border:1px solid var(--border)">
        <div style="font-size:1.8rem">📞</div>
        <div>
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint)">Phone / WhatsApp</div>
          <div style="font-size:1rem;font-weight:700;color:var(--ink)">${phone}</div>
          <a href="${wa}" target="_blank" style="font-size:.75rem;color:var(--maroon);font-weight:600">Open in WhatsApp →</a>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:1rem;padding:1rem;background:var(--surface-2);border:1px solid var(--border)">
        <div style="font-size:1.8rem">✉️</div>
        <div>
          <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint)">Email</div>
          <div style="font-size:1rem;font-weight:700;color:var(--ink)">${email}</div>
          <a href="mailto:${email}" style="font-size:.75rem;color:var(--maroon);font-weight:600">Send Email →</a>
        </div>
      </div>
      <div style="padding:1rem;background:var(--maroon-pale);border:1px solid var(--maroon-muted)">
        <div style="font-size:.82rem;color:var(--maroon);font-weight:600;margin-bottom:.25rem">Response Times</div>
        <div style="font-size:.75rem;color:var(--ink-soft);line-height:1.7">
          WhatsApp/Phone: Within 2 hours (Mon-Fri 8am-6pm)<br>
          Email: Within 24 hours
        </div>
      </div>
    </div>`;
}

// ── SUPERADMIN BILLING ──
async function loadSABilling() {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysLater = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
  const month = new Date().toISOString().slice(0,7);

  const [pendingRes, orgsRes, smsRes] = await Promise.all([
    sb.from('payment_requests').select('*,organisations(name)').eq('status','pending').order('requested_at',{ascending:false}),
    sb.from('organisations').select('*').order('name'),
    sb.from('sms_usage').select('messages_sent').eq('month', month)
  ]);

  const pending = pendingRes.data||[];
  const orgs = orgsRes.data||[];
  const totalSmsMonth = (smsRes.data||[]).reduce((s,r)=>s+(r.messages_sent||0),0);

  const activeSubs = orgs.filter(o=>o.subscription_status==='active'&&o.plan!=='starter').length;
  const expiringSoon = orgs.filter(o=>o.subscription_expires&&o.subscription_expires<=thirtyDaysLater&&o.subscription_expires>=today).length;

  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('sa-bill-stat-pending', pending.length);
  setEl('sa-bill-stat-active', activeSubs);
  setEl('sa-bill-stat-expiring', expiringSoon);
  setEl('sa-bill-stat-sms', totalSmsMonth.toLocaleString());

  // Pending payments
  const pendEl = document.getElementById('sa-billing-pending');
  if (pendEl) {
    pendEl.innerHTML = pending.length ? `
      <table>
        <thead><tr><th>Organisation</th><th>Type</th><th>Amount</th><th>Reference</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>${pending.map(p=>`<tr>
          <td><strong>${p.organisations?.name||'—'}</strong></td>
          <td>${p.payment_type?.replace(/_/g,' ')}</td>
          <td><strong>Ksh ${Number(p.amount).toLocaleString()}</strong></td>
          <td style="font-family:monospace">${p.reference||'—'}</td>
          <td>${new Date(p.requested_at).toDateString()}</td>
          <td style="display:flex;gap:.4rem">
            <button class="btn btn-primary btn-sm" onclick="approvePayment('${p.id}','${p.org_id}','${p.payment_type}',${p.amount})">Approve</button>
            <button class="btn btn-danger btn-sm" onclick="rejectPayment('${p.id}')">Reject</button>
          </td>
        </tr>`).join('')}</tbody>
      </table>` :
      '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No pending payments</div>';
  }

  // All subscriptions
  const subsEl = document.getElementById('sa-billing-subs');
  if (subsEl) {
    subsEl.innerHTML = `
      <table>
        <thead><tr><th>Organisation</th><th>Plan</th><th>Status</th><th>Expires</th><th>SMS Bundle</th><th>Action</th></tr></thead>
        <tbody>${orgs.map(o=>{
          const expires = o.subscription_expires;
          const daysLeft = expires ? Math.ceil((new Date(expires)-new Date())/(1000*60*60*24)) : null;
          const expClass = daysLeft===null?'':daysLeft<0?'badge-red':daysLeft<30?'badge-warn':'badge-green';
          return `<tr>
            <td><strong>${o.name}</strong></td>
            <td><span class="badge ${o.plan==='pro'?'badge-gold':o.plan==='standard'?'badge-maroon':o.plan==='basic'?'badge-green':'badge-grey'}">${o.plan}</span></td>
            <td><span class="badge ${o.subscription_status==='active'?'badge-green':'badge-red'}">${o.subscription_status||'active'}</span></td>
            <td><span class="badge ${expClass}">${expires?new Date(expires).toDateString()+(daysLeft!==null?` (${daysLeft}d)`:''): 'Not set'}</span></td>
            <td>${o.sms_bundle||0} SMS</td>
            <td><button class="btn btn-secondary btn-sm" onclick="openOrgDetail('${o.id}')">Edit</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>`;
  }
}

async function approvePayment(paymentId, orgId, paymentType, amount) {
  // Determine what to activate
  const updates = {};
  const today = new Date();
  
  // Parse combined payment type e.g. "subscription_standard+sms_bundle_200"
  const parts = paymentType.split('+');
  for (const part of parts) {
    if (part.startsWith('subscription_')) {
      const plan = part.replace('subscription_', '');
      const expiry = new Date(today);
      expiry.setFullYear(expiry.getFullYear() + 1);
      updates.plan = plan;
      updates.subscription_status = 'active';
      updates.subscription_expires = expiry.toISOString().split('T')[0];
      updates.subscription_paid_date = today.toISOString().split('T')[0];
      // No auto-allocate SMS — SMS only added when explicitly purchased
    } else if (part.startsWith('sms_bundle_')) {
      const smsCount = parseInt(part.replace('sms_bundle_','')) || 0;
      const { data: org } = await sb.from('organisations').select('sms_bundle').eq('id', orgId).single();
      updates.sms_bundle = (org?.sms_bundle||0) + smsCount;
    }
  }

  // Update organisation
  await sb.from('organisations').update(updates).eq('id', orgId);
  
  // Mark payment as approved
  await sb.from('payment_requests').update({
    status: 'approved',
    approved_by: currentUser.id,
    approved_at: new Date().toISOString()
  }).eq('id', paymentId);

  toast('Payment approved and subscription activated');
  loadSABilling();
}

async function rejectPayment(paymentId) {
  if (!confirm('Reject this payment request?')) return;
  await sb.from('payment_requests').update({ status: 'rejected', approved_by: currentUser.id, approved_at: new Date().toISOString() }).eq('id', paymentId);
  toast('Payment request rejected');
  loadSABilling();
}

// ── SUPPORT SETTINGS (superadmin) ──
async function loadSASupport() {
  let s = {};
  try {
    const { data: settings } = await sb.from('platform_settings').select('*').maybeSingle();
    if (settings) s = settings;
  } catch(e) { console.log('Platform settings not yet created'); }
  const setVal = (id, val) => { const el=document.getElementById(id); if(el) el.value=val||''; };
  setVal('sp-phone', s.support_phone||'0702903544');
  setVal('sp-email', s.support_email||'info@groupyetu.org');
  setVal('sp-bank-name', s.bank_name||'KCB Bank');
  setVal('sp-bank-account', s.bank_account||'');
  setVal('sp-bank-account-name', s.bank_account_name||'EPH Technologies');
  setVal('sp-paybill', s.paybill||'');
  setVal('sp-whatsapp', s.whatsapp||'https://wa.me/254702903544?text=Hello%20GroupYetu360%20Support');
  // SMS provider selector
  const provEl = document.getElementById('sp-sms-provider');
  if (provEl) provEl.value = s.sms_provider || 'leopard';
  // SMS Leopard
  setVal('sp-leopard-sender', s.sms_leopard_sender_id||'');
  const savedBadge = document.getElementById('sp-leopard-saved');
  if (savedBadge) savedBadge.style.display = s.sms_leopard_api_key ? 'inline' : 'none';
  const keyEl = document.getElementById('sp-leopard-key');
  const secEl = document.getElementById('sp-leopard-secret');
  if (keyEl && !keyEl.value) keyEl.placeholder = s.sms_leopard_api_key ? '••••••••••••• (saved — leave blank to keep)' : 'Your SMS Leopard API Key';
  if (secEl && !secEl.value) secEl.placeholder = s.sms_leopard_api_secret ? '••••••••••••• (saved — leave blank to keep)' : 'Your SMS Leopard API Secret';
  // Celcom Africa
  setVal('sp-celcom-partner-id', s.celcom_partner_id||'');
  setVal('sp-celcom-shortcode',  s.celcom_shortcode||'');
  const celcomSaved = document.getElementById('sp-celcom-saved');
  if (celcomSaved) celcomSaved.style.display = s.celcom_api_key ? 'inline' : 'none';
  const celcomKeyEl = document.getElementById('sp-celcom-key');
  if (celcomKeyEl) celcomKeyEl.placeholder = s.celcom_api_key ? '••••• (saved — leave blank to keep)' : 'Celcom API Key';
  // Africa's Talking (backup)
  setVal('sp-at-username', s.at_username||'');
  setVal('sp-at-key', s.at_api_key||'');
  setVal('sp-at-sender', s.at_sender_id||'');
  setVal('sp-daraja-key', s.daraja_consumer_key||'');
  setVal('sp-daraja-secret', s.daraja_consumer_secret||'');
  setVal('sp-daraja-shortcode', s.daraja_shortcode||'');
  setVal('sp-daraja-passkey', s.daraja_passkey||'');
  const envEl = document.getElementById('sp-daraja-env');
  if (envEl) envEl.value = s.daraja_env || 'sandbox';
  const enabledEl = document.getElementById('sp-daraja-enabled');
  if (enabledEl) enabledEl.value = s.daraja_enabled ? 'true' : 'false';
  // Subscription controls
  const pmEl = document.getElementById('sp-payment-mode');
  if (pmEl) pmEl.value = s.payment_mode || 'manual';
  const promoDaysEl = document.getElementById('sp-promo-days');
  if (promoDaysEl) promoDaysEl.value = s.promo_days || '60';
  const promoEl = document.getElementById('sp-promo-active');
  if (promoEl) { promoEl.checked = s.promo_active === true; if (typeof updatePromoToggleUI === 'function') updatePromoToggleUI(); }

  // Payment method toggles
  const manualToggle = document.getElementById('sp-manual-enabled');
  if (manualToggle) manualToggle.checked = (s.manual_enabled !== false);
  const psToggle = document.getElementById('sp-paystack-enabled-toggle');
  if (psToggle) psToggle.checked = (s.paystack_enabled === true);
  if (typeof updatePaymentToggleUI === 'function') updatePaymentToggleUI();

  // Paystack keys
  const psPublicEl = document.getElementById('sp-paystack-public-key');
  if (psPublicEl) psPublicEl.value = s.paystack_public_key || '';
  if (s.paystack_secret_key) {
    const skEl = document.getElementById('sp-paystack-secret-key');
    if (skEl) skEl.placeholder = '(saved — enter new key to update)';
    const savedEl = document.getElementById('sp-paystack-secret-saved');
    if (savedEl) savedEl.style.display = '';
  }
  // Accordion badges
  const payBadge = document.getElementById('sp-paystack-badge');
  if (payBadge) {
    payBadge.textContent = s.paystack_enabled ? 'Live' : 'Disabled';
    payBadge.style.background = s.paystack_enabled ? '#e8f4fd' : '#f5f5f5';
    payBadge.style.color = s.paystack_enabled ? '#0d5c8a' : '#999';
  }
  const smsBadge = document.getElementById('sp-sms-active-badge');
  if (smsBadge) {
    const pNames = { leopard:'SMS Leopard', celcom:'Celcom Africa', at:"Africa's Talking" };
    smsBadge.textContent = (pNames[s.sms_provider] || 'Celcom Africa') + ' Active';
  }
  // Webhook hint
  const webhookHint = document.getElementById('sp-paystack-webhook-hint');
  if (webhookHint) {
    webhookHint.style.display = s.paystack_enabled ? '' : 'none';
  }
}

async function saveSupportSettings() {
  const atKey = document.getElementById('sp-at-key')?.value?.trim();
  const leopardKey = document.getElementById('sp-leopard-key')?.value?.trim() || undefined;
  const leopardSecret = document.getElementById('sp-leopard-secret')?.value?.trim() || undefined;
  const darajaKey = document.getElementById('sp-daraja-key')?.value?.trim();
  const darajaSecret = document.getElementById('sp-daraja-secret')?.value?.trim();
  const darajaPasskey = document.getElementById('sp-daraja-passkey')?.value?.trim();
  const payload = {
    id: 1,
    support_phone: document.getElementById('sp-phone')?.value?.trim(),
    support_email: document.getElementById('sp-email')?.value?.trim(),
    bank_name: document.getElementById('sp-bank-name')?.value?.trim(),
    bank_account: document.getElementById('sp-bank-account')?.value?.trim(),
    bank_account_name: document.getElementById('sp-bank-account-name')?.value?.trim(),
    paybill: document.getElementById('sp-paybill')?.value?.trim()||null,
    whatsapp: document.getElementById('sp-whatsapp')?.value?.trim()||null,
    // SMS provider
    sms_provider: document.getElementById('sp-sms-provider')?.value || 'leopard',
    // SMS Leopard
    ...(leopardKey !== undefined && { sms_leopard_api_key: leopardKey }),
    ...(leopardSecret !== undefined && { sms_leopard_api_secret: leopardSecret }),
    sms_leopard_sender_id: document.getElementById('sp-leopard-sender')?.value?.trim()||null,
    // Africa's Talking (backup)
    at_username: document.getElementById('sp-at-username')?.value?.trim()||null,
    at_api_key: atKey || null,
    at_sender_id: document.getElementById('sp-at-sender')?.value?.trim()||null,
    // Celcom Africa
    celcom_partner_id: document.getElementById('sp-celcom-partner-id')?.value?.trim()||null,
    celcom_shortcode:  document.getElementById('sp-celcom-shortcode')?.value?.trim()||null,
    ...(document.getElementById('sp-celcom-key')?.value?.trim() ? { celcom_api_key: document.getElementById('sp-celcom-key').value.trim() } : {}),
    daraja_consumer_key: darajaKey || null,
    daraja_consumer_secret: darajaSecret || null,
    daraja_shortcode: document.getElementById('sp-daraja-shortcode')?.value?.trim()||null,
    daraja_passkey: darajaPasskey || null,
    daraja_env: document.getElementById('sp-daraja-env')?.value || 'sandbox',
    daraja_enabled: document.getElementById('sp-daraja-enabled')?.value === 'true',
    payment_mode:   document.getElementById('sp-payment-mode')?.value || 'manual',
    promo_active:   document.getElementById('sp-promo-active')?.checked === true,
    promo_days:     document.getElementById('sp-promo-days')?.value || '60',
    // Payment method toggles
    manual_enabled:   document.getElementById('sp-manual-enabled')?.checked !== false,
    paystack_enabled: document.getElementById('sp-paystack-enabled-toggle')?.checked === true,
    // Paystack keys
    paystack_public_key: document.getElementById('sp-paystack-public-key')?.value?.trim() || null,
    updated_at:     new Date().toISOString()
  };
  // Only save secret key if a new one was typed
  const newPsSecret = document.getElementById('sp-paystack-secret-key')?.value?.trim();
  if (newPsSecret) payload.paystack_secret_key = newPsSecret;

  const { error } = await sb.from('platform_settings').upsert(payload);
  if (error) { toast('Error: '+error.message); return; }
  // Refresh _platformSettings so billing cart updates immediately
  if (typeof loadPlatformSettings === 'function') await loadPlatformSettings();
  toast('Settings saved ✓');
}


/* ════════════════════════════════════════════════════
   SMS — UNIFIED SEND LAYER
   Routes to SMS Leopard (primary) or Africa's Talking (backup)
   based on platform_settings.sms_provider
════════════════════════════════════════════════════ */

// Format a phone number to E.164 (254XXXXXXXXX)
function formatPhone(phone) {
  if (!phone) return '';
  let p = phone.toString().replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+254')) return p.replace('+', '');
  if (p.startsWith('254')) return p;
  if (p.startsWith('0')) return '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) return '254' + p;
  return p;
}

// Track SMS usage: logs to sms_usage, deducts from sms_bundle, auto-disables 2FA if balance hits 0
async function trackSmsUsage(orgId, count) {
  if (!orgId || !count) return;
  try {
    const month = new Date().toISOString().slice(0, 7);
    // Upsert monthly usage log
    const { data: existing } = await sb.from('sms_usage')
      .select('id, messages_sent').eq('org_id', orgId).eq('month', month).maybeSingle();
    if (existing) {
      await sb.from('sms_usage').update({
        messages_sent: (existing.messages_sent || 0) + count
      }).eq('id', existing.id);
    } else {
      await sb.from('sms_usage').insert({ org_id: orgId, month, messages_sent: count });
    }
    // Deduct from sms_bundle + increment sms_used total
    const { data: org } = await sb.from('organisations')
      .select('sms_bundle, sms_used, two_fa_enabled').eq('id', orgId).single();
    if (org) {
      const newBundle = Math.max(0, (org.sms_bundle || 0) - count);
      const newUsed   = (org.sms_used || 0) + count;
      const updates   = { sms_bundle: newBundle, sms_used: newUsed };
      // Auto-disable 2FA when bundle runs out
      if (newBundle === 0 && org.two_fa_enabled) {
        updates.two_fa_enabled = false;
        console.warn('[trackSmsUsage] SMS bundle exhausted — 2FA auto-disabled for org', orgId);
      }
      await sb.from('organisations').update(updates).eq('id', orgId);
      if (currentOrg?.id === orgId) {
        currentOrg.sms_bundle = newBundle;
        currentOrg.sms_used   = newUsed;
        if (updates.two_fa_enabled === false) currentOrg.two_fa_enabled = false;
      }
    }
  } catch(e) {
    console.log('trackSmsUsage error:', e.message);
  }
}

// Unified SMS sender — reads sms_provider from platform_settings
// to: array of raw phone strings (will be formatted automatically)
// message: string
// Returns { sent: N, failed: N }
async function sendSMS(to, message) {
  if (!to?.length || !message) return { sent: 0, failed: to?.length || 0 };

  const recipients = to.map(formatPhone).filter(Boolean);
  if (!recipients.length) return { sent: 0, failed: 0 };

  // Load platform settings
  // sms_provider itself isn't sensitive — read it from the safe public view so this works
  // for every role. The raw table read below (SA-only) fills in leopard/AT secrets when
  // available; celcom needs no secrets here at all since the Edge Function reads them
  // server-side now.
  let provider = 'celcom';
  let leopardKey = null, leopardSecret = null, senderId = null;
  let atKey = null, atUser = 'sandbox', atSender = null;

  try {
    const { data: psPublic } = await sb.from('platform_settings_public').select('sms_provider').maybeSingle();
    provider = psPublic?.sms_provider || 'celcom';
  } catch(e) {}

  if (provider !== 'celcom') {
    try {
      const { data: ps } = await sb.from('platform_settings').select('*').maybeSingle();
      if (ps) {
        leopardKey = ps.sms_leopard_api_key || null;
        leopardSecret = ps.sms_leopard_api_secret || null;
        senderId = ps.sms_leopard_sender_id || null;
        atKey = ps.at_api_key || null;
        atUser = ps.at_username || 'sandbox';
        atSender = ps.at_sender_id || null;
      }
    } catch(e) {
      console.log('sendSMS: could not load platform settings for leopard/AT');
    }
  }

  const SUPABASE_FUNCTIONS_URL = 'https://eengldzvvgplgzvbutal.supabase.co/functions/v1';

  // ── SMS LEOPARD (direct browser call — avoids Supabase Edge Function DNS restriction) ──
  if (provider === 'leopard') {
    if (!leopardKey || !leopardSecret) {
      console.error('sendSMS [leopard]: API key/secret not configured in platform_settings');
      return { sent: 0, failed: recipients.length };
    }
    try {
      const destination = recipients.map(number => ({ number }));
      // Basic Auth: base64(API_KEY:API_SECRET)
      const basicAuth = btoa(`${leopardKey}:${leopardSecret}`);
      const res = await fetch('https://api.smsleopard.com/v1/sms/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${basicAuth}`
        },
        body: JSON.stringify({
          source: senderId || 'SMS_Leopard',
          message,
          destination
        })
      });
      const result = await res.json();
      console.log('[sendSMS leopard] response:', JSON.stringify(result));
      if (!res.ok) throw new Error(result?.message || `HTTP ${res.status}`);
      // Leopard returns { successes: [{number,messageid}], errors: [{...}] }
      const sent = result?.successes?.length ?? (result?.sent ?? 0);
      const failed = result?.errors?.length ?? (result?.failed ?? 0);
      if (failed > 0) console.warn('[sendSMS leopard] failures:', JSON.stringify(result?.errors));
      return { sent, failed };
    } catch(e) {
      console.error('sendSMS [leopard] error:', e.message);
      return { sent: 0, failed: recipients.length };
    }
  }

  // ── CELCOM AFRICA (via Supabase Edge Function — credentials read server-side) ──
  if (provider === 'celcom') {
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-celcom`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({ message, recipients })
      });
      const result = await res.json();
      console.log('[sendSMS celcom] response:', JSON.stringify(result));
      return { sent: result.sent || 0, failed: result.failed || 0 };
    } catch(e) {
      console.error('sendSMS [celcom] error:', e.message);
      return { sent: 0, failed: recipients.length };
    }
  }

  // ── AFRICA'S TALKING (backup, via Edge Function) ──
  if (provider === 'at') {
    if (!atKey) return { sent: 0, failed: recipients.length };
    try {
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        body: JSON.stringify({
          username: atUser,
          apiKey: atKey,
          to: recipients,
          message,
          senderId: atSender
        })
      });
      const result = await res.json();
      return { sent: result.sent || 0, failed: result.failed || 0 };
    } catch(e) {
      console.error('sendSMS [at] error:', e.message);
      return { sent: 0, failed: recipients.length };
    }
  }

  console.warn('sendSMS: unknown provider', provider);
  return { sent: 0, failed: recipients.length };
}


/* ════ DYNAMIC ORG FINANCIAL PROFILE ════
   Reads contribution_types to determine what this org uses
════════════════════════════════════════════════════ */
let orgFinProfile = {
  hasShares: false,
  hasSavings: false,
  hasAdminIncome: false,
  hasWelfare: false,
  hasMGR: false,
  hasTableBanking: false,
  // labels
  sharesLabel: 'Shares',
  savingsLabel: 'Savings',
  adminIncomeLabel: 'Contributions',
  // type IDs for filtering
  shareTypeIds: [],
  savingsTypeIds: [],
  adminIncomeTypeIds: [],
  welfareTypeIds: [],
  allLoaded: false
};

async function loadOrgFinancialProfile() {
  if (!currentOrg?.id) return;

  const { data: types } = await sb.from('contribution_types')
    .select('*').eq('org_id', currentOrg.id);
  const allTypes = types || [];

  // Reset
  orgFinProfile = {
    hasShares: false, hasSavings: false, hasAdminIncome: false,
    hasWelfare: false, hasMGR: false, hasTableBanking: false,
    sharesLabel: 'Shares', savingsLabel: 'Savings', adminIncomeLabel: 'Contributions',
    shareTypeIds: [], savingsTypeIds: [], adminIncomeTypeIds: [], welfareTypeIds: [],
    allLoaded: false
  };

  allTypes.forEach(t => {
    const it = t.income_type || 'admin_income';
    if (it === 'member_shares') {
      orgFinProfile.hasShares = true;
      orgFinProfile.shareTypeIds.push(t.id);
      orgFinProfile.sharesLabel = t.name || 'Shares';
    } else if (it === 'member_savings') {
      orgFinProfile.hasSavings = true;
      orgFinProfile.savingsTypeIds.push(t.id);
      orgFinProfile.savingsLabel = t.name || 'Savings';
    } else if (it === 'welfare') {
      orgFinProfile.hasWelfare = true;
      orgFinProfile.welfareTypeIds.push(t.id);
    } else if (it === 'mgr') {
      orgFinProfile.hasMGR = true;
    } else if (it === 'table_banking') {
      orgFinProfile.hasTableBanking = true;
    } else {
      // admin_income, fine, fee, subscription etc
      orgFinProfile.hasAdminIncome = true;
      orgFinProfile.adminIncomeTypeIds.push(t.id);
      if (!orgFinProfile.adminIncomeLabel || orgFinProfile.adminIncomeLabel === 'Contributions') {
        orgFinProfile.adminIncomeLabel = t.name || 'Contributions';
      }
    }
  });

  // Check for MGR cycles
  if (!orgFinProfile.hasMGR) {
    try {
      const { data: rounds } = await sb.from('savings_rounds').select('id').eq('org_id', currentOrg.id).limit(1);
      if (rounds?.length) orgFinProfile.hasMGR = true;
    } catch(e) {}
  }

  // Check for table banking
  if (!orgFinProfile.hasTableBanking) {
    try {
      const { data: pools } = await sb.from('table_banking_pools').select('id').eq('org_id', currentOrg.id).limit(1);
      if (pools?.length) orgFinProfile.hasTableBanking = true;
    } catch(e) {}
  }

  orgFinProfile.allLoaded = true;
  console.log('[GY360] Org Financial Profile:', orgFinProfile);
}


/* ════════════════════════════════════════════════════
   DYNAMIC BALANCE CARDS — My Profile
════════════════════════════════════════════════════ */
function renderMemberBalanceCards(myRecord, totalContributed) {
  const fp = orgFinProfile;
  const container = document.getElementById('mp-bal-cards-container');
  if (!container || !myRecord) return;

  const cards = [];

  if (fp.hasShares) {
    cards.push({ label: fp.sharesLabel, value: 'Ksh ' + Number(myRecord.shares_balance||0).toLocaleString(), meta: 'Equity in the group', delay: 0 });
  }
  if (fp.hasSavings) {
    cards.push({ label: fp.savingsLabel, value: 'Ksh ' + Number(myRecord.savings_balance||0).toLocaleString(), meta: 'Monthly deposits', delay: .08 });
  }
  if (!fp.hasShares && !fp.hasSavings) {
    // Welfare / subscription only — show total contributed
    cards.push({ label: 'Total Contributed', value: 'Ksh ' + Number(totalContributed||0).toLocaleString(), meta: 'Your group involvement', delay: 0 });
  }
  if (fp.hasShares || fp.hasSavings) {
    const total = Number(myRecord.shares_balance||0) + Number(myRecord.savings_balance||0);
    cards.push({ label: 'Total Holdings', value: 'Ksh ' + total.toLocaleString(), meta: 'Combined balance', delay: .16 });
  }
  if (fp.hasAdminIncome && totalContributed > 0 && (fp.adminIncomeLabel||'').toLowerCase() !== 'fine') {
    cards.push({ label: fp.adminIncomeLabel + ' Paid', value: 'Ksh ' + Number(totalContributed||0).toLocaleString(), meta: 'Total contributions to group', delay: .24 });
  }

  container.innerHTML = cards.map((c, i) => `
    <div class="mp-bal-card" style="animation-delay:${c.delay}s">
      <div class="mp-bal-label">${c.label}</div>
      <div class="mp-bal-value" style="color:${i===0?'var(--maroon)':i===1?'var(--teal)':'var(--gold)'}">${c.value}</div>
      <div class="mp-bal-meta">${c.meta}</div>
    </div>`).join('');
}

/* ════════════════════════════════════════════════════
   DYNAMIC DASHBOARD STAT CARDS
════════════════════════════════════════════════════ */
function renderDashboardModules(members, txns, projs) {
  const fp = orgFinProfile;
  // Update the "Active Projects" card visibility
  const projCard = document.getElementById('dash-projects-card');
  if (projCard) {
    const shouldShow = fp.hasShares || fp.hasSavings || fp.hasAdminIncome;
    // Projects always show if org uses them
    projCard.style.display = projs?.length === 0 && !fp.hasShares && !fp.hasSavings ? 'none' : '';
  }

  // Update MGR dashboard card
  const mgrCard = document.getElementById('dash-mgr-card');
  if (mgrCard) mgrCard.style.display = fp.hasMGR ? '' : 'none';

  // Update Table Banking dashboard card
  const tbCard = document.getElementById('dash-tb-card');
  if (tbCard) tbCard.style.display = fp.hasTableBanking ? '' : 'none';
}


/* ════════════════════════════════════════════════════
   ROLE-BASED PERMISSION GATING
   Single source of truth for all canDo() checks.
   Roles: superadmin > admin > treasurer > officer > member
════════════════════════════════════════════════════ */
function canDo(action) {
  const role = (typeof currentOrgRole !== 'undefined' ? currentOrgRole : null)
    || currentProfile?.role || 'member';

  const rules = {
    // Member management
    addMember:        ['superadmin','admin'],
    editMember:       ['superadmin','admin'],
    deleteMember:     ['superadmin'],
    inviteMember:     ['superadmin','admin'],
    setPortalRole:    ['superadmin','admin'],
    approveMember:    ['superadmin','admin'],

    // Finance
    recordPayment:    ['superadmin','admin','treasurer'],
    deleteTransaction:['superadmin','admin','treasurer'],
    editFinanceSettings: ['superadmin','admin','treasurer'],

    // Meetings
    createMeeting:    ['superadmin','admin','officer'],
    editMeeting:      ['superadmin','admin','officer'],

    // Power Tools
    sendSms:          ['superadmin','admin'],
    manageProjects:   ['superadmin','admin'],
    manageMGR:        ['superadmin','admin','treasurer'],

    // Org settings
    editSettings:     ['superadmin','admin'],
    viewBilling:      ['superadmin','admin'],
    viewApprovals:    ['superadmin','admin'],

    // View-only (read)
    viewFinance:      ['superadmin','admin','treasurer','officer'],
    viewMembers:      ['superadmin','admin','treasurer','officer'],
  };

  return (rules[action] || []).includes(role);
}
