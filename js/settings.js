
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
async function loadSuperAdmin() {
  document.getElementById('sa-org-list').innerHTML = '<div class="loading"><div class="spinner"></div>Loading organisations…</div>';
  const [orgsRes, membersRes] = await Promise.all([
    sb.from('organisations').select('*').order('created_at',{ascending:false}),
    sb.from('members').select('id,org_id')
  ]);
  const orgs = orgsRes.data || [];
  const members = membersRes.data || [];
  const planRevenue = { starter:0, basic:3000, standard:6000, pro:12000 };
  const revenue = orgs.reduce((s,o) => s+(planRevenue[o.plan]||0), 0);
  document.getElementById('sa-orgs').textContent = orgs.length;
  document.getElementById('sa-members').textContent = members.length;
  document.getElementById('sa-plans').textContent = orgs.filter(o=>o.plan!=='starter').length + ' paid';
  document.getElementById('sa-revenue').textContent = 'Ksh '+revenue.toLocaleString();
  const memberCountByOrg = {};
  members.forEach(m => { memberCountByOrg[m.org_id] = (memberCountByOrg[m.org_id]||0)+1; });
  // Check pending payments and show alert
  try {
    const { data: pendingPays } = await sb.from('payment_requests').select('id,organisations(name)').eq('status','pending');
    const alertEl = document.getElementById('sa-payment-alert');
    const alertText = document.getElementById('sa-payment-alert-text');
    if (alertEl && pendingPays?.length > 0) {
      alertEl.style.display = 'flex';
      const orgNames = [...new Set(pendingPays.map(p => p.organisations?.name).filter(Boolean))];
      alertText.textContent = `${pendingPays.length} request${pendingPays.length>1?'s':''} from: ${orgNames.join(', ')}`;
    } else if (alertEl) {
      alertEl.style.display = 'none';
    }
  } catch(e) { console.log('No payment_requests table yet'); }

  document.getElementById('sa-org-list').innerHTML = orgs.length ? orgs.map(o => `
    <div class="org-row" style="cursor:pointer" onclick="openOrgDetail('${o.id}')">
      <div>
        <div class="org-name">${o.name}</div>
        <div class="org-meta">${o.reg_number||'No reg number'} · ${memberCountByOrg[o.id]||0} members · Code: <strong style="color:var(--maroon)">${o.org_code||'—'}</strong></div>
      </div>
      <div class="org-actions" onclick="event.stopPropagation()">
        <span class="badge ${o.plan==='pro'?'badge-gold':o.plan==='standard'?'badge-maroon':o.plan==='basic'?'badge-green':'badge-grey'}">${o.plan}</span>
        <span class="badge ${o.status==='active'?'badge-green':'badge-red'}">${o.status}</span>
        <button class="btn btn-secondary btn-sm" onclick="toggleOrgStatus('${o.id}','${o.status}')">${o.status==='active'?'Suspend':'Activate'}</button>
        <button class="btn btn-primary btn-sm" onclick="openOrgDetail('${o.id}')">View Details</button>
      </div>
    </div>`).join('') : '<div style="padding:2rem;text-align:center;color:var(--ink-faint)">No organisations yet</div>';
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
      <td><span class="badge badge-maroon">${map[m.org_id]||'Unknown'}</span></td>
      <td>Ksh ${m.savings_tier?.toLocaleString()||'—'}/mo</td>
      <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey'}">${m.status}</span></td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--ink-faint)">No members found</td></tr>';
}

function filterSAOrgs(q) {
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
  const { data: org } = await sb.from('organisations').select('*').eq('id', orgId).single();
  const { data: members } = await sb.from('members').select('*').eq('org_id', orgId).order('member_number');
  const { data: profiles } = await sb.from('profiles').select('id,full_name,role').eq('org_id', orgId);
  _odAllMembers = members || [];
  document.getElementById('od-org-name').textContent = org.name;
  document.getElementById('od-org-reg').textContent = org.reg_number || 'No registration number';
  document.getElementById('od-members').textContent = (members||[]).length;
  document.getElementById('od-plan').textContent = org.plan?.toUpperCase() || '—';
  document.getElementById('od-status').textContent = (org.subscription_status || org.status)?.toUpperCase() || '—';
  const odCode = document.getElementById('od-org-code');
  if (odCode) odCode.textContent = org.org_code || '—';
  // Details tab
  document.getElementById('od-name').value = org.name || '';
  document.getElementById('od-reg').value = org.reg_number || '';
  document.getElementById('od-paybill').value = org.paybill || '';
  document.getElementById('od-plan-select').value = org.plan || 'starter';
  document.getElementById('od-status-select').value = org.status || 'active';
  document.getElementById('od-founded').value = org.date_founded || '';
  const emailEl = document.getElementById('od-email'); if(emailEl) emailEl.value = org.email || '';
  // Features tab
  const setOdVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setOdVal('od-daraja-key', org.daraja_consumer_key || '');
  setOdVal('od-daraja-secret', org.daraja_consumer_secret || '');
  setOdVal('od-daraja-shortcode', org.daraja_shortcode || '');
  setOdVal('od-daraja-passkey', org.daraja_passkey || '');
  setOdVal('od-daraja-env', org.daraja_env || 'sandbox');
  const darajaEnabledEl = document.getElementById('od-daraja-enabled');
  if (darajaEnabledEl) darajaEnabledEl.value = org.daraja_enabled ? 'true' : 'false';
  const smsEl = document.getElementById('od-sms-enabled'); if(smsEl) smsEl.value = org.sms_enabled === false ? 'false' : 'true';
  const twoFaEl = document.getElementById('od-2fa-enabled'); if(twoFaEl) twoFaEl.value = org.two_fa_enabled ? 'true' : 'false';
  // Billing tab
  const subStatusEl = document.getElementById('od-sub-status'); if(subStatusEl) subStatusEl.value = org.subscription_status || 'active';
  const subExpiryEl = document.getElementById('od-sub-expiry'); if(subExpiryEl) subExpiryEl.value = org.subscription_expires || '';
  const smsBundleEl = document.getElementById('od-sms-bundle'); if(smsBundleEl) smsBundleEl.value = org.sms_bundle || 0;
  const smsUsedEl = document.getElementById('od-sms-used'); if(smsUsedEl) smsUsedEl.value = org.sms_used || 0;
  // Members tab
  renderODMembers(_odAllMembers);
  showModal('orgDetail');
}

function renderODMembers(members) {
  document.getElementById('od-members-list').innerHTML = members.length ? members.map(m=>`
    <tr>
      <td>${m.member_number||'—'}</td>
      <td><strong>${m.full_name}</strong></td>
      <td style="font-size:.75rem">${m.phone||m.email||'—'}</td>
      <td><span class="badge badge-grey" style="font-size:.62rem">${m.status}</span></td>
      <td>Ksh ${(Number(m.shares_balance||0)+Number(m.savings_balance||0)).toLocaleString()}</td>
    </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;padding:1rem;color:var(--ink-faint)">No members yet</td></tr>';
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

