// GroupYetu360 — js/dashboard.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── DASHBOARD ──
async function loadDashboard() {
  if (!currentOrg?.id && currentProfile?.role !== 'superadmin') return;
  if (currentProfile?.role === 'superadmin') {
    document.getElementById('page-title').textContent = 'Platform Control';
    document.getElementById('page-sub').textContent = 'EPH Technologies — Super Admin';
    showPage('superadmin');
    return;
  }
  if (currentProfile?.role === 'member') { showPage('my_profile'); return; }

  const orgId = currentOrg.id;
  document.getElementById('page-sub').textContent = currentOrg.name;

  // ── Hero greeting ──
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

  // ── Fetch all data in parallel ──
  const thisYear = now.getFullYear().toString();
  const [membersRes, txnRes, projRes, meetRes, allTxnRes] = await Promise.all([
    sb.from('members').select('*').eq('org_id', orgId).order('member_number'),
    sb.from('transactions').select('*,members(full_name),contribution_types(name)').eq('org_id', orgId).order('created_at',{ascending:false}).limit(6),
    sb.from('projects').select('id,name,status').eq('org_id', orgId).eq('status','active'),
    sb.from('meetings').select('*').eq('org_id', orgId).gte('meeting_date', now.toISOString().split('T')[0]).order('meeting_date').limit(1),
    sb.from('transactions').select('amount,transaction_date,contribution_types(name)').eq('org_id', orgId)
  ]);

  const members = membersRes.data || [];
  const txns = txnRes.data || [];
  const projs = projRes.data || [];
  const meetings = meetRes.data || [];
  const allTxns = allTxnRes.data || [];

  const bankBal = currentOrg?.bank_balance || 0;
  const activeMems = members.filter(m=>m.status==='active').length;
  const yearTxns = allTxns.filter(t=>(t.transaction_date||'').startsWith(thisYear));
  const yearTotal = yearTxns.reduce((s,t)=>s+Number(t.amount||0),0);

  // ── Hero stats ──
  setEl('dash-hero-members', members.length);
  setEl('dash-hero-balance', 'Ksh ' + (bankBal/1000 >= 1 ? (bankBal/1000).toFixed(0)+'K' : bankBal.toLocaleString()));

  // ── Stat cards (animate in) ──
  setHTML('dash-balance', 'Ksh ' + bankBal.toLocaleString());
  setEl('dash-balance-meta', currentOrg?.bank_balance_updated ? 'Updated ' + currentOrg.bank_balance_updated : 'Set balance in Settings');
  setEl('dash-members', members.length);
  setEl('dash-members-meta', activeMems + ' active · ' + (members.length-activeMems) + ' inactive');
  setEl('dash-txn', yearTxns.length);
  setEl('dash-txn-meta', 'Ksh ' + yearTotal.toLocaleString() + ' this year');
  setEl('dash-projects', projs.length);

  // Mini member status bar (active vs arrears vs inactive)
  const barWrap = document.getElementById('dash-members-bar-wrap');
  if (barWrap && members.length) {
    const counts = { active:0, arrears:0, inactive:0 };
    members.forEach(m => { counts[m.status] = (counts[m.status]||0)+1; });
    const colours = { active:'var(--success)', arrears:'var(--warning)', inactive:'var(--border-dk)' };
    barWrap.innerHTML = Object.entries(counts).filter(([,v])=>v>0).map(([k,v])=>
      `<div title="${v} ${k}" style="height:4px;flex:${v};background:${colours[k]};border-radius:2px;transition:flex .8s ease"></div>`
    ).join('');
  }

  // ── Recent transactions ──
  const txnEl = document.getElementById('dash-recent-txn');
  if (txnEl) {
    txnEl.innerHTML = txns.length ? txns.map(t => {
      const name = t.members?.full_name || 'Unknown';
      const initials = name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
      const dateStr = t.transaction_date || t.created_at?.split('T')[0] || '';
      return `<div class="dash-txn-row">
        <div class="dash-txn-avatar">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="dash-txn-name">${name}</div>
          <div class="dash-txn-meta">${t.contribution_types?.name||'Payment'} · ${dateStr}${t.mpesa_ref?' · '+t.mpesa_ref:''}</div>
        </div>
        <div class="dash-txn-amt">+Ksh ${Number(t.amount).toLocaleString()}</div>
      </div>`;
    }).join('') + `<div style="padding:.75rem 1.25rem;text-align:center">
        <button class="btn btn-ghost btn-sm" onclick="showPage('finance')">View all transactions →</button>
      </div>` :
    `<div style="padding:2rem 1.25rem;text-align:center">
      <div style="font-size:2rem;margin-bottom:.5rem">₭</div>
      <div style="font-size:.82rem;color:var(--ink-faint);margin-bottom:.75rem">No payments recorded yet</div>
      <button class="btn btn-primary btn-sm" onclick="showPage('finance');setTimeout(()=>switchTab(document.querySelector('[onclick*=tab-record]'),\'tab-record\'),100)">Record First Payment</button>
    </div>`;
  }

  // ── Next Meeting ──
  const nmEl = document.getElementById('dash-next-meeting');
  if (nmEl) {
    if (meetings.length) {
      const m = meetings[0];
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
  }

  // ── Alert cards ──
  await checkPendingApprovals();
  const unregistered = members.filter(m => !m.registration_paid);
  const regWarningEl = document.getElementById('registration-warning-card');
  if (regWarningEl) {
    regWarningEl.style.display = unregistered.length > 0 ? 'block' : 'none';
    if (unregistered.length > 0) setEl('reg-warning-text', `${unregistered.length} member${unregistered.length!==1?'s':''} yet to pay registration fee`);
  }

  // ── Contributions by type ──
  const categoryTotals = {};
  allTxns.forEach(t => {
    const cat = t.contribution_types?.name || 'Other';
    categoryTotals[cat] = (categoryTotals[cat]||0) + Number(t.amount||0);
  });
  const summaryEl = document.getElementById('txn-summary-content');
  if (summaryEl) {
    const entries = Object.entries(categoryTotals).sort((a,b)=>b[1]-a[1]);
    const grandTotal = entries.reduce((s,[,v])=>s+v,0);
    summaryEl.innerHTML = entries.length ? entries.map(([cat,total])=>{
      const pct = grandTotal ? Math.round((total/grandTotal)*100) : 0;
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
  const showBalToggle = document.getElementById('show-balance-toggle');
  if (showBalToggle) showBalToggle.checked = currentOrg?.show_balance_to_members || false;

  // ── Monthly bar chart ──
  const chartEl = document.getElementById('dash-monthly-chart');
  const labelsEl = document.getElementById('dash-monthly-labels');
  const totalEl = document.getElementById('dash-monthly-total');
  if (chartEl) {
    const months = [];
    for (let i=5; i>=0; i--) {
      const d = new Date(); d.setDate(1); d.setMonth(d.getMonth()-i);
      months.push({ key: d.toISOString().slice(0,7), label: d.toLocaleString('default',{month:'short'}) });
    }
    const monthData = months.map(m => ({
      label: m.label,
      total: allTxns.filter(t=>(t.transaction_date||'').startsWith(m.key)).reduce((s,t)=>s+Number(t.amount||0),0)
    }));
    const maxVal = Math.max(...monthData.map(m=>m.total), 1);
    chartEl.innerHTML = monthData.map(m => {
      const h = Math.round((m.total/maxVal)*80);
      const isLatest = m.label === monthData[5].label;
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:.2rem">
        <div style="font-size:.58rem;color:var(--ink-faint)">${m.total>0?'Ksh '+(m.total>=1000?(m.total/1000).toFixed(0)+'K':m.total):''}</div>
        <div style="width:100%;background:${isLatest?'var(--maroon)':'var(--maroon-pale)'};height:${h||3}px;border-radius:2px 2px 0 0;min-height:3px;margin-top:auto"></div>
      </div>`;
    }).join('');
    if (labelsEl) labelsEl.innerHTML = monthData.map(m=>`<div style="flex:1;text-align:center">${m.label}</div>`).join('');
    const sixMonthTotal = monthData.reduce((s,m)=>s+m.total,0);
    if (totalEl) totalEl.textContent = 'Total (6 months): Ksh ' + sixMonthTotal.toLocaleString();
  }

  // ── Module summary cards (MGR + Table Banking + Fines) ──
  loadDashboardModuleCards(orgId);

  // ── Members snapshot ──
  const snapSub = document.getElementById('dash-members-snap-sub');
  if (snapSub) snapSub.textContent = `${members.length} members · ${activeMems} active`;
  document.getElementById('dash-members-table').innerHTML = members.slice(0,8).map(m => {
    const bal = Number(m.shares_balance||0) + Number(m.savings_balance||0);
    return `<tr onclick="openMemberDetail('${m.id}')" style="cursor:pointer">
      <td style="font-weight:600;color:var(--maroon)">#${m.member_number||'—'}</td>
      <td><strong>${m.full_name}</strong></td>
      <td style="font-size:.78rem">${m.phone||'—'}</td>
      <td style="font-weight:600">Ksh ${bal.toLocaleString()}</td>
      <td><span class="badge ${m.status==='active'?'badge-green':m.status==='arrears'?'badge-warn':'badge-grey'}">${m.status}</span></td>
    </tr>`;
  }).join('') + (members.length>8 ? `<tr><td colspan="5" style="text-align:center;padding:.65rem"><button class="btn btn-ghost btn-sm" onclick="showPage('members')">View all ${members.length} members →</button></td></tr>` : '');
}


async function loadDashboardModuleCards(orgId) {
  const container = document.getElementById('dash-module-cards');
  if (!container) return;
  container.innerHTML = '';

  // Fetch MGR, Table Banking, Fines in parallel
  const [mgrRes, tbRes, finesRes] = await Promise.all([
    sb.from('merry_go_round_cycles').select('id,name,status,total_pool,current_round,total_rounds').eq('org_id', orgId).order('created_at', {ascending: false}).limit(5),
    sb.from('table_banking_pools').select('id,name,status,total_pool,total_loans_outstanding,total_interest_earned').eq('org_id', orgId).order('created_at', {ascending: false}).limit(5),
    sb.from('fines').select('id,amount,status').eq('org_id', orgId).eq('status', 'pending'),
  ]);

  const cycles  = mgrRes.data  || [];
  const pools   = tbRes.data   || [];
  const pending = finesRes.data || [];

  // ── MGR Card ──
  if (cycles.length > 0) {
    const active = cycles.filter(c => c.status === 'active');
    const totalPool = cycles.reduce((s,c) => s + Number(c.total_pool||0), 0);
    const activeRound = active[0];
    const roundProgress = activeRound
      ? `Round ${activeRound.current_round||1} of ${activeRound.total_rounds||'?'}`
      : '';

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
          <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Total Pool</div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--maroon)">Ksh ${totalPool.toLocaleString()}</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .85rem">
          <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Active Cycles</div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--ink)">${active.length}</div>
        </div>
      </div>
      ${activeRound ? `
      <div style="padding:0 1.25rem 1rem">
        <div style="font-size:.72rem;color:var(--ink-soft);margin-bottom:.35rem">${activeRound.name} — ${roundProgress}</div>
        <div style="height:5px;background:var(--border);border-radius:3px">
          <div style="height:100%;width:${Math.round(((activeRound.current_round||1)/(activeRound.total_rounds||1))*100)}%;background:var(--teal);border-radius:3px;transition:width 1s ease"></div>
        </div>
      </div>` : `<div style="padding:0 1.25rem 1rem;font-size:.75rem;color:var(--ink-faint)">No active cycle — <a onclick="showPage('mgr')" style="color:var(--teal);cursor:pointer">start one →</a></div>`}`;
    container.appendChild(card);
  }

  // ── Table Banking Card ──
  if (pools.length > 0) {
    const active = pools.filter(p => p.status === 'active');
    const totalPool = pools.reduce((s,p) => s + Number(p.total_pool||0), 0);
    const totalLoans = pools.reduce((s,p) => s + Number(p.total_loans_outstanding||0), 0);
    const totalInterest = pools.reduce((s,p) => s + Number(p.total_interest_earned||0), 0);

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
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Pool</div>
          <div style="font-size:1rem;font-weight:700;color:var(--teal)">Ksh ${(totalPool/1000).toFixed(0)}K</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .75rem">
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Loans Out</div>
          <div style="font-size:1rem;font-weight:700;color:var(--maroon)">Ksh ${(totalLoans/1000).toFixed(0)}K</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .75rem">
          <div style="font-size:.58rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Interest</div>
          <div style="font-size:1rem;font-weight:700;color:var(--ink)">Ksh ${(totalInterest/1000).toFixed(0)}K</div>
        </div>
      </div>
      ${totalLoans > 0 ? `
      <div style="padding:0 1.25rem 1rem">
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--ink-faint);margin-bottom:.3rem">
          <span>Loans outstanding</span>
          <span>${totalPool>0?Math.round((totalLoans/totalPool)*100):0}% of pool</span>
        </div>
        <div style="height:5px;background:var(--border);border-radius:3px">
          <div style="height:100%;width:${totalPool>0?Math.min(100,Math.round((totalLoans/totalPool)*100)):0}%;background:var(--maroon);border-radius:3px"></div>
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
      <div style="padding:.75rem 1.25rem 1rem;display:grid;grid-template-columns:1fr 1fr;gap:.65rem">
        <div style="background:var(--maroon-pale);border-radius:6px;padding:.65rem .85rem">
          <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--maroon);margin-bottom:.2rem">Total Outstanding</div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--maroon)">Ksh ${totalOwed.toLocaleString()}</div>
        </div>
        <div style="background:var(--surface);border-radius:6px;padding:.65rem .85rem">
          <div style="font-size:.62rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);margin-bottom:.2rem">Pending Count</div>
          <div style="font-size:1.15rem;font-weight:700;color:var(--ink)">${pending.length}</div>
        </div>
      </div>
      <div style="padding:0 1.25rem 1rem;font-size:.75rem;color:var(--ink-faint)">
        Click to view and resolve in Finance → Fines
      </div>`;
    container.appendChild(card);
  }

  // If no module data at all, hide the container
  if (container.children.length === 0) {
    container.style.display = 'none';
  }
}
