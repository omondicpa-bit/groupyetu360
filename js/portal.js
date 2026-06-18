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

  // ── Full table ──
  const rows = [
    ...txns.map(t => `<tr>
      <td>${t.transaction_date||t.created_at?.split('T')[0]||'—'}</td>
      <td><span class="badge badge-green">${t.contribution_types?.name||'Payment'}</span></td>
      <td><strong style="color:var(--success)">+Ksh ${Number(t.amount).toLocaleString()}</strong></td>
      <td style="font-family:monospace;font-size:.72rem">${t.mpesa_ref||'—'}</td>
      <td style="font-size:.78rem">${t.notes||'—'}</td>
    </tr>`),
    ...adjs.map(a => `<tr>
      <td>${a.created_at?.split('T')[0]||'—'}</td>
      <td><span class="badge ${a.direction==='credit'?'badge-maroon':'badge-warn'}">${a.direction==='credit'?'Credit Adj':'Debit Adj'}</span></td>
      <td><strong style="color:${a.direction==='credit'?'var(--success)':'var(--danger)'}">${a.direction==='credit'?'+':'-'}Ksh ${Number(a.amount).toLocaleString()}</strong></td>
      <td>—</td>
      <td style="font-size:.78rem">${a.reason||'—'}</td>
    </tr>`)
  ];
  document.getElementById('mc-table').innerHTML = rows.length ? rows.join('') :
    '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--ink-faint)">No payments yet. They will appear here once your admin records them.</td></tr>';
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

// ── SMS USAGE TRACKING ──
async function trackSmsUsage(orgId, messagesSent) {
  const month = new Date().toISOString().slice(0,7);
  const costToPlat = messagesSent * SMS_COST;
  const chargedToOrg = messagesSent * SMS_RATE;
  
  const { data: existing } = await sb.from('sms_usage')
    .select('*').eq('org_id', orgId).eq('month', month).maybeSingle();
  
  if (existing) {
    await sb.from('sms_usage').update({
      messages_sent: existing.messages_sent + messagesSent,
      cost_to_platform: existing.cost_to_platform + costToPlat,
      charged_to_org: existing.charged_to_org + chargedToOrg
    }).eq('id', existing.id);
  } else {
    await sb.from('sms_usage').insert({
      org_id: orgId,
      messages_sent: messagesSent,
      cost_to_platform: costToPlat,
      charged_to_org: chargedToOrg,
      month
    });
  }
  
  // Also update org's sms_used counter
  await sb.from('organisations')
    .update({ sms_used: (existing?.messages_sent||0) + messagesSent })
    .eq('id', orgId);
}

// ── MEMBER PAYMENT FUNCTIONS ──

/* ═══════════════════════════════════
   SMART PAYMENT SPLIT
═══════════════════════════════════ */
let _mpContribTypes = [];
let _mpMemberStatus = null;

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
            <div style="font-size:.8rem;font-weight:600">${e.event_type==='member'?'Member Death':e.event_type==='spouse'?'Spouse/Parent Death':'Child Death'}</div>
            <div style="font-size:.67rem;color:var(--ink-faint)">Suggested: Ksh ${Number(e.contribution_per_member||0).toLocaleString()} per member</div>
          </div>
          <input type="number" class="form-input mp-item-input" id="mp-welfare-amt-${e.id}"
            style="width:100px;padding:.3rem .5rem;font-size:.8rem;display:none"
            value="${e.contribution_per_member||0}" oninput="updateMpTotal()"/>
        </div>`).join('');
    } else {
      welfareSection.style.display = 'none';
    }
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

function updateMpTotal() {
  let total = 0;
  document.querySelectorAll('.mp-item-input').forEach(inp => {
    total += parseFloat(inp.value)||0;
  });
  const regAmt = document.getElementById('mp-reg-amount');
  if (regAmt && document.getElementById('mp-check-reg')?.checked) {
    total += parseFloat(regAmt.value)||0;
  }
  const el = document.getElementById('mp-grand-total');
  if (el) el.textContent = 'Ksh ' + total.toLocaleString();
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
}

async function start() {
  const isReset = await handleAuthRedirect();
  if (!isReset) init();
}
start();

// ── REGISTER SERVICE WORKER (PWA) ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[GY360] Service Worker registered:', reg.scope);
      })
      .catch(err => {
        console.log('[GY360] SW registration failed:', err);
      });
  });
}

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
