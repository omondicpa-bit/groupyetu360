

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
// REMOVED (5 Jul 2026): handleAuthRedirect() and updatePassword() used to live here,
// checking window.location.hash for 'type=signup'/'type=recovery' and showing a
// hardcoded password form BEFORE init() ever ran. This silently intercepted every
// confirm-email AND reset-password link (both match this check identically, which
// is exactly why both looked the same to the user) and skipped init() entirely —
// meaning the entire ?intent=confirm|reset|invite routing added to auth.js never
// got a chance to execute. All of that logic now lives in auth.js's init() and
// setNewPassword(), driven by the explicit intent param. See CHANGELOG.md,
// "Registration flow overhaul — the actual fix, round two."

// ── BANK BALANCE AUTO-UPDATE ──
async function updateBankBalance(orgId, amount, direction) {
  // direction: 'credit' for income, 'debit' for expense
  // Uses atomic Postgres RPC — no read-modify-write race condition
  const change = parseFloat(amount) || 0;
  if (!change) return;
  const today = new Date().toISOString().split('T')[0];
  const { data: newBalance, error } = await sb.rpc('update_bank_balance', {
    p_org_id: orgId,
    p_amount: change,
    p_direction: direction,
    p_date: today
  });
  if (error) {
    // A financial balance failing to update must never be invisible — this
    // used to be a silent console.log only, which is exactly what let ADA's
    // balance sit frozen for a week with nobody aware anything was wrong.
    console.error('[GY360] Bank balance update FAILED:', error.message, { orgId, amount, direction });
    toast('⚠ Warning: this was recorded, but the bank balance total failed to update. Please check Settings and contact support if the balance looks wrong.');
    return;
  }
  if (newBalance === null) {
    // RPC ran without error but matched zero rows (e.g. wrong org id) — this
    // should never happen in normal operation, but if it does, it must be
    // just as visible as a thrown error, not silently ignored.
    console.error('[GY360] Bank balance update matched no rows — org_id may be invalid:', orgId);
    toast('⚠ Warning: bank balance total did not update. Please contact support.');
    return;
  }
  // Update local org object so dashboard reflects new balance immediately
  if (currentOrg?.id === orgId) {
    currentOrg.bank_balance = newBalance;
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

  if (typeof loadCollectionRequestsQueue === 'function') loadCollectionRequestsQueue();
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
  // Celcom Africa — sole SMS provider (SMS Leopard / Africa's Talking removed Jul 2026:
  // neither ever worked for orgs in production due to the Supabase free-plan Edge Function
  // DNS restriction, and Leopard's sender ID never got approved. If a replacement/backup
  // provider is onboarded later, add it back here as its own branch.)
  // Celcom Africa
  setVal('sp-celcom-partner-id', s.celcom_partner_id||'');
  setVal('sp-celcom-shortcode',  s.celcom_shortcode||'');
  const celcomSaved = document.getElementById('sp-celcom-saved');
  if (celcomSaved) celcomSaved.style.display = s.celcom_api_key ? 'inline' : 'none';
  const celcomKeyEl = document.getElementById('sp-celcom-key');
  if (celcomKeyEl) celcomKeyEl.placeholder = s.celcom_api_key ? '••••• (saved — leave blank to keep)' : 'Celcom API Key';
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
  setVal('sp-platform-fee-percent', s.platform_fee_percent != null ? s.platform_fee_percent : '0.5');
  setVal('sp-paystack-fee-percent', s.paystack_fee_percent != null ? s.paystack_fee_percent : '1.5');
  if (s.paystack_secret_key) {
    const skEl = document.getElementById('sp-paystack-secret-key');
    if (skEl) skEl.placeholder = '(saved — enter new key to update)';
    const savedEl = document.getElementById('sp-paystack-secret-saved');
    if (savedEl) savedEl.style.display = '';
  }

  // Fingo credentials — same "show saved, blank until re-entered" pattern
  // as Paystack's secret key, never populating the actual secret back into
  // the input.
  setVal('sp-fingo-fee-multiplier', s.fingo_fee_multiplier != null ? s.fingo_fee_multiplier : '2.0');
  if (s.fingo_api_key) {
    const fkEl = document.getElementById('sp-fingo-api-key');
    if (fkEl) fkEl.placeholder = '(saved — enter new key to update)';
    const fkSavedEl = document.getElementById('sp-fingo-key-saved');
    if (fkSavedEl) fkSavedEl.style.display = '';
  }
  if (s.fingo_webhook_secret) {
    const fsEl = document.getElementById('sp-fingo-webhook-secret');
    if (fsEl) fsEl.placeholder = '(saved — enter new secret to update)';
    const fsSavedEl = document.getElementById('sp-fingo-secret-saved');
    if (fsSavedEl) fsSavedEl.style.display = '';
  }

  // Accordion badges
  const payBadge = document.getElementById('sp-paystack-badge');
  if (payBadge) {
    payBadge.textContent = s.paystack_enabled ? 'Live' : 'Disabled';
    payBadge.style.background = s.paystack_enabled ? '#e8f4fd' : '#f5f5f5';
    payBadge.style.color = s.paystack_enabled ? '#0d5c8a' : '#999';
  }
  const smsBadge = document.getElementById('sp-sms-active-badge');
  if (smsBadge) smsBadge.textContent = 'Celcom Africa Active';
  // Webhook hint
  const webhookHint = document.getElementById('sp-paystack-webhook-hint');
  if (webhookHint) {
    webhookHint.style.display = s.paystack_enabled ? '' : 'none';
  }
}

async function saveSupportSettings() {
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
    // SMS provider — Celcom is the sole provider (SMS Leopard/Africa's Talking removed Jul 2026)
    sms_provider: 'celcom',
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
    // Member contribution fee rates (subaccount gross-up)
    platform_fee_percent: parseFloat(document.getElementById('sp-platform-fee-percent')?.value) || 0.5,
    paystack_fee_percent: parseFloat(document.getElementById('sp-paystack-fee-percent')?.value) || 1.5,
    fingo_fee_multiplier: parseFloat(document.getElementById('sp-fingo-fee-multiplier')?.value) || 2.0,
    updated_at:     new Date().toISOString()
  };
  // Only save secret keys if a new one was typed — never overwrite a saved
  // key with blank just because the field wasn't touched this time.
  const newPsSecret = document.getElementById('sp-paystack-secret-key')?.value?.trim();
  if (newPsSecret) payload.paystack_secret_key = newPsSecret;
  const newFingoKey = document.getElementById('sp-fingo-api-key')?.value?.trim();
  if (newFingoKey) payload.fingo_api_key = newFingoKey;
  const newFingoSecret = document.getElementById('sp-fingo-webhook-secret')?.value?.trim();
  if (newFingoSecret) payload.fingo_webhook_secret = newFingoSecret;

  const { error } = await sb.from('platform_settings').upsert(payload);
  if (error) { toast('Error: '+error.message); return; }
  // Refresh _platformSettings so billing cart updates immediately
  if (typeof loadPlatformSettings === 'function') await loadPlatformSettings();
  toast('Settings saved ✓');
}


