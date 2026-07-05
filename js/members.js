// GroupYetu360 — js/members.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.
// h() (XSS sanitiser) is defined in utils.js — loads before this file, available globally.

// ── MEMBERS ──
async function loadMembers() {
  if (!currentOrg?.id) return;
  // Gate Add Member button based on role
  const addBtn = document.getElementById('add-member-btn');
  if (addBtn) addBtn.style.display = canDo('addMember') ? '' : 'none';
  // Always fetch fresh from DB — never use stale allMembers from previous org
  const [{ data }, { data: lastTxns }] = await Promise.all([
    sb.from('members').select('*').eq('org_id', currentOrg.id).order('internal_number,member_number'),
    sb.from('transactions').select('member_id,amount,transaction_date,created_at')
      .eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false })
  ]);
  // Build last contribution map: member_id → { date, amount }
  // Group by mpesa_ref+date so split payments (shares+savings same ref) count as one payment
  const lastContribMap = {};
  const seenKeys = {}; // member_id:ref:date → accumulated amount
  const sortedTxns = (lastTxns || []).slice().sort((a,b) => new Date(b.created_at||0) - new Date(a.created_at||0));
  sortedTxns.forEach(t => {
    const date = t.transaction_date || t.created_at?.split('T')[0];
    const ref = t.mpesa_ref || ('__no_ref_' + t.member_id + '_' + date);
    const key = t.member_id + ':' + ref + ':' + date;
    if (!seenKeys[key]) {
      seenKeys[key] = { memberId: t.member_id, date, amount: 0, ref };
    }
    seenKeys[key].amount += Number(t.amount || 0);
  });
  // Pick the most recent grouped payment per member
  Object.values(seenKeys).forEach(entry => {
    if (!lastContribMap[entry.memberId]) {
      lastContribMap[entry.memberId] = { date: entry.date, amount: entry.amount };
    }
  });
  window._lastContribMap = lastContribMap;
  const allFetched = data || [];
  const limit = getPlanMemberLimit(currentOrg);
  const overLimit = allFetched.length > limit;
  // Cap display to plan limit (excess members hidden until upgrade)
  allMembers = isFinite(limit) ? allFetched.slice(0, limit) : allFetched;
  populateSelects(); // refresh dropdowns with new org's members

  // Show over-limit banner
  const bannerEl = document.getElementById('members-limit-banner');
  if (bannerEl) {
    if (overLimit) {
      const plan = getEffectivePlan(currentOrg);
      bannerEl.innerHTML = `⚠ Your group has ${allFetched.length} members but your <strong>${plan.toUpperCase()}</strong> plan allows ${limit}. Showing first ${limit} only. <a href="#" onclick="showPage('billing')" style="color:var(--maroon);font-weight:700">Upgrade to see all →</a>`;
      bannerEl.style.display = 'block';
    } else {
      bannerEl.style.display = 'none';
    }
  }

  // For orgs without member balances (welfare/subscription), fetch total contributed per member
  const fp = orgFinProfile;
  if (!fp.hasShares && !fp.hasSavings && allMembers.length) {
    try {
      const { data: txnTotals } = await sb.from('transactions')
        .select('member_id,amount').eq('org_id', currentOrg.id);
      const totals = {};
      (txnTotals||[]).forEach(t => {
        totals[t.member_id] = (totals[t.member_id]||0) + Number(t.amount||0);
      });
      allMembers = allMembers.map(m => ({ ...m, total_contributed: totals[m.id]||0 }));
    } catch(e) {}
  }
  document.getElementById('members-sub').textContent = allMembers.length + ' members registered';
  renderMemberGrid(allMembers);
}

// Track current member filter state
let _memberStatusFilter = 'all';

