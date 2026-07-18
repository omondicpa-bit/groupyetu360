

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
  if (typeof loadBroadcastHistory === 'function') loadBroadcastHistory();
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
    // Calls a SECURITY DEFINER RPC rather than a raw `select('*')` on
    // platform_settings — that raw select used to pull every provider's
    // actual secret key into the browser (visible in the Network tab, held
    // in JS memory) even though the UI politely only showed a "SAVED"
    // badge for most of them. This RPC returns "is it configured" booleans
    // instead of the real secret values — it's not possible for it to leak
    // one, since the secret columns never appear in its SELECT list at all.
    const { data: rows, error } = await sb.rpc('get_platform_settings_safe');
    if (error) throw error;
    if (rows?.[0]) s = rows[0];
  } catch(e) { console.log('Platform settings not yet created, or RPC not deployed yet:', e.message); }
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
  if (celcomSaved) celcomSaved.style.display = s.celcom_api_key_set ? 'inline' : 'none';
  const celcomKeyEl = document.getElementById('sp-celcom-key');
  if (celcomKeyEl) celcomKeyEl.placeholder = s.celcom_api_key_set ? '••••• (saved — leave blank to keep)' : 'Celcom API Key';
  // Daraja removed — Fingo + Paystack are the only two payment providers
  // going forward, per Felix's explicit decision. DB columns left in
  // place, inert (same precedent as SMS Leopard/Africa's Talking removal).
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
  if (s.paystack_secret_key_set) {
    const skEl = document.getElementById('sp-paystack-secret-key');
    if (skEl) skEl.placeholder = '(saved — enter new key to update)';
    const savedEl = document.getElementById('sp-paystack-secret-saved');
    if (savedEl) savedEl.style.display = '';
  }

  // Fingo credentials — same "show saved, blank until re-entered" pattern
  // as Paystack's secret key, never populating the actual secret back into
  // the input.
  setVal('sp-fingo-fee-multiplier', s.fingo_fee_multiplier != null ? s.fingo_fee_multiplier : '2.0');
  if (s.fingo_api_key_set) {
    const fkEl = document.getElementById('sp-fingo-api-key');
    if (fkEl) fkEl.placeholder = '(saved — enter new key to update)';
    const fkSavedEl = document.getElementById('sp-fingo-key-saved');
    if (fkSavedEl) fkSavedEl.style.display = '';
  }
  if (s.fingo_webhook_secret_set) {
    const fsEl = document.getElementById('sp-fingo-webhook-secret');
    if (fsEl) fsEl.placeholder = '(saved — enter new secret to update)';
    const fsSavedEl = document.getElementById('sp-fingo-secret-saved');
    if (fsSavedEl) fsSavedEl.style.display = '';
  }

  // Push notifications (VAPID) — public key is safe to show as-is (it's
  // meant to be public), private key follows the same never-render pattern.
  setVal('sp-vapid-public-key', s.vapid_public_key || '');
  if (s.vapid_private_key_set) {
    const vpEl = document.getElementById('sp-vapid-private-key');
    if (vpEl) vpEl.placeholder = '(saved — enter new key to update)';
    const vpSavedEl = document.getElementById('sp-vapid-private-saved');
    if (vpSavedEl) vpSavedEl.style.display = '';
  }
  const vapidBadge = document.getElementById('sp-vapid-badge');
  if (vapidBadge) {
    const configured = !!(s.vapid_public_key && s.vapid_private_key_set);
    vapidBadge.textContent = configured ? 'Active' : 'Not configured';
    vapidBadge.style.background = configured ? '#e8f5e9' : '#f5f5f5';
    vapidBadge.style.color = configured ? '#2e7d32' : '#999';
  }

  // SasaPay — same never-render-the-real-secret pattern as everything else
  setVal('sp-sasapay-merchant-code', s.sasapay_merchant_code || '');
  setVal('sp-sasapay-base-url', s.sasapay_base_url || 'https://api.sasapay.app');
  setVal('sp-sasapay-fee-percent', s.sasapay_fee_percent != null ? s.sasapay_fee_percent : '0.2');
  setVal('sp-sasapay-platform-fee-percent', s.sasapay_platform_fee_percent != null ? s.sasapay_platform_fee_percent : '1.3');
  if (s.sasapay_client_id_set) {
    const scEl = document.getElementById('sp-sasapay-client-id');
    if (scEl) scEl.placeholder = '(saved — enter new Client ID to update)';
    const scSavedEl = document.getElementById('sp-sasapay-client-saved');
    if (scSavedEl) scSavedEl.style.display = '';
  }
  if (s.sasapay_client_secret_set) {
    const ssEl = document.getElementById('sp-sasapay-client-secret');
    if (ssEl) ssEl.placeholder = '(saved — enter new Client Secret to update)';
    const ssSavedEl = document.getElementById('sp-sasapay-secret-saved');
    if (ssSavedEl) ssSavedEl.style.display = '';
  }
  const subProvEl = document.getElementById('sp-subscription-provider');
  if (subProvEl) subProvEl.value = s.subscription_payment_provider || 'paystack';

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
    vapid_public_key: document.getElementById('sp-vapid-public-key')?.value?.trim() || null,
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
  const newVapidPrivate = document.getElementById('sp-vapid-private-key')?.value?.trim();
  if (newVapidPrivate) payload.vapid_private_key = newVapidPrivate;

  // SasaPay
  payload.sasapay_merchant_code = document.getElementById('sp-sasapay-merchant-code')?.value?.trim() || null;
  payload.sasapay_base_url = document.getElementById('sp-sasapay-base-url')?.value?.trim() || 'https://api.sasapay.app';
  payload.sasapay_fee_percent = parseFloat(document.getElementById('sp-sasapay-fee-percent')?.value) || 0.2;
  payload.sasapay_platform_fee_percent = parseFloat(document.getElementById('sp-sasapay-platform-fee-percent')?.value) || 1.3;
  payload.subscription_payment_provider = document.getElementById('sp-subscription-provider')?.value || 'paystack';
  const newSasapayClientId = document.getElementById('sp-sasapay-client-id')?.value?.trim();
  if (newSasapayClientId) payload.sasapay_client_id = newSasapayClientId;
  const newSasapayClientSecret = document.getElementById('sp-sasapay-client-secret')?.value?.trim();
  if (newSasapayClientSecret) payload.sasapay_client_secret = newSasapayClientSecret;

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
  let fingoFeeMultiplier = 2.0;
  let sasapayFeePercent = 0.2;
  let sasapayPlatformFeePercent = 1.3;
  try {
    const { data } = await sb.from('platform_settings_public')
      .select('platform_fee_percent,paystack_fee_percent,fingo_fee_multiplier,sasapay_fee_percent,sasapay_platform_fee_percent').maybeSingle();
    if (data) {
      if (data.platform_fee_percent != null) platformFeePercent = Number(data.platform_fee_percent);
      if (data.paystack_fee_percent != null) paystackFeePercent = Number(data.paystack_fee_percent);
      if (data.fingo_fee_multiplier != null) fingoFeeMultiplier = Number(data.fingo_fee_multiplier);
      if (data.sasapay_fee_percent != null) sasapayFeePercent = Number(data.sasapay_fee_percent);
      if (data.sasapay_platform_fee_percent != null) sasapayPlatformFeePercent = Number(data.sasapay_platform_fee_percent);
    }
  } catch(e) {
    console.warn('getPlatformFeeRates: falling back to defaults —', e.message);
  }
  return { platformFeePercent, paystackFeePercent, fingoFeeMultiplier, sasapayFeePercent, sasapayPlatformFeePercent };
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