/* ════════════════════════════════════════════════════
   SMS — UNIFIED SEND LAYER
   Celcom Africa is the sole provider (SMS Leopard / Africa's Talking
   removed Jul 2026 — neither ever worked for orgs in production due to
   the Supabase free-plan Edge Function DNS restriction, and Leopard's
   sender ID was never approved). The `provider` variable and if-branch
   shape are kept deliberately so a future replacement/backup provider
   can be added as its own branch without restructuring this function.
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

// Validate a Kenyan phone number (any input format formatPhone() accepts).
// Used to enforce mandatory phone at registration — format check only, not a
// live/carrier verification (see CHANGELOG.md for the OTP-verification option
// discussed but not built).
function isValidKenyanPhone(phone) {
  const formatted = formatPhone(phone);
  return /^254[17]\d{8}$/.test(formatted);
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

// Unified SMS sender.
// to: array of raw phone strings (will be formatted automatically)
// message: string
// Returns { sent: N, failed: N }
async function sendSMS(to, message, orgIdOverride) {
  if (!to?.length || !message) return { sent: 0, failed: to?.length || 0 };

  const recipients = to.map(formatPhone).filter(Boolean);
  if (!recipients.length) return { sent: 0, failed: 0 };

  // provider is currently always 'celcom' — sms_provider is still read from the safe
  // public view (rather than hardcoded) so a future replacement provider can be switched
  // in via platform_settings without another client-side deploy.
  let provider = 'celcom';
  try {
    const { data: psPublic } = await sb.from('platform_settings_public').select('sms_provider').maybeSingle();
    provider = psPublic?.sms_provider || 'celcom';
  } catch(e) {}

  const SUPABASE_FUNCTIONS_URL = 'https://eengldzvvgplgzvbutal.supabase.co/functions/v1';

  // ── CELCOM AFRICA (via Supabase Edge Function — credentials read server-side) ──
  if (provider === 'celcom') {
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-sms-celcom`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || SUPABASE_KEY}`
        },
        body: JSON.stringify({ message, recipients, org_id: orgIdOverride || currentOrg?.id })
      });
      const result = await res.json();
      console.log('[sendSMS celcom] response:', JSON.stringify(result));
      return { sent: result.sent || 0, failed: result.failed || 0 };
    } catch(e) {
      console.error('sendSMS [celcom] error:', e.message);
      return { sent: 0, failed: recipients.length };
    }
  }

  // ── Add any future replacement/backup provider as its own branch here ──

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

/* ════════════════════════════════════════════════════
   MEMBER CONTRIBUTION FEE CALCULATOR (Paystack subaccounts)
   The org must always receive exactly the net amount the member intends to
   contribute — fees are grossed UP onto the member's charge, never deducted
   from the org's side. This is a gross-up, not a simple "add 2%": adding a
   flat 2% on top of net undercharges by design (1000 * 1.02 = 1020, but
   1020 * 0.98 = 999.60, not 1000) because the fee is taken as a % of the
   GROSS charge, not the net. Dividing by (1 - total fee rate) is the correct
   way to solve for the gross amount that leaves exactly `net` after both
   fees are removed.
════════════════════════════════════════════════════ */
async function getPlatformFeeRates() {
  // Defaults match the 0.5% EPH margin + ~1.5% Paystack rate discussed —
  // always prefer the live values from platform_settings_public so a rate
  // change doesn't require a redeploy.
  let platformFeePercent = 0.5;
  let paystackFeePercent = 1.5;
  try {
    const { data } = await sb.from('platform_settings_public')
      .select('platform_fee_percent,paystack_fee_percent').maybeSingle();
    if (data) {
      if (data.platform_fee_percent != null) platformFeePercent = Number(data.platform_fee_percent);
      if (data.paystack_fee_percent != null) paystackFeePercent = Number(data.paystack_fee_percent);
    }
  } catch(e) {
    console.warn('getPlatformFeeRates: falling back to defaults —', e.message);
  }
  return { platformFeePercent, paystackFeePercent };
}

