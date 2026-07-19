// ── GLOBAL CART ALIASES — always available regardless of parse order ─────────
window.addSMSToCart = function(btn) {
  document.querySelectorAll('.pay-pill.sms').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (typeof _billingCart !== 'undefined') {
    _billingCart.sms = parseInt(btn.dataset.sms);
    _billingCart.smsAmount = parseInt(btn.dataset.amount);
    if (typeof refreshCartUI === 'function') refreshCartUI();
    document.getElementById('billing-cart-card')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }
};
window.addPlanToCart = function(plan, price, isFree) {
  if (typeof _billingCart !== 'undefined') {
    _billingCart.plan = plan;
    _billingCart.planAmount = price;
    _billingCart.planIsFree = isFree;
    if (typeof refreshCartUI === 'function') refreshCartUI();
    document.getElementById('billing-cart-card')?.scrollIntoView({ behavior:'smooth', block:'start' });
  }
};
window.activateFreeTrialFromCart = function() {
  activateFreeTrialFromCart_impl();
};
window.submitCartPayment = function() {
  submitCartPayment_impl();
};
window.submitCartPaystack = function() {
  submitCartPaystack_impl();
};
window.switchPayTab = function(tab) {
  switchPayTab_impl(tab);
};
window.clearBillingCart = function() {
  if (typeof _billingCart !== 'undefined') {
    _billingCart = { plan: null, planAmount: 0, sms: 0, smsAmount: 0 };
    document.querySelectorAll('.pay-pill.sms').forEach(b => b.classList.remove('active'));
    if (typeof refreshCartUI === 'function') refreshCartUI();
  }
};


function updateBillingHero(org) {
  if (!org) return;
  const plan = org.plan || 'starter';
  const expires = org.subscription_expires;
  const planNames = { starter:'Starter', basic:'Basic', standard:'Standard', pro:'Pro' };
  const planMeta = {
    starter: 'Free plan · Up to 15 members',
    basic:   'Ksh 3,000/year · Up to 30 members',
    standard:'Ksh 6,000/year · Up to 75 members',
    pro:     'Ksh 12,000/year · Unlimited members',
  };
  const planFeatures = {
    starter: 'Members, Finance, Meetings, MGR',
    basic:   'All Starter + Welfare, Projects, Table Banking',
    standard:'All Basic + M-Pesa STK Push · Priority support',
    pro:     'All Standard + Custom branding · API access',
  };
  const planMembers = { starter:15, basic:30, standard:75, pro:'Unlimited' };

  const nameEl = document.getElementById('billing-plan-name');
  const metaEl = document.getElementById('billing-plan-meta');
  const bfMem  = document.getElementById('bf-members');
  const bfSms  = document.getElementById('bf-sms');
  const bfFeat = document.getElementById('bf-features');
  const expEl  = document.getElementById('billing-expiry-text');
  const badgeEl= document.getElementById('billing-status-badge');

  if (nameEl) nameEl.textContent = planNames[plan] || plan;
  if (metaEl) metaEl.textContent = planMeta[plan] || '';
  if (bfMem)  bfMem.textContent  = '👥 Up to ' + planMembers[plan] + ' members';
  if (bfSms)  bfSms.textContent  = '💬 Bulk SMS — pay as you go · Ksh 1.50/SMS';
  if (bfFeat) bfFeat.textContent = '✓ ' + (planFeatures[plan]||'');

  if (expires && expEl) {
    const days = Math.ceil((new Date(expires) - new Date()) / 86400000);
    if (days < 0) {
      expEl.textContent = 'Expired ' + new Date(expires).toDateString();
      if (badgeEl) badgeEl.innerHTML = '<span style="width:6px;height:6px;background:#f87171;border-radius:50%;display:inline-block"></span> EXPIRED';
    } else if (days < 30) {
      expEl.textContent = 'Expires in ' + days + ' days (' + new Date(expires).toDateString() + ')';
      if (badgeEl) badgeEl.innerHTML = '<span style="width:6px;height:6px;background:#fbbf24;border-radius:50%;display:inline-block"></span> EXPIRING SOON';
    } else {
      expEl.textContent = 'Active until ' + new Date(expires).toDateString();
    }
  }
}

// GroupYetu360 — js/settings.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── SETTINGS ──
function switchSettingsTab(btn, tabId) {
  document.querySelectorAll('#page-settings .fin-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-settings .tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
  // Load welfare types when that tab is opened
  if (tabId === 'st-welfare' && typeof loadWelfareTypes === 'function') loadWelfareTypes();
}

async function loadSettings() {
  // Gate welfare tab on plan
  const welfareTab = document.getElementById('st-welfare-tab');
  if (welfareTab) {
    const plan = currentOrg?.plan || 'starter';
    welfareTab.style.display = plan === 'starter' ? 'none' : '';
  }

  if (!currentOrg?.id) return;
  // Refresh org data from DB first
  const { data: freshOrg } = await sb.from('organisations').select('*').eq('id', currentOrg.id).single();
  if (freshOrg) Object.assign(currentOrg, freshOrg);

  const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val||'';}
  setVal('settings-name', currentOrg.name);
  setVal('settings-org-code', currentOrg.org_code || 'Not set — contact support');
  loadPaymentMethodsSettings(currentOrg);
  setVal('settings-reg', currentOrg.reg_number);
  setVal('settings-paybill', currentOrg.paybill);
  setVal('settings-account', currentOrg.account_format);
  const bbVal = currentOrg.bank_balance;
  const bbLocked = currentOrg.bank_balance_locked === true;
  const bbInput = document.getElementById('settings-bank-balance');
  const bbNote = document.getElementById('bank-balance-note');
  if (bbInput) {
    bbInput.value = bbVal || 0;
    bbInput.readOnly = bbLocked;
    bbInput.style.background = bbLocked ? 'var(--surface-3)' : '';
    bbInput.style.color = bbLocked ? 'var(--ink-faint)' : '';
  }
  if (bbNote) {
    bbNote.textContent = bbLocked
      ? 'Balance locked. Updates automatically with transactions. Contact GroupYetu360 to edit.'
      : 'Set your opening balance. Once saved, it will update automatically with your transactions.';
    bbNote.style.color = bbLocked ? 'var(--warning)' : 'var(--ink-faint)';
  }
  setVal('settings-bank-date', currentOrg.bank_balance_updated);
  // Load 2FA setting
  // 2FA is managed at account level — not org level


  const { data } = await sb.from('contribution_types').select('*').eq('org_id', currentOrg.id).order('name');
  allContribTypes = data || [];
  const ctEl = document.getElementById('contrib-types-list');
  if (ctEl) {
    ctEl.innerHTML = allContribTypes.length ? `
      <div class="table-wrap">
      <table><thead><tr><th>Type</th><th>Default Amt</th><th>Frequency</th><th>Income Type</th><th></th></tr></thead>
      <tbody>${allContribTypes.map(t=>`<tr>
        <td><strong>${h(t.name)}</strong>${t.notes?`<div style='font-size:.68rem;color:var(--ink-faint)'>${h(t.notes)}</div>`:''}</td>
        <td>Ksh ${t.is_variable?'Variable':Number(t.amount||0).toLocaleString()}</td>
        <td><span class="badge badge-grey">${t.frequency}</span></td>
        <td>${t.is_member_income===false?'<span class="badge badge-maroon" title="Goes to group funds only">Admin</span>':'<span class="badge badge-green" title="Adds to member balances">Member</span>'}</td>
        <td style="display:flex;gap:.4rem">
          <button class="btn btn-secondary btn-sm" onclick="editContribType('${t.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteContribType('${t.id}','${t.name.replace(/'/g,"&apos;")}')">✕</button>
        </td>
      </tr>`).join('')}</tbody></table></div>
      <div style="padding:.75rem 1.25rem"><button class="btn btn-secondary btn-sm" onclick="showModal('addContribType')">+ Add Contribution Type</button></div>` :
      `<div style="padding:1.5rem;text-align:center">
        <div style="font-size:.85rem;color:var(--ink-faint);margin-bottom:1rem">No contribution types yet. Add the types your organisation collects.</div>
        <button class="btn btn-primary btn-sm" onclick="showModal('addContribType')">+ Add First Type</button>
      </div>`;
  }
  populateSelects();
}

async function loadTeamMembers() {
  if (!currentOrg?.id) return;
  const { data: profiles } = await sb.from('profiles').select('*').eq('org_id', currentOrg.id);
  const teamEl = document.getElementById('team-members-list');
  if (!teamEl) return;
  const team = (profiles||[]).filter(p => p.role !== 'member' && p.role !== 'pending' && p.role !== 'declined');
  teamEl.innerHTML = team.length ? `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
      <tbody>${team.map(p=>`<tr>
        <td><strong>${p.full_name||'—'}</strong></td>
        <td>${p.id}</td>
        <td><span class="badge ${p.role==='admin'?'badge-maroon':p.role==='superadmin'?'badge-gold':p.role==='treasurer'?'badge-green':'badge-grey'}">${p.role}</span></td>
        <td>
          ${p.role !== 'superadmin' && p.id !== currentUser?.id ? `
          <select class="form-select" style="width:120px;padding:.2rem .5rem;font-size:.72rem" onchange="changeRole('${p.id}',this.value)">
            <option value="admin" ${p.role==='admin'?'selected':''}>Admin</option>
            <option value="treasurer" ${p.role==='treasurer'?'selected':''}>Treasurer</option>
            <option value="officer" ${p.role==='officer'?'selected':''}>Officer</option>
            <option value="member" ${p.role==='member'?'selected':''}>Member</option>
          </select>` : '<span style="font-size:.72rem;color:var(--ink-faint)">Current user</span>'}
        </td>
      </tr>`).join('')}</tbody>
    </table>` :
    '<div style="padding:1.25rem;font-size:.82rem;color:var(--ink-faint)">No admin team members yet</div>';
}

async function changeRole(userId, newRole) {
  const { error } = await sb.from('profiles').update({ role: newRole }).eq('id', userId);
  if (error) { toast('Error: '+error.message); return; }
  toast('Role updated to ' + newRole);
  loadTeamMembers();
}

async function saveInviteAdmin() {
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const password = document.getElementById('invite-password').value.trim();
  const role = document.getElementById('invite-role').value;
  if (!name||!email||!password) { toast('Please fill all fields'); return; }
  if (password.length < 6) { toast('Password must be at least 6 characters'); return; }
  // profiles/user_orgs are created server-side by the handle_new_user() trigger via
  // the admin_invite_org_id/admin_invite_role metadata below — NOT via a client-side
  // upsert here. There is no active session for this new account until they confirm
  // their email, so a client-side write at this point would be silently blocked by
  // RLS (same root cause documented for registerAccount()/joinOrg()).
  const { data: authData, error: authErr } = await sb.auth.signUp({
    email, password,
    options: {
      data: { full_name: name, admin_invite_org_id: currentOrg.id, admin_invite_role: role },
      emailRedirectTo: 'https://app.groupyetu.org/?intent=invite'
    }
  });
  if (authErr) { toast('Error: '+authErr.message); return; }
  toast(name + ' added as ' + role + ' — confirmation email sent');
  closeModal('inviteAdmin');
  loadTeamMembers();
}

// ── SHAREOUT & WITHDRAW FUNCTIONS ──
function showShareoutModal() {
  // Reset form
  const sv = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
  sv('shareout-type','full'); sv('shareout-reason',''); sv('shareout-pct',''); sv('shareout-fixed','');
  sv('so-dividend-pool','');
  const cb = (id,v) => { const el=document.getElementById(id); if(el) el.checked=v; };
  cb('so-include-savings',true); cb('so-include-shares',false); cb('so-include-dividend',false);
  const ds = document.getElementById('so-dividend-section'); if(ds) ds.style.display='none';
  document.getElementById('shareout-pct-group').style.display='none';
  document.getElementById('shareout-fixed-group').style.display='none';

  // Populate totals
  const totalSavings = allMembers.reduce((s,m)=>s+Number(m.savings_balance||0),0);
  const totalShares  = allMembers.reduce((s,m)=>s+Number(m.shares_balance||0),0);
  const savEl = document.getElementById('so-savings-total');
  const shrEl = document.getElementById('so-shares-total');
  if (savEl) savEl.textContent = `Ksh ${totalSavings.toLocaleString()} across ${allMembers.filter(m=>m.savings_balance>0).length} members`;
  if (shrEl) shrEl.textContent = `Ksh ${totalShares.toLocaleString()} across ${allMembers.filter(m=>m.shares_balance>0).length} members`;

  // Hide shares row if org has no shares
  const sharesRow = document.getElementById('so-shares-row');
  if (sharesRow) sharesRow.style.display = orgFinProfile?.hasShares ? '' : 'none';

  updateShareoutPreview();
  showModal('shareout');
}

function toggleDividendSection(show) {
  const el = document.getElementById('so-dividend-section');
  if (el) el.style.display = show ? 'block' : 'none';
  updateShareoutPreview();
}