/* ════════════════════════════════════════════════════
   FINGO FEE CALCULATOR — tiered lookup, not a percentage
   Fingo's own published rate (docs.fingopay.io / dashboard Tariff & Fees) is
   a flat fee per amount band, not a %. EPH's margin for Fingo is a
   multiplier on Fingo's own fee (Felix's "double their fee" approach —
   matches what Fingo itself earns, doubled), not a separate percentage like
   the Paystack model. Bands below are Fingo's own published M-Pesa
   Collections tariff as at Jul 2026 — re-verify against their dashboard if
   this is ever revisited, since Fingo could change these independently of
   anything in this codebase.
════════════════════════════════════════════════════ */
const FINGO_FEE_BANDS = [
  [1, 49, 2], [50, 100, 2], [101, 500, 5], [501, 1000, 9],
  [1001, 1500, 14], [1501, 2500, 22], [2501, 3500, 16], [3501, 5000, 21],
  [5001, 7500, 26], [7501, 10000, 29], [10001, 15000, 69], [15001, 20000, 75],
  [20001, 25000, 81], [25001, 30000, 87],
];

function fingoBaseFeeForAmount(amount) {
  for (const [min, max, fee] of FINGO_FEE_BANDS) {
    if (amount >= min && amount <= max) return fee;
  }
  // Beyond the published table — use the highest published band's fee
  // rather than fail outright; worth re-checking Fingo's dashboard if
  // amounts routinely land here.
  return FINGO_FEE_BANDS[FINGO_FEE_BANDS.length - 1][2];
}

/**
 * Given the net amount the org must receive, returns the gross Fingo
 * charge. Unlike Paystack's percentage-based gross-up (a closed-form
 * division), Fingo's fee depends on which BAND the gross amount itself
 * falls into — so this converges iteratively (a handful of passes is
 * always enough since the bands are coarse relative to typical amounts).
 * @param {number} netAmount
 * @param {number} feeMultiplier - EPH's margin as a multiple of Fingo's own fee, e.g. 2.0
 */
