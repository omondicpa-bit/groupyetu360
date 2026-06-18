
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
async function loadSettings() {
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
  const bbLocked = currentOrg.bank_balance_locked || (bbVal !== null && bbVal !== undefined && bbVal > 0);
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
  const twoFaEl = document.getElementById('settings-2fa');
  const twoFaLabel = document.getElementById('settings-2fa-label');
  if (twoFaEl) {
    twoFaEl.checked = currentOrg?.two_fa_enabled || false;
    if (twoFaLabel) twoFaLabel.textContent = twoFaEl.checked ? 'Enabled' : 'Disabled';
    twoFaEl.onchange = () => { if(twoFaLabel) twoFaLabel.textContent = twoFaEl.checked ? 'Enabled' : 'Disabled'; };
  }


  const { data } = await sb.from('contribution_types').select('*').eq('org_id', currentOrg.id).order('name');
  allContribTypes = data || [];
  const ctEl = document.getElementById('contrib-types-list');
  if (ctEl) {
    ctEl.innerHTML = allContribTypes.length ? `
      <div class="table-wrap">
      <table><thead><tr><th>Type</th><th>Default Amt</th><th>Frequency</th><th>Income Type</th><th></th></tr></thead>
      <tbody>${allContribTypes.map(t=>`<tr>
        <td><strong>${t.name}</strong>${t.notes?`<div style='font-size:.68rem;color:var(--ink-faint)'>${t.notes}</div>`:''}</td>
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
  const { data: authData, error: authErr } = await sb.auth.signUp({
    email, password, options: { data: { full_name: name } }
  });
  if (authErr) { toast('Error: '+authErr.message); return; }
  await sb.from('profiles').upsert({
    id: authData.user.id,
    org_id: currentOrg.id,
    role,
    full_name: name
  });
  toast(name + ' added as ' + role);
  closeModal('inviteAdmin');
  loadTeamMembers();
}

// ── SHAREOUT & WITHDRAW FUNCTIONS ──
function showShareoutModal() {
  document.getElementById('shareout-type').value = 'full';
  document.getElementById('shareout-reason').value = '';
  document.getElementById('shareout-pct-group').style.display = 'none';
  document.getElementById('shareout-fixed-group').style.display = 'none';
  updateShareoutPreview();
  showModal('shareout');
}

function updateShareoutPreview() {
  const type = document.getElementById('shareout-type')?.value;
  const pctGroup = document.getElementById('shareout-pct-group');
  const fixedGroup = document.getElementById('shareout-fixed-group');
  const preview = document.getElementById('shareout-preview-content');
  if (pctGroup) pctGroup.style.display = type === 'percentage' ? 'block' : 'none';
  if (fixedGroup) fixedGroup.style.display = type === 'fixed' ? 'block' : 'none';
  const totalSavings = allMembers.reduce((s,m)=>s+(m.savings_balance||0),0);
  const memberCount = allMembers.filter(m=>m.savings_balance>0).length;
  if (!preview) return;
  if (type === 'full') {
    preview.innerHTML = `Will zero out savings for <strong>${memberCount} members</strong>.<br>Total distributed: <strong>Ksh ${totalSavings.toLocaleString()}</strong>`;
  } else if (type === 'percentage') {
    const pct = parseFloat(document.getElementById('shareout-pct')?.value)||0;
    const total = totalSavings * pct/100;
    preview.innerHTML = `Will deduct <strong>${pct}%</strong> from ${memberCount} members.<br>Total distributed: <strong>Ksh ${total.toLocaleString()}</strong>`;
  } else {
    const fixed = parseFloat(document.getElementById('shareout-fixed')?.value)||0;
    preview.innerHTML = `Will deduct <strong>Ksh ${fixed.toLocaleString()}</strong> from ${memberCount} members.<br>Total distributed: <strong>Ksh ${(fixed*memberCount).toLocaleString()}</strong>`;
  }
}

async function executeShareout() {
  const type = document.getElementById('shareout-type')?.value;
  const reason = document.getElementById('shareout-reason')?.value?.trim();
  if (!reason) { toast('Please enter a reason for the shareout'); return; }
  if (!confirm(`Execute shareout for all ${allMembers.length} members? This cannot be undone.`)) return;

  let processed = 0;
  for (const member of allMembers) {
    if (!member.savings_balance || member.savings_balance <= 0) continue;
    let deductAmount = 0;
    if (type === 'full') {
      deductAmount = member.savings_balance;
    } else if (type === 'percentage') {
      const pct = parseFloat(document.getElementById('shareout-pct')?.value)||0;
      deductAmount = member.savings_balance * pct/100;
    } else {
      deductAmount = parseFloat(document.getElementById('shareout-fixed')?.value)||0;
      deductAmount = Math.min(deductAmount, member.savings_balance);
    }
    if (deductAmount <= 0) continue;

    // Record adjustment
    await sb.from('balance_adjustments').insert({
      org_id: currentOrg.id,
      member_id: member.id,
      adjustment_type: 'savings',
      direction: 'debit',
      amount: deductAmount,
      reason: `Shareout: ${reason}`,
      recorded_by: currentUser.id
    });
    // Update balance
    await sb.from('members').update({
      savings_balance: Math.max(0, member.savings_balance - deductAmount)
    }).eq('id', member.id);
    processed++;
  }

  await logActivity('SHAREOUT', `Year-end shareout: ${reason}. ${processed} members processed.`);
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
  toast(`Withdraw window ${newState ? 'opened' : 'closed'}`);
  await logActivity(newState?'WITHDRAW OPEN':'WITHDRAW CLOSE', `Withdraw window ${newState?'opened':'closed'} by admin`);
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
    two_fa_enabled: document.getElementById('settings-2fa')?.checked || false,
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

let _editingContribTypeId = null;

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
let _saOrgs = [], _saMemberCount = {};

async function loadSuperAdmin() {
  document.getElementById('sa-org-list').innerHTML = '<div class="loading"><div class="spinner"></div>Loading…</div>';
  let pendingRes = { data: [] };
  try { pendingRes = await sb.from('payment_requests').select('id,organisations(name)').eq('status','pending'); } catch(e) {}
  const [orgsRes, membersRes] = await Promise.all([
    sb.from('organisations').select('*').order('created_at',{ascending:false}),
    sb.from('members').select('id,org_id'),
  ]);
  _saOrgs = orgsRes.data || [];
  const members = membersRes.data || [];
  _saMemberCount = {};
  members.forEach(m => { _saMemberCount[m.org_id] = (_saMemberCount[m.org_id]||0)+1; });

  const planRevenue = { starter:0, basic:3000, standard:6000, pro:12000 };
  const revenue = _saOrgs.reduce((s,o) => s+(planRevenue[o.plan]||0), 0);
  document.getElementById('sa-orgs').textContent = _saOrgs.length;
  document.getElementById('sa-members').textContent = members.length;
  document.getElementById('sa-plans').textContent = _saOrgs.filter(o=>o.plan!=='starter').length + ' paid';
  document.getElementById('sa-revenue').textContent = 'Ksh '+revenue.toLocaleString();

  // Pending payments alert
  const pendingPays = pendingRes.data || [];
  const alertEl = document.getElementById('sa-payment-alert');
  const alertText = document.getElementById('sa-payment-alert-text');
  if (alertEl) {
    alertEl.style.display = pendingPays.length ? 'flex' : 'none';
    if (pendingPays.length && alertText) {
      const names = [...new Set(pendingPays.map(p=>p.organisations?.name).filter(Boolean))];
      alertText.textContent = `${pendingPays.length} request${pendingPays.length>1?'s':''} from: ${names.join(', ')}`;
    }
  }

  // Expiring soon alert (within 30 days)
  const soon = _saOrgs.filter(o => {
    if (!o.subscription_expires || o.plan==='starter') return false;
    const days = Math.ceil((new Date(o.subscription_expires)-new Date())/86400000);
    return days >= 0 && days <= 30;
  });
  const expEl = document.getElementById('sa-expiring-alert');
  if (expEl && soon.length) {
    expEl.style.display = 'block';
    expEl.innerHTML = `<div style="background:var(--warning-pale);border:1.5px solid var(--warning);border-radius:6px;padding:.85rem 1.25rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.75rem">
      <div><span style="font-weight:700;color:var(--warning)">⏱ ${soon.length} subscription${soon.length>1?'s':''} expiring within 30 days</span>
      <div style="font-size:.75rem;color:var(--ink-soft);margin-top:.2rem">${soon.map(o=>`${o.name} (${Math.ceil((new Date(o.subscription_expires)-new Date())/86400000)}d)`).join(' · ')}</div></div>
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('sa-plan-filter').value='';document.getElementById('sa-status-filter').value='active';filterSAOrgs('')" style="font-size:.72rem">View All Active</button>
    </div>`;
  } else if (expEl) expEl.style.display = 'none';

  filterSAOrgs('');
}

function filterSAOrgs(q) {
  const planFilter = document.getElementById('sa-plan-filter')?.value || '';
  const statusFilter = document.getElementById('sa-status-filter')?.value || '';
  const query = (q||'').toLowerCase();
  const filtered = _saOrgs.filter(o => {
    const matchQ = !query || o.name?.toLowerCase().includes(query) || o.org_code?.toLowerCase().includes(query) || o.reg_number?.toLowerCase().includes(query);
    const matchPlan = !planFilter || o.plan === planFilter;
    const matchStatus = !statusFilter || o.status === statusFilter;
    return matchQ && matchPlan && matchStatus;
  });

  const countEl = document.getElementById('sa-org-count');
  if (countEl) countEl.textContent = `${filtered.length} of ${_saOrgs.length} organisations`;

  const listEl = document.getElementById('sa-org-list');
  if (!listEl) return;
  if (!filtered.length) { listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--ink-faint)">No organisations match filters</div>'; return; }

  const today = new Date();
  listEl.innerHTML = filtered.map(o => {
    const memberCount = _saMemberCount[o.id]||0;
    const expires = o.subscription_expires ? new Date(o.subscription_expires) : null;
    const daysLeft = expires ? Math.ceil((expires-today)/86400000) : null;
    const expiryBadge = !expires ? '' :
      daysLeft < 0 ? '<span class="badge badge-red" style="font-size:.6rem">EXPIRED</span>' :
      daysLeft <= 30 ? `<span class="badge badge-warn" style="font-size:.6rem">${daysLeft}d left</span>` : '';
    const planBadge = `<span class="badge ${o.plan==='pro'?'badge-gold':o.plan==='standard'?'badge-maroon':o.plan==='basic'?'badge-green':'badge-grey'}">${o.plan}</span>`;
    const statusBadge = `<span class="badge ${o.status==='active'?'badge-green':o.status==='suspended'?'badge-red':'badge-grey'}">${o.status}</span>`;
    return `<div class="org-row" style="cursor:pointer" onclick="openOrgDetail('${o.id}')">
      <div>
        <div class="org-name">${o.name.toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}</div>
        <div class="org-meta">${o.reg_number||'No reg'} · ${memberCount} members · <strong style="color:var(--maroon)">${o.org_code||'—'}</strong> · ${o.email||'no email'}</div>
      </div>
      <div class="org-actions" onclick="event.stopPropagation()">
        ${planBadge} ${statusBadge} ${expiryBadge}
        <button class="btn btn-primary btn-sm" onclick="openOrgDetail('${o.id}')" style="font-size:.7rem">Open →</button>
      </div>
    </div>`;
  }).join('');
}

async function toggleOrgStatus(orgId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  const { error } = await sb.from('organisations').update({ status: newStatus }).eq('id', orgId);
  if (error) { toast('Error: '+error.message); return; }
  toast('Organisation '+newStatus);
  loadSuperAdmin();
}

async function saveOrg() {
  const plan = document.getElementById('ao-plan').value;
  // 2-month free trial expiry for all new orgs
  const trialExpiry = new Date();
  trialExpiry.setMonth(trialExpiry.getMonth() + 2);
  const payload = {
    name: document.getElementById('ao-name').value.trim(),
    reg_number: document.getElementById('ao-reg').value.trim(),
    paybill: document.getElementById('ao-paybill').value.trim(),
    plan,
    status: document.getElementById('ao-status').value,
    subscription_status: 'trial',
    subscription_expires: trialExpiry.toISOString().split('T')[0],
    sms_bundle: { starter:50, basic:200, standard:500, pro:1000 }[plan] || 50
  };
  if (!payload.name) { toast('Please enter an organisation name'); return; }
  const { error } = await sb.from('organisations').insert(payload);
  if (error) { toast('Error: '+error.message); return; }
  toast('✓ Organisation onboarded — 2-month free trial until ' + trialExpiry.toDateString());
  closeModal('addOrg');
  loadSuperAdmin();
}

// ── TABS ──
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
}
function closeModal(id) { document.getElementById('modal-'+id)?.classList.remove('open'); }
document.querySelectorAll('.modal-overlay').forEach(o => o.addEventListener('click', e => { if(e.target===o) o.classList.remove('open'); }));

// ── TOAST ──
function toast(msg) {
  const t = document.getElementById('toast-el');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}


// ── SUPERADMIN: ALL MEMBERS ──
let allSAMembers = [];
async function loadSAMembers() {
  document.getElementById('sa-all-members').innerHTML = '<tr><td colspan="6"><div class="loading"><div class="spinner"></div>Loading all members…</div></td></tr>';
  const [membersRes, orgsRes] = await Promise.all([
    sb.from('members').select('*').order('full_name'),
    sb.from('organisations').select('id,name')
  ]);
  allSAMembers = membersRes.data || [];
  const orgMap = {};
  (orgsRes.data||[]).forEach(o => orgMap[o.id] = o.name);
  renderSAMembers(allSAMembers, orgMap);
  window._saOrgMap = orgMap;
}

function renderSAMembers(list, orgMap) {
  const map = orgMap || window._saOrgMap || {};
  document.getElementById('sa-all-members').innerHTML = list.length ? list.map((m,i) => `
    <tr>
      <td>${m.member_number||String(i+1).padStart(3,'0')}</td>
      <td><strong>${m.full_name}</strong></td>
      <td>${m.phone||'—'}</td>
      <td><span class="badge badge-maroon" style="text-transform:capitalize;font-size:.62rem">${(map[m.org_id]||'Unknown').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase())}</span></td>
      <td>Ksh ${m.savings_tier?.toLocaleString()||'—'}/mo</td>
      <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey'}">${m.status}</span></td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--ink-faint)">No members found</td></tr>';
}

function _oldFilterSAOrgs_DISABLED(q) {
  const rows = document.querySelectorAll('#sa-org-list .org-row');
  const ql = q.toLowerCase();
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = (!q || text.includes(ql)) ? '' : 'none';
  });
}

// filterSAOrgs defined above

function filterSAMembers(q) {
  const map = window._saOrgMap || {};
  const f = allSAMembers.filter(m =>
    m.full_name.toLowerCase().includes(q.toLowerCase()) ||
    (m.phone||'').includes(q) ||
    (map[m.org_id]||'').toLowerCase().includes(q.toLowerCase())
  );
  renderSAMembers(f, map);
}

// ── SUPERADMIN: REVENUE PAGE ──
async function loadSAFinance() {
  document.getElementById('sa-revenue-list').innerHTML = '<div class="loading"><div class="spinner"></div>Loading revenue data…</div>';
  const { data: orgs } = await sb.from('organisations').select('*');
  const planRevenue = { starter:0, basic:3000, standard:6000, pro:12000 };
  const counts = { starter:0, basic:0, standard:0, pro:0 };
  (orgs||[]).forEach(o => { if(counts[o.plan]!==undefined) counts[o.plan]++; });
  document.getElementById('rev-starter').textContent = counts.starter;
  document.getElementById('rev-basic').textContent = counts.basic + ' · Ksh ' + (counts.basic*3000).toLocaleString();
  document.getElementById('rev-standard').textContent = counts.standard + ' · Ksh ' + (counts.standard*6000).toLocaleString();
  document.getElementById('rev-pro').textContent = counts.pro + ' · Ksh ' + (counts.pro*12000).toLocaleString();
  const total = (orgs||[]).reduce((s,o)=>s+(planRevenue[o.plan]||0),0);
  document.getElementById('sa-revenue-list').innerHTML = `
    <table>
      <thead><tr><th>Organisation</th><th>Plan</th><th>Status</th><th>Annual Revenue</th><th>Renewal Due</th></tr></thead>
      <tbody>${(orgs||[]).map(o=>`<tr>
        <td><strong>${o.name}</strong><div style="font-size:.68rem;color:var(--ink-faint)">${o.reg_number||'—'}</div></td>
        <td><span class="badge ${o.plan==='pro'?'badge-gold':o.plan==='standard'?'badge-maroon':o.plan==='basic'?'badge-green':'badge-grey'}">${o.plan}</span></td>
        <td><span class="badge ${o.status==='active'?'badge-green':'badge-red'}">${o.status}</span></td>
        <td><strong>Ksh ${(planRevenue[o.plan]||0).toLocaleString()}</strong></td>
        <td style="color:var(--ink-faint)">Set renewal date</td>
      </tr>`).join('')}
      <tr style="background:var(--surface-2)">
        <td colspan="3"><strong>Total Annual Revenue</strong></td>
        <td colspan="2"><strong style="color:var(--maroon)">Ksh ${total.toLocaleString()}</strong></td>
      </tr></tbody>
    </table>`;
}

// ── ORG DETAIL ──
let currentDetailOrgId = null;
// Store all org members for search filtering in od modal
let _odAllMembers = [];

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
  sv('od-daraja-key', org.daraja_consumer_key); sv('od-daraja-secret', org.daraja_consumer_secret);
  sv('od-daraja-shortcode', org.daraja_shortcode); sv('od-daraja-passkey', org.daraja_passkey);
  sv('od-daraja-env', org.daraja_env||'sandbox');
  sv('od-daraja-enabled', org.daraja_enabled?'true':'false');
  sv('od-sms-enabled', org.sms_enabled===false?'false':'true');
  sv('od-2fa-enabled', org.two_fa_enabled?'true':'false');
  toggleDarajaSection(org.plan);

  // Billing tab
  sv('od-sub-status', org.subscription_status||'active');
  sv('od-sub-expiry', org.subscription_expires||'');
  sv('od-sms-bundle', org.sms_bundle||0);
  sv('od-sms-used', org.sms_used||0);

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
    ${txns.map(t=>`<tr><td style="font-size:.72rem;color:var(--ink-faint)">${t.transaction_date||t.created_at?.split('T')[0]||'—'}</td><td style="font-size:.8rem">${t.members?.full_name||'—'}</td><td style="font-size:.75rem">${t.contribution_types?.name||'Payment'}</td><td style="font-weight:600">Ksh ${Number(t.amount).toLocaleString()}</td></tr>`).join('')}
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
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: 'https://app.groupyetu.org/' });
  if (error) { toast('Error: '+error.message); return; }
  toast(`✓ Password reset link sent to ${email}`);
}

async function sendMessageToOrgAdmin() {
  const msg = document.getElementById('od-admin-message')?.value?.trim();
  if (!msg) { toast('Enter a message'); return; }
  if (!currentDetailOrgId) return;
  const org = _saOrgs.find(o=>o.id===currentDetailOrgId);
  if (!org) return;
  // Get admin phone
  const { data: profiles } = await sb.from('profiles').select('phone,full_name').eq('org_id',currentDetailOrgId).in('role',['admin','officer','treasurer']);
  if (!profiles?.length) { toast('No admin phone found for this org'); return; }
  // Use platform SMS (simplified - would call SMS function)
  toast(`✓ Message queued for ${profiles.length} admin(s) — SMS feature coming soon`);
  document.getElementById('od-admin-message').value = '';
}

async function saDeleteOrg() {
  if (!currentDetailOrgId) return;
  const org = _saOrgs.find(o=>o.id===currentDetailOrgId);
  if (!org) return;
  const confirm1 = prompt(`Type "${org.name}" to confirm deletion:`);
  if (confirm1 !== org.name) { toast('Cancelled — name did not match'); return; }
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
    return `<tr>
      <td style="font-weight:700;color:var(--maroon)">${m.member_number||'—'}</td>
      <td><strong>${m.full_name}</strong><div style="font-size:.68rem;color:var(--ink-faint)">${m.email||''}</div></td>
      <td style="font-size:.78rem">${m.phone||'—'}</td>
      <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':m.status==='deregistered'?'badge-red':'badge-grey'}" style="font-size:.62rem">${m.status}</span></td>
      <td style="font-weight:600">Ksh ${bal.toLocaleString()}</td>
      <td><span class="${hasPortal?'badge badge-green':'badge badge-grey'}" style="font-size:.6rem">${hasPortal?'✓ Linked':'—'}</span></td>
      <td><button class="btn btn-secondary btn-sm" style="font-size:.65rem" onclick="saViewMember('${m.id}')">View</button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;padding:1.5rem;color:var(--ink-faint)">No members yet</td></tr>';
}

async function saViewMember(memberId) {
  // Quick member detail modal for support
  const m = _odAllMembers.find(m=>m.id===memberId);
  if (!m) return;
  alert(`Member: ${m.full_name}
Phone: ${m.phone||'—'}
Email: ${m.email||'—'}
Portal: ${m.portal_email||'Not linked'}
Status: ${m.status}
Shares: Ksh ${Number(m.shares_balance||0).toLocaleString()}
Savings: Ksh ${Number(m.savings_balance||0).toLocaleString()}`);
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

function toggleDarajaSection(plan) {
  if (!plan) plan = document.getElementById('od-plan-select')?.value;
  const section = document.getElementById('od-daraja-section');
  if (section) section.style.display = ['standard','pro'].includes(plan) ? 'block' : 'none';
}

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
    daraja_enabled: document.getElementById('od-daraja-enabled')?.value === 'true',
    daraja_env: gv('od-daraja-env') || 'sandbox',
    sms_enabled: document.getElementById('od-sms-enabled')?.value !== 'false',
    two_fa_enabled: document.getElementById('od-2fa-enabled')?.value === 'true',
    // Billing
    subscription_status: document.getElementById('od-sub-status')?.value || 'active',
    subscription_expires: gv('od-sub-expiry'),
    sms_bundle: parseInt(document.getElementById('od-sms-bundle')?.value) || 0
  };
  // Daraja credentials
  const dk = gv('od-daraja-key'); if(dk) updates.daraja_consumer_key = dk;
  const ds = gv('od-daraja-secret'); if(ds) updates.daraja_consumer_secret = ds;
  const dp = gv('od-daraja-passkey'); if(dp) updates.daraja_passkey = dp;
  const dsc = gv('od-daraja-shortcode'); if(dsc) updates.daraja_shortcode = dsc;
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
  const typedName = prompt('Type the organisation name to confirm deletion:\n\n' + org.name + '\n\nThis will permanently delete ALL data for this organisation.');
  if (!typedName || typedName.trim().toLowerCase() !== org.name.toLowerCase()) {
    toast('Name did not match — deletion cancelled.'); return;
  }
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
let currentPendingId = null;
let currentPendingUserId = null;


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

  // Also count pending payments
  let pendingPayCount = 0;
  try {
    const { data: pendingPays } = await sb.from('payment_requests')
      .select('id').eq('org_id', currentOrg.id).eq('status','pending');
    pendingPayCount = pendingPays?.length || 0;
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
    allMembers.map(m => `<option value="${m.id}">${m.full_name} (#${m.member_number||'—'})</option>`).join('');
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
  if (!currentPendingId || !currentPendingUserId) return;
  const linkMemberId = document.getElementById('approve-link-member').value;
  const notes = document.getElementById('approve-notes').value.trim();
  let memberId = linkMemberId;

  // Get pending request details
  const { data: pending } = await sb.from('pending_members').select('*').eq('id', currentPendingId).single();

  if (!linkMemberId) {
    // Create new member record
    const { data: newMember, error: memberErr } = await sb.from('members').insert({
      org_id: currentOrg.id,
      full_name: pending.full_name,
      phone: pending.phone,
      member_number: document.getElementById('approve-member-num').value,
      savings_tier: parseInt(document.getElementById('approve-savings').value),
      registration_paid: false,
      status: 'active',
      join_date: new Date().toISOString().split('T')[0]
    }).select().single();
    if (memberErr) { toast('Error creating member: ' + memberErr.message); return; }
    memberId = newMember.id;
  }

  // Update profile role to member
  await sb.from('profiles').update({
    role: 'member',
    org_id: currentOrg.id
  }).eq('id', currentPendingUserId);

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