function filterByStatus(status, btn) {
  _memberStatusFilter = status;
  document.querySelectorAll('.mf-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const q = document.getElementById('member-search-input')?.value || '';
  applyMemberFilters(q, status);
}

function filterMembers(q) {
  applyMemberFilters(q, _memberStatusFilter);
}

function applyMemberFilters(q, status) {
  let list = allMembers;
  if (status && status !== 'all') list = list.filter(m => m.status === status);
  if (q && q.length >= 1) {
    const ql = q.toLowerCase();
    list = list.filter(m =>
      (m.full_name||'').toLowerCase().includes(ql) ||
      (m.phone||'').includes(q) ||
      (m.email||'').toLowerCase().includes(ql) ||
      (m.id_number||'').includes(q) ||
      (m.member_number?.toString()||'').includes(q)
    );
  }
  const countEl = document.getElementById('members-count-label');
  if (countEl) countEl.textContent = list.length + ' of ' + allMembers.length + ' members';
  const gridView = document.getElementById('member-grid');
  const listView = document.getElementById('member-list-view');
  if (gridView && gridView.style.display !== 'none') renderMemberGrid(list);
  else renderMemberList(list);
}

let _membersViewMode = 'grid';
function toggleMembersView() {
  _membersViewMode = _membersViewMode === 'grid' ? 'list' : 'grid';
  const grid = document.getElementById('member-grid');
  const list = document.getElementById('member-list-view');
  const btn = document.getElementById('members-view-toggle');
  if (_membersViewMode === 'list') {
    if (grid) grid.style.display = 'none';
    if (list) list.style.display = '';
    if (btn) btn.textContent = '☰ List';
    renderMemberList(allMembers);
  } else {
    if (grid) grid.style.display = '';
    if (list) list.style.display = 'none';
    if (btn) btn.textContent = '⊞ Grid';
    renderMemberGrid(allMembers);
  }
}

function renderMemberList(list) {
  const tbody = document.getElementById('member-list-table');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(m => {
    const dispNum = m.display_number || (m.internal_number ? String(m.internal_number).padStart(3,'0') : m.member_number) || '—';
    return `<tr onclick="openMemberDetail('${m.id}')" style="cursor:pointer">
    <td style="font-weight:700;color:var(--maroon)">#${dispNum}${m.is_founder ? ' <span title="Founding Member" style="font-size:.8rem">🏛</span>' : ''}</td>
    <td><strong>${h(m.full_name)}</strong><div style="font-size:.68rem;color:var(--ink-faint)">${h(m.email)}</div></td>
    <td>${h(m.phone)||'—'}</td>
    <td style="font-weight:600;color:var(--maroon)">Ksh ${Number(m.shares_balance||0).toLocaleString()}</td>
    <td style="font-weight:600;color:var(--teal)">Ksh ${Number(m.savings_balance||0).toLocaleString()}</td>
    <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey'}">${h(m.status)}</span></td>
    <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openMemberDetail('${m.id}')">View →</button></td>
  </tr>`;
  }).join('') : '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--ink-faint)">No members found</td></tr>';
}

function renderMemberGrid(list) {
  const grid = document.getElementById('member-grid');
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:3rem;text-align:center">
      <div style="font-size:2.5rem;margin-bottom:.75rem">◉</div>
      <div style="font-size:.95rem;font-weight:600;color:var(--ink);margin-bottom:.4rem">No members yet</div>
      <div style="font-size:.8rem;color:var(--ink-faint);margin-bottom:1.25rem">Add your first member to get started</div>
      <button class="btn btn-primary" style="width:auto;padding:.65rem 1.5rem" onclick="showModal('addMember')">+ Add First Member</button>
    </div>`;
    return;
  }
  const countEl = document.getElementById('members-count-label');
  if (countEl) countEl.textContent = list.length + ' of ' + allMembers.length + ' members';
  const fp = orgFinProfile;
  grid.innerHTML = list.map((m,i) => {
    const initials = (m.full_name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    const statusClass = 'status-' + (m.status||'inactive');
    const badgeClass = m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey';
    const regOk = m.registration_paid;
    const renewalDue = m.registration_renewal && new Date(m.registration_renewal) < new Date();

    // Dynamic balance columns — only show what this org uses
    let balanceCols = '';
    if (fp.hasShares && fp.hasSavings) {
      const total = Number(m.shares_balance||0) + Number(m.savings_balance||0);
      balanceCols = `
        <div class="mc-bal"><div class="mc-bal-label">${fp.sharesLabel}</div><div class="mc-bal-value" style="color:var(--maroon)">Ksh ${Number(m.shares_balance||0).toLocaleString()}</div></div>
        <div class="mc-bal"><div class="mc-bal-label">${fp.savingsLabel}</div><div class="mc-bal-value" style="color:var(--teal)">Ksh ${Number(m.savings_balance||0).toLocaleString()}</div></div>
        <div class="mc-bal"><div class="mc-bal-label">Total</div><div class="mc-bal-value" style="color:var(--ink)">Ksh ${total.toLocaleString()}</div></div>`;
    } else if (fp.hasShares) {
      balanceCols = `
        <div class="mc-bal"><div class="mc-bal-label">${fp.sharesLabel}</div><div class="mc-bal-value" style="color:var(--maroon)">Ksh ${Number(m.shares_balance||0).toLocaleString()}</div></div>`;
    } else if (fp.hasSavings) {
      balanceCols = `
        <div class="mc-bal"><div class="mc-bal-label">${fp.savingsLabel}</div><div class="mc-bal-value" style="color:var(--teal)">Ksh ${Number(m.savings_balance||0).toLocaleString()}</div></div>`;
    } else {
      // Welfare / subscription only — show total contributed from transactions
      balanceCols = `
        <div class="mc-bal" style="grid-column:1/-1"><div class="mc-bal-label">Total Contributed</div><div class="mc-bal-value" style="color:var(--teal)">Ksh ${Number(m.total_contributed||0).toLocaleString()}</div></div>`;
    }

    // Footer — show last contribution date if available, else savings tier
    const lastC = (window._lastContribMap || {})[m.id];
    const footerLeft = lastC
      ? `Last: Ksh ${Number(lastC.amount).toLocaleString()} on ${lastC.date}`
      : (fp.hasSavings || fp.hasShares) && m.savings_tier
        ? `Ksh ${Number(m.savings_tier).toLocaleString()}/mo`
        : fp.hasAdminIncome ? `${fp.adminIncomeLabel}` : '';

    return `<div class="member-card ${statusClass}" onclick="openMemberDetail('${m.id}')" style="animation-delay:${i*0.04}s">
      <div class="mc-header">
        <div class="mc-avatar">${initials}</div>
        <div class="mc-meta">
          <div class="mc-num">Member #${m.member_number||'—'}</div>
          <div class="mc-name">${h(m.full_name)}</div>
          <div class="mc-phone">${h(m.phone||m.email)||'—'}</div>
        </div>
        <span class="badge ${badgeClass}" style="font-size:.6rem;flex-shrink:0">${m.status||'—'}</span>
      </div>
      ${balanceCols ? `<div class="mc-balances">${balanceCols}</div>` : ''}
      <div class="mc-footer">
        <span>${footerLeft}</span>
        <span class="${regOk&&!renewalDue?'mc-reg-ok':'mc-reg-warn'}">${regOk&&!renewalDue?'✓ Registered':renewalDue?'⚠ Renewal due':'⚠ Unregistered'}</span>
      </div>
    </div>`;
  }).join('');
}

// filterMembers defined above

async function saveMember() {
  if (!canDo('addMember')) { toast('⚠ You do not have permission to add members.'); return; }
  if (!currentOrg?.id) return;

  // ── Plan member limit check ──
  const limit = getPlanMemberLimit(currentOrg);
  if (isFinite(limit) && allMembers.length >= limit) {
    const plan = getEffectivePlan(currentOrg);
    toast(`⚠ Member limit reached. Your ${plan.toUpperCase()} plan allows up to ${limit} members. Upgrade to add more.`);
    closeModal('addMember');
    showPage('billing');
    return;
  }
  const openingShares = parseFloat(document.getElementById('nm-opening-shares').value)||0;
  const openingSavings = parseFloat(document.getElementById('nm-opening-savings').value)||0;
  const fullName = document.getElementById('nm-name').value.trim();
  const email = document.getElementById('nm-email')?.value?.trim();
  const regPaid = document.getElementById('nm-reg').value === 'true';
  const status = document.getElementById('nm-status')?.value || 'active';
  const joinDate = document.getElementById('nm-date').value || new Date().toISOString().split('T')[0];

  if (!fullName) { toast('Please enter a name'); return; }

  const payload = {
    org_id: currentOrg.id,
    full_name: fullName,
    id_number: document.getElementById('nm-id').value.trim() || null,
    phone: document.getElementById('nm-phone').value.trim() || null,
    join_date: joinDate,
    savings_tier: parseInt(document.getElementById('nm-savings').value)||0,
    registration_paid: regPaid,
    registration_date: regPaid ? joinDate : null,
    member_number: String(allMembers.length + 1).padStart(3,'0'),
    internal_number: allMembers.length + 1,
    status,
    portal_email: email || null,
    opening_shares: openingShares,
    opening_savings: openingSavings,
    shares_balance: openingShares,
    savings_balance: openingSavings
  };

  const { data: newMember, error } = await sb.from('members').insert(payload).select().single();
  if (error) { toast('Error: ' + error.message); return; }

  // Send portal invite if email provided and checkbox checked.
  // NOTE: this used to call resetPasswordForEmail(), but that only sends anything if
  // the email already has an auth account — for a genuinely new member (the normal
  // case here) it silently did nothing at all, no account and no email, while the UI
  // still reported success. signUp() + invite metadata is the correct mechanism —
  // same one used when linking portal access to an existing member later — and the
  // profiles/user_orgs rows get created server-side by the handle_new_user() trigger.
  const sendInvite = document.getElementById('nm-send-invite')?.checked;
  if (email && sendInvite) {
    try {
      const tempPw = Math.random().toString(36).slice(2, 10) + 'Aa1!';
      const { error: signUpErr } = await sb.auth.signUp({
        email, password: tempPw,
        options: {
          data: {
            full_name: fullName,
            invite_org_id: currentOrg.id,
            invite_org_name: currentOrg.name,
            invite_member_id: newMember?.id || null
          },
          emailRedirectTo: 'https://app.groupyetu.org/?intent=invite'
        }
      });
      if (signUpErr) {
        toast('Member added. Invite failed: ' + signUpErr.message + ' — if they already have an account, use "Link Existing User" instead.');
      } else {
        toast('✓ Member added — portal invite sent to ' + email);
      }
    } catch(e) {
      toast('Member added. Invite failed: ' + e.message);
    }
  } else {
    toast('Member added successfully');
  }

  // Reset invite row visibility
  const invRow = document.getElementById('nm-invite-row');
  if (invRow) invRow.style.display = 'none';

  closeModal('addMember');
  await loadMembers();
  populateSelects();
}


// ── MEMBER DETAIL ──
let currentMemberId = null;

async function openMemberDetail(memberId) {
  currentMemberId = memberId;
  const isSelf = window._myMemberId === memberId;
  const { data: m } = await sb.from('members').select('*').eq('id', memberId).single();
  if (!m) return;

  // Determine display number: prefer display_number if set, else internal_number, else member_number
  const displayNum = m.display_number || (m.internal_number ? String(m.internal_number).padStart(3,'0') : m.member_number) || '—';
  const internalNum = m.internal_number ? String(m.internal_number).padStart(3,'0') : m.member_number || '—';
  const isFounder = m.is_founder === true;
  const isSuperAdmin = currentProfile?.role === 'superadmin';

  document.getElementById('md-name').textContent = m.full_name;
  document.getElementById('md-number').textContent =
    `Member #${displayNum}` +
    (m.display_number && m.internal_number ? ` · Internal #${internalNum}` : '') +
    ` · ${m.phone || '—'}`;

  // Founder badge — show/hide
  let founderBadge = document.getElementById('md-founder-badge');
  if (!founderBadge) {
    founderBadge = document.createElement('div');
    founderBadge.id = 'md-founder-badge';
    founderBadge.className = 'md-founder-badge';
    const modalHeader = document.querySelector('#modal-memberDetail .modal-header > div:first-child');
    if (modalHeader) modalHeader.appendChild(founderBadge);
  }
  if (isFounder) {
    founderBadge.innerHTML = '🏛 Founding Member · Group Admin';
    founderBadge.style.display = '';
  } else {
    founderBadge.style.display = 'none';
  }

  // Delete button — superadmin only
  const deleteBtn = document.getElementById('delete-member-btn');
  if (deleteBtn) {
    deleteBtn.style.display = isSuperAdmin ? '' : 'none';
    if (isSuperAdmin && isFounder) {
      deleteBtn.style.background = 'var(--maroon-dk)';
      deleteBtn.title = 'Superadmin: remove founding member';
    }
  }
  document.getElementById('md-shares-bal').textContent = 'Ksh ' + (m.shares_balance||0).toLocaleString();
  document.getElementById('md-savings-bal').textContent = 'Ksh ' + (m.savings_balance||0).toLocaleString();
  document.getElementById('md-total-bal').textContent = 'Ksh ' + ((m.shares_balance||0)+(m.savings_balance||0)).toLocaleString();

  // Dynamic balance cards based on org type
  const fp = orgFinProfile;
  const sharesCard = document.getElementById('md-shares-card');
  const savingsCard = document.getElementById('md-savings-card');
  const totalCard = document.getElementById('md-total-card');
  const balRow = document.getElementById('md-bal-cards');

  if (fp.hasShares || fp.hasSavings) {
    // Show relevant cards
    if (sharesCard) sharesCard.style.display = fp.hasShares ? '' : 'none';
    if (savingsCard) savingsCard.style.display = fp.hasSavings ? '' : 'none';
    // Update labels
    const sharesLabel = document.getElementById('md-shares-label');
    const savingsLabel = document.getElementById('md-savings-label');
    const totalLabel = document.getElementById('md-total-label');
    if (sharesLabel) sharesLabel.textContent = fp.sharesLabel || 'Shares Balance';
    if (savingsLabel) savingsLabel.textContent = fp.savingsLabel || 'Savings Balance';
    // Total card: only show if BOTH shares and savings exist
    if (totalCard) totalCard.style.display = (fp.hasShares && fp.hasSavings) ? '' : 'none';
    if (totalLabel) totalLabel.textContent = 'Total Holdings';
    // Adjust grid columns
    if (balRow) {
      const visibleCount = (fp.hasShares ? 1 : 0) + (fp.hasSavings ? 1 : 0) + (fp.hasShares && fp.hasSavings ? 1 : 0);
      balRow.style.gridTemplateColumns = `repeat(${visibleCount}, 1fr)`;
    }
  } else {
    // Welfare / admin income only — replace with "Total Contributed"
    // Fetch total contributed from transactions
    sb.from('transactions').select('amount').eq('member_id', memberId).eq('org_id', currentOrg.id)
      .then(({ data: txns }) => {
        const total = (txns||[]).reduce((s,t)=>s+Number(t.amount||0),0);
        if (sharesCard) sharesCard.style.display = 'none';
        if (savingsCard) savingsCard.style.display = 'none';
        if (totalCard) {
          totalCard.style.display = '';
          totalCard.style.gridColumn = '1 / -1';
        }
        const totalLabel = document.getElementById('md-total-label');
        if (totalLabel) totalLabel.textContent = 'Total Contributed';
        document.getElementById('md-total-bal').textContent = 'Ksh ' + total.toLocaleString();
        if (balRow) balRow.style.gridTemplateColumns = '1fr';
      });
  }
  document.getElementById('md-edit-name').value = m.full_name||''
  document.getElementById('md-edit-phone').value = m.phone||'';
  document.getElementById('md-edit-id').value = m.id_number||'';
  document.getElementById('md-edit-date').value = m.join_date||'';
  document.getElementById('md-edit-savings').value = m.savings_tier||500;
  document.getElementById('md-edit-status').value = m.status||'active';
  document.getElementById('md-edit-opening-shares').value = m.opening_shares||0;
  document.getElementById('md-edit-opening-savings').value = m.opening_savings||0;
  document.getElementById('md-edit-reg').value = m.registration_paid?'true':'false';
  // Display number field
  const dispNumEl = document.getElementById('md-edit-display-number');
  if (dispNumEl) dispNumEl.value = m.display_number || '';
  const regDateEl = document.getElementById('md-edit-reg-date');
  const regRenewalEl = document.getElementById('md-edit-reg-renewal');
  if (regDateEl) regDateEl.value = m.registration_date||'';
  if (regRenewalEl) regRenewalEl.value = m.registration_renewal||'';
  // ── Portal Access section — founder vs normal member ──
  const portalNormal = document.getElementById('md-portal-normal');
  const portalFounder = document.getElementById('md-portal-founder');
  const promoteBtn = document.getElementById('promote-btn');
  const saAccountSection = document.getElementById('md-sa-account-section');

  if (isFounder) {
    // Founder: hide email/invite, hide Set Portal Role, show read-only note
    if (portalNormal) portalNormal.style.display = 'none';
    if (portalFounder) portalFounder.style.display = '';
    if (promoteBtn) promoteBtn.style.display = 'none';
    // Email field still needs a value for saveMemberDetail — keep hidden input in sync
    const emailEl = document.getElementById('md-edit-email');
    if (emailEl) emailEl.value = m.portal_email || '';
  } else {
    // Normal member
    if (portalNormal) portalNormal.style.display = '';
    if (portalFounder) portalFounder.style.display = 'none';
    if (promoteBtn) promoteBtn.style.display = isSelf ? 'none' : '';
    document.getElementById('md-edit-email').value = m.portal_email || '';
  }

  // Superadmin account management section — visible for ALL members when superadmin is viewing
  if (saAccountSection) {
    saAccountSection.style.display = isSuperAdmin ? '' : 'none';
    // Clear fields and status
    const saEmail = document.getElementById('md-sa-email');
    const saPwd = document.getElementById('md-sa-password');
    const saStatus = document.getElementById('md-sa-account-status');
    if (saEmail) saEmail.value = '';
    if (saPwd) saPwd.value = '';
    if (saStatus) saStatus.textContent = '';
    // Store the member's auth user_id for the update call
    saAccountSection.dataset.userId = m.user_id || '';
    saAccountSection.dataset.currentEmail = m.portal_email || '';
  }

  const invSt = document.getElementById('md-invite-status');
  if (invSt) invSt.style.display = 'none';
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('adj-date').value = today;

  // Hide admin-only fields when viewing own member record
  const roleField = document.getElementById('md-role-field');
  if (roleField) roleField.style.display = isSelf ? 'none' : '';

  // Role gating — officer/member gets read-only member detail
  const canEdit = canDo('editMember');
  const canInvite = canDo('inviteMember');
  const canSetRole = canDo('setPortalRole');

  // Save Changes button
  const saveBtn = document.querySelector('#modal-memberDetail .btn-primary[onclick="saveMemberDetail()"]');
  if (saveBtn) saveBtn.style.display = canEdit ? '' : 'none';

  // Invite / Send Invite button
  const inviteBtn = document.querySelector('#modal-memberDetail .btn[onclick*="sendMemberPortalInvite"]') ||
    document.querySelector('#modal-memberDetail button[onclick*="sendMemberPortalInvite"]');
  if (inviteBtn) inviteBtn.style.display = canInvite ? '' : 'none';
  const emailInput = document.getElementById('md-edit-email');
  if (emailInput) emailInput.disabled = !canEdit;

  // Set Portal Role button
  const promoteButton = document.getElementById('promote-btn');
  if (promoteButton) promoteButton.style.display = canSetRole && !isSelf ? '' : 'none';

  // All form inputs in member detail — disable for read-only roles
  if (!canEdit) {
    ['md-edit-name','md-edit-phone','md-edit-id','md-edit-date','md-edit-savings',
     'md-edit-status','md-edit-reg','md-edit-display-number','md-edit-reg-date',
     'md-edit-reg-renewal','md-edit-opening-shares','md-edit-opening-savings'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = true;
    });
  }
  const debitCreditTab = document.getElementById('debit-credit-tab');
  if (debitCreditTab) debitCreditTab.style.display = isSelf ? 'none' : '';
  const modalTitle = document.querySelector('#modal-memberDetail .modal-title');
  if (modalTitle) modalTitle.textContent = isSelf ? '👤 My Member Record' : 'Member Details';

  // Dynamic Debit/Credit account options based on org type
  populateMemberAdjOptions();

  // Hide savings/mo field if org has no savings
  const savingsTierRow = document.getElementById('md-savings-tier-row');
  if (savingsTierRow) savingsTierRow.style.display = orgFinProfile.hasSavings ? '' : 'none';

  // Load history
  loadMemberHistory(memberId);
  // Hide debit/credit tab for officers (not admin or treasurer)
  const dcTab = document.getElementById('debit-credit-tab');
  if (dcTab) {
    const canAdjust = ['admin','treasurer','superadmin'].includes(currentProfile?.role);
    dcTab.style.display = canAdjust ? '' : 'none';
  }
  showModal('memberDetail');
}

