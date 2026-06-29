// GroupYetu360 — js/dashboard.js
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

async function loadDashboard() {
  if (!currentOrg?.id && currentProfile?.role !== 'superadmin') return;
  if (currentProfile?.role === 'superadmin') {
    document.getElementById('page-title').textContent = 'Platform Control';
    document.getElementById('page-sub').textContent = 'EPH Technologies — Super Admin';
    showPage('superadmin');
    return;
  }
  if (currentProfile?.role === 'member') { showPage('my_profile'); return; }

  // Make dashboard page active before populating elements
  showPage('dashboard');

  // Gate Quick Actions immediately after page shows
  gateQuickActions();

  // Update approvals badge immediately so admin sees pending count without visiting Approvals page
  if (canDo('viewApprovals')) {
    (async () => {
      try {
        const [{ data: pendingMems }, { data: pendingPays }] = await Promise.all([
          sb.from('pending_members').select('id').eq('org_id', currentOrg.id).eq('status','pending'),
          sb.from('payment_requests').select('id,payment_type').eq('org_id', currentOrg.id).eq('status','pending')
        ]);
        const filteredPays = (pendingPays||[]).filter(r => {
          const t = r.payment_type || '';
          return t !== 'subscription' && !t.startsWith('subscription_') && !t.startsWith('sms_bundle');
        });
        const total = (pendingMems?.length||0) + filteredPays.length;
        const badge = document.getElementById('approvals-badge');
        if (badge) { badge.textContent = total; badge.style.display = total > 0 ? 'inline' : 'none'; }
      } catch(e) {}
    })();
  }

  const orgId = currentOrg.id;
  document.getElementById('page-sub').textContent = currentOrg.name;

  // ── Greeting & hero (instant — no DB) ──
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const adminName = currentProfile?.full_name?.split(' ')[0] || 'Admin';
  const dateStr = now.toLocaleDateString('en-KE',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  const setHTML = (id,v) => { const el=document.getElementById(id); if(el) el.innerHTML=v; };
  setEl('dash-greeting', greet);
  setEl('dash-hero-name', adminName);
  setEl('dash-hero-org-name', currentOrg.name);
  setEl('dash-hero-date', dateStr);

  // ── Bank balance — always fetch fresh from DB, not stale in-memory ──
  sb.from('organisations').select('bank_balance,bank_balance_updated,show_balance_to_members')
    .eq('id', orgId).single().then(({ data: freshOrg }) => {
      if (freshOrg) {
        currentOrg.bank_balance = freshOrg.bank_balance;
        currentOrg.bank_balance_updated = freshOrg.bank_balance_updated;
        currentOrg.show_balance_to_members = freshOrg.show_balance_to_members;
      }
      const bankBal = currentOrg?.bank_balance || 0;
      setHTML('dash-balance', 'Ksh ' + bankBal.toLocaleString());
      setEl('dash-balance-meta', currentOrg?.bank_balance_updated ? 'Updated ' + currentOrg.bank_balance_updated : 'Set balance in Settings');
      setEl('dash-hero-balance', 'Ksh ' + (bankBal/1000 >= 1 ? (bankBal/1000).toFixed(0)+'K' : bankBal.toLocaleString()));
      // Also update mobile swipe card if visible
      const bankBalFmt = bankBal >= 1000000
        ? 'Ksh ' + (bankBal/1000000).toFixed(1)+'M'
        : bankBal >= 1000 ? 'Ksh ' + (bankBal/1000).toFixed(0)+'K'
        : 'Ksh ' + bankBal.toLocaleString();
      const admScBank = document.getElementById('adm-sc-bank');
      if (admScBank) admScBank.textContent = bankBalFmt;
      const admScUpdated = document.getElementById('adm-sc-bank-updated');
      if (admScUpdated) admScUpdated.textContent = currentOrg?.bank_balance_updated ? 'Updated ' + currentOrg.bank_balance_updated : 'Set balance in Settings';
    }).catch(() => {
      const bankBal = currentOrg?.bank_balance || 0;
      setHTML('dash-balance', 'Ksh ' + bankBal.toLocaleString());
      setEl('dash-hero-balance', 'Ksh ' + (bankBal/1000 >= 1 ? (bankBal/1000).toFixed(0)+'K' : bankBal.toLocaleString()));
    });
  const showBalToggle = document.getElementById('show-balance-toggle');
  if (showBalToggle) showBalToggle.checked = currentOrg?.show_balance_to_members || false;

  const thisYear = now.getFullYear().toString();

  // ── Members — renders member count, bar, snapshot, unregistered warning ──
  const membersPromise = sb.from('members').select('*').eq('org_id', orgId).order('member_number')
    .then(({ data }) => {
      const members = data || [];
      const activeMems = members.filter(m => m.status === 'active').length;
      setEl('dash-members', members.length);
      setEl('dash-members-meta', activeMems + ' active · ' + (members.length - activeMems) + ' inactive');
      setEl('dash-hero-members', members.length);
      const snapSub = document.getElementById('dash-members-snap-sub');
      if (snapSub) snapSub.textContent = `${members.length} members · ${activeMems} active`;
      const barWrap = document.getElementById('dash-members-bar-wrap');
      if (barWrap && members.length) {
        const counts = { active:0, arrears:0, inactive:0 };
        members.forEach(m => { counts[m.status] = (counts[m.status]||0)+1; });
        const colours = { active:'var(--success)', arrears:'var(--warning)', inactive:'var(--border-dk)' };
        barWrap.innerHTML = Object.entries(counts).filter(([,v])=>v>0).map(([k,v])=>
          `<div title="${v} ${k}" style="height:4px;flex:${v};background:${colours[k]};border-radius:2px;transition:flex .8s ease"></div>`
        ).join('');
      }
      const tbl = document.getElementById('dash-members-table');
      if (tbl) tbl.innerHTML = members.slice(0,8).map(m => {
        const bal = Number(m.shares_balance||0) + Number(m.savings_balance||0);
        return `<tr onclick="openMemberDetail('${m.id}')" style="cursor:pointer">
          <td style="font-weight:600;color:var(--maroon)">#${m.member_number||'—'}</td>
          <td><strong>${m.full_name}</strong></td>
          <td style="font-size:.78rem">${m.phone||'—'}</td>
          <td style="font-weight:600">Ksh ${bal.toLocaleString()}</td>
          <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey'}">${m.status}</span></td>
        </tr>`;
      }).join('') + (members.length > 8 ? `<tr><td colspan="5" style="text-align:center;padding:.65rem"><button class="btn btn-ghost btn-sm" onclick="showPage('members')">View all ${members.length} members →</button></td></tr>` : '');
      const unregistered = members.filter(m => !m.registration_paid);
      const regEl = document.getElementById('registration-warning-card');
      if (regEl) {
        regEl.style.display = unregistered.length > 0 ? 'block' : 'none';
        if (unregistered.length > 0) setEl('reg-warning-text', `${unregistered.length} member${unregistered.length!==1?'s':''} yet to pay registration fee`);
      }
    }).catch(e => console.error('[GY360] members fetch:', e));

  // ── Recent transactions ──
  const recentTxnPromise = sb.from('transactions')
    .select('*,members(full_name),contribution_types(name)')
    .eq('org_id', orgId).order('created_at',{ascending:false}).limit(6)
    .then(({ data }) => {
      const txns = data || [];
      const txnEl = document.getElementById('dash-recent-txn');
      if (!txnEl) return;
      txnEl.innerHTML = txns.length ? txns.map(t => {
        const name = t.members?.full_name || 'Unknown';
        const initials = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
        const ds = t.transaction_date || t.created_at?.split('T')[0] || '';
        return `<div class="dash-txn-row">
          <div class="dash-txn-avatar">${initials}</div>
          <div style="flex:1;min-width:0">
            <div class="dash-txn-name">${name}</div>
            <div class="dash-txn-meta">${t.contribution_types?.name||'Payment'} · ${ds}${t.mpesa_ref?' · '+t.mpesa_ref:''}</div>
          </div>
          <div class="dash-txn-amt">+Ksh ${Number(t.amount).toLocaleString()}</div>
        </div>`;
      }).join('') + `<div style="padding:.75rem 1.25rem;text-align:center"><button class="btn btn-ghost btn-sm" onclick="showPage('finance')">View all transactions →</button></div>`
      : `<div style="padding:2rem 1.25rem;text-align:center">
          <div style="font-size:2rem;margin-bottom:.5rem">₭</div>
          <div style="font-size:.82rem;color:var(--ink-faint);margin-bottom:.75rem">No payments recorded yet</div>
          <button class="btn btn-primary btn-sm" onclick="showPage('finance')">Record First Payment</button>
        </div>`;
    }).catch(e => console.error('[GY360] recent txns fetch:', e));

  // ── All transactions — renders year total, chart, category breakdown ──
  const allTxnPromise = sb.from('transactions')
    .select('amount,transaction_date,contribution_types(name)')
    .eq('org_id', orgId)
    .then(({ data }) => {
      const allTxns = data || [];
      const yearTxns = allTxns.filter(t => (t.transaction_date||'').startsWith(thisYear));
      const yearTotal = yearTxns.reduce((s,t) => s + Number(t.amount||0), 0);
      setEl('dash-txn', yearTxns.length);
      setEl('dash-txn-meta', 'Ksh ' + yearTotal.toLocaleString() + ' this year');
      // Category breakdown
      const cats = {};
      allTxns.forEach(t => { const c = t.contribution_types?.name||'Other'; cats[c] = (cats[c]||0) + Number(t.amount||0); });
      const summaryEl = document.getElementById('txn-summary-content');
      if (summaryEl) {
        const entries = Object.entries(cats).sort((a,b) => b[1]-a[1]);
        const grand = entries.reduce((s,[,v]) => s+v, 0);
        summaryEl.innerHTML = entries.length ? entries.map(([cat,total]) => {
          const pct = grand ? Math.round((total/grand)*100) : 0;
          return `<div style="margin-bottom:.7rem">
            <div style="display:flex;justify-content:space-between;margin-bottom:.25rem">
              <span style="font-size:.78rem;color:var(--ink-soft)">${cat}</span>
              <strong style="font-size:.78rem;color:var(--maroon)">Ksh ${total.toLocaleString()}</strong>
            </div>
            <div style="height:5px;background:var(--border);border-radius:3px">
              <div style="height:100%;width:${pct}%;background:var(--maroon);border-radius:3px;transition:width 1s ease"></div>
            </div>
          </div>`;
        }).join('') : '<div style="color:var(--ink-faint);font-size:.82rem;padding:.5rem 0">No contributions recorded yet</div>';
      }
      // Monthly bar chart
      const chartEl = document.getElementById('dash-monthly-chart');
      if (chartEl) {
        const months = [];
        for (let i=5; i>=0; i--) { const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()-i); months.push({key:d.toISOString().slice(0,7),label:d.toLocaleString('default',{month:'short'})}); }
        const monthData = months.map(m => ({ label:m.label, total:allTxns.filter(t=>(t.transaction_date||'').startsWith(m.key)).reduce((s,t)=>s+Number(t.amount||0),0) }));
        const maxVal = Math.max(...monthData.map(m=>m.total), 1);
        chartEl.innerHTML = monthData.map(m => {
          const h = Math.round((m.total/maxVal)*80);
          const isLatest = m.label === monthData[5].label;
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:.2rem">
            <div style="font-size:.58rem;color:var(--ink-faint)">${m.total>0?'Ksh '+(m.total>=1000?(m.total/1000).toFixed(0)+'K':m.total):''}</div>
            <div style="width:100%;background:${isLatest?'var(--maroon)':'var(--maroon-pale)'};height:${h||3}px;border-radius:2px 2px 0 0;min-height:3px;margin-top:auto"></div>
          </div>`;
        }).join('');
        const labelsEl = document.getElementById('dash-monthly-labels');
        if (labelsEl) labelsEl.innerHTML = monthData.map(m=>`<div style="flex:1;text-align:center">${m.label}</div>`).join('');
        const totalEl = document.getElementById('dash-monthly-total');
        if (totalEl) totalEl.textContent = 'Total (6 months): Ksh ' + monthData.reduce((s,m)=>s+m.total,0).toLocaleString();
      }
    }).catch(e => console.error('[GY360] all txns fetch:', e));

  // ── Projects ──
  const projPromise = sb.from('projects').select('id').eq('org_id', orgId).eq('status','active')
    .then(({ data }) => setEl('dash-projects', (data||[]).length))
    .catch(e => console.error('[GY360] projects fetch:', e));

  // ── Next meeting ──
  const meetPromise = sb.from('meetings').select('*').eq('org_id', orgId)
    .gte('meeting_date', now.toISOString().split('T')[0]).order('meeting_date').limit(1)
    .then(({ data }) => {
      const nmEl = document.getElementById('dash-next-meeting');
      if (!nmEl) return;
      const m = (data||[])[0];
      if (m) {
        const mDate = new Date(m.meeting_date);
        const daysAway = Math.ceil((mDate - now)/(1000*60*60*24));
        const dayLabel = daysAway === 0 ? 'Today!' : daysAway === 1 ? 'Tomorrow' : `In ${daysAway} days`;
        nmEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:.75rem">
            <div style="background:var(--maroon-pale);padding:.5rem .65rem;text-align:center;min-width:44px">
              <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.1em;color:var(--maroon);font-weight:700">${mDate.toLocaleString('default',{month:'short'})}</div>
              <div style="font-size:1.5rem;font-weight:700;color:var(--maroon);font-family:'Crimson Pro',serif;line-height:1">${mDate.getDate()}</div>
            </div>
            <div>
              <div style="font-size:.85rem;font-weight:700;color:var(--ink)">${dayLabel}</div>
              <div style="font-size:.72rem;color:var(--ink-faint)">${m.meeting_time||'Time TBA'} · ${m.venue||'Venue TBA'}</div>
            </div>
          </div>
          ${m.agenda?`<div style="font-size:.75rem;color:var(--ink-soft);line-height:1.65;padding:.5rem .6rem;background:var(--surface-2);border-left:2px solid var(--maroon)">${m.agenda}</div>`:''}`;
      } else {
        nmEl.innerHTML = `<div style="text-align:center;padding:.5rem 0">
          <div style="font-size:1.5rem;margin-bottom:.4rem">📅</div>
          <div style="font-size:.78rem;color:var(--ink-faint);margin-bottom:.75rem">No meetings scheduled yet</div>
          <button class="btn btn-primary btn-sm" onclick="showModal('scheduleMeeting')">Schedule a Meeting</button>
        </div>`;
      }
    }).catch(e => console.error('[GY360] meetings fetch:', e));

  // ── These fire independently — don't block the main queries ──
  checkPendingApprovals();
  loadDashboardModuleCards(orgId);
  populateMobileAdminHome(orgId);
  checkSmsBalanceWarning();

  await Promise.allSettled([membersPromise, recentTxnPromise, allTxnPromise, projPromise, meetPromise]);
}

// Show a dashboard warning if SMS bundle is zero (fires after login)
function checkSmsBalanceWarning() {
  if (!currentOrg || currentOrgRole === 'member') return;
  const bundle = currentOrg?.sms_bundle || 0;
  if (bundle > 0) return; // all good
  const warnEl = document.getElementById('dash-sms-warn');
  if (!warnEl) return;
  const has2fa = currentOrg?.two_fa_enabled;
  warnEl.style.display = 'block';
  warnEl.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:.75rem">
      <span style="font-size:1.2rem">⚠️</span>
      <div>
        <div style="font-weight:700;font-size:.85rem;color:var(--danger);margin-bottom:.2rem">SMS Bundle Empty</div>
        <div style="font-size:.78rem;color:var(--ink-soft);line-height:1.5">
          Your group has run out of SMS credits. Bulk messaging is disabled.
          ${has2fa ? ' <strong>2FA has been automatically turned off</strong> to prevent login failures.' : ''}
          <a href="#" onclick="showPage('billing');return false;" style="color:var(--teal);font-weight:600;margin-left:.25rem">Top up SMS →</a>
        </div>
      </div>
    </div>`;
}

async function loadDashboardModuleCards(orgId) {
  const container = document.getElementById('dash-module-cards');
  if (!container) return;
  container.innerHTML = '';

  // Use real tables with real columns — savings_rounds for MGR, table_banking_pools for TB
  const [mgrRes, tbRes, finesRes] = await Promise.all([
    sb.from('savings_rounds')
      .select('id,name,status,amount_per_member,pool_members,collection_method')
      .eq('org_id', orgId)
      .order('created_at', {ascending: false})
      .limit(5),
    sb.from('table_banking_pools')
      .select('id,name,status,interest_rate,pool_members')
      .eq('org_id', orgId)
      .order('created_at', {ascending: false})
      .limit(5),
    sb.from('fines')
      .select('id,amount,status')
      .eq('org_id', orgId)
      .eq('status', 'pending'),
  ]);

  const cycles  = mgrRes.data  || [];
  const pools   = tbRes.data   || [];
  const pending = finesRes.data || [];

  // ── MGR Card ──
  if (cycles.length > 0) {
    const active = cycles.filter(c => c.status === 'active');
    const activeRound = active[0];
    const memberCount = activeRound?.pool_members?.length || 0;
    const amtPerMember = Number(activeRound?.amount_per_member || 0);
    const potSize = memberCount * amtPerMember;

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'cursor:pointer;transition:box-shadow .15s';
    card.onclick = () => showPage('mgr');
    card.onmouseenter = () => card.style.boxShadow = '0 2px 12px rgba(0,0,0,.08)';
    card.onmouseleave = () => card.style.boxShadow = '';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:1rem">🔄</span> Rotating Savings
          </div>
          <div class="card-sub">${cycles.length} cycle${cycles.length!==1?'s':''} · ${active.length} active</div>
        </div>
        <span class="badge ${active.length>0?'badge-green':'badge-grey'}" style="font-size:.65rem">${active.length>0?'ACTIVE':'INACTIVE'}</span>
      </div>
      <div style="padding:.75rem 1.25rem 1rem;display:grid;grid-template-columns:1fr 1fr;gap:.65rem">
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .85rem">
          <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Pot Per Round</div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--maroon)">Ksh ${potSize.toLocaleString()}</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .85rem">
          <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Members</div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--ink)">${memberCount}</div>
        </div>
      </div>
      ${activeRound ? `
      <div style="padding:0 1.25rem 1rem;font-size:.72rem;color:var(--ink-soft)">
        ${activeRound.name} · Ksh ${amtPerMember.toLocaleString()} per member · <a onclick="showPage('mgr')" style="color:var(--teal);cursor:pointer">View →</a>
      </div>` : `<div style="padding:0 1.25rem 1rem;font-size:.75rem;color:var(--ink-faint)">No active cycle — <a onclick="showPage('mgr')" style="color:var(--teal);cursor:pointer">start one →</a></div>`}`;
    container.appendChild(card);
  }

  // ── Table Banking Card ──
  if (pools.length > 0) {
    const active = pools.filter(p => p.status === 'active');
    const poolIds = pools.map(p => p.id);

    // Compute live stats from related tables
    const [contribRes, loanRes] = await Promise.all([
      sb.from('table_banking_contributions').select('amount').in('pool_id', poolIds),
      sb.from('table_banking_loans').select('principal,total_repaid,status').in('pool_id', poolIds)
    ]);

    const totalContribs = (contribRes.data||[]).reduce((s,r) => s + Number(r.amount||0), 0);
    const activeLoans = (loanRes.data||[]).filter(l => l.status === 'active');
    const totalLoansOut = activeLoans.reduce((s,l) => s + (Number(l.principal||0) - Number(l.total_repaid||0)), 0);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'cursor:pointer;transition:box-shadow .15s';
    card.onclick = () => showPage('table_banking');
    card.onmouseenter = () => card.style.boxShadow = '0 2px 12px rgba(0,0,0,.08)';
    card.onmouseleave = () => card.style.boxShadow = '';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:1rem">🏦</span> Table Banking
          </div>
          <div class="card-sub">${pools.length} pool${pools.length!==1?'s':''} · ${active.length} active</div>
        </div>
        <span class="badge ${active.length>0?'badge-green':'badge-grey'}" style="font-size:.65rem">${active.length>0?'ACTIVE':'INACTIVE'}</span>
      </div>
      <div style="padding:.75rem 1.25rem 1rem;display:grid;grid-template-columns:1fr 1fr 1fr;gap:.65rem">
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .75rem">
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Contributions</div>
          <div style="font-size:1rem;font-weight:700;color:var(--teal)">Ksh ${(totalContribs/1000).toFixed(0)}K</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .75rem">
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Loans Out</div>
          <div style="font-size:1rem;font-weight:700;color:var(--maroon)">Ksh ${(totalLoansOut/1000).toFixed(0)}K</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .75rem">
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Active Loans</div>
          <div style="font-size:1rem;font-weight:700;color:var(--ink)">${activeLoans.length}</div>
        </div>
      </div>
      ${totalLoansOut > 0 && totalContribs > 0 ? `
      <div style="padding:0 1.25rem 1rem">
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--ink-faint);margin-bottom:.3rem">
          <span>Loans vs contributions</span><span>${Math.round((totalLoansOut/totalContribs)*100)}%</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:3px">
          <div style="height:100%;width:${Math.min(100,Math.round((totalLoansOut/totalContribs)*100))}%;background:var(--maroon);border-radius:3px"></div>
        </div>
      </div>` : ''}`;
    container.appendChild(card);
  }

  // ── Fines Card (only if there are pending fines) ──
  if (pending.length > 0) {
    const totalOwed = pending.reduce((s,f) => s + Number(f.amount||0), 0);
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'cursor:pointer;transition:box-shadow .15s;border-top-color:var(--maroon)';
    card.onclick = () => { showPage('finance'); setTimeout(() => { const t=document.querySelector('[onclick*=tab-fines]'); if(t) switchFinTab(t,'tab-fines'); loadFinesLedger(); }, 150); };
    card.onmouseenter = () => card.style.boxShadow = '0 2px 12px rgba(0,0,0,.08)';
    card.onmouseleave = () => card.style.boxShadow = '';
    card.innerHTML = `
      <div class="card-header">
        <div>
          <div class="card-title" style="display:flex;align-items:center;gap:.5rem">
            <span style="font-size:1rem">⚠</span> Pending Fines
          </div>
          <div class="card-sub">${pending.length} fine${pending.length!==1?'s':''} awaiting resolution</div>
        </div>
        <span class="badge badge-warn" style="font-size:.65rem">ACTION NEEDED</span>
      </div>
      <div style="padding:.75rem 1.25rem 1rem">
        <div style="font-size:1.4rem;font-weight:700;color:var(--maroon)">Ksh ${totalOwed.toLocaleString()}</div>
        <div style="font-size:.75rem;color:var(--ink-faint);margin-top:.2rem">outstanding across ${pending.length} fine${pending.length!==1?'s':''}</div>
      </div>`;
    container.appendChild(card);
  }

  // If no module data at all, hide the container
  if (container.children.length === 0) {
    container.style.display = 'none';
  }
}

// ══════════════════════════════════════════
// ADMIN MOBILE HOME
// ══════════════════════════════════════════
async function populateMobileAdminHome(orgId) {
  const shell = document.getElementById('adm-mob-shell');
  if (!shell) return;

  // Hide global topbar on mobile (it repeats quick actions)
  const topbar = document.querySelector('header.topbar');
  const isMobile = window.innerWidth <= 768;
  if (topbar && isMobile) topbar.style.display = 'none';
  window.addEventListener('resize', () => {
    if (!topbar) return;
    topbar.style.display = window.innerWidth <= 768 ? 'none' : '';
  });

  // Height setter — Android dvh workaround
  function setAdmHeight() {
    const nav = document.getElementById('mob-bottom-nav');
    const navH = nav ? nav.offsetHeight : 56;
    shell.style.height = (window.innerHeight - navH) + 'px';
  }
  setAdmHeight();
  window.addEventListener('resize', setAdmHeight);

  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const setHTML = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };

  // ── Greeting ──
  const now = new Date();
  const hour = now.getHours();
  const greet = hour < 12 ? 'Good morning,' : hour < 17 ? 'Good afternoon,' : 'Good evening,';
  const adminName = currentProfile?.full_name?.split(' ')[0] || 'Admin';
  setEl('adm-mob-greeting', greet);
  setEl('adm-mob-name', adminName);

  // ── Org pill ──
  const orgName = currentOrg?.name || 'Your Group';
  setEl('adm-mob-org-name', orgName.length > 22 ? orgName.slice(0, 21) + '…' : orgName);
  const dot = document.getElementById('adm-mob-org-dot');
  if (dot) dot.textContent = orgName.charAt(0).toUpperCase();

  // ── Card 1: bank balance (instant from currentOrg) ──
  const bankBal = currentOrg?.bank_balance || 0;
  const bankBalFmt = bankBal >= 1000000
    ? 'Ksh ' + (bankBal / 1000000).toFixed(1) + 'M'
    : bankBal >= 1000
    ? 'Ksh ' + (bankBal / 1000).toFixed(0) + 'K'
    : 'Ksh ' + bankBal.toLocaleString();
  setEl('adm-sc-bank', bankBalFmt);
  setEl('adm-sc-bank-meta', 'Bank balance');
  setEl('adm-sc-bank-updated', currentOrg?.bank_balance_updated ? 'Updated ' + currentOrg.bank_balance_updated : 'Set balance in Settings');

  // ── Scroll dots ──
  const scroll = document.getElementById('adm-mob-cards-scroll');
  const dots = [0, 1, 2, 3].map(i => document.getElementById('adm-dot-' + i));
  if (scroll) {
    scroll.addEventListener('scroll', () => {
      const cardW = scroll.firstElementChild?.offsetWidth || scroll.offsetWidth;
      const idx = Math.min(3, Math.round(scroll.scrollLeft / (cardW + 8)));
      dots.forEach((d, i) => {
        if (!d) return;
        d.classList.toggle('active', i === idx);
        d.style.width = i === idx ? '18px' : '6px';
        d.style.background = i === idx ? 'var(--teal)' : 'rgba(15,110,86,.2)';
      });
    }, { passive: true });
  }

  const thisYear = now.getFullYear().toString();

  // ── Transactions: finance card + contribs card + graph ──
  try {
    const { data: allTxns } = await sb.from('transactions')
      .select('amount,transaction_date,contribution_types(name)')
      .eq('org_id', orgId);
    const txns = allTxns || [];
    const yearTxns = txns.filter(t => (t.transaction_date || '').startsWith(thisYear));
    const yearTotal = yearTxns.reduce((s, t) => s + Number(t.amount || 0), 0);

    setEl('adm-sc-year-total', 'Ksh ' + yearTotal.toLocaleString() + ' this year');
    setEl('adm-sc-txn-count', yearTxns.length + ' payment' + (yearTxns.length !== 1 ? 's' : ''));

    // Contributions by type (card 4)
    const cats = {};
    txns.forEach(t => {
      const c = t.contribution_types?.name || 'Other';
      cats[c] = (cats[c] || 0) + Number(t.amount || 0);
    });
    const contribEl = document.getElementById('adm-sc-contribs-list');
    if (contribEl) {
      const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
      if (entries.length) {
        contribEl.innerHTML = entries.map(([name, total]) =>
          `<div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.72rem;color:rgba(255,255,255,.75)">${name}</span>
            <span style="font-size:.75rem;font-weight:700;color:rgba(255,255,255,.95)">Ksh ${total.toLocaleString()}</span>
          </div>`
        ).join('');
        const grand = entries.reduce((s, [, v]) => s + v, 0);
        setEl('adm-sc-contribs-footer', 'Total: Ksh ' + grand.toLocaleString());
      } else {
        contribEl.innerHTML = '<div style="color:rgba(255,255,255,.45);font-size:.75rem">No contributions yet</div>';
      }
    }

    // Monthly bar chart (last 6 months)
    const barsEl = document.getElementById('adm-mob-bars');
    if (barsEl) {
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
        months.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleString('default', { month: 'short' }) });
      }
      const monthData = months.map(m => ({
        label: m.label,
        total: txns.filter(t => (t.transaction_date || '').startsWith(m.key)).reduce((s, t) => s + Number(t.amount || 0), 0),
        isCurrent: m.key === now.toISOString().slice(0, 7)
      }));
      const maxVal = Math.max(...monthData.map(m => m.total), 1);
      const sixTotal = monthData.reduce((s, m) => s + m.total, 0);
      barsEl.innerHTML = monthData.map(m => {
        const h = Math.max(3, Math.round((m.total / maxVal) * 60));
        const amtLabel = m.total >= 1000 ? (m.total / 1000).toFixed(0) + 'K' : (m.total > 0 ? m.total : '');
        return `<div class="adm-mob-bar-col">
          <div class="adm-mob-bar-amt">${amtLabel}</div>
          <div class="adm-mob-bar${m.isCurrent ? ' current' : ''}" style="height:${h}px"></div>
          <div class="adm-mob-bar-lbl">${m.label}</div>
        </div>`;
      }).join('');
      setEl('adm-mob-graph-total', '6-month total: Ksh ' + sixTotal.toLocaleString());
    }
  } catch (e) { console.error('[GY360] adm mob finance fetch:', e); }

  // ── Members (card 2) ──
  try {
    const { data: members } = await sb.from('members').select('status').eq('org_id', orgId);
    const mems = members || [];
    const total = mems.length;
    const active = mems.filter(m => m.status === 'active').length;
    const arrears = mems.filter(m => m.status === 'arrears').length;
    const inactive = mems.filter(m => m.status === 'inactive').length;
    setEl('adm-sc-members', total);
    setEl('adm-sc-members-meta', active + ' active · ' + arrears + ' in arrears');
    setEl('adm-sc-members-footer', inactive + ' inactive');
    const barEl = document.getElementById('adm-sc-members-bar');
    if (barEl && total > 0) {
      barEl.innerHTML =
        (active ? `<div style="flex:${active};height:4px;background:#4ade80;border-radius:2px 0 0 2px"></div>` : '') +
        (arrears ? `<div style="flex:${arrears};height:4px;background:#fbbf24"></div>` : '') +
        (inactive ? `<div style="flex:${inactive};height:4px;background:rgba(255,255,255,.2);border-radius:0 2px 2px 0"></div>` : '');
    }
  } catch (e) { console.error('[GY360] adm mob members fetch:', e); }

  // ── Next meeting (card 3) ──
  try {
    const today = now.toISOString().split('T')[0];
    const { data: meetings } = await sb.from('meetings').select('*')
      .eq('org_id', orgId).gte('meeting_date', today).order('meeting_date').limit(1);
    const m = (meetings || [])[0];
    if (m) {
      const mDate = new Date(m.meeting_date);
      const daysAway = Math.ceil((mDate - now) / (1000 * 60 * 60 * 24));
      const dateLabel = mDate.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
      const dayLabel = daysAway === 0 ? 'Today!' : daysAway === 1 ? 'Tomorrow' : 'In ' + daysAway + ' days';
      setEl('adm-sc-mtg-date', dateLabel);
      setEl('adm-sc-mtg-countdown', dayLabel);
      setEl('adm-sc-mtg-time', m.meeting_time ? m.meeting_time.slice(0, 5) + ' EAT' : 'Time TBA');
      setEl('adm-sc-mtg-venue', (m.venue || 'Venue TBA').slice(0, 18));
      setEl('adm-sc-mtg-footer', mDate.toLocaleDateString('en-KE', { weekday: 'long' }));
    } else {
      setEl('adm-sc-mtg-date', 'None');
      setEl('adm-sc-mtg-countdown', 'No meetings scheduled');
      setEl('adm-sc-mtg-time', '—');
      setEl('adm-sc-mtg-venue', '');
      setEl('adm-sc-mtg-footer', 'Schedule one in Meetings →');
    }
  } catch (e) { console.error('[GY360] adm mob meeting fetch:', e); }

  // ── Recent 3 transactions ──
  try {
    const { data: txns } = await sb.from('transactions')
      .select('*,members(full_name),contribution_types(name)')
      .eq('org_id', orgId).order('created_at', { ascending: false }).limit(3);
    const txnEl = document.getElementById('adm-mob-recent-txns');
    if (!txnEl) return;
    if (!(txns || []).length) {
      txnEl.innerHTML = '<div style="color:var(--ink-faint);font-size:.82rem;padding:.75rem 0;text-align:center">No payments recorded yet</div>';
      return;
    }
    txnEl.innerHTML = txns.map(t => {
      const name = t.members?.full_name || 'Unknown';
      const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const ds = t.transaction_date || (t.created_at || '').split('T')[0];
      return `<div class="mob-txn-row">
        <div class="mob-txn-avatar">${initials}</div>
        <div class="mob-txn-info">
          <div class="mob-txn-name">${name}</div>
          <div class="mob-txn-date">${t.contribution_types?.name || 'Payment'} · ${ds}</div>
        </div>
        <div class="mob-txn-amt">+Ksh ${Number(t.amount).toLocaleString()}</div>
      </div>`;
    }).join('');
  } catch (e) { console.error('[GY360] adm mob txns fetch:', e); }

  // ── Pending approvals alert ──
  try {
    const { data: pending } = await sb.from('members')
      .select('id').eq('org_id', orgId).eq('status', 'pending');
    const alertEl = document.getElementById('adm-mob-approvals-alert');
    if (alertEl && (pending || []).length > 0) {
      alertEl.style.display = 'flex';
      setEl('adm-mob-approvals-text', pending.length + ' member' + (pending.length !== 1 ? 's' : '') + ' pending approval');
    }
  } catch (e) { console.error('[GY360] adm mob approvals fetch:', e); }
}


/* ── ROLE-BASED QUICK ACTION GATING ── */
function gateQuickActions() {
  // Desktop Quick Actions
  const gates = {
    'qa-add-member':      canDo('addMember'),
    'qa-record-payment':  canDo('recordPayment'),
    'qa-send-sms':        canDo('sendSms'),
    'qa-schedule-meeting':canDo('createMeeting'),
    'qa-welfare-event':   canDo('recordPayment'),
    'qa-record-expense':  canDo('recordPayment'),
    // Mobile
    'mob-qa-payment':     canDo('recordPayment'),
    'mob-qa-add-member':  canDo('addMember'),
    'mob-qa-sms':         canDo('sendSms'),
    'mob-qa-meeting':     canDo('createMeeting'),
    // Members page Add button
    'add-member-btn':     canDo('addMember'),
  };
  Object.entries(gates).forEach(([id, allowed]) => {
    const el = document.getElementById(id);
    if (el) el.style.display = allowed ? '' : 'none';
  });

  // Topbar buttons
  const topbar = document.getElementById('topbar-actions');
  if (topbar) {
    const addBtn = topbar.querySelector('[onclick*="addMember"]');
    const payBtn = topbar.querySelector('[onclick*="recordPayment"]');
    if (addBtn) addBtn.style.display = canDo('addMember') ? '' : 'none';
    if (payBtn) payBtn.style.display = canDo('recordPayment') ? '' : 'none';
  }

  // Finance tabs — Record Payment and Record Expense tabs
  document.querySelectorAll('.fin-tab.record').forEach(tab => {
    const isExpense = tab.getAttribute('onclick')?.includes('expense');
    tab.style.display = canDo('recordPayment') ? '' : 'none';
  });
}