/**
 * Given the net amount the org must receive, returns the gross amount the
 * member is charged plus a breakdown, so the org's ledger always shows
 * exactly what the member intended to give — never a fee-shaved figure.
 * @param {number} netAmount - the contribution amount as the member understands it
 * @param {number} platformFeePercent - EPH's margin, e.g. 0.5
 * @param {number} paystackFeePercent - Paystack's rate, e.g. 1.5
 */
function calculateGrossCharge(netAmount, platformFeePercent, paystackFeePercent) {
  const totalRate = (platformFeePercent + paystackFeePercent) / 100;
  if (totalRate >= 1) throw new Error('Fee rates cannot total 100% or more');
  const grossExact = netAmount / (1 - totalRate);
  // M-Pesa STK amounts are whole shillings — round up so the org never falls
  // short of `netAmount` by a fraction of a shilling.
  const gross = Math.ceil(grossExact);
  const fee = gross - netAmount;
  // transactionCharge MUST equal `fee` exactly (not platform-share + paystack-share
  // rounded independently) — that's what guarantees gross - transactionCharge =
  // netAmount by construction, with zero rounding drift. Paystack's bearer:
  // 'account' setting means EPH's main account absorbs Paystack's real fee out of
  // this transactionCharge, so any gap between our 1.5% estimate and Paystack's
  // actual fee that transaction comes out of EPH's margin — never the org's side.
  return {
    netAmount,                // exactly what lands in the org's subaccount
    gross,                    // what the member is charged
    fee,                      // gross - net, shown to the member as "service fee"
    transactionCharge: fee    // param for the paystack-charge Edge Function
  };
}