async function loadMemberHistory(memberId) {
  const [txnRes, adjRes] = await Promise.all([
    sb.from('transactions').select('*,contribution_types(name)').eq('member_id', memberId).order('created_at',{ascending:false}),
    sb.from('balance_adjustments').select('*').eq('member_id', memberId).order('created_at',{ascending:false})
  ]);
  const txns = txnRes.data||[];
  const adjs = adjRes.data||[];
  const combined = [
    ...txns.map(t=>({date:t.transaction_date||t.created_at?.split('T')[0], type:'payment', label:t.contribution_types?.name||'Payment', amount:t.amount, direction:'credit', notes:t.mpesa_ref||t.notes||'—'})),
    ...adjs.map(a=>({date:a.created_at?.split('T')[0], type:'adjustment', label:a.adjustment_type==='shares'?'Shares Adj':'Savings Adj', amount:a.amount, direction:a.direction, notes:a.reason||'—'}))
  ].sort((a,b)=>new Date(b.date)-new Date(a.date));
  document.getElementById('md-history-list').innerHTML = combined.length ? `
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>+/−</th><th>Notes</th></tr></thead>
      <tbody>${combined.map(r=>`<tr>
        <td>${r.date||'—'}</td>
        <td><span class="badge ${r.type==='payment'?'badge-green':r.direction==='credit'?'badge-maroon':'badge-red'}">${r.label}</span></td>
        <td>Ksh ${Number(r.amount).toLocaleString()}</td>
        <td style="color:${r.direction==='credit'?'var(--success)':'var(--danger)'};font-weight:600">${r.direction==='credit'?'+':'−'}</td>
        <td style="font-size:.75rem">${h(r.notes)}</td>
      </tr>`).join('')}</tbody>
    </table>` : '<div style="padding:2rem;text-align:center;color:var(--ink-faint);font-size:.82rem">No history yet</div>';
}

