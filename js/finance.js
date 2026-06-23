// GroupYetu360 — js/finance.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── FINANCE ──
async function loadFinance() {
  if (!currentOrg?.id) return;

  // ── Role gating for finance page ──
  const canRecord = canDo('recordPayment');
  // Record Payment tab — hide for officer/member
  const recordTab = document.querySelector('.fin-tab.record');
  if (recordTab) recordTab.style.display = canRecord ? '' : 'none';
  // Record Payment topbar button
  const recPayBtn = document.querySelector('[onclick*="recordPayment"]');
  if (recPayBtn && recPayBtn.closest('header')) recPayBtn.style.display = canRecord ? '' : 'none';
  // Expense, fine, withdrawal controls
  ['fin-shareout-btn','fin-withdraw-pill','withdraw-toggle-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el && !canRecord) el.style.display = 'none';
  });
  // Delete transaction buttons — rendered later, handled via event delegation below
  document.querySelectorAll('.txn-delete-btn').forEach(b => { b.style.display = canRecord ? '' : 'none'; });

  // Hero org name
  const heroOrg = document.getElementById('fin-hero-org');
  if (heroOrg) heroOrg.textContent = currentOrg.name + ' — ' + new Date().getFullYear() + ' Financial Year';

  // Dynamic finance controls — hide shareout/withdraw if no member savings
  const fp = orgFinProfile;
  const shareoutBtn = document.getElementById('fin-shareout-btn');
  const withdrawPill = document.getElementById('fin-withdraw-pill');
  if (shareoutBtn) shareoutBtn.style.display = fp.hasSavings ? '' : 'none';
  if (withdrawPill) withdrawPill.style.display = fp.hasSavings ? '' : 'none';

  // Withdraw window status
  const wBtn = document.getElementById('withdraw-toggle-btn');
  const wLabel = document.getElementById('withdraw-status-label');
  const wDot = document.getElementById('fin-withdraw-dot');
  const isOpen = currentOrg?.withdraw_enabled || false;
  if (wBtn) wBtn.textContent = isOpen ? 'Close' : 'Open';
  if (wLabel) wLabel.textContent = isOpen ? 'OPEN' : 'Closed';
  if (wDot) wDot.classList.toggle('open', isOpen);
  // Update income project dropdown
  const incProj = document.getElementById('inc-project');
  if (incProj) {
    incProj.innerHTML = '<option value="">None</option>' + allProjects.map(p=>`<option value="${p.name}">${p.name}</option>`).join('');
  }
  const [txnRes, expRes] = await Promise.all([
    sb.from('transactions').select('*,members(full_name),contribution_types(name)').eq('org_id', currentOrg.id).order('created_at',{ascending:false}),
    sb.from('expenses').select('*').eq('org_id', currentOrg.id).order('created_at',{ascending:false})
  ]);
  const txns = txnRes.data || [];
  const allExps = expRes.data || [];
  const incomes = allExps.filter(e => e.entry_type === 'income');
  const expenses = allExps.filter(e => e.entry_type !== 'income');

  // Summary stats
  const totalContrib = txns.reduce((s,t)=>s+Number(t.amount||0),0);
  const totalIncome = incomes.reduce((s,e)=>s+Number(e.amount||0),0);
  const totalExp = expenses.reduce((s,e)=>s+Number(e.amount||0),0);
  const net = totalContrib + totalIncome - totalExp;

  const setEl = (id,val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  setEl('fin-total-contrib', 'Ksh '+totalContrib.toLocaleString());
  setEl('fin-total-income', 'Ksh '+totalIncome.toLocaleString());
  setEl('fin-total-exp', 'Ksh '+totalExp.toLocaleString());
  const netEl = document.getElementById('fin-net');
  if (netEl) {
    netEl.textContent = 'Ksh '+Math.abs(net).toLocaleString();
    netEl.style.color = net >= 0 ? 'var(--success)' : 'var(--danger)';
  }

  // ── Balance breakdown — dynamic based on org type ──
  const hasMemberBalances = fp.hasShares || fp.hasSavings;

  // Member balances card — only show if org has shares or savings types
  const memberCard = document.getElementById('fin-member-card');
  const memberEl = document.getElementById('fin-member-balance');
  const memberLabel = document.getElementById('fin-member-label');
  const memberNote = document.getElementById('fin-member-note');

  if (memberCard) memberCard.style.display = hasMemberBalances ? '' : 'none';

  const { data: memberBals } = await sb.from('members')
    .select('shares_balance,savings_balance').eq('org_id', currentOrg.id);
  const totalMemberBal = hasMemberBalances
    ? (memberBals||[]).reduce((s,m) => s + Number(m.shares_balance||0) + Number(m.savings_balance||0), 0)
    : 0;

  if (hasMemberBalances && memberEl) {
    memberEl.textContent = 'Ksh ' + totalMemberBal.toLocaleString();
    // Update label and note to be specific
    if (memberLabel) {
      memberLabel.textContent = fp.hasShares && fp.hasSavings ? '👥 Member Balances'
        : fp.hasShares ? `👥 ${fp.sharesLabel} Balances`
        : `👥 ${fp.savingsLabel} Balances`;
    }
    if (memberNote) {
      memberNote.textContent = fp.hasShares && fp.hasSavings ? 'Savings + shares'
        : fp.hasShares ? 'Member equity'
        : 'Member deposits';
    }
  }

  // Admin balance card — always show, but label changes by org type
  const bankBalance = currentOrg?.bank_balance || net;
  const adminBalance = bankBalance - totalMemberBal;
  const adminEl = document.getElementById('fin-admin-balance');
  const adminCard = document.getElementById('fin-admin-card');
  const adminNote = document.getElementById('fin-admin-note');

  const bankEl = document.getElementById('fin-bank-balance');
  if (bankEl) bankEl.textContent = 'Ksh ' + Math.abs(bankBalance).toLocaleString();
  if (memberEl && hasMemberBalances) memberEl.textContent = 'Ksh ' + totalMemberBal.toLocaleString();

  if (adminEl) {
    if (!hasMemberBalances) {
      // Welfare / subscription only — admin balance = total bank balance
      adminEl.textContent = 'Ksh ' + Math.abs(bankBalance).toLocaleString();
      adminEl.style.color = 'var(--teal)';
      if (adminCard) adminCard.style.borderTopColor = 'var(--teal)';
      if (adminNote) adminNote.textContent = fp.hasAdminIncome
        ? `Total ${fp.adminIncomeLabel} collected`
        : 'Group funds';
    } else {
      adminEl.textContent = (adminBalance < 0 ? '-' : '') + 'Ksh ' + Math.abs(adminBalance).toLocaleString();
      adminEl.style.color = adminBalance < 0 ? 'var(--danger)' : 'var(--success)';
      if (adminCard) adminCard.style.borderTopColor = adminBalance < 0 ? 'var(--danger)' : 'var(--gold)';
      if (adminNote) adminNote.textContent = adminBalance < 0
        ? '⚠ Negative — member funds used for group expenses'
        : 'Group-retained earnings above member balances';
    }
  }

  // Contributions table
  const txnEl = document.getElementById('txn-table');
  if (txnEl) txnEl.innerHTML = txns.length ? txns.map(t => `
    <tr>
      <td>${t.transaction_date||t.created_at?.split('T')[0]||'—'}</td>
      <td>${t.members?.full_name||'—'}</td>
      <td><span class="badge badge-green">${t.contribution_types?.name||'Payment'}</span></td>
      <td><strong>Ksh ${Number(t.amount).toLocaleString()}</strong></td>
      <td>${t.mpesa_ref||'—'}</td>
      <td>${t.notes||'—'}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--ink-faint)">No contributions recorded yet</td></tr>';

  // Income table
  const incEl = document.getElementById('income-table');
  if (incEl) incEl.innerHTML = incomes.length ? incomes.map(e => `
    <tr>
      <td>${e.expense_date||e.created_at?.split('T')[0]||'—'}</td>
      <td><span class="badge badge-green">${e.category||'—'}</span></td>
      <td>${e.description||'—'}</td>
      <td><strong>Ksh ${Number(e.amount).toLocaleString()}</strong></td>
      <td>${e.mpesa_ref||'—'}</td>
      <td>${e.project||'—'}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--ink-faint)">No income recorded yet</td></tr>';

  // Expenses table
  const expEl = document.getElementById('exp-table');
  if (expEl) expEl.innerHTML = expenses.length ? expenses.map(e => `
    <tr>
      <td>${e.expense_date||e.created_at?.split('T')[0]||'—'}</td>
      <td><span class="badge badge-warn">${e.category||'—'}</span></td>
      <td>${e.description||'—'}</td>
      <td><strong>Ksh ${Number(e.amount).toLocaleString()}</strong></td>
      <td>${e.mpesa_ref||'—'}</td>
      <td>${e.project||'—'}</td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:2rem;color:var(--ink-faint)">No expenses yet</td></tr>';

  // Populate mobile finance shell
  if (typeof populateFinMob === 'function') populateFinMob();
}

async function saveTransaction() {
  if (!canDo('recordPayment')) { toast('⚠ You do not have permission to record payments.'); return; }
  if (!currentOrg?.id) return;
  const memberId = document.getElementById('pay-member').value || null;
  const typeId = document.getElementById('pay-type').value || null;
  const amount = parseFloat(document.getElementById('pay-amount').value);
  const payload = {
    org_id: currentOrg.id,
    member_id: memberId,
    type_id: typeId,
    amount,
    mpesa_ref: document.getElementById('pay-ref').value.trim() || null,
    transaction_date: document.getElementById('pay-date').value || null,
    notes: document.getElementById('pay-notes').value.trim() || null,
    recorded_by: currentUser.id
  };
  if (!amount) { toast('Please enter an amount'); return; }
  const { error } = await sb.from('transactions').insert(payload);
  if (error) { toast('Error: ' + error.message); return; }
  // Update member balance — use income_type to determine what to update
  if (memberId && typeId) {
    const contribType = allContribTypes.find(t => t.id === typeId);
    const incomeType = contribType?.income_type || (contribType?.is_member_income !== false ? 'member_savings' : 'admin_income');
    const isMemberBalance = ['member_shares','member_savings'].includes(incomeType);
    if (contribType && isMemberBalance) {
      const { data: member } = await sb.from('members').select('shares_balance,savings_balance').eq('id', memberId).single();
      if (member) {
        const updates = {};
        if (incomeType === 'member_shares' || contribType.name.toLowerCase().includes('share')) {
          updates.shares_balance = (member.shares_balance||0) + amount;
        } else if (incomeType === 'member_savings' || contribType.name.toLowerCase().includes('saving')) {
          updates.savings_balance = (member.savings_balance||0) + amount;
        }
        if (Object.keys(updates).length) {
          await sb.from('members').update(updates).eq('id', memberId);
        }
      }
    }
  }
  // Auto-update bank balance
  const totalRecorded = parseFloat(document.getElementById('pay-amount')?.value)||0;
  if (totalRecorded > 0) await updateBankBalance(currentOrg.id, totalRecorded, 'credit');
  toast('Payment recorded successfully');
  clearPayForm();
  loadFinance();
  loadDashboard();
}

async function saveModalTransaction() {
  if (!currentOrg?.id) return;
  const payload = {
    org_id: currentOrg.id,
    member_id: document.getElementById('modal-pay-member').value || null,
    type_id: document.getElementById('modal-pay-type').value || null,
    amount: parseFloat(document.getElementById('modal-pay-amount').value),
    mpesa_ref: document.getElementById('modal-pay-ref').value.trim() || null,
    transaction_date: document.getElementById('modal-pay-date').value || null,
    recorded_by: currentUser.id
  };
  if (!payload.amount) { toast('Please enter an amount'); return; }
  const { error } = await sb.from('transactions').insert(payload);
  if (error) { toast('Error: ' + error.message); return; }
  await updateBankBalance(currentOrg.id, payload.amount, 'credit');
  toast('Payment recorded');
  closeModal('recordPayment');
  loadFinance(); loadDashboard();
}

// ── INCOME ──
async function saveIncome() {
  if (!currentOrg?.id) return;
  const payload = {
    org_id: currentOrg.id,
    category: document.getElementById('inc-category').value.trim(),
    description: document.getElementById('inc-desc').value.trim(),
    amount: parseFloat(document.getElementById('inc-amount').value),
    mpesa_ref: document.getElementById('inc-ref').value.trim()||null,
    expense_date: document.getElementById('inc-date').value||null,
    project: document.getElementById('inc-project').value||null,
    notes: document.getElementById('inc-notes').value.trim()||null,
    recorded_by: currentUser.id,
    entry_type: 'income'
  };
  if (!payload.amount||!payload.category) { toast('Please enter category and amount'); return; }
  const { error } = await sb.from('expenses').insert(payload);
  if (error) { toast('Error: '+error.message); return; }
  await updateBankBalance(currentOrg.id, payload.amount, 'credit');
  toast('Income recorded successfully');
  clearIncForm();
  loadFinance();
  loadDashboard();
}

function clearIncForm() {
  ['inc-category','inc-desc','inc-amount','inc-ref','inc-notes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const ip=document.getElementById('inc-project'); if(ip) ip.value='';
}

async function saveExpense() {
  if (!currentOrg?.id) return;
  const payload = {
    org_id: currentOrg.id,
    category: document.getElementById('exp-category').value.trim(),
    description: document.getElementById('exp-desc').value.trim(),
    amount: parseFloat(document.getElementById('exp-amount').value),
    mpesa_ref: document.getElementById('exp-ref').value.trim() || null,
    expense_date: document.getElementById('exp-date').value || null,
    project: document.getElementById('exp-project').value || null,
    recorded_by: currentUser.id,
    entry_type: 'expense'
  };
  if (!payload.amount || !payload.description) { toast('Please fill in description and amount'); return; }
  const { error } = await sb.from('expenses').insert(payload);
  if (error) { toast('Error: ' + error.message); return; }
  await logActivity('RECORD EXPENSE', `Recorded expense: ${payload.category} - ${payload.description} Ksh ${payload.amount}`, 'expense');
  // Save transaction charges if any
  const charges = parseFloat(document.getElementById('exp-charges')?.value)||0;
  if (charges > 0) {
    await sb.from('expenses').insert({
      org_id: currentOrg.id,
      category: 'Bank/Transaction Charges',
      description: `Charges on: ${payload.description}`,
      amount: charges,
      expense_date: payload.expense_date,
      recorded_by: currentUser.id,
      entry_type: 'expense'
    });
  }
  const totalExpense = payload.amount + charges;
  await updateBankBalance(currentOrg.id, totalExpense, 'debit');
  toast('Expense recorded' + (charges > 0 ? ` + Ksh ${charges} charges` : ''));
  clearExpForm(); loadFinance(); loadDashboard();
}


/* ═══════════════ FINES & PENALTIES ═══════════════ */
function setFineReason(r){const el=document.getElementById('fine-reason');if(el){el.value=r;el.focus();}}
function clearFineForm(){['fine-member','fine-amount','fine-notes','fine-reason'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});}

async function saveFine(){
  if(!currentOrg?.id)return;
  const memberId=document.getElementById('fine-member')?.value;
  const reason=document.getElementById('fine-reason')?.value?.trim();
  const amount=parseFloat(document.getElementById('fine-amount')?.value);
  const date=document.getElementById('fine-date')?.value;
  const notes=document.getElementById('fine-notes')?.value?.trim();
  if(!memberId){toast('Please select a member');return;}
  if(!reason){toast('Please enter a reason');return;}
  if(!amount||amount<=0){toast('Please enter an amount');return;}
  const{error}=await sb.from('fines').insert({org_id:currentOrg.id,member_id:memberId,reason,amount,status:'pending',notes:notes||null,issued_date:date||new Date().toISOString().split('T')[0],issued_by:currentUser.id});
  if(error){toast('Error: '+error.message);return;}
  const member=allMembers.find(m=>m.id===memberId);
  await logActivity('FINE ISSUED',`Fined ${member?.full_name||'member'} Ksh ${amount.toLocaleString()} — ${reason}`,'member',memberId);
  toast(`✓ Fine of Ksh ${amount.toLocaleString()} issued — PENDING`);
  clearFineForm();loadFinesLedger();
}

async function loadFinesLedger(){
  const contentEl=document.getElementById('fines-ledger-content');
  const subEl=document.getElementById('fines-ledger-sub');
  if(!contentEl||!currentOrg?.id)return;
  contentEl.innerHTML='<div class="loading"><div class="spinner"></div>Loading…</div>';
  const filter=document.getElementById('fines-filter')?.value||'all';
  let q=sb.from('fines').select('*,members(full_name,member_number,shares_balance,savings_balance)').eq('org_id',currentOrg.id).order('created_at',{ascending:false});
  if(filter!=='all')q=q.eq('status',filter);
  const{data}=await q;
  const all=data||[];
  const pending=all.filter(f=>f.status==='pending');
  const totalOwed=pending.reduce((s,f)=>s+Number(f.amount||0),0);
  const totalAll=all.reduce((s,f)=>s+Number(f.amount||0),0);
  if(subEl)subEl.textContent=`${all.length} fine${all.length!==1?'s':''} · ${pending.length} pending (Ksh ${totalOwed.toLocaleString()} outstanding) · Ksh ${totalAll.toLocaleString()} total`;
  if(!all.length){contentEl.innerHTML=`<div style="padding:3rem;text-align:center"><div style="font-size:2.5rem;margin-bottom:.75rem">⚠</div><div style="font-size:.88rem;font-weight:600">No fines yet</div><div style="font-size:.78rem;color:var(--ink-faint)">Use ⚠ Issue Fine tab</div></div>`;return;}
  const hasMemberBal=orgFinProfile.hasShares||orgFinProfile.hasSavings;
  contentEl.innerHTML=`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Member</th><th>Reason</th><th>Amount</th><th>Status</th><th>Actions</th></tr></thead><tbody>${all.map(f=>{
    const initials=(f.members?.full_name||'?').split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    const dateStr=f.issued_date||f.created_at?.split('T')[0]||'—';
    const paidInfo=f.paid_date?' · '+f.paid_date:'';
    const badge={pending:'<span class="badge badge-warn">⏳ Pending</span>',paid:'<span class="badge badge-green">✓ Paid</span>',recovered:'<span class="badge badge-maroon">↩ Recovered</span>',waived:'<span class="badge badge-grey">— Waived</span>'}[f.status]||f.status;
    const memberBal=Number(f.members?.shares_balance||0)+Number(f.members?.savings_balance||0);
    const canRecover=hasMemberBal&&f.status==='pending'&&memberBal>=Number(f.amount);
    const actions=f.status==='pending'
      ?`<div style="display:flex;gap:.35rem;flex-wrap:wrap"><button class="btn btn-primary btn-sm" style="font-size:.68rem;background:var(--teal)" onclick="markFinePaid('${f.id}')">✓ Mark Paid</button>${canRecover?`<button class="btn btn-secondary btn-sm" style="font-size:.68rem" onclick="recoverFineFromBalance('${f.id}')">↩ Recover</button>`:''}<button class="btn btn-secondary btn-sm" style="font-size:.68rem" onclick="waiveFine('${f.id}')">— Waive</button><button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="deleteFine('${f.id}')">✕</button></div>`
      :`<span style="font-size:.72rem;color:var(--ink-faint)">${f.recovery_method?'via '+f.recovery_method:''}${paidInfo}</span>`;
    return `<tr><td style="font-size:.78rem;color:var(--ink-faint);white-space:nowrap">${dateStr}</td><td><div style="display:flex;align-items:center;gap:.55rem"><div style="width:28px;height:28px;border-radius:50%;background:var(--maroon-pale);display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:700;color:var(--maroon);flex-shrink:0">${initials}</div><div><div style="font-size:.82rem;font-weight:600">${f.members?.full_name||'—'}</div><div style="font-size:.67rem;color:var(--ink-faint)">#${f.members?.member_number||'—'}</div></div></div></td><td style="font-size:.8rem;color:var(--ink-soft);max-width:200px">${f.reason}${f.notes?`<div style="font-size:.7rem;color:var(--ink-faint)">${f.notes}</div>`:''}</td><td><strong style="color:var(--maroon)">Ksh ${Number(f.amount).toLocaleString()}</strong></td><td>${badge}</td><td>${actions}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}

async function markFinePaid(fineId){
  const{data:fine}=await sb.from('fines').select('*,members(full_name)').eq('id',fineId).maybeSingle();
  if(!fine)return;
  const today=new Date().toISOString().split('T')[0];
  await sb.from('fines').update({status:'paid',paid_date:today,recovery_method:'cash',approved_by:currentUser.id}).eq('id',fineId);
  await sb.from('expenses').insert({org_id:currentOrg.id,category:'Fine',description:`Fine paid: ${fine.reason} — ${fine.members?.full_name||'member'}`,amount:fine.amount,expense_date:today,entry_type:'income',recorded_by:currentUser.id});
  await updateBankBalance(currentOrg.id,fine.amount,'credit');
  try{
    const{data:reqs}=await sb.from('payment_requests').select('id,allocations').eq('member_id',fine.member_id).eq('status','pending');
    for(const req of reqs||[]){
      let allocs=[];try{allocs=JSON.parse(req.allocations||'[]');}catch(e){}
      if(allocs.some(a=>a.fineId===fineId)){await sb.from('payment_requests').update({status:'approved',approved_by:currentUser.id,approved_at:new Date().toISOString()}).eq('id',req.id);}
    }
  }catch(e){}
  await logActivity('FINE PAID',`Fine paid: ${fine.members?.full_name||'member'} Ksh ${Number(fine.amount).toLocaleString()}`);
  toast(`✓ Ksh ${Number(fine.amount).toLocaleString()} marked paid`);
  loadFinesLedger();loadFinance();loadDashboard();
}

async function recoverFineFromBalance(fineId){
  const{data:fine}=await sb.from('fines').select('*,members(full_name,shares_balance,savings_balance)').eq('id',fineId).maybeSingle();
  if(!fine)return;
  const savingsBal=Number(fine.members?.savings_balance||0),sharesBal=Number(fine.members?.shares_balance||0),fineAmt=Number(fine.amount);
  const method=(orgFinProfile.hasSavings&&savingsBal>=fineAmt)?'savings':(orgFinProfile.hasShares&&sharesBal>=fineAmt)?'shares':null;
  if(!method){toast('Insufficient member balance');return;}
  if(!confirm(`Recover Ksh ${fineAmt.toLocaleString()} from ${fine.members?.full_name}'s ${method} balance?`))return;
  const balField=method==='shares'?'shares_balance':'savings_balance';
  const currentBal=method==='shares'?sharesBal:savingsBal;
  await sb.from('members').update({[balField]:currentBal-fineAmt}).eq('id',fine.member_id);
  await sb.from('fines').update({status:'recovered',paid_date:new Date().toISOString().split('T')[0],recovery_method:method,approved_by:currentUser.id}).eq('id',fineId);
  await sb.from('expenses').insert({org_id:currentOrg.id,category:'Fine',description:`Fine recovered from ${method}: ${fine.reason} — ${fine.members?.full_name||'member'}`,amount:fineAmt,expense_date:new Date().toISOString().split('T')[0],entry_type:'income',recorded_by:currentUser.id});
  await updateBankBalance(currentOrg.id,fineAmt,'credit');
  await logActivity('FINE RECOVERED',`Recovered: ${fine.members?.full_name||'member'} Ksh ${fineAmt.toLocaleString()}`);
  toast(`✓ Ksh ${fineAmt.toLocaleString()} recovered from ${fine.members?.full_name}'s ${method}`);
  loadFinesLedger();loadFinance();loadMembers();loadDashboard();
}

async function waiveFine(fineId){if(!confirm('Waive this fine?'))return;await sb.from('fines').update({status:'waived',approved_by:currentUser.id}).eq('id',fineId);toast('Fine waived');loadFinesLedger();}
async function deleteFine(fineId){if(!confirm('Delete this fine?'))return;await sb.from('fines').delete().eq('id',fineId);toast('Fine deleted');loadFinesLedger();}

async function loadMemberPendingFines(memberId){
  if(!memberId||!currentOrg?.id)return;
  try{
    const{data}=await sb.from('fines').select('id,reason,amount,issued_date').eq('org_id',currentOrg.id).eq('member_id',memberId).eq('status','pending').order('created_at',{ascending:false});
    const pending=data||[];
    const total=pending.reduce((s,f)=>s+Number(f.amount||0),0);
    const alertEl=document.getElementById('mp-fines-alert');
    const alertText=document.getElementById('mp-fines-alert-text');
    if(alertEl){
      alertEl.style.display=pending.length?'block':'none';
      if(pending.length&&alertText)alertText.innerHTML=`You have <strong>${pending.length} outstanding fine${pending.length!==1?'s':''}</strong> totalling <strong style="color:var(--maroon)">Ksh ${total.toLocaleString()}</strong>.<br><span style="font-size:.78rem;color:var(--ink-faint)">${pending.map(f=>f.reason).join(' · ')}</span>`;
    }
    const noticeEl=document.getElementById('mc-fines-notice');
    if(noticeEl){
      if(!pending.length){noticeEl.style.display='none';return;}
      noticeEl.style.display='block';
      noticeEl.innerHTML=`<div style="background:var(--maroon-pale);border:1px solid var(--maroon-muted);border-left:4px solid var(--maroon);padding:.85rem 1rem;border-radius:4px"><div style="font-size:.85rem;font-weight:700;color:var(--maroon);margin-bottom:.5rem">⚠ Outstanding Fine${pending.length!==1?'s':''} — Ksh ${total.toLocaleString()}</div>${pending.map(f=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:1px solid rgba(128,0,32,.1)"><div><div style="font-size:.82rem;color:var(--ink-soft)">${f.reason}</div><div style="font-size:.7rem;color:var(--ink-faint)">${f.issued_date||''}</div></div><strong style="color:var(--maroon);margin-left:.75rem;flex-shrink:0">Ksh ${Number(f.amount).toLocaleString()}</strong></div>`).join('')}<div style="margin-top:.75rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem"><span style="font-size:.75rem;color:var(--ink-faint)">Pay via M-Pesa to your group payment details and inform your admin.</span><button class="btn btn-primary btn-sm" onclick="openFinePaymentModal()" style="background:var(--maroon);font-size:.78rem;flex-shrink:0">💳 Pay Fine</button></div></div>`;
    }
  }catch(e){console.log('Fines load skipped:',e.message);}
}

async function openFinePaymentModal(){
  const memberId=window._myMemberId;
  if(!memberId||!currentOrg?.id){toast('Member record not linked');return;}
  const{data:fines}=await sb.from('fines').select('id,reason,amount,issued_date').eq('org_id',currentOrg.id).eq('member_id',memberId).eq('status','pending').order('created_at',{ascending:false});
  const pending=fines||[];
  if(!pending.length){toast('No pending fines to pay');return;}
  const total=pending.reduce((s,f)=>s+Number(f.amount||0),0);
  window._pendingFineItems=pending.map(f=>({id:f.id,amount:Number(f.amount),reason:f.reason}));
  window._pendingFineTotal=total;
  let el=document.getElementById('modal-fine-payment-inline');
  if(!el){el=document.createElement('div');el.id='modal-fine-payment-inline';el.className='modal-overlay';document.body.appendChild(el);el.addEventListener('click',e=>{if(e.target===el)el.classList.remove('open');});}
  el.innerHTML=`<div class="modal" style="max-width:460px"><div class="modal-header"><div><div class="modal-title">💳 Pay Outstanding Fine${pending.length!==1?'s':''}</div><div style="font-size:.72rem;color:var(--ink-faint);margin-top:.1rem">Ksh ${total.toLocaleString()} total outstanding</div></div><button class="modal-close" onclick="document.getElementById('modal-fine-payment-inline').classList.remove('open')">✕</button></div><div class="modal-body"><div id="fine-pay-methods" style="margin-bottom:1rem"></div><div style="background:var(--maroon-pale);border:1px solid var(--maroon-muted);border-radius:6px;padding:.85rem 1rem;margin-bottom:1rem"><div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--maroon);margin-bottom:.5rem">Fine Details</div>${pending.map(f=>`<div style="display:flex;justify-content:space-between;padding:.3rem 0;font-size:.82rem;border-bottom:1px solid rgba(128,0,32,.1)"><span style="color:var(--ink-soft)">${f.reason}</span><strong style="color:var(--maroon)">Ksh ${Number(f.amount).toLocaleString()}</strong></div>`).join('')}<div style="display:flex;justify-content:space-between;padding:.4rem 0 0;font-size:.85rem;font-weight:700"><span>Total</span><span style="color:var(--maroon)">Ksh ${total.toLocaleString()}</span></div></div><div class="form-row"><div class="form-group"><label class="form-label">M-Pesa Reference</label><input class="form-input" id="fine-pay-ref" placeholder="e.g. QBC4X8YZDE"/></div><div class="form-group"><label class="form-label">Date</label><input class="form-input" type="date" id="fine-pay-date" value="${new Date().toISOString().split('T')[0]}"/></div></div></div><div class="modal-footer"><button class="btn btn-secondary" onclick="document.getElementById('modal-fine-payment-inline').classList.remove('open')">Cancel</button><button class="btn btn-primary" onclick="submitFinePayment()" style="background:var(--maroon)">Submit Fine Payment →</button></div></div>`;
  try{renderPaymentMethods(currentOrg,'fine-pay-methods',false);}catch(e){}
  el.classList.add('open');
}

async function submitFinePayment(){
  const fineItems=window._pendingFineItems||[];
  const total=window._pendingFineTotal||0;
  const mpesaRef=document.getElementById('fine-pay-ref')?.value?.trim();
  const payDate=document.getElementById('fine-pay-date')?.value;
  if(!mpesaRef){toast('Please enter your M-Pesa reference number');return;}
  if(!fineItems.length){toast('No fine data found');return;}
  const memberId=window._myMemberId;
  if(!memberId){toast('Member record not linked');return;}
  const allocations=fineItems.map(f=>({fineId:f.id,typeName:'Fine Payment',reason:f.reason,amount:f.amount,isFine:true}));
  const{error}=await sb.from('payment_requests').insert({org_id:currentOrg.id,member_id:memberId,amount:total,mpesa_ref:mpesaRef,payment_date:payDate,allocations:JSON.stringify(allocations),status:'pending',requested_at:new Date().toISOString(),notes:`Fine payment. ${fineItems.map(f=>f.reason+': Ksh '+f.amount).join(', ')}`});
  if(error){toast('Error: '+error.message);return;}
  document.getElementById('modal-fine-payment-inline')?.classList.remove('open');
  toast(`✓ Fine payment of Ksh ${total.toLocaleString()} submitted — awaiting admin approval`);
  loadMyContributions();loadMyProfile();
}

function clearPayForm() { ['pay-member','pay-type','pay-amount','pay-ref','pay-notes'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; }); }
function clearExpForm() { ['exp-category','exp-desc','exp-amount','exp-ref','exp-project'].forEach(id=>{ const el=document.getElementById(id); if(el)el.value=''; }); }


/* ════ PAYMENT REQUEST APPROVALS
═══════════════════════════════════════ */

async function loadPendingPayments() {
  if (!currentOrg?.id) return;
  const listEl = document.getElementById('pending-payments-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="loading"><div class="spinner"></div>Loading payment requests…</div>';

  let requests = [];
  try {
    const { data } = await sb.from('payment_requests')
      .select('*,members(full_name,member_number,phone)')
      .eq('org_id', currentOrg.id)
      .order('requested_at', {ascending: false});
    requests = data || [];
  } catch(e) {
    listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--ink-faint)">Payment requests table not found. Run the SQL migration first.</div>';
    return;
  }

  const pending = requests.filter(r => r.status === 'pending');
  const approved = requests.filter(r => r.status === 'approved');
  const declined = requests.filter(r => r.status === 'declined');

  if (!requests.length) {
    listEl.innerHTML = '<div style="padding:3rem;text-align:center"><div style="font-size:2rem;margin-bottom:.75rem">💳</div><div style="font-size:.88rem;color:var(--ink-faint)">No payment requests yet</div></div>';
    return;
  }

  const renderPayRequest = (r, showActions) => {
    let allocations = [];
    try { allocations = JSON.parse(r.allocations || '[]'); } catch(e) {}
    const dateStr = (r.requested_at || r.created_at)
      ? new Date(r.requested_at || r.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})
      : '—';
    const reviewDate = r.approved_at
      ? new Date(r.approved_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})
      : '—';

    return `<div style="background:var(--surface);border:1px solid var(--border);border-left:4px solid ${showActions?'var(--warning)':r.status==='approved'?'var(--teal)':'var(--danger)'};padding:1rem 1.25rem;margin-bottom:.75rem;animation:welIn .3s ease both">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem;flex-wrap:wrap">
            <div style="font-size:.9rem;font-weight:700;color:var(--ink)">${r.members?.full_name || 'Unknown Member'}</div>
            <span style="font-size:.62rem;font-weight:600;padding:.15rem .45rem;background:var(--surface-2);color:var(--ink-faint);border-radius:3px">#${r.members?.member_number||'—'}</span>
            <span class="badge ${showActions?'badge-warn':r.status==='approved'?'badge-green':'badge-red'}">${r.status}</span>
          </div>
          <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:.5rem">
            <span style="font-size:.72rem;color:var(--ink-faint)">📅 ${dateStr}</span>
            ${r.mpesa_ref ? `<span style="font-size:.72rem;color:var(--ink-faint)">📱 M-Pesa: <strong style="color:var(--ink)">${r.mpesa_ref}</strong></span>` : ''}
            ${r.members?.phone ? `<span style="font-size:.72rem;color:var(--ink-faint)">📞 ${r.members.phone}</span>` : ''}
          </div>
          ${allocations.length ? `
          <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:4px;padding:.5rem .75rem;margin-bottom:.35rem">
            <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.35rem">Payment Breakdown</div>
            ${allocations.map(a => `
              <div style="display:flex;justify-content:space-between;font-size:.75rem;padding:.2rem 0;border-bottom:1px solid var(--border)">
                <span style="color:var(--ink-soft)">${a.typeName || 'Payment'}</span>
                <strong>Ksh ${Number(a.amount||0).toLocaleString()}</strong>
              </div>`).join('')}
            <div style="display:flex;justify-content:space-between;font-size:.8rem;font-weight:700;padding:.35rem 0 0">
              <span>Total</span>
              <span style="color:var(--teal)">Ksh ${Number(r.amount||0).toLocaleString()}</span>
            </div>
          </div>` : `
          <div style="font-size:.82rem;font-weight:700;color:var(--teal)">Ksh ${Number(r.amount||0).toLocaleString()}</div>`}
          ${r.notes ? `<div style="font-size:.7rem;color:var(--ink-faint);margin-top:.2rem">${r.notes}</div>` : ''}
          ${!showActions && r.status !== 'pending' ? `<div style="font-size:.7rem;color:var(--ink-faint);margin-top:.2rem">Reviewed: ${reviewDate}</div>` : ''}
        </div>
        ${showActions ? `
        <div style="display:flex;flex-direction:column;gap:.4rem;flex-shrink:0">
          <button class="btn btn-primary btn-sm" style="background:var(--teal);font-size:.75rem;padding:.4rem .9rem"
            onclick="approvePaymentRequest('${r.id}')">✓ Approve</button>
          <button class="btn btn-danger btn-sm" style="font-size:.75rem;padding:.4rem .9rem"
            onclick="declinePaymentRequest('${r.id}')">✕ Decline</button>
        </div>` : ''}
      </div>
    </div>`;
  };

  let html = '';

  // Pending section
  if (pending.length) {
    html += `<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--warning);margin-bottom:.6rem">
      ⏳ Awaiting Approval (${pending.length})</div>`;
    html += pending.map(r => renderPayRequest(r, true)).join('');
  }

  // Approved section
  if (approved.length) {
    html += `<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--teal);margin:1rem 0 .6rem">
      ✓ Recently Approved (${approved.length})</div>`;
    html += approved.slice(0, 10).map(r => renderPayRequest(r, false)).join('');
  }

  // Declined section
  if (declined.length) {
    html += `<div style="font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--danger);margin:1rem 0 .6rem">
      ✕ Declined (${declined.length})</div>`;
    html += declined.slice(0, 5).map(r => renderPayRequest(r, false)).join('');
  }

  listEl.innerHTML = html;
}