function calculateFingoGrossCharge(netAmount, feeMultiplier) {
  let gross = netAmount;
  for (let i = 0; i < 6; i++) {
    const baseFee = fingoBaseFeeForAmount(gross);
    const totalFee = Math.round(baseFee * feeMultiplier);
    const newGross = netAmount + totalFee;
    if (newGross === gross) break;
    gross = newGross;
  }
  const baseFee = fingoBaseFeeForAmount(gross);
  const totalFee = Math.round(baseFee * feeMultiplier);
  return {
    netAmount,
    gross: netAmount + totalFee,
    fee: totalFee,
    fingoBaseFee: baseFee, // Fingo's own published fee, before EPH's multiplier
  };
}

/**
 * Looks up which provider is active for an org and that provider's account
 * reference (Paystack subaccount code / Fingo subMerchantId), from
 * org_payment_providers rather than the legacy paystack_subaccount_code
 * column directly — this is what lets SA switch an org's active provider
 * at any time without a schema change or re-provisioning.
 */
async function getActiveProviderConfig(org) {
  if (!org?.id) return null;
  const activeProvider = org.active_payment_provider || 'paystack';
  try {
    const { data } = await sb.from('org_payment_providers')
      .select('provider, provider_account_ref')
      .eq('org_id', org.id).eq('provider', activeProvider).maybeSingle();
    if (!data) return null;
    return { provider: data.provider, accountRef: data.provider_account_ref };
  } catch (e) {
    console.warn('getActiveProviderConfig: lookup failed —', e.message);
    return null;
  }
}

/* ════════════════════════════════════════════════════
   PUSH NOTIFICATIONS — client-side subscribe flow
   Additive to SMS, never a replacement — a user without the app or with
   notifications off simply doesn't get pushed to, and still gets their SMS
   as before. sw.js's `push` listener already expects exactly the
   {title, body, url} payload the server-side sender uses — no SW changes
   needed for this feature.
════════════════════════════════════════════════════ */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Current status, for UI display — 'unsupported' | 'default' | 'granted' | 'denied'
function getPushPermissionStatus() {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

async function subscribeToPushNotifications(silent) {
  const status = getPushPermissionStatus();
  if (status === 'unsupported') {
    if (!silent) toast('Notifications are not supported on this browser/device');
    return false;
  }
  if (status === 'denied') {
    if (!silent) toast('Notifications are blocked for this site — enable them in your browser settings first');
    return false;
  }

  try {
    const permission = status === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permission !== 'granted') {
      // A dismissed (not explicitly blocked) system dialog isn't really an
      // error worth interrupting an automatic trigger about — the manual
      // "Enable Notifications" button in My Profile still gives clear
      // feedback when a real person clicked it on purpose.
      if (!silent) toast('Notifications permission was not granted');
      return false;
    }

    const { data: vapidRow } = await sb.from('platform_settings_public').select('vapid_public_key').maybeSingle();
    if (!vapidRow?.vapid_public_key) {
      console.warn('subscribeToPushNotifications: VAPID public key not configured yet');
      if (!silent) toast('Notifications are not set up yet — try again later');
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidRow.vapid_public_key),
      });
    }

    const subJson = subscription.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      user_id: currentUser.id,
      endpoint: subJson.endpoint,
      p256dh: subJson.keys.p256dh,
      auth_key: subJson.keys.auth,
      user_agent: navigator.userAgent,
    }, { onConflict: 'endpoint' });

    if (error) throw new Error(error.message);
    toast('✓ Notifications enabled');
    if (typeof refreshNotificationStatus === 'function') refreshNotificationStatus();
    return true;
  } catch (e) {
    console.error('subscribeToPushNotifications error:', e.message);
    if (!silent) toast('Could not enable notifications: ' + e.message);
    return false;
  }
}

async function unsubscribeFromPushNotifications() {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await sb.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
      await subscription.unsubscribe();
    }
    toast('Notifications disabled');
  } catch (e) {
    console.error('unsubscribeFromPushNotifications error:', e.message);
  }
}

// Automatic prompt triggers — the browser's own "Allow notifications?"
// dialog can never be silently auto-granted (no site can do that, by
// design, on any browser), so this is the closest equivalent: ask
// automatically at the two moments most likely to convert, rather than
// waiting for someone to find the toggle in My Profile. Only fires while
// permission is still 'default' (undecided) — once a user has explicitly
// allowed or blocked it, neither trigger does anything further.
//
// Login/app-open trigger: gated with a per-tab-session flag (not
// permanent) so a dismissed-without-deciding prompt doesn't re-appear on
// every single page reload within the same visit — it tries again next
// time the app is freshly opened instead.
function maybeAutoPromptPushOnLogin() {
  try {
    if (getPushPermissionStatus() !== 'default') return;
    if (sessionStorage.getItem('gy360_push_asked')) return;
    sessionStorage.setItem('gy360_push_asked', '1');
    subscribeToPushNotifications(true);
  } catch(e) { /* sessionStorage can throw in some private-browsing modes — fail silent */ }
}