async function saveMemberDetail() {
  if (!canDo('editMember')) { toast('⚠ You do not have permission to edit members.'); return; }
  if (!currentMemberId) return;
  const openingShares = parseFloat(document.getElementById('md-edit-opening-shares').value)||0;
  const openingSavings = parseFloat(document.getElementById('md-edit-opening-savings').value)||0;
  // Get current member to check if opening balances changed
  const { data: current } = await sb.from('members').select('opening_shares,opening_savings,shares_balance,savings_balance').eq('id', currentMemberId).single();
  // Recalculate balances if opening balances changed
  const sharesDiff = openingShares - (current.opening_shares||0);
  const savingsDiff = openingSavings - (current.opening_savings||0);
  const updates = {
    full_name: document.getElementById('md-edit-name').value.trim(),
    phone: document.getElementById('md-edit-phone').value.trim(),
    id_number: document.getElementById('md-edit-id').value.trim(),
    join_date: document.getElementById('md-edit-date').value||null,
    savings_tier: parseInt(document.getElementById('md-edit-savings').value),
    status: document.getElementById('md-edit-status').value,
    registration_paid: document.getElementById('md-edit-reg').value==='true',
    registration_date: document.getElementById('md-edit-reg-date')?.value||null,
    registration_renewal: document.getElementById('md-edit-reg-renewal')?.value||null,
    opening_shares: openingShares,
    opening_savings: openingSavings,
    shares_balance: (current.shares_balance||0) + sharesDiff,
    savings_balance: (current.savings_balance||0) + savingsDiff,
    display_number: document.getElementById('md-edit-display-number')?.value?.trim() || null
  };
  const portalEmail = document.getElementById('md-edit-email')?.value?.trim();
  if (portalEmail) updates.portal_email = portalEmail;
  const { error } = await sb.from('members').update(updates).eq('id', currentMemberId);
  if (error) { toast('Error: '+error.message); return; }
  toast('Member updated successfully');

  await logActivity('UPDATE MEMBER', `Updated member details for ${updates.full_name}${portalEmail?' (portal: '+portalEmail+')':''}`, 'member', currentMemberId);
  closeModal('memberDetail');
  loadMembers();
}