async function approvePaymentRequest(requestId) {
  if (!confirm('Approve this payment? This will record the transactions and update the member\'s balances.')) return;

  // Fetch the request
  const { data: req, error: fetchErr } = await sb.from('payment_requests')
    .select('*,members(full_name,shares_balance,savings_balance,registration_paid)')
    .eq('id', requestId).maybeSingle();
  if (fetchErr || !req) { toast('Error fetching request'); return; }

  let allocations = [];
  try { allocations = JSON.parse(req.allocations || '[]'); } catch(e) {}

  // If no allocations, treat whole amount as a generic payment
  if (!allocations.length) {
    allocations = [{ typeName: 'Payment', amount: req.amount }];
  }

  let successCount = 0;
  const memberData = req.members;
  const memberUpdates = {};

  for (const alloc of allocations) {
    // Insert transaction
    // Build transaction — only include type_id if it's a valid non-empty value
    const txnData = {
      org_id: currentOrg.id,
      member_id: req.member_id,
      amount: alloc.amount,
      mpesa_ref: req.mpesa_ref || null,
      transaction_date: req.payment_date || new Date().toISOString().split('T')[0],
      notes: `Approved. Ref: ${req.mpesa_ref||'—'}. Type: ${alloc.typeName||'Payment'}`,
      recorded_by: currentUser.id
    };
    // Only add type_id if it's a real UUID (not empty/null/undefined)
    if (alloc.typeId && alloc.typeId.length > 10) txnData.type_id = alloc.typeId;

    const { error: txErr } = await sb.from('transactions').insert(txnData);
    if (!txErr) {
      successCount++;
      // Accumulate balance updates
      const name = (alloc.typeName || '').toLowerCase();
      if (name.includes('share')) {
        memberUpdates.shares_balance = ((memberUpdates.shares_balance ?? (memberData?.shares_balance||0)) + alloc.amount);
      } else if (name.includes('saving')) {
        memberUpdates.savings_balance = ((memberUpdates.savings_balance ?? (memberData?.savings_balance||0)) + alloc.amount);
      }
      if (alloc.isReg) memberUpdates.registration_paid = true;
    }
  }

  // Update member balances
  if (Object.keys(memberUpdates).length) {
    await sb.from('members').update(memberUpdates).eq('id', req.member_id);
  }

  // Update bank balance if function exists
  try {
    if (typeof updateBankBalance === 'function') {
      await updateBankBalance(currentOrg.id, req.amount, 'credit');
    } else {
      // Direct update
      const newBal = (currentOrg.bank_balance||0) + Number(req.amount);
      await sb.from('organisations').update({ bank_balance: newBal }).eq('id', currentOrg.id);
      currentOrg.bank_balance = newBal;
    }
  } catch(e) { console.warn('Bank balance update:', e.message); }

  // Auto-resolve fines
  const fineAllocs=allocations.filter(a=>a.isFine&&a.fineId);
  for(const fa of fineAllocs){
    await sb.from('fines').update({status:'paid',paid_date:req.payment_date||new Date().toISOString().split('T')[0],recovery_method:'cash',approved_by:currentUser.id}).eq('id',fa.fineId);
    await sb.from('expenses').insert({org_id:currentOrg.id,category:'Fine',description:`Fine paid: ${fa.reason||'fine'} — ${memberData?.full_name||'member'}`,amount:fa.amount,expense_date:req.payment_date||new Date().toISOString().split('T')[0],entry_type:'income',recorded_by:currentUser.id});
  }

  // Mark request as approved
  await sb.from('payment_requests').update({
    status: 'approved',
    approved_by: currentUser.id,
    approved_at: new Date().toISOString()
  }).eq('id', requestId);

  await logActivity('PAYMENT APPROVED', `Approved Ksh ${Number(req.amount).toLocaleString()} from ${memberData?.full_name || 'member'}${fineAllocs.length?' (fine resolved)':''}`);
  const fineMsg=fineAllocs.length?` · ${fineAllocs.length} fine${fineAllocs.length!==1?'s':''} resolved`:'';
  toast(`✓ Payment approved — Ksh ${Number(req.amount).toLocaleString()} for ${memberData?.full_name || 'member'}${fineMsg}`);
  await loadPendingPayments();
  await loadApprovals();
  loadDashboard();
  loadFinance();
}

