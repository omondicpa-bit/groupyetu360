// GroupYetu360 — js/portal.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── MEMBER PORTAL LOADERS ──
async function loadMyAccount() {
  const el = id => document.getElementById(id);
  if (el('acct-name')) el('acct-name').value = currentProfile?.full_name || '';
  if (el('acct-phone')) el('acct-phone').value = currentProfile?.phone || '';
  if (el('acct-email')) el('acct-email').value = currentUser?.email || '';
  const msgEl = el('acct-msg');
  if (msgEl) msgEl.style.display = 'none';

  // Email-change hint text — "contact your group admin" is meaningless for a superadmin,
  // there is no admin above them. Point them at the actual process instead.
  const emailHint = currentProfile?.role === 'superadmin'
    ? 'Platform login email changes require a direct database update — contact your developer/EPH Technologies.'
    : 'Email cannot be changed here. Contact your group admin.';
  if (el('acct-email-hint')) el('acct-email-hint').textContent = emailHint;
  if (el('acct-email-hint-mob')) el('acct-email-hint-mob').textContent = emailHint;

  // 2FA section — admin, treasurer, superadmin only. Re-fetch fresh from DB rather than
  // trusting currentProfile, since a stale in-memory profile could hide a toggle that
  // should be showing (e.g. right after a role change).
  const isElevated = ['admin','treasurer','superadmin'].includes(currentProfile?.role);
  const cardEl = el('acct-2fa-card'), cardMobEl = el('acct-2fa-card-mob');
  if (cardEl) cardEl.style.display = isElevated ? '' : 'none';
  if (cardMobEl) cardMobEl.style.display = isElevated ? '' : 'none';
  if (!isElevated) return;

  let enabled = currentProfile?.two_fa_enabled === true;
  try {
    const { data } = await sb.from('profiles').select('two_fa_enabled').eq('id', currentUser.id).maybeSingle();
    if (data) enabled = data.two_fa_enabled === true;
  } catch(e) {}

  ['', '-mob'].forEach(suffix => {
    const cb = el('acct-2fa' + suffix);
    if (cb) cb.checked = enabled;
  });
  updateAcctTwoFAToggleUI();
}

function updateAcctTwoFAToggleUI() {
  ['', '-mob'].forEach(suffix => {
    const cb = document.getElementById('acct-2fa' + suffix);
    const ui = document.getElementById('acct-2fa-toggle-ui' + suffix);
    const knob = document.getElementById('acct-2fa-knob' + suffix);
    const label = document.getElementById('acct-2fa-label' + suffix);
    if (!cb || !ui || !knob) return;
    const on = cb.checked;
    ui.style.background  = on ? '#2a9d8f' : '#ccc';
    knob.style.transform = on ? 'translateX(20px)' : 'translateX(0)';
    if (label) label.textContent = on ? 'On' : 'Off';
    cb.onchange = updateAcctTwoFAToggleUI;
  });
}

async function saveTwoFA(isMobile) {
  const isElevated = ['admin','treasurer','superadmin'].includes(currentProfile?.role);
  if (!isElevated) return;
  const cb = document.getElementById(isMobile ? 'acct-2fa-mob' : 'acct-2fa');
  const msgEl = document.getElementById(isMobile ? 'acct-2fa-msg-mob' : 'acct-2fa-msg');
  const enabled = cb?.checked || false;
  try {
    const { error } = await sb.from('profiles').update({ two_fa_enabled: enabled }).eq('id', currentUser.id);
    if (error) throw error;
    if (currentProfile) currentProfile.two_fa_enabled = enabled;
    if (msgEl) { msgEl.textContent = '✓ 2FA ' + (enabled ? 'enabled' : 'disabled') + ' — takes effect on your next sign-in'; msgEl.style.color = 'var(--teal,#2a9d8f)'; msgEl.style.display = 'block'; }
    toast('2FA ' + (enabled ? 'enabled' : 'disabled'));
    try { await logActivity('2FA ' + (enabled ? 'ENABLED' : 'DISABLED'), `${currentProfile?.full_name || 'User'} (${currentProfile?.role}) ${enabled?'enabled':'disabled'} two-factor authentication`); } catch(e) {}
  } catch(e) {
    if (msgEl) { msgEl.textContent = 'Error: ' + e.message; msgEl.style.color = 'var(--danger)'; msgEl.style.display = 'block'; }
  }
}

async function saveAccountInfo() {
  const name = document.getElementById('acct-name')?.value.trim();
  const phone = document.getElementById('acct-phone')?.value.trim();
  if (!name) { toast('Please enter your name'); return; }
  const { error } = await sb.from('profiles').update({ full_name: name, phone }).eq('id', currentUser.id);
  if (error) { toast('Error: '+error.message); return; }
  currentProfile.full_name = name;
  currentProfile.phone = phone;
  updateSidebar();
  toast('Profile updated successfully');
}

async function saveNewPassword() {
  const newPass = document.getElementById('acct-new-pass')?.value;
  const confirmPass = document.getElementById('acct-confirm-pass')?.value;
  const msgEl = document.getElementById('acct-msg');
  if (!newPass || newPass.length < 6) { toast('Password must be at least 6 characters'); return; }
  if (newPass !== confirmPass) { toast('Passwords do not match'); return; }
  const { error } = await sb.auth.updateUser({ password: newPass });
  if (error) { toast('Error: '+error.message); return; }
  if (msgEl) { msgEl.textContent = '✓ Password updated successfully'; msgEl.className = 'alert alert-success'; msgEl.style.display = 'flex'; }
  document.getElementById('acct-new-pass').value = '';
  document.getElementById('acct-confirm-pass').value = '';
  toast('Password updated successfully');
}

async function loadMyProfile() {
  if (!currentOrg?.id || !currentProfile) return;
  // Reset member ID — will be set fresh for this org
  window._myMemberId = null;
  document.getElementById('my-profile-org').textContent = currentOrg.name;
  // Load payment methods
  renderPaymentMethods(currentOrg, 'mp-payment-methods', false);
  document.getElementById('mp-shares-amount').textContent = 'Ksh 300';
// payment methods rendered via renderPaymentMethods in mp-payment-methods
  // Show org balance if enabled
  const balCard = document.getElementById('org-balance-card');
  if (balCard && currentOrg?.show_balance_to_members && currentOrg?.bank_balance) {
    balCard.style.display = 'block';
    const balEl = document.getElementById('mp-org-balance');
    const dateEl = document.getElementById('mp-org-balance-date');
    if (balEl) balEl.textContent = 'Ksh ' + Number(currentOrg.bank_balance).toLocaleString();
    if (dateEl) dateEl.textContent = currentOrg.bank_balance_updated || '—';
  }

  let myRecord = null;

  // 1. Try portal_email match
  if (currentUser?.email) {
    const { data: byEmail } = await sb.from('members')
      .select('*').eq('org_id', currentOrg.id)
      .eq('portal_email', currentUser.email).maybeSingle();
    if (byEmail) { myRecord = byEmail; }
  }

  // 2. Try linked via pending_members approval
  if (!myRecord) {
    const { data: linked } = await sb.from('pending_members')
      .select('linked_member_id').eq('user_id', currentUser.id).eq('status','approved').maybeSingle();
    if (linked?.linked_member_id) {
      const { data: byLink } = await sb.from('members')
        .select('*').eq('id', linked.linked_member_id).maybeSingle();
      if (byLink) myRecord = byLink;
    }
  }

  // 3. Fallback: load all org members, match by phone or name
  if (!myRecord) {
    const { data: members } = await sb.from('members').select('*').eq('org_id', currentOrg.id);
    const allOrgMembers = members || [];
    // Phone match (normalised)
    const myPhone = (currentProfile?.phone || currentUser?.phone || '').replace(/[^0-9]/g,'');
    if (myPhone.length >= 9) {
      myRecord = allOrgMembers.find(m => m.phone?.replace(/[^0-9]/g,'') === myPhone);
    }
    // Name match (trimmed, lowercased)
    if (!myRecord && currentProfile?.full_name) {
      const myName = currentProfile.full_name.toLowerCase().trim();
      myRecord = allOrgMembers.find(m =>
        m.full_name?.toLowerCase().trim() === myName ||
        m.full_name?.toLowerCase().includes(myName.split(' ')[0]) // first name match
      );
    }
  }

  // 4. If still not found but admin is viewing their own record — try member_number or email
  if (!myRecord && currentUser?.email) {
    const { data: byPortal } = await sb.from('members')
      .select('*').eq('org_id', currentOrg.id)
      .ilike('portal_email', currentUser.email).maybeSingle();
    if (byPortal) myRecord = byPortal;
  }

  if (myRecord) {
    window._myMemberId = myRecord.id;
    document.getElementById('mp-number').textContent = '#' + (myRecord.member_number||'—');
  // Update the NOT LINKED badge to show member number instead
  const linkedBadge = document.querySelector('.card-header .badge-warn');
  if (linkedBadge && linkedBadge.textContent.includes('NOT LINKED')) {
    linkedBadge.textContent = 'MEMBER #' + (myRecord.member_number||'—');
    linkedBadge.style.background = 'var(--teal-pale)';
    linkedBadge.style.color = 'var(--teal-dk)';
    linkedBadge.style.border = '1px solid var(--teal-mid)';
  }
    document.getElementById('mp-status').innerHTML = `<span class="badge ${myRecord.status==='active'?'badge-green':myRecord.status==='arrears'?'badge-warn':'badge-grey'}">${myRecord.status}</span>`;
    document.getElementById('mp-savings-tier').textContent = 'Ksh ' + (myRecord.savings_tier||500).toLocaleString() + '/mo';
    // Hide savings/mo panel if org has no savings type
    const savingsTierPanel = document.getElementById('mp-savings-tier-panel');
    if (savingsTierPanel) savingsTierPanel.style.display = orgFinProfile.hasSavings ? '' : 'none';
    document.getElementById('mp-reg-status').innerHTML = myRecord.registration_paid ?
      '<span class="badge badge-green">Paid ✓</span>' : '<span class="badge badge-warn">Pending</span>';
    document.getElementById('mp-details').innerHTML = `
      <tr><td style="padding:.5rem 0;font-size:.78rem;color:var(--ink-faint);width:130px">Full Name</td><td style="font-size:.85rem;font-weight:600">${myRecord.full_name}</td></tr>
      <tr><td style="padding:.5rem 0;font-size:.78rem;color:var(--ink-faint)">Phone</td><td style="font-size:.85rem">${myRecord.phone||'—'}</td></tr>
      <tr><td style="padding:.5rem 0;font-size:.78rem;color:var(--ink-faint)">ID Number</td><td style="font-size:.85rem">${myRecord.id_number||'—'}</td></tr>
      <tr><td style="padding:.5rem 0;font-size:.78rem;color:var(--ink-faint)">Join Date</td><td style="font-size:.85rem">${myRecord.join_date||'—'}</td></tr>`;
    const sharesEl = document.getElementById('mp-shares-bal-display');
    const savingsEl = document.getElementById('mp-savings-bal-display');
    if (sharesEl) sharesEl.textContent = 'Ksh ' + (myRecord.shares_balance||0).toLocaleString();
    if (savingsEl) savingsEl.textContent = 'Ksh ' + (myRecord.savings_balance||0).toLocaleString();

    loadMemberPendingFines(myRecord.id);
    // Load MGR obligations notification on profile dashboard
    loadMGRNoticeCard(myRecord.id);
    // Load TB obligations notification on profile dashboard
    loadTBNoticeCard(myRecord.id);
    // Load contribution summary
    const summaryEl = document.getElementById('mp-contrib-summary');
    let totalContributed = 0;
    if (myRecord.id) {
      const { data: myTxns } = await sb.from('transactions')
        .select('amount,contribution_types(name,is_member_income)').eq('member_id', myRecord.id).eq('org_id', currentOrg.id);
      // Exclude fine-category transactions from member's contribution totals
      const nonFineTxns = (myTxns||[]).filter(t => (t.contribution_types?.name||'').toLowerCase() !== 'fine');
      totalContributed = nonFineTxns.reduce((s,t)=>s+Number(t.amount||0),0);
      const catTotals = {};
      nonFineTxns.forEach(t => {
        const cat = t.contribution_types?.name || 'Other';
        catTotals[cat] = (catTotals[cat]||0) + Number(t.amount||0);
      });
      const entries = Object.entries(catTotals);
      if (summaryEl) summaryEl.innerHTML = entries.length ?
        entries.map(([cat,total])=>`
          <div style="display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--border)">
            <span style="color:var(--ink-soft)">${cat}</span>
            <strong>Ksh ${total.toLocaleString()}</strong>
          </div>`).join('') :
        '<span style="color:var(--ink-faint)">No contributions recorded yet</span>';
    }

    // ── Dynamic balance cards ──
    // Ensure financial profile is loaded before rendering cards
    if (!orgFinProfile.allLoaded) await loadOrgFinancialProfile();
    renderMemberBalanceCards(myRecord, totalContributed);
    // ── Show withdrawal card if window is open ──
    updateWithdrawCard();
    // ── Populate mobile home elements ──
    if (window.innerWidth <= 768) populateMobileProfile(myRecord, orgFinProfile);
    // ── Set hero ──
    const initials = myRecord.full_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    const avatarEl = document.getElementById('mp-hero-avatar');
    if (avatarEl) avatarEl.textContent = initials;
    const nameEl = document.getElementById('mp-hero-name');
    if (nameEl) nameEl.textContent = myRecord.full_name;
    const numEl = document.getElementById('mp-number');
    if (numEl) numEl.textContent = 'Member #' + (myRecord.member_number||'—');
    // Hero chips
    const chipsEl = document.getElementById('mp-hero-chips');
    if (chipsEl) {
      const statusClass = myRecord.status==='active'?'teal':myRecord.status==='arrears'?'gold':'';
      chipsEl.innerHTML = `
        <div class="mp-hero-chip ${statusClass}">${myRecord.status==='active'?'✓ Active':myRecord.status==='arrears'?'⚠ Arrears':'Inactive'}</div>
        <div class="mp-hero-chip">#${myRecord.member_number||'—'}</div>
        ${myRecord.registration_paid?'<div class="mp-hero-chip teal">✓ Registered</div>':'<div class="mp-hero-chip gold">⚠ Unregistered</div>'}
      `;
    }
    // Details table — hide Savings/mo if org has no savings
    const fp = orgFinProfile;
    const joinDate = myRecord.join_date ? new Date(myRecord.join_date).toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'}) : '—';
    const savingsRow = fp.hasSavings
      ? `<tr><td style="padding:.45rem 0;font-size:.75rem;color:var(--ink-faint)">Savings/mo</td><td><strong style="color:var(--teal)">Ksh ${Number(myRecord.savings_tier||0).toLocaleString()}</strong></td></tr>`
      : '';
    document.getElementById('mp-details').innerHTML = `
      <tr><td style="padding:.45rem 0;font-size:.75rem;color:var(--ink-faint);width:110px">Full Name</td><td style="font-size:.85rem;font-weight:600">${myRecord.full_name}</td></tr>
      <tr><td style="padding:.45rem 0;font-size:.75rem;color:var(--ink-faint)">Phone</td><td style="font-size:.85rem">${myRecord.phone||'—'}</td></tr>
      <tr><td style="padding:.45rem 0;font-size:.75rem;color:var(--ink-faint)">ID Number</td><td style="font-size:.85rem">${myRecord.id_number||'—'}</td></tr>
      <tr><td style="padding:.45rem 0;font-size:.75rem;color:var(--ink-faint)">Joined</td><td style="font-size:.85rem">${joinDate}</td></tr>
      ${savingsRow}`;

  } else {
    window._myMemberId = null;
    const avatarEl = document.getElementById('mp-hero-avatar'); if(avatarEl) avatarEl.textContent = '?';
    const nameEl = document.getElementById('mp-hero-name'); if(nameEl) nameEl.textContent = currentProfile?.full_name || 'Member';
    const numEl = document.getElementById('mp-number'); if(numEl) numEl.textContent = 'Not linked';
    document.getElementById('mp-details').innerHTML = '<tr><td colspan="2" style="padding:1rem;color:var(--ink-faint);font-size:.82rem;line-height:1.7">Your account has not been linked to a member record yet.<br>Please contact your group admin.</td></tr>';
  }
}