// Helper: link a user (by their auth UUID) to this org via SECURITY DEFINER RPC
// This bypasses RLS — the SQL function checks admin role server-side
async function linkUserToOrg(userId, role, fullName, phone) {
  const { data, error } = await sb.rpc('link_member_to_org', {
    p_user_id:   userId,
    p_org_id:    currentOrg.id,
    p_role:      role || 'member',
    p_full_name: fullName || '',
    p_phone:     phone || '',
  });
  if (error) return { success: false, error: error.message };
  return data || { success: true };
}

async function sendMemberPortalInvite() {
  if (!currentMemberId) return;
  const emailInput = document.getElementById('md-edit-email');
  const statusEl   = document.getElementById('md-invite-status');
  const email = (emailInput?.value || '').trim().toLowerCase();
  if (!email) { toast('Enter the email address first'); return; }

  const setStatus = (msg, ok) => {
    if (!statusEl) return;
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<span style="color:' + (ok ? 'var(--teal)' : 'var(--maroon)') + '">' + msg + '</span>';
  };
  setStatus('⏳ Processing…', true);

  await sb.from('members').update({ portal_email: email }).eq('id', currentMemberId);
  const { data: m } = await sb.from('members').select('full_name,phone').eq('id', currentMemberId).single();
  const appUrl = 'https://app.groupyetu.org/';

  try {
    // ── Look up existing user by phone in profiles ────────────────────
    let existingUserId = null;

    if (m?.phone) {
      const { data: phoneMatches } = await sb.from('profiles')
        .select('id').eq('phone', m.phone);

      if (phoneMatches && phoneMatches.length > 0) {
        existingUserId = phoneMatches[0].id;

        const { data: existingGrant } = await sb.from('user_orgs')
          .select('user_id').eq('user_id', existingUserId).eq('org_id', currentOrg.id).maybeSingle();

        if (existingGrant) {
          setStatus('✓ Already linked — this member can already access this org', true);
          toast((m.full_name || 'Member') + ' is already linked to this org');
          return;
        }
      }
    }

    if (existingUserId) {
      // ── EXISTING USER — link via RPC (bypasses RLS) ──────────────────
      const result = await linkUserToOrg(existingUserId, 'member', m?.full_name, m?.phone);
      if (result.success) {
        setStatus('✓ Linked — this org added to their workspaces', true);
        toast('✓ ' + (m?.full_name || 'Member') + ' linked — they can switch to this org at next login');
        await logActivity('PORTAL LINKED', 'Linked ' + email + ' to this org', 'member', currentMemberId);
      } else {
        setStatus('✗ ' + (result.error || 'Link failed'), false);
        toast('Error: ' + (result.error || 'Link failed'));
      }

    } else {
      // ── NEW USER — sign up + send confirmation email ─────────────────
      const tempPw = Math.random().toString(36).slice(2, 10) + 'Aa1!';
      const { data: authData, error: signUpErr } = await sb.auth.signUp({
        email, password: tempPw,
        options: {
          data: {
            full_name: m?.full_name || '',
            invite_org_id: currentOrg.id,
            invite_org_name: currentOrg.name,
            invite_member_id: currentMemberId
          },
          emailRedirectTo: appUrl + '?intent=invite'
        }
      });

      if (signUpErr) {
        // Account already exists — link them directly, no email needed
        setStatus('⚠ Account exists — please use "Link Existing User" instead', false);
        toast('Account already exists for ' + email);
        return;
      }

      if (authData?.user?.id) {
        await linkUserToOrg(authData.user.id, 'member', m?.full_name, m?.phone);
      }

      setStatus('✓ Invite sent — ' + (m?.full_name || email) + ' will receive an email to set their password', true);
      toast('✓ Invite sent to ' + email);
      await logActivity('PORTAL INVITE', 'Sent invite to ' + email, 'member', currentMemberId);
    }

  } catch(e) {
    setStatus('✗ ' + e.message, false);
    toast('Error: ' + e.message);
  }
}