async function declinePaymentRequest(requestId) {
  const reason = prompt('Reason for declining (optional):');
  if (reason === null) return; // cancelled

  const { data: req } = await sb.from('payment_requests')
    .select('amount,members(full_name)').eq('id', requestId).maybeSingle();

  await sb.from('payment_requests').update({
    status: 'declined',
    approved_by: currentUser.id,
    approved_at: new Date().toISOString(),
    notes: reason || 'Declined by admin'
  }).eq('id', requestId);

  await logActivity('PAYMENT DECLINED', `Declined Ksh ${Number(req?.amount||0).toLocaleString()} payment request from ${req?.members?.full_name || 'member'}`);
  toast('Payment request declined');
  await loadPendingPayments();
  await loadApprovals();
}


function switchToNewOrg(e) { e.preventDefault(); registerAnotherOrg(); } // legacy
function _switchToNewOrg_legacy(e) {
  e.preventDefault();
  const role = currentProfile?.role;
  const isAdmin = ['admin','officer','treasurer'].includes(role);
  if (isAdmin) {
    // Admin: show option to register another org
    if (confirm('You are about to register a new separate organisation on GroupYetu360. Your current group will remain. Continue?')) {
      // Sign out and go to register tab
      sb.auth.signOut().then(() => {
        window.location.reload();
        setTimeout(() => switchAuthTab('register'), 500);
      });
    }
  } else {
    // Member: sign out and go to register (they'll create their own group)
    if (confirm('Start your own group on GroupYetu360? You\'ll be taken to the registration page. Your current membership will remain.')) {
      window.open('https://app.groupyetu.org', '_blank');
    }
  }
}