async function loadMyContributions() {
  if (!currentOrg?.id || !currentProfile) return;

  // Always reload profile to get the right member for THIS org
  await loadMyProfile();
  let memberId = window._myMemberId;
  if (!memberId) {
    const role = currentProfile?.role;
    const isAdmin = ['admin','officer','treasurer','superadmin'].includes(role);
    document.getElementById('mc-table').innerHTML = `<tr><td colspan="5" style="padding:2rem;text-align:center">
      <div style="font-size:1.5rem;margin-bottom:.75rem">🔗</div>
      <div style="font-size:.9rem;font-weight:600;color:var(--ink);margin-bottom:.4rem">Member record not linked</div>
      <div style="font-size:.8rem;color:var(--ink-faint);line-height:1.7;margin-bottom:1rem">
        ${isAdmin
          ? 'As an admin, go to <strong>Members</strong> → find your record → Edit → set your Portal Email to <strong>' + (currentUser?.email||'your email') + '</strong>'
          : 'Your account is not linked to a member record yet. Contact your group admin.'}
      </div>
      ${isAdmin ? '<button class="btn btn-primary btn-sm" style="font-size:.78rem" onclick="autoLinkAdminMember()">Auto-link my record →</button>' : ''}
    </td></tr>`;

    // Clear all loading states
    ['mc-total','mc-year','mc-shares-bal','mc-savings-bal'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = 'Ksh 0';
    });
    const chartEl = document.getElementById('mc-chart');
    if (chartEl) chartEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.75rem;padding:.5rem">No data yet</div>';
    const catEl = document.getElementById('mc-by-category');
    if (catEl) catEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.8rem">No payments yet</div>';
    const infoEl = document.getElementById('mc-quick-info');
    if (infoEl) infoEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.8rem">—</div>';
    return;
  }

  loadMemberPendingFines(memberId);
  const [txnRes, adjRes, memRes] = await Promise.all([
    sb.from('transactions').select('*,contribution_types(name,is_member_income)')
      .eq('member_id', memberId).eq('org_id', currentOrg.id)
      .order('transaction_date',{ascending:false}),
    sb.from('balance_adjustments').select('*').eq('member_id', memberId)
      .order('created_at',{ascending:false}).then(r=>r).catch(()=>({data:[]})),
    sb.from('members').select('shares_balance,savings_balance,status,member_number,full_name,join_date')
      .eq('id', memberId).eq('org_id', currentOrg.id).maybeSingle()
  ]);
  const txns = txnRes.data || [];
  const adjs = adjRes.data || [];
  const mem = memRes.data;

  const thisYear = new Date().getFullYear().toString();
  const total = txns.reduce((s,t)=>s+Number(t.amount||0),0);
  const yearTotal = txns.filter(t=>(t.transaction_date||t.created_at||'').startsWith(thisYear)).reduce((s,t)=>s+Number(t.amount||0),0);

  // Stats
  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('mc-total', 'Ksh ' + total.toLocaleString());
  setEl('mc-year', 'Ksh ' + yearTotal.toLocaleString());
  const countLabel = document.getElementById('mc-count-label');
  if (countLabel) countLabel.textContent = txns.length + ' payments recorded';
  // Dynamic stat cards based on org type
  const fp2 = orgFinProfile;
  const mcSharesCard = document.getElementById('mc-shares-card');
  const mcSavingsCard = document.getElementById('mc-savings-card');
  const mcStatsRow = document.getElementById('mc-stats-row');

  if (fp2.hasShares) {
    if (mcSharesCard) mcSharesCard.style.display = '';
    const lbl = document.getElementById('mc-shares-label');
    if (lbl) lbl.textContent = fp2.sharesLabel || 'Shares Balance';
    setEl('mc-shares-bal', 'Ksh ' + Number(mem?.shares_balance||0).toLocaleString());
  } else {
    if (mcSharesCard) mcSharesCard.style.display = 'none';
  }

  if (fp2.hasSavings) {
    if (mcSavingsCard) mcSavingsCard.style.display = '';
    const lbl = document.getElementById('mc-savings-label');
    if (lbl) lbl.textContent = fp2.savingsLabel || 'Savings Balance';
    setEl('mc-savings-bal', 'Ksh ' + Number(mem?.savings_balance||0).toLocaleString());
  } else {
    if (mcSavingsCard) mcSavingsCard.style.display = 'none';
  }

  // Adjust grid columns based on visible cards
  if (mcStatsRow) {
    const visibleCards = 2 + (fp2.hasShares ? 1 : 0) + (fp2.hasSavings ? 1 : 0);
    mcStatsRow.style.gridTemplateColumns = `repeat(${visibleCards}, 1fr)`;
  }

  // Check for pending payment requests
  try {
    const { data: pendingReqs } = await sb.from('payment_requests')
      .select('amount,status,requested_at').eq('member_id', memberId).eq('status','pending');
    const pendingTotal = (pendingReqs||[]).reduce((s,r)=>s+Number(r.amount||0),0);
    const pendingEl = document.getElementById('mc-pending-notice');
    if (pendingEl) {
      pendingEl.style.display = pendingReqs?.length ? 'block' : 'none';
      pendingEl.innerHTML = pendingReqs?.length
        ? `<div style="background:rgba(196,154,48,.1);border:1px solid var(--gold);border-left:3px solid var(--gold);padding:.65rem 1rem;font-size:.8rem;color:var(--ink)">
            ⏳ You have <strong>${pendingReqs.length} payment${pendingReqs.length!==1?'s':''} pending approval</strong> (Ksh ${pendingTotal.toLocaleString()} total). Balances will update once your admin approves.
           </div>` : '';
    }
  } catch(e) {}

  // ── Mini bar chart: last 6 months ──
  const chartEl = document.getElementById('mc-chart');
  const labelsEl = document.getElementById('mc-chart-labels');
  if (chartEl) {
    const months = [];
    for (let i=5; i>=0; i--) {
      const d = new Date(); d.setMonth(d.getMonth()-i);
      months.push({ key: d.toISOString().slice(0,7), label: d.toLocaleString('default',{month:'short'}) });
    }
    const monthTotals = months.map(m => ({
      label: m.label,
      total: txns.filter(t=>(t.transaction_date||t.created_at||'').startsWith(m.key)).reduce((s,t)=>s+Number(t.amount||0),0)
    }));
    const maxVal = Math.max(...monthTotals.map(m=>m.total), 1);
    // If all zeros, show empty state instead of flat bars
    const hasAny = monthTotals.some(m=>m.total>0);
    if (!hasAny) {
      chartEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.78rem;padding:2rem;text-align:center;width:100%">No payments recorded yet</div>';
      if (labelsEl) labelsEl.innerHTML = '';
      return;
    }
    chartEl.innerHTML = monthTotals.map(m => {
      const h = Math.round((m.total/maxVal)*85);
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:.25rem">
        <div style="font-size:.6rem;color:var(--ink-faint)">${m.total>0?'Ksh '+m.total.toLocaleString():''}</div>
        <div style="width:100%;background:${m.total>0?'var(--maroon)':'var(--border)'};height:${h||3}px;border-radius:2px 2px 0 0;min-height:3px"></div>
      </div>`;
    }).join('');
    if (labelsEl) labelsEl.innerHTML = monthTotals.map(m=>`<div style="flex:1;text-align:center">${m.label}</div>`).join('');
  }

  // ── By category ──
  const catEl = document.getElementById('mc-by-category');
  if (catEl) {
    const cats = {};
    txns.forEach(t => { const c=t.contribution_types?.name||'Other'; cats[c]=(cats[c]||0)+Number(t.amount||0); });
    const entries = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    catEl.innerHTML = entries.length ? entries.map(([cat,amt])=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.4rem 0;border-bottom:1px solid var(--border)">
        <span style="font-size:.8rem;color:var(--ink-soft)">${cat}</span>
        <strong style="font-size:.82rem;color:var(--maroon)">Ksh ${amt.toLocaleString()}</strong>
      </div>`).join('') : '<div style="color:var(--ink-faint);font-size:.8rem;padding:.5rem 0">No payments yet</div>';
  }

  // ── Quick info ──
  const infoEl = document.getElementById('mc-quick-info');
  if (infoEl && mem) {
    const joinDate = mem.join_date ? new Date(mem.join_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
    const lastTxn = txns[0];
    const lastDate = lastTxn ? (lastTxn.transaction_date||lastTxn.created_at?.split('T')[0]) : null;
    infoEl.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:.6rem;font-size:.82rem">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-faint)">Member #</span><strong>#${mem.member_number||'—'}</strong></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-faint)">Status</span><span class="badge ${mem.status==='active'?'badge-green':mem.status==='arrears'?'badge-warn':'badge-grey'}">${mem.status||'—'}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-faint)">Joined</span><strong>${joinDate}</strong></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-faint)">Last Payment</span><strong>${lastDate||'None yet'}</strong></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--ink-faint)">Total Balance</span><strong style="color:var(--maroon)">Ksh ${(Number(mem.shares_balance||0)+Number(mem.savings_balance||0)).toLocaleString()}</strong></div>
      </div>`;
  }

  // ── Payment history timeline ──
  const timelineEl = document.getElementById('mc-timeline');
  const histSubEl = document.getElementById('mc-history-sub');
  if (histSubEl) histSubEl.textContent = txns.length + ' payment' + (txns.length!==1?'s':'') + ' recorded';

  // Combine transactions + adjustments, sorted by date desc
  const allEntries = [
    ...txns.map(t => ({
      date: t.transaction_date || t.created_at?.split('T')[0] || '',
      type: t.contribution_types?.name || 'Payment',
      amount: Number(t.amount||0),
      dir: 'credit',
      ref: t.mpesa_ref || '',
      notes: t.notes || '',
      created: t.created_at || t.transaction_date || ''
    })),
    ...adjs.map(a => ({
      date: a.created_at?.split('T')[0] || '',
      type: a.direction === 'credit' ? 'Credit Adjustment' : 'Debit Adjustment',
      amount: Number(a.amount||0),
      dir: a.direction || 'credit',
      ref: '',
      notes: a.reason || '',
      created: a.created_at || ''
    }))
  ].sort((a,b) => new Date(b.created) - new Date(a.created));

  if (!timelineEl) return;
  if (!allEntries.length) {
    timelineEl.innerHTML = `<div style="padding:3rem 1.25rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.75rem">₭</div>
      <div style="font-size:.9rem;font-weight:600;color:var(--ink);margin-bottom:.35rem">No payments recorded yet</div>
      <div style="font-size:.8rem;color:var(--ink-faint);margin-bottom:1rem">Your payment history will appear here once your admin records them.</div>
      <button class="btn btn-primary btn-sm" onclick="openMemberPaymentModal();showModal('memberPayment')" style="background:var(--maroon)">Make a Payment →</button>
    </div>`;
    return;
  }

  // Group by month
  const groups = {};
  allEntries.forEach(e => {
    const monthKey = e.date ? e.date.slice(0,7) : 'Unknown';
    const monthLabel = monthKey !== 'Unknown' ?
      new Date(monthKey + '-01').toLocaleString('en-KE',{month:'long',year:'numeric'}) : 'Unknown';
    if (!groups[monthKey]) groups[monthKey] = { label: monthLabel, entries: [] };
    groups[monthKey].entries.push(e);
  });

  timelineEl.innerHTML = Object.entries(groups).map(([key, group]) => {
    const monthTotal = group.entries.filter(e=>e.dir==='credit').reduce((s,e)=>s+e.amount,0);
    return `
    <div style="margin-bottom:1.25rem">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem 1.25rem;background:var(--surface);border-top:1px solid var(--border);border-bottom:1px solid var(--border)">
        <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-soft)">${group.label}</div>
        <div style="font-size:.75rem;font-weight:700;color:var(--maroon)">Ksh ${monthTotal.toLocaleString()}</div>
      </div>
      ${group.entries.map(e => {
        const isCredit = e.dir === 'credit';
        const initials = e.type.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
        const dateFormatted = e.date ? new Date(e.date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—';
        return `<div style="display:flex;align-items:center;gap:.85rem;padding:.85rem 1.25rem;border-bottom:1px solid var(--border);transition:background .1s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
          <div style="width:36px;height:36px;border-radius:50%;background:${isCredit?'var(--teal-pale,#e6f4ef)':'var(--warning-pale,#fff9e6)'};display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:700;color:${isCredit?'var(--teal)':'var(--warning)'};flex-shrink:0">${initials}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${e.type}</div>
            <div style="font-size:.7rem;color:var(--ink-faint);margin-top:.1rem">
              ${dateFormatted}${e.ref ? ' · <span style="font-family:monospace">'+e.ref+'</span>' : ''}${e.notes&&e.notes!=='—'?' · '+e.notes:''}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.9rem;font-weight:700;color:${isCredit?'var(--teal)':'var(--danger)'}">${isCredit?'+':'-'}Ksh ${e.amount.toLocaleString()}</div>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
  // ── Populate mobile finance page ──
  if (window.innerWidth <= 768) populateMobileContributions(txns, mem, orgFinProfile);
}


// ── SUBSCRIPTION LIMIT ENFORCEMENT ──
const PLAN_FEATURES={starter:{welfare:false,projects:false,table_banking:false},basic:{welfare:true,projects:true,table_banking:true},standard:{welfare:true,projects:true,table_banking:true},pro:{welfare:true,projects:true,table_banking:true}};
function planHas(f){if(currentProfile?.role==='superadmin')return true;const p=currentOrgRole==='superadmin'?'pro':(currentOrg?._effectivePlan||currentOrg?.plan||'starter');return !!(PLAN_FEATURES[p]?.[f]);}
function planRequired(f){for(const p of['starter','basic','standard','pro']){if(PLAN_FEATURES[p]?.[f])return p.charAt(0).toUpperCase()+p.slice(1);}return 'Pro';}
function showUpgradePrompt(page){
  const map={welfare:{label:'Welfare Management'},projects:{label:'Projects & Investments'},table_banking:{label:'Table Banking'}};
  const info=map[page]||{label:page};const req=planRequired(page);const cur=(currentOrg?._effectivePlan||currentOrg?.plan||'starter');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  let el=document.getElementById('page-upgrade-prompt');
  if(!el){el=document.createElement('div');el.id='page-upgrade-prompt';el.className='page';document.querySelector('.content')?.appendChild(el);}
  el.className='page active';
  el.innerHTML=`<div style="max-width:480px;margin:3rem auto;text-align:center;padding:0 1.25rem"><div style="width:72px;height:72px;border-radius:50%;background:var(--maroon-pale);display:flex;align-items:center;justify-content:center;margin:0 auto 1.1rem;font-size:2rem">🔒</div><div style="font-family:'Crimson Pro',serif;font-size:1.7rem;font-weight:700;color:var(--maroon);margin-bottom:.4rem">${info.label}</div><p style="font-size:.88rem;color:var(--ink-faint);line-height:1.75;margin-bottom:1.5rem">Not available on your <strong>${cur.charAt(0).toUpperCase()+cur.slice(1)}</strong> plan. Upgrade to <strong style="color:var(--teal)">${req}</strong> to unlock.</p><div style="display:flex;gap:.75rem;justify-content:center"><button class="btn btn-primary" onclick="showPage('billing')" style="background:var(--teal);padding:.72rem 1.5rem">💳 Upgrade Now →</button><button class="btn btn-secondary" onclick="showPage('dashboard')" style="padding:.72rem 1.25rem">← Dashboard</button></div><div style="margin-top:1rem;font-size:.72rem;color:var(--ink-faint)">Basic plan from Ksh 3,000/year · <a href="https://wa.me/254702903544" style="color:var(--teal)" target="_blank">WhatsApp us</a></div></div>`;
  document.getElementById('page-title').textContent='Upgrade Required';
}
async function checkSubscriptionAccess() {
  if (!currentOrg?.id || currentProfile?.role === 'superadmin') return true;
  try {
    const { data: org } = await sb.from('organisations')
      .select('subscription_status,subscription_expires,plan,name')
      .eq('id', currentOrg.id).single();
    if (!org) return true;

    // Remove any existing banner first
    document.getElementById('sub-warning-banner')?.remove();

    const expires = org.subscription_expires;
    const now = new Date();
    const expDate = expires ? new Date(expires) : null;
    const daysLeft = expDate ? Math.ceil((expDate - now)/(1000*60*60*24)) : null;
    const isExpired = expDate && expDate < now && org.plan !== 'starter';
    const isExpiringSoon = daysLeft !== null && daysLeft <= 14 && daysLeft > 0;

    if (isExpired) {
      // Admins see a banner; members see a full lock screen
      if (currentProfile?.role === 'member') {
        // Show lock overlay for members
        let lock = document.getElementById('sub-lock-overlay');
        if (!lock) {
          lock = document.createElement('div');
          lock.id = 'sub-lock-overlay';
          lock.style.cssText = 'position:fixed;inset:0;background:rgba(90,0,22,.97);z-index:9998;display:flex;align-items:center;justify-content:center;flex-direction:column;font-family:Inter,sans-serif;color:#fff;text-align:center;padding:2rem';
          lock.innerHTML = `
            <div style="font-size:3rem;margin-bottom:1rem">🔒</div>
            <div style="font-size:1.3rem;font-weight:700;margin-bottom:.5rem">${org.name}</div>
            <div style="font-size:.95rem;opacity:.85;margin-bottom:1.5rem">Your group's subscription expired on<br><strong>${expDate.toDateString()}</strong></div>
            <div style="font-size:.82rem;opacity:.7;max-width:340px;line-height:1.7">Please ask your group admin to renew the GroupYetu360 subscription to restore access.</div>
            <div style="margin-top:2rem;display:flex;gap:1rem;flex-wrap:wrap;justify-content:center">
              <a href="https://wa.me/254702903544" target="_blank" style="background:#25D366;color:#fff;padding:.6rem 1.25rem;border-radius:2rem;font-size:.82rem;font-weight:600;text-decoration:none">💬 WhatsApp Support</a>
              <a href="mailto:support@groupyetu.org" style="background:rgba(255,255,255,.15);color:#fff;padding:.6rem 1.25rem;border-radius:2rem;font-size:.82rem;font-weight:600;text-decoration:none">✉ Email Support</a>
            </div>`;
          document.body.appendChild(lock);
        }
      } else {
        // Admin gets a red banner
        const banner = document.createElement('div');
        banner.id = 'sub-warning-banner';
        banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:var(--danger);color:#fff;padding:.65rem 1.5rem;z-index:999;display:flex;align-items:center;justify-content:space-between;font-family:Inter,sans-serif';
        banner.innerHTML = `
          <div style="display:flex;align-items:center;gap:.75rem">
            <span style="font-size:1.1rem">🔒</span>
            <span style="font-size:.82rem;font-weight:600">Subscription expired on ${expDate.toDateString()}. Members have restricted access. Please renew.</span>
          </div>
          <button onclick="showPage('billing')" style="background:#fff;color:var(--danger);border:none;padding:.3rem .9rem;font-size:.75rem;font-weight:700;cursor:pointer;border-radius:2px">Renew Now →</button>`;
        document.body.prepend(banner);
        document.querySelector('.main').style.paddingTop = '42px';
      }
    } else if (isExpiringSoon) {
      const banner = document.createElement('div');
      banner.id = 'sub-warning-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:var(--warning);color:#fff;padding:.5rem 1.5rem;z-index:999;display:flex;align-items:center;justify-content:space-between;font-family:Inter,sans-serif';
      banner.innerHTML = `
        <span style="font-size:.78rem;font-weight:600">⚠ Subscription expires in ${daysLeft} days (${expDate.toDateString()}). Renew early to avoid interruption.</span>
        <button onclick="showPage('billing')" style="background:#fff;color:var(--warning);border:none;padding:.25rem .75rem;font-size:.72rem;font-weight:700;cursor:pointer">Renew →</button>`;
      document.body.prepend(banner);
      document.querySelector('.main').style.paddingTop = '36px';
    }
  } catch(e) { console.log('Subscription check skipped'); }
  return true;
}

// trackSmsUsage() is defined in utils.js — do not duplicate here.

// ── MEMBER PAYMENT FUNCTIONS ──

/* ═══════════════════════════════════
   SMART PAYMENT SPLIT
═══════════════════════════════════ */
let _mpContribTypes = [];
let _mpMemberStatus = null;
let _mpInstantCalc = null;
let _mpPendingDotsInterval = null;
let _mpRealtimeChannel = null;
let _mpPollInterval = null;

async function openMemberPaymentModal() {
  const dateEl = document.getElementById('mp-pay-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  document.getElementById('mp-grand-total').textContent = 'Ksh 0';
  document.getElementById('mp-mpesa-ref').value = '';
  document.getElementById('mp-total-amount').value = '';
  const splitSection = document.getElementById('mp-split-section');
  if (splitSection) splitSection.style.display = 'none';

  // Payment details
  renderPaymentMethods(currentOrg, 'mp-payment-details-box', false);
  const paybillEl = document.getElementById('mp-modal-paybill');
  if (paybillEl) {
    const methods = currentOrg?.payment_methods || {};
    const num = methods.paybill_number || currentOrg?.paybill;
    paybillEl.textContent = num ? 'Send to Paybill ' + num : '';
  }

  const memberId = window._myMemberId;

  // Load member status & suggested amounts
  let myRecord = null;
  if (memberId) {
    const { data: m } = await sb.from('members')
      .select('status,savings_tier,shares_balance,savings_balance,registration_paid,registration_renewal,full_name')
      .eq('id', memberId).maybeSingle();
    myRecord = m;
    _mpMemberStatus = m;
  }

  // Status alert
  const alertEl = document.getElementById('mp-status-alert');
  if (alertEl && myRecord) {
    if (myRecord.status === 'arrears') {
      alertEl.style.display = 'block';
      alertEl.innerHTML = '<div style="background:rgba(160,96,16,.1);border:1px solid var(--gold);border-left:3px solid var(--gold);padding:.65rem 1rem;font-size:.78rem;color:var(--ink)">⚠ Your account is in <strong>arrears</strong>. Please make a payment to bring your contributions up to date.</div>';
    } else {
      alertEl.style.display = 'none';
    }
  }

  // Load contribution types
  const { data: types } = await sb.from('contribution_types')
    .select('*').eq('org_id', currentOrg.id).order('name');
  _mpContribTypes = (types||[]).filter(t =>
    !t.name.toLowerCase().includes('registration') &&
    !t.name.toLowerCase().includes('welfare')
  );

  // Suggested amount label
  const sugLabel = document.getElementById('mp-suggested-label');
  const savingsTier = myRecord?.savings_tier || 0;
  const suggested = _mpContribTypes.reduce((s,t) => s + (t.is_variable ? 0 : Number(t.amount||0)), 0) + savingsTier;
  if (sugLabel) {
    sugLabel.textContent = suggested > 0
      ? `Suggested: Ksh ${suggested.toLocaleString()} (based on your contribution schedule)`
      : 'Enter the amount you have paid';
  }

  // Load active welfare events
  const { data: welfareEvents } = await sb.from('welfare_events')
    .select('*').eq('org_id', currentOrg.id).eq('is_active', true).limit(5);
  const welfareSection = document.getElementById('mp-option-welfare');
  const welfareList = document.getElementById('mp-welfare-list');
  if (welfareSection && welfareList) {
    if (welfareEvents?.length) {
      welfareSection.style.display = 'block';
      welfareList.innerHTML = welfareEvents.map(e => `
        <div style="display:flex;align-items:center;gap:.65rem;padding:.5rem .65rem;background:var(--surface-2);border:1px solid var(--border);border-radius:4px">
          <input type="checkbox" class="mp-welfare-check" data-event-id="${e.id}" data-event-name="${(e.event_type||'Welfare').replace(/"/g,'')}"
            style="width:15px;height:15px;accent-color:var(--maroon);flex-shrink:0"
            onchange="updateWelfareAmount(this)"/>
          <div style="flex:1">
            <div style="font-size:.8rem;font-weight:600">${e.event_type||'Welfare Event'}</div>
            ${e.notes ? `<div style="font-size:.7rem;color:var(--ink-soft);margin-top:.15rem">${e.notes}</div>` : ''}
            <div style="font-size:.67rem;color:var(--ink-faint);margin-top:.1rem">Suggested: Ksh ${Number(e.contribution_per_member||0).toLocaleString()} per member</div>
          </div>
          <input type="number" class="form-input mp-item-input" id="mp-welfare-amt-${e.id}"
            style="width:100px;padding:.3rem .5rem;font-size:.8rem;display:none"
            value="${e.contribution_per_member||0}" oninput="updateMpTotal()"/>
        </div>`).join('');
    } else {
      welfareSection.style.display = 'none';
    }
  }

  // Load MGR obligations
  if (memberId) await loadMemberMGRObligations(memberId, 'mp-option-mgr', 'mp-mgr-list');

  // Load Table Banking obligations
  if (memberId) await loadMemberTBObligations(memberId);

  // ── Instant Pay (Paystack subaccount) setup ──
  resetInstantPayState();
  const tabsEl = document.getElementById('mp-mode-tabs');
  const hasSubaccount = !!currentOrg?.paystack_subaccount_code;
  if (tabsEl) tabsEl.style.display = hasSubaccount ? 'flex' : 'none';
  // Orgs without a subaccount configured see exactly today's manual flow — no change.
  switchPaymentMode(hasSubaccount ? 'instant' : 'manual');

  const phoneEl = document.getElementById('mp-instant-phone');
  if (phoneEl) phoneEl.value = myRecord?.phone || currentProfile?.phone || '';
  const amtEl = document.getElementById('mp-instant-amount');
  if (amtEl) amtEl.value = '';
  document.getElementById('mp-fee-breakdown').style.display = 'none';
  document.getElementById('mp-cap-warning').style.display = 'none';
}

function switchPaymentMode(mode) {
  const instantSection = document.getElementById('mp-instant-section');
  const manualSection = document.getElementById('mp-manual-section');
  const manualBtn = document.getElementById('mp-manual-confirm-btn');
  const tabInstant = document.getElementById('mp-tab-instant');
  const tabManual = document.getElementById('mp-tab-manual');
  if (mode === 'instant') {
    if (instantSection) instantSection.style.display = 'block';
    if (manualSection) manualSection.style.display = 'none';
    if (manualBtn) manualBtn.style.display = 'none';
    if (tabInstant) tabInstant.classList.add('active');
    if (tabManual) tabManual.classList.remove('active');
  } else {
    if (instantSection) instantSection.style.display = 'none';
    if (manualSection) manualSection.style.display = 'block';
    if (manualBtn) manualBtn.style.display = '';
    if (tabInstant) tabInstant.classList.remove('active');
    if (tabManual) tabManual.classList.add('active');
  }
}

async function recalcInstantFee() {
  const amtEl = document.getElementById('mp-instant-amount');
  const breakdownEl = document.getElementById('mp-fee-breakdown');
  const capWarningEl = document.getElementById('mp-cap-warning');
  const net = parseFloat(amtEl?.value);
  if (!net || net <= 0) {
    if (breakdownEl) breakdownEl.style.display = 'none';
    if (capWarningEl) capWarningEl.style.display = 'none';
    return;
  }
  const { platformFeePercent, paystackFeePercent } = await getPlatformFeeRates();
  const calc = calculateGrossCharge(net, platformFeePercent, paystackFeePercent);
  _mpInstantCalc = calc; // cache for payInstantContribution()

  document.getElementById('mp-fee-net').textContent = 'Ksh ' + net.toLocaleString();
  document.getElementById('mp-fee-amount').textContent = 'Ksh ' + calc.fee.toLocaleString();
  document.getElementById('mp-fee-gross').textContent = 'Ksh ' + calc.gross.toLocaleString();
  if (breakdownEl) breakdownEl.style.display = 'block';

  const cap = currentOrg?.max_contribution_amount;
  const payBtn = document.getElementById('mp-instant-pay-btn');
  if (cap && net > cap) {
    if (capWarningEl) {
      capWarningEl.style.display = 'block';
      capWarningEl.textContent = `⚠ Maximum contribution right now is Ksh ${Number(cap).toLocaleString()} — contact your group admin for larger amounts.`;
    }
    if (payBtn) payBtn.disabled = true;
  } else {
    if (capWarningEl) capWarningEl.style.display = 'none';
    if (payBtn) payBtn.disabled = false;
  }
}

function resetInstantPayState() {
  ['mp-state-pending','mp-state-success','mp-state-fail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show');
  });
  const payBtn = document.getElementById('mp-instant-pay-btn');
  if (payBtn) { payBtn.style.display = ''; payBtn.disabled = false; }
  const amtEl = document.getElementById('mp-instant-amount');
  const phoneEl = document.getElementById('mp-instant-phone');
  if (amtEl) amtEl.disabled = false;
  if (phoneEl) phoneEl.disabled = false;
  if (_mpPendingDotsInterval) { clearInterval(_mpPendingDotsInterval); _mpPendingDotsInterval = null; }
  if (_mpRealtimeChannel) { try { sb.removeChannel(_mpRealtimeChannel); } catch(e){} _mpRealtimeChannel = null; }
  if (_mpPollInterval) { clearInterval(_mpPollInterval); _mpPollInterval = null; }
}

function showInstantState(state) {
  ['mp-state-pending','mp-state-success','mp-state-fail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('show', id === 'mp-state-' + state);
  });
}

async function payInstantContribution() {
  const amtEl = document.getElementById('mp-instant-amount');
  const phoneEl = document.getElementById('mp-instant-phone');
  const payBtn = document.getElementById('mp-instant-pay-btn');
  const net = parseFloat(amtEl?.value);
  const phone = phoneEl?.value?.trim();

  if (!net || net <= 0) { toast('Enter a contribution amount'); return; }
  if (!phone || phone.replace(/[^0-9]/g,'').length < 9) { toast('Enter a valid M-Pesa number'); return; }
  const cap = currentOrg?.max_contribution_amount;
  if (cap && net > cap) { toast(`Maximum contribution right now is Ksh ${Number(cap).toLocaleString()}`); return; }
  if (!currentOrg?.paystack_subaccount_code) { toast('Payments are not yet set up for this group'); return; }

  let calc = _mpInstantCalc;
  if (!calc || calc.netAmount !== net) {
    const { platformFeePercent, paystackFeePercent } = await getPlatformFeeRates();
    calc = calculateGrossCharge(net, platformFeePercent, paystackFeePercent);
  }

  if (payBtn) { payBtn.disabled = true; }
  amtEl.disabled = true; phoneEl.disabled = true;
  showInstantState('pending');

  // Animate "Check your phone..." dots
  let dotCount = 0;
  _mpPendingDotsInterval = setInterval(() => {
    dotCount = (dotCount + 1) % 4;
    const dotsEl = document.getElementById('mp-pending-dots');
    if (dotsEl) dotsEl.textContent = '.'.repeat(dotCount + 1);
  }, 500);

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch('https://eengldzvvgplgzvbutal.supabase.co/functions/v1/paystack-charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({
        org_id: currentOrg.id,
        amount: calc.gross,
        phone,
        email: currentUser.email,
        payment_type: 'member_contribution',
        notes: `Member contribution — Ksh ${net.toLocaleString()} net`,
        member_id: window._myMemberId,
        subaccount: currentOrg.paystack_subaccount_code,
        transaction_charge: calc.transactionCharge,
        bearer: 'account'
      })
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || 'Payment could not be started');

    logActivity('MEMBER CONTRIBUTION (INSTANT) INITIATED', `Ksh ${net} net (charged Ksh ${calc.gross}) · phone ${phone}`, 'member', window._myMemberId);
    listenForContributionConfirmation(result.payment_request_id, net);

  } catch(e) {
    clearInterval(_mpPendingDotsInterval); _mpPendingDotsInterval = null;
    document.getElementById('mp-fail-detail').textContent = e.message || 'Could not start the payment. Please try again.';
    showInstantState('fail');
    if (payBtn) payBtn.disabled = false;
    amtEl.disabled = false; phoneEl.disabled = false;
  }
}

// Instant confirmation via Supabase Realtime — falls back to short-interval
// polling if the realtime subscription doesn't confirm within a few seconds,
// so a flaky websocket never leaves the member staring at a dead spinner.
function listenForContributionConfirmation(paymentRequestId, netAmount) {
  let resolved = false;

  const onResult = (status) => {
    if (resolved) return;
    resolved = true;
    clearInterval(_mpPendingDotsInterval); _mpPendingDotsInterval = null;
    if (_mpRealtimeChannel) { try { sb.removeChannel(_mpRealtimeChannel); } catch(e){} _mpRealtimeChannel = null; }
    if (_mpPollInterval) { clearInterval(_mpPollInterval); _mpPollInterval = null; }

    if (status === 'approved') {
      document.getElementById('mp-success-detail').textContent = `Ksh ${netAmount.toLocaleString()} recorded to ${currentOrg?.name || 'your group'}.`;
      showInstantState('success');
      setTimeout(() => { closeModal('memberPayment'); if (typeof loadMemberDashboard === 'function') loadMemberDashboard(); }, 1800);
    } else {
      document.getElementById('mp-fail-detail').textContent = status === 'timeout'
        ? 'This is taking longer than expected — check Payment History before retrying.'
        : 'The prompt was cancelled or declined.';
      showInstantState('fail');
      document.getElementById('mp-instant-pay-btn').style.display = '';
      document.getElementById('mp-instant-amount').disabled = false;
      document.getElementById('mp-instant-phone').disabled = false;
    }
  };

  // Realtime subscription — instant confirmation the moment the webhook writes it
  try {
    _mpRealtimeChannel = sb.channel(`payment_request_${paymentRequestId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'payment_requests',
        filter: `id=eq.${paymentRequestId}`
      }, (payload) => {
        const status = payload.new?.status;
        if (status === 'approved') onResult('approved');
        else if (status === 'failed' || status === 'declined') onResult('failed');
      })
      .subscribe();
  } catch(e) {
    console.warn('Realtime subscription failed, falling back to polling —', e.message);
  }

  // Fallback poll every 4s in case the realtime channel misses the update —
  // belt-and-braces so "stuck on pending forever" can't happen from a dropped
  // websocket alone. Times out at 3 minutes, same as the platform billing flow.
  let polls = 0;
  _mpPollInterval = setInterval(async () => {
    if (resolved) { clearInterval(_mpPollInterval); return; }
    polls++;
    if (polls > 45) { onResult('timeout'); return; }
    try {
      const { data: pr } = await sb.from('payment_requests').select('status').eq('id', paymentRequestId).maybeSingle();
      if (pr?.status === 'approved') onResult('approved');
      else if (pr?.status === 'failed' || pr?.status === 'declined') onResult('failed');
    } catch(e) {}
  }, 4000);
}

// ── MGR OBLIGATIONS — shown on My Profile dashboard and in Make Payment modal ──
async function loadMGRNoticeCard(memberId) {
  const noticeEl = document.getElementById('mp-mgr-notice');
  if (!noticeEl || !memberId || !currentOrg?.id) return;
  noticeEl.style.display = 'none';
  try {
    const { data: cycles } = await sb.from('savings_rounds')
      .select('*').eq('org_id', currentOrg.id).eq('status', 'active');
    if (!cycles?.length) return;
    const myCycles = cycles.filter(c => Array.isArray(c.pool_members) && c.pool_members.includes(memberId));
    if (!myCycles.length) return;

    const items = [];
    for (const cycle of myCycles) {
      const { data: slots } = await sb.from('round_slots')
        .select('*,members!round_slots_member_id_fkey(full_name)')
        .eq('round_id', cycle.id).eq('received', false).order('slot_number').limit(1);
      const slot = slots?.[0];
      if (!slot) continue;
      const { data: paid } = await sb.from('round_contributions')
        .select('id').eq('slot_id', slot.id).eq('contributor_member_id', memberId).eq('status','paid').maybeSingle();
      const isReceiver = slot.member_id === memberId;
      const daysUntil = slot.scheduled_date ? Math.ceil((new Date(slot.scheduled_date) - new Date()) / 86400000) : null;
      items.push({ cycle, slot, paid: !!paid, isReceiver, daysUntil });
    }
    if (!items.length) return;

    const unpaid = items.filter(i => !i.paid && !i.isReceiver);
    const receiving = items.filter(i => i.isReceiver);
    const overdue = unpaid.filter(i => i.daysUntil !== null && i.daysUntil < 0);

    if (!unpaid.length && !receiving.length) return;

    noticeEl.style.display = 'block';
    const parts = [];
    if (receiving.length) {
      parts.push(`<div style="display:flex;align-items:center;gap:.75rem;padding:.7rem 1rem;background:linear-gradient(135deg,rgba(15,110,86,.08),var(--surface));border:1px solid var(--teal);border-radius:8px;margin-bottom:.5rem">
        <span style="font-size:1.5rem">🎉</span>
        <div>
          <div style="font-size:.88rem;font-weight:700;color:var(--teal-dk)">You receive the pot this round!</div>
          <div style="font-size:.75rem;color:var(--ink-soft)">${h(receiving[0].cycle.name)} · Round ${receiving[0].slot.slot_number} · ${receiving[0].slot.scheduled_date ? new Date(receiving[0].slot.scheduled_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : ''}</div>
        </div>
      </div>`);
    }
    if (unpaid.length) {
      const borderCol = overdue.length ? 'var(--danger)' : 'var(--gold)';
      const icon = overdue.length ? '⚠' : '🔄';
      const title = overdue.length
        ? `${overdue.length} MGR payment${overdue.length > 1 ? 's' : ''} overdue`
        : `${unpaid.length} MGR payment${unpaid.length > 1 ? 's' : ''} pending`;
      const totalOwed = unpaid.reduce((s,i) => s + Number(i.cycle.amount_per_member||0), 0);
      parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.7rem 1rem;background:var(--surface);border:1px solid ${borderCol};border-left:3px solid ${borderCol};border-radius:8px">
        <div style="display:flex;align-items:center;gap:.65rem">
          <span style="font-size:1.3rem">${icon}</span>
          <div>
            <div style="font-size:.85rem;font-weight:700;color:var(--ink)">${title}</div>
            <div style="font-size:.72rem;color:var(--ink-faint)">${unpaid.map(i => h(i.cycle.name)).join(' · ')}</div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.9rem;font-weight:700;color:var(--maroon)">Ksh ${totalOwed.toLocaleString()}</div>
          <button class="btn btn-primary btn-sm" onclick="openMemberPaymentModal();showModal('memberPayment')" style="background:var(--teal);font-size:.65rem;margin-top:.3rem;padding:.25rem .6rem">Pay Now →</button>
        </div>
      </div>`);
    }
    noticeEl.innerHTML = parts.join('');
  } catch(e) { console.log('[GY360] MGR notice skipped:', e.message); }
}

async function loadMemberMGRObligations(memberId, sectionId, listId) {
  const section = document.getElementById(sectionId);
  const list = document.getElementById(listId);
  if (!section || !list || !memberId || !currentOrg?.id) return;

  try {
    // Get all active cycles for this org
    const { data: cycles } = await sb.from('savings_rounds')
      .select('*')
      .eq('org_id', currentOrg.id)
      .eq('status', 'active');

    if (!cycles?.length) { section.style.display = 'none'; return; }

    // Filter to cycles this member participates in
    const myCycles = cycles.filter(c =>
      Array.isArray(c.pool_members) && c.pool_members.includes(memberId)
    );
    if (!myCycles.length) { section.style.display = 'none'; return; }

    const obligations = [];

    for (const cycle of myCycles) {
      // Get the current active slot (first unreceived)
      const { data: slots } = await sb.from('round_slots')
        .select('*,members!round_slots_member_id_fkey(full_name)')
        .eq('round_id', cycle.id)
        .eq('received', false)
        .order('slot_number')
        .limit(1);

      const currentSlot = slots?.[0];
      if (!currentSlot) continue; // cycle complete

      // Check if this member has already paid for this slot
      const { data: myContrib } = await sb.from('round_contributions')
        .select('id,status')
        .eq('slot_id', currentSlot.id)
        .eq('contributor_member_id', memberId)
        .eq('status', 'paid')
        .maybeSingle();

      const alreadyPaid = !!myContrib;
      const isReceiver = currentSlot.member_id === memberId;
      const receiverName = currentSlot.members?.full_name || 'a member';
      const dueDate = currentSlot.scheduled_date
        ? new Date(currentSlot.scheduled_date).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})
        : '—';
      const daysUntil = currentSlot.scheduled_date
        ? Math.ceil((new Date(currentSlot.scheduled_date) - new Date()) / 86400000)
        : null;
      const isOverdue = daysUntil !== null && daysUntil < 0;
      const isDueSoon = daysUntil !== null && daysUntil >= 0 && daysUntil <= 7;

      obligations.push({ cycle, currentSlot, alreadyPaid, isReceiver, receiverName, dueDate, daysUntil, isOverdue, isDueSoon });
    }

    if (!obligations.length) { section.style.display = 'none'; return; }

    section.style.display = 'block';
    list.innerHTML = obligations.map(o => {
      if (o.isReceiver) {
        // This member is the current receiver — show that they're due to receive
        const { data: paidCount } = { data: null }; // simplified — show receiver info
        return `<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;background:linear-gradient(135deg,rgba(15,110,86,.08),var(--surface));border:1px solid var(--teal-mid,#0f6e56);border-left:3px solid var(--teal);border-radius:6px">
          <div style="font-size:1.4rem">🎉</div>
          <div style="flex:1">
            <div style="font-size:.85rem;font-weight:700;color:var(--teal-dk)">You are the current receiver!</div>
            <div style="font-size:.75rem;color:var(--ink-soft);margin-top:.15rem">${o.cycle.name} · Round ${o.currentSlot.slot_number} · Due ${o.dueDate}</div>
            <div style="font-size:.72rem;color:var(--ink-faint);margin-top:.1rem">Other members will pay Ksh ${Number(o.cycle.amount_per_member||0).toLocaleString()} each directly to you${o.cycle.collection_method === 'group_account' ? ' via the group account' : o.cycle.collection_method === 'treasurer' ? ' via the treasurer' : ' to you directly'}.</div>
          </div>
        </div>`;
      }

      if (o.alreadyPaid) {
        return `<div style="display:flex;align-items:center;gap:.75rem;padding:.55rem .85rem;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;opacity:.75">
          <div style="font-size:1.2rem">✅</div>
          <div style="flex:1">
            <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${o.cycle.name} — Round ${o.currentSlot.slot_number}</div>
            <div style="font-size:.72rem;color:var(--teal-dk);margin-top:.1rem">✓ You have paid for this round. Receiver: ${h(o.receiverName)}</div>
          </div>
          <span class="badge badge-green" style="font-size:.62rem;flex-shrink:0">Paid</span>
        </div>`;
      }

      const urgencyColor = o.isOverdue ? 'var(--danger)' : o.isDueSoon ? 'var(--warning)' : 'var(--ink-faint)';
      const urgencyBorder = o.isOverdue ? 'var(--danger)' : o.isDueSoon ? 'var(--gold)' : 'var(--border)';
      const urgencyLabel = o.isOverdue ? `⚠ Overdue by ${Math.abs(o.daysUntil)} days`
        : o.isDueSoon ? `Due in ${o.daysUntil} day${o.daysUntil !== 1 ? 's' : ''}`
        : o.daysUntil !== null ? `Due in ${o.daysUntil} days` : '';

      return `<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;background:var(--surface);border:1px solid ${urgencyBorder};border-left:3px solid ${urgencyBorder};border-radius:6px">
        <div style="font-size:1.4rem">🔄</div>
        <div style="flex:1">
          <div style="font-size:.85rem;font-weight:700;color:var(--ink)">${h(o.cycle.name)} — Round ${o.currentSlot.slot_number}</div>
          <div style="font-size:.75rem;color:var(--ink-soft);margin-top:.15rem">Pay Ksh ${Number(o.cycle.amount_per_member||0).toLocaleString()} · Receiver: ${h(o.receiverName)}</div>
          ${urgencyLabel ? `<div style="font-size:.7rem;font-weight:600;color:${urgencyColor};margin-top:.2rem">${urgencyLabel}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.85rem;font-weight:700;color:var(--maroon)">Ksh ${Number(o.cycle.amount_per_member||0).toLocaleString()}</div>
          <div style="font-size:.65rem;color:var(--ink-faint)">${o.dueDate}</div>
        </div>
      </div>`;
    }).join('');

  } catch(e) {
    console.log('[GY360] MGR obligations load skipped:', e.message);
    if (section) section.style.display = 'none';
  }
}

// ── TABLE BANKING OBLIGATIONS — shown on My Profile and in Make Payment modal ──
async function loadTBNoticeCard(memberId) {
  const noticeEl = document.getElementById('mp-tb-notice');
  if (!noticeEl || !memberId || !currentOrg?.id) return;
  noticeEl.style.display = 'none';
  try {
    // Get active TB pools this member belongs to
    const { data: pools } = await sb.from('table_banking_pools')
      .select('id,name,status,pool_members,interest_rate')
      .eq('org_id', currentOrg.id)
      .eq('status', 'active');
    if (!pools?.length) return;

    const myPools = pools.filter(p => Array.isArray(p.pool_members) && p.pool_members.includes(memberId));
    if (!myPools.length) return;

    // Check for active loans belonging to this member
    const poolIds = myPools.map(p => p.id);
    const { data: myLoans } = await sb.from('table_banking_loans')
      .select('id,principal,total_repaid,due_date,pool_id,status,table_banking_pools(name)')
      .in('pool_id', poolIds)
      .eq('member_id', memberId)
      .eq('status', 'active');

    if (!myLoans?.length && myPools.length === 0) return;

    noticeEl.style.display = 'block';
    const parts = [];

    // Active loans notice
    if (myLoans?.length) {
      const overdue = myLoans.filter(l => l.due_date && new Date(l.due_date) < new Date());
      const totalOutstanding = myLoans.reduce((s,l) => s + (Number(l.principal||0) - Number(l.total_repaid||0)), 0);
      const borderCol = overdue.length ? 'var(--danger)' : 'var(--gold)';
      const icon = overdue.length ? '⚠' : '💰';
      const title = overdue.length
        ? `${overdue.length} overdue loan${overdue.length>1?'s':''}`
        : `${myLoans.length} active loan${myLoans.length>1?'s':''}`;
      parts.push(`<div style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.7rem 1rem;background:var(--surface);border:1px solid ${borderCol};border-left:3px solid ${borderCol};border-radius:8px">
        <div style="display:flex;align-items:center;gap:.65rem">
          <span style="font-size:1.3rem">${icon}</span>
          <div>
            <div style="font-size:.85rem;font-weight:700;color:var(--ink)">Table Banking — ${title}</div>
            <div style="font-size:.72rem;color:var(--ink-faint)">${myLoans.map(l=>h(l.table_banking_pools?.name||'Pool')).join(' · ')}</div>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:.9rem;font-weight:700;color:var(--maroon)">Ksh ${totalOutstanding.toLocaleString()}</div>
          <div style="font-size:.65rem;color:var(--ink-faint)">outstanding</div>
        </div>
      </div>`);
    }

    // Pool membership notice (no loan)
    const poolsWithoutLoan = myPools.filter(p => !myLoans?.find(l => l.pool_id === p.id));
    if (poolsWithoutLoan.length) {
      parts.push(`<div style="display:flex;align-items:center;gap:.75rem;padding:.6rem 1rem;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;margin-top:.4rem">
        <span style="font-size:1.1rem">🏦</span>
        <div style="font-size:.78rem;color:var(--ink-soft)">Member of ${poolsWithoutLoan.map(p=>h(p.name)).join(', ')} · ${poolsWithoutLoan[0]?.interest_rate||10}% interest on loans</div>
      </div>`);
    }

    noticeEl.innerHTML = parts.join('');
  } catch(e) { console.log('[GY360] TB notice skipped:', e.message); }
}

async function loadMemberTBObligations(memberId) {
  const section = document.getElementById('mp-option-tb');
  const list = document.getElementById('mp-tb-list');
  if (!section || !list || !memberId || !currentOrg?.id) return;
  section.style.display = 'none';
  try {
    const { data: pools } = await sb.from('table_banking_pools')
      .select('id,name,status,pool_members,interest_rate,max_loan_per_member')
      .eq('org_id', currentOrg.id)
      .eq('status', 'active');
    if (!pools?.length) return;

    const myPools = pools.filter(p => Array.isArray(p.pool_members) && p.pool_members.includes(memberId));
    if (!myPools.length) return;

    const poolIds = myPools.map(p => p.id);
    const { data: myLoans } = await sb.from('table_banking_loans')
      .select('id,principal,total_repaid,due_date,interest_rate,table_banking_pools(name)')
      .in('pool_id', poolIds)
      .eq('member_id', memberId)
      .eq('status', 'active');

    section.style.display = 'block';
    list.innerHTML = myPools.map(pool => {
      const loan = myLoans?.find(l => l.table_banking_pools?.name === pool.name || poolIds.includes(pool.id));
      const outstanding = loan ? Number(loan.principal||0) - Number(loan.total_repaid||0) : 0;
      const overdue = loan?.due_date && new Date(loan.due_date) < new Date();
      const maxLoan = pool.max_loan_per_member ? `Max loan: Ksh ${Number(pool.max_loan_per_member).toLocaleString()}` : 'No loan limit';

      if (loan) {
        const borderCol = overdue ? 'var(--danger)' : 'var(--gold)';
        return `<div style="display:flex;align-items:center;gap:.75rem;padding:.65rem .85rem;background:var(--surface);border:1px solid ${borderCol};border-left:3px solid ${borderCol};border-radius:6px">
          <div style="font-size:1.3rem">${overdue ? '⚠' : '💰'}</div>
          <div style="flex:1">
            <div style="font-size:.85rem;font-weight:700;color:var(--ink)">${h(pool.name)}</div>
            <div style="font-size:.75rem;color:var(--ink-soft)">Active loan · ${loan.interest_rate||10}% interest/month · Due: ${loan.due_date||'—'}</div>
            ${overdue ? `<div style="font-size:.7rem;font-weight:600;color:var(--danger)">⚠ Overdue</div>` : ''}
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:.85rem;font-weight:700;color:var(--maroon)">Ksh ${outstanding.toLocaleString()}</div>
            <div style="font-size:.65rem;color:var(--ink-faint)">outstanding</div>
          </div>
        </div>`;
      }

      // Member with no loan — show pool info
      return `<div style="display:flex;align-items:center;gap:.75rem;padding:.6rem .85rem;background:var(--surface-2);border:1px solid var(--border);border-radius:6px">
        <div style="font-size:1.2rem">🏦</div>
        <div style="flex:1">
          <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${h(pool.name)}</div>
          <div style="font-size:.72rem;color:var(--ink-faint)">${maxLoan} · ${pool.interest_rate||10}% interest/month</div>
        </div>
        <span class="badge badge-green" style="font-size:.62rem;flex-shrink:0">No active loan</span>
      </div>`;
    }).join('');
  } catch(e) {
    if (section) section.style.display = 'none';
    console.log('[GY360] TB obligations skipped:', e.message);
  }
}

function autoFillSuggestedAmount() {
  const savingsTier = _mpMemberStatus?.savings_tier || 0;
  const suggested = _mpContribTypes.reduce((s,t) => s + (t.is_variable ? 0 : Number(t.amount||0)), 0) + savingsTier;
  if (suggested > 0) {
    document.getElementById('mp-total-amount').value = suggested;
    smartSplitPayment(suggested);
  }
}

function smartSplitPayment(totalStr) {
  const total = parseFloat(totalStr) || 0;
  document.getElementById('mp-grand-total').textContent = 'Ksh ' + total.toLocaleString();

  const splitSection = document.getElementById('mp-split-section');
  const splitList = document.getElementById('mp-split-list');
  if (!splitSection || !splitList) return;

  if (total <= 0 || !_mpContribTypes.length) {
    splitSection.style.display = 'none';
    return;
  }
  splitSection.style.display = 'block';

  // Auto-split: fill fixed types first, put remainder into first variable or savings
  let remaining = total;
  const splits = [];

  // Fixed types first
  _mpContribTypes.filter(t => !t.is_variable && t.amount).forEach(t => {
    const amt = Math.min(Number(t.amount), remaining);
    splits.push({ typeId: t.id, typeName: t.name, suggested: Number(t.amount), value: amt });
    remaining -= amt;
  });

  // Variable types / savings tier
  _mpContribTypes.filter(t => t.is_variable || !t.amount).forEach(t => {
    const tier = t.name.toLowerCase().includes('saving') ? (_mpMemberStatus?.savings_tier||0) : 0;
    const amt = Math.min(tier || remaining, remaining);
    splits.push({ typeId: t.id, typeName: t.name, suggested: tier, value: amt });
    remaining -= amt;
  });

  splitList.innerHTML = splits.map((s, i) => `
    <div style="display:flex;align-items:center;gap:.65rem;padding:.55rem .75rem;background:var(--surface);border:1px solid var(--border);border-radius:4px;transition:border-color .15s" id="split-row-${i}">
      <div style="flex:1">
        <div style="font-size:.8rem;font-weight:600;color:var(--ink)">${s.typeName}</div>
        ${s.suggested > 0 ? `<div style="font-size:.65rem;color:var(--ink-faint)">Suggested: Ksh ${s.suggested.toLocaleString()}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:.3rem">
        <span style="font-size:.75rem;color:var(--ink-faint)">Ksh</span>
        <input type="number" class="form-input mp-split-input" data-type-id="${s.typeId}" data-type-name="${s.typeName}"
          id="mp-split-${i}" value="${s.value}" min="0"
          style="width:110px;padding:.35rem .55rem;font-size:.88rem;font-weight:600;text-align:right"
          oninput="recalcSplitRemainder(${i}, ${splits.length})"/>
      </div>
    </div>`).join('');

  const unallocEl = document.getElementById('mp-unallocated');
  if (unallocEl) {
    unallocEl.style.display = remaining > 0 ? 'block' : 'none';
    unallocEl.textContent = remaining > 0 ? `⚠ Ksh ${remaining.toLocaleString()} unallocated — adjust the amounts above to split the full payment` : '';
  }
}

function recalcSplitRemainder(changedIdx, total) {
  const totalAmt = parseFloat(document.getElementById('mp-total-amount').value) || 0;
  let allocated = 0;
  for (let i = 0; i < total; i++) {
    allocated += parseFloat(document.getElementById('mp-split-'+i)?.value||0);
  }
  const remaining = totalAmt - allocated;
  const unallocEl = document.getElementById('mp-unallocated');
  if (unallocEl) {
    unallocEl.style.display = Math.abs(remaining) > 0.5 ? 'block' : 'none';
    unallocEl.textContent = remaining > 0
      ? `⚠ Ksh ${remaining.toLocaleString()} still unallocated`
      : remaining < -0.5 ? `⚠ Amounts exceed total by Ksh ${Math.abs(remaining).toLocaleString()}`
      : '';
  }
}

function updateWelfareAmount(cb) {
  const amtEl = document.getElementById('mp-welfare-amt-'+cb.dataset.eventId);
  if (amtEl) amtEl.style.display = cb.checked ? 'block' : 'none';
  updateMpTotal();
}

function updateMpTotal() {
  // Legacy compat — use mp-total-amount as truth now
  const total = parseFloat(document.getElementById('mp-total-amount')?.value||0);
  const welfareTotal = Array.from(document.querySelectorAll('.mp-welfare-check:checked'))
    .reduce((s,cb) => s + (parseFloat(document.getElementById('mp-welfare-amt-'+cb.dataset.eventId)?.value)||0), 0);
  document.getElementById('mp-grand-total').textContent = 'Ksh ' + (total + welfareTotal).toLocaleString();
}



function togglePayOption(key) {
  const cb = document.getElementById(`mp-check-${key}`);
  const fields = document.getElementById(`mp-${key}-fields`);
  if (!cb || !fields) return;
  setTimeout(() => {
    fields.style.display = cb.checked ? 'block' : 'none';
    if (!cb.checked) {
      // Clear amounts when unchecked
      fields.querySelectorAll('.mp-item-input').forEach(i => { i.value=''; i.style.display='none'; });
      fields.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
      if (key === 'reg') { const a = document.getElementById('mp-reg-amount'); if(a) a.value=''; }
    }
    updateMpTotal();
  }, 0);
}

function toggleContribItem(cb) {
  const amtInput = document.getElementById(`mp-contrib-amt-${cb.dataset.typeId}`);
  if (amtInput) amtInput.style.display = cb.checked ? 'block' : 'none';
  if (!cb.checked && amtInput) amtInput.value = '';
  updateMpTotal();
}

function toggleWelfareItem(cb) {
  const amtInput = document.getElementById(`mp-welfare-amt-${cb.dataset.eventId}`);
  if (amtInput) amtInput.style.display = cb.checked ? 'block' : 'none';
  if (!cb.checked && amtInput) amtInput.value = '';
  updateMpTotal();
}

function distributePayment(v) { updateMpTotal(); }
function updateAllocatedTotal() { updateMpTotal(); }

async function submitMemberPayment() {
  const mpesaRef = document.getElementById('mp-mpesa-ref')?.value?.trim();
  const payDate = document.getElementById('mp-pay-date')?.value;
  if (!mpesaRef) { toast('Please enter your M-Pesa reference number'); return; }

  const memberId = window._myMemberId;
  if (!memberId) { toast('Your account is not linked to a member record. Contact your admin.'); return; }

  // Collect all checked items
  const allocations = [];

  // Read split inputs from the new modal
  document.querySelectorAll('.mp-split-input').forEach(inp => {
    const amt = parseFloat(inp.value)||0;
    if (amt > 0) allocations.push({ typeId: inp.dataset.typeId, typeName: inp.dataset.typeName, amount: amt });
  });

  // Welfare checkboxes
  document.querySelectorAll('.mp-welfare-check:checked').forEach(cb => {
    const amtInput = document.getElementById('mp-welfare-amt-'+cb.dataset.eventId);
    const amt = parseFloat(amtInput?.value)||0;
    if (amt > 0) allocations.push({ eventId: cb.dataset.eventId, typeName: cb.dataset.eventName, amount: amt, isWelfare: true });
  });

  // If no split yet, use total as single payment
  const totalAmt = parseFloat(document.getElementById('mp-total-amount')?.value)||0;
  if (!allocations.length && totalAmt > 0) {
    allocations.push({ typeName: 'Payment', amount: totalAmt });
  }

  if (!allocations.length) { toast('Please select at least one payment category and enter an amount'); return; }

  const grandTotal = allocations.reduce((s,a)=>s+a.amount,0);
  let successCount = 0;

  // Submit as PENDING payment request — admin must approve before balances update
  const { error: reqErr } = await sb.from('payment_requests').insert({
    org_id: currentOrg.id,
    member_id: memberId,
    amount: grandTotal,
    mpesa_ref: mpesaRef,
    payment_date: payDate,
    allocations: JSON.stringify(allocations),
    status: 'pending',
    requested_at: new Date().toISOString(),
    notes: `Member self-recorded. ${allocations.map(a=>a.typeName+': Ksh '+a.amount).join(', ')}`
  });

  if (reqErr) {
    // payment_requests table issue — log full error for debugging
    console.error('payment_requests error:', reqErr);
    toast('⚠ Could not submit payment request: ' + reqErr.message + '. Please run the SQL migration in Supabase.');
    return;
  }

  successCount = allocations.length;
  // Log member payment submission
  try { logActivity('PAYMENT SUBMITTED', `${currentProfile?.full_name || 'Member'} submitted Ksh ${grandTotal.toLocaleString()} (ref: ${mpesaRef}) — ${allocations.map(a=>a.typeName+': Ksh '+a.amount).join(', ')}`, 'payment', memberId); } catch(e) {}
  // Reload to show pending notice
  toast(`✓ Payment submitted! Ksh ${grandTotal.toLocaleString()} pending admin approval. Reference: ${mpesaRef}`);

  closeModal('memberPayment');
  loadMyContributions();
  loadMyProfile();
}

// ── MEMBER MEETINGS ──
async function loadMyMeetings() {
  if (!currentOrg?.id) return;
  const today = new Date().toISOString().split('T')[0];
  const [upRes, pastRes] = await Promise.all([
    sb.from('meetings').select('*').eq('org_id', currentOrg.id).gte('meeting_date', today).order('meeting_date').limit(5),
    sb.from('meetings').select('*').eq('org_id', currentOrg.id).lt('meeting_date', today).order('meeting_date',{ascending:false}).limit(10)
  ]);
  const upcoming = upRes.data || [];
  const past = pastRes.data || [];

  // Attendance summary
  let attSummary = { present:0, apology:0, absent:0, total:0 };
  if (window._myMemberId && past.length) {
    const { data: attData } = await sb.from('attendance').select('status').eq('member_id', window._myMemberId);
    (attData||[]).forEach(a => { attSummary[a.status] = (attSummary[a.status]||0)+1; attSummary.total++; });
  }

  // Hero sub
  const subEl = document.getElementById('my-meetings-sub');
  if (subEl) subEl.textContent = upcoming.length ? `Next meeting in ${Math.ceil((new Date(upcoming[0].meeting_date) - new Date())/(1000*60*60*24))} days` : 'No upcoming meetings';

  // Attendance chips
  const chipsEl = document.getElementById('my-attendance-chips');
  if (chipsEl && attSummary.total > 0) {
    const rate = Math.round((attSummary.present/attSummary.total)*100);
    chipsEl.innerHTML = `
      <div style="background:rgba(255,255,255,.1);padding:.3rem .7rem;border-radius:99px;font-size:.7rem;color:rgba(255,255,255,.8)">✓ ${attSummary.present} Present</div>
      <div style="background:rgba(255,255,255,.08);padding:.3rem .7rem;border-radius:99px;font-size:.7rem;color:rgba(255,255,255,.6)">${rate}% Rate</div>`;
  }

  // Upcoming
  const upEl = document.getElementById('my-upcoming-meetings');
  if (upEl) upEl.innerHTML = upcoming.length ? upcoming.map((m,i) => {
    const d = new Date(m.meeting_date);
    const days = Math.ceil((d - new Date())/(1000*60*60*24));
    return `<div class="mp-meeting-card" style="animation-delay:${i*0.06}s">
      <div style="display:flex;align-items:center;gap:.75rem">
        <div style="background:var(--teal-pale);border:1px solid var(--teal-mid);padding:.3rem .5rem;text-align:center;min-width:40px;border-radius:4px">
          <div style="font-size:.55rem;font-weight:700;text-transform:uppercase;color:var(--teal-dk)">${d.toLocaleString('default',{month:'short'})}</div>
          <div style="font-family:'Crimson Pro',serif;font-size:1.3rem;font-weight:700;color:var(--teal-dk);line-height:1">${d.getDate()}</div>
        </div>
        <div>
          <div style="font-size:.85rem;font-weight:700;color:var(--ink)">${m.agenda||'General Meeting'}</div>
          <div style="font-size:.7rem;color:var(--ink-faint)">${m.meeting_time||'TBA'} · ${m.venue||'TBA'}</div>
          <div style="margin-top:.25rem;font-size:.68rem;font-weight:600;color:${days<=1?'var(--maroon)':days<=3?'var(--gold)':'var(--teal)'}">${days===0?'Today!':days===1?'Tomorrow':'In '+days+' days'}</div>
        </div>
      </div>
    </div>`;
  }).join('') : '<div style="padding:1.5rem;text-align:center;font-size:.82rem;color:var(--ink-faint)">No upcoming meetings scheduled</div>';

  // Attendance record
  const attEl = document.getElementById('my-attendance-record');
  if (attEl) {
    if (attSummary.total > 0) {
      const rate = Math.round((attSummary.present/attSummary.total)*100);
      attEl.innerHTML = `
        <div style="padding:.75rem 1.25rem">
          <div style="display:flex;justify-content:space-between;margin-bottom:.85rem">
            <div style="text-align:center"><div style="font-family:'Crimson Pro',serif;font-size:1.6rem;font-weight:700;color:var(--teal)">${attSummary.present}</div><div style="font-size:.65rem;color:var(--ink-faint);text-transform:uppercase">Present</div></div>
            <div style="text-align:center"><div style="font-family:'Crimson Pro',serif;font-size:1.6rem;font-weight:700;color:var(--gold)">${attSummary.apology}</div><div style="font-size:.65rem;color:var(--ink-faint);text-transform:uppercase">Apology</div></div>
            <div style="text-align:center"><div style="font-family:'Crimson Pro',serif;font-size:1.6rem;font-weight:700;color:var(--ink-faint)">${attSummary.absent}</div><div style="font-size:.65rem;color:var(--ink-faint);text-transform:uppercase">Absent</div></div>
            <div style="text-align:center"><div style="font-family:'Crimson Pro',serif;font-size:1.6rem;font-weight:700;color:var(--maroon)">${rate}%</div><div style="font-size:.65rem;color:var(--ink-faint);text-transform:uppercase">Rate</div></div>
          </div>
          <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${rate}%;background:var(--teal);border-radius:3px;transition:width 1s ease"></div>
          </div>
        </div>`;
    } else {
      attEl.innerHTML = '<div style="padding:1.5rem;text-align:center;font-size:.82rem;color:var(--ink-faint)">No attendance records yet</div>';
    }
  }

  // Past meetings
  const pastEl = document.getElementById('my-past-meetings');
  if (pastEl) pastEl.innerHTML = past.length ? past.map((m,i) => {
    const d = new Date(m.meeting_date);
    const myAtt = attSummary.total > 0 ? null : null;
    return `<div class="mp-meeting-card past" style="animation-delay:${i*0.04}s">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
          <div style="font-size:.7rem;color:var(--ink-faint)">${m.venue||'Online'}</div>
        </div>
        <span class="badge ${m.minutes?'badge-green':'badge-grey'}" style="font-size:.62rem">${m.minutes?'✓ Minutes':'Pending'}</span>
      </div>
    </div>`;
  }).join('') : '<div style="padding:1.5rem;text-align:center;font-size:.82rem;color:var(--ink-faint)">No past meetings recorded</div>';

  // ── Populate mobile meetings ──
  if (window.innerWidth <= 768) {
    const pastWithAtt = past.map(m => ({
      ...m,
      _attended: m._attStatus === 'present' ? true : m._attStatus === 'absent' ? false : null
    }));
    const attSummaryMob = { attended: attSummary.present, total: attSummary.total };
    populateMobileMeetings(upcoming, past, attSummaryMob);
  }
}

async function loadMyNotices() {
  if (!currentOrg?.id) return;
  const { data } = await sb.from('messages_log').select('*').eq('org_id', currentOrg.id).order('sent_at',{ascending:false}).limit(20);
  const logs = data || [];
  const countEl = document.getElementById('notices-count-chip');
  if (countEl) countEl.textContent = logs.length + ' notice' + (logs.length!==1?'s':'');
  const listEl = document.getElementById('my-notices-list');
  if (!listEl) return;
  listEl.innerHTML = logs.length ? logs.map((l,i) => {
    const dateStr = l.sent_at ? new Date(l.sent_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    return `<div class="mp-notice-card" style="animation-delay:${i*0.04}s">
      <div class="mp-notice-date">📢 ${dateStr} · ${l.recipient_type==='all'?'All Members':l.recipient_type==='active'?'Active Members':'Members'}</div>
      <div class="mp-notice-body">${l.body||'—'}</div>
    </div>`;
  }).join('') : `<div style="padding:3rem;text-align:center">
    <div style="font-size:2rem;margin-bottom:.75rem">📢</div>
    <div style="font-size:.85rem;color:var(--ink-faint)">No notices from your admin yet</div>
  </div>`;

  // Also populate mobile notices list
  const mobListEl = document.getElementById('mob-notices-list');
  if (mobListEl) {
    mobListEl.innerHTML = logs.length ? logs.map((l,i) => {
      const dateStr = l.sent_at ? new Date(l.sent_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
      return `<div class="mh-notice-card" style="animation:portalFadeUp .3s ease ${i*0.05}s both">
        <div class="mh-notice-date">📢 ${dateStr}</div>
        <div class="mh-notice-text">${l.body||'—'}</div>
      </div>`;
    }).join('') : `<div style="text-align:center;padding:2.5rem 1rem">
      <div style="font-size:2rem;margin-bottom:.75rem">📭</div>
      <div style="font-size:.88rem;font-weight:500;color:var(--ink);margin-bottom:.3rem">No notices yet</div>
      <div style="font-size:.78rem;color:var(--ink-faint)">Your admin hasn't sent any messages yet.</div>
    </div>`;
    // Show bell dot if notices exist
    const dot = document.getElementById('mob-bell-dot');
    if (dot) dot.style.display = logs.length > 0 ? 'block' : 'none';
  }
}

// ── Populate mobile-specific profile elements ──
// ── Theme toggle (dark/light) ──
function toggleMobTheme() {
  const isDark = document.body.classList.toggle('mob-dark');
  try { localStorage.setItem('gy360-mob-theme', isDark ? 'dark' : 'light'); } catch(e) {}
  const btn = document.getElementById('mob-theme-btn');
  if (btn) btn.textContent = isDark ? '🌙' : '☀️';
}

function initMobTheme() {
  try {
    const saved = localStorage.getItem('gy360-mob-theme');
    if (saved === 'dark') {
      document.body.classList.add('mob-dark');
      const btn = document.getElementById('mob-theme-btn');
      if (btn) btn.textContent = '🌙';
    }
  } catch(e) {}
}

// ── Scroll dot tracking for summary cards ──
function initMobScrollDots() {
  const scroll = document.querySelector('.mob-cards-scroll');
  if (!scroll) return;
  scroll.addEventListener('scroll', () => {
    const card = scroll.querySelector('.mob-summary-card');
    const cardW = card ? card.offsetWidth + 16 : scroll.offsetWidth;
    const idx = Math.min(2, Math.round(scroll.scrollLeft / cardW));
    [0,1,2].forEach(i => {
      const d = document.getElementById('mob-dot-' + i);
      if (d) d.classList.toggle('active', i === idx);
    });
  }, { passive: true });
}

// ── Populate all 3 summary cards + quick actions + recent txns ──
async function populateMobileProfile(myRecord, fp) {
  if (!myRecord) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  initMobTheme();
  initMobScrollDots();
  // Resize shell after content renders
  setTimeout(() => { if (typeof setMobHomeHeight === 'function') setMobHomeHeight(); }, 150);

  // ── Card 1: My Finances ──
  const totalBal = (myRecord.shares_balance || 0) + (myRecord.savings_balance || 0);
  const hasBalances = fp?.hasShares || fp?.hasSavings;

  if (hasBalances) {
    // Org tracks member balances — show combined balance + breakdown
    set('mob-sc-balance', 'Ksh ' + Number(totalBal).toLocaleString());
    const sharesRowEl = document.getElementById('mob-sc-shares-row');
    if (sharesRowEl) sharesRowEl.style.display = 'flex';
    if (fp?.hasShares) set('mob-sc-shares-tag', (fp.sharesLabel||'Shares') + ' Ksh ' + Number(myRecord.shares_balance||0).toLocaleString());
    if (fp?.hasSavings) set('mob-sc-savings-tag', (fp.savingsLabel||'Savings') + ' Ksh ' + Number(myRecord.savings_balance||0).toLocaleString());
    set('mob-sc-balance-meta', 'Combined balance');
  } else {
    // Org has no member balances — fetch total contributions from transactions
    try {
      const { data: txnTotals } = await sb.from('transactions')
        .select('amount')
        .eq('org_id', currentOrg.id)
        .eq('member_id', myRecord.id);
      const totalContrib = (txnTotals || []).reduce((s, t) => s + Number(t.amount || 0), 0);
      const thisYear = new Date().getFullYear().toString();
      const { data: yearTxns } = await sb.from('transactions')
        .select('amount,transaction_date')
        .eq('org_id', currentOrg.id)
        .eq('member_id', myRecord.id)
        .gte('transaction_date', thisYear + '-01-01');
      const yearTotal = (yearTxns || []).reduce((s, t) => s + Number(t.amount || 0), 0);
      set('mob-sc-balance', 'Ksh ' + Number(totalContrib).toLocaleString());
      set('mob-sc-balance-meta', 'Total contributions — all time');
      // Show this year as a tag
      if (yearTotal > 0) {
        const sharesRowEl = document.getElementById('mob-sc-shares-row');
        if (sharesRowEl) sharesRowEl.style.display = 'flex';
        set('mob-sc-shares-tag', thisYear + ': Ksh ' + Number(yearTotal).toLocaleString());
        // Hide savings tag since we're repurposing the row
        const savingsTag = document.getElementById('mob-sc-savings-tag');
        if (savingsTag) savingsTag.style.display = 'none';
      }
    } catch(e) {
      set('mob-sc-balance', 'Ksh 0');
      set('mob-sc-balance-meta', 'Total contributions');
    }
  }

  // Fetch last payment for footer
  try {
    const { data: lastTxn } = await sb.from('transactions')
      .select('amount,transaction_date,contribution_types(name)')
      .eq('org_id', currentOrg.id)
      .eq('member_id', myRecord.id)
      .order('transaction_date', { ascending: false })
      .limit(1).maybeSingle();
    if (lastTxn) {
      const d = lastTxn.transaction_date ? new Date(lastTxn.transaction_date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—';
      set('mob-sc-last-payment', 'Last: Ksh ' + Number(lastTxn.amount||0).toLocaleString() + ' · ' + d);
    } else {
      set('mob-sc-last-payment', 'No payments yet');
    }
  } catch(e) { set('mob-sc-last-payment', '—'); }

  // ── Card 2: Next Meeting ──
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: mtg } = await sb.from('meetings')
      .select('*').eq('org_id', currentOrg.id)
      .gte('meeting_date', today).order('meeting_date').limit(1).maybeSingle();
    if (mtg) {
      const mDate = new Date(mtg.meeting_date + 'T00:00:00');
      const days = Math.ceil((mDate - new Date()) / 86400000);
      const dateStr = mDate.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
      set('mob-sc-mtg-date', dateStr);
      set('mob-sc-mtg-countdown', days === 0 ? 'Today!' : days === 1 ? 'Tomorrow' : 'In ' + days + ' days');
      set('mob-sc-mtg-venue', mtg.venue || mtg.location || 'Venue TBA');
    } else {
      set('mob-sc-mtg-date', 'No meetings');
      set('mob-sc-mtg-countdown', 'Nothing scheduled yet');
      set('mob-sc-mtg-venue', 'Schedule one in Meetings');
    }
  } catch(e) { set('mob-sc-mtg-countdown', '—'); }

  // ── Card 3: Group Standing ──
  try {
    const { data: orgData } = await sb.from('organisations')
      .select('bank_balance,bank_balance_updated,show_balance_to_members,name')
      .eq('id', currentOrg.id).maybeSingle();
    const { data: memberCount } = await sb.from('members')
      .select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id).eq('status','active');

    if (orgData?.show_balance_to_members && orgData?.bank_balance) {
      set('mob-sc-group-main', 'Ksh ' + Number(orgData.bank_balance).toLocaleString());
      set('mob-sc-group-meta', 'Group bank balance');
      set('mob-sc-group-footer', orgData.bank_balance_updated ? 'As of ' + orgData.bank_balance_updated : 'Active group');
    } else {
      const count = memberCount?.count || '—';
      set('mob-sc-group-main', count + ' Members');
      set('mob-sc-group-meta', 'Active members');
      set('mob-sc-group-footer', currentOrg?.name || '—');
    }
  } catch(e) { set('mob-sc-group-main', '—'); }

  // ── Fines notice ──
  const finesAlert = document.getElementById('mp-fines-alert');
  const mobFines = document.getElementById('mob-fines-notice');
  if (mobFines && finesAlert && finesAlert.style.display !== 'none') {
    mobFines.style.display = 'block';
  }

  // ── Recent transactions ──
  try {
    const { data: txns } = await sb.from('transactions')
      .select('amount,transaction_date,contribution_types(name)')
      .eq('org_id', currentOrg.id)
      .eq('member_id', myRecord.id)
      .order('transaction_date', { ascending: false })
      .limit(3);
    const txnEl = document.getElementById('mob-recent-txns');
    if (txnEl) {
      if (txns?.length) {
        txnEl.innerHTML = txns.map(t => {
          const cat = t.contribution_types?.name || 'Payment';
          const initials = cat.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
          const d = t.transaction_date ? new Date(t.transaction_date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
          return `<div class="mob-txn-row">
            <div class="mob-txn-avatar">${initials}</div>
            <div class="mob-txn-info">
              <div class="mob-txn-name">${cat}</div>
              <div class="mob-txn-date">${d}</div>
            </div>
            <div class="mob-txn-amt">+Ksh ${Number(t.amount||0).toLocaleString()}</div>
          </div>`;
        }).join('');
      } else {
        txnEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.82rem;padding:.5rem 0;text-align:center">No transactions yet</div>';
      }
    }
  } catch(e) { console.warn('[GY360] Recent txns:', e); }
}

// ── Populate mobile contributions page ──
function populateMobileContributions(txns, mem, fp) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const thisYear = new Date().getFullYear().toString();
  const total = txns.reduce((s,t)=>s+Number(t.amount||0),0);
  const yearTotal = txns.filter(t=>(t.transaction_date||t.created_at||'').startsWith(thisYear)).reduce((s,t)=>s+Number(t.amount||0),0);

  set('mob-mc-total', 'Ksh ' + total.toLocaleString());
  set('mob-mc-year', 'Ksh ' + yearTotal.toLocaleString());
  set('mob-mc-member-meta', '#' + (mem?.member_number || '—') + ' · ' + (mem?.full_name || ''));

  // Org pill
  const orgName = currentOrg?.name ? currentOrg.name.replace(/\b\w/g, c => c.toUpperCase()) : 'Group';
  set('mob-fin-org-name', orgName.length > 18 ? orgName.slice(0,18)+'…' : orgName);
  const dotEl = document.getElementById('mob-fin-org-dot');
  if (dotEl) dotEl.textContent = orgName.charAt(0);

  // Shares/savings chips
  if (fp?.hasShares && mem) {
    const chip = document.getElementById('mob-mc-shares-chip');
    if (chip) chip.style.display = '';
    set('mob-mc-shares', 'Ksh ' + Number(mem.shares_balance||0).toLocaleString());
    set('mob-mc-shares-lbl', fp.sharesLabel || 'Shares');
  }
  if (fp?.hasSavings && mem) {
    const chip = document.getElementById('mob-mc-savings-chip');
    if (chip) chip.style.display = '';
    set('mob-mc-savings', 'Ksh ' + Number(mem.savings_balance||0).toLocaleString());
    set('mob-mc-savings-lbl', fp.savingsLabel || 'Savings');
  }

  // Count
  set('mob-mc-count', txns.length + ' payment' + (txns.length!==1?'s':''));

  // By category
  const catEl = document.getElementById('mob-mc-by-cat');
  if (catEl) {
    const cats = {};
    txns.forEach(t => { const c=t.contribution_types?.name||'Other'; cats[c]=(cats[c]||0)+Number(t.amount||0); });
    const entries = Object.entries(cats).sort((a,b)=>b[1]-a[1]);
    catEl.innerHTML = entries.length ? entries.map(([cat,amt]) => `
      <div class="mh-amt-row">
        <span class="mh-amt-label">${cat}</span>
        <span class="mh-amt-val">Ksh ${amt.toLocaleString()}</span>
      </div>`).join('') : '<div style="color:var(--ink-faint);font-size:.8rem">No payments yet</div>';
  }

  // Timeline
  const tlEl = document.getElementById('mob-mc-timeline');
  if (tlEl) {
    tlEl.innerHTML = txns.length ? txns.slice(0,20).map(t => {
      const date = (t.transaction_date||t.created_at||'').slice(0,10);
      const dateStr = date ? new Date(date+'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : '—';
      return `<div class="mh-txn">
        <div class="mh-txn-dot cr">↓</div>
        <div style="flex:1">
          <div class="mh-txn-name">${t.contribution_types?.name||'Payment'}</div>
          <div class="mh-txn-date">${dateStr}</div>
        </div>
        <div class="mh-txn-amt cr">+Ksh ${Number(t.amount||0).toLocaleString()}</div>
      </div>`;
    }).join('') : '<div style="color:var(--ink-faint);font-size:.8rem;padding:.5rem 0">No payments recorded yet</div>';
  }
}

// ── Populate mobile meetings page ──
function populateMobileMeetings(upcoming, past, attendanceSummary) {
  // Org info
  const orgName = currentOrg?.name ? currentOrg.name.replace(/\b\w/g, c => c.toUpperCase()) : 'Group';
  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('mob-mtg-org-name', orgName.length > 18 ? orgName.slice(0,18)+'…' : orgName);
  const dotEl = document.getElementById('mob-mtg-org-dot');
  if (dotEl) dotEl.textContent = orgName.charAt(0);

  // Upcoming
  const upEl = document.getElementById('mob-upcoming-meetings');
  if (upEl) {
    upEl.innerHTML = upcoming.length ? upcoming.map(m => {
      const d = m.meeting_date ? new Date(m.meeting_date) : null;
      const dateStr = d ? d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'}) : '—';
      const daysAway = d ? Math.ceil((d - new Date()) / 86400000) : null;
      const badge = daysAway !== null ? (daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : 'In ' + daysAway + ' days') : '';
      return `<div class="mh-meeting">
        <div class="mh-meeting-date">📅 ${dateStr}</div>
        <div class="mh-meeting-name">${m.title||'Meeting'}</div>
        <div class="mh-meeting-meta">${m.time||''} ${m.location ? '· ' + m.location : ''}</div>
        ${badge ? `<div class="mh-meeting-badge upcoming">${badge}</div>` : ''}
      </div>`;
    }).join('') : '<div style="color:var(--ink-faint);font-size:.82rem;padding:.5rem 0">No upcoming meetings</div>';
  }

  // Attendance summary
  const attEl = document.getElementById('mob-attendance-summary');
  if (attEl && attendanceSummary) {
    attEl.innerHTML = `
      <div class="mh-profile-row"><span class="mh-profile-key">Meetings attended</span><span class="mh-profile-val" style="color:var(--teal)">${attendanceSummary.attended||0}</span></div>
      <div class="mh-profile-row"><span class="mh-profile-key">Total meetings</span><span class="mh-profile-val">${attendanceSummary.total||0}</span></div>
      <div class="mh-profile-row"><span class="mh-profile-key">Attendance rate</span><span class="mh-profile-val">${attendanceSummary.total ? Math.round((attendanceSummary.attended/attendanceSummary.total)*100)+'%' : '—'}</span></div>`;
  }

  // Past
  const pastEl = document.getElementById('mob-past-meetings');
  if (pastEl) {
    pastEl.innerHTML = past.length ? past.map(m => {
      const d = m.meeting_date ? new Date(m.meeting_date) : null;
      const dateStr = d ? d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '—';
      const attended = m._attended;
      return `<div class="mh-meeting" style="border-left-color:${attended===true?'var(--teal)':attended===false?'var(--danger)':'var(--border)'}">
        <div class="mh-meeting-name">${m.title||'Meeting'}</div>
        <div class="mh-meeting-meta">${dateStr}${m.location ? ' · ' + m.location : ''}</div>
        ${attended===true ? '<div class="mh-meeting-badge past-ok">✓ Attended</div>' : attended===false ? '<div class="mh-meeting-badge past-no">✗ Absent</div>' : ''}
      </div>`;
    }).join('') : '<div style="color:var(--ink-faint);font-size:.82rem;padding:.5rem 0">No past meetings recorded</div>';
  }
}

// ── Toggle collapsible mobile summary card ──

// REMOVED (5 Jul 2026): a duplicate copy of start()/init() and service worker
// registration used to live here — leftover from the "auto-split from index.html"
// refactor. index.html already runs this bootstrap once; having a second copy here
// meant handleAuthRedirect()/init() and SW registration both ran twice on every
// page load. Harmless most of the time, but an unnecessary source of confusion
// and duplicate work. The real, single bootstrap now lives only in index.html.

// ── PWA INSTALL PROMPT ──
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show install button if not already installed
  showInstallBanner();
});

function showInstallBanner() {
  // Don't show if already in standalone mode (already installed)
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (localStorage.getItem('pwa-dismissed')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed; bottom: 0; left: 0; right: 0;
    background: #5a0016; color: #fff;
    padding: .75rem 1.25rem;
    display: flex; align-items: center; justify-content: space-between;
    z-index: 9999; font-family: Inter, sans-serif; font-size: .82rem;
    box-shadow: 0 -4px 20px rgba(0,0,0,.3);
  `;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:.75rem">
      <img src="icons/icon-72x72.png" style="width:36px;height:36px;border-radius:8px">
      <div>
        <div style="font-weight:700">Install GroupYetu360</div>
        <div style="font-size:.72rem;opacity:.7">Add to home screen for quick access</div>
      </div>
    </div>
    <div style="display:flex;gap:.5rem">
      <button onclick="installPWA()" style="
        background:#c49a30;color:#fff;border:none;
        padding:.4rem .9rem;font-size:.78rem;font-weight:700;
        cursor:pointer;font-family:Inter,sans-serif;border-radius:2px">
        Install
      </button>
      <button onclick="dismissInstallBanner()" style="
        background:transparent;color:rgba(255,255,255,.6);
        border:1px solid rgba(255,255,255,.2);
        padding:.4rem .6rem;font-size:.78rem;cursor:pointer;
        font-family:Inter,sans-serif;border-radius:2px">
        ✕
      </button>
    </div>`;
  document.body.appendChild(banner);
}

async function installPWA() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log('[GY360] PWA install:', outcome);
  deferredInstallPrompt = null;
  document.getElementById('pwa-install-banner')?.remove();
}

function dismissInstallBanner() {
  localStorage.setItem('pwa-dismissed', '1');
  document.getElementById('pwa-install-banner')?.remove();
}

window.addEventListener('appinstalled', () => {
  console.log('[GY360] App installed successfully');
  document.getElementById('pwa-install-banner')?.remove();
  toast('GroupYetu360 installed! Find it on your home screen.');
});

/* ══════════════════════════════════════════════════
   MEMBER WITHDRAWAL REQUESTS
══════════════════════════════════════════════════ */

// Show/hide the withdrawal card based on org's withdraw_enabled flag
function updateWithdrawCard() {
  const card = document.getElementById('mp-withdraw-card');
  if (!card) return;
  const isOpen = currentOrg?.withdraw_enabled || false;
  const hasFunds = (orgFinProfile.hasSavings || orgFinProfile.hasShares);
  card.style.display = (isOpen && hasFunds) ? 'block' : 'none';
  if (isOpen && hasFunds) loadMyPendingWithdrawals();
}

// Load member's own pending withdrawal requests
async function loadMyPendingWithdrawals() {
  const el = document.getElementById('mp-withdraw-pending');
  if (!el || !window._myMemberId) return;
  try {
    const { data } = await sb.from('withdrawal_requests')
      .select('*').eq('member_id', window._myMemberId)
      .eq('status', 'pending').order('created_at', { ascending: false });
    const requests = data || [];
    if (!requests.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div style="margin-top:.5rem;font-size:.75rem;color:var(--ink-soft);font-weight:600;margin-bottom:.4rem">Your pending requests:</div>
      ${requests.map(r => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.45rem .6rem;background:var(--surface-2);border-radius:.4rem;margin-bottom:.3rem;font-size:.78rem">
          <span style="color:var(--ink)">Ksh ${Number(r.amount).toLocaleString()} ${r.note ? '· ' + r.note : ''}</span>
          <span style="font-size:.68rem;color:var(--warning);font-weight:600">⏳ Pending</span>
        </div>`).join('')}`;
  } catch(e) { console.log('loadMyPendingWithdrawals:', e.message); }
}

// Submit a withdrawal request
async function submitWithdrawalRequest() {
  if (!canDo('viewPortal')) return;
  const amountEl = document.getElementById('mp-withdraw-amount');
  const noteEl   = document.getElementById('mp-withdraw-note');
  const amount   = parseFloat(amountEl?.value);
  if (!amount || amount <= 0) { toast('Please enter a valid amount'); return; }
  if (!window._myMemberId) { toast('Your account is not linked to a member record. Contact your admin.'); return; }

  // Check against available balance
  const { data: member } = await sb.from('members')
    .select('full_name, savings_balance, shares_balance')
    .eq('id', window._myMemberId).single();
  const available = Number(member?.savings_balance || 0) + Number(member?.shares_balance || 0);
  if (amount > available) {
    toast(`⚠ Amount exceeds your available balance of Ksh ${available.toLocaleString()}`);
    return;
  }

  try {
    await sb.from('withdrawal_requests').insert({
      org_id:    currentOrg.id,
      member_id: window._myMemberId,
      amount,
      note:      noteEl?.value?.trim() || null,
      status:    'pending',
      requested_by: currentUser.id
    });
    try { logActivity('WITHDRAWAL REQUESTED', `${member?.full_name || 'Member'} requested withdrawal of Ksh ${amount.toLocaleString()}${noteEl?.value?.trim() ? ' — '+noteEl.value.trim() : ''}`, 'member', window._myMemberId); } catch(e) {}
    amountEl.value = '';
    if (noteEl) noteEl.value = '';
    toast('✓ Withdrawal request submitted. Your admin will confirm payment.');
    loadMyPendingWithdrawals();
  } catch(e) {
    toast('Error submitting request: ' + e.message);
  }
}