async function promoteToAdmin() {
  if (!currentMemberId) return;
  const isSuperAdmin = currentProfile?.role === 'superadmin';
  const { data: m } = await sb.from('members').select('full_name,portal_email,phone,is_founder,user_id').eq('id', currentMemberId).single();
  if (!m) return;

  // profiles lookup here only confirms a portal account exists (existingProfile.id) —
  // the actual role shown/changed is org-scoped, fetched from user_orgs below.
  let existingProfile = null;
  if (m.user_id) {
    const { data: prof } = await sb.from('profiles').select('id,full_name').eq('id', m.user_id).maybeSingle();
    existingProfile = prof;
  }
  if (!existingProfile && m.portal_email) {
    // Match by email: find profile whose auth user has this email
    // profiles.id = auth.users.id, and portal_email is stored on members.
    // Fetch all org profiles and match by full_name + phone as best proxy,
    // OR look up by portal_email stored on OTHER members with same user_id
    const { data: profs } = await sb.from('profiles').select('id,full_name,phone').eq('org_id', currentOrg.id);
    if (profs) {
      // Try phone match first (most reliable), then name match
      existingProfile = profs.find(p => m.phone && p.phone && p.phone === m.phone)
        || profs.find(p => p.full_name?.toLowerCase().trim() === m.full_name?.toLowerCase().trim())
        || null;
    }
  }

  let currentRole = 'no portal account';
  if (existingProfile?.id) {
    const { data: grant } = await sb.from('user_orgs').select('role').eq('user_id', existingProfile.id).eq('org_id', currentOrg.id).maybeSingle();
    currentRole = grant?.role || 'no workspace access';
  }

  // Build role buttons — founder change restricted to superadmin
  const roles = ['admin','treasurer','officer','member'];
  const isFounder = m.is_founder;
  if (isFounder && !isSuperAdmin) {
    toast("⚠ Only the platform SuperAdmin can change the founding member's role.");
    return;
  }

  // Show role picker modal
  const overlay = document.createElement('div');
  overlay.id = 'role-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:1.75rem;max-width:380px;width:90%;box-shadow:0 24px 64px rgba(0,0,0,.2)">
      <div style="font-size:1rem;font-weight:700;color:#1a1a1a;margin-bottom:.3rem">Change Portal Role</div>
      <div style="font-size:.78rem;color:#666;margin-bottom:1.25rem">
        <strong>${h(m.full_name)}</strong>${isFounder ? ' <span style="color:#800020;font-size:.7rem;font-weight:700">FOUNDER</span>' : ''}<br>
        Current role: <strong style="text-transform:capitalize">${h(currentRole)}</strong>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:1.25rem">
        ${roles.map(r => `
          <button onclick="confirmRoleChange('${r}')" style="
            padding:.65rem;border-radius:8px;border:2px solid ${currentRole===r?'#800020':'#e0e0e0'};
            background:${currentRole===r?'#fff5f7':'#fafafa'};color:${currentRole===r?'#800020':'#333'};
            font-size:.82rem;font-weight:${currentRole===r?'700':'500'};cursor:pointer;
            text-transform:capitalize;transition:all .15s"
            onmouseover="this.style.borderColor='#800020';this.style.background='#fff5f7'"
            onmouseout="if('${r}'!=='${currentRole}'){this.style.borderColor='#e0e0e0';this.style.background='#fafafa'}">
            ${r==='admin'?'🔑 ':r==='treasurer'?'💰 ':r==='officer'?'📋 ':'👤 '}${r.charAt(0).toUpperCase()+r.slice(1)}
          </button>`).join('')}
      </div>
      ${isFounder && isSuperAdmin ? `
        <div style="background:#fff5f7;border:1px solid #f0c0c0;border-radius:6px;padding:.6rem .85rem;font-size:.72rem;color:#800020;margin-bottom:1rem">
          ⚠ You are changing the founding member's role. This will affect their admin access.
        </div>` : ''}
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button onclick="document.getElementById('role-picker-overlay').remove()" style="padding:.5rem 1rem;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:.82rem">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  window._roleChangeMember = { m, existingProfile };
}