async function autoLinkAdminMember() {
  const myEmail = currentUser?.email || '';
  const myName = currentProfile?.full_name?.toLowerCase().trim() || '';

  // Try to find a member record matching this admin
  const { data: members } = await sb.from('members').select('*').eq('org_id', currentOrg.id);
  const allM = members || [];

  let match = allM.find(m => m.portal_email === myEmail);
  if (!match && myName) match = allM.find(m => m.full_name?.toLowerCase().trim() === myName);
  if (!match && myName) {
    const firstName = myName.split(' ')[0];
    match = allM.find(m => m.full_name?.toLowerCase().startsWith(firstName));
  }

  if (!match) {
    // No member record found — create one for the founder
    const { data: newMember, error: createErr } = await sb.from('members').insert({
      org_id: currentOrg.id,
      full_name: currentProfile?.full_name || myEmail,
      phone: currentProfile?.phone || null,
      portal_email: myEmail,
      member_number: '001',
      status: 'active',
      registration_paid: true,
      join_date: new Date().toISOString().split('T')[0],
      notes: 'Founding member — auto-created'
    }).select().single();

    if (createErr) {
      toast('Error creating member record: ' + createErr.message);
      return;
    }
    match = newMember;
    toast('✓ Created you as Member #001 — reloading...');
  } else {
    // Found existing — link it
    const { error } = await sb.from('members').update({ portal_email: myEmail }).eq('id', match.id);
    if (error) { toast('Error: ' + error.message); return; }
    toast('✓ Linked to ' + match.full_name + ' — reloading...');
  }

  window._myMemberId = match.id;
  await loadMyProfile();
  await loadMyContributions();
}