// Payment-success trigger: no session gate needed — this only fires once
// or twice per session naturally, and it's specifically valuable to retry
// here even if the login-time prompt was dismissed without a decision,
// since the person has just had a good, trust-building experience with
// the app (the best moment to ask, per general app-engagement practice).
function maybeAutoPromptPushOnPayment() {
  if (getPushPermissionStatus() !== 'default') return;
  subscribeToPushNotifications(true);
}

/* ════════════════════════════════════════════════════
   NOTIFICATION BELL — workspace picker
   Persistent, always-visible entry point for notification history and the
   on/off toggle — separate from the automatic prompts (login/payment) and
   the My Profile card, all three now coexist: automatic prompts for
   opt-in, the bell for ongoing control and history, My Profile for anyone
   who prefers a dedicated settings page.
════════════════════════════════════════════════════ */
async function loadNotificationBellBadge() {
  const badge = document.getElementById('notif-bell-badge');
  if (!badge || !currentUser?.id) return;
  try {
    const { count } = await sb.from('notification_log')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id).eq('read', false);
    if (count > 0) {
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.style.display = 'flex';
      badge.style.alignItems = 'center';
      badge.style.justifyContent = 'center';
    } else {
      badge.style.display = 'none';
    }
  } catch(e) { console.warn('loadNotificationBellBadge:', e.message); }

  // Reflect current permission/subscription state in the toggle
  const checkbox = document.getElementById('notif-toggle-checkbox');
  const label = document.getElementById('notif-toggle-label');
  if (checkbox) {
    const permission = getPushPermissionStatus();
    let hasSub = false;
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.ready;
        hasSub = !!(await reg.pushManager.getSubscription());
      }
    } catch(e) {}
    const isOn = permission === 'granted' && hasSub;
    checkbox.checked = isOn;
    if (label) label.textContent = isOn ? 'On' : 'Off';
  }
}

function toggleNotificationPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const opening = panel.style.display === 'none';
  panel.style.display = opening ? 'block' : 'none';
  if (opening) loadNotificationHistory();
}

async function loadNotificationHistory() {
  const el = document.getElementById('notif-history-list');
  if (!el || !currentUser?.id) return;
  try {
    const { data } = await sb.from('notification_log')
      .select('*').eq('user_id', currentUser.id)
      .order('created_at', { ascending: false }).limit(20);

    if (!data?.length) {
      el.innerHTML = '<div style="padding:1.5rem 1rem;text-align:center;color:var(--ink-faint,#767676);font-size:.8rem">No notifications yet.</div>';
    } else {
      el.innerHTML = data.map(n => `
        <div style="padding:.75rem 1rem;border-bottom:1px solid var(--border-soft,#e8f0eb);${n.read ? '' : 'background:var(--maroon-pale,#fdf0f3)'}">
          <div style="font-size:.82rem;font-weight:700;color:var(--ink,#1a1a1a);margin-bottom:.15rem">${(n.title||'').replace(/</g,'')}</div>
          <div style="font-size:.78rem;color:var(--ink-soft,#3d3d3d);line-height:1.4;margin-bottom:.3rem">${(n.body||'').replace(/</g,'')}</div>
          <div style="font-size:.68rem;color:var(--ink-faint,#767676)">${timeAgo(n.created_at)}</div>
        </div>`).join('');

      // Mark visible ones as read now that the panel's actually been opened
      const unreadIds = data.filter(n => !n.read).map(n => n.id);
      if (unreadIds.length) {
        await sb.from('notification_log').update({ read: true }).in('id', unreadIds);
        loadNotificationBellBadge();
      }
    }
  } catch(e) {
    el.innerHTML = '<div style="padding:1rem;color:var(--danger,#c0392b);font-size:.78rem">Could not load notifications.</div>';
  }
}

async function toggleNotificationsFromBell(checked) {
  const label = document.getElementById('notif-toggle-label');
  if (checked) {
    const ok = await subscribeToPushNotifications();
    if (label) label.textContent = ok ? 'On' : 'Off';
    if (!ok) { const cb = document.getElementById('notif-toggle-checkbox'); if (cb) cb.checked = false; }
  } else {
    await unsubscribeFromPushNotifications();
    if (label) label.textContent = 'Off';
  }
}

// Small "3h ago" / "2d ago" style relative time — no dependency needed for
// something this simple.
function timeAgo(isoString) {
  const seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString();
}