async function confirmRoleChange(role) {
  const overlay = document.getElementById('role-picker-overlay');
  if (overlay) overlay.remove();
  const { m, existingProfile } = window._roleChangeMember || {};
  if (!m || !role) return;

  const confirmed = confirm(`Change ${m.full_name}'s role to "${role.toUpperCase()}"?

This will take effect immediately on their next login.`);
  if (!confirmed) return;

  try {
    if (existingProfile?.id) {
      // Org-scoped role only — profiles.role is the platform-wide account status
      // (member/admin/superadmin/pending) and must NEVER be set from a per-org
      // role picker. A user can be admin in one org and a plain member in another;
      // writing here into profiles.role previously corrupted that per-org distinction.
      const { error, count } = await sb.from('user_orgs')
        .update({ role })
        .eq('user_id', existingProfile.id)
        .eq('org_id', currentOrg.id)
        .select('*', { count: 'exact' });

      if (error) {
        toast('❌ Role change failed: ' + error.message);
        return;
      }
      if (!count) {
        toast('⚠ No matching workspace grant found — this member may not be linked to this org yet.');
        return;
      }
      toast(`✓ ${m.full_name} is now ${role}`);
    } else {
      // No portal account yet — need to invite them first
      toast('⚠ This member has no portal account yet. Send them a portal invite first, then change their role.');
      return;
    }
    await logActivity('SET ROLE', `Changed ${m.full_name} role in this org to ${role}`, 'member', currentMemberId);
    loadMembers();
  } catch(e) {
    toast('❌ Role change failed: ' + e.message);
  }
}

async function saveAdjustment() {
  if (!currentMemberId) return;
  const adjType = document.getElementById('adj-type').value;
  const direction = document.getElementById('adj-direction').value;
  const amount = parseFloat(document.getElementById('adj-amount').value);
  const reason = document.getElementById('adj-reason').value.trim();
  if (!amount || amount <= 0) { toast('Please enter a valid amount'); return; }
  if (!reason) { toast('Please enter a reason for this adjustment'); return; }
  // Save adjustment record
  const { error: adjErr } = await sb.from('balance_adjustments').insert({
    org_id: currentOrg.id,
    member_id: currentMemberId,
    adjustment_type: adjType,
    direction,
    amount,
    reason,
    recorded_by: currentUser.id
  });
  if (adjErr) { toast('Error: '+adjErr.message); return; }
  // Update member balance
  const { data: member } = await sb.from('members').select('shares_balance,savings_balance').eq('id', currentMemberId).single();
  const balField = balFieldMap[adjType] || 'savings_balance';
  const currentBal = member[balField] || 0;
  const newBal = direction==='credit'?currentBal+amount:Math.max(0,currentBal-amount);
  await sb.from('members').update({ [balField]: newBal }).eq('id', currentMemberId);
  toast(`${direction==='credit'?'Credit':'Debit'} of Ksh ${amount.toLocaleString()} applied to ${adjType}`);
  // Log this sensitive action
  const { data: m } = await sb.from('members').select('full_name').eq('id', currentMemberId).maybeSingle();
  await logActivity(
    `${direction.toUpperCase()} ${adjType}`,
    `${direction==='credit'?'Credited':'Debited'} Ksh ${amount.toLocaleString()} ${adjType} for ${m?.full_name||'member'}. Reason: ${reason}`,
    'member', currentMemberId
  );
  // Refresh display
  const { data: updated } = await sb.from('members').select('shares_balance,savings_balance').eq('id', currentMemberId).single();
  document.getElementById('md-shares-bal').textContent = 'Ksh ' + (updated.shares_balance||0).toLocaleString();
  document.getElementById('md-savings-bal').textContent = 'Ksh ' + (updated.savings_balance||0).toLocaleString();
  document.getElementById('md-total-bal').textContent = 'Ksh ' + ((updated.shares_balance||0)+(updated.savings_balance||0)).toLocaleString();
  document.getElementById('adj-amount').value = '';
  document.getElementById('adj-reason').value = '';
  loadMemberHistory(currentMemberId);
  loadMembers();
}

async function deleteMember() {
  if (!currentMemberId) return;
  // Only superadmin can delete members
  if (currentProfile?.role !== 'superadmin') {
    toast('⚠ Only the platform SuperAdmin can delete members.');
    return;
  }
  const { data: m } = await sb.from('members').select('full_name,is_founder,user_id,org_id').eq('id', currentMemberId).single();
  if (!m) return;
  const confirmMsg = m.is_founder
    ? `SUPERADMIN ACTION: You are about to remove the FOUNDING MEMBER (${m.full_name}). This is irreversible. Are you absolutely sure?`
    : `Delete ${m.full_name}? This will permanently remove all their records. This cannot be undone.`;
  if (!confirm(confirmMsg)) return;
  try {
    // Clear pending_members FK reference first to avoid constraint violation
    await sb.from('pending_members').update({ linked_member_id: null }).eq('linked_member_id', currentMemberId);
    const { error: e1 } = await sb.from('balance_adjustments').delete().eq('member_id', currentMemberId);
    if (e1) console.warn('balance_adjustments delete:', e1.message);
    const { error: e2 } = await sb.from('transactions').delete().eq('member_id', currentMemberId);
    if (e2) console.warn('transactions delete:', e2.message);
    const { error: e3 } = await sb.from('attendance').delete().eq('member_id', currentMemberId);
    if (e3) console.warn('attendance delete:', e3.message);
    const { error: e4 } = await sb.from('members').delete().eq('id', currentMemberId);
    if (e4) { toast('❌ Could not delete member: ' + e4.message); return; }
    // Remove the actual workspace grant — without this, the person still shows up
    // as belonging to this org platform-wide (in All Members / their own picker)
    // even though their member record is gone. This was the real bug.
    if (m.user_id && m.org_id) {
      const { error: e5 } = await sb.from('user_orgs').delete().eq('user_id', m.user_id).eq('org_id', m.org_id);
      if (e5) console.warn('user_orgs delete:', e5.message);

      // profiles.org_id is a separate legacy single-org field the login flow falls
      // back to when user_orgs is empty — if it's left pointing at this org, login
      // silently recreates the exact user_orgs row we just deleted above. Only clear
      // it if it actually matches this org (don't touch it if they have a different
      // primary org elsewhere).
      const { data: prof } = await sb.from('profiles').select('org_id').eq('id', m.user_id).maybeSingle();
      if (prof?.org_id === m.org_id) {
        await sb.from('profiles').update({ org_id: null }).eq('id', m.user_id);
      }
    }
    await logActivity('DELETE MEMBER', `Deleted member: ${m.full_name}${m.is_founder?' [FOUNDER]':''}`, 'member', currentMemberId);
    toast(m.full_name + ' removed');
    closeModal('memberDetail');
    currentMemberId = null;
    loadMembers();
  } catch(e) {
    toast('❌ Delete failed: ' + e.message);
  }
}