function updateShareoutPreview() {
  const type       = document.getElementById('shareout-type')?.value || 'full';
  const inclSav    = document.getElementById('so-include-savings')?.checked;
  const inclShr    = document.getElementById('so-include-shares')?.checked;
  const inclDiv    = document.getElementById('so-include-dividend')?.checked;
  const divPool    = parseFloat(document.getElementById('so-dividend-pool')?.value||0);
  const divMethod  = document.getElementById('so-dividend-method')?.value || 'shares';
  const pct        = parseFloat(document.getElementById('shareout-pct')?.value||0);
  const fixed      = parseFloat(document.getElementById('shareout-fixed')?.value||0);
  const pctGroup   = document.getElementById('shareout-pct-group');
  const fixedGroup = document.getElementById('shareout-fixed-group');
  if (pctGroup)   pctGroup.style.display   = type==='percentage' ? 'block' : 'none';
  if (fixedGroup) fixedGroup.style.display = type==='fixed'      ? 'block' : 'none';

  const preview  = document.getElementById('shareout-preview-content');
  const totalLbl = document.getElementById('so-total-label');
  if (!preview) return;

  const totalSharesAll = allMembers.reduce((s,m)=>s+Number(m.shares_balance||0),0);

  // Build per-member rows
  let grandTotal = 0;
  const rows = allMembers.map(m => {
    let savDeduct = 0, shrDeduct = 0, dividend = 0;
    const savBal = Number(m.savings_balance||0);
    const shrBal = Number(m.shares_balance||0);

    if (inclSav && savBal > 0) {
      if (type==='full')       savDeduct = savBal;
      else if (type==='percentage') savDeduct = savBal * pct/100;
      else                     savDeduct = Math.min(fixed, savBal);
    }
    if (inclShr && shrBal > 0) shrDeduct = shrBal;
    if (inclDiv && divPool > 0) {
      if (divMethod==='shares' && totalSharesAll>0) dividend = divPool * (shrBal/totalSharesAll);
      else dividend = divPool / allMembers.length;
    }
    const memberTotal = savDeduct + shrDeduct + dividend;
    grandTotal += memberTotal;
    if (memberTotal <= 0) return null;
    return { name: m.full_name, num: m.member_number, savDeduct, shrDeduct, dividend, total: memberTotal };
  }).filter(Boolean);

  if (totalLbl) totalLbl.textContent = rows.length ? `Total: Ksh ${Math.round(grandTotal).toLocaleString()}` : '';

  if (!rows.length) {
    preview.innerHTML = '<div style="color:var(--ink-faint);text-align:center;padding:.75rem">No members will be affected with current settings</div>';
    return;
  }

  preview.innerHTML = `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="border-bottom:1px solid var(--border)">
      <th style="text-align:left;padding:.3rem .5rem;font-size:.7rem;color:var(--ink-faint)">#</th>
      <th style="text-align:left;padding:.3rem .5rem;font-size:.7rem;color:var(--ink-faint)">Member</th>
      ${inclSav?'<th style="text-align:right;padding:.3rem .5rem;font-size:.7rem;color:var(--ink-faint)">Savings</th>':''}
      ${inclShr?'<th style="text-align:right;padding:.3rem .5rem;font-size:.7rem;color:var(--ink-faint)">Shares</th>':''}
      ${inclDiv?'<th style="text-align:right;padding:.3rem .5rem;font-size:.7rem;color:var(--teal)">Dividend</th>':''}
      <th style="text-align:right;padding:.3rem .5rem;font-size:.7rem;color:var(--ink-faint)">Total</th>
    </tr></thead>
    <tbody>${rows.map(r=>`<tr style="border-bottom:1px solid var(--border)">
      <td style="padding:.3rem .5rem;font-size:.72rem;color:var(--ink-faint)">#${r.num||'—'}</td>
      <td style="padding:.3rem .5rem;font-size:.78rem;font-weight:600">${r.name}</td>
      ${inclSav?`<td style="text-align:right;padding:.3rem .5rem;font-size:.75rem;color:var(--maroon)">Ksh ${Math.round(r.savDeduct).toLocaleString()}</td>`:''}
      ${inclShr?`<td style="text-align:right;padding:.3rem .5rem;font-size:.75rem;color:var(--maroon)">Ksh ${Math.round(r.shrDeduct).toLocaleString()}</td>`:''}
      ${inclDiv?`<td style="text-align:right;padding:.3rem .5rem;font-size:.75rem;color:var(--teal)">+Ksh ${Math.round(r.dividend).toLocaleString()}</td>`:''}
      <td style="text-align:right;padding:.3rem .5rem;font-size:.78rem;font-weight:700">Ksh ${Math.round(r.total).toLocaleString()}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function executeShareout() {
  const type      = document.getElementById('shareout-type')?.value || 'full';
  const reason    = document.getElementById('shareout-reason')?.value?.trim();
  const inclSav   = document.getElementById('so-include-savings')?.checked;
  const inclShr   = document.getElementById('so-include-shares')?.checked;
  const inclDiv   = document.getElementById('so-include-dividend')?.checked;
  const divPool   = parseFloat(document.getElementById('so-dividend-pool')?.value||0);
  const divMethod = document.getElementById('so-dividend-method')?.value || 'shares';
  const pct       = parseFloat(document.getElementById('shareout-pct')?.value||0);
  const fixed     = parseFloat(document.getElementById('shareout-fixed')?.value||0);

  if (!reason) { toast('Please enter a shareout label'); return; }
  if (!inclSav && !inclShr && !inclDiv) { toast('Select at least one item to distribute'); return; }
  if (!confirm(`Execute "${reason}" for ${allMembers.length} members? This cannot be undone.`)) return;

  const totalSharesAll = allMembers.reduce((s,m)=>s+Number(m.shares_balance||0),0);
  let processed = 0;

  for (const member of allMembers) {
    const savBal = Number(member.savings_balance||0);
    const shrBal = Number(member.shares_balance||0);
    const memberUpdates = {};
    const adjustments = [];

    // Savings deduction
    if (inclSav && savBal > 0) {
      let deduct = 0;
      if (type==='full')            deduct = savBal;
      else if (type==='percentage') deduct = savBal * pct/100;
      else                          deduct = Math.min(fixed, savBal);
      deduct = Math.round(deduct);
      if (deduct > 0) {
        memberUpdates.savings_balance = Math.max(0, savBal - deduct);
        adjustments.push({ adjustment_type:'savings', direction:'debit', amount:deduct, reason:`Shareout: ${reason}` });
      }
    }

    // Shares deduction
    if (inclShr && shrBal > 0) {
      memberUpdates.shares_balance = 0;
      adjustments.push({ adjustment_type:'shares', direction:'debit', amount:shrBal, reason:`Shareout (shares): ${reason}` });
    }

    // Dividend credit
    if (inclDiv && divPool > 0) {
      let dividend = divMethod==='shares' && totalSharesAll>0
        ? Math.round(divPool * (shrBal/totalSharesAll))
        : Math.round(divPool / allMembers.length);
      if (dividend > 0) {
        memberUpdates.savings_balance = Math.max(0, (memberUpdates.savings_balance??savBal)) + dividend;
        adjustments.push({ adjustment_type:'savings', direction:'credit', amount:dividend, reason:`Dividend: ${reason}` });
      }
    }

    if (!adjustments.length) continue;

    // Write adjustments
    for (const adj of adjustments) {
      await sb.from('balance_adjustments').insert({
        org_id: currentOrg.id, member_id: member.id,
        recorded_by: currentUser.id, ...adj
      });
    }

    // Update member balances
    if (Object.keys(memberUpdates).length) {
      await sb.from('members').update(memberUpdates).eq('id', member.id);
    }
    processed++;
  }

  await logActivity('SHAREOUT', `${reason}. ${processed} members processed. Savings:${inclSav} Shares:${inclShr} Dividend:${inclDiv}`);
  toast(`✓ Shareout complete — ${processed} members processed`);
  closeModal('shareout');
  loadMembers();
  prefetchData();
}

function switchFinTab(btn, tabId) {
  document.querySelectorAll('.fin-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-finance > .tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
}

function switchFinSubTab(btn, tabId) {
  const parent = btn.closest('.tab-panel');
  if (!parent) return;
  parent.querySelectorAll('.fin-sub-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  parent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
}

async function toggleWithdrawWindow() {
  const isOpen = currentOrg?.withdraw_enabled || false;
  const newState = !isOpen;
  await sb.from('organisations').update({ withdraw_enabled: newState }).eq('id', currentOrg.id);
  currentOrg.withdraw_enabled = newState;
  const btn = document.getElementById('withdraw-toggle-btn');
  const label = document.getElementById('withdraw-status-label');
  const dot = document.getElementById('fin-withdraw-dot');
  if (btn) btn.textContent = newState ? 'Close' : 'Open';
  if (label) label.textContent = newState ? 'OPEN' : 'Closed';
  if (dot) dot.classList.toggle('open', newState);
  toast(`Withdraw window ${newState ? 'opened — members can now request withdrawals' : 'closed'}`);
  await logActivity(newState?'WITHDRAW OPEN':'WITHDRAW CLOSE', `Withdraw window ${newState?'opened':'closed'} by admin`);
  // Refresh withdrawal requests panel + member portal card
  if (typeof loadWithdrawalRequests === 'function') loadWithdrawalRequests();
  if (typeof updateWithdrawCard === 'function') updateWithdrawCard();
}

async function saveWelfareRates() {
  toast('Welfare rates saved (feature coming soon)');
}

async function saveMeetingDefaults() {
  toast('Meeting defaults saved (feature coming soon)');
}

async function deleteContribType(id, name) {
  if (!confirm('Delete "' + name + '"? This won\'t affect existing transactions.')) return;
  const { error } = await sb.from('contribution_types').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast(name + ' removed');
  loadSettings();
}

function togglePaymentMethod(method, enabled) {
  const fields = document.getElementById(`pm-${method}-fields`);
  if (fields) fields.style.display = enabled ? 'block' : 'none';
}

function loadPaymentMethodsSettings(org) {
  const methods = org.payment_methods || {};
  // Paybill
  const pbEl = document.getElementById('pm-paybill-enabled');
  if (pbEl) { pbEl.checked = !!methods.paybill; togglePaymentMethod('paybill', !!methods.paybill); }
  const pbField = document.getElementById('settings-paybill');
  if (pbField) pbField.value = org.paybill || methods.paybill_number || '';
  const accField = document.getElementById('settings-account');
  if (accField) accField.value = org.account_format || methods.paybill_account || '';
  // Till
  const tillEl = document.getElementById('pm-till-enabled');
  if (tillEl) { tillEl.checked = !!methods.till; togglePaymentMethod('till', !!methods.till); }
  const tillField = document.getElementById('settings-till');
  if (tillField) tillField.value = methods.till_number || '';
  // Send Money
  const sendEl = document.getElementById('pm-send-enabled');
  if (sendEl) { sendEl.checked = !!methods.send; togglePaymentMethod('send', !!methods.send); }
  const sendField = document.getElementById('settings-send-phone');
  if (sendField) sendField.value = methods.send_phone || '';
  // Pochi
  const pochiEl = document.getElementById('pm-pochi-enabled');
  if (pochiEl) { pochiEl.checked = !!methods.pochi; togglePaymentMethod('pochi', !!methods.pochi); }
  const pochiField = document.getElementById('settings-pochi');
  if (pochiField) pochiField.value = methods.pochi_phone || '';
  // Bank
  const bankEl = document.getElementById('pm-bank-enabled');
  if (bankEl) { bankEl.checked = !!methods.bank; togglePaymentMethod('bank', !!methods.bank); }
  const bankName = document.getElementById('settings-bank-name');
  if (bankName) bankName.value = methods.bank_name || '';
  const bankAcc = document.getElementById('settings-bank-acc');
  if (bankAcc) bankAcc.value = methods.bank_account || '';
  const bankAccName = document.getElementById('settings-bank-acc-name');
  if (bankAccName) bankAccName.value = methods.bank_account_name || '';
}

async function saveSettings() {
  if (!canDo('editSettings')) { toast('⚠ Only admins can edit organisation settings.'); return; }
  if (!currentOrg?.id) return;
  // Build payment methods object
  const paymentMethods = {
    paybill: document.getElementById('pm-paybill-enabled')?.checked || false,
    paybill_number: document.getElementById('settings-paybill')?.value?.trim() || '',
    paybill_account: document.getElementById('settings-account')?.value?.trim() || '',
    till: document.getElementById('pm-till-enabled')?.checked || false,
    till_number: document.getElementById('settings-till')?.value?.trim() || '',
    send: document.getElementById('pm-send-enabled')?.checked || false,
    send_phone: document.getElementById('settings-send-phone')?.value?.trim() || '',
    pochi: document.getElementById('pm-pochi-enabled')?.checked || false,
    pochi_phone: document.getElementById('settings-pochi')?.value?.trim() || '',
    bank: document.getElementById('pm-bank-enabled')?.checked || false,
    bank_name: document.getElementById('settings-bank-name')?.value?.trim() || '',
    bank_account: document.getElementById('settings-bank-acc')?.value?.trim() || '',
    bank_account_name: document.getElementById('settings-bank-acc-name')?.value?.trim() || '',
  };
  const updates = {
    name: document.getElementById('settings-name').value.trim(),
    reg_number: document.getElementById('settings-reg').value.trim(),
    paybill: document.getElementById('settings-paybill')?.value?.trim() || '',
    account_format: document.getElementById('settings-account')?.value?.trim() || '',
    payment_methods: paymentMethods,
    bank_balance: parseFloat(document.getElementById('settings-bank-balance').value)||0,
    bank_balance_updated: document.getElementById('settings-bank-date').value||null,
    // AT credentials managed centrally by superadmin, not per-org
  };
  // Lock bank balance after first save if it has a value
  if (updates.bank_balance && updates.bank_balance > 0 && !currentOrg.bank_balance_locked) {
    updates.bank_balance_locked = true;
  }
  const { error } = await sb.from('organisations').update(updates).eq('id', currentOrg.id);
  if (error) { toast('Error: '+error.message); return; }
  Object.assign(currentOrg, updates);
  updateSidebar();
  toast('Settings saved successfully');
}

var _editingContribTypeId = null;

function editContribType(typeId) {
  const type = allContribTypes.find(t => t.id === typeId);
  if (!type) return;
  _editingContribTypeId = typeId;
  // Populate form
  document.getElementById('ct-name').value = type.name || '';
  document.getElementById('ct-amount').value = type.amount || '';
  document.getElementById('ct-freq').value = type.frequency || 'monthly';
  document.getElementById('ct-variable').value = type.is_variable ? 'true' : 'false';
  document.getElementById('ct-notes').value = type.notes || '';
  const itEl = document.getElementById('ct-income-type');
  if (itEl) { itEl.value = (type.is_member_income === false) ? 'admin_income' : 'member_income'; updateContribTypeHint(itEl.value); }
  // Update modal title and button
  const titleEl = document.getElementById('contrib-modal-title');
  const btnEl = document.getElementById('contrib-save-btn');
  if (titleEl) titleEl.textContent = 'Edit Contribution Type';
  if (btnEl) btnEl.textContent = 'Save Changes';
  showModal('addContribType');
}

function updateContribTypeHint(val) {
  const hint = document.getElementById('ct-income-hint');
  if (!hint) return;
  const hints = {
    admin_income: { bg:'var(--warning-pale)', c:'var(--warning)', msg:'📋 Goes to the group account only. Does NOT add to member personal balances. Shown as "Total Contributed" on member profiles.' },
    member_savings: { bg:'var(--teal-pale)', c:'var(--teal-dk)', msg:'💰 Added to each member\'s Savings balance. Shown on member card and profile. Withdrawable at year end.' },
    member_shares: { bg:'var(--maroon-pale)', c:'var(--maroon)', msg:'📈 Added to each member\'s Shares balance. Represents equity in the group.' },
    welfare: { bg:'var(--surface-2)', c:'var(--ink-faint)', msg:'♡ Welfare fund contribution. Linked to welfare events on the platform.' },
    mgr: { bg:'var(--teal-pale)', c:'var(--teal-dk)', msg:'🔄 Tracked under Rotating Savings. Links to merry-go-round cycles.' },
    table_banking: { bg:'var(--surface-2)', c:'var(--ink-faint)', msg:'🏦 Tracked under Table Banking. Adds to the pool balance.' },
  };
  const h = hints[val] || hints.admin_income;
  hint.style.background = h.bg;
  hint.style.color = h.c;
  hint.style.borderLeftColor = h.c;
  hint.textContent = h.msg;
}

async function saveContribType() {
  if (!currentOrg?.id) return;
  const incomeType = document.getElementById('ct-income-type')?.value || 'admin_income';
  const isMemberBalance = ['member_savings','member_shares'].includes(incomeType);
  const payload = {
    org_id: currentOrg.id,
    name: document.getElementById('ct-name').value.trim(),
    amount: parseFloat(document.getElementById('ct-amount').value)||0,
    frequency: document.getElementById('ct-freq').value,
    is_variable: document.getElementById('ct-variable').value === 'true',
    income_type: incomeType,
    is_member_income: isMemberBalance, // legacy compat
    notes: document.getElementById('ct-notes')?.value.trim() || null
  };
  if (!payload.name) { toast('Please enter a type name'); return; }

  let error;
  if (_editingContribTypeId) {
    const res = await sb.from('contribution_types').update(payload).eq('id', _editingContribTypeId);
    error = res.error;
    if (!error) toast(payload.name + ' updated successfully');
  } else {
    const res = await sb.from('contribution_types').insert(payload);
    error = res.error;
    if (!error) toast(payload.name + ' added as contribution type');
  }

  if (error) { toast('Error: '+error.message); return; }

  // Reload org financial profile to reflect new type
  try { await loadOrgFinancialProfile(); } catch(e) {}

  // Reset
  _editingContribTypeId = null;
  ['ct-name','ct-amount','ct-notes'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const itEl = document.getElementById('ct-income-type'); if(itEl) itEl.value='admin_income';
  updateContribTypeHint('admin_income');
  const titleEl = document.getElementById('contrib-modal-title');
  const btnEl = document.getElementById('contrib-save-btn');
  if (titleEl) titleEl.textContent = 'Add Contribution Type';
  if (btnEl) btnEl.textContent = 'Add Type';
  closeModal('addContribType');
  loadSettings();
  prefetchData();
}


// ── SUPER ADMIN ──
var _saOrgs = [], _saMemberCount = {};

async function loadSuperAdmin() {
  // ── Fetch all platform data in parallel ──
  const today = new Date().toISOString().split('T')[0];
  const thisMonth = new Date().toISOString().slice(0, 7);
  const thisYear = new Date().getFullYear();

  // Build last 6 months labels
  const months6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months6.push(d.toISOString().slice(0, 7));
  }

  const [orgsRes, membersRes, smsRes, pendingRes, activityRes] = await Promise.all([
    sb.from('organisations').select('*').order('created_at', { ascending: false }),
    sb.from('members').select('id,org_id'),
    sb.from('sms_usage').select('org_id,month,messages_sent').in('month', months6),
    sb.from('payment_requests').select('id,organisations(name)').eq('status', 'pending'),
    sb.from('activity_log').select('action,details,created_at,user_name').order('created_at', { ascending: false }).limit(12),
  ]);

  _saOrgs = orgsRes.data || [];
  const members = membersRes.data || [];
  const smsData = smsRes.data || [];
  const pendingPays = pendingRes.data || [];
  const activityItems = activityRes.data || [];

  // Member count per org
  _saMemberCount = {};
  members.forEach(m => { _saMemberCount[m.org_id] = (_saMemberCount[m.org_id] || 0) + 1; });

  // ── Derived stats ──
  const planRevenue = { starter: 0, basic: 3000, standard: 6000, pro: 12000 };
  const revenue = _saOrgs.reduce((s, o) => s + (planRevenue[o.plan] || 0), 0);
  const paidOrgs = _saOrgs.filter(o => o.plan !== 'starter');
  const trialOrgs = _saOrgs.filter(o => o.subscription_status === 'trial' || (!o.subscription_status && o.plan === 'starter'));
  const activeOrgs = _saOrgs.filter(o => o.subscription_status === 'active');
  const suspendedOrgs = _saOrgs.filter(o => o.status === 'suspended');
  const newThisMonth = _saOrgs.filter(o => o.created_at?.slice(0, 7) === thisMonth);
  const thirtyDaysLater = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const expiringSoon = _saOrgs.filter(o => o.subscription_expires && o.subscription_expires <= thirtyDaysLater && o.subscription_expires >= today);
  const totalSmsBalance = _saOrgs.reduce((s, o) => s + (o.sms_bundle || 0), 0);
  const smsSentThisMonth = smsData.filter(r => r.month === thisMonth).reduce((s, r) => s + (r.messages_sent || 0), 0);

  // ── KPI Strip ──
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('sa-orgs', _saOrgs.length);
  set('sa-members', members.length.toLocaleString());
  set('sa-plans', paidOrgs.length + ' paid');
  set('sa-revenue', 'Ksh ' + revenue.toLocaleString());
  set('sa-sms-month', smsSentThisMonth.toLocaleString());
  set('sa-trials', trialOrgs.length);
  set('sa-sms-balance-total', 'Ksh balance: ' + totalSmsBalance.toLocaleString() + ' SMS');
  set('sa-last-updated', 'EPH Technologies — GroupYetu360 · Updated ' + new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }));

  // New orgs this month badge
  const newBadge = document.getElementById('sa-orgs-new');
  if (newBadge) { newBadge.textContent = '+' + newThisMonth.length; newBadge.style.display = newThisMonth.length ? '' : 'none'; }

  // Expiring badge
  const expCount = document.getElementById('sa-expiring-count');
  const expLabel = document.getElementById('sa-expiring-label');
  if (expCount) { expCount.textContent = expiringSoon.length + ' expiring'; expCount.style.display = expiringSoon.length ? '' : 'none'; }
  if (expLabel) expLabel.textContent = expiringSoon.length ? 'within 30 days' : 'none expiring soon';

  // ── Health panel ──
  set('ph-active', activeOrgs.length);
  set('ph-trial', trialOrgs.length);
  set('ph-suspended', suspendedOrgs.length);
  set('ph-expiring', expiringSoon.length || '✓ None');
  set('ph-sms-total', totalSmsBalance.toLocaleString() + ' SMS');
  set('ph-pending', pendingPays.length || '✓ None');

  // ── Alert banners ──
  const payAlert = document.getElementById('sa-payment-alert');
  const payAlertText = document.getElementById('sa-payment-alert-text');
  if (payAlert) {
    payAlert.style.display = pendingPays.length ? 'flex' : 'none';
    if (pendingPays.length && payAlertText) {
      const names = [...new Set(pendingPays.map(p => p.organisations?.name).filter(Boolean))];
      payAlertText.textContent = pendingPays.length + ' request' + (pendingPays.length > 1 ? 's' : '') + ' from: ' + names.join(', ');
    }
  }
  const expAlert = document.getElementById('sa-expiring-alert');
  const expTitle = document.getElementById('sa-expiring-title');
  const expNames = document.getElementById('sa-expiring-names');
  if (expAlert) {
    expAlert.style.display = expiringSoon.length ? 'flex' : 'none';
    if (expiringSoon.length) {
      if (expTitle) expTitle.textContent = expiringSoon.length + ' subscription' + (expiringSoon.length > 1 ? 's' : '') + ' expiring within 30 days';
      if (expNames) expNames.textContent = expiringSoon.map(o => o.name + ' (' + Math.ceil((new Date(o.subscription_expires) - new Date()) / 86400000) + 'd)').join(' · ');
    }
  }

  // ── SMS Bar Chart (last 6 months) ──
  const smsByMonth = {};
  months6.forEach(m => { smsByMonth[m] = 0; });
  smsData.forEach(r => { if (smsByMonth[r.month] !== undefined) smsByMonth[r.month] += r.messages_sent || 0; });
  const smsValues = months6.map(m => smsByMonth[m]);
  const maxSms = Math.max(...smsValues, 1);
  const smsChartEl = document.getElementById('sa-sms-chart');
  if (smsChartEl) {
    smsChartEl.innerHTML = months6.map((m, i) => {
      const pct = Math.round((smsValues[i] / maxSms) * 80);
      const label = new Date(m + '-01').toLocaleDateString('en-KE', { month: 'short' });
      return `<div class="sa-bar-wrap">
        <div class="sa-bar-val">${smsValues[i] > 0 ? smsValues[i] : ''}</div>
        <div class="sa-bar" style="height:${Math.max(pct,2)}px;background:${i === 5 ? 'var(--teal)' : 'var(--teal-pale,#b2dfdb)'}"></div>
        <div class="sa-bar-label">${label}</div>
      </div>`;
    }).join('');
  }

  // ── Revenue Bar Chart (plan breakdown) ──
  const planData = [
    { label: 'Starter', count: _saOrgs.filter(o => o.plan === 'starter').length, value: 0, color: '#e0e0e0' },
    { label: 'Basic', count: _saOrgs.filter(o => o.plan === 'basic').length, value: 3000, color: 'var(--teal)' },
    { label: 'Standard', count: _saOrgs.filter(o => o.plan === 'standard').length, value: 6000, color: '#7c4dff' },
    { label: 'Pro', count: _saOrgs.filter(o => o.plan === 'pro').length, value: 12000, color: 'var(--maroon)' },
  ];
  const maxRevBar = Math.max(...planData.map(p => p.count * p.value), 1);
  const revChartEl = document.getElementById('sa-revenue-chart');
  if (revChartEl) {
    revChartEl.innerHTML = planData.map(p => {
      const rev = p.count * p.value;
      const pct = Math.round((rev / maxRevBar) * 80);
      return `<div class="sa-bar-wrap">
        <div class="sa-bar-val">${p.count > 0 ? p.count + ' org' + (p.count > 1 ? 's' : '') : ''}</div>
        <div class="sa-bar" style="height:${Math.max(pct, 2)}px;background:${p.color}"></div>
        <div class="sa-bar-label">${p.label}</div>
      </div>`;
    }).join('');
  }

  // ── Plan Distribution Donut ──
  const donutColors = { starter: '#e0e0e0', basic: '#2a9d8f', standard: '#7c4dff', pro: '#7a1212' };
  const donutData = planData.filter(p => p.count > 0);
  const total = donutData.reduce((s, p) => s + p.count, 0) || 1;
  const svgEl = document.getElementById('sa-donut-svg');
  const legendEl = document.getElementById('sa-donut-legend');
  if (svgEl && total > 0) {
    const cx = 45, cy = 45, r = 32, stroke = 14;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    let paths = '';
    donutData.forEach(p => {
      const pct = p.count / total;
      const dash = pct * circumference;
      const gap = circumference - dash;
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${donutColors[p.label.toLowerCase()]||'#ccc'}" stroke-width="${stroke}" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash;
    });
    svgEl.innerHTML = paths + `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-size="13" font-weight="800" fill="#222">${total}</text>`;
  }
  if (legendEl) {
    legendEl.innerHTML = planData.map(p =>
      `<div class="sa-donut-leg-item"><div class="sa-donut-dot" style="background:${donutColors[p.label.toLowerCase()]}"></div><span style="flex:1">${p.label}</span><strong>${p.count}</strong></div>`
    ).join('');
  }

  // ── Activity Feed ──
  const feedEl = document.getElementById('sa-activity-feed');
  if (feedEl) {
    if (!activityItems.length) {
      feedEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.72rem">No activity yet</div>';
    } else {
      feedEl.innerHTML = activityItems.map(a => {
        const when = new Date(a.created_at);
        const timeStr = when.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) + ' ' + when.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
        return `<div class="sa-feed-item">
          <div class="sa-feed-dot"></div>
          <div>
            <div class="sa-feed-text"><strong>${h(a.action || '')}</strong> · ${h((a.details || '').slice(0, 60)) + ((a.details||'').length > 60 ? '…' : '')}</div>
            <div class="sa-feed-time">${h(a.user_name || 'System')} · ${timeStr}</div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── Render org table ──
  filterSAOrgs('');
}

function _renderSAOrgRow(o) {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const memberCount = _saMemberCount[o.id] || 0;
  const statusKey = o.subscription_status === 'active' ? 'active'
    : o.subscription_status === 'trial' ? 'trial'
    : o.status === 'suspended' ? 'suspended'
    : 'trial';
  const expires = o.subscription_expires;
  const expDisplay = expires
    ? (expires <= today ? '<span style="color:var(--danger)">Expired</span>'
      : expires <= thirtyDays ? '<span style="color:var(--warning)">' + expires + '</span>'
      : expires)
    : '—';
  const smsBundle = (o.sms_bundle || 0);
  const smsBadge = smsBundle < 50 && smsBundle > 0
    ? '<span style="color:var(--danger);font-size:.65rem"> ⚠ Low</span>'
    : '';

  return `<tr onclick="openOrgDetail('${o.id}')">
    <td>
      <div style="font-weight:600;font-size:.82rem">${h(o.name)}</div>
      <div style="font-size:.65rem;color:var(--ink-faint);font-family:monospace">${h(o.org_code||'—')}</div>
    </td>
    <td><span class="sa-plan ${o.plan||'starter'}">${(o.plan||'starter').toUpperCase()}</span></td>
    <td><span class="sa-status ${statusKey}">${statusKey}</span></td>
    <td style="font-weight:600">${memberCount}</td>
    <td>${smsBundle.toLocaleString()} SMS${smsBadge}</td>
    <td style="font-size:.75rem">${expDisplay}</td>
    <td onclick="event.stopPropagation()"><button class="btn btn-secondary btn-sm" style="font-size:.68rem;white-space:nowrap" onclick="openOrgDetail('${o.id}')">View →</button></td>
  </tr>`;
}

// Dashboard preview — most recently created orgs, capped at 8, no filters (search/filter live on the full page)
function filterSAOrgs(q) {
  const countEl = document.getElementById('sa-org-count');
  if (countEl) countEl.textContent = _saOrgs.length + ' total';

  const tbody = document.getElementById('sa-org-list');
  if (!tbody) return;
  if (!_saOrgs.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--ink-faint)">No organisations yet</td></tr>';
    return;
  }
  const preview = _saOrgs.slice(0, 8);
  tbody.innerHTML = preview.map(_renderSAOrgRow).join('');
}

// Full Organisations page — search + plan/status filters, full list
async function loadSAOrganisations() {
  if (!_saOrgs.length) {
    // Standalone entry — populate cache if the dashboard hasn't loaded it yet
    const [orgsRes, membersRes] = await Promise.all([
      sb.from('organisations').select('*').order('created_at', { ascending: false }),
      sb.from('members').select('id,org_id'),
    ]);
    _saOrgs = orgsRes.data || [];
    _saMemberCount = {};
    (membersRes.data || []).forEach(m => { _saMemberCount[m.org_id] = (_saMemberCount[m.org_id] || 0) + 1; });
  }
  filterSAOrgsFull('');
}

function filterSAOrgsFull(q) {
  const planFilter = document.getElementById('sa-plan-filter-full')?.value || '';
  const statusFilter = document.getElementById('sa-status-filter-full')?.value || '';
  const query = (q || '').toLowerCase();

  const filtered = _saOrgs.filter(o => {
    const matchQ = !query || o.name?.toLowerCase().includes(query) || o.org_code?.toLowerCase().includes(query) || o.reg_number?.toLowerCase().includes(query);
    const matchPlan = !planFilter || o.plan === planFilter;
    const matchStatus = !statusFilter || o.status === statusFilter || o.subscription_status === statusFilter;
    return matchQ && matchPlan && matchStatus;
  });

  const countEl = document.getElementById('sa-org-count-full');
  if (countEl) countEl.textContent = filtered.length + ' of ' + _saOrgs.length + ' orgs';

  const tbody = document.getElementById('sa-org-list-full');
  if (!tbody) return;
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--ink-faint)">No organisations match</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(_renderSAOrgRow).join('');
}


function switchTab(el, panelId) {
  const container = el.closest('.page') || el.closest('.modal') || el.closest('.modal-body') || el.parentElement.parentElement;
  if (container) {
    container.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    container.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  }
  el.classList.add('active');
  const panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');
  if (panelId==='tab-transactions'||panelId==='tab-expenses') loadFinance();
}

// ── MODALS ──
function showModal(id) {
  const el = document.getElementById('modal-'+id);
  if (!el) return;
  el.classList.add('open');
  if (id==='recordPayment'||id==='addMember'||id==='welfareEvent') populateSelects();
  if (id==='memberPayment') openMemberPaymentModal();
  if (id==='welfareEvent') {
    // Reset payout destination back to default each time this opens fresh —
    // otherwise a previous event's "Pay Directly" selection and recipient
    // details would silently carry over into the next one.
    document.querySelectorAll('#wel-payout-seg .seg-opt').forEach(o=>o.classList.remove('active'));
    document.querySelector('#wel-payout-seg .seg-opt[data-val="group_platform"]')?.classList.add('active');
    const hidden = document.getElementById('wel-payout-type'); if (hidden) hidden.value = 'group_platform';
    const directFields = document.getElementById('wel-direct-payout-fields'); if (directFields) directFields.style.display = 'none';
    ['wel-recipient-name','wel-recipient-phone','wel-recipient-bank-name','wel-recipient-bank-account'].forEach(fid => { const f = document.getElementById(fid); if (f) f.value = ''; });
  }
}
function closeModal(id) { document.getElementById('modal-'+id)?.classList.remove('open'); }
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if(e.target===o) o.classList.remove('open'); }));
});

// ── TOAST ──
function toast(msg) {
  const t = document.getElementById('toast-el');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}


// ── SUPERADMIN: ALL MEMBERS ──
var allSAUsers = [];   // one entry per auth user (profile)
var allSAOrgsMap = {}; // orgId → org name
var allSAUserOrgs = []; // all user_orgs rows
var allSAMemberRows = []; // all member rows (for org memberships per user)

async function loadSAMembers() {
  document.getElementById('sa-all-members').innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div>Loading all users…</div></td></tr>';
  // Fetch profiles, user_orgs, members and orgs in parallel
  const [profilesRes, userOrgsRes, membersRes, orgsRes] = await Promise.all([
    sb.from('profiles').select('*').order('full_name'),
    sb.from('user_orgs').select('*'),
    sb.from('members').select('id,org_id,user_id,portal_email,member_number,internal_number,display_number,is_founder,status,shares_balance,savings_balance'),
    sb.from('organisations').select('id,name,plan,status')
  ]);
  // Deduplicate profiles by id (old schema had one row per org)
  const rawProfiles = profilesRes.data || [];
  const seenIds = new Set();
  allSAUsers = rawProfiles.filter(p => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });
  allSAUserOrgs = userOrgsRes.data || [];
  allSAMemberRows = membersRes.data || [];
  allSAOrgsMap = {};
  (orgsRes.data||[]).forEach(o => allSAOrgsMap[o.id] = o);
  window._saOrgMap = allSAOrgsMap;
  renderSAUsers(allSAUsers);
}

function renderSAUsers(list) {
  const tbody = document.getElementById('sa-all-members');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--ink-faint)">No users found</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(u => {
    // Find all orgs this user belongs to via user_orgs (primary) + members table (fallback)
    const userOrgRows = allSAUserOrgs.filter(uo => uo.user_id === u.id);
    const memberOrgIds = allSAMemberRows.filter(m => m.user_id === u.id).map(m => m.org_id);
    const allOrgIds = [...new Set([...userOrgRows.map(uo => uo.org_id), ...memberOrgIds])];
    const orgCount = allOrgIds.length;
    // members table used only for founder badge, not org count
    const memberRows = allSAMemberRows.filter(m => m.user_id === u.id);
    const orgNames = allOrgIds.map(orgId => {
      const org = allSAOrgsMap[orgId];
      return org ? org.name : null;
    }).filter(Boolean);
    const isFounder = memberRows.some(m => m.is_founder);
    // Display
    const orgBadges = orgCount
      ? orgNames.slice(0,2).map(n => `<span class="badge badge-maroon" style="font-size:.58rem;text-transform:capitalize;margin-right:2px">${n}</span>`).join('') + (orgCount > 2 ? `<span style="font-size:.65rem;color:var(--ink-faint)"> +${orgCount-2} more</span>` : '')
      : '<span style="font-size:.68rem;color:var(--ink-faint)">No groups</span>';
    const roleBadge = u.role === 'superadmin'
      ? '<span class="badge" style="background:var(--maroon);color:#fff;font-size:.58rem">SUPERADMIN</span>'
      : u.role === 'admin'
      ? '<span class="badge badge-green" style="font-size:.58rem">ADMIN</span>'
      : '<span class="badge badge-grey" style="font-size:.58rem">MEMBER</span>';
    return `<tr>
      <td><strong>${u.full_name||'—'}</strong>${isFounder ? ' <span title="Founding member in at least one group" style="font-size:.8rem">🏛</span>' : ''}<div style="font-size:.65rem;color:var(--ink-faint)">${u.email||'—'}</div></td>
      <td style="font-size:.78rem">${u.phone||'—'}</td>
      <td>${orgBadges}</td>
      <td>${roleBadge}</td>
      <td><span class="badge ${orgCount?'badge-green':'badge-grey'}" style="font-size:.6rem">${orgCount} org${orgCount!==1?'s':''}</span></td>
      <td><button class="btn btn-ghost btn-sm" style="font-size:.65rem" onclick="saViewUser('${u.id}')">View →</button></td>
    </tr>`;
  }).join('');
}

function filterSAMembers(q) {
  if (!q || q.length < 2) { renderSAUsers(allSAUsers); return; }
  const ql = q.toLowerCase();
  const f = allSAUsers.filter(u =>
    (u.full_name||'').toLowerCase().includes(ql) ||
    (u.email||'').toLowerCase().includes(ql) ||
    (u.phone||'').includes(q)
  );
  renderSAUsers(f);
}

// ── SA USER DETAIL MODAL ──
async function saViewUser(userId) {
  const u = allSAUsers.find(x => x.id === userId);
  if (!u) return;

  // Header
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setHTML = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };

  setEl('sau-name', u.full_name || '—');
  setEl('sau-email', u.email || '—');
  setEl('sau-phone', u.phone || '—');
  setEl('sau-role', u.role || 'member');

  // 2FA toggle — only show for admin/treasurer roles
  const twoFaRow = document.getElementById('sau-2fa-row');
  const twoFaCb = document.getElementById('sau-2fa-enabled');
  const isElevated = ['admin','treasurer'].includes(u.role);
  if (twoFaRow) twoFaRow.style.display = isElevated ? 'flex' : 'none';
  if (twoFaCb) {
    twoFaCb.checked = u.two_fa_enabled || false;
    twoFaCb.dataset.userId = userId;
  }

  // Clear SA fields
  const saEmail = document.getElementById('sau-sa-email');
  const saPwd = document.getElementById('sau-sa-password');
  const saStatus = document.getElementById('sau-sa-status');
  if (saEmail) saEmail.value = '';
  if (saPwd) saPwd.value = '';
  if (saStatus) saStatus.textContent = '';
  const saSection = document.getElementById('sau-sa-section');
  if (saSection) saSection.dataset.userId = userId;

  // Build org memberships
  const userOrgRows = allSAUserOrgs.filter(uo => uo.user_id === userId);
  const memberRows = allSAMemberRows.filter(m => m.user_id === userId || m.portal_email === u.email);

  if (!userOrgRows.length && !memberRows.length) {
    setHTML('sau-orgs-list',
      `<div style="padding:1rem;text-align:center;color:var(--ink-faint);font-size:.82rem">
        No group memberships found.
        <div style="margin-top:.5rem">
          <button class="btn btn-secondary btn-sm" onclick="saResendPortalInvite('${u.email}','${u.full_name||''}')">✉ Resend Portal Invite</button>
        </div>
      </div>`
    );
  } else {
    const rows = userOrgRows.map(uo => {
      const org = allSAOrgsMap[uo.org_id] || {};
      const memberRecord = memberRows.find(m => m.org_id === uo.org_id);
      const dispNum = memberRecord
        ? (memberRecord.display_number || (memberRecord.internal_number ? String(memberRecord.internal_number).padStart(3,'0') : memberRecord.member_number) || '—')
        : '—';
      const bal = memberRecord ? (Number(memberRecord.shares_balance||0) + Number(memberRecord.savings_balance||0)) : 0;
      const isFounder = memberRecord?.is_founder;
      return `<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;border-bottom:0.5px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${org.name||'Unknown'}</div>
          <div style="font-size:.68rem;color:var(--ink-faint)">${uo.role||'member'} · Member #${dispNum}${isFounder?' 🏛':''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.78rem;font-weight:600;color:var(--maroon)">Ksh ${bal.toLocaleString()}</div>
          <span class="badge ${memberRecord?.status==='active'?'badge-green':memberRecord?.status==='arrears'?'badge-warn':'badge-grey'}" style="font-size:.58rem">${memberRecord?.status||'—'}</span>
        </div>
        ${memberRecord ? `<button class="btn btn-ghost btn-sm" style="font-size:.62rem;flex-shrink:0" onclick="saViewMember('${memberRecord.id}','${uo.org_id}')">Detail →</button>` : ''}
      </div>`;
    });
    // Also add any member rows not covered by user_orgs (orphaned member records linked by email)
    const coveredOrgIds = new Set(userOrgRows.map(uo => uo.org_id));
    memberRows.filter(m => !coveredOrgIds.has(m.org_id)).forEach(m => {
      const org = allSAOrgsMap[m.org_id] || {};
      const dispNum = m.display_number || (m.internal_number ? String(m.internal_number).padStart(3,'0') : m.member_number) || '—';
      const bal = Number(m.shares_balance||0) + Number(m.savings_balance||0);
      rows.push(`<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;border-bottom:0.5px solid var(--border);opacity:.75">
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${org.name||'Unknown'} <span style="font-size:.62rem;color:var(--ink-faint)">(email-linked)</span></div>
          <div style="font-size:.68rem;color:var(--ink-faint)">member · #${dispNum}${m.is_founder?' 🏛':''}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.78rem;font-weight:600;color:var(--maroon)">Ksh ${bal.toLocaleString()}</div>
          <span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey'}" style="font-size:.58rem">${m.status||'—'}</span>
        </div>
        <button class="btn btn-ghost btn-sm" style="font-size:.62rem;flex-shrink:0" onclick="saViewMember('${m.id}','${m.org_id}')">Detail →</button>
      </div>`);
    });
    setHTML('sau-orgs-list', rows.join(''));
  }

  showModal('saUserDetail');
}

async function saToggle2FA() {
  const cb = document.getElementById('sau-2fa-enabled');
  if (!cb) return;
  const userId = cb.dataset.userId;
  const enabled = cb.checked;
  try {
    await sb.from('profiles').update({ two_fa_enabled: enabled }).eq('id', userId);
    toast(`2FA ${enabled ? 'enabled' : 'disabled'} for this user`);
    // Update local cache
    const u = allSAUsers.find(x => x.id === userId);
    if (u) u.two_fa_enabled = enabled;
  } catch(e) {
    toast('Error: ' + e.message);
    cb.checked = !enabled; // revert
  }
}

async function saDeleteUser() {
  const section = document.getElementById('sau-sa-section');
  const userId = section?.dataset.userId;
  const userName = document.getElementById('sau-name')?.textContent || 'this user';
  const statusEl = document.getElementById('sau-delete-status');
  if (!userId) return;

  // Double confirm
  if (!confirm(`Delete ${userName}?\n\nThis will permanently remove their account, all group memberships, and activity history. This cannot be undone.`)) return;
  if (!confirm(`Are you absolutely sure? "${userName}" will be gone forever.`)) return;

  if (statusEl) { statusEl.textContent = 'Deleting…'; statusEl.style.color = 'var(--ink-faint)'; }

  try {
    const { error } = await sb.rpc('delete_user_completely', { p_user_id: userId });
    if (error) throw new Error(error.message);
    if (statusEl) { statusEl.textContent = '✓ User deleted.'; statusEl.style.color = 'var(--success)'; }
    await logActivity('SA DELETE USER', `Superadmin permanently deleted user ${userId} (${userName})`);
    setTimeout(async () => {
      closeModal('saUserDetail');
      await loadSAMembers();
    }, 1200);
  } catch(e) {
    if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = 'var(--danger)'; }
  }
}

async function saResendPortalInvite(email, name) {
  if (!email) { toast('No email on this account'); return; }
  try {
    await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://app.groupyetu.org/?intent=reset' });
    toast(`✓ Password reset link sent to ${email}`);
    await logActivity('SA PORTAL INVITE', `Superadmin resent portal invite to ${email} (${name})`);
  } catch(e) { toast('Error: ' + e.message); }
}

async function saUpdateUserAccount() {
  const section = document.getElementById('sau-sa-section');
  const userId = section?.dataset.userId;
  const newEmail = document.getElementById('sau-sa-email')?.value?.trim();
  const newPassword = document.getElementById('sau-sa-password')?.value;
  const statusEl = document.getElementById('sau-sa-status');
  if (!userId) { if (statusEl) { statusEl.textContent = '⚠ No user ID'; statusEl.style.color = 'var(--warning)'; } return; }
  if (!newEmail && !newPassword) { if (statusEl) { statusEl.textContent = 'Enter a new email or password.'; statusEl.style.color = 'var(--ink-faint)'; } return; }
  if (statusEl) { statusEl.textContent = 'Updating…'; statusEl.style.color = 'var(--ink-faint)'; }
  try {
    const session = await sb.auth.getSession();
    const jwt = session?.data?.session?.access_token;
    const body = { user_id: userId };
    if (newEmail) body.email = newEmail;
    if (newPassword) body.password = newPassword;
    const res = await fetch('https://eengldzvvgplgzvbutal.supabase.co/functions/v1/admin-user-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!res.ok || result.error) { if (statusEl) { statusEl.textContent = '✗ ' + (result.error||'Failed'); statusEl.style.color = 'var(--danger)'; } return; }
    // Update profile table too
    const profileUpdates = {};
    if (newEmail) profileUpdates.email = newEmail;
    if (Object.keys(profileUpdates).length) await sb.from('profiles').update(profileUpdates).eq('id', userId);
    if (statusEl) {
      statusEl.textContent = '✓ ' + [newEmail ? `Email → ${newEmail}` : '', newPassword ? 'Password updated' : ''].filter(Boolean).join(' · ');
      statusEl.style.color = 'var(--success)';
    }
    if (document.getElementById('sau-sa-email')) document.getElementById('sau-sa-email').value = '';
    if (document.getElementById('sau-sa-password')) document.getElementById('sau-sa-password').value = '';
    await logActivity('SA ACCOUNT UPDATE', `Superadmin updated auth for user ${userId}${newEmail?' — email changed':''}${newPassword?' — password reset':''}`);
    // Refresh user list
    await loadSAMembers();
  } catch(e) { if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = 'var(--danger)'; } }
}

// ── SUPERADMIN: REVENUE PAGE ──
var _revTxns = []; // cached merged transaction list (payments + manual credits) for filter re-render

async function loadSAFinance() {
  document.getElementById('sa-revenue-list').innerHTML = '<div class="loading"><div class="spinner"></div>Loading revenue data…</div>';

  const months6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months6.push(d.toISOString().slice(0, 7));
  }
  const thisMonth = new Date().toISOString().slice(0, 7);

  const [payRes, actRes, smsRes, orgsRes] = await Promise.all([
    sb.from('payment_requests').select('*,organisations(name)').order('requested_at', { ascending: false }),
    sb.from('activity_log').select('*').in('action', ['SMS CREDIT ADDED', 'PLAN UPGRADE']).order('created_at', { ascending: false }),
    sb.from('sms_usage').select('org_id,month,messages_sent').in('month', months6),
    sb.from('organisations').select('id,plan'),
  ]);

  const payments   = payRes.data || [];
  const manualLogs = actRes.data || [];
  const smsUsage   = smsRes.data || [];
  const orgs       = orgsRes.data || [];

  const isSub = p => (p.payment_type || '').startsWith('subscription');
  const isSms = p => (p.payment_type || '').startsWith('sms_bundle');
  const smsUnits = p => { const m = (p.payment_type || '').match(/sms_bundle_(\d+)/); return m ? parseInt(m[1]) : 0; };
  const approved = payments.filter(p => p.status === 'approved');

  const subRevenue = approved.filter(isSub).reduce((s, p) => s + Number(p.amount || 0), 0);
  const smsRevenue = approved.filter(isSms).reduce((s, p) => s + Number(p.amount || 0), 0);

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('rev-sub-total', 'Ksh ' + subRevenue.toLocaleString());
  set('rev-sms-total', 'Ksh ' + smsRevenue.toLocaleString());

  const smsConsumedThisMonth = smsUsage.filter(r => r.month === thisMonth).reduce((s, r) => s + (r.messages_sent || 0), 0);
  const smsSoldThisMonth = approved.filter(p => isSms(p) && (p.requested_at || '').slice(0, 7) === thisMonth)
    .reduce((s, p) => s + smsUnits(p), 0);
  set('rev-sms-sold-consumed', smsSoldThisMonth.toLocaleString() + ' sold / ' + smsConsumedThisMonth.toLocaleString() + ' used');

  const manualThisMonth = manualLogs.filter(l => (l.created_at || '').slice(0, 7) === thisMonth).length;
  set('rev-manual-count', manualThisMonth);

  // ── Subscription plan breakdown chart ──
  const planPrices = { starter: 0, basic: 3000, standard: 6000, pro: 12000 };
  const planCounts = { starter: 0, basic: 0, standard: 0, pro: 0 };
  orgs.forEach(o => { if (planCounts[o.plan] !== undefined) planCounts[o.plan]++; });
  const planData = [
    { label: 'Starter', count: planCounts.starter, value: 0, color: '#e0e0e0' },
    { label: 'Basic', count: planCounts.basic, value: planPrices.basic, color: 'var(--teal)' },
    { label: 'Standard', count: planCounts.standard, value: planPrices.standard, color: '#7c4dff' },
    { label: 'Pro', count: planCounts.pro, value: planPrices.pro, color: 'var(--maroon)' },
  ];
  const maxPlanBar = Math.max(...planData.map(p => p.count * p.value), 1);
  const planChartEl = document.getElementById('rev-plan-chart');
  if (planChartEl) {
    planChartEl.innerHTML = planData.map(p => {
      const rev = p.count * p.value;
      const pct = Math.round((rev / maxPlanBar) * 80);
      return `<div class="sa-bar-wrap">
        <div class="sa-bar-val">${p.count > 0 ? p.count + ' org' + (p.count > 1 ? 's' : '') : ''}</div>
        <div class="sa-bar" style="height:${Math.max(pct, 2)}px;background:${p.color}"></div>
        <div class="sa-bar-label">${p.label}</div>
      </div>`;
    }).join('');
  }

  // ── SMS sold vs consumed chart (last 6 months) ──
  const soldByMonth = {}; months6.forEach(m => soldByMonth[m] = 0);
  approved.filter(isSms).forEach(p => {
    const mo = (p.requested_at || '').slice(0, 7);
    if (soldByMonth[mo] !== undefined) soldByMonth[mo] += smsUnits(p);
  });
  const consumedByMonth = {}; months6.forEach(m => consumedByMonth[m] = 0);
  smsUsage.forEach(r => { if (consumedByMonth[r.month] !== undefined) consumedByMonth[r.month] += r.messages_sent || 0; });
  const maxSmsBar = Math.max(...months6.map(m => Math.max(soldByMonth[m], consumedByMonth[m])), 1);
  const smsChartEl = document.getElementById('rev-sms-chart');
  if (smsChartEl) {
    smsChartEl.innerHTML = months6.map(m => {
      const label = new Date(m + '-01').toLocaleDateString('en-KE', { month: 'short' });
      const soldPct = Math.round((soldByMonth[m] / maxSmsBar) * 80);
      const usedPct = Math.round((consumedByMonth[m] / maxSmsBar) * 80);
      return `<div class="sa-bar-wrap" style="min-width:34px">
        <div style="display:flex;align-items:flex-end;gap:3px;height:82px">
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
            <div class="sa-bar-val" style="font-size:.58rem">${soldByMonth[m] || ''}</div>
            <div style="height:${Math.max(soldPct, 2)}px;width:9px;background:var(--teal);border-radius:2px 2px 0 0"></div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
            <div class="sa-bar-val" style="font-size:.58rem">${consumedByMonth[m] || ''}</div>
            <div style="height:${Math.max(usedPct, 2)}px;width:9px;background:#e0e0e0;border-radius:2px 2px 0 0"></div>
          </div>
        </div>
        <div class="sa-bar-label">${label}</div>
      </div>`;
    }).join('');
  }

  // ── Merged transaction list ──
  _revTxns = [];
  payments.forEach(p => {
    _revTxns.push({
      date: p.requested_at,
      org: p.organisations?.name || '—',
      type: isSub(p) ? 'subscription' : isSms(p) ? 'sms' : 'other',
      typeLabel: isSub(p) ? 'Subscription' : isSms(p) ? 'SMS Bundle' : (p.payment_type || 'Payment'),
      amount: Number(p.amount || 0),
      status: p.status,
      manual: false,
      ref: p.mpesa_ref || p.notes || '—',
    });
  });
  manualLogs.forEach(l => {
    _revTxns.push({
      date: l.created_at,
      org: '—',
      type: 'manual',
      typeLabel: l.action === 'SMS CREDIT ADDED' ? 'SMS Bundle' : 'Subscription',
      amount: 0,
      status: 'manual',
      manual: true,
      ref: (l.details || '').slice(0, 70),
    });
  });
  _revTxns.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  renderRevenueTransactions();
}

function renderRevenueTransactions() {
  const listEl = document.getElementById('sa-revenue-list');
  if (!listEl) return;
  const filter = document.getElementById('rev-txn-filter')?.value || '';
  let rows = _revTxns;
  if (filter === 'pending') rows = rows.filter(r => r.status === 'pending');
  else if (filter) rows = rows.filter(r => r.type === filter);

  if (!rows.length) {
    listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--ink-faint)">No transactions match</div>';
    return;
  }

  listEl.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Organisation</th><th>Type</th><th>Amount</th><th>Status</th><th>Ref / Notes</th></tr></thead>
    <tbody>${rows.slice(0, 300).map(r => `<tr>
      <td style="font-size:.72rem;color:var(--ink-faint);white-space:nowrap">${r.date ? new Date(r.date).toLocaleDateString() : '—'}</td>
      <td style="font-size:.78rem">${h(r.org)}</td>
      <td style="font-size:.75rem">${h(r.typeLabel)}${r.manual ? ' <span class="badge badge-grey" style="font-size:.6rem">MANUAL</span>' : ''}</td>
      <td style="font-weight:600">${r.manual ? '<span style="color:var(--ink-faint)">Ksh 0</span>' : 'Ksh ' + r.amount.toLocaleString()}</td>
      <td><span class="badge ${r.status === 'approved' ? 'badge-green' : r.status === 'pending' ? 'badge-warn' : r.status === 'manual' ? 'badge-grey' : 'badge-red'}" style="font-size:.62rem">${r.status}</span></td>
      <td style="font-size:.7rem;color:var(--ink-faint)">${h(r.ref)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ── ORG DETAIL ──
var currentDetailOrgId = null;
// Store all org members for search filtering in od modal
var _odAllMembers = [];

async function openOrgDetail(orgId) {
  currentDetailOrgId = orgId;
  // Navigate to full-page org detail
  showPage('sa_org_detail');
  const { data: org } = await sb.from('organisations').select('*').eq('id', orgId).single();
  const { data: members } = await sb.from('members').select('*').eq('org_id', orgId).order('member_number');
  const { data: profiles } = await sb.from('profiles').select('id,full_name,role,email').eq('org_id', orgId);
  _odAllMembers = members || [];

  // Header
  const titleEl = document.getElementById('od-page-title');
  const subEl = document.getElementById('od-page-sub');
  if (titleEl) titleEl.textContent = org.name;
  if (subEl) subEl.textContent = (org.reg_number||'') + ' · ' + (org.org_code||'');

  // Stats
  const setEl = (id, v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('od-members', (members||[]).length);
  setEl('od-plan', org.plan?.toUpperCase()||'—');
  setEl('od-status', (org.subscription_status||org.status)?.toUpperCase()||'—');
  setEl('od-org-code', org.org_code||'—');
  setEl('od-bank-balance', 'Ksh '+(org.bank_balance||0).toLocaleString());

  // Suspend button
  const suspendBtn = document.getElementById('od-suspend-btn');
  if (suspendBtn) suspendBtn.textContent = org.status==='active' ? 'Suspend' : 'Activate';

  // Details tab fields
  const sv = (id, val) => { const el=document.getElementById(id); if(el) el.value=val||''; };
  sv('od-name', org.name); sv('od-reg', org.reg_number); sv('od-paybill', org.paybill);
  sv('od-email', org.email); sv('od-founded', org.date_founded);
  sv('od-plan-select', org.plan||'starter'); sv('od-status-select', org.status||'active');
  sv('od-bank-balance-edit', org.bank_balance||0);

  // Settings tab
  // Daraja removed — Fingo + Paystack are the only two payment providers now.
  sv('od-max-contribution', org.max_contribution_amount);
  sv('od-active-provider', org.active_payment_provider || 'paystack');

  // Provider account refs now live in org_payment_providers, not the legacy
  // paystack_subaccount_code column directly — this is what lets SA switch
  // an org's active provider at any time without touching a schema field.
  try {
    const { data: providerRows } = await sb.from('org_payment_providers')
      .select('provider, provider_account_ref').eq('org_id', orgId);
    const paystackRow = (providerRows||[]).find(p => p.provider === 'paystack');
    const fingoRow = (providerRows||[]).find(p => p.provider === 'fingo');
    sv('od-paystack-subaccount', paystackRow?.provider_account_ref || org.paystack_subaccount_code);
    sv('od-fingo-submerchant', fingoRow?.provider_account_ref);
  } catch(e) {
    sv('od-paystack-subaccount', org.paystack_subaccount_code);
  }

  // Disbursement destination + history
  const destEl = document.getElementById('od-disb-destination');
  if (destEl) {
    destEl.textContent = 'Destination: ' + (org.disbursement_method === 'bank'
      ? `Bank — ${org.disbursement_bank_name || '—'} · ${org.disbursement_bank_account_number || '—'} (${org.disbursement_bank_account_name || '—'})`
      : org.disbursement_method === 'mpesa'
        ? `M-Pesa — ${org.disbursement_mpesa_number || '—'}`
        : 'Not set — org has not submitted disbursement details yet');
  }
  const disbMethodEl = document.getElementById('sa-disb-method');
  if (disbMethodEl && org.disbursement_method) disbMethodEl.value = org.disbursement_method;
  const disbDateEl = document.getElementById('sa-disb-date');
  if (disbDateEl) disbDateEl.value = new Date().toISOString().split('T')[0];
  if (typeof loadOrgDisbursementHistory === 'function') loadOrgDisbursementHistory(orgId);

  // (Daraja env/enabled fields removed alongside the rest of the integration)
  sv('od-sms-enabled', org.sms_enabled===false?'false':'true');
  sv('od-2fa-enabled', org.two_fa_enabled?'true':'false');
  toggleDarajaSection(org.plan);

  // Billing tab
  sv('od-sub-status', org.subscription_status||'active');
  sv('od-sub-expiry', org.subscription_expires||'');
  sv('od-sms-bundle', org.sms_bundle||0);
  // Load SMS used this month from sms_usage table
  try {
    const month = new Date().toISOString().slice(0,7);
    const { data: usage } = await sb.from('sms_usage')
      .select('messages_sent').eq('org_id', org.id).eq('month', month).maybeSingle();
    sv('od-sms-used', usage?.messages_sent || 0);
  } catch(e) { sv('od-sms-used', 0); }

  // Admin users
  const adminsEl = document.getElementById('od-admins-list');
  if (adminsEl) {
    const admins = (profiles||[]).filter(p=>['admin','officer','treasurer'].includes(p.role));
    adminsEl.innerHTML = admins.length ? admins.map(p=>`
      <div style="display:flex;align-items:center;gap:.65rem;padding:.5rem 0;border-bottom:1px solid var(--border)">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--maroon-pale);display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:var(--maroon)">${(p.full_name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase()}</div>
        <div style="flex:1"><div style="font-size:.82rem;font-weight:600">${p.full_name||'—'}</div><div style="font-size:.7rem;color:var(--ink-faint)">${p.role} · ${p.email||'no email'}</div></div>
        <button class="btn btn-secondary btn-sm" style="font-size:.68rem" onclick="document.getElementById('od-reset-email').value='${p.email||''}';switchSAOrgTab(document.querySelector('[onclick*=sa-od-tab-support]'),'sa-od-tab-support')">Reset PW</button>
      </div>`).join('') : '<div style="color:var(--ink-faint);font-size:.8rem">No admin users linked</div>';
  }

  // Support tab — prefill reset email
  const resetEl = document.getElementById('od-reset-email');
  const primaryAdmin = (profiles||[]).find(p=>['admin'].includes(p.role));
  if (resetEl && primaryAdmin?.email) resetEl.value = primaryAdmin.email;

  // Reset tabs to first
  switchSAOrgTab(document.querySelector('#page-sa_org_detail .fin-tab'), 'sa-od-tab-details');
  // Load activity log for this org
  loadODActivity(orgId);
}

async function loadODActivity(orgId) {
  const el = document.getElementById('od-activity-log');
  if (!el) return;
  try {
    const { data: logs } = await sb.from('activity_log')
      .select('*').eq('org_id', orgId)
      .order('created_at', {ascending: false}).limit(20);
    if (!logs?.length) {
      el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No activity logged for this organisation yet</div>';
      return;
    }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Action</th><th>User</th><th>Details</th></tr></thead>
      <tbody>${logs.map(l => `<tr>
        <td style="font-size:.68rem;color:var(--ink-faint);white-space:nowrap">${new Date(l.created_at).toLocaleString('en-KE',{dateStyle:'short',timeStyle:'short'})}</td>
        <td><span class="badge badge-grey" style="font-size:.6rem">${l.action||'—'}</span></td>
        <td style="font-size:.75rem">${l.user_name||l.user_id?.slice(0,8)||'system'}</td>
        <td style="font-size:.72rem;color:var(--ink-soft);max-width:300px;word-break:break-word">${l.details||'—'}</td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  } catch(e) {
    el.innerHTML = '<div style="padding:1rem 1.25rem;color:var(--ink-faint);font-size:.78rem">Activity log not available</div>';
  }
}

function switchSAOrgTab(btn, tabId) {
  document.querySelectorAll('#page-sa_org_detail .fin-tab').forEach(t=>t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-sa_org_detail .tab-panel').forEach(p=>p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
}

async function saToggleOrgStatus() {
  if (!currentDetailOrgId) return;
  const org = _saOrgs.find(o=>o.id===currentDetailOrgId);
  if (!org) return;
  const newStatus = org.status==='active' ? 'suspended' : 'active';
  if (!confirm(`${newStatus==='suspended'?'Suspend':'Activate'} ${org.name}?`)) return;
  await sb.from('organisations').update({status:newStatus}).eq('id',currentDetailOrgId);
  toast(`✓ ${org.name} ${newStatus}`);
  org.status = newStatus;
  document.getElementById('od-suspend-btn').textContent = newStatus==='active'?'Suspend':'Activate';
  document.getElementById('od-status').textContent = newStatus.toUpperCase();
  document.getElementById('od-status-select').value = newStatus;
}

async function loadODMembers() {
  const tbEl = document.getElementById('od-members-list');
  const countEl = document.getElementById('od-members-count');
  if (!tbEl) return;
  tbEl.innerHTML = '<tr><td colspan="7"><div class="loading"><div class="spinner"></div></div></td></tr>';
  const { data: members } = await sb.from('members').select('*').eq('org_id', currentDetailOrgId).order('member_number');
  _odAllMembers = members||[];
  if (countEl) countEl.textContent = _odAllMembers.length + ' members';
  renderODMembers(_odAllMembers);
}

async function loadODFinance() {
  const statsEl = document.getElementById('od-finance-stats');
  const txnEl = document.getElementById('od-recent-txns');
  const ctEl = document.getElementById('od-contrib-types');
  if (statsEl) statsEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const [txnRes, ctRes] = await Promise.all([
    sb.from('transactions').select('*,members(full_name),contribution_types(name)').eq('org_id',currentDetailOrgId).order('created_at',{ascending:false}).limit(20),
    sb.from('contribution_types').select('*').eq('org_id',currentDetailOrgId)
  ]);
  const txns = txnRes.data||[];
  const cts = ctRes.data||[];
  const totalTxn = txns.reduce((s,t)=>s+Number(t.amount||0),0);
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card"><div class="stat-label">Total Transactions</div><div class="stat-value">${txns.length}</div></div>
    <div class="stat-card green"><div class="stat-label">Total Recorded</div><div class="stat-value" style="font-size:1.1rem">Ksh ${totalTxn.toLocaleString()}</div></div>
    <div class="stat-card"><div class="stat-label">Contribution Types</div><div class="stat-value">${cts.length}</div></div>`;
  if (txnEl) txnEl.innerHTML = txns.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Amount</th></tr></thead><tbody>
    ${txns.map(t=>`<tr><td style="font-size:.72rem;color:var(--ink-faint)">${t.transaction_date||t.created_at?.split('T')[0]||'—'}</td><td style="font-size:.8rem">${h(t.members?.full_name)||'—'}</td><td style="font-size:.75rem">${h(t.contribution_types?.name)||'Payment'}</td><td style="font-weight:600">Ksh ${Number(t.amount).toLocaleString()}</td></tr>`).join('')}
    </tbody></table></div>` : '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No transactions</div>';
  if (ctEl) ctEl.innerHTML = cts.length ? cts.map(ct=>`
    <div style="display:flex;justify-content:space-between;padding:.5rem 1.25rem;border-bottom:1px solid var(--border);font-size:.8rem">
      <span>${ct.name}</span><span style="color:var(--ink-faint)">${ct.income_type||'—'}</span>
    </div>`).join('') : '<div style="padding:1rem 1.25rem;color:var(--ink-faint);font-size:.8rem">No contribution types</div>';
}

async function loadODSMS() {
  const histEl = document.getElementById('od-sms-history');
  if (!histEl) return;
  histEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const { data: usage } = await sb.from('sms_usage').select('*').eq('org_id',currentDetailOrgId).order('month',{ascending:false}).limit(12);
  const rows = usage||[];
  histEl.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Month</th><th>SMS Sent</th><th>Cost to Org</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td style="font-weight:600">${r.month}</td><td>${r.messages_sent||0}</td><td>Ksh ${(Number(r.charged_to_org||0)).toLocaleString()}</td></tr>`).join('')}
    </tbody></table></div>` : '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No SMS usage recorded</div>';
}

async function loadODSubscription() {
  const histEl = document.getElementById('od-payment-history');
  if (!histEl) return;
  histEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const { data: pays } = await sb.from('payment_requests').select('*').eq('org_id',currentDetailOrgId).order('requested_at',{ascending:false}).limit(20);
  const rows = pays||[];
  histEl.innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Status</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td style="font-size:.72rem;color:var(--ink-faint)">${r.requested_at?.split('T')[0]||'—'}</td><td style="font-size:.75rem">${r.payment_type||r.payment_type_display||'—'}</td><td>Ksh ${Number(r.amount||0).toLocaleString()}</td><td><span class="badge ${r.status==='approved'?'badge-green':r.status==='pending'?'badge-warn':'badge-red'}" style="font-size:.62rem">${r.status}</span></td></tr>`).join('')}
    </tbody></table></div>` : '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No payment history</div>';
}

async function addSMSCredit(count) {
  if (!currentDetailOrgId) return;
  const bundleEl = document.getElementById('od-sms-bundle');
  const current = parseInt(bundleEl?.value||0);
  const newCount = current + count;
  await sb.from('organisations').update({sms_bundle: newCount}).eq('id',currentDetailOrgId);
  if (bundleEl) bundleEl.value = newCount;
  toast(`✓ +${count} SMS credit added — total: ${newCount}`);
  await logActivity('SMS CREDIT ADDED', `Added ${count} SMS to ${currentDetailOrgId}`, 'organisation', currentDetailOrgId);
}

async function saSetBankBalance() {
  const newBal = Number(document.getElementById('od-new-balance')?.value||0);
  if (!currentDetailOrgId || isNaN(newBal)) { toast('Enter a valid balance'); return; }
  if (!confirm(`Set bank balance to Ksh ${newBal.toLocaleString()} for this organisation?`)) return;
  await sb.from('organisations').update({bank_balance: newBal, bank_balance_updated: new Date().toISOString().split('T')[0]}).eq('id',currentDetailOrgId);
  document.getElementById('od-bank-balance').textContent = 'Ksh ' + newBal.toLocaleString();
  document.getElementById('od-bank-balance-edit').value = newBal;
  toast(`✓ Bank balance set to Ksh ${newBal.toLocaleString()}`);
}

async function saResetPassword() {
  const email = document.getElementById('od-reset-email')?.value?.trim();
  if (!email) { toast('Enter admin email address'); return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://app.groupyetu.org/?intent=reset' });
  if (error) { toast('Error: '+error.message); return; }
  toast(`✓ Password reset link sent to ${email}`);
}

async function sendMessageToOrgAdmin() {
  const msg = document.getElementById('od-admin-message')?.value?.trim();
  if (!msg) { toast('Enter a message'); return; }
  if (!currentDetailOrgId) return;
  const org = _saOrgs.find(o=>o.id===currentDetailOrgId);
  if (!org) return;

  // Get admin/treasurer/officer contacts for THIS org — role lives on
  // user_orgs, never on profiles.role (profiles.role is platform-wide
  // account status only: member/admin/superadmin/pending — see HANDOVER.md).
  // This was the actual bug: the old query filtered profiles.role for
  // 'admin'/'officer'/'treasurer', which those rows never contain as an
  // org-scoped value, so it always came back empty regardless of how many
  // real admins the org had.
  const { data: adminLinks } = await sb.from('user_orgs')
    .select('user_id').eq('org_id', currentDetailOrgId).in('role', ['admin','treasurer','officer']);
  if (!adminLinks?.length) { toast('No admin/treasurer/officer found for this org'); return; }

  const userIds = adminLinks.map(a => a.user_id);
  const { data: profiles } = await sb.from('profiles').select('phone,full_name').in('id', userIds);
  const phones = (profiles||[]).map(p=>p.phone).filter(Boolean);
  if (!phones.length) { toast('Admin(s) found, but none have a phone number on file'); return; }

  // This used to be a stub ("SMS feature coming soon") — now actually sends,
  // reusing the same sendSMS()/send-sms-celcom path every org's own Messages
  // page uses. currentOrg is swapped to this org while viewing its detail
  // page, so the SMS bundle/org_id context resolves correctly.
  const btn = document.getElementById('od-send-admin-sms-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  const result = await sendSMS(phones, msg, currentDetailOrgId);
  if (btn) { btn.disabled = false; btn.textContent = '📱 Send SMS to Admin →'; }

  if (result?.sent > 0) {
    toast(`✓ SMS sent to ${result.sent} admin(s)${result.failed?`, ${result.failed} failed`:''}`);
    document.getElementById('od-admin-message').value = '';
    try { await logActivity('SA MESSAGE TO ADMIN', `Sent SMS to ${result.sent} admin(s) of ${org.name}: "${msg}"`, 'organisation', currentDetailOrgId); } catch(e) {}
  } else {
    toast('⚠ Failed to send — check SMS provider configuration in Platform Settings');
  }
}

async function saDeleteOrg() {
  if (!currentDetailOrgId) return;
  const org = _saOrgs.find(o=>o.id===currentDetailOrgId);
  if (!org) return;
  if (!confirm(`Delete "${org.name}"?\n\nThis cannot be undone.`)) return;
  const { error } = await sb.from('organisations').delete().eq('id',currentDetailOrgId);
  if (error) { toast('Error: '+error.message); return; }
  toast(`✓ ${org.name} deleted`);
  showPage('superadmin');
  loadSuperAdmin();
}

function renderODMembers(members) {
  const countEl = document.getElementById('od-members-count');
  if (countEl) countEl.textContent = members.length + ' members';
  document.getElementById('od-members-list').innerHTML = members.length ? members.map(m=>{
    const bal = Number(m.shares_balance||0)+Number(m.savings_balance||0);
    const hasPortal = !!m.portal_email;
    const dispNum = m.display_number || (m.internal_number ? String(m.internal_number).padStart(3,'0') : m.member_number) || '—';
    return `<tr>
      <td style="font-weight:700;color:var(--maroon)">${dispNum}${m.is_founder ? ' 🏛' : ''}</td>
      <td><strong>${m.full_name}</strong><div style="font-size:.68rem;color:var(--ink-faint)">${m.email||''}</div></td>
      <td style="font-size:.78rem">${m.phone||'—'}</td>
      <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':m.status==='deregistered'?'badge-red':'badge-grey'}" style="font-size:.62rem">${m.status}</span></td>
      <td style="font-weight:600">Ksh ${bal.toLocaleString()}</td>
      <td><span class="${hasPortal?'badge badge-green':'badge badge-grey'}" style="font-size:.6rem">${hasPortal?'✓ Linked':'—'}</span></td>
      <td><button class="btn btn-secondary btn-sm" style="font-size:.65rem" onclick="saViewMember('${m.id}','${m.org_id}')">View</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--ink-faint)">No members yet</td></tr>';
}

async function saViewMember(memberId, orgId) {
  // Temporarily patch currentOrg so openMemberDetail queries the right org
  if (orgId && orgId !== currentOrg?.id) {
    const { data: org } = await sb.from('organisations').select('*').eq('id', orgId).single();
    if (org) {
      currentOrg = org;
      // Load fin profile for this org so balance cards render correctly
      try { await loadOrgFinancialProfile(); } catch(e) {}
    }
  }
  // Open the standard member detail modal — it now includes the superadmin account panel.
  // currentOrg is intentionally NOT restored here — the modal stays open after this function
  // returns, and actions inside it (Send Invite, Save Changes, etc.) still need currentOrg
  // to point at the org being viewed. Restoring it early caused those actions to silently
  // send an empty org_id. It gets naturally replaced next time SA opens a different org.
  await openMemberDetail(memberId);
}

function filterODMembers(q) {
  const filtered = q.length < 2 ? _odAllMembers : _odAllMembers.filter(m =>
    (m.full_name||'').toLowerCase().includes(q.toLowerCase()) ||
    (m.phone||'').includes(q) || (m.email||'').toLowerCase().includes(q.toLowerCase())
  );
  renderODMembers(filtered);
}

async function extendSubscription(months) {
  if (!currentDetailOrgId) return;
  const expiryEl = document.getElementById('od-sub-expiry');
  const current = expiryEl?.value ? new Date(expiryEl.value) : new Date();
  if (current < new Date()) current.setTime(new Date().getTime()); // if expired, start from today
  current.setMonth(current.getMonth() + months);
  const newExpiry = current.toISOString().split('T')[0];
  if (expiryEl) expiryEl.value = newExpiry;
  // Also set status to active
  const subStatusEl = document.getElementById('od-sub-status');
  if (subStatusEl) subStatusEl.value = 'active';
  toast('Expiry extended to ' + newExpiry + ' — click Save Changes to apply');
}

async function unlockBankBalance() {
  if (!currentDetailOrgId) return;
  if (!confirm('Allow this organisation to edit their bank balance once?')) return;
  await sb.from('organisations').update({ bank_balance_locked: false }).eq('id', currentDetailOrgId);
  toast('Bank balance unlocked for editing');
}

// Daraja removed from the platform — kept as a no-op in case any lingering
// onclick/onchange reference wasn't caught during cleanup.
function toggleDarajaSection() {}

async function saveOrgDetail() {
  if (!currentDetailOrgId) return;
  const plan = document.getElementById('od-plan-select')?.value;
  const gv = (id) => document.getElementById(id)?.value?.trim() || null;
  const updates = {
    name: gv('od-name'),
    reg_number: gv('od-reg'),
    paybill: gv('od-paybill'),
    plan,
    status: document.getElementById('od-status-select')?.value,
    date_founded: gv('od-founded'),
    email: gv('od-email'),
    // Features
    sms_enabled: document.getElementById('od-sms-enabled')?.value !== 'false',
    two_fa_enabled: document.getElementById('od-2fa-enabled')?.value === 'true',
    // Billing
    subscription_status: document.getElementById('od-sub-status')?.value || 'active',
    subscription_expires: gv('od-sub-expiry'),
    sms_bundle: parseInt(document.getElementById('od-sms-bundle')?.value) || 0
  };
  // (Daraja credentials removed — Fingo + Paystack are the only two payment providers now)
  // Provider account refs (Paystack subaccount, Fingo sub-merchant, active
  // provider) are saved separately via saveOrgProviderSettings() into
  // org_payment_providers — not written here, to keep this one save action
  // scoped to general org details rather than payment routing.
  const maxContribRaw = document.getElementById('od-max-contribution')?.value;
  updates.max_contribution_amount = maxContribRaw ? parseFloat(maxContribRaw) : null;
  const { error } = await sb.from('organisations').update(updates).eq('id', currentDetailOrgId);
  if (error) { toast('Error: '+error.message); return; }
  toast('✓ Organisation updated successfully');
  closeModal('orgDetail');
  loadSuperAdmin();
}

async function deleteOrg() {
  if (!currentDetailOrgId) return;
  const { data: org } = await sb.from('organisations').select('name').eq('id', currentDetailOrgId).single();
  if (!org) { toast('Organisation not found'); return; }
  if (!confirm(`Delete "${org.name}" and ALL its data?\n\nThis will permanently remove all members, transactions, meetings and records.\n\nThis cannot be undone.`)) return;
  toast('Deleting ' + org.name + '…');
  const id = currentDetailOrgId;
  const del = async (table, col='org_id') => {
    try { await sb.from(table).delete().eq(col, id); } catch(e) { console.warn(table, e.message); }
  };
  try {
    // 1. Attendance — FK to meetings
    const { data: mtgs } = await sb.from('meetings').select('id').eq('org_id', id);
    if (mtgs?.length) {
      try { await sb.from('attendance').delete().in('meeting_id', mtgs.map(m=>m.id)); } catch(e) {}
    }
    // 2. Rotating savings — child tables first
    let rounds = [];
    try {
      const { data: rData } = await sb.from('savings_rounds').select('id').eq('org_id', id);
      rounds = rData || [];
    } catch(e) {}
    if (rounds.length) {
      const rids = rounds.map(r=>r.id);
      try { await sb.from('round_contributions').delete().in('round_id', rids); } catch(e) {}
      try { await sb.from('round_disbursements').delete().in('round_id', rids); } catch(e) {}
      try { await sb.from('round_slots').delete().in('round_id', rids); } catch(e) {}
    }
    await del('savings_rounds');
    // 3. Payment requests
    await del('payment_requests');
    // 4. Welfare contributions then events
    try { await sb.from('welfare_contributions').delete().eq('org_id', id); } catch(e) {}
    await del('welfare_events');
    // 5. All org_id child tables
    for (const t of ['transactions','expenses','contribution_types','messages_log','projects','activity_log','sms_usage','pending_members']) {
      await del(t);
    }
    // 6. Meetings
    await del('meetings');
    // 7. Members (FK to profiles via portal_email — no constraint, safe to delete)
    await del('members');
    // 8. user_orgs — removes user membership links
    await del('user_orgs');
    // 9. Profiles — unlink from org first (set org_id to null via raw SQL workaround)
    // We can't null org_id directly due to FK, so just delete profiles for this org
    // (users can re-join another org — their auth account remains)
    const { data: orgProfiles } = await sb.from('profiles').select('id').eq('org_id', id);
    if (orgProfiles?.length) {
      // For each profile, check if they have other orgs — if yes keep profile, just null org_id
      for (const p of orgProfiles) {
        const { data: otherOrgs } = await sb.from('user_orgs').select('org_id').eq('user_id', p.id).neq('org_id', id);
        if (otherOrgs?.length) {
          // User has other orgs — set their active org to the first other one
          await sb.from('profiles').update({ org_id: otherOrgs[0].org_id }).eq('id', p.id);
        } else {
          // No other orgs — null out their org
          try { await sb.from('profiles').update({ org_id: null, role: 'member' }).eq('id', p.id); } catch(e) {}
        }
      }
    }
    // 10. Finally delete the organisation
    const { error } = await sb.from('organisations').delete().eq('id', id);
    if (error) { toast('Error deleting org: ' + error.message); return; }
    toast('✓ ' + org.name + ' deleted successfully');
    closeModal('orgDetail');
    currentDetailOrgId = null;
    loadSuperAdmin();
  } catch(e) {
    toast('Deletion error: ' + e.message);
    console.error('deleteOrg error:', e);
  }
}

// ── MEMBER PORTAL ACCESS ──
// Members of existing orgs (like ADA) access their portal by:
// 1. Going to the login page
// 2. Registering with their email — they will be prompted to select their org
// 3. Admin then sets their role to 'member' in Supabase
// This is handled automatically by the org picker flow



// ── APPROVALS ──
var currentPendingId = null;
var currentPendingUserId = null;


// Update approvals hero count
function updateApprovalsHero(pendingCount) {
  const heroCount = document.getElementById('approvals-hero-count');
  if (heroCount) {
    heroCount.innerHTML = pendingCount > 0
      ? `<span style="background:rgba(255,255,255,.15);padding:.25rem .65rem;border-radius:99px;font-weight:600">${pendingCount} pending</span>`
      : '<span style="color:rgba(255,255,255,.5)">All clear</span>';
  }
  const badge = document.getElementById('approvals-badge');
  if (badge) { badge.textContent = pendingCount; badge.style.display = pendingCount > 0 ? '' : 'none'; }
}

async function loadApprovals() {
  if (!currentOrg?.id) return;
  const { data: all } = await sb.from('pending_members')
    .select('*')
    .eq('org_id', currentOrg.id)
    .order('requested_at', { ascending: false });

  const pending = (all||[]).filter(r => r.status === 'pending');
  const approved = (all||[]).filter(r => r.status === 'approved');
  const declined = (all||[]).filter(r => r.status === 'declined');

  // Count pending member payments only — subscription/SMS bundle payments are SA-only
  let pendingPayCount = 0;
  try {
    const { data: pendingPays } = await sb.from('payment_requests')
      .select('id,payment_type').eq('org_id', currentOrg.id).eq('status','pending');
    pendingPayCount = (pendingPays || []).filter(r => {
      const t = r.payment_type || '';
      return t !== 'subscription' && !t.startsWith('subscription_') && !t.startsWith('sms_bundle');
    }).length;
  } catch(e) {}

  const totalPending = pending.length + pendingPayCount;

  // Update nav badge
  const badge = document.getElementById('approvals-badge');
  if (badge) {
    badge.textContent = totalPending;
    badge.style.display = totalPending > 0 ? 'inline' : 'none';
  }
  const countTab = document.getElementById('pending-count-tab');
  if (countTab) countTab.textContent = pending.length;

  // Update payments tab badge
  const payTab = document.getElementById('pay-count-tab');
  if (payTab) {
    payTab.textContent = pendingPayCount;
    payTab.style.display = pendingPayCount > 0 ? 'inline' : 'none';
  }

  // Update hero count
  updateApprovalsHero(totalPending);

  // Render pending
  document.getElementById('pending-list').innerHTML = pending.length ? pending.map(r => `
    <div class="welfare-card" style="margin-bottom:1rem;border-left-color:var(--warning)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div style="font-size:.9rem;font-weight:700;color:var(--ink)">${r.full_name}</div>
          <div style="font-size:.72rem;color:var(--ink-faint);margin:.2rem 0">${r.phone||'No phone'} · ${r.email||'No email'}</div>
          <div style="font-size:.7rem;color:var(--ink-faint)">Requested: ${new Date(r.requested_at).toDateString()}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openApproveModal('${r.id}','${r.user_id}','${r.full_name.replace(/'/g,"&apos;")}','${r.phone||''}','${r.email||''}')">
          Review
        </button>
      </div>
    </div>`).join('') :
    '<div style="padding:2rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No pending requests</div>';

  // Render approved
  document.getElementById('approved-list').innerHTML = approved.length ? `
    <table><thead><tr><th>Name</th><th>Phone</th><th>Approved</th><th>Notes</th></tr></thead>
    <tbody>${approved.map(r=>`<tr>
      <td><strong>${r.full_name}</strong></td>
      <td>${r.phone||'—'}</td>
      <td>${r.reviewed_at?new Date(r.reviewed_at).toDateString():'—'}</td>
      <td>${r.notes||'—'}</td>
    </tr>`).join('')}</tbody></table>` :
    '<div style="padding:2rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No approved requests yet</div>';

  // Render declined
  document.getElementById('rejected-list').innerHTML = declined.length ? `
    <table><thead><tr><th>Name</th><th>Phone</th><th>Declined</th><th>Notes</th></tr></thead>
    <tbody>${declined.map(r=>`<tr>
      <td><strong>${r.full_name}</strong></td>
      <td>${r.phone||'—'}</td>
      <td>${r.reviewed_at?new Date(r.reviewed_at).toDateString():'—'}</td>
      <td>${r.notes||'—'}</td>
    </tr>`).join('')}</tbody></table>` :
    '<div style="padding:2rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No declined requests</div>';
}

async function openApproveModal(pendingId, userId, name, phone, email) {
  currentPendingId = pendingId;
  currentPendingUserId = userId;
  document.getElementById('approve-member-info').innerHTML =
    `👤 <strong>${name}</strong> · ${phone||'No phone'} · ${email||'No email'}`;
  // Populate existing members dropdown
  const memberOpts = '<option value="">— Create as new member —</option>' +
    allMembers.map(m => `<option value="${m.id}">${h(m.full_name)} (#${m.member_number||'—'})</option>`).join('');
  document.getElementById('approve-link-member').innerHTML = memberOpts;
  // Pre-fill member number
  document.getElementById('approve-member-num').value = String(allMembers.length + 1).padStart(3,'0');
  document.getElementById('approve-notes').value = '';
  // Show/hide new member fields based on dropdown
  document.getElementById('approve-link-member').onchange = function() {
    document.getElementById('approve-new-member-fields').style.display = this.value ? 'none' : 'block';
  };
  showModal('approveMember');
}

async function approveMember() {
  if (!canDo('approveMember')) { toast('⚠ You do not have permission to approve members.'); return; }
  if (!currentPendingId || !currentPendingUserId) return;
  const linkMemberId = document.getElementById('approve-link-member').value;
  const notes = document.getElementById('approve-notes').value.trim();
  let memberId = linkMemberId;

  // Get pending request details
  const { data: pending } = await sb.from('pending_members').select('*').eq('id', currentPendingId).single();

  if (!linkMemberId) {
    // Create new member record — include user_id to link auth account immediately
    const { data: newMember, error: memberErr } = await sb.from('members').insert({
      org_id: currentOrg.id,
      full_name: pending.full_name,
      phone: pending.phone,
      portal_email: pending.email || null,
      user_id: currentPendingUserId || null,
      member_number: document.getElementById('approve-member-num').value,
      registration_paid: false,
      status: 'active',
      join_date: new Date().toISOString().split('T')[0]
    }).select().single();
    if (memberErr) { toast('Error creating member: ' + memberErr.message); return; }
    memberId = newMember.id;
  } else {
    // Linking to existing member — update their user_id and portal_email
    await sb.from('members').update({
      user_id: currentPendingUserId || null,
      portal_email: pending.email || null
    }).eq('id', linkMemberId);
  }

  // Update profile role to member and link to org
  await sb.from('profiles').update({
    role: 'member',
    org_id: currentOrg.id
  }).eq('id', currentPendingUserId);

  // Ensure user_orgs row exists so they can find this org in the workspace picker
  try {
    await sb.from('user_orgs').upsert({
      user_id: currentPendingUserId,
      org_id: currentOrg.id,
      role: 'member'
    }, { onConflict: 'user_id,org_id' });
  } catch(e) { console.warn('user_orgs upsert failed:', e); }

  // Mark pending request as approved
  await sb.from('pending_members').update({
    status: 'approved',
    reviewed_by: currentUser.id,
    reviewed_at: new Date().toISOString(),
    linked_member_id: memberId,
    notes
  }).eq('id', currentPendingId);

  toast(pending.full_name + ' approved and added as active member');
  closeModal('approveMember');
  currentPendingId = null;
  currentPendingUserId = null;
  await loadApprovals();
  await loadMembers();
  populateSelects();
}

async function declineMember() {
  if (!canDo('approveMember')) { toast('⚠ You do not have permission to decline members.'); return; }
  if (!currentPendingId) return;
  const notes = document.getElementById('approve-notes').value.trim();
  const { data: pending } = await sb.from('pending_members').select('full_name').eq('id', currentPendingId).single();

  // Update profile to blocked role
  await sb.from('profiles').update({ role: 'declined' }).eq('id', currentPendingUserId);

  // Mark as declined
  await sb.from('pending_members').update({
    status: 'declined',
    reviewed_by: currentUser.id,
    reviewed_at: new Date().toISOString(),
    notes
  }).eq('id', currentPendingId);

  toast(pending?.full_name + ' request declined');
  closeModal('approveMember');
  currentPendingId = null;
  currentPendingUserId = null;
  loadApprovals();
}

async function toggleMemberBalanceVisibility(enabled) {
  await sb.from('organisations').update({ show_balance_to_members: enabled }).eq('id', currentOrg.id);
  currentOrg.show_balance_to_members = enabled;
  toast(enabled ? 'Members can now see bank balance' : 'Bank balance hidden from members');
}

async function checkPendingApprovals() {
  if (!currentOrg?.id || currentProfile?.role === 'member' || currentProfile?.role === 'superadmin') return;
  const { data } = await sb.from('pending_members')
    .select('id,full_name,phone,requested_at')
    .eq('org_id', currentOrg.id)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  const pending = data || [];

  // Update badge
  const badge = document.getElementById('approvals-badge');
  if (badge) {
    badge.textContent = pending.length;
    badge.style.display = pending.length > 0 ? 'inline' : 'none';
  }

  // Show/hide dashboard card
  const card = document.getElementById('pending-approvals-card');
  if (card) {
    card.style.display = pending.length > 0 ? 'block' : 'none';
    document.getElementById('pending-approvals-preview').innerHTML = pending.slice(0,3).map(r => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.75rem 1.25rem;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${r.full_name}</div>
          <div style="font-size:.7rem;color:var(--ink-faint)">${r.phone||'No phone'} · Requested ${new Date(r.requested_at).toDateString()}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="showPage('approvals')">Review</button>
      </div>`).join('') +
      (pending.length > 3 ? `<div style="padding:.6rem 1.25rem;font-size:.72rem;color:var(--ink-faint)">${pending.length - 3} more pending…</div>` : '');
  }
}

// Handle declined role
async function handleDeclinedRole() {
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('app-screen').classList.remove('visible');
  document.getElementById('pending-screen').style.display = 'none';
  document.getElementById('auth-step-1').style.display = 'block';
  document.getElementById('auth-step-2').style.display = 'none';
  // Show error on login tab
  const errEl = document.getElementById('login-error');
  if (errEl) {
    errEl.textContent = 'Your access request was declined by the group admin. Please contact them directly.';
    errEl.classList.add('show');
  }
  await sb.auth.signOut();
}


// ── SA SUPPORT / PLATFORM SETTINGS ────────────────────────────────────────────

function updatePromoToggleUI() {
  const checkbox = document.getElementById('sp-promo-active');
  const ui       = document.getElementById('sp-promo-toggle-ui');
  const knob     = document.getElementById('sp-promo-knob');
  if (!checkbox || !ui || !knob) return;
  const on = checkbox.checked;
  ui.style.background  = on ? '#2a9d8f' : '#ccc';
  knob.style.transform = on ? 'translateX(20px)' : 'translateX(0)';
}

// loadSASupport() and saveSupportSettings() are defined in utils.js (load order: utils first).
// Do not duplicate here — edits must be made in utils.js.

// loadSABilling(), approvePayment(), rejectPayment() are defined in utils.js (canonical, sms_bundle_N aware).
// Do not duplicate here.

// ── SA ACTIVITY LOG ────────────────────────────────────────────────────────────

async function loadSAActivity() {
  const listEl  = document.getElementById('sa-activity-list');
  const tableEl = document.getElementById('sa-activity-table');
  const tbody   = document.getElementById('sa-activity-tbody');
  if (!tbody) return;
  if (listEl)  listEl.innerHTML  = '';
  if (tableEl) tableEl.style.display = 'none';
  tbody.innerHTML = '<tr><td colspan="5"><div class="loading"><div class="spinner"></div>Loading…</div></td></tr>';
  if (tableEl) tableEl.style.display = '';
  try {
    const orgFilter  = document.getElementById('activity-filter-org')?.value  || '';
    const typeFilter = document.getElementById('activity-filter-action')?.value || '';
    let q = sb.from('activity_log').select('*,profiles(full_name)').order('created_at', { ascending: false }).limit(200);
    if (orgFilter)  q = q.eq('org_id', orgFilter);
    if (typeFilter) q = q.ilike('action', `%${typeFilter}%`);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--ink-faint)">No activity found</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(r => `<tr style="border-bottom:0.5px solid var(--border)">
      <td style="font-size:.72rem;color:var(--ink-faint);padding:.5rem 1.25rem">${new Date(r.created_at).toLocaleString()}</td>
      <td style="font-size:.75rem;font-weight:600;padding:.5rem">${r.action||'—'}</td>
      <td style="font-size:.73rem;padding:.5rem">${r.profiles?.full_name||r.user_id?.slice(0,8)||'—'}</td>
      <td style="font-size:.73rem;color:var(--ink-faint);padding:.5rem">${r.details||r.description||'—'}</td>
      <td style="font-size:.7rem;color:var(--ink-faint);padding:.5rem">${r.org_id?.slice(0,8)||'—'}</td>
    </tr>`).join('');
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="5" style="color:var(--danger);padding:1rem">${e.message}</td></tr>`;
  }
}


// ── BILLING PAGE ──────────────────────────────────────────────────────────────

var PLAN_PRICES = PLAN_PRICES || { basic: 3000, standard: 6000, pro: 12000 };
var PLAN_LABELS = PLAN_LABELS || { starter:'Starter', basic:'Basic', standard:'Standard', pro:'Pro' };

// Cart state
var _billingCart = { plan: null, planAmount: 0, sms: 0, smsAmount: 0 };

async function loadBilling() {
  if (!currentOrg?.id) return;
  // Clear any orphaned Paystack poll interval from a previous visit to this page —
  // prevents duplicate polling intervals stacking up if the user navigated away
  // mid-payment and came back.
  if (_stkPollInterval) { clearInterval(_stkPollInterval); _stkPollInterval = null; }
  // Refresh org from DB
  try {
    const { data: freshOrg } = await sb.from('organisations').select('*').eq('id', currentOrg.id).single();
    if (freshOrg) Object.assign(currentOrg, freshOrg);
  } catch(e) {}

  await loadPlatformSettings();
  updateBillingHero(currentOrg);
  renderBillingPlanCards();
  renderCartBankDetails();
  loadPaymentHistory();

  const smsEl = document.getElementById('billing-sms-balance');
  if (smsEl) smsEl.textContent = (currentOrg.sms_bundle || 0) + ' SMS';

  // Reset cart on load
  _billingCart = { plan: null, planAmount: 0, sms: 0, smsAmount: 0 };
  refreshCartUI();
}

function renderBillingPlanCards() {
  const org        = currentOrg;
  const effectivePlan = getEffectivePlan(org);
  const rawPlan    = org.plan || 'starter';
  const isExpired  = org.subscription_status === 'expired';
  const isTrial    = org.subscription_status === 'trial';
  const trialUsed  = org.trial_used === true;
  const promoOn    = isPromoActive();
  const promoDays  = parseInt((_platformSettings && _platformSettings['promo_days']) || '60');
  const planOrder  = (typeof PLAN_ORDER !== 'undefined') ? PLAN_ORDER : ['starter','basic','standard','pro'];
  const planPrices = (typeof PLAN_PRICES !== 'undefined') ? PLAN_PRICES : { basic:3000, standard:6000, pro:12000 };
  const planLabels = (typeof PLAN_LABELS !== 'undefined') ? PLAN_LABELS : { starter:'Starter', basic:'Basic', standard:'Standard', pro:'Pro' };

  const promoBanner = document.getElementById('billing-promo-banner');
  if (promoBanner) {
    if (promoOn && !trialUsed) {
      promoBanner.textContent = `🎉 ${promoDays}-day free trial on first upgrade!`;
      promoBanner.style.display = '';
    } else {
      promoBanner.style.display = 'none';
    }
  }

  ['starter','basic','standard','pro'].forEach(plan => {
    const card  = document.getElementById('plan-card-' + plan);
    const btnEl = document.getElementById('plan-btn-' + plan);
    const promoEl = document.getElementById('billing-promo-' + plan);
    if (!card || !btnEl) return;

    const isCurrent = effectivePlan === plan;
    const isHigher  = planOrder.indexOf(plan) > planOrder.indexOf(effectivePlan);
    const isPaid    = plan !== 'starter';
    const midTrialUpgrade = isTrial && isHigher;

    // Highlight current
    card.style.outline = isCurrent ? '2px solid var(--teal)' : 'none';

    // Promo sub-text
    if (promoEl && isPaid) {
      promoEl.innerHTML = (promoOn && !trialUsed && !midTrialUpgrade)
        ? `<strong style="color:var(--teal)">${promoDays} days free</strong>, then Ksh ${planPrices[plan].toLocaleString()}/yr`
        : `Ksh ${planPrices[plan].toLocaleString()}/yr`;
    }

    // Action button
    if (plan === 'starter') {
      btnEl.innerHTML = isCurrent
        ? '<div style="font-size:.72rem;font-weight:600;color:var(--teal);padding:.4rem 0">✓ Your current plan</div>'
        : '';
    } else if (isCurrent && !isExpired) {
      const expText = org.subscription_expires
        ? ' · expires ' + new Date(org.subscription_expires).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'})
        : '';
      btnEl.innerHTML = `<div style="font-size:.72rem;font-weight:600;color:var(--teal);padding:.4rem 0">✓ Current${isTrial?' (trial)':''}${expText}</div>`;
    } else if (isHigher || isExpired) {
      const canFreeTrial = promoOn && !trialUsed && !midTrialUpgrade;
      if (canFreeTrial) {
        btnEl.innerHTML = `<button class="btn btn-primary btn-sm" style="width:100%;background:var(--teal);font-size:.78rem;font-weight:700;padding:.5rem" onclick="addPlanToCart('${plan}', 0, true)">
          🎉 Try ${planLabels[plan]} free for ${promoDays} days →
        </button>`;
      } else {
        const price = planPrices[plan];
        const label = midTrialUpgrade ? `Upgrade to ${planLabels[plan]} · Ksh ${price.toLocaleString()}` : `Upgrade · Ksh ${price.toLocaleString()}/yr`;
        btnEl.innerHTML = `<button class="btn btn-primary btn-sm" style="width:100%;background:var(--maroon);font-size:.75rem;padding:.45rem" onclick="addPlanToCart('${plan}', ${price}, false)">
          ${label} →
        </button>`;
      }
    }
  });
}

function addPlanToCart(plan, price, isFree) {
  _billingCart.plan = plan;
  _billingCart.planAmount = price;
  _billingCart.planIsFree = isFree;
  refreshCartUI();
  document.getElementById('billing-cart-card')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function addSMSToCart(btn) {
  document.querySelectorAll('.pay-pill.sms').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _billingCart.sms = parseInt(btn.dataset.sms);
  _billingCart.smsAmount = parseInt(btn.dataset.amount);
  refreshCartUI();
  document.getElementById('billing-cart-card')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function clearBillingCart() {
  _billingCart = { plan: null, planAmount: 0, sms: 0, smsAmount: 0 };
  document.querySelectorAll('.pay-pill.sms').forEach(b => b.classList.remove('active'));
  refreshCartUI();
}

function refreshCartUI() {
  const cartCard    = document.getElementById('billing-cart-card');
  const itemsEl     = document.getElementById('billing-cart-items');
  const totalEl     = document.getElementById('billing-cart-total');
  const freeSection = document.getElementById('cart-free-trial-section');
  const paySection  = document.getElementById('cart-payment-section');
  const expiryEl    = document.getElementById('cart-trial-expiry-date');

  const hasPlan = !!_billingCart.plan;
  const hasSMS  = _billingCart.sms > 0;

  if (!hasPlan && !hasSMS) {
    if (cartCard) cartCard.style.display = 'none';
    return;
  }
  if (cartCard) cartCard.style.display = '';

  // Build items list
  let itemsHTML = '';
  if (hasPlan) {
    const label = _billingCart.planIsFree
      ? `${PLAN_LABELS[_billingCart.plan]} plan — Free trial`
      : `${PLAN_LABELS[_billingCart.plan]} plan — 1 year`;
    const amt = _billingCart.planIsFree ? 'FREE' : `Ksh ${_billingCart.planAmount.toLocaleString()}`;
    itemsHTML += `<div style="display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid var(--border);font-size:.82rem">
      <span>🚀 ${label}</span>
      <span style="font-weight:700;color:${_billingCart.planIsFree?'var(--teal)':'var(--maroon)'}">${amt}</span>
    </div>`;
  }
  if (hasSMS) {
    itemsHTML += `<div style="display:flex;justify-content:space-between;padding:.5rem 0;font-size:.82rem">
      <span>💬 ${_billingCart.sms} SMS credit</span>
      <span style="font-weight:700;color:var(--maroon)">Ksh ${_billingCart.smsAmount.toLocaleString()}</span>
    </div>`;
  }
  if (itemsEl) itemsEl.innerHTML = itemsHTML;

  const total = (_billingCart.planIsFree ? 0 : _billingCart.planAmount) + _billingCart.smsAmount;
  if (totalEl) totalEl.textContent = total === 0 ? 'Ksh 0 — Free!' : `Ksh ${total.toLocaleString()}`;

  const promoDays = parseInt(_platformSettings['promo_days'] || '60');
  const expDate = new Date(); expDate.setDate(expDate.getDate() + promoDays);
  if (expiryEl) expiryEl.textContent = expDate.toLocaleDateString('en-KE', { day:'numeric', month:'long', year:'numeric' });

  const isFullyFree = _billingCart.planIsFree && _billingCart.smsAmount === 0;
  if (freeSection) freeSection.style.display = (isFullyFree && hasPlan) ? '' : 'none';
  if (paySection) {
    paySection.style.display = (!_billingCart.planIsFree || hasSMS) ? '' : 'none';
  }

  // Sync amounts and payment tabs
  const amtEl = document.getElementById('cart-pay-amount');
  if (amtEl) amtEl.value = total;
  const stkAmt = document.getElementById('stk-display-amount');
  if (stkAmt) stkAmt.textContent = total.toLocaleString();
  const stkBtn = document.getElementById('stk-btn-label');
  if (stkBtn) stkBtn.textContent = `Send Ksh ${total.toLocaleString()} Prompt`;

  // Pre-fill phone from profile — keep local 07XXXXXXXXX format
  const phoneEl = document.getElementById('cart-paystack-phone');
  if (phoneEl && !phoneEl.value && currentProfile?.phone) {
    let ph = currentProfile.phone.toString().replace(/\s+/g,'');
    if (ph.startsWith('254')) ph = '0' + ph.slice(3);
    phoneEl.value = ph;
  }

  // Show correct tabs based on enabled methods
  setupPaymentTabs();
}

function setupPaymentTabs() {
  const manualEnabled  = typeof getManualEnabled === 'function' ? getManualEnabled() : true;
  const paystackEnabled = typeof getPaystackEnabled === 'function' ? getPaystackEnabled() : false;

  const tabsEl  = document.getElementById('cart-method-tabs');
  const tabPs   = document.getElementById('tab-paystack');
  const tabMan  = document.getElementById('tab-manual');

  if (!tabsEl) return;

  if (paystackEnabled && manualEnabled) {
    // Both enabled — show tabs
    tabsEl.style.display = 'flex';
    if (tabPs)  { tabPs.style.display  = ''; }
    if (tabMan) { tabMan.style.display = ''; }
    switchPayTab_impl('paystack'); // default to instant
  } else if (paystackEnabled) {
    // Only Paystack
    tabsEl.style.display = 'none';
    switchPayTab_impl('paystack');
  } else {
    // Only manual (or nothing — fallback to manual)
    tabsEl.style.display = 'none';
    switchPayTab_impl('manual');
  }
}

function switchPayTab_impl(tab) {
  document.querySelectorAll('.pay-method-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.pay-tab-btn').forEach(el => el.classList.remove('active'));
  const pane = document.getElementById('paytab-' + tab);
  const btn  = document.getElementById('tab-' + tab);
  if (pane) pane.classList.add('active');
  if (btn)  btn.classList.add('active');
}

// ── PAYSTACK STK PUSH ─────────────────────────────────────────────────────────
var _stkPollInterval = null;

async function submitCartPaystack_impl() {
  const phone    = document.getElementById('cart-paystack-phone')?.value?.trim();
  const total    = (_billingCart.planIsFree ? 0 : _billingCart.planAmount) + _billingCart.smsAmount;
  const statusEl = document.getElementById('cart-paystack-status');
  const pendEl   = document.getElementById('cart-paystack-pending');
  const succEl   = document.getElementById('cart-paystack-success');
  const btn      = document.getElementById('cart-paystack-btn');
  const dotsEl   = document.getElementById('stk-dots');

  if (!phone || phone.length < 9) {
    if (statusEl) { statusEl.textContent = '⚠ Enter a valid M-Pesa number'; statusEl.style.color = 'var(--warning)'; }
    return;
  }
  if (total <= 0) {
    if (statusEl) { statusEl.textContent = '⚠ No items in cart'; statusEl.style.color = 'var(--warning)'; }
    return;
  }

  const items = [];
  if (_billingCart.plan && !_billingCart.planIsFree) items.push(`subscription_${_billingCart.plan}`);
  if (_billingCart.sms > 0) items.push(`sms_bundle_${_billingCart.sms}`);
  const paymentType = items[0] || 'subscription';
  const notes = items.join(' + ');

  let memberId = null;
  try {
    const { data: mem } = await sb.from('members').select('id').eq('org_id', currentOrg.id).eq('user_id', currentUser.id).maybeSingle();
    memberId = mem?.id || null;
  } catch(e) {}

  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  if (statusEl) { statusEl.textContent = 'Sending prompt…'; statusEl.style.color = 'var(--ink-faint)'; }
  if (pendEl) pendEl.style.display = 'none';
  if (succEl) succEl.style.display = 'none';

  try {
    const { data: { session } } = await sb.auth.getSession();
    // Which provider handles platform billing — SA-configurable toggle,
    // read from the safe public view since it's not sensitive.
    let subscriptionProvider = 'paystack';
    try {
      const { data: provRow } = await sb.from('platform_settings_public').select('subscription_payment_provider').maybeSingle();
      subscriptionProvider = provRow?.subscription_payment_provider || 'paystack';
    } catch(e) {}
    const chargeFunctionName = subscriptionProvider === 'sasapay' ? 'sasapay-charge' : 'paystack-charge';

    const res = await fetch(`https://eengldzvvgplgzvbutal.supabase.co/functions/v1/${chargeFunctionName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ org_id: currentOrg.id, amount: total, phone, email: currentUser.email, payment_type: paymentType, notes, member_id: memberId })
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || 'Charge failed');

    if (statusEl) { statusEl.textContent = ''; }
    if (pendEl) pendEl.style.display = '';
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    const lbl = document.getElementById('stk-btn-label');
    if (lbl) lbl.textContent = 'Resend Prompt';
    await logActivity(`${subscriptionProvider.toUpperCase()} CHARGE INITIATED`, `Ksh ${total} · phone ${phone} · ${notes}`);

    // Animate dots
    let dotCount = 0;
    if (_stkPollInterval) clearInterval(_stkPollInterval);
    const dotAnim = setInterval(() => {
      dotCount = (dotCount + 1) % 4;
      if (dotsEl) dotsEl.textContent = '.'.repeat(dotCount + 1);
    }, 500);

    // Poll for confirmation
    let polls = 0;
    _stkPollInterval = setInterval(async () => {
      polls++;
      if (polls > 36) { // 3 min timeout
        clearInterval(_stkPollInterval);
        clearInterval(dotAnim);
        if (pendEl) pendEl.style.display = 'none';
        if (statusEl) { statusEl.textContent = '⏱ Timed out — check Payment History or try again'; statusEl.style.color = 'var(--warning)'; }
        return;
      }
      try {
        const { data: pr } = await sb.from('payment_requests')
          .select('status').eq('id', result.payment_request_id).maybeSingle();
        if (pr?.status === 'approved') {
          clearInterval(_stkPollInterval);
          clearInterval(dotAnim);
          if (pendEl) pendEl.style.display = 'none';
          if (succEl) succEl.style.display = '';
          clearBillingCart();
          setTimeout(() => loadBilling(), 2000);
        }
      } catch(e) {}
    }, 5000);

  } catch(e) {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = 'var(--danger)'; }
  }
}



async function activateFreeTrialFromCart_impl() {
  const plan = _billingCart.plan;
  const statusEl = document.getElementById('cart-trial-status');
  if (!plan) return;
  if (statusEl) { statusEl.textContent = 'Activating…'; statusEl.style.color = 'var(--ink-faint)'; }

  const promoDays = parseInt(_platformSettings['promo_days'] || '60');
  const expires = new Date(); expires.setDate(expires.getDate() + promoDays);
  const expiresStr = expires.toISOString().split('T')[0];

  try {
    const { error } = await sb.from('organisations').update({
      plan,
      subscription_status: 'trial',
      subscription_expires: expiresStr,
      trial_used: true,
      trial_start_date: new Date().toISOString().split('T')[0]
    }).eq('id', currentOrg.id);
    if (error) throw new Error(error.message);
    Object.assign(currentOrg, { plan, subscription_status:'trial', subscription_expires: expiresStr, trial_used: true });
    await logActivity('PLAN UPGRADE', `Free trial activated: ${plan} until ${expiresStr}`);
    if (typeof buildNav === 'function') buildNav();
    toast(`✓ ${PLAN_LABELS[plan]} activated free until ${expires.toLocaleDateString('en-KE',{day:'numeric',month:'long',year:'numeric'})}`);
    clearBillingCart();
    await loadBilling();
  } catch(e) {
    if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = 'var(--danger)'; }
  }
}

async function submitCartPayment_impl() {
  const ref    = document.getElementById('cart-pay-ref')?.value?.trim();
  const amount = document.getElementById('cart-pay-amount')?.value;
  const statusEl = document.getElementById('cart-pay-status');
  if (!ref) { if (statusEl) { statusEl.textContent = '⚠ Please enter your M-Pesa reference'; statusEl.style.color = 'var(--warning)'; } return; }
  if (statusEl) { statusEl.textContent = 'Submitting…'; statusEl.style.color = 'var(--ink-faint)'; }

  try {
    const items = [];
    if (_billingCart.plan && !_billingCart.planIsFree) items.push(`subscription_${_billingCart.plan}`);
    if (_billingCart.sms > 0) items.push(`sms_bundle_${_billingCart.sms}`);
    const notes = items.join(' + ') + (currentOrg.subscription_status === 'trial' ? ' (mid-trial upgrade — trial cancelled)' : '');

    // Look up member_id for current user in this org
    let memberId = null;
    try {
      const { data: mem } = await sb.from('members')
        .select('id').eq('org_id', currentOrg.id).eq('user_id', currentUser.id).maybeSingle();
      memberId = mem?.id || null;
    } catch(e) {}

    const { error } = await sb.from('payment_requests').insert({
      org_id: currentOrg.id,
      member_id: memberId,
      payment_type: items[0] || 'payment',
      amount: parseFloat(amount),
      mpesa_ref: ref,
      status: 'pending',
      notes
    });
    if (error) throw new Error(error.message);
    await logActivity('PAYMENT SUBMITTED', `Ksh ${amount} · ref ${ref} · ${notes}`);
    if (statusEl) { statusEl.textContent = '✓ Payment submitted! Your plan will be activated within minutes.'; statusEl.style.color = 'var(--success)'; }
    document.getElementById('cart-pay-ref').value = '';
    clearBillingCart();
    setTimeout(() => loadPaymentHistory(), 1500);
  } catch(e) { if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = 'var(--danger)'; } }
}

function renderCartBankDetails() {
  const s = _platformSettings;
  const html = `Pay to: <strong>${s.bank_name||'KCB Bank'}</strong><br>Account: <strong>${s.bank_account||'—'}</strong><br>Name: <strong>${s.bank_account_name||'EPH Technologies'}</strong>`
    + (s.paybill ? `<br>M-Pesa Paybill: <strong>${s.paybill}</strong>` : '');
  const el = document.getElementById('cart-bank-details');
  if (el) el.innerHTML = html;
}

async function loadPaymentHistory() {
  const el = document.getElementById('payment-history');
  if (!el || !currentOrg?.id) return;
  try {
    const { data } = await sb.from('payment_requests')
      .select('*').eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false }).limit(20);
    if (!data?.length) {
      el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No payment history yet.</div>';
      return;
    }
    const sc = { pending:'#c49a30', approved:'#16a34a', rejected:'#dc2626' };
    el.innerHTML = `<table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:.65rem;text-transform:uppercase;color:var(--ink-faint);border-bottom:1px solid var(--border)">
        <th style="padding:.5rem 1.25rem;text-align:left">Date</th>
        <th style="padding:.5rem;text-align:left">Type</th>
        <th style="padding:.5rem;text-align:right">Amount</th>
        <th style="padding:.5rem;text-align:left">Ref</th>
        <th style="padding:.5rem">Status</th>
      </tr></thead>
      <tbody>${data.map(r => `<tr style="border-bottom:0.5px solid var(--border);font-size:.78rem">
        <td style="padding:.6rem 1.25rem;color:var(--ink-faint)">${new Date(r.created_at).toLocaleDateString('en-KE',{day:'numeric',month:'short',year:'numeric'})}</td>
        <td style="padding:.6rem .5rem">${(r.type||r.payment_type||'—').replace(/_/g,' ')}</td>
        <td style="padding:.6rem .5rem;text-align:right;font-weight:600">Ksh ${Number(r.amount||0).toLocaleString()}</td>
        <td style="padding:.6rem .5rem;color:var(--ink-faint);font-size:.72rem">${r.mpesa_ref||'—'}</td>
        <td style="padding:.6rem .5rem;text-align:center"><span style="font-size:.68rem;font-weight:700;color:${sc[r.status]||'#888'};text-transform:uppercase">${r.status||'—'}</span></td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch(e) {
    el.innerHTML = '<div style="padding:1rem;color:var(--danger);font-size:.8rem">Could not load history: ' + e.message + '</div>';
  }
}

/* ════════════════════════════════════════════════════
   COLLECTION ACTIVATION — org-side request flow
   Any org without an active payment provider yet sees a dashboard prompt to
   add disbursement details and request instant collection. SA reviews the
   request, manually creates sub-accounts on both Paystack and Fingo, and
   approves — see settings.js's SA-side handleCollectionRequest() for the
   other half of this flow.
════════════════════════════════════════════════════ */
function saveDisbursementDetails() {
  const method = document.getElementById('dc-disb-method')?.value;
  const updates = { disbursement_method: method || null };
  if (method === 'bank') {
    updates.disbursement_bank_name = document.getElementById('dc-disb-bank-name')?.value?.trim() || null;
    updates.disbursement_bank_account_number = document.getElementById('dc-disb-bank-account')?.value?.trim() || null;
    updates.disbursement_bank_account_name = document.getElementById('dc-disb-bank-account-name')?.value?.trim() || null;
    updates.disbursement_mpesa_number = null;
  } else if (method === 'mpesa') {
    updates.disbursement_mpesa_number = document.getElementById('dc-disb-mpesa')?.value?.trim() || null;
    updates.disbursement_bank_name = null;
    updates.disbursement_bank_account_number = null;
    updates.disbursement_bank_account_name = null;
  }
  return sb.from('organisations').update(updates).eq('id', currentOrg.id);
}

function disbursementDetailsComplete() {
  const method = document.getElementById('dc-disb-method')?.value;
  if (method === 'bank') {
    return !!(document.getElementById('dc-disb-bank-name')?.value?.trim()
      && document.getElementById('dc-disb-bank-account')?.value?.trim()
      && document.getElementById('dc-disb-bank-account-name')?.value?.trim());
  }
  if (method === 'mpesa') {
    return !!document.getElementById('dc-disb-mpesa')?.value?.trim();
  }
  return false;
}

function toggleDisbursementMethodFields() {
  const method = document.getElementById('dc-disb-method')?.value;
  const bankFields = document.getElementById('dc-disb-bank-fields');
  const mpesaFields = document.getElementById('dc-disb-mpesa-fields');
  if (bankFields) bankFields.style.display = method === 'bank' ? 'block' : 'none';
  if (mpesaFields) mpesaFields.style.display = method === 'mpesa' ? 'block' : 'none';
  updateRequestCollectionButton();
}

function updateRequestCollectionButton() {
  const btn = document.getElementById('dc-request-btn');
  if (btn) btn.disabled = !disbursementDetailsComplete();
}

async function requestCollectionActivation() {
  if (!disbursementDetailsComplete()) { toast('Add your disbursement details first'); return; }
  const btn = document.getElementById('dc-request-btn');
  if (btn) btn.disabled = true;
  try {
    const { error: saveErr } = await saveDisbursementDetails();
    if (saveErr) throw new Error(saveErr.message);

    const { error: reqErr } = await sb.from('collection_activation_requests').insert({
      org_id: currentOrg.id,
      status: 'pending',
      requested_by: currentUser.id,
    });
    if (reqErr) throw new Error(reqErr.message);

    try { logActivity('COLLECTION ACTIVATION REQUESTED', `${currentOrg.name} requested instant M-Pesa collection`, 'org', currentOrg.id); } catch(e) {}
    toast('✓ Request submitted — your GroupYetu360 admin will review it shortly.');
    if (typeof loadCollectionActivationCard === 'function') loadCollectionActivationCard(currentOrg.id);
  } catch(e) {
    toast('Error submitting request: ' + e.message);
    if (btn) btn.disabled = false;
  }
}

/* ════════════════════════════════════════════════════
   COLLECTION ACTIVATION — SA-side review queue
════════════════════════════════════════════════════ */
async function loadCollectionRequestsQueue() {
  const el = document.getElementById('sa-collection-requests-list');
  if (!el) return;
  el.innerHTML = '<div style="padding:1rem;color:var(--ink-faint);font-size:.8rem">Loading…</div>';
  try {
    const { data: reqs } = await sb.from('collection_activation_requests')
      .select('*, organisations(name, disbursement_method, disbursement_bank_name, disbursement_bank_account_number, disbursement_bank_account_name, disbursement_mpesa_number, active_payment_provider)')
      .eq('status', 'pending').order('requested_at', { ascending: true });

    const collBadge = document.getElementById('sa-bill-badge-collection');
    if (collBadge) {
      collBadge.textContent = reqs?.length ? `${reqs.length} pending` : 'Clear';
      collBadge.style.background = reqs?.length ? '#fff4dc' : '#e8f5e9';
      collBadge.style.color = reqs?.length ? '#8a6400' : '#2e7d32';
    }

    if (!reqs?.length) {
      el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No pending collection requests.</div>';
      return;
    }

    el.innerHTML = reqs.map(r => {
      const org = r.organisations || {};
      const disbSummary = org.disbursement_method === 'bank'
        ? `Bank: ${org.disbursement_bank_name || '—'} · ${org.disbursement_bank_account_number || '—'} (${org.disbursement_bank_account_name || '—'})`
        : org.disbursement_method === 'mpesa'
          ? `M-Pesa: ${org.disbursement_mpesa_number || '—'}`
          : 'No disbursement details on file';
      return `
      <div class="card" style="margin-bottom:.85rem">
        <div class="card-body">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:.6rem">
            <div>
              <div style="font-weight:700;font-size:.9rem">${org.name || 'Unknown org'}</div>
              <div style="font-size:.72rem;color:var(--ink-faint);margin-top:.15rem">${disbSummary}</div>
              <div style="font-size:.68rem;color:var(--ink-faint);margin-top:.15rem">Requested ${new Date(r.requested_at).toLocaleDateString()}</div>
            </div>
          </div>
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:.75rem;margin-bottom:.6rem;font-size:.72rem;color:var(--ink-soft)">
            ℹ️ Create this org's sub-account on <strong>both</strong> Paystack and Fingo dashboards manually, then paste both codes below — pre-provisioning both means switching providers later is a config change, not a new setup step. SasaPay needs no reference here at all — it's a pooled wallet shared by every org.
          </div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">Paystack Subaccount Code</label><input class="form-input" id="sa-req-paystack-${r.id}" placeholder="ACCT_…"/></div>
            <div class="form-group"><label class="form-label">Fingo Sub-Merchant Internal ID</label><input class="form-input" id="sa-req-fingo-${r.id}" placeholder="SM-…"/></div>
          </div>
          <div class="form-row single">
            <div class="form-group"><label class="form-label">Active Provider (default collection route)</label>
              <select class="form-select" id="sa-req-active-${r.id}">
                <option value="paystack">Paystack</option>
                <option value="fingo">Fingo</option>
                <option value="sasapay">SasaPay</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:.5rem;margin-top:.6rem">
            <button class="btn btn-primary btn-sm" onclick="approveCollectionRequest('${r.id}','${r.org_id}')">Approve &amp; Activate</button>
            <button class="btn btn-secondary btn-sm" onclick="declineCollectionRequest('${r.id}')">Decline</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="padding:1rem;color:var(--danger);font-size:.8rem">Error loading requests: ' + e.message + '</div>';
  }
}

async function approveCollectionRequest(requestId, orgId) {
  const paystackCode = document.getElementById(`sa-req-paystack-${requestId}`)?.value?.trim();
  const fingoId = document.getElementById(`sa-req-fingo-${requestId}`)?.value?.trim();
  const activeProvider = document.getElementById(`sa-req-active-${requestId}`)?.value || 'paystack';

  // SasaPay needs no reference at all (pooled wallet, no per-org
  // sub-account exists) — only Paystack/Fingo genuinely require one, and
  // only when THAT specific provider is the one being activated.
  if (activeProvider === 'paystack' && !paystackCode) { toast('Paystack is selected as active but has no subaccount code'); return; }
  if (activeProvider === 'fingo' && !fingoId) { toast('Fingo is selected as active but has no sub-merchant ID'); return; }

  try {
    const rows = [];
    if (paystackCode) rows.push({ org_id: orgId, provider: 'paystack', provider_account_ref: paystackCode });
    if (fingoId) rows.push({ org_id: orgId, provider: 'fingo', provider_account_ref: fingoId });

    const { error: providersErr } = await sb.from('org_payment_providers')
      .upsert(rows, { onConflict: 'org_id,provider' });
    if (providersErr) throw new Error(providersErr.message);

    const { error: orgErr } = await sb.from('organisations')
      .update({ active_payment_provider: activeProvider }).eq('id', orgId);
    if (orgErr) throw new Error(orgErr.message);

    const { error: reqErr } = await sb.from('collection_activation_requests').update({
      status: 'approved', reviewed_by: currentUser.id, reviewed_at: new Date().toISOString(),
    }).eq('id', requestId);
    if (reqErr) throw new Error(reqErr.message);

    try { logActivity('COLLECTION ACTIVATED', `Instant collection approved — active provider: ${activeProvider}`, 'org', orgId); } catch(e) {}
    toast('✓ Collection activated');
    loadCollectionRequestsQueue();
  } catch(e) {
    toast('Error approving request: ' + e.message);
  }
}

async function declineCollectionRequest(requestId) {
  const notes = prompt('Reason for declining (shown to the org admin):') || '';
  try {
    await sb.from('collection_activation_requests').update({
      status: 'declined', reviewed_by: currentUser.id, reviewed_at: new Date().toISOString(), notes,
    }).eq('id', requestId);
    toast('Request declined');
    loadCollectionRequestsQueue();
  } catch(e) {
    toast('Error declining request: ' + e.message);
  }
}

/* ════════════════════════════════════════════════════
   MANUAL DISBURSEMENT — SA records that a real payout was made via
   Paystack/Fingo's own dashboard or API. Deliberately manual — the actual
   transfer happens outside this app; this just logs it and debits
   bank_balance accordingly. Automating the transfer itself is separate,
   future work (per the "prove it works before automating" pattern already
   used for Fingo sub-merchant creation).
════════════════════════════════════════════════════ */
async function recordDisbursement(orgId) {
  const amount = parseFloat(document.getElementById('sa-disb-amount')?.value);
  const method = document.getElementById('sa-disb-method')?.value;
  const reference = document.getElementById('sa-disb-reference')?.value?.trim();
  const date = document.getElementById('sa-disb-date')?.value || new Date().toISOString().split('T')[0];
  const notes = document.getElementById('sa-disb-notes')?.value?.trim();

  if (!amount || amount <= 0) { toast('Enter a valid disbursement amount'); return; }
  if (!method) { toast('Select a disbursement method'); return; }

  try {
    const { error: insErr } = await sb.from('disbursement_records').insert({
      org_id: orgId, amount, method, reference: reference || null,
      disbursed_date: date, notes: notes || null, recorded_by: currentUser.id,
    });
    if (insErr) throw new Error(insErr.message);

    const { error: bbErr } = await sb.rpc('update_bank_balance', {
      p_org_id: orgId, p_amount: amount, p_direction: 'debit', p_date: date,
    });
    if (bbErr) throw new Error(bbErr.message);

    try { logActivity('DISBURSEMENT RECORDED', `Ksh ${amount.toLocaleString()} disbursed via ${method}${reference ? ' · ref: ' + reference : ''}`, 'org', orgId); } catch(e) {}
    toast('✓ Disbursement recorded');
    ['sa-disb-amount','sa-disb-reference','sa-disb-notes'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    if (typeof loadOrgDisbursementHistory === 'function') loadOrgDisbursementHistory(orgId);
  } catch(e) {
    toast('Error recording disbursement: ' + e.message);
  }
}

async function saveOrgProviderSettings() {
  const orgId = currentDetailOrgId;
  const paystackCode = document.getElementById('od-paystack-subaccount')?.value?.trim();
  const fingoId = document.getElementById('od-fingo-submerchant')?.value?.trim();
  const activeProvider = document.getElementById('od-active-provider')?.value || 'paystack';
  const maxContribRaw = document.getElementById('od-max-contribution')?.value;

  if (activeProvider === 'paystack' && !paystackCode) { toast('Paystack is selected as active but has no subaccount code'); return; }
  if (activeProvider === 'fingo' && !fingoId) { toast('Fingo is selected as active but has no sub-merchant ID'); return; }

  try {
    const rows = [];
    if (paystackCode) rows.push({ org_id: orgId, provider: 'paystack', provider_account_ref: paystackCode });
    if (fingoId) rows.push({ org_id: orgId, provider: 'fingo', provider_account_ref: fingoId });

    if (rows.length) {
      const { error: providersErr } = await sb.from('org_payment_providers')
        .upsert(rows, { onConflict: 'org_id,provider' });
      if (providersErr) throw new Error(providersErr.message);
    }

    const { error: orgErr } = await sb.from('organisations').update({
      active_payment_provider: activeProvider,
      max_contribution_amount: maxContribRaw ? parseFloat(maxContribRaw) : null,
    }).eq('id', orgId);
    if (orgErr) throw new Error(orgErr.message);

    try { logActivity('PROVIDER SETTINGS UPDATED', `Active provider set to ${activeProvider}`, 'org', orgId); } catch(e) {}
    toast('✓ Provider settings saved');
  } catch(e) {
    toast('Error saving provider settings: ' + e.message);
  }
}

async function loadOrgDisbursementHistory(orgId) {
  const el = document.getElementById('sa-disb-history');
  if (!el) return;
  try {
    const { data } = await sb.from('disbursement_records')
      .select('*').eq('org_id', orgId).order('disbursed_date', { ascending: false }).limit(10);
    if (!data?.length) {
      el.innerHTML = '<div style="padding:.75rem;color:var(--ink-faint);font-size:.75rem">No disbursements recorded yet.</div>';
      return;
    }
    el.innerHTML = `<table style="width:100%;font-size:.78rem;border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid var(--border);text-align:left">
        <th style="padding:.4rem">Date</th><th style="padding:.4rem">Amount</th><th style="padding:.4rem">Method</th><th style="padding:.4rem">Reference</th>
      </tr></thead>
      <tbody>${data.map(d => `
        <tr style="border-bottom:1px solid var(--border-soft)">
          <td style="padding:.4rem">${d.disbursed_date}</td>
          <td style="padding:.4rem;font-weight:600">Ksh ${Number(d.amount).toLocaleString()}</td>
          <td style="padding:.4rem;text-transform:capitalize">${d.method}</td>
          <td style="padding:.4rem;color:var(--ink-faint)">${d.reference || '—'}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  } catch(e) {
    el.innerHTML = '<div style="padding:.75rem;color:var(--danger);font-size:.75rem">Could not load: ' + e.message + '</div>';
  }
}


/* ════════════════════════════════════════════════════
   BROADCAST COMPOSER — SA-only platform-wide push notifications
════════════════════════════════════════════════════ */
let _bcAllOrgs = [];
let _bcAllMembers = [];
let _bcSelectedOrgIds = new Set();
let _bcSelectedMemberIds = new Set();

function toggleBroadcastTargetPicker() {
  const type = document.getElementById('bc-target-type')?.value;
  const orgsPicker = document.getElementById('bc-orgs-picker');
  const membersPicker = document.getElementById('bc-members-picker');
  if (orgsPicker) orgsPicker.style.display = type === 'orgs' ? 'block' : 'none';
  if (membersPicker) membersPicker.style.display = type === 'members' ? 'block' : 'none';

  if (type === 'orgs' && !_bcAllOrgs.length) loadBroadcastOrgList();
  if (type === 'members' && !_bcAllMembers.length) loadBroadcastMemberList();
}

async function loadBroadcastOrgList() {
  const { data } = await sb.from('organisations').select('id,name').order('name');
  _bcAllOrgs = data || [];
  renderBroadcastOrgList('');
}

function renderBroadcastOrgList(query) {
  const el = document.getElementById('bc-orgs-list');
  if (!el) return;
  const q = query.trim().toLowerCase();
  const matches = _bcAllOrgs.filter(o => !q || (o.name || '').toLowerCase().includes(q));
  if (!matches.length) { el.innerHTML = '<div style="padding:.5rem;color:var(--ink-faint);font-size:.78rem">No organisations found</div>'; return; }
  el.innerHTML = matches.map(o => `
    <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;font-size:.82rem;cursor:pointer">
      <input type="checkbox" ${_bcSelectedOrgIds.has(o.id) ? 'checked' : ''} onchange="toggleBroadcastOrgSelection('${o.id}', this.checked)"/>
      ${(o.name || 'Org').replace(/</g,'')}
    </label>`).join('');
}

function filterBroadcastOrgList(query) { renderBroadcastOrgList(query); }

function toggleBroadcastOrgSelection(orgId, checked) {
  if (checked) _bcSelectedOrgIds.add(orgId); else _bcSelectedOrgIds.delete(orgId);
}

async function loadBroadcastMemberList() {
  // Sourced from profiles, not members — members has one row per org per
  // person, so anyone in several groups would show up as several separate
  // checkboxes for the same underlying account. profiles.id IS the real
  // user identity (= auth.uid()), one row per person, always.
  const { data } = await sb.from('profiles').select('id,full_name').order('full_name');
  _bcAllMembers = data || [];
  renderBroadcastMemberList('');
}

function renderBroadcastMemberList(query) {
  const el = document.getElementById('bc-members-list');
  if (!el) return;
  const q = query.trim().toLowerCase();
  const matches = _bcAllMembers.filter(m => !q || (m.full_name || '').toLowerCase().includes(q));
  if (!matches.length) { el.innerHTML = '<div style="padding:.5rem;color:var(--ink-faint);font-size:.78rem">No users found</div>'; return; }
  el.innerHTML = matches.slice(0, 50).map(m => `
    <label style="display:flex;align-items:center;gap:.5rem;padding:.35rem 0;font-size:.82rem;cursor:pointer">
      <input type="checkbox" ${_bcSelectedMemberIds.has(m.id) ? 'checked' : ''} onchange="toggleBroadcastMemberSelection('${m.id}', this.checked)"/>
      ${(m.full_name || 'User').replace(/</g,'')}
    </label>`).join('');
  updateBroadcastMemberCount();
}

function filterBroadcastMemberList(query) { renderBroadcastMemberList(query); }

function toggleBroadcastMemberSelection(memberId, checked) {
  if (checked) _bcSelectedMemberIds.add(memberId); else _bcSelectedMemberIds.delete(memberId);
  updateBroadcastMemberCount();
}

function updateBroadcastMemberCount() {
  const el = document.getElementById('bc-members-selected');
  if (el) el.textContent = `${_bcSelectedMemberIds.size} selected`;
}

async function sendBroadcast() {
  const title = document.getElementById('bc-title')?.value?.trim();
  const body = document.getElementById('bc-body')?.value?.trim();
  const targetType = document.getElementById('bc-target-type')?.value;
  const statusEl = document.getElementById('bc-status');

  if (!title || !body) { toast('Enter a title and message'); return; }

  let targetIds = null;
  if (targetType === 'orgs') {
    targetIds = [..._bcSelectedOrgIds];
    if (!targetIds.length) { toast('Select at least one organisation'); return; }
  } else if (targetType === 'members') {
    targetIds = [..._bcSelectedMemberIds];
    if (!targetIds.length) { toast('Select at least one member'); return; }
  } else if (targetType === 'all') {
    if (!confirm('This sends a push notification to every user on the platform. Continue?')) return;
  }

  if (statusEl) statusEl.textContent = 'Sending…';

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('https://eengldzvvgplgzvbutal.supabase.co/functions/v1/send-broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ title, body, target_type: targetType, target_ids: targetIds })
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || 'Broadcast failed');

    if (statusEl) statusEl.textContent = `✓ Sent to ${result.sent}/${result.recipient_count} devices (${result.recipient_count} users targeted)`;
    toast('✓ Broadcast sent');
    document.getElementById('bc-title').value = '';
    document.getElementById('bc-body').value = '';
    _bcSelectedOrgIds.clear();
    _bcSelectedMemberIds.clear();
    loadBroadcastHistory();
  } catch(e) {
    if (statusEl) statusEl.textContent = '';
    toast('Error sending broadcast: ' + e.message);
  }
}

async function loadBroadcastHistory() {
  const el = document.getElementById('bc-history');
  if (!el) return;
  try {
    const { data } = await sb.from('broadcast_log').select('*').order('created_at', { ascending: false }).limit(10);
    if (!data?.length) {
      el.innerHTML = '<div style="padding:.75rem;color:var(--ink-faint);font-size:.75rem">No broadcasts sent yet.</div>';
      return;
    }
    el.innerHTML = `<table style="width:100%;font-size:.78rem;border-collapse:collapse">
      <thead><tr style="border-bottom:1px solid var(--border);text-align:left">
        <th style="padding:.4rem">Sent</th><th style="padding:.4rem">Title</th><th style="padding:.4rem">Target</th><th style="padding:.4rem">Delivered</th>
      </tr></thead>
      <tbody>${data.map(b => `
        <tr style="border-bottom:1px solid var(--border-soft)">
          <td style="padding:.4rem">${new Date(b.created_at).toLocaleDateString()}</td>
          <td style="padding:.4rem;font-weight:600">${(b.title||'').replace(/</g,'')}</td>
          <td style="padding:.4rem;text-transform:capitalize">${b.target_type} (${b.recipient_count})</td>
          <td style="padding:.4rem">${b.sent_count}/${b.recipient_count}</td>
        </tr>`).join('')}</tbody>
    </table>`;
  } catch(e) {
    el.innerHTML = '<div style="padding:.75rem;color:var(--danger);font-size:.75rem">Could not load: ' + e.message + '</div>';
  }
}

/* ════════════════════════════════════════════════════
   SETTLEMENTS — unified for SasaPay + Fingo (both pooled-wallet, no
   auto-disbursement; Paystack isn't included, its subaccount model
   settles per-org automatically). Grouped by settlement_date, one line
   each for regular vs welfare per org per provider per day. SA syncs new
   batches from approved payment_requests, marks them paid when the real
   payout happens; org admins get a read-only view of the same data.
════════════════════════════════════════════════════ */

// Reconciles settlement_batches against approved SasaPay/Fingo
// member_contribution payments. Safe to call often — existing PAID
// batches are never touched (locked once paid, matching how a real
// settlement record should behave), existing PENDING batches get their
// amount refreshed (in case more transactions landed for that date since
// the last sync), and genuinely new (org, provider, date, line) combos
// get created fresh.
// Auto-batches REGULAR contributions only — welfare is deliberately
// excluded here. Welfare events can run for days, so daily auto-batching
// doesn't make sense for them; they're only turned into a settlement_batch
// when the admin explicitly clicks "Request Settlement" on that specific
// event (see requestWelfareSettlement() below).
async function syncSettlementBatches() {
  const since = new Date(); since.setDate(since.getDate() - 60);
  const sinceStr = since.toISOString().split('T')[0];

  const { data: rows, error: rowsErr } = await sb.from('payment_requests')
    .select('org_id, provider, payment_date, allocations')
    .in('provider', ['sasapay', 'fingo'])
    .eq('status', 'approved')
    .eq('payment_type', 'member_contribution')
    .gte('payment_date', sinceStr);
  if (rowsErr) { console.warn('syncSettlementBatches: could not load payment_requests —', rowsErr.message); return; }

  const groups = {};
  for (const row of rows || []) {
    let allocs = [];
    try { allocs = JSON.parse(row.allocations || '[]'); } catch(e) { continue; }
    for (const a of allocs) {
      if (a.isWelfare) continue; // welfare — admin requests settlement explicitly, per event
      if (a.isMGR) continue;     // MGR — auto-created server-side the moment a round completes, never date-batched
      const lineType = a.isTB ? 'table_banking' : 'regular';
      const key = `${row.org_id}|${row.provider}|${row.payment_date}|${lineType}`;
      groups[key] = (groups[key] || 0) + Number(a.amount || 0);
    }
  }

  const { data: existing } = await sb.from('settlement_batches')
    .select('org_id,provider,settlement_date,line_type,status,amount')
    .in('line_type', ['regular', 'table_banking'])
    .gte('settlement_date', sinceStr);
  const existingMap = {};
  (existing || []).forEach(b => {
    existingMap[`${b.org_id}|${b.provider}|${b.settlement_date}|${b.line_type}`] = b;
  });

  const toInsert = [];
  const toUpdate = [];
  for (const [key, amount] of Object.entries(groups)) {
    const [org_id, provider, settlement_date, line_type] = key.split('|');
    const roundedAmount = Math.round(amount * 100) / 100;
    const existingBatch = existingMap[key];
    if (!existingBatch) {
      toInsert.push({ org_id, provider, settlement_date, line_type, amount: roundedAmount });
    } else if (existingBatch.status === 'pending' && Number(existingBatch.amount) !== roundedAmount) {
      toUpdate.push({ org_id, provider, settlement_date, line_type, amount: roundedAmount });
    }
  }

  if (toInsert.length) {
    const { error } = await sb.from('settlement_batches').insert(toInsert);
    if (error) console.warn('syncSettlementBatches insert error:', error.message);
  }
  for (const u of toUpdate) {
    await sb.from('settlement_batches').update({ amount: u.amount })
      .eq('org_id', u.org_id).eq('provider', u.provider)
      .eq('settlement_date', u.settlement_date).eq('line_type', u.line_type);
  }
  console.log(`syncSettlementBatches: ${toInsert.length} new, ${toUpdate.length} refreshed`);
}

// SA view — syncs first, then renders every batch from the last 60 days
// grouped by date, most recent first.
async function loadSASettlements() {
  const el = document.getElementById('sa-settlements-list');
  if (!el) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Syncing…</div>';

  try {
    await syncSettlementBatches();

    const since = new Date(); since.setDate(since.getDate() - 60);
    const { data: batches } = await sb.from('settlement_batches')
      .select('*, organisations(name), welfare_events(event_type), round_slots(slot_number, member_id, savings_rounds(name))')
      .gte('settlement_date', since.toISOString().split('T')[0])
      .order('settlement_date', { ascending: false });

    if (!batches?.length) {
      const settleBadgeEmpty = document.getElementById('sa-bill-badge-settlement');
      if (settleBadgeEmpty) { settleBadgeEmpty.textContent = 'All settled'; settleBadgeEmpty.style.background = '#e8f5e9'; settleBadgeEmpty.style.color = '#2e7d32'; }
      el.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No SasaPay or Fingo settlements yet.</div>';
      return;
    }

    const totalPending = batches.filter(b => b.status === 'pending').reduce((s, b) => s + Number(b.amount), 0);
    const settleBadge = document.getElementById('sa-bill-badge-settlement');
    if (settleBadge) {
      settleBadge.textContent = totalPending > 0 ? `Ksh ${totalPending.toLocaleString()} pending` : 'All settled';
      settleBadge.style.background = totalPending > 0 ? '#fdecea' : '#e8f5e9';
      settleBadge.style.color = totalPending > 0 ? '#c0392b' : '#2e7d32';
    }

    const byDate = {};
    batches.forEach(b => { (byDate[b.settlement_date] = byDate[b.settlement_date] || []).push(b); });

    el.innerHTML = Object.entries(byDate).map(([date, dayBatches]) => {
      const pendingTotal = dayBatches.filter(b => b.status === 'pending').reduce((s, b) => s + Number(b.amount), 0);
      return `
      <div class="card" style="margin-bottom:1rem;overflow:hidden;padding:0">
        <div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:700;font-size:.88rem;font-family:'Crimson Pro',serif">${new Date(date).toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</div>
          <div style="font-size:.75rem;font-weight:600;color:${pendingTotal > 0 ? 'var(--danger)' : 'var(--teal)'}">${pendingTotal > 0 ? 'Ksh ' + pendingTotal.toLocaleString() + ' pending' : '✓ Fully settled'}</div>
        </div>
        ${dayBatches.map((b, i) => `
          <div style="padding:.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;${i < dayBatches.length-1 ? 'border-bottom:1px solid var(--border-soft)' : ''}">
            <div style="display:flex;align-items:center;gap:.6rem;min-width:180px">
              <span style="font-weight:600;font-size:.82rem">${(b.organisations?.name || 'Unknown').replace(/</g,'')}</span>
            </div>
            <div style="display:flex;align-items:center;gap:.5rem">${providerBadge(b.provider)}<span style="font-size:.76rem;color:var(--ink-soft)">${settlementLineLabel(b)}</span></div>
            <div style="display:flex;align-items:center;gap:1rem;margin-left:auto">
              <div style="font-weight:700;font-size:.9rem;font-variant-numeric:tabular-nums">Ksh ${Number(b.amount).toLocaleString()}</div>
              ${settlementStatusPill(b.status)}
              <button class="btn btn-secondary btn-sm" onclick="viewSettlementDetails('${b.org_id}','${b.provider}','${b.settlement_date}','${b.line_type}','${(b.organisations?.name||'').replace(/'/g,"")}','${b.round_slot_id||''}')">Details</button>
              ${b.status === 'pending' ? `<button class="btn btn-primary btn-sm" onclick="openMarkPaidForm('${b.id}')">Mark Paid</button>` : ''}
            </div>
          </div>`).join('')}
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="padding:1rem;color:var(--danger);font-size:.8rem">Error: ' + e.message + '</div>';
  }
}

let _mspCurrentBatch = null;

async function openMarkPaidForm(batchId) {
  const { data: batch, error } = await sb.from('settlement_batches')
    .select('*, organisations(name, disbursement_method, disbursement_bank_name, disbursement_bank_account_number, disbursement_bank_account_name, disbursement_mpesa_number)')
    .eq('id', batchId).single();
  if (error || !batch) { toast('Could not load batch: ' + (error?.message || 'not found')); return; }
  _mspCurrentBatch = batch;

  const summaryEl = document.getElementById('msp-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="font-weight:700;margin-bottom:.2rem">${(batch.organisations?.name||'Organisation').replace(/</g,'')}</div>
      <div style="color:var(--ink-faint)">${batch.provider} · ${batch.line_type} · ${batch.welfare_event_id ? 'Welfare event' : new Date(batch.settlement_date).toLocaleDateString()}</div>
      <div style="font-weight:700;font-size:1.2rem;margin-top:.4rem;font-family:'Crimson Pro',serif">Ksh ${Number(batch.amount).toLocaleString()}</div>`;
  }

  // Destination: welfare batches routed 'direct' use their own recipient
  // snapshot (captured at request time — see requestWelfareSettlement);
  // everything else uses the org's normal disbursement details.
  const destEl = document.getElementById('msp-destination');
  const org = batch.organisations || {};
  let destHtml = '';
  if (batch.payout_destination_type === 'direct' && batch.payout_destination_snapshot) {
    const snap = batch.payout_destination_snapshot;
    destHtml = `<div style="font-weight:700;margin-bottom:.2rem">→ Direct to: ${(snap.recipient_name||'—').replace(/</g,'')}</div>
      <div>${snap.recipient_phone ? 'Phone: ' + snap.recipient_phone : ''}${snap.recipient_bank_name ? '<br>Bank: ' + snap.recipient_bank_name + ' · ' + (snap.recipient_bank_account||'') : ''}</div>`;
  } else if (org.disbursement_method === 'bank') {
    destHtml = `<div style="font-weight:700;margin-bottom:.2rem">→ Group's Bank Account</div><div>${org.disbursement_bank_name||'—'} · ${org.disbursement_bank_account_number||'—'} (${org.disbursement_bank_account_name||'—'})</div>`;
  } else if (org.disbursement_method === 'mpesa') {
    destHtml = `<div style="font-weight:700;margin-bottom:.2rem">→ Group's M-Pesa</div><div>${org.disbursement_mpesa_number||'—'}</div>`;
  } else {
    destHtml = `<div style="color:var(--danger)">⚠ No disbursement details on file for this org — check before paying out.</div>`;
  }
  if (destEl) destEl.innerHTML = destHtml;

  const methodEl = document.getElementById('msp-method');
  if (methodEl) methodEl.value = (batch.payout_destination_type === 'direct' ? (batch.payout_destination_snapshot?.recipient_bank_account ? 'bank' : 'mpesa') : org.disbursement_method) || 'mpesa';
  const dateEl = document.getElementById('msp-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  document.getElementById('msp-reference').value = '';
  document.getElementById('msp-notes').value = '';

  showModal('markSettlementPaid');
}

async function confirmMarkSettlementPaid() {
  if (!_mspCurrentBatch) return;
  const method = document.getElementById('msp-method')?.value || 'mpesa';
  const date = document.getElementById('msp-date')?.value;
  const reference = document.getElementById('msp-reference')?.value?.trim();
  const notes = document.getElementById('msp-notes')?.value?.trim();
  if (!reference) { toast('Enter a payout reference'); return; }

  await markSettlementBatchPaid(_mspCurrentBatch.id, method, reference, date, notes);
  closeModal('markSettlementPaid');
  _mspCurrentBatch = null;
}

// Records that a settlement was paid out — deliberately NEVER touches the
// org's own bank_balance/contribution records. Settlement is EPH's own
// internal bookkeeping of money collected on the group's behalf that needs
// disbursing; the group's own balance only ever moves because the system
// credited a real contribution or an admin recorded something manually —
// never because of what happens on this side of the ledger.
async function markSettlementBatchPaid(batchId, method, reference, date, notes) {
  try {
    const { data: batch, error: fetchErr } = await sb.from('settlement_batches').select('*').eq('id', batchId).single();
    if (fetchErr || !batch) throw new Error(fetchErr?.message || 'Batch not found');
    if (batch.status === 'paid') { toast('Already marked paid'); return; }

    const { error: updateErr } = await sb.from('settlement_batches').update({
      status: 'paid', paid_at: new Date().toISOString(), paid_by: currentUser.id,
      payout_method: method, payout_reference: reference || null, notes: notes || null,
    }).eq('id', batchId);
    if (updateErr) throw new Error(updateErr.message);

    try { logActivity('SETTLEMENT PAID', `${batch.provider} · ${batch.line_type} · Ksh ${Number(batch.amount).toLocaleString()} · ref ${reference}`, 'org', batch.org_id); } catch(e) {}
    toast('✓ Settlement recorded as paid');
    if (typeof loadSASettlements === 'function') loadSASettlements();
  } catch(e) {
    toast('Error marking paid: ' + e.message);
  }
}

async function viewSettlementDetails(orgId, provider, date, lineType, orgName, roundSlotId) {
  let lines = [];

  if (roundSlotId) {
    // MGR — genuinely different query path. Settlement here is per-slot,
    // not per-date, so we go straight to round_contributions for that
    // specific slot rather than re-deriving from payment_requests
    // allocations the way every other line type does.
    let slotQuery = sb.from('round_contributions')
      .select('contributor_member_id, amount, mpesa_ref, payment_date, provider')
      .eq('slot_id', roundSlotId).eq('status', 'paid');
    slotQuery = provider ? slotQuery.eq('provider', provider) : slotQuery.in('provider', ['sasapay','fingo']);
    const { data: contribs } = await slotQuery;
    lines = (contribs || []).map(c => ({
      memberId: c.contributor_member_id, typeName: 'MGR Contribution',
      amount: Number(c.amount || 0), ref: c.mpesa_ref, time: c.payment_date,
    }));
  } else {
    let rowQuery = sb.from('payment_requests')
      .select('id, allocations, mpesa_ref, approved_at')
      .eq('org_id', orgId).eq('payment_date', date)
      .eq('status', 'approved').eq('payment_type', 'member_contribution');
    rowQuery = provider ? rowQuery.eq('provider', provider) : rowQuery.in('provider', ['sasapay','fingo']);
    const { data: rows } = await rowQuery;

    for (const row of rows || []) {
      let allocs = [];
      try { allocs = JSON.parse(row.allocations || '[]'); } catch(e) { continue; }
      for (const a of allocs) {
        if (lineType === 'welfare' && !a.isWelfare) continue;
        if (lineType === 'table_banking' && !a.isTB) continue;
        if (lineType === 'regular' && (a.isWelfare || a.isTB || a.isMGR)) continue;
        lines.push({ memberId: a.memberId, typeName: a.typeName, amount: Number(a.amount || 0), ref: row.mpesa_ref, time: row.approved_at });
      }
    }
  }

  const memberIds = [...new Set(lines.map(l => l.memberId).filter(Boolean))];
  let memberNames = {};
  if (memberIds.length) {
    const { data: members } = await sb.from('members').select('id, full_name').in('id', memberIds);
    (members || []).forEach(m => { memberNames[m.id] = m.full_name; });
  }

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const initials = (name) => (name || '?').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();
  const avatarColors = ['#800020','#1a56c4','#6a2fd0','#2e7d32','#c49a30'];
  const colorFor = (str) => avatarColors[[...(str||'')].reduce((a,c)=>a+c.charCodeAt(0),0) % avatarColors.length];

  const rowsHtml = lines.map(l => {
    const name = memberNames[l.memberId] || 'Unknown member';
    return `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.7rem 0;border-bottom:1px solid var(--border-soft)">
      <div style="width:36px;height:36px;border-radius:50%;background:${colorFor(name)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;flex-shrink:0">${initials(name)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:.85rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name.replace(/</g,'')}</div>
        <div style="font-size:.72rem;color:var(--ink-faint)">${(l.typeName||'Contribution').replace(/</g,'')}${l.ref ? ' · ' + l.ref : ''}</div>
      </div>
      <div style="font-weight:700;font-size:.88rem;font-variant-numeric:tabular-nums;white-space:nowrap">Ksh ${l.amount.toLocaleString()}</div>
    </div>`;
  }).join('');

  const modalHtml = `
    <div style="text-align:center;padding:1.5rem 1rem 1.25rem;background:linear-gradient(135deg,var(--maroon-pale,#fdf0f3),#fff);border-radius:10px;margin-bottom:1.25rem">
      <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint);margin-bottom:.3rem">${(orgName || 'Organisation').replace(/</g,'')} · ${new Date(date).toLocaleDateString('en-KE',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</div>
      <div style="font-family:'Crimson Pro',serif;font-size:2.1rem;font-weight:700;color:var(--maroon)">Ksh ${total.toLocaleString()}</div>
      <div style="margin-top:.5rem;display:flex;justify-content:center;gap:.5rem">
        ${provider ? providerBadge(provider) : ''}
        ${lineType ? `<span style="background:var(--surface-2);color:var(--ink-soft);font-size:.68rem;font-weight:700;text-transform:capitalize;padding:.22rem .55rem;border-radius:6px">${lineType}</span>` : ''}
        <span style="background:var(--surface-2);color:var(--ink-soft);font-size:.68rem;font-weight:700;padding:.22rem .55rem;border-radius:6px">${lines.length} txn${lines.length===1?'':'s'}</span>
      </div>
    </div>
    <div>${rowsHtml || '<div style="padding:2rem 1rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No transactions found</div>'}</div>`;

  const bodyEl = document.getElementById('modal-settlement-details-body');
  if (bodyEl) bodyEl.innerHTML = modalHtml;
  showModal('settlementDetails');
}

// Org-admin read-only view — same data, no mark-paid action available.
function settlementStatusPill(status) {
  return status === 'paid'
    ? `<span style="display:inline-flex;align-items:center;gap:.3rem;background:#e8f5e9;color:#2e7d32;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:.28rem .65rem;border-radius:99px">● Paid</span>`
    : `<span style="display:inline-flex;align-items:center;gap:.3rem;background:#fdecea;color:#c0392b;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.03em;padding:.28rem .65rem;border-radius:99px">● Pending</span>`;
}
function providerBadge(provider) {
  const colors = { sasapay: ['#e8f0fd','#1a56c4'], fingo: ['#efe8fd','#6a2fd0'] };
  const [bg, fg] = colors[provider] || ['#f0f0f0','#666'];
  return `<span style="background:${bg};color:${fg};font-size:.68rem;font-weight:700;text-transform:capitalize;padding:.22rem .55rem;border-radius:6px">${provider}</span>`;
}

// One label covering all four settlement line types — welfare and MGR are
// identified by their linked event/slot (not a special line_type string,
// consistent with how welfare already worked before MGR/TB existed); TB
// and regular are identified by line_type directly.
function settlementLineLabel(b) {
  if (b.welfare_event_id) return '♡ ' + (b.welfare_events?.event_type || 'Welfare Event').replace(/</g,'');
  if (b.round_slot_id) {
    const roundName = b.round_slots?.savings_rounds?.name || 'MGR Round';
    const slotNum = b.round_slots?.slot_number;
    return '🔄 ' + roundName.replace(/</g,'') + (slotNum ? ' — Round ' + slotNum : '');
  }
  if (b.line_type === 'table_banking') return '🏦 Table Banking';
  return 'Regular';
}

// Turns a welfare event's collected-so-far total into an actual
// settlement_batches row — only ever happens on explicit admin request,
// never automatically. Groups by provider (an event running for days
// could plausibly have collected via more than one, if the org switched
// providers mid-event), and snapshots the payout destination from the
// welfare event's own settings at the moment of request — so a later
// edit to those recipient details never silently rewrites a settlement
// that's already been requested.
async function requestWelfareSettlement(welfareEventId) {
  if (!currentOrg?.id) return;
  try {
    const { data: event, error: evErr } = await sb.from('welfare_events')
      .select('*').eq('id', welfareEventId).single();
    if (evErr || !event) throw new Error(evErr?.message || 'Welfare event not found');

    const { data: rows } = await sb.from('payment_requests')
      .select('provider, allocations')
      .eq('org_id', currentOrg.id).in('provider', ['sasapay','fingo'])
      .eq('status', 'approved').eq('payment_type', 'member_contribution');

    const byProvider = {};
    for (const row of rows || []) {
      let allocs = [];
      try { allocs = JSON.parse(row.allocations || '[]'); } catch(e) { continue; }
      for (const a of allocs) {
        if (!a.isWelfare || a.eventId !== welfareEventId) continue;
        byProvider[row.provider] = (byProvider[row.provider] || 0) + Number(a.amount || 0);
      }
    }

    const providers = Object.keys(byProvider).filter(p => byProvider[p] > 0);
    if (!providers.length) { toast('No collected welfare amount found for this event'); return; }

    const snapshot = event.payout_type === 'direct' ? {
      recipient_name: event.recipient_name, recipient_phone: event.recipient_phone,
      recipient_bank_name: event.recipient_bank_name, recipient_bank_account: event.recipient_bank_account,
    } : null;

    const rowsToInsert = providers.map(provider => ({
      org_id: currentOrg.id, provider, settlement_date: new Date().toISOString().split('T')[0],
      line_type: 'welfare', amount: Math.round(byProvider[provider] * 100) / 100,
      welfare_event_id: welfareEventId, requested_at: new Date().toISOString(), requested_by: currentUser.id,
      payout_destination_type: event.payout_type || 'group_platform',
      payout_destination_snapshot: snapshot,
    }));

    const { error: insErr } = await sb.from('settlement_batches').insert(rowsToInsert);
    if (insErr) throw new Error(insErr.message);

    try { logActivity('WELFARE SETTLEMENT REQUESTED', `${event.event_type} — Ksh ${providers.reduce((s,p)=>s+byProvider[p],0).toLocaleString()}`, 'welfare', welfareEventId); } catch(e) {}
    toast('✓ Settlement requested — funds will be sent within 24 hours');
    if (typeof loadOrgSettlements === 'function') loadOrgSettlements();
  } catch(e) {
    toast('Error requesting settlement: ' + e.message);
  }
}

async function loadOrgSettlements() {
  const el = document.getElementById('org-settlements-list');
  if (!el || !currentOrg?.id) return;
  el.innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';

  try {
    const since = new Date(); since.setDate(since.getDate() - 60);
    const { data: batches } = await sb.from('settlement_batches')
      .select('*, welfare_events(event_type), round_slots(slot_number, member_id, savings_rounds(name))')
      .eq('org_id', currentOrg.id)
      .gte('settlement_date', since.toISOString().split('T')[0])
      .order('settlement_date', { ascending: false });

    // Summary stats
    const monthStart = new Date(); monthStart.setDate(1);
    const monthStartStr = monthStart.toISOString().split('T')[0];
    let pendingRegular = 0, paidThisMonth = 0, pendingWelfare = 0;
    (batches || []).forEach(b => {
      const amt = Number(b.amount);
      if (b.status === 'pending') {
        if (b.line_type === 'welfare') pendingWelfare += amt; else pendingRegular += amt;
      } else if (b.status === 'paid' && b.paid_at >= monthStartStr) {
        paidThisMonth += amt;
      }
    });
    const setStat = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = 'Ksh ' + val.toLocaleString(); };
    setStat('settle-stat-pending', pendingRegular);
    setStat('settle-stat-paid', paidThisMonth);
    setStat('settle-stat-welfare', pendingWelfare);

    // Group rows by what's actually being settled, merging provider batches
    // together — a group should see "Ksh X pending for Tuesday", not a
    // separate line for each provider that contributed to it. The provider
    // split is SA's internal bookkeeping, not something groups need to see.
    const byDate = {};
    (batches || []).forEach(b => {
      const lineKey = b.round_slot_id ? 'mgr:' + b.round_slot_id
        : b.welfare_event_id ? 'welfare:' + b.welfare_event_id
        : 'type:' + (b.line_type || 'regular');
      const dateGroup = byDate[b.settlement_date] = byDate[b.settlement_date] || {};
      const g = dateGroup[lineKey] = dateGroup[lineKey] || {
        ...b, amount: 0, allPaid: true
      };
      g.amount += Number(b.amount || 0);
      if (b.status !== 'paid') g.allPaid = false;
    });

    // Unrequested welfare — events with real money collected that haven't
    // had settlement requested yet. Never auto-batched; this is purely
    // informational until the admin clicks Request Settlement.
    const alreadyRequestedEventIds = new Set((batches || []).filter(b => b.welfare_event_id).map(b => b.welfare_event_id));
    let unrequestedHtml = '';
    try {
      const { data: welfareEvents } = await sb.from('welfare_events').select('id, event_type, event_date').eq('org_id', currentOrg.id);
      const { data: contribRows } = await sb.from('payment_requests')
        .select('provider, allocations')
        .eq('org_id', currentOrg.id).in('provider', ['sasapay','fingo'])
        .eq('status', 'approved').eq('payment_type', 'member_contribution');

      const collectedByEvent = {};
      for (const row of contribRows || []) {
        let allocs = [];
        try { allocs = JSON.parse(row.allocations || '[]'); } catch(e) { continue; }
        for (const a of allocs) {
          if (!a.isWelfare || !a.eventId) continue;
          collectedByEvent[a.eventId] = (collectedByEvent[a.eventId] || 0) + Number(a.amount || 0);
        }
      }

      const unrequested = (welfareEvents || []).filter(ev => collectedByEvent[ev.id] > 0 && !alreadyRequestedEventIds.has(ev.id));
      if (unrequested.length) {
        unrequestedHtml = `
        <div class="card" style="margin-bottom:1.25rem;border:1px solid var(--gold,#c49a30);overflow:hidden">
          <div style="background:#fff9e6;padding:.7rem 1.25rem;font-weight:700;font-size:.82rem;color:#7a5c00">🔔 Welfare Collections Not Yet Requested</div>
          ${unrequested.map((ev, i) => `
            <div style="padding:.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;${i < unrequested.length-1 ? 'border-bottom:1px solid var(--border-soft)' : ''}">
              <div>
                <div style="font-weight:600;font-size:.85rem">${(ev.event_type||'Welfare Event').replace(/</g,'')}</div>
                <div style="font-size:.72rem;color:var(--ink-faint)">Ksh ${collectedByEvent[ev.id].toLocaleString()} collected so far</div>
              </div>
              <button class="btn btn-primary btn-sm" onclick="requestWelfareSettlement('${ev.id}')">Request Settlement</button>
            </div>`).join('')}
        </div>`;
      }
    } catch(e) { console.warn('Unrequested welfare check failed:', e.message); }

    if (!batches?.length) {
      el.innerHTML = unrequestedHtml || '<div class="card" style="padding:2.5rem;text-align:center;color:var(--ink-faint);font-size:.85rem">No settlements yet for this group.</div>';
      return;
    }

    el.innerHTML = unrequestedHtml + Object.entries(byDate).map(([date, dateGroup]) => {
      const rows = Object.values(dateGroup);
      return `
      <div class="card" style="margin-bottom:1rem;overflow:hidden;padding:0">
        <div style="padding:.85rem 1.25rem;border-bottom:1px solid var(--border-soft);display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:700;font-size:.88rem;font-family:'Crimson Pro',serif">${new Date(date).toLocaleDateString('en-KE', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}</div>
        </div>
        ${rows.map((b, i) => `
          <div style="padding:.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;${i < rows.length-1 ? 'border-bottom:1px solid var(--border-soft)' : ''}">
            <div style="display:flex;align-items:center;gap:.6rem">
              <span style="font-size:.78rem;color:var(--ink-soft)">${settlementLineLabel(b)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:1rem">
              <div style="font-weight:700;font-size:.92rem;font-variant-numeric:tabular-nums">Ksh ${Number(b.amount).toLocaleString()}</div>
              ${settlementStatusPill(b.allPaid ? 'paid' : 'pending')}
              <button class="btn btn-secondary btn-sm" onclick="viewSettlementDetails('${b.org_id}','','${b.settlement_date}','${b.line_type||''}','${(currentOrg.name||'').replace(/'/g,"")}','${b.round_slot_id||''}')">Details</button>
            </div>
          </div>`).join('')}
      </div>`;
    }).join('');
  } catch(e) {
    el.innerHTML = '<div style="padding:1rem;color:var(--danger);font-size:.8rem">Error: ' + e.message + '</div>';
  }
}