async function saUpdateMemberAccount() {
  // Superadmin only — updates auth email and/or password via edge function
  if (currentProfile?.role !== 'superadmin') {
    toast('⚠ Superadmin only');
    return;
  }
  const section = document.getElementById('md-sa-account-section');
  const userId = section?.dataset.userId;
  const currentEmail = section?.dataset.currentEmail;
  const newEmail = document.getElementById('md-sa-email')?.value?.trim();
  const newPassword = document.getElementById('md-sa-password')?.value;
  const statusEl = document.getElementById('md-sa-account-status');

  if (!userId) {
    if (statusEl) { statusEl.textContent = '⚠ No auth account linked to this member yet.'; statusEl.style.color = 'var(--warning)'; }
    return;
  }
  if (!newEmail && !newPassword) {
    if (statusEl) { statusEl.textContent = 'Enter a new email or password.'; statusEl.style.color = 'var(--ink-faint)'; }
    return;
  }

  if (statusEl) { statusEl.textContent = 'Updating…'; statusEl.style.color = 'var(--ink-faint)'; }

  try {
    const session = await sb.auth.getSession();
    const jwt = session?.data?.session?.access_token;

    const body = { user_id: userId };
    if (newEmail) body.email = newEmail;
    if (newPassword) body.password = newPassword;

    const res = await fetch('https://eengldzvvgplgzvbutal.supabase.co/functions/v1/admin-user-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify(body)
    });

    const result = await res.json();

    if (!res.ok || result.error) {
      if (statusEl) { statusEl.textContent = '✗ ' + (result.error || 'Update failed'); statusEl.style.color = 'var(--danger)'; }
      return;
    }

    // If email changed, update the members table too
    if (newEmail) {
      await sb.from('members').update({ portal_email: newEmail }).eq('id', currentMemberId);
    }

    if (statusEl) {
      statusEl.textContent = '✓ ' + [newEmail ? `Email → ${newEmail}` : '', newPassword ? 'Password updated' : ''].filter(Boolean).join(' · ');
      statusEl.style.color = 'var(--success)';
    }
    // Clear fields
    if (document.getElementById('md-sa-email')) document.getElementById('md-sa-email').value = '';
    if (document.getElementById('md-sa-password')) document.getElementById('md-sa-password').value = '';

    await logActivity('SA ACCOUNT UPDATE', `Superadmin updated auth account for member ${currentMemberId}${newEmail?' — email changed':''}${newPassword?' — password reset':''}`, 'member', currentMemberId);

  } catch(e) {
    if (statusEl) { statusEl.textContent = '✗ ' + e.message; statusEl.style.color = 'var(--danger)'; }
  }
}


/* ════ DYNAMIC MEMBER DETAIL — based on org financial profile
════════════════════════════════════════════════════ */
function populateMemberAdjOptions() {
  const fp = orgFinProfile;
  const adjType = document.getElementById('adj-type');
  const adjForm = document.getElementById('md-adj-form');
  const noBalMsg = document.getElementById('md-no-balances-msg');
  const savingsTierRow = document.getElementById('md-savings-tier-row');
  const openingRow = document.getElementById('md-opening-balances-row');
  const openingSharesLabel = document.getElementById('md-opening-shares-label');
  const openingSavingsLabel = document.getElementById('md-opening-savings-label');

  // Debit/Credit form visibility
  const hasMemberBalance = fp.hasShares || fp.hasSavings;
  if (adjForm) adjForm.style.display = hasMemberBalance ? '' : 'none';
  if (noBalMsg) noBalMsg.style.display = hasMemberBalance ? 'none' : 'block';

  // Dynamic account type options
  if (adjType && hasMemberBalance) {
    const opts = [];
    if (fp.hasShares) opts.push(`<option value="shares">${fp.sharesLabel || 'Shares'}</option>`);
    if (fp.hasSavings) opts.push(`<option value="savings">${fp.savingsLabel || 'Savings'}</option>`);
    adjType.innerHTML = opts.join('');
  }

  // Savings/mo field — only for savings orgs
  if (savingsTierRow) savingsTierRow.style.display = fp.hasSavings ? '' : 'none';

  // Opening balances — only show relevant ones
  if (openingRow) {
    openingRow.style.display = hasMemberBalance ? '' : 'none';
    // Show only shares column if no savings
    const sharesInput = document.getElementById('md-edit-opening-shares');
    const savingsInput = document.getElementById('md-edit-opening-savings');
    const sharesGroup = sharesInput?.parentElement;
    const savingsGroup = savingsInput?.parentElement;
    if (sharesGroup) sharesGroup.style.display = fp.hasShares ? '' : 'none';
    if (savingsGroup) savingsGroup.style.display = fp.hasSavings ? '' : 'none';
    if (openingSharesLabel) openingSharesLabel.textContent = 'Opening ' + (fp.sharesLabel || 'Shares') + ' Balance';
    if (openingSavingsLabel) openingSavingsLabel.textContent = 'Opening ' + (fp.savingsLabel || 'Savings') + ' Balance';
  }
}

