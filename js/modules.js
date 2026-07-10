// GroupYetu360 — js/modules.js
// Auto-split from index.html
// globals: window.sb, window.currentOrg, window.currentUser, window.currentProfile etc.

// ── MEETINGS ──
async function loadMeetings() {
  if (!currentOrg?.id) return;
  const role = currentProfile?.role;
  const canSchedule = ['admin','officer','treasurer'].includes(role);

  // ── Admin buttons ──
  const adminBtn = document.getElementById('meetings-admin-btn');
  if (adminBtn) {
    adminBtn.innerHTML = canSchedule ? `
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn fin-ctrl-btn" onclick="sendMeetingReminders()" id="reminder-btn">📱 Reminders</button>
        <button class="btn btn-primary" onclick="showModal('scheduleMeeting')">+ Schedule Meeting</button>
      </div>` : '';
  }

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const thisYear = today.getFullYear().toString();

  const [upcomingRes, pastRes, yearRes] = await Promise.all([
    sb.from('meetings').select('*').eq('org_id', currentOrg.id).gte('meeting_date', todayStr).order('meeting_date'),
    sb.from('meetings').select('*').eq('org_id', currentOrg.id).lt('meeting_date', todayStr).order('meeting_date',{ascending:false}).limit(6),
    sb.from('meetings').select('id').eq('org_id', currentOrg.id).gte('meeting_date', thisYear+'-01-01')
  ]);

  const upcoming = upcomingRes.data || [];
  const past = pastRes.data || [];
  const yearTotal = yearRes.data?.length || 0;

  // ── Stats ──
  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('mtg-stat-upcoming', upcoming.length);
  setEl('mtg-stat-total', yearTotal);

  // Avg attendance from past meetings
  let attRate = '—';
  if (past.length && allMembers.length) {
    const { data: attData } = await sb.from('attendance')
      .select('status')
      .in('meeting_id', past.map(m=>m.id))
      .eq('status','present');
    const present = attData?.length || 0;
    const total = past.length * allMembers.length;
    attRate = total > 0 ? Math.round((present/total)*100) + '%' : '—';
  }
  setEl('mtg-stat-rate', attRate);

  // ── Hero sub ──
  const heroSub = document.getElementById('mtg-hero-sub');
  if (heroSub) {
    const nextMtg = upcoming[0];
    if (nextMtg) {
      const daysAway = Math.ceil((new Date(nextMtg.meeting_date) - today) / (1000*60*60*24));
      heroSub.textContent = daysAway === 0 ? 'Meeting today!' :
        daysAway === 1 ? 'Next meeting tomorrow' :
        `Next meeting in ${daysAway} days`;
    } else {
      heroSub.textContent = 'No upcoming meetings scheduled';
    }
  }

  // ── Render meeting card ──
  const renderCard = (m, isPast) => {
    const d = new Date(m.meeting_date);
    const daysAway = Math.ceil((d - today) / (1000*60*60*24));
    const isToday = daysAway === 0;
    const isSoon = daysAway > 0 && daysAway <= 3;
    const countdownClass = isToday ? 'today' : isSoon ? 'soon' : '';
    const countdownText = isPast ? '' :
      isToday ? '📍 Today' :
      daysAway === 1 ? '⏰ Tomorrow' :
      `In ${daysAway} days`;

    return `<div class="mtg-card ${isPast?'past':''}" onclick="${isPast?'':''} selectMeeting('${m.id}','${d.toDateString()}')">
      <div class="mtg-date-block">
        <div class="mtg-cal ${isPast?'past':''}">
          <div class="mtg-cal-month">${d.toLocaleString('default',{month:'short'})}</div>
          <div class="mtg-cal-day">${d.getDate()}</div>
        </div>
        <div style="flex:1;min-width:0">
          <div class="mtg-title">${m.agenda ? m.agenda.slice(0,40)+(m.agenda.length>40?'…':'') : (isPast ? 'Past Meeting' : 'General Meeting')}</div>
          <div class="mtg-meta">
            <span>🕐 ${m.meeting_time||'Time TBA'}</span>
            <span>📍 ${m.venue||'Venue TBA'}</span>
          </div>
          ${!isPast && countdownText ? `<div class="mtg-countdown ${countdownClass}">${countdownText}</div>` : ''}
          ${isPast ? `<div style="margin-top:.3rem"><span class="badge ${m.minutes?'badge-green':'badge-grey'}" style="font-size:.62rem">${m.minutes?'✓ Minutes filed':'Pending minutes'}</span></div>` : ''}
        </div>
      </div>
      <div class="mtg-card-actions">
        <button class="btn btn-secondary btn-sm" style="font-size:.7rem"
          onclick="event.stopPropagation();selectMeeting('${m.id}','${d.toDateString()}')">
          ${isPast?'View Attendance':'Take Attendance'}
        </button>
        ${canSchedule ? `<button class="btn btn-danger btn-sm" style="font-size:.7rem"
          onclick="event.stopPropagation();deleteMeeting('${m.id}')">✕</button>` : ''}
      </div>
    </div>`;
  };

  // ── Upcoming ──
  const upEl = document.getElementById('upcoming-meetings');
  if (upEl) upEl.innerHTML = upcoming.length ?
    upcoming.map(m => renderCard(m, false)).join('') :
    `<div style="padding:1.5rem;text-align:center">
      <div style="font-size:1.5rem;margin-bottom:.5rem">📅</div>
      <div style="font-size:.82rem;color:var(--ink-faint);margin-bottom:.75rem">No upcoming meetings</div>
      ${canSchedule ? '<button class="btn btn-primary btn-sm" onclick="showModal(`scheduleMeeting`)">Schedule One</button>' : ''}
    </div>`;

  // ── Past ──
  const pastEl = document.getElementById('past-meetings');
  if (pastEl) pastEl.innerHTML = past.length ?
    past.map(m => renderCard(m, true)).join('') :
    '<div style="padding:1rem;font-size:.82rem;color:var(--ink-faint)">No past meetings recorded yet.</div>';
}

async function deleteMeeting(id) {
  if (!confirm('Delete this meeting?')) return;
  await sb.from('attendance').delete().eq('meeting_id', id);
  await sb.from('meetings').delete().eq('id', id);
  toast('Meeting deleted');
  loadMeetings();
}

function exportAttendance() {
  if (!selectedMeetingId || !allMembers.length) return;
  const rows = [['Member','Status']];
  allMembers.forEach(m => rows.push([m.full_name, attState[m.id] || 'absent']));
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'attendance.csv';
  a.click();
}

async function selectMeeting(meetingId, dateStr) {
  selectedMeetingId = meetingId;
  document.getElementById('att-meeting-label').textContent = '📅 Recording attendance for: ' + dateStr;
  document.getElementById('att-save-btn').style.display = 'inline-flex';
  const expBtn = document.getElementById('att-export-btn');
  if (expBtn) expBtn.style.display = 'inline-flex';
  const grid = document.getElementById('att-grid');
  grid.innerHTML = '<div class="loading"><div class="spinner"></div>Loading members…</div>';
  const { data: existing } = await sb.from('attendance').select('*').eq('meeting_id', meetingId);
  attState = {};
  existing?.forEach(a => { attState[a.member_id] = a.status; });
  grid.innerHTML = allMembers.map(m => {
    const s = attState[m.id] || 'absent';
    const label = s === 'present' ? 'Present' : s === 'apology' ? 'Apology' : 'Absent';
    return `<button class="att-btn ${s}" onclick="cycleAtt('${m.id}',this)">
      <span class="att-btn-name">${h(m.full_name)}</span>
      <span class="att-btn-status">${label}</span>
    </button>`;
  }).join('');
  updateAttCounts();
}

function cycleAtt(memberId, btn) {
  const states = ['present','apology','absent'];
  const cur = states.indexOf(attState[memberId] || 'absent');
  attState[memberId] = states[(cur+1)%3];
  btn.className = 'att-btn ' + attState[memberId];
  const labelEl = btn.querySelector('.att-btn-status');
  if (labelEl) {
    labelEl.textContent = attState[memberId] === 'present' ? 'Present' : attState[memberId] === 'apology' ? 'Apology' : 'Absent';
  }
  updateAttCounts();
}

function updateAttCounts() {
  const vals = Object.values(attState);
  document.getElementById('att-present-count').textContent = vals.filter(v=>v==='present').length;
  document.getElementById('att-apology-count').textContent = vals.filter(v=>v==='apology').length;
  document.getElementById('att-absent-count').textContent = vals.filter(v=>v==='absent').length;
}

async function saveAttendance() {
  if (!selectedMeetingId) return;
  const records = allMembers.map(m => ({ meeting_id: selectedMeetingId, member_id: m.id, status: attState[m.id] || 'absent' }));
  const { error } = await sb.from('attendance').upsert(records, { onConflict: 'meeting_id,member_id' });
  if (error) { toast('Error saving: ' + error.message); return; }
  toast('Attendance saved successfully');
}

async function sendMeetingReminders() {
  const btn = document.getElementById('reminder-btn');
  const statusEl = document.getElementById('meetings-reminder-status');

  try {
    // Get upcoming meetings in next 7 days first — show count in confirm dialog
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7*24*60*60*1000).toISOString().split('T')[0];
    const { data: meetings } = await sb.from('meetings')
      .select('*')
      .eq('org_id', currentOrg.id)
      .gte('meeting_date', today)
      .lte('meeting_date', nextWeek)
      .eq('status', 'scheduled');

    if (!meetings?.length) {
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.innerHTML = '<div class="alert alert-info">No meetings scheduled in the next 7 days.</div>';
      }
      return;
    }

    const activeMembers = allMembers.filter(m => m.phone && m.status === 'active');
    const meetingSummary = meetings.map(m =>
      `• ${new Date(m.meeting_date).toDateString()} at ${m.meeting_time||'8:30 PM'} (${m.venue||'Online'})`
    ).join('\n');

    // ── Confirmation dialog ──
    const confirmed = await new Promise(resolve => {
      const msg = `This will send an SMS to ${activeMembers.length} active member(s) for:\n\n${meetingSummary}\n\nThis cannot be undone.`;
      resolve(window.confirm(msg));
    });
    if (!confirmed) return;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Sending...'; }

    // Send reminder for each upcoming meeting
    let totalSent = 0;
    for (const meeting of meetings) {
      const meetDate = new Date(meeting.meeting_date).toDateString();
      const message = `Dear Member, reminder: ${currentOrg.name} meeting is on ${meetDate} at ${meeting.meeting_time||'8:30 PM'} (${meeting.venue||'Online'}). Please be available. Regards, GroupYetu360.`;

      const phones = activeMembers.map(m => m.phone);
      if (!phones.length) continue;

      const result = await sendSMS(phones, message);
      const sent = result?.sent || 0;
      totalSent += sent;

      await sb.from('messages_log').insert({
        org_id: currentOrg.id,
        recipient_type: 'meeting_reminder',
        body: message,
        recipient_count: sent,
        sent_by: currentUser.id
      });

      // ── Activity log entry ──
      await logActivity(
        'SEND_MEETING_REMINDER',
        `Sent meeting reminder to ${sent} members for meeting on ${meetDate}`,
        'meeting', meeting.id
      );

      if (sent > 0) await trackSmsUsage(currentOrg.id, sent);
    }

    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = `<div class="alert alert-success">✓ Reminders sent to ${totalSent} members for ${meetings.length} upcoming meeting${meetings.length>1?'s':''}.` + `</div>`;
      setTimeout(() => { statusEl.style.display = 'none'; }, 8000);
    }

  } catch(e) {
    if (statusEl) {
      statusEl.style.display = 'block';
      statusEl.innerHTML = `<div class="alert alert-warn">Failed to send reminders: ${e.message}</div>`;
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = '📱 Send Reminders'; }
}

function updateMeetVenueDetailField() {
  const type = document.getElementById('meet-venue')?.value;
  const labelEl = document.getElementById('meet-venue-detail-label');
  const inputEl = document.getElementById('meet-venue-detail');
  if (!labelEl || !inputEl) return;
  if (type === 'Physical Location') {
    labelEl.textContent = 'Location';
    inputEl.placeholder = 'e.g. Community Hall, Kibra';
  } else {
    labelEl.textContent = 'Meeting Link';
    inputEl.placeholder = 'e.g. Zoom/Google Meet link';
  }
}

async function saveMeeting() {
  if (!currentOrg?.id) return;
  const venueType = document.getElementById('meet-venue').value;
  const venueDetail = document.getElementById('meet-venue-detail').value.trim();
  // Actual venue saved is the real name/link the admin typed, not the generic
  // "Physical Location"/"Online (Virtual)" label — that label alone used to
  // get saved verbatim as the venue, which is why every meeting just showed
  // "Physical Location" with no actual place name. Falls back to the plain
  // label only if the detail field was left blank, so nothing breaks for
  // meetings scheduled without filling it in.
  const venue = venueDetail
    ? (venueType === 'Physical Location' ? venueDetail : `Online — ${venueDetail}`)
    : venueType;
  const payload = {
    org_id: currentOrg.id,
    meeting_date: document.getElementById('meet-date').value,
    meeting_time: document.getElementById('meet-time').value,
    venue,
    agenda: document.getElementById('meet-agenda').value,
    status: 'scheduled'
  };
  if (!payload.meeting_date) { toast('Please select a date'); return; }
  const { error } = await sb.from('meetings').insert(payload);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Meeting scheduled');
  closeModal('scheduleMeeting');
  loadMeetings();
}


// ── WELFARE ──
let _welTypes = []; // cached welfare event types for this org

async function loadWelfare() {
  if (!currentOrg?.id) return;

  // ── Load org's welfare event types ──
  try {
    const { data: types } = await sb.from('welfare_event_types')
      .select('*').eq('org_id', currentOrg.id).order('created_at');
    _welTypes = types || [];
  } catch(e) { _welTypes = []; }

  // ── Hero — show org's event types as pills ──
  const subEl = document.getElementById('wel-hero-sub');
  if (subEl) subEl.textContent = currentOrg.name + ' Welfare Fund';
  const pillsEl = document.getElementById('wel-rates-pills');
  if (pillsEl) {
    if (_welTypes.length) {
      pillsEl.innerHTML = _welTypes.map(t => `
        <div class="wel-rate-pill">
          <span class="wel-rate-pill-label">${t.name}</span>
          <span class="wel-rate-pill-val">Ksh ${Number(t.default_amount||0).toLocaleString()}</span>
        </div>`).join('');
    } else {
      pillsEl.innerHTML = '<div style="font-size:.75rem;opacity:.7;margin-top:.35rem">No event types configured yet — add them in Settings → Welfare</div>';
    }
  }

  // ── Fetch events ──
  const { data } = await sb.from('welfare_events')
    .select('*,members(full_name)')
    .eq('org_id', currentOrg.id)
    .order('created_at', {ascending: false});
  const events = data || [];

  // ── Fetch actual collected totals per event, live from transactions —
  // this is the real fix: contribution_per_member*paidCount was previously
  // an ESTIMATE since welfare_event_id was never actually set on any
  // transaction. Now that approvePaymentRequest() sets it correctly, we
  // can compute real collected totals and real paid-member lists.
  const { data: welTxns } = await sb.from('transactions')
    .select('welfare_event_id,member_id,amount')
    .eq('org_id', currentOrg.id)
    .not('welfare_event_id', 'is', null);
  const txnsByEvent = {};
  (welTxns||[]).forEach(t => {
    if (!txnsByEvent[t.welfare_event_id]) txnsByEvent[t.welfare_event_id] = [];
    txnsByEvent[t.welfare_event_id].push(t);
  });

  // ── Fetch disbursement records for closed events ──
  const { data: disbursements } = await sb.from('expenses')
    .select('welfare_event_id,amount,description,expense_date')
    .eq('org_id', currentOrg.id)
    .not('welfare_event_id', 'is', null);
  const disbByEvent = {};
  (disbursements||[]).forEach(d => { disbByEvent[d.welfare_event_id] = d; });

  // ── Stats ──
  const openEvents = events.filter(e => e.is_active !== false);
  const totalCollectedAllEvents = Object.values(txnsByEvent).flat().reduce((s,t)=>s+Number(t.amount||0),0);
  const openCollected = openEvents.reduce((s,e) => {
    const txns = txnsByEvent[e.id] || [];
    return s + txns.reduce((s2,t)=>s2+Number(t.amount||0),0);
  }, 0);
  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('wel-stat-total', events.length);
  setEl('wel-stat-open', openEvents.length);
  setEl('wel-stat-collected', 'Ksh ' + openCollected.toLocaleString());

  // ── Event type labels ──
  const typeLabel = {
    member: 'Member Death', spouse: 'Spouse / Parent Death', child: 'Child Death',
    community: 'Community Contribution', annual_party: 'Annual Party / Celebration',
    emergency_fund: 'Emergency Fund', custom: 'Custom Event'
  };
  const typeIcon = {
    member: '🕊', spouse: '🕊', child: '🕊',
    community: '🤝', annual_party: '🎉', emergency_fund: '⚡', custom: '♡'
  };

  // ── Render events ──
  const listEl = document.getElementById('welfare-events-list');
  if (!events.length) {
    listEl.innerHTML = `<div class="wel-empty card">
      <div class="wel-empty-icon">♡</div>
      <div class="wel-empty-title">No welfare events recorded</div>
      <div class="wel-empty-sub">Create a welfare event when a member needs group support</div>
      <button class="btn btn-primary" style="width:auto;padding:.65rem 1.5rem" onclick="showModal('welfareEvent')">+ Record First Event</button>
    </div>`;
    return;
  }

  listEl.innerHTML = events.map((e, i) => {
    const isGeneral = !e.affected_member_id;
    const isClosed = e.is_active === false;
    const isOpenEnded = !e.contribution_per_member || Number(e.contribution_per_member) <= 0;
    const label = typeLabel[e.event_type] || e.event_type || 'Welfare Event';
    const icon = typeIcon[e.event_type] || '♡';
    const memberName = isGeneral ? 'General / Community' : (e.members?.full_name || 'Member');
    const dateStr = e.event_date ? new Date(e.event_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : 'Date not set';
    const cardClass = isClosed ? 'closed' : isGeneral ? 'general' : '';
    const txns = txnsByEvent[e.id] || [];
    const paidIds = new Set(txns.map(t=>t.member_id));
    const paidCount = paidIds.size;
    const totalMembers = allMembers?.length || 0;
    const collectedPool = txns.reduce((s,t)=>s+Number(t.amount||0),0);
    const expectedPool = isOpenEnded ? null : Number(e.contribution_per_member||0) * totalMembers;
    const paidPct = (!isOpenEnded && totalMembers) ? Math.round((paidCount/totalMembers)*100) : null;
    const disb = disbByEvent[e.id];

    return `<div class="wel-event-card ${cardClass}" style="animation-delay:${i*0.05}s">
      <div class="wel-event-header">
        <div class="wel-event-icon ${isGeneral?'general':''}">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem">
            <div class="wel-event-type">${label}</div>
            <span class="badge ${isClosed?'badge-grey':'badge-green'}" style="font-size:.6rem">${isClosed?'Closed':'Open'}</span>
            ${isGeneral?'<span class="badge badge-grey" style="font-size:.6rem;background:var(--teal-pale);color:var(--teal-dk)">General</span>':''}
            ${isOpenEnded?'<span class="badge badge-grey" style="font-size:.6rem;background:var(--gold-pale);color:#8a6d1f">Open Contribution</span>':''}
          </div>
          <div class="wel-event-member">👤 ${h(memberName)}</div>
          <div class="wel-event-date">📅 ${dateStr}</div>
        </div>
        <div style="text-align:right">
          ${isOpenEnded
            ? `<div class="wel-event-amt-val">Ksh ${collectedPool.toLocaleString()}</div><div class="wel-event-amt-label">collected so far</div>`
            : `<div class="wel-event-amt-val">Ksh ${Number(e.contribution_per_member).toLocaleString()}</div><div class="wel-event-amt-label">per member</div><div style="font-size:.65rem;color:var(--teal);margin-top:.2rem">Pool: Ksh ${collectedPool.toLocaleString()}</div>`}
        </div>
      </div>
      ${(!isOpenEnded && totalMembers) ? `<div style="padding:0 1rem .75rem">
        <div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--ink-faint);margin-bottom:.25rem">
          <span>${paidCount} of ${totalMembers} paid</span><span>${paidPct}%</span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:2px">
          <div style="height:100%;width:${paidPct}%;background:${paidPct===100?'var(--teal)':'var(--maroon)'};border-radius:2px;transition:width .8s ease"></div>
        </div>
      </div>` : ''}
      ${isClosed && disb ? `<div style="padding:.6rem 1rem;background:var(--surface-2);border-top:1px solid var(--border);font-size:.75rem;color:var(--ink-soft)">
        <strong>Disbursed:</strong> Ksh ${Number(disb.amount).toLocaleString()} — ${h(disb.description||'')} <span style="color:var(--ink-faint)">(${disb.expense_date||''})</span>
      </div>` : ''}
      ${isClosed && !disb ? `<div style="padding:.6rem 1rem;background:var(--maroon-pale);border-top:1px solid var(--border);font-size:.75rem;color:var(--maroon)">
        ⚠ Closed without a recorded disbursement
      </div>` : ''}
      <div class="wel-event-footer">
        <div class="wel-event-notes">${h(e.notes) || 'No notes'}</div>
        <div style="display:flex;gap:.4rem">
          <button class="btn btn-secondary btn-sm" style="font-size:.7rem"
            onclick="openWelfareContribs('${e.id}','${label.replace(/'/g,"\\'")}',${isOpenEnded ? 0 : Number(e.contribution_per_member)})">
            👥 Track
          </button>
          ${!isClosed ? `<button class="btn btn-secondary btn-sm" style="font-size:.7rem"
            onclick="openCloseWelfareModal('${e.id}','${label.replace(/'/g,"\\'")}',${collectedPool})">
            ✓ Close &amp; Disburse
          </button>` : `<button class="btn btn-secondary btn-sm" style="font-size:.7rem"
            onclick="reopenWelfareEvent('${e.id}')">
            ↺ Reopen
          </button>`}
          <button class="btn btn-danger btn-sm" style="font-size:.7rem"
            onclick="deleteWelfareEvent('${e.id}')">✕</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function deleteWelfareEvent(id) {
  if (!confirm('Delete this welfare event? This cannot be undone.')) return;
  const { error } = await sb.from('welfare_events').delete().eq('id', id);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Welfare event deleted');
  loadWelfare();
}

async function reopenWelfareEvent(id) {
  await sb.from('welfare_events').update({ is_active: true, closed_by: null, closed_at: null }).eq('id', id);
  toast('✓ Welfare event reopened — visible to members');
  await logActivity('WELFARE REOPEN', 'Welfare event reopened', 'welfare', id);
  loadWelfare();
}

// ── Close & Disburse — replaces the old one-click toggleWelfareActive() close
// path. Closing a welfare event now REQUIRES recording where the money
// actually went (recipient, amount, method) — a real disbursement, not just
// flipping a flag. This is the actual point of separating welfare money from
// bank_balance: making the disbursement side as visible as the collection
// side, since money silently going to a personal M-Pesa number with no
// group-visible record was the original problem being solved.
let _welCloseCtx = null;

function openCloseWelfareModal(eventId, eventLabel, collectedTotal) {
  _welCloseCtx = { eventId, eventLabel, collectedTotal };
  const setVal = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
  setVal('wcl-amount', collectedTotal);
  setVal('wcl-recipient', '');
  setVal('wcl-phone', '');
  setVal('wcl-method', 'mpesa');
  setVal('wcl-notes', '');
  const titleEl = document.getElementById('wcl-modal-title');
  if (titleEl) titleEl.textContent = 'Close & Disburse — ' + eventLabel;
  const collectedEl = document.getElementById('wcl-collected-total');
  if (collectedEl) collectedEl.textContent = 'Ksh ' + Number(collectedTotal).toLocaleString() + ' collected';
  const warnEl = document.getElementById('wcl-mismatch-warning');
  if (warnEl) warnEl.style.display = 'none';
  showModal('welfareClose');
}

function checkWelfareCloseMismatch() {
  if (!_welCloseCtx) return;
  const amt = parseFloat(document.getElementById('wcl-amount')?.value) || 0;
  const warnEl = document.getElementById('wcl-mismatch-warning');
  const notesEl = document.getElementById('wcl-notes');
  const mismatch = Math.abs(amt - _welCloseCtx.collectedTotal) > 0.5;
  if (warnEl) {
    warnEl.style.display = mismatch ? 'block' : 'none';
    warnEl.textContent = mismatch
      ? `⚠ Disbursed amount differs from Ksh ${_welCloseCtx.collectedTotal.toLocaleString()} collected — please explain in notes below.`
      : '';
  }
  if (notesEl) notesEl.required = mismatch;
}

async function submitCloseWelfare() {
  if (!_welCloseCtx) return;
  const amount = parseFloat(document.getElementById('wcl-amount')?.value);
  const recipient = document.getElementById('wcl-recipient')?.value?.trim();
  const phone = document.getElementById('wcl-phone')?.value?.trim();
  const method = document.getElementById('wcl-method')?.value || 'mpesa';
  const notes = document.getElementById('wcl-notes')?.value?.trim();

  if (!amount || amount <= 0) { toast('Please enter the disbursed amount'); return; }
  if (!recipient) { toast('Please enter who received the funds'); return; }
  const mismatch = Math.abs(amount - _welCloseCtx.collectedTotal) > 0.5;
  if (mismatch && !notes) { toast('Please explain the mismatch between collected and disbursed amounts in the notes'); return; }
  if (!canDo('recordPayment')) { toast('⚠ You do not have permission to close welfare events.'); return; }

  const methodLabel = { mpesa: 'M-Pesa', cash: 'Cash', bank: 'Bank Transfer' }[method] || method;

  // Record the disbursement as an expense, tagged to this welfare event —
  // reuses the existing expenses table rather than a new one. This does NOT
  // touch bank_balance, matching how the collection side never did either —
  // welfare money stays fully independent of the everyday balance, in and out.
  const { error: expErr } = await sb.from('expenses').insert({
    org_id: currentOrg.id,
    category: 'Welfare Disbursement',
    description: `${_welCloseCtx.eventLabel} → ${recipient}${phone ? ' ('+phone+')' : ''} via ${methodLabel}`,
    amount,
    expense_date: new Date().toISOString().split('T')[0],
    entry_type: 'expense',
    welfare_event_id: _welCloseCtx.eventId,
    recorded_by: currentUser.id,
    notes: notes || null
  });
  if (expErr) { toast('Error recording disbursement: ' + expErr.message); return; }

  const { error: closeErr } = await sb.from('welfare_events').update({
    is_active: false,
    closed_by: currentUser.id,
    closed_at: new Date().toISOString()
  }).eq('id', _welCloseCtx.eventId);
  if (closeErr) { toast('Disbursement recorded, but failed to close event: ' + closeErr.message); return; }

  await logActivity('WELFARE CLOSE',
    `Closed "${_welCloseCtx.eventLabel}" — disbursed Ksh ${amount.toLocaleString()} to ${recipient} via ${methodLabel}`,
    'welfare', _welCloseCtx.eventId);

  toast('✓ Welfare event closed and disbursement recorded');
  closeModal('welfareClose');
  _welCloseCtx = null;
  loadWelfare();
}

async function saveWelfareEvent() {
  if (!currentOrg?.id) return;
  const typeVal = document.getElementById('wel-type')?.value;
  if (!typeVal) { toast('Please select an event type'); return; }
  const cat = document.getElementById('wel-category')?.value || 'member_specific';
  const amountRaw = document.getElementById('wel-amount').value;
  // Empty/0 amount = open-ended contribution (no fixed amount per member),
  // not a validation error — a member has no way to specify this otherwise.
  const amount = amountRaw ? parseFloat(amountRaw) : 0;
  const memberId = cat === 'general' ? null : (document.getElementById('wel-member').value || null);
  if (cat === 'member_specific' && !memberId) { toast('Please select the affected member'); return; }

  // Resolve event type name
  let eventTypeName = typeVal;
  if (typeVal === '__custom__') {
    eventTypeName = document.getElementById('wel-custom-name')?.value?.trim() || 'Custom Event';
  } else {
    const found = _welTypes.find(t=>t.id===typeVal);
    if (found) eventTypeName = found.name;
  }

  const payload = {
    org_id: currentOrg.id,
    affected_member_id: memberId,
    event_type: eventTypeName,
    welfare_type_id: typeVal === '__custom__' ? null : typeVal,
    contribution_per_member: amount,
    event_date: document.getElementById('wel-date').value || null,
    notes: document.getElementById('wel-notes').value.trim() || null
  };
  const { error } = await sb.from('welfare_events').insert(payload);
  if (error) { toast('Error: ' + error.message); return; }
  toast('✓ Welfare event created');
  closeModal('welfareEvent');
  loadWelfare();
}

function onWelfareTypeChange(val) {
  const customRow = document.getElementById('wel-custom-name-row');
  const hint = document.getElementById('wel-type-hint');
  if (customRow) customRow.style.display = val==='__custom__' ? 'block' : 'none';
  if (!val || val==='__custom__') { if(hint) hint.style.display='none'; return; }
  const found = _welTypes.find(t=>t.id===val);
  if (found) {
    document.getElementById('wel-amount').value = found.default_amount || '';
    // Set scope
    const catHidden = document.getElementById('wel-category');
    if (catHidden) catHidden.value = found.scope || 'member_specific';
    const memberRow = document.getElementById('wel-member-row');
    if (memberRow) memberRow.style.display = (found.scope==='general') ? 'none' : '';
    // Update segmented control
    document.querySelectorAll('#wel-scope-seg .seg-opt').forEach(o => {
      o.classList.toggle('active', o.dataset.val === (found.scope||'member_specific'));
    });
    if (hint) { hint.style.display='block'; hint.textContent=found.category+' · default Ksh '+(found.default_amount||0).toLocaleString(); }
    updateWelfareTotal();
  }
}

function toggleWelfareScope(el) {
  document.querySelectorAll('#wel-scope-seg .seg-opt').forEach(o=>o.classList.remove('active'));
  el.classList.add('active');
  const val = el.dataset.val;
  const catHidden = document.getElementById('wel-category');
  if (catHidden) catHidden.value = val;
  const memberRow = document.getElementById('wel-member-row');
  if (memberRow) memberRow.style.display = val==='general' ? 'none' : '';
}

function updateWelfareTotal() {
  const amount = parseFloat(document.getElementById('wel-amount')?.value||0);
  const memberCount = allMembers?.length || 0;
  const previewEl = document.getElementById('wel-pool-preview');
  const totalEl = document.getElementById('wel-pool-total');
  const memEl = document.getElementById('wel-pool-members');
  if (!amount || !memberCount) { if(previewEl) previewEl.style.display='none'; return; }
  if (previewEl) previewEl.style.display='block';
  if (totalEl) totalEl.textContent = 'Ksh '+(amount*memberCount).toLocaleString();
  if (memEl) memEl.textContent = memberCount;
}

async function openWelfareContribs(eventId, eventLabel, amtPerMember) {
  document.getElementById('wc-modal-title').textContent = eventLabel;
  const isOpenEnded = !amtPerMember || amtPerMember <= 0;
  document.getElementById('wc-modal-sub').textContent = isOpenEnded ? 'Open contribution — any amount' : 'Ksh '+amtPerMember.toLocaleString()+' per member';
  document.getElementById('wc-member-list').innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  showModal('welfareContribs');
  window._wcCurrentEvent = { eventId, eventLabel, amtPerMember };

  // Get transactions for this welfare event — welfare_event_id is now
  // actually set by approvePaymentRequest(), so this reflects real data.
  const { data: txns } = await sb.from('transactions')
    .select('member_id,amount,transaction_date')
    .eq('org_id', currentOrg.id)
    .eq('welfare_event_id', eventId);
  const amountByMember = {};
  (txns||[]).forEach(t => { amountByMember[t.member_id] = (amountByMember[t.member_id]||0) + Number(t.amount||0); });
  const paidIds = new Set(Object.keys(amountByMember));
  const collected = (txns||[]).reduce((s,t)=>s+Number(t.amount||0),0);
  const members = allMembers || [];
  const expected = isOpenEnded ? null : amtPerMember * members.length;
  const outstanding = isOpenEnded ? null : Math.max(0, expected - collected);
  const pct = (!isOpenEnded && expected) ? Math.round((collected/expected)*100) : null;

  const setDisplay = (id, val) => { const el=document.getElementById(id); if(el) el.style.display = val; };
  document.getElementById('wc-collected').textContent = 'Ksh '+collected.toLocaleString();
  if (isOpenEnded) {
    setDisplay('wc-expected-row', 'none');
    setDisplay('wc-outstanding-row', 'none');
    document.getElementById('wc-progress-bar').style.width = '0%';
    document.getElementById('wc-progress-label').textContent = paidIds.size + ' contributor' + (paidIds.size!==1?'s':'') + ' so far';
  } else {
    setDisplay('wc-expected-row', '');
    setDisplay('wc-outstanding-row', '');
    document.getElementById('wc-expected').textContent = 'Ksh '+expected.toLocaleString();
    document.getElementById('wc-outstanding').textContent = 'Ksh '+outstanding.toLocaleString();
    document.getElementById('wc-progress-bar').style.width = pct+'%';
    document.getElementById('wc-progress-label').textContent = pct+'% collected ('+paidIds.size+' of '+members.length+' members)';
  }

  const listEl = document.getElementById('wc-member-list');
  const paid = members.filter(m=>paidIds.has(m.id));
  const unpaid = members.filter(m=>!paidIds.has(m.id));
  listEl.innerHTML = [
    ...paid.map(m=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 1.25rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:.6rem">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--teal);flex-shrink:0"></div>
        <span style="font-size:.82rem">${h(m.full_name)}</span>
      </div>
      <span class="badge badge-green" style="font-size:.65rem">✓ Ksh ${amountByMember[m.id].toLocaleString()}</span>
    </div>`),
    ...(isOpenEnded ? [] : unpaid.map(m=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:.6rem 1.25rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:.6rem">
        <div style="width:8px;height:8px;border-radius:50%;background:var(--border);flex-shrink:0"></div>
        <span style="font-size:.82rem;color:var(--ink-soft)">${h(m.full_name)}</span>
      </div>
      <span class="badge badge-warn" style="font-size:.65rem">Pending</span>
    </div>`))
  ].join('') || '<div style="padding:2rem;text-align:center;color:var(--ink-faint)">No contributions recorded yet</div>';
}

// Build a plain-text summary formatted for pasting straight into WhatsApp —
// this is what replaces manually typing out a contributor list by hand.
function shareWelfareContribsToWhatsApp() {
  const ctx = window._wcCurrentEvent;
  if (!ctx) return;
  const members = allMembers || [];
  const listEl = document.getElementById('wc-member-list');
  if (!listEl) return;

  sb.from('transactions')
    .select('member_id,amount')
    .eq('org_id', currentOrg.id)
    .eq('welfare_event_id', ctx.eventId)
    .then(({ data: txns }) => {
      const amountByMember = {};
      (txns||[]).forEach(t => { amountByMember[t.member_id] = (amountByMember[t.member_id]||0) + Number(t.amount||0); });
      const collected = Object.values(amountByMember).reduce((s,a)=>s+a,0);
      const paid = members.filter(m=>amountByMember[m.id]);
      const unpaid = members.filter(m=>!amountByMember[m.id]);

      let text = `*${ctx.eventLabel}*\n${currentOrg.name}\n\n*Collected: Ksh ${collected.toLocaleString()}*\n\n✅ *Paid (${paid.length}):*\n`;
      text += paid.map(m => `${m.full_name} — Ksh ${amountByMember[m.id].toLocaleString()}`).join('\n');
      if (!ctx.amtPerMember || ctx.amtPerMember <= 0) {
        text += `\n\n_Open contribution — no fixed amount per member_`;
      } else if (unpaid.length) {
        text += `\n\n⏳ *Pending (${unpaid.length}):*\n` + unpaid.map(m => m.full_name).join('\n');
      }

      const url = 'https://wa.me/?text=' + encodeURIComponent(text);
      window.open(url, '_blank');
    });
}

function setWelfareAmt(val) {
  // Legacy — now handled by onWelfareTypeChange
}

function toggleWelfareCategory(cat) {
  // Legacy — now handled by toggleWelfareScope
}


// ── PROJECTS ──
// Project type icons and labels
const projTypeIcon = {
  farm: '🌾', property: '🏘', business: '💼', vehicle: '🚗',
  equipment: '⚙', livestock: '🐄', other: '⚑'
};

function getProjectIcon(p) {
  const name = (p.name + ' ' + (p.notes||'')).toLowerCase();
  if (name.includes('farm') || name.includes('shamba') || name.includes('crop') || name.includes('harvest')) return '🌾';
  if (name.includes('house') || name.includes('plot') || name.includes('land') || name.includes('property')) return '🏘';
  if (name.includes('vehicle') || name.includes('car') || name.includes('matatu') || name.includes('truck')) return '🚗';
  if (name.includes('livestock') || name.includes('cow') || name.includes('goat') || name.includes('dairy')) return '🐄';
  if (name.includes('business') || name.includes('shop') || name.includes('trade')) return '💼';
  return '⚑';
}

function renderProjectCard(p, idx) {
  const isActive = p.status === 'active';
  const icon = getProjectIcon(p);
  const cost = Number(p.acquisition_cost||0);
  const income = Number(p.total_income||0);
  const expenses = Number(p.total_expenses||0);
  const roi = cost > 0 ? ((income - expenses - cost) / cost * 100).toFixed(1) : null;
  return `<div class="farm-card ${isActive?'':'completed'}" style="animation-delay:${idx*0.05}s">
    <div class="farm-card-body">
      <div style="display:flex;align-items:flex-start;gap:.75rem;margin-bottom:.75rem">
        <div class="proj-type-icon ${isActive?'':'completed'}">${icon}</div>
        <div style="flex:1;min-width:0">
          <div class="farm-name">${p.name}</div>
          <div class="farm-location">📍 ${p.location||'Location not set'}</div>
          <span class="badge ${isActive?'badge-green':'badge-grey'}" style="font-size:.6rem">${p.status}</span>
        </div>
      </div>
      <div class="farm-stat">
        <span class="farm-stat-label">Acquisition Cost</span>
        <span class="farm-stat-val neg">Ksh ${cost.toLocaleString()}</span>
      </div>
      ${income > 0 ? `<div class="farm-stat">
        <span class="farm-stat-label">Total Income</span>
        <span class="farm-stat-val pos">Ksh ${income.toLocaleString()}</span>
      </div>` : ''}
      ${roi !== null ? `<div class="farm-stat">
        <span class="farm-stat-label">ROI</span>
        <span class="farm-stat-val ${parseFloat(roi)>=0?'pos':'neg'}">${roi}%</span>
      </div>` : ''}
      ${p.notes ? `<div style="font-size:.72rem;color:var(--ink-faint);margin-top:.6rem;line-height:1.5">${p.notes}</div>` : ''}
    </div>
    <div class="farm-card-footer">
      <button class="btn btn-secondary btn-sm" style="font-size:.7rem"
        onclick="toggleProjectStatus('${p.id}','${p.status}')">
        ${isActive ? '✓ Mark Complete' : '↺ Reactivate'}
      </button>
      <button class="btn btn-danger btn-sm" style="font-size:.7rem"
        onclick="deleteProject('${p.id}','${p.name.replace(/'/g,"&apos;")}')">✕ Delete</button>
    </div>
  </div>`;
}

function filterProjects(status, btn) {
  document.querySelectorAll('.proj-filter-bar .mf-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const filtered = status === 'all' ? allProjects : allProjects.filter(p => p.status === status);
  const grid = document.getElementById('projects-grid');
  if (!filtered.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:2.5rem;text-align:center">
      <div style="font-size:2rem;margin-bottom:.5rem">⚑</div>
      <div style="font-size:.85rem;color:var(--ink-faint)">${status==='all'?'No projects yet — add your first investment':'No '+status+' projects'}</div>
    </div>`;
    return;
  }
  grid.innerHTML = filtered.map((p,i) => renderProjectCard(p, i)).join('');
}

async function loadProjects() {
  if (!currentOrg?.id) return;
  const { data } = await sb.from('projects').select('*').eq('org_id', currentOrg.id).order('created_at',{ascending:false});
  allProjects = data || [];

  // Stats
  const active = allProjects.filter(p => p.status === 'active');
  const completed = allProjects.filter(p => p.status !== 'active');
  const totalInvested = allProjects.reduce((s,p) => s + Number(p.acquisition_cost||0), 0);
  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('proj-stat-active', active.length);
  setEl('proj-stat-total', allProjects.length);
  setEl('proj-stat-invested', 'Ksh ' + (totalInvested >= 1000000
    ? (totalInvested/1000000).toFixed(1)+'M'
    : totalInvested >= 1000 ? (totalInvested/1000).toFixed(0)+'K'
    : totalInvested.toLocaleString()));
  setEl('proj-stat-completed', completed.length);

  // Hero sub
  const heroSub = document.getElementById('proj-hero-sub');
  if (heroSub) heroSub.textContent = active.length
    ? `${active.length} active project${active.length!==1?'s':''} · Ksh ${totalInvested.toLocaleString()} invested`
    : 'No active projects — add your first investment';

  // Render grid (all by default)
  filterProjects('all', document.querySelector('.proj-filter-bar .mf-pill'));

  // Populate project dropdowns in finance forms
  const projOpts = '<option value="">None</option>' + allProjects.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
  ['exp-project','inc-project'].forEach(id => { const el=document.getElementById(id); if(el) el.innerHTML=projOpts; });
}

async function saveProject() {
  if (!currentOrg?.id) return;
  const payload = {
    org_id: currentOrg.id,
    name: document.getElementById('proj-name').value.trim(),
    location: document.getElementById('proj-location').value.trim(),
    acquisition_cost: parseFloat(document.getElementById('proj-cost').value)||0,
    notes: document.getElementById('proj-notes').value.trim()||null,
    status: 'active'
  };
  if (!payload.name) { toast('Please enter a project name'); return; }
  const { error } = await sb.from('projects').insert(payload);
  if (error) { toast('Error: ' + error.message); return; }
  toast('Project added');
  closeModal('addProject');
  loadProjects();
}

async function deleteProject(projectId, name) {
  if (!confirm('Delete project "' + name + '"? This cannot be undone.')) return;
  const { error } = await sb.from('projects').delete().eq('id', projectId);
  if (error) { toast('Error: ' + error.message); return; }
  toast(name + ' deleted');
  loadProjects();
}

async function toggleProjectStatus(projectId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'completed' : 'active';
  await sb.from('projects').update({ status: newStatus }).eq('id', projectId);
  toast('Project status updated');
  loadProjects();
}


// ── MESSAGES ──
// Track selected recipient type
let _msgRecipientType = 'all';

function setRecipient(type, btn) {
  _msgRecipientType = type;
  document.querySelectorAll('.msg-recipient-pill').forEach(p => p.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const pickerEl = document.getElementById('msg-custom-picker');
  if (type === 'custom') {
    if (pickerEl) pickerEl.style.display = 'block';
    renderCustomMemberList();
    updateCustomSelectionCount();
    const sel = document.getElementById('sms-recipients');
    if (sel) sel.value = 'custom';
    return;
  }
  if (pickerEl) pickerEl.style.display = 'none';

  // Update count label
  let count = 0;
  if (type === 'all') count = allMembers.filter(m => m.phone).length;
  else if (type === 'active') count = allMembers.filter(m => m.phone && m.status === 'active').length;
  else if (type === 'arrears') count = allMembers.filter(m => m.phone && m.status === 'arrears').length;
  const countEl = document.getElementById('msg-recipient-count');
  if (countEl) countEl.textContent = count + ' recipient' + (count!==1?'s':'') + ' with phone numbers';
  const sendCount = document.getElementById('msg-send-count');
  if (sendCount) sendCount.textContent = count + ' member' + (count!==1?'s':'');
  // Sync hidden select (used by sendSms)
  const sel = document.getElementById('sms-recipients');
  if (sel) sel.value = type;
}

// ── Custom member picker (checkbox-based ad-hoc audience, e.g. executive/women's
// wing/youth — no formal sub-group feature exists, this is manual per-send selection) ──
let _customSelectedMemberIds = new Set();

function renderCustomMemberList() {
  const listEl = document.getElementById('msg-custom-list');
  if (!listEl) return;
  const withPhone = allMembers.filter(m => m.phone);
  if (!withPhone.length) {
    listEl.innerHTML = '<div class="msg-cm-empty">No members with phone numbers</div>';
    return;
  }
  listEl.innerHTML = withPhone.map(m => `
    <label class="msg-cm-row" data-name="${(m.full_name||'').toLowerCase()}">
      <input type="checkbox" data-member-id="${m.id}" ${_customSelectedMemberIds.has(m.id)?'checked':''} onchange="toggleCustomMember('${m.id}',this.checked)"/>
      <span class="cm-name">${h(m.full_name||'Unnamed')}</span>
      <span class="cm-phone">${h(m.phone||'')}</span>
    </label>`).join('');
}

function filterCustomMemberList(query) {
  const q = (query||'').toLowerCase().trim();
  document.querySelectorAll('#msg-custom-list .msg-cm-row').forEach(row => {
    row.style.display = !q || row.dataset.name.includes(q) ? 'flex' : 'none';
  });
}

function toggleCustomMember(memberId, checked) {
  if (checked) _customSelectedMemberIds.add(memberId);
  else _customSelectedMemberIds.delete(memberId);
  updateCustomSelectionCount();
}

function toggleAllCustomMembers(selectAll) {
  const visibleIds = Array.from(document.querySelectorAll('#msg-custom-list .msg-cm-row'))
    .filter(row => row.style.display !== 'none')
    .map(row => row.querySelector('input').dataset.memberId);
  visibleIds.forEach(id => selectAll ? _customSelectedMemberIds.add(id) : _customSelectedMemberIds.delete(id));
  renderCustomMemberList();
  updateCustomSelectionCount();
}

function updateCustomSelectionCount() {
  const count = _customSelectedMemberIds.size;
  const countEl = document.getElementById('msg-recipient-count');
  if (countEl) countEl.textContent = count + ' member' + (count!==1?'s':'') + ' selected';
  const sendCount = document.getElementById('msg-send-count');
  if (sendCount) sendCount.textContent = count + ' member' + (count!==1?'s':'');
}

async function loadMessages() {
  const role = currentProfile?.role;
  const adminSection = document.getElementById('msg-admin-section');
  const subEl = document.getElementById('msg-page-sub');

  if (role === 'member') {
    if (subEl) subEl.textContent = 'Notices from your group admin';
    if (adminSection) adminSection.style.display = 'none';
    return;
  }
  if (adminSection) adminSection.style.display = 'block';

  // Paybill
  renderPaymentMethods(currentOrg, 'msg-payment-methods-display', true);

  // ── SMS Status ──
  // Real provider comes from the safe public view (non-sensitive) — works for every
  // role. Actual credential presence (for leopard/AT) still requires the SA-only table,
  // so those two branches degrade gracefully to "assume active" for non-SA callers.
  let smsActive = true;
  try {
    const { data: psPublic } = await sb.from('platform_settings_public').select('sms_provider').maybeSingle();
    const provider = psPublic?.sms_provider || 'celcom';
    if (provider === 'celcom') {
      smsActive = true;
    } else {
      const { data: ps } = await sb.from('platform_settings').select('sms_leopard_api_key,sms_leopard_api_secret,at_api_key').maybeSingle();
      if (ps) {
        if (provider === 'leopard') smsActive = !!(ps.sms_leopard_api_key && ps.sms_leopard_api_secret);
        else if (provider === 'at') smsActive = !!ps.at_api_key;
      }
      // else: non-SA caller, can't verify leopard/AT credentials — assume active rather
      // than falsely showing Inactive to every non-SA admin.
    }
  } catch(e) {}

  // Update hero dot
  const dot = document.getElementById('msg-status-dot');
  const lbl = document.getElementById('msg-status-label');
  if (dot) dot.className = 'msg-status-dot ' + (smsActive ? 'active' : 'inactive');
  if (lbl) lbl.textContent = smsActive ? 'SMS Active' : 'SMS Inactive';

  const statusEl = document.getElementById('sms-status-body');
  if (statusEl) {
    if (smsActive) {
      // Fetch SMS sent this month from sms_usage
      let sentThisMonth = 0;
      try {
        const month = new Date().toISOString().slice(0,7);
        const { data: usage } = await sb.from('sms_usage')
          .select('messages_sent').eq('org_id', currentOrg.id).eq('month', month).maybeSingle();
        sentThisMonth = usage?.messages_sent || 0;
      } catch(e) {}

      const bundle = currentOrg?.sms_bundle || 0;
      const balColor = bundle === 0 ? 'var(--danger)' : bundle < 20 ? 'var(--warning)' : 'var(--teal)';
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem">
          <div class="msg-status-dot active"></div>
          <div>
            <div style="font-size:.85rem;font-weight:700;color:var(--teal)">SMS Active</div>
            <div style="font-size:.7rem;color:var(--ink-faint)">Messages delivered to members' phones</div>
          </div>
        </div>
        <div style="display:flex;gap:.75rem">
          <div style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:.5rem;padding:.6rem .75rem;text-align:center">
            <div style="font-size:1.3rem;font-weight:700;color:${balColor};line-height:1">${bundle}</div>
            <div style="font-size:.65rem;color:var(--ink-faint);margin-top:.2rem;text-transform:uppercase;letter-spacing:.04em">SMS Balance</div>
          </div>
          <div style="flex:1;background:var(--surface);border:1px solid var(--border);border-radius:.5rem;padding:.6rem .75rem;text-align:center">
            <div style="font-size:1.3rem;font-weight:700;color:var(--ink);line-height:1">${sentThisMonth}</div>
            <div style="font-size:.65rem;color:var(--ink-faint);margin-top:.2rem;text-transform:uppercase;letter-spacing:.04em">Sent This Month</div>
          </div>
        </div>
        ${bundle === 0 ? `<div style="margin-top:.65rem;font-size:.72rem;color:var(--danger);font-weight:600">⚠ Bundle empty — top up via Billing to send messages</div>` : bundle < 20 ? `<div style="margin-top:.65rem;font-size:.72rem;color:var(--warning);font-weight:600">⚠ Low balance — consider topping up soon</div>` : ''}`;
    } else {
      statusEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:.75rem">
          <div class="msg-status-dot inactive"></div>
          <div>
            <div style="font-size:.85rem;font-weight:700;color:var(--danger)">SMS Inactive</div>
            <div style="font-size:.7rem;color:var(--ink-faint);line-height:1.5">Messages are logged but not delivered. Contact GroupYetu360 support to activate.</div>
          </div>
        </div>`;
    }
  }

  // ── Recipient count ──
  setRecipient(_msgRecipientType, document.querySelector('.msg-recipient-pill.active'));

  // ── Message history ──
  const { data } = await sb.from('messages_log').select('*').eq('org_id', currentOrg?.id||'').order('sent_at',{ascending:false}).limit(15);
  const logs = data || [];
  const histEl = document.getElementById('msg-history');
  if (histEl) {
    histEl.innerHTML = logs.length ? logs.map(l => `
      <div class="msg-history-item">
        <div class="msg-history-dot"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.2rem">
            <span style="font-size:.78rem;font-weight:600;color:var(--ink)">${l.recipient_type==='all'?'All Members':l.recipient_type==='active'?'Active Members':'Arrears Members'}</span>
            <span class="badge badge-green" style="font-size:.58rem">${l.recipient_count||0} sent</span>
          </div>
          <div class="msg-history-body">${(l.body||'').substring(0,100)}${(l.body||'').length>100?'…':''}</div>
          <div class="msg-history-meta">${l.sent_at ? new Date(l.sent_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—'}</div>
        </div>
      </div>`).join('') :
      '<div style="padding:1.5rem 1.25rem;text-align:center;font-size:.82rem;color:var(--ink-faint)">No messages sent yet</div>';
  }
}

function updateSmsCount(v) {
  const len = v.length;
  const parts = Math.ceil(len/160)||1;
  const pct = Math.min((len/160)*100, 100);
  const el = document.getElementById('sms-chars');
  const partsEl = document.getElementById('sms-parts');
  const fill = document.getElementById('msg-char-fill');
  if (el) el.textContent = len;
  if (partsEl) partsEl.textContent = parts;
  if (fill) {
    fill.style.width = pct + '%';
    fill.className = 'msg-char-fill' + (len > 160 ? ' over' : len > 120 ? ' warn' : '');
  }
}

function loadSmsTemplate(t) {
  const orgName = currentOrg?.name || 'ADA';
  const templates = {
    meeting: `Dear Member, the next ${orgName} meeting is coming up. Please check your calendar and be available. Regards, ${orgName}.`,
    contribution: `Dear Member, kindly ensure your monthly contributions are up to date. Paybill: ${currentOrg?.paybill||'—'}. Regards, ${orgName}.`,
    welfare: `Dear Member, there is an active welfare event. Kindly contribute as per constitution. Send to Paybill ${currentOrg?.paybill||'—'}. Regards, ${orgName}.`,
    agm: `Dear Member, the ${orgName} Annual General Meeting has been scheduled. Details to follow. Please mark your diary. Regards.`
  };
  if (templates[t]) { document.getElementById('sms-body').value=templates[t]; updateSmsCount(templates[t]); }
}

async function sendSms() {
  if (!canDo('sendSms')) { toast('⚠ Only admins can send SMS messages.'); return; }
  const body = document.getElementById('sms-body').value.trim();
  if (!body) { toast('Please enter a message'); return; }
  const recipientType = document.getElementById('sms-recipients').value;

  // Get raw phone numbers based on recipient type (sendSMS() will format them)
  let rawPhones = [];
  if (recipientType === 'all') {
    rawPhones = allMembers.filter(m => m.phone).map(m => m.phone);
  } else if (recipientType === 'active') {
    rawPhones = allMembers.filter(m => m.phone && m.status === 'active').map(m => m.phone);
  } else if (recipientType === 'arrears') {
    rawPhones = allMembers.filter(m => m.phone && m.status === 'arrears').map(m => m.phone);
  } else if (recipientType === 'custom') {
    if (!_customSelectedMemberIds.size) { toast('Select at least one member first'); return; }
    rawPhones = allMembers.filter(m => m.phone && _customSelectedMemberIds.has(m.id)).map(m => m.phone);
  }

  if (!rawPhones.length) { toast('No phone numbers found for selected recipients'); return; }

  // ── Confirmation gate — prevents accidental double-send ──
  const recipientLabel = recipientType === 'all' ? 'all members'
    : recipientType === 'active' ? 'active members'
    : recipientType === 'arrears' ? 'members in arrears'
    : `${rawPhones.length} selected member${rawPhones.length!==1?'s':''}`;
  const preview = body.length > 60 ? body.slice(0, 60) + '…' : body;
  const confirmed = confirm(`Send SMS to ${rawPhones.length} ${recipientLabel}?\n\nMessage: "${preview}"\n\nThis will use ${rawPhones.length} SMS from your bundle.`);
  if (!confirmed) return;

  // ── Balance gate ──
  const bundle = currentOrg?.sms_bundle || 0;
  if (bundle <= 0) {
    toast('⚠ SMS bundle empty. Top up via Billing to send messages.');
    return;
  }
  if (bundle < rawPhones.length) {
    toast(`⚠ Only ${bundle} SMS remaining — not enough to send to ${rawPhones.length} recipients. Top up first.`);
    return;
  }

  toast('Sending SMS to ' + rawPhones.length + ' recipients…');
  try {
    const result = await sendSMS(rawPhones, body);
    const sent = result?.sent || 0;
    const failed = result?.failed || 0;

    await sb.from('messages_log').insert({
      org_id: currentOrg?.id,
      recipient_type: recipientType,
      body,
      recipient_count: sent,
      sent_by: currentUser.id
    });

    if (sent > 0) await trackSmsUsage(currentOrg.id, sent);

    if (failed > 0) {
      toast(`SMS sent to ${sent} recipients. ${failed} failed.`);
    } else {
      toast(`✓ SMS sent successfully to ${sent} recipients`);
    }
  } catch(e) {
    console.error('SMS error:', e);
    await sb.from('messages_log').insert({
      org_id: currentOrg?.id,
      recipient_type: recipientType,
      body,
      recipient_count: 0,
      sent_by: currentUser.id
    });
    toast('SMS failed: ' + e.message + '. Message logged.');
  }

  document.getElementById('sms-body').value='';
  updateSmsCount('');
  loadMessages();
}

async function testSms() {
  const bundle = currentOrg?.sms_bundle || 0;
  if (bundle <= 0) { toast('⚠ SMS bundle empty. Top up via Billing to send messages.'); return; }
  const body = document.getElementById('sms-body').value.trim() || `GroupYetu360 test SMS. Platform SMS is active and working.`;
  const myPhone = currentProfile?.phone;
  if (!myPhone) { toast('Add your phone number in My Account first'); return; }
  toast('Sending test SMS to ' + myPhone + '…');
  try {
    const result = await sendSMS([myPhone], body);
    console.log('Test SMS result:', result);
    if (result?.sent > 0) {
      await trackSmsUsage(currentOrg.id, result.sent);
      toast(`✓ Test SMS sent to ${myPhone}. Check your phone!`);
    } else {
      toast(`Test SMS failed. Check browser console for provider response. Raw: ${JSON.stringify(result)}`);
    }
  } catch(e) {
    toast('Test failed: ' + e.message);
  }
}

// formatPhone() is defined in utils.js — available globally


/* ── Payment methods renderer ── */
function renderPaymentMethods(org, containerId, compact) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const methods = org?.payment_methods || {};
  const items = [];
  if (methods.paybill && methods.paybill_number) {
    items.push({ icon: '📱', label: 'M-Pesa Paybill', value: methods.paybill_number, sub: 'Account: ' + (methods.paybill_account || methods.account_format || 'Your Full Name'), copy: methods.paybill_number });
  } else if (org?.paybill) {
    items.push({ icon: '📱', label: 'M-Pesa Paybill', value: org.paybill, sub: 'Account: ' + (org.account_format || 'Your Full Name'), copy: org.paybill });
  }
  if (methods.till && methods.till_number) {
    items.push({ icon: '🏪', label: 'Buy Goods (Till)', value: methods.till_number, sub: '', copy: methods.till_number });
  }
  if (methods.send && methods.send_phone) {
    items.push({ icon: '💸', label: 'M-Pesa Send Money', value: methods.send_phone, sub: '', copy: methods.send_phone });
  }
  if (methods.pochi && methods.pochi_phone) {
    items.push({ icon: '🏦', label: 'Pochi La Biashara', value: methods.pochi_phone, sub: '', copy: methods.pochi_phone });
  }
  if (methods.bank && methods.bank_name) {
    items.push({ icon: '🏛', label: methods.bank_name, value: methods.bank_account, sub: methods.bank_account_name, copy: methods.bank_account });
  }
  if (!items.length) { el.innerHTML = '<div style="font-size:.78rem;color:var(--ink-faint)">No payment methods configured. Ask your admin to set them in Settings.</div>'; return; }
  el.innerHTML = items.map(item => compact ? `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .65rem;border:1px solid var(--border);margin-bottom:.4rem;border-radius:4px;background:var(--surface-2)">
      <div>
        <div style="font-size:.78rem;font-weight:600;color:var(--ink)">${item.icon} ${item.label}: <span style="color:var(--maroon)">${item.value}</span></div>
        ${item.sub ? `<div style="font-size:.65rem;color:var(--ink-faint)">${item.sub}</div>` : ''}
      </div>
      <button onclick="navigator.clipboard.writeText('${item.copy}').then(()=>toast('Copied: ${item.copy}'))"
        style="font-size:.65rem;color:var(--maroon);border:1px solid var(--maroon);background:transparent;padding:.2rem .55rem;cursor:pointer;font-family:'Inter',sans-serif;border-radius:3px;flex-shrink:0">Copy</button>
    </div>` : `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.65rem .85rem;border:1px solid var(--border);margin-bottom:.5rem;background:var(--surface)">
      <div>
        <div style="font-size:.82rem;font-weight:600;color:var(--ink)">${item.icon} ${item.label}</div>
        <div style="font-size:.95rem;font-weight:700;color:var(--maroon);margin:.15rem 0">${item.value}</div>
        ${item.sub ? `<div style="font-size:.7rem;color:var(--ink-faint)">${item.sub}</div>` : ''}
      </div>
      <button onclick="navigator.clipboard.writeText('${item.copy}').then(()=>toast('✓ Copied: ${item.copy}'))"
        style="background:var(--maroon);color:#fff;border:none;padding:.35rem .8rem;font-size:.72rem;font-weight:600;cursor:pointer;font-family:'Inter',sans-serif;flex-shrink:0">Copy</button>
    </div>`).join('');
}

function copyPaybill() {
  navigator.clipboard.writeText(currentOrg?.paybill||'').then(()=>toast('Paybill copied: '+currentOrg?.paybill)).catch(()=>toast('Paybill: '+currentOrg?.paybill));
}


/* ════ ROTATING SAVINGS / MERRY-GO-ROUND FUNCTIONS
════════════════════════════════════════════════ */

let allRounds = [];
let currentRoundId = null;
let mgrMethod = 'treasurer';
let _dragSrcEl = null;

// ── Drag-and-drop for receiving order list ──
function dragStart(e) {
  _dragSrcEl = e.currentTarget;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', '');
  setTimeout(() => { if (_dragSrcEl) _dragSrcEl.style.opacity = '0.4'; }, 0);
}

function dragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function dropItem(e, containerId) {
  e.stopPropagation();
  const container = document.getElementById(containerId);
  if (!container || !_dragSrcEl || _dragSrcEl === e.currentTarget) return false;
  // Find drop target — walk up to drag-item
  let target = e.target;
  while (target && target !== container && !target.classList.contains('drag-item')) {
    target = target.parentElement;
  }
  if (target && target !== _dragSrcEl && target.classList?.contains('drag-item')) {
    const allItems = Array.from(container.querySelectorAll('.drag-item'));
    const srcIdx = allItems.indexOf(_dragSrcEl);
    const tgtIdx = allItems.indexOf(target);
    if (srcIdx < tgtIdx) {
      container.insertBefore(_dragSrcEl, target.nextSibling);
    } else {
      container.insertBefore(_dragSrcEl, target);
    }
  }
  if (_dragSrcEl) _dragSrcEl.style.opacity = '';
  _dragSrcEl = null;
  return false;
}

function switchMgrTab(btn, tabId) {
  document.querySelectorAll('.mgr-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.querySelectorAll('#page-mgr .tab-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
}

function mgrSelectAll(select) {
  document.querySelectorAll('.mgr-member-cb').forEach(cb => { cb.checked = select; });
  mgrUpdateSelection();
}

function mgrUpdateSelection() {
  const checked = Array.from(document.querySelectorAll('.mgr-member-cb:checked'));
  const countEl = document.getElementById('cr-selected-count');
  if (countEl) countEl.textContent = checked.length + ' selected';
  // Build order list from checked members
  const orderEl = document.getElementById('cr-member-order');
  const groupEl = document.getElementById('cr-order-group');
  if (!orderEl) return;
  if (checked.length === 0) { if (groupEl) groupEl.style.display='none'; orderEl.innerHTML=''; return; }
  if (groupEl) groupEl.style.display='block';
  // Only rebuild if a member was added/removed (preserve existing order)
  const existing = Array.from(orderEl.querySelectorAll('[data-member-id]')).map(el=>el.getAttribute('data-member-id'));
  const newIds = checked.map(cb=>cb.dataset.id);
  const added = newIds.filter(id=>!existing.includes(id));
  const removed = existing.filter(id=>!newIds.includes(id));
  removed.forEach(id => orderEl.querySelector('[data-member-id="'+id+'"]')?.remove());
  added.forEach(id => {
    const cb = document.querySelector('.mgr-member-cb[data-id="'+id+'"]');
    if (!cb) return;
    const div = document.createElement('div');
    div.className = 'drag-item';
    div.setAttribute('data-member-id', id);
    div.setAttribute('draggable', 'true');
    div.setAttribute('ondragstart', 'dragStart(event)');
    div.setAttribute('ondragover', 'dragOver(event)');
    div.setAttribute('ondrop', "dropItem(event,'cr-member-order')");
    div.innerHTML = '<span class="drag-handle">⠿</span><span style="font-size:.82rem">'+cb.dataset.name+'</span><span style="font-size:.72rem;color:var(--ink-faint);margin-left:auto">#'+cb.dataset.num+'</span>';
    orderEl.appendChild(div);
  });
}

function tbSelectAll(select) {
  document.querySelectorAll('.tb-member-cb').forEach(cb => { cb.checked = select; });
  tbUpdateSelection();
}

function tbUpdateSelection() {
  const checked = Array.from(document.querySelectorAll('.tb-member-cb:checked'));
  const countEl = document.getElementById('tb-selected-count');
  if (countEl) countEl.textContent = checked.length + ' selected';
}

function selectMgrMethod(method) {
  mgrMethod = method;
  document.getElementById('cr-method').value = method;
  document.getElementById('cr-method-treasurer').classList.toggle('selected', method === 'treasurer');
  document.getElementById('cr-method-direct').classList.toggle('selected', method === 'direct');
  document.getElementById('cr-method-group_account').classList.toggle('selected', method === 'group_account');
}

// Check for overdue MGR slots and issue auto-fines if cycle has default_fine_amount set
async function checkMGROverdueFines() {
  if (!currentOrg?.id) return;
  const today = new Date().toISOString().split('T')[0];
  try {
    // Get active cycles with a fine amount configured
    const { data: cycles } = await sb.from('savings_rounds')
      .select('id,name,default_fine_amount,pool_members')
      .eq('org_id', currentOrg.id)
      .eq('status', 'active')
      .not('default_fine_amount', 'is', null)
      .gt('default_fine_amount', 0);

    if (!cycles?.length) return;

    for (const cycle of cycles) {
      // Get overdue slots (scheduled date passed, not yet received/paid)
      const { data: overdueSlots } = await sb.from('round_slots')
        .select('id,member_id,slot_number,scheduled_date,members(full_name)')
        .eq('round_id', cycle.id)
        .eq('received', false)
        .lt('scheduled_date', today);

      for (const slot of (overdueSlots||[])) {
        // Check if a fine already exists for this slot
        const { data: existing } = await sb.from('fines')
          .select('id')
          .eq('org_id', currentOrg.id)
          .eq('member_id', slot.member_id)
          .eq('reason', 'Defaulted on MGR round — ' + cycle.name + ' Slot #' + slot.slot_number)
          .maybeSingle();

        if (!existing) {
          // Issue auto-fine
          await sb.from('fines').insert({
            org_id: currentOrg.id,
            member_id: slot.member_id,
            reason: 'Defaulted on MGR round — ' + cycle.name + ' Slot #' + slot.slot_number,
            amount: cycle.default_fine_amount,
            status: 'pending',
            issued_date: today,
            notes: 'Auto-issued: scheduled date ' + slot.scheduled_date + ' passed without contribution',
            issued_by: currentUser.id,
          });
          console.log('[GY360] Auto-fine issued:', slot.members?.full_name, cycle.name);
        }
      }
    }
  } catch(e) { console.log('[GY360] MGR fine check skipped:', e.message); }
}

// Similarly for Table Banking overdue loans
async function checkTBOverdueFines() {
  if (!currentOrg?.id) return;
  const today = new Date().toISOString().split('T')[0];
  try {
    const { data: pools } = await sb.from('table_banking_pools')
      .select('id,name,default_fine_amount')
      .eq('org_id', currentOrg.id)
      .eq('status', 'active')
      .not('default_fine_amount', 'is', null)
      .gt('default_fine_amount', 0);

    if (!pools?.length) return;

    for (const pool of pools) {
      const { data: overdueLoans } = await sb.from('table_banking_loans')
        .select('id,member_id,due_date,amount,members(full_name)')
        .eq('pool_id', pool.id)
        .eq('status', 'active')
        .lt('due_date', today);

      for (const loan of (overdueLoans||[])) {
        const { data: existing } = await sb.from('fines')
          .select('id')
          .eq('org_id', currentOrg.id)
          .eq('member_id', loan.member_id)
          .eq('reason', 'Table banking loan overdue — ' + pool.name)
          .maybeSingle();

        if (!existing) {
          await sb.from('fines').insert({
            org_id: currentOrg.id,
            member_id: loan.member_id,
            reason: 'Table banking loan overdue — ' + pool.name,
            amount: pool.default_fine_amount,
            status: 'pending',
            issued_date: today,
            notes: 'Auto-issued: loan due ' + loan.due_date + ', amount Ksh ' + Number(loan.amount).toLocaleString(),
            issued_by: currentUser.id,
          });
        }
      }
    }
  } catch(e) { console.log('[GY360] TB fine check skipped:', e.message); }
}

async function loadMGR() {
  checkMGROverdueFines(); // non-blocking background check

  if (!currentOrg?.id) return;

  // Load cycles from DB
  const { data: rounds } = await sb.from('savings_rounds')
    .select('*')
    .eq('org_id', currentOrg.id)
    .order('created_at', {ascending: false});
  allRounds = rounds || [];

  // Stats
  const active = allRounds.filter(r => r.status === 'active');
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('mgr-stat-active', active.length);

  // Count total slots (rounds completed)
  let totalSlots = 0, totalDisbursed = 0, nextReceiver = '—';
  if (allRounds.length) {
    const { data: slots } = await sb.from('round_slots')
      .select('*,members(full_name)')
      .in('round_id', allRounds.map(r => r.id))
      .order('slot_number');
    totalSlots = (slots || []).filter(s => s.received).length;

    // Next unreceived slot across active rounds
    const nextSlot = (slots || []).find(s => !s.received && active.find(r => r.id === s.round_id));
    if (nextSlot) nextReceiver = nextSlot.members?.full_name?.split(' ')[0] || '—';

    // Total disbursed
    const { data: disb } = await sb.from('round_disbursements')
      .select('amount')
      .in('round_id', allRounds.map(r => r.id));
    totalDisbursed = (disb || []).reduce((s, d) => s + Number(d.amount || 0), 0);
  }

  setEl('mgr-stat-rounds', totalSlots);
  setEl('mgr-stat-disbursed', totalDisbursed > 0 ? 'Ksh ' + totalDisbursed.toLocaleString() : '—');
  setEl('mgr-stat-next', nextReceiver);

  // Hero sub
  const heroSub = document.getElementById('mgr-hero-sub');
  if (heroSub) heroSub.textContent = active.length
    ? `${active.length} active cycle${active.length !== 1 ? 's' : ''} · ${allRounds.length} total`
    : 'No active cycles — create your first merry-go-round';

  // Populate cycle dropdowns
  const cycleOpts = '<option value="">Select cycle…</option>' +
    allRounds.map(r => `<option value="${r.id}">${r.name} (${r.status})</option>`).join('');
  ['mgr-rec-cycle', 'mgr-dis-cycle'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = cycleOpts;
  });

  // Render overview
  renderMGROverview(allRounds);
  await loadMGRHistory();
}

async function renderMGROverview(rounds) {
  const listEl = document.getElementById('mgr-rounds-list');
  if (!listEl) return;

  if (!rounds.length) {
    listEl.innerHTML = `<div class="mgr-empty">
      <div class="mgr-empty-icon">🔄</div>
      <div style="font-size:.95rem;font-weight:700;color:var(--ink);margin-bottom:.4rem">No cycles yet</div>
      <div style="font-size:.8rem;color:var(--ink-faint);margin-bottom:1.25rem">Create your first rotating savings cycle to get started</div>
      <button class="btn btn-primary" onclick="showModal('createRound')" style="width:auto;background:var(--teal)">+ Create First Cycle</button>
    </div>`;
    return;
  }

  // Load all slots for these rounds
  const { data: allSlots } = await sb.from('round_slots')
    .select('*,members(full_name,phone)')
    .in('round_id', rounds.map(r => r.id))
    .order('slot_number');

  const { data: allContribs } = await sb.from('round_contributions')
    .select('slot_id,contributor_member_id,amount,status')
    .in('round_id', rounds.map(r => r.id));

  listEl.innerHTML = rounds.map((r, ri) => {
    const slots = (allSlots || []).filter(s => s.round_id === r.id);
    const totalMembers = slots.length;
    const received = slots.filter(s => s.received).length;
    const currentSlot = slots.find(s => !s.received);
    const methodLabel = r.collection_method === 'treasurer' ? '🏛 Treasurer Collects'
      : r.collection_method === 'group_account' ? '🏦 Group Account'
      : '📲 Members Pay Directly';
    const methodClass = r.collection_method === 'treasurer' ? 'mgr-method-treasurer'
      : r.collection_method === 'group_account' ? 'mgr-method-group'
      : 'mgr-method-direct';

    const slotCards = slots.map((s, si) => {
      const contribs = (allContribs || []).filter(c => c.slot_id === s.id);
      const paidCount = contribs.filter(c => c.status === 'paid').length;
      const pct = totalMembers > 0 ? Math.round((paidCount / (totalMembers - 1)) * 100) : 0;
      const isActive = !s.received && s.id === currentSlot?.id;
      const numClass = s.received ? 'done' : isActive ? 'active-num' : 'pending';
      const cardClass = s.received ? 'received' : isActive ? 'active-slot' : '';
      const scheduledDate = s.scheduled_date
        ? new Date(s.scheduled_date).toLocaleDateString('en-GB', {day:'numeric', month:'short', year:'numeric'})
        : '—';

      return `<div class="slot-card ${cardClass}">
        <div class="slot-header">
          <div class="slot-num ${numClass}">${s.slot_number}</div>
          <div class="slot-name">${s.members?.full_name || '—'}</div>
          ${isActive ? '<span class="badge badge-green" style="font-size:.58rem">Current</span>' : ''}
          ${s.received ? '<span class="badge badge-grey" style="font-size:.58rem">✓ Received</span>' : ''}
        </div>
        <div class="slot-body">
          ${!s.received ? `
          <div class="slot-contrib-bar">
            <div class="slot-contrib-fill" style="width:${pct}%"></div>
          </div>
          <div class="slot-contrib-text">
            <span>${paidCount} of ${totalMembers > 0 ? totalMembers - 1 : 0} paid</span>
            <span>${pct}%</span>
          </div>` : `<div class="slot-received-badge">✓ Received ${s.received_date ? new Date(s.received_date).toLocaleDateString('en-GB',{day:'numeric',month:'short'}) : ''}</div>`}
          <div class="slot-date">📅 ${scheduledDate}</div>
        </div>
      </div>`;
    }).join('');

    return `<div class="round-card" style="animation-delay:${ri*0.05}s">
      <div class="round-card-header">
        <div>
          <div class="round-card-title">${r.name}</div>
          <div class="round-card-meta">
            Ksh ${Number(r.amount_per_member).toLocaleString()} per member · ${r.frequency}
            · ${received}/${totalMembers} rounds complete
            ${r.start_date ? '· Started ' + new Date(r.start_date).toLocaleDateString('en-GB',{month:'short',year:'numeric'}) : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="mgr-method-pill ${methodClass}">${methodLabel}</span>
          <span class="badge ${r.status === 'active' ? 'badge-green' : 'badge-grey'}">${r.status}</span>
          <button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="deleteRound('${r.id}','${r.name.replace(/'/g,"&apos;")}')">✕</button>
        </div>
      </div>
      <div class="slot-grid">${slotCards || '<div style="padding:1rem;color:var(--ink-faint);font-size:.8rem">No members in this cycle yet</div>'}</div>
    </div>`;
  }).join('');
}

async function showModal_createRound_prep() {
  // Set today as default start date
  const dateEl = document.getElementById('cr-start-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  // Populate member PICKER (checkboxes) from allMembers
  const pickerEl = document.getElementById('cr-member-picker');
  if (!pickerEl) return;
  const members = (allMembers||[]).filter(m => m.status==='active'||m.status==='arrears');
  if (!members.length) { pickerEl.innerHTML='<div style="color:var(--ink-faint);font-size:.8rem;padding:.5rem">No active members found</div>'; return; }
  pickerEl.innerHTML = members.map(m => `
    <label class="member-picker-row" style="display:flex;align-items:center;gap:.6rem;padding:.3rem .4rem;border-radius:4px;cursor:pointer;transition:background .1s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="mgr-member-cb" data-id="${m.id}" data-name="${m.full_name}" data-num="${m.member_number||''}" checked
        onchange="mgrUpdateSelection()" style="accent-color:var(--teal);width:15px;height:15px;flex-shrink:0"/>
      <span style="font-size:.82rem;flex:1">${m.full_name}</span>
      <span style="font-size:.7rem;color:var(--ink-faint)">#${m.member_number||'—'}</span>
      ${m.status==='arrears'?'<span class="badge badge-warn" style="font-size:.6rem">arrears</span>':''}
    </label>`).join('');
  mgrUpdateSelection();
  // Also prep TB picker when that modal opens
  const tbPicker = document.getElementById('tb-member-picker');
  if (tbPicker && tbPicker.innerHTML.includes('Loading')) {
    tbPicker.innerHTML = members.map(m => `
      <label class="member-picker-row" style="display:flex;align-items:center;gap:.6rem;padding:.3rem .4rem;border-radius:4px;cursor:pointer;transition:background .1s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
        <input type="checkbox" class="tb-member-cb" data-id="${m.id}" checked
          onchange="tbUpdateSelection()" style="accent-color:var(--teal);width:15px;height:15px;flex-shrink:0"/>
        <span style="font-size:.82rem;flex:1">${m.full_name}</span>
        <span style="font-size:.7rem;color:var(--ink-faint)">#${m.member_number||'—'}</span>
        ${m.status==='arrears'?'<span class="badge badge-warn" style="font-size:.6rem">arrears</span>':''}
      </label>`).join('');
    tbUpdateSelection();
  }
}

// Override showModal to prep MGR + TB + Welfare forms
const _origShowModal = window.showModal;
window.showModal = function(name) {
  if (name === 'createRound') showModal_createRound_prep();
  if (name === 'tbNewPool') {
    if (typeof _origShowModal === 'function') _origShowModal(name);
    openTBNewPool();
    return;
  }
  if (name === 'welfareEvent') {
    if (typeof _origShowModal === 'function') _origShowModal(name);
    populateWelfareTypeSelect();
    // Set today as default date
    const dateEl = document.getElementById('wel-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split('T')[0];
    return;
  }
  if (typeof _origShowModal === 'function') _origShowModal(name);
};

async function saveRound() {
  const name = document.getElementById('cr-name').value.trim();
  const amount = Number(document.getElementById('cr-amount').value);
  const frequency = document.getElementById('cr-frequency').value;
  const method = document.getElementById('cr-method').value;
  const startDate = document.getElementById('cr-start-date').value;
  const notes = document.getElementById('cr-notes').value.trim();
  const fineAmount = Number(document.getElementById('cr-fine-amount')?.value||0);

  if (!name) { toast('Please enter a cycle name'); return; }
  if (!amount || amount <= 0) { toast('Please enter an amount per member'); return; }

  // Get member order from the ordered list (only selected members)
  const memberItems = document.querySelectorAll('#cr-member-order [data-member-id]');
  if (!memberItems.length) { toast('Please select at least one member'); return; }

  // Get selected member IDs for pool_members storage
  const selectedIds = Array.from(memberItems).map(el => el.getAttribute('data-member-id'));

  // Create the round
  const { data: round, error } = await sb.from('savings_rounds').insert({
    org_id: currentOrg.id,
    name, amount_per_member: amount, frequency,
    collection_method: method, start_date: startDate, notes,
    status: 'active', created_by: currentUser.id,
    default_fine_amount: fineAmount || null,
    pool_members: selectedIds,
  }).select().single();

  if (error) { toast('Error creating cycle: ' + error.message); return; }

  // Create slots for each member in order
  const slots = Array.from(memberItems).map((item, idx) => {
    const memberId = item.getAttribute('data-member-id');
    // Calculate scheduled date based on frequency
    const slotDate = new Date(startDate || Date.now());
    if (frequency === 'monthly') slotDate.setMonth(slotDate.getMonth() + idx);
    else if (frequency === 'weekly') slotDate.setDate(slotDate.getDate() + (idx * 7));
    else if (frequency === 'fortnightly') slotDate.setDate(slotDate.getDate() + (idx * 14));
    return {
      round_id: round.id,
      org_id: currentOrg.id,
      member_id: memberId,
      slot_number: idx + 1,
      scheduled_date: slotDate.toISOString().split('T')[0],
      received: false
    };
  });

  const { error: slotErr } = await sb.from('round_slots').insert(slots);
  if (slotErr) { toast('Cycle created but slots failed: ' + slotErr.message); }
  else { toast(`✓ Cycle "${name}" created with ${slots.length} members`); }

  closeModal('createRound');
  document.getElementById('cr-name').value = '';
  document.getElementById('cr-amount').value = '';
  document.getElementById('cr-notes').value = '';
  await loadMGR();
}

async function loadRoundSlotsForRecord(roundId) {
  const slotSel = document.getElementById('mgr-rec-slot');
  if (!slotSel) return;
  if (!roundId) { slotSel.innerHTML = '<option value="">Select cycle first…</option>'; return; }

  const { data: slots } = await sb.from('round_slots')
    .select('*,members(full_name)')
    .eq('round_id', roundId)
    .eq('received', false)
    .order('slot_number');

  slotSel.innerHTML = '<option value="">Select receiving member…</option>' +
    (slots || []).map(s => `<option value="${s.id}">Round ${s.slot_number} — ${s.members?.full_name || '—'}</option>`).join('');

  // Set default amount from round
  const round = allRounds.find(r => r.id === roundId);
  const amtEl = document.getElementById('mgr-rec-amount');
  if (amtEl && round) amtEl.value = round.amount_per_member;

  // Populate member dropdown (exclude receiver)
  const memberSel = document.getElementById('mgr-rec-member');
  if (memberSel) {
    memberSel.innerHTML = '<option value="">Select contributing member…</option>' +
      allMembers.map(m => `<option value="${m.id}">${m.full_name}</option>`).join('');
  }

  // Set today
  const dateEl = document.getElementById('mgr-rec-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
}

async function loadContribStatusForSlot(slotId) {
  if (!slotId) { document.getElementById('mgr-contrib-status').style.display = 'none'; return; }

  const statusCard = document.getElementById('mgr-contrib-status');
  statusCard.style.display = 'block';

  // Get slot info
  const { data: slot } = await sb.from('round_slots')
    .select('*,members(full_name)')
    .eq('id', slotId).maybeSingle();

  const title = document.getElementById('mgr-contrib-status-title');
  if (title && slot) title.textContent = `Round ${slot.slot_number} — ${slot.members?.full_name} receiving`;

  // Get contributions for this slot
  const { data: contribs } = await sb.from('round_contributions')
    .select('*,members!contributor_member_id(full_name)')
    .eq('slot_id', slotId);
  const paidIds = new Set((contribs || []).filter(c => c.status === 'paid').map(c => c.contributor_member_id));

  const meta = document.getElementById('mgr-contrib-status-meta');
  if (meta) meta.textContent = `${paidIds.size} of ${allMembers.length - 1} members paid`;

  const chips = document.getElementById('mgr-contrib-summary-chips');
  if (chips) chips.innerHTML = `
    <span class="badge badge-green">${paidIds.size} Paid</span>
    <span class="badge badge-grey">${(allMembers.length - 1) - paidIds.size} Pending</span>`;

  // Render per-member status (exclude receiver)
  const receiverMemberId = slot?.member_id;
  const grid = document.getElementById('mgr-contrib-grid');
  if (grid) {
    grid.innerHTML = allMembers
      .filter(m => m.id !== receiverMemberId)
      .map(m => {
        const paid = paidIds.has(m.id);
        const contrib = (contribs || []).find(c => c.contributor_member_id === m.id);
        return `<div class="mgr-contrib-item ${paid ? 'paid' : 'pending'}">
          <div>
            <div class="mgr-contrib-name">${m.full_name?.split(' ')[0] || '—'}</div>
            ${paid ? `<div style="font-size:.62rem;color:var(--teal-dk)">Ksh ${Number(contrib?.amount||0).toLocaleString()}</div>` : ''}
          </div>
          <div class="mgr-contrib-status ${paid ? 'paid' : 'pending'}">${paid ? '✓ Paid' : '⏳ Pending'}</div>
        </div>`;
      }).join('');
  }
}

async function saveRoundContribution() {
  const slotId = document.getElementById('mgr-rec-slot').value;
  const memberId = document.getElementById('mgr-rec-member').value;
  const amount = Number(document.getElementById('mgr-rec-amount').value);
  const method = document.getElementById('mgr-rec-method').value;
  const ref = document.getElementById('mgr-rec-ref').value.trim();
  const date = document.getElementById('mgr-rec-date').value;
  const roundId = document.getElementById('mgr-rec-cycle').value;

  if (!slotId) { toast('Please select a round'); return; }
  if (!memberId) { toast('Please select a member'); return; }
  if (!amount || amount <= 0) { toast('Please enter an amount'); return; }

  // Check if already paid
  const { data: existing } = await sb.from('round_contributions')
    .select('id').eq('slot_id', slotId).eq('contributor_member_id', memberId).eq('status','paid').maybeSingle();
  if (existing) { toast('This member has already paid for this round'); return; }

  // Get round details for collection method
  const round = allRounds.find(r => r.id === roundId);
  const collectionMethod = round?.collection_method || 'treasurer';

  const { error } = await sb.from('round_contributions').insert({
    round_id: roundId,
    slot_id: slotId,
    org_id: currentOrg.id,
    contributor_member_id: memberId,
    amount, method,
    mpesa_ref: ref || null,
    payment_date: date || new Date().toISOString().split('T')[0],
    status: 'paid',
    recorded_by: currentUser.id
  });

  if (error) { toast('Error: ' + error.message); return; }

  // ── group_account: credit bank balance per contribution ──
  if (collectionMethod === 'group_account') {
    await updateBankBalance(currentOrg.id, amount, 'credit');
    await logActivity('MGR CONTRIBUTION', `MGR contribution: Ksh ${amount.toLocaleString()} from member for round (group account)`, 'mgr', slotId);
  }

  toast('✓ Contribution recorded');

  // ── Auto-completion check ──
  // After recording, check if ALL members in this cycle have now paid for this slot
  await checkAndAutoCompleteSlot(slotId, roundId, round, date);

  await loadContribStatusForSlot(slotId);
  await loadMGR();
}

// Check if all members in a cycle have paid for a slot — if so, auto-mark as received
async function checkAndAutoCompleteSlot(slotId, roundId, round, date) {
  try {
    const collectionMethod = round?.collection_method || 'treasurer';
    // Only auto-complete for 'direct' and 'group_account' — treasurer method requires manual disbursement
    if (collectionMethod === 'treasurer') return;

    // Get the slot to find the receiver member_id
    const { data: slot } = await sb.from('round_slots')
      .select('member_id, received').eq('id', slotId).maybeSingle();
    if (!slot || slot.received) return;

    // Get all members in this cycle (from pool_members on the round)
    const cycleMembers = round?.pool_members || [];
    if (!cycleMembers.length) return;

    // Expected contributors = all cycle members MINUS the receiver
    const expectedContributors = cycleMembers.filter(id => id !== slot.member_id);
    if (!expectedContributors.length) return;

    // Get all paid contributions for this slot
    const { data: paid } = await sb.from('round_contributions')
      .select('contributor_member_id')
      .eq('slot_id', slotId)
      .eq('status', 'paid');

    const paidIds = new Set((paid || []).map(c => c.contributor_member_id));
    const allPaid = expectedContributors.every(id => paidIds.has(id));

    if (!allPaid) return;

    // All members have paid — auto-mark slot as received
    const today = date || new Date().toISOString().split('T')[0];
    const potAmount = expectedContributors.length * Number(round?.amount_per_member || 0);

    await sb.from('round_slots').update({
      received: true,
      received_date: today,
      amount_received: potAmount
    }).eq('id', slotId);

    // For group_account: debit bank balance when pot is disbursed to receiver
    if (collectionMethod === 'group_account') {
      await updateBankBalance(currentOrg.id, potAmount, 'debit');
      // Record disbursement automatically
      await sb.from('round_disbursements').insert({
        round_id: roundId,
        slot_id: slotId,
        org_id: currentOrg.id,
        receiving_member_id: slot.member_id,
        amount: potAmount,
        method: 'auto',
        disbursement_date: today,
        disbursed_by: currentUser.id,
        notes: 'Auto-recorded: all members paid via group account'
      });
      await logActivity('MGR DISBURSEMENT', `MGR auto-disbursed Ksh ${potAmount.toLocaleString()} to receiver (group account)`, 'mgr', slotId);
    }

    // For direct: just record confirmation — receiver got it from members directly
    if (collectionMethod === 'direct') {
      await sb.from('round_disbursements').insert({
        round_id: roundId,
        slot_id: slotId,
        org_id: currentOrg.id,
        receiving_member_id: slot.member_id,
        amount: potAmount,
        method: 'direct',
        disbursement_date: today,
        disbursed_by: currentUser.id,
        notes: 'Auto-confirmed: all members paid directly to receiver'
      });
    }

    const receiverName = allMembers.find(m => m.id === slot.member_id)?.full_name || 'receiver';
    toast(`✓ All members paid — round auto-completed. ${receiverName} has received the pot.`);
  } catch(e) {
    console.log('[GY360] Auto-complete check error:', e.message);
  }
}

async function loadDisbursementSlots(roundId) {
  const slotSel = document.getElementById('mgr-dis-slot');
  if (!slotSel) return;
  if (!roundId) { slotSel.innerHTML = '<option value="">Select cycle first…</option>'; return; }

  const { data: slots } = await sb.from('round_slots')
    .select('*,members(full_name)')
    .eq('round_id', roundId)
    .order('slot_number');

  slotSel.innerHTML = '<option value="">Select receiver…</option>' +
    (slots || []).map(s => `<option value="${s.id}" ${s.received?'disabled':''}>
      Round ${s.slot_number} — ${s.members?.full_name || '—'} ${s.received?'(Received)':''}
    </option>`).join('');

  // Auto-fill amount
  const round = allRounds.find(r => r.id === roundId);
  const amtEl = document.getElementById('mgr-dis-amount');
  if (amtEl && round) {
    const memberCount = allMembers.length;
    amtEl.value = (memberCount - 1) * Number(round.amount_per_member);
  }

  const dateEl = document.getElementById('mgr-dis-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
}

async function saveDisbursement() {
  const slotId = document.getElementById('mgr-dis-slot').value;
  const amount = Number(document.getElementById('mgr-dis-amount').value);
  const date = document.getElementById('mgr-dis-date').value;
  const method = document.getElementById('mgr-dis-method').value;
  const ref = document.getElementById('mgr-dis-ref').value.trim();
  const notes = document.getElementById('mgr-dis-notes').value.trim();
  const roundId = document.getElementById('mgr-dis-cycle').value;

  if (!slotId) { toast('Please select a round/receiver'); return; }
  if (!amount || amount <= 0) { toast('Please enter the disbursement amount'); return; }

  // Get slot to find receiving member
  const { data: slot } = await sb.from('round_slots')
    .select('member_id').eq('id', slotId).maybeSingle();
  if (!slot) { toast('Slot not found'); return; }

  const { error } = await sb.from('round_disbursements').insert({
    round_id: roundId,
    slot_id: slotId,
    org_id: currentOrg.id,
    receiving_member_id: slot.member_id,
    amount, method,
    mpesa_ref: ref || null,
    disbursement_date: date || new Date().toISOString().split('T')[0],
    disbursed_by: currentUser.id,
    notes: notes || null
  });
  if (error) { toast('Error: ' + error.message); return; }

  // Mark slot as received
  await sb.from('round_slots').update({
    received: true,
    received_date: date || new Date().toISOString().split('T')[0],
    amount_received: amount
  }).eq('id', slotId);

  // Debit bank balance for group_account cycles on manual disbursement
  const round = allRounds.find(r => r.id === roundId);
  if (round?.collection_method === 'group_account') {
    await updateBankBalance(currentOrg.id, amount, 'debit');
    await logActivity('MGR DISBURSEMENT', `MGR manual disbursement: Ksh ${amount.toLocaleString()} from group account to receiver`, 'mgr', slotId);
  }

  toast('✓ Disbursement recorded — slot marked as received');
  clearMgrDisForm();
  await loadMGR();
}

async function loadMGRHistory() {
  if (!allRounds.length) return;
  const tbody = document.getElementById('mgr-history-table');
  if (!tbody) return;

  const { data: slots } = await sb.from('round_slots')
    .select('*,members(full_name),savings_rounds(name,amount_per_member,collection_method)')
    .in('round_id', allRounds.map(r => r.id))
    .eq('received', true)
    .order('received_date', {ascending: false});

  const { data: disbs } = await sb.from('round_disbursements')
    .select('*')
    .in('round_id', allRounds.map(r => r.id));

  if (!slots?.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--ink-faint)">No completed rounds yet</td></tr>';
    return;
  }

  tbody.innerHTML = slots.map(s => {
    const disb = (disbs || []).find(d => d.slot_id === s.id);
    const round = allRounds.find(r => r.id === s.round_id);
    const method = round?.collection_method || 'treasurer';
    const methodLabel = method === 'group_account' ? 'Group Account'
      : method === 'direct' ? 'Members directly'
      : 'Treasurer';
    const dateStr = s.received_date
      ? new Date(s.received_date).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})
      : '—';
    const pot = disb ? Number(disb.amount).toLocaleString()
      : method === 'direct' ? `~${((allMembers.length-1)*Number(round?.amount_per_member||0)).toLocaleString()}`
      : '—';
    return `<tr>
      <td>${s.savings_rounds?.name || '—'}</td>
      <td style="text-align:center">#${s.slot_number}</td>
      <td><strong>${s.members?.full_name || '—'}</strong></td>
      <td>${dateStr}</td>
      <td>Ksh ${pot}</td>
      <td>${methodLabel}</td>
      <td>${disb?.method || (method === 'direct' ? 'Direct' : '—')}</td>
      <td><span class="badge badge-green">✓ Received</span></td>
    </tr>`;
  }).join('');
}

async function deleteRound(id, name) {
  if (!confirm(`Delete cycle "${name}"? This will remove all slots, contributions and disbursement records. This cannot be undone.`)) return;
  await sb.from('round_disbursements').delete().eq('round_id', id);
  await sb.from('round_contributions').delete().eq('round_id', id);
  await sb.from('round_slots').delete().eq('round_id', id);
  await sb.from('savings_rounds').delete().eq('id', id);
  toast('Cycle deleted');
  await loadMGR();
}

function clearMgrRecForm() {
  ['mgr-rec-slot','mgr-rec-member'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  ['mgr-rec-amount','mgr-rec-ref'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('mgr-contrib-status').style.display = 'none';
}

function clearMgrDisForm() {
  ['mgr-dis-slot','mgr-dis-method'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  ['mgr-dis-amount','mgr-dis-ref','mgr-dis-notes'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
}




// (toggleSupportFab removed — was for a multi-option sub-menu that no longer
// exists in the current single-button FAB markup; nothing referenced it.)
// Update the FAB WhatsApp link from platform settings, so it stays correct if the
// support number ever changes in SA settings instead of being hardcoded in index.html.
// (Earlier version of this targeted a multi-option sub-menu — fab-whatsapp/fab-call/
// fab-email — that no longer exists in the current single-button FAB markup.)
(async () => {
  try {
    if (typeof sb !== 'undefined') {
      const { data: ps } = await sb.from('platform_settings_public').select('support_phone').maybeSingle();
      if (ps?.support_phone) {
        const phone = ps.support_phone.replace(/\D/g,'').replace(/^0/,'');
        const btn = document.getElementById('support-fab-btn');
        if (btn) btn.href = `https://wa.me/254${phone}?text=Hi%2C%20I%20need%20help%20with%20GroupYetu360`;
      }
    }
  } catch(e) {}
})();



/* ═══════════════════════════════════════
   
TABLE BANKING FUNCTIONS
════════════════════════════════════════════════════ */

let allTBPools = [];

async function openTBNewPool() {
  showModal('tbNewPool');
  // Populate member picker
  const pickerEl = document.getElementById('tb-member-picker');
  if (!pickerEl) return;
  const { data: members } = await sb.from('members')
    .select('id,full_name,member_number,status')
    .eq('org_id', currentOrg.id)
    .in('status', ['active','arrears'])
    .order('member_number');
  if (!members) return;
  pickerEl.innerHTML = members.map(m => `
    <label class="member-picker-row" style="display:flex;align-items:center;gap:.6rem;padding:.3rem .4rem;border-radius:4px;cursor:pointer;transition:background .1s" onmouseover="this.style.background='var(--surface)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="tb-member-cb" data-id="${m.id}" checked
        onchange="tbUpdateSelection()" style="accent-color:var(--teal);width:15px;height:15px;flex-shrink:0"/>
      <span style="font-size:.82rem;flex:1">${m.full_name}</span>
      <span style="font-size:.7rem;color:var(--ink-faint)">#${m.member_number||'—'}</span>
      ${m.status==='arrears'?'<span class="badge badge-warn" style="font-size:.6rem">arrears</span>':''}
    </label>`).join('');
  tbUpdateSelection();
}

async function loadTableBanking() {
  checkTBOverdueFines(); // non-blocking background check

  if (!currentOrg?.id) return;

  // Load pools
  try {
    const { data } = await sb.from('table_banking_pools')
      .select('*').eq('org_id', currentOrg.id).order('created_at', {ascending: false});
    allTBPools = data || [];
  } catch(e) {
    allTBPools = [];
  }

  // Populate pool selects
  const poolOpts = '<option value="">Select pool…</option>' +
    allTBPools.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  ['tb-pool-select','tb-rec-pool','tb-loan-pool'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = poolOpts;
  });

  // Member selects
  const memberOpts = '<option value="">Select member…</option>' +
    allMembers.map(m => `<option value="${m.id}">${m.full_name}</option>`).join('');
  ['tb-rec-member','tb-loan-member'].forEach(id => {
    const el = document.getElementById(id); if (el) el.innerHTML = memberOpts;
  });

  // Set dates
  const today = new Date().toISOString().split('T')[0];
  ['tb-rec-date','tb-loan-date','tb-pool-date','tb-repay-date'].forEach(id => {
    const el = document.getElementById(id); if (el && !el.value) el.value = today;
  });

  if (!allTBPools.length) {
    document.getElementById('tb-overview-content').innerHTML = `
      <div style="text-align:center;padding:3rem">
        <div style="font-size:2rem;margin-bottom:.75rem">🏦</div>
        <div style="font-size:.9rem;font-weight:700;color:var(--ink);margin-bottom:.4rem">No table banking pools yet</div>
        <div style="font-size:.8rem;color:var(--ink-faint);margin-bottom:1.25rem">Create your first pool to start tracking contributions and loans</div>
        <button class="btn btn-primary" onclick="showModal('tbNewPool')" style="background:var(--teal);width:auto">+ Create First Pool</button>
      </div>`;
    ['tb-stat-pool','tb-stat-loans','tb-stat-outstanding','tb-stat-interest'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '—';
    });
    document.getElementById('tb-hero-sub').textContent = 'No pools yet — create one to get started';
    return;
  }

  // Load stats across all pools
  const poolIds = allTBPools.map(p => p.id);

  const [contribRes, loanRes] = await Promise.all([
    sb.from('table_banking_contributions').select('amount').in('pool_id', poolIds),
    sb.from('table_banking_loans').select('*,members(full_name)').in('pool_id', poolIds).eq('status','active')
  ]);

  const totalContrib = (contribRes.data||[]).reduce((s,c)=>s+Number(c.amount||0),0);
  const activeLoans = loanRes.data || [];
  const totalLoaned = activeLoans.reduce((s,l)=>s+Number(l.principal||0),0);
  const totalRepaid = activeLoans.reduce((s,l)=>s+Number(l.total_repaid||0),0);
  const outstanding = totalLoaned - totalRepaid;

  // Interest earned (simplified: repaid - principal portions)
  let interestEarned = 0;
  try {
    const { data: repayments } = await sb.from('table_banking_repayments').select('interest_paid').in('loan_id', activeLoans.map(l=>l.id));
    interestEarned = (repayments||[]).reduce((s,r)=>s+Number(r.interest_paid||0),0);
  } catch(e) {}

  const poolBalance = totalContrib - totalLoaned + totalRepaid;

  const setEl = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  setEl('tb-stat-pool', 'Ksh ' + poolBalance.toLocaleString());
  setEl('tb-stat-loans', activeLoans.length);
  setEl('tb-stat-outstanding', 'Ksh ' + outstanding.toLocaleString());
  setEl('tb-stat-interest', 'Ksh ' + interestEarned.toLocaleString());
  setEl('tb-hero-sub', `${allTBPools.length} pool${allTBPools.length!==1?'s':''} · ${activeLoans.length} active loan${activeLoans.length!==1?'s':''}`);

  // Load repay loan select
  const loanOpts = '<option value="">Select loan…</option>' +
    activeLoans.map(l => {
      const bal = Number(l.principal||0) - Number(l.total_repaid||0);
      return `<option value="${l.id}">${l.members?.full_name||'—'} — Ksh ${bal.toLocaleString()} outstanding</option>`;
    }).join('');
  const repayLoanEl = document.getElementById('tb-repay-loan');
  if (repayLoanEl) repayLoanEl.innerHTML = loanOpts;

  // Show first pool overview
  if (allTBPools.length) {
    const poolSel = document.getElementById('tb-pool-select');
    if (poolSel && !poolSel.value) {
      poolSel.value = allTBPools[0].id;
      await loadTBOverview(allTBPools[0].id);
    }
  }
}

async function loadTBOverview(poolId) {
  const contentEl = document.getElementById('tb-overview-content');
  if (!contentEl || !poolId) return;
  contentEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  const pool = allTBPools.find(p => p.id === poolId);
  if (!pool) return;

  const [contribRes, loanRes] = await Promise.all([
    sb.from('table_banking_contributions').select('*,members(full_name,member_number)').eq('pool_id', poolId).order('payment_date',{ascending:false}),
    sb.from('table_banking_loans').select('*,members(full_name,member_number)').eq('pool_id', poolId).order('created_at',{ascending:false})
  ]);

  const contribs = contribRes.data || [];
  const loans = loanRes.data || [];
  const activeLoans = loans.filter(l => l.status === 'active');
  const totalIn = contribs.reduce((s,c) => s + Number(c.amount||0), 0);
  const totalLoaned = loans.reduce((s,l) => s + Number(l.principal||0), 0);
  const totalRepaid = loans.reduce((s,l) => s + Number(l.total_repaid||0), 0);
  const poolBal = totalIn - totalLoaned + totalRepaid;

  // Get pool members with their contribution totals
  const poolMemberIds = pool.pool_members || [];
  const poolMemberDetails = allMembers.filter(m => poolMemberIds.includes(m.id));
  const contribByMember = {};
  contribs.forEach(c => {
    if (!contribByMember[c.member_id]) contribByMember[c.member_id] = 0;
    contribByMember[c.member_id] += Number(c.amount||0);
  });
  const loansByMember = {};
  activeLoans.forEach(l => {
    if (!loansByMember[l.member_id]) loansByMember[l.member_id] = [];
    loansByMember[l.member_id].push(l);
  });

  // Interest earned from repayments
  let interestEarned = 0;
  if (loans.length) {
    try {
      const { data: reps } = await sb.from('table_banking_repayments')
        .select('interest_paid').in('loan_id', loans.map(l => l.id));
      interestEarned = (reps||[]).reduce((s,r) => s + Number(r.interest_paid||0), 0);
    } catch(e) {}
  }

  contentEl.innerHTML = `
    <!-- Pool header -->
    <div class="card" style="margin-bottom:1rem;border-left:3px solid var(--teal)">
      <div class="card-header" style="padding:.85rem 1.25rem">
        <div>
          <div class="card-title">${h(pool.name)}</div>
          <div class="card-sub">${pool.interest_rate||10}% interest/month · Started ${pool.start_date||'—'} · ${poolMemberIds.length} members${pool.max_loan_per_member ? ' · Max loan: Ksh '+Number(pool.max_loan_per_member).toLocaleString() : ''}</div>
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <span class="badge ${pool.status==='active'?'badge-green':'badge-grey'}" style="font-size:.62rem">${(pool.status||'active').toUpperCase()}</span>
          ${pool.status === 'active' ? `<button class="btn btn-secondary btn-sm" style="font-size:.68rem" onclick="closeTBPool('${pool.id}','${h(pool.name)}')">Close Pool</button>` : ''}
        </div>
      </div>
    </div>

    <!-- Stats mini row -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:.75rem;margin-bottom:1.25rem">
      <div style="background:var(--surface);border:1px solid var(--border);padding:.75rem;text-align:center;border-radius:4px">
        <div style="font-size:1.1rem;font-weight:700;color:var(--teal)">Ksh ${totalIn.toLocaleString()}</div>
        <div style="font-size:.6rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-top:.15rem">Total In</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);padding:.75rem;text-align:center;border-radius:4px">
        <div style="font-size:1.1rem;font-weight:700;color:var(--maroon)">Ksh ${(totalLoaned-totalRepaid).toLocaleString()}</div>
        <div style="font-size:.6rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-top:.15rem">Outstanding</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);padding:.75rem;text-align:center;border-radius:4px">
        <div style="font-size:1.1rem;font-weight:700;color:var(--gold)">Ksh ${poolBal.toLocaleString()}</div>
        <div style="font-size:.6rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-top:.15rem">Available</div>
      </div>
      <div style="background:var(--surface);border:1px solid var(--border);padding:.75rem;text-align:center;border-radius:4px">
        <div style="font-size:1.1rem;font-weight:700;color:var(--ink)">Ksh ${interestEarned.toLocaleString()}</div>
        <div style="font-size:.6rem;color:var(--ink-faint);text-transform:uppercase;letter-spacing:.08em;margin-top:.15rem">Interest Earned</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
      <!-- Member contribution status -->
      <div class="card">
        <div class="card-header"><div class="card-title">Member Contributions</div><div class="card-sub">${poolMemberDetails.length} in this pool</div></div>
        <div style="padding:.5rem 1rem 1rem">
          ${poolMemberDetails.length ? poolMemberDetails.map(m => {
            const total = contribByMember[m.id] || 0;
            const hasLoan = loansByMember[m.id]?.length > 0;
            const loanOutstanding = (loansByMember[m.id]||[]).reduce((s,l) => s+(Number(l.principal||0)-Number(l.total_repaid||0)),0);
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.45rem 0;border-bottom:.5px solid var(--border)">
              <div>
                <div style="font-size:.82rem;font-weight:600">${h(m.full_name)}</div>
                ${hasLoan ? `<div style="font-size:.68rem;color:var(--maroon)">Loan: Ksh ${loanOutstanding.toLocaleString()} outstanding</div>` : ''}
              </div>
              <div style="text-align:right">
                <div style="font-size:.82rem;font-weight:700;color:var(--teal)">Ksh ${total.toLocaleString()}</div>
                <div style="font-size:.65rem;color:var(--ink-faint)">contributed</div>
              </div>
            </div>`;
          }).join('') : '<div style="padding:1rem;text-align:center;color:var(--ink-faint);font-size:.8rem">No members assigned to this pool</div>'}
        </div>
      </div>

      <!-- Active Loans -->
      <div>
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-faint);margin-bottom:.65rem">Active Loans (${activeLoans.length})</div>
        ${activeLoans.length ? activeLoans.map(l => {
          const outstanding = Number(l.principal||0) - Number(l.total_repaid||0);
          const pct = Math.round((Number(l.total_repaid||0)/Number(l.principal||1))*100);
          const overdue = l.due_date && new Date(l.due_date) < new Date();
          return `<div class="loan-card ${overdue?'overdue':''}">
            <div style="display:flex;justify-content:space-between;margin-bottom:.3rem">
              <strong style="font-size:.85rem">${h(l.members?.full_name||'—')}</strong>
              <span class="badge ${overdue?'badge-red':'badge-green'}" style="font-size:.6rem">${overdue?'Overdue':'Active'}</span>
            </div>
            <div style="font-size:.75rem;color:var(--ink-faint)">Ksh ${Number(l.principal).toLocaleString()} · ${l.interest_rate}%/mo · Due: ${l.due_date||'—'}</div>
            <div style="font-size:.82rem;color:var(--maroon);font-weight:600;margin-top:.2rem">Outstanding: Ksh ${outstanding.toLocaleString()}</div>
            <div class="loan-progress"><div class="loan-progress-fill" style="width:${pct}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:.62rem;color:var(--ink-faint);margin-top:.2rem">
              <span>${pct}% repaid</span>
              <button class="btn btn-ghost btn-sm" style="font-size:.62rem;padding:.1rem .4rem" onclick="markLoanRepaid('${l.id}')">Mark Repaid</button>
            </div>
          </div>`;
        }).join('') : '<div style="color:var(--ink-faint);font-size:.82rem;padding:.5rem">No active loans in this pool</div>'}
      </div>
    </div>

    <!-- Recent Contributions Table -->
    <div class="card">
      <div class="card-header"><div class="card-title">Contribution History</div><div class="card-sub">${contribs.length} records</div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Member</th><th>Amount</th><th>M-Pesa Ref</th></tr></thead>
          <tbody>${contribs.length ? contribs.slice(0,15).map(c => `<tr>
            <td style="font-size:.75rem;color:var(--ink-faint)">${c.payment_date||'—'}</td>
            <td><strong>${h(c.members?.full_name||'—')}</strong></td>
            <td><strong style="color:var(--teal)">Ksh ${Number(c.amount).toLocaleString()}</strong></td>
            <td style="font-size:.72rem;color:var(--ink-faint)">${h(c.mpesa_ref||'—')}</td>
          </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;padding:1.5rem;color:var(--ink-faint)">No contributions recorded yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}


async function loadTBLoans() {
  const listEl = document.getElementById('tb-loans-list');
  if (!listEl) return;
  if (!allTBPools.length) { listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--ink-faint)">No pools yet</div>'; return; }

  const { data: loans } = await sb.from('table_banking_loans')
    .select('*,members(full_name),table_banking_pools(name)')
    .in('pool_id', allTBPools.map(p=>p.id))
    .order('created_at',{ascending:false});

  if (!loans?.length) {
    listEl.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--ink-faint)">No loans yet — issue your first loan</div>';
    return;
  }

  listEl.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>Member</th><th>Pool</th><th>Principal</th><th>Rate</th><th>Due Date</th><th>Outstanding</th><th>Status</th><th></th></tr></thead>
    <tbody>${loans.map(l => {
      const outstanding = Math.max(0, Number(l.principal||0) - Number(l.total_repaid||0));
      const overdue = l.due_date && new Date(l.due_date) < new Date() && l.status === 'active';
      const badgeClass = l.status==='repaid'?'badge-green':overdue?'badge-red':'badge-warn';
      return `<tr>
        <td><strong>${l.members?.full_name||'—'}</strong></td>
        <td>${l.table_banking_pools?.name||'—'}</td>
        <td>Ksh ${Number(l.principal).toLocaleString()}</td>
        <td>${l.interest_rate}%/mo</td>
        <td>${l.due_date||'—'}</td>
        <td><strong style="color:var(--maroon)">Ksh ${outstanding.toLocaleString()}</strong></td>
        <td><span class="badge ${badgeClass}">${overdue?'Overdue':l.status}</span></td>
        <td><button class="btn btn-secondary btn-sm" style="font-size:.68rem"
          onclick="markLoanRepaid('${l.id}')">Mark Repaid</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

async function saveTBPool() {
  const name = document.getElementById('tb-pool-name').value.trim();
  const rate = Number(document.getElementById('tb-pool-rate').value) || 10;
  const date = document.getElementById('tb-pool-date').value;
  const notes = document.getElementById('tb-pool-notes').value.trim();
  const maxLoan = Number(document.getElementById('tb-pool-max-loan')?.value||0);
  const fineAmount = Number(document.getElementById('tb-pool-fine')?.value||0);
  if (!name) { toast('Please enter a pool name'); return; }

  // Get selected members
  const selectedIds = Array.from(document.querySelectorAll('.tb-member-cb:checked')).map(cb=>cb.dataset.id);
  if (!selectedIds.length) { toast('Please select at least one member for this pool'); return; }

  const { error } = await sb.from('table_banking_pools').insert({
    org_id: currentOrg.id, name, interest_rate: rate,
    start_date: date || new Date().toISOString().split('T')[0],
    notes: notes || null, status: 'active', created_by: currentUser.id,
    pool_members: selectedIds,
    max_loan_per_member: maxLoan || null,
    default_fine_amount: fineAmount || null,
  });
  if (error) { toast('Error: ' + error.message); return; }
  toast('✓ Pool created: ' + name + ' (' + selectedIds.length + ' members)');
  closeModal('tbNewPool');
  document.getElementById('tb-pool-name').value = '';
  await loadTableBanking();
}

async function saveTBContribution() {
  const poolId = document.getElementById('tb-rec-pool').value;
  const memberId = document.getElementById('tb-rec-member').value;
  const amount = Number(document.getElementById('tb-rec-amount').value);
  const date = document.getElementById('tb-rec-date').value;
  const ref = document.getElementById('tb-rec-ref').value.trim();
  if (!poolId) { toast('Please select a pool'); return; }
  if (!memberId) { toast('Please select a member'); return; }
  if (!amount || amount <= 0) { toast('Please enter an amount'); return; }

  const saveBtn = [...document.querySelectorAll('#tb-tab-record .btn-primary')].pop();
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  const { error } = await sb.from('table_banking_contributions').insert({
    pool_id: poolId, org_id: currentOrg.id, member_id: memberId,
    amount, payment_date: date || new Date().toISOString().split('T')[0],
    mpesa_ref: ref || null, recorded_by: currentUser.id
  });

  if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Contribution →'; }
  if (error) { toast('Error: ' + error.message); return; }
  toast('✓ Contribution recorded — Ksh ' + amount.toLocaleString());
  document.getElementById('tb-rec-amount').value = '';
  document.getElementById('tb-rec-ref').value = '';
  await loadTableBanking();
  // Refresh overview if this pool is currently selected
  const poolSel = document.getElementById('tb-pool-select');
  if (poolSel?.value === poolId) await loadTBOverview(poolId);
}

function calcLoanRepayment() {
  const amount = Number(document.getElementById('tb-loan-amount').value) || 0;
  const rate = Number(document.getElementById('tb-loan-rate').value) || 10;
  if (amount > 0) {
    const interest = amount * rate / 100;
    const total = amount + interest;
    document.getElementById('tb-loan-calc').style.display = 'block';
    document.getElementById('tb-loan-calc-val').textContent = `Ksh ${total.toLocaleString()} (principal Ksh ${amount.toLocaleString()} + interest Ksh ${interest.toLocaleString()})`;
  }
}

async function saveTBLoan() {
  const poolId = document.getElementById('tb-loan-pool').value;
  const memberId = document.getElementById('tb-loan-member').value;
  const principal = Number(document.getElementById('tb-loan-amount').value);
  const rate = Number(document.getElementById('tb-loan-rate').value) || 10;
  const date = document.getElementById('tb-loan-date').value;
  const due = document.getElementById('tb-loan-due').value;
  const notes = document.getElementById('tb-loan-notes').value.trim();
  if (!poolId || !memberId) { toast('Please select pool and member'); return; }
  if (!principal || principal <= 0) { toast('Please enter loan amount'); return; }

  const { error } = await sb.from('table_banking_loans').insert({
    pool_id: poolId, org_id: currentOrg.id, member_id: memberId,
    principal, interest_rate: rate,
    disbursed_date: date || new Date().toISOString().split('T')[0],
    due_date: due || null, status: 'active',
    total_repaid: 0, notes: notes || null,
    issued_by: currentUser.id
  });
  if (error) { toast('Error: ' + error.message); return; }
  toast('✓ Loan issued — Ksh ' + principal.toLocaleString());
  closeModal('tbNewLoan');
  await loadTableBanking();
}

async function loadLoanRepayDetails(loanId) {
  const splitEl = document.getElementById('tb-repay-split');
  if (!loanId || !splitEl) { if(splitEl) splitEl.style.display='none'; return; }

  const { data: loan } = await sb.from('table_banking_loans').select('*,members(full_name)').eq('id', loanId).maybeSingle();
  if (!loan) return;
  const outstanding = Number(loan.principal||0) - Number(loan.total_repaid||0);
  const monthlyInterest = outstanding * Number(loan.interest_rate||10) / 100;

  splitEl.style.display = 'block';
  document.getElementById('tb-repay-principal').textContent = 'Ksh ' + outstanding.toLocaleString();
  document.getElementById('tb-repay-interest').textContent = 'Ksh ' + monthlyInterest.toLocaleString() + ' (1 month at ' + loan.interest_rate + '%)';

  // Auto-fill suggested amount
  const amtEl = document.getElementById('tb-repay-amount');
  if (amtEl && !amtEl.value) amtEl.value = Math.round(outstanding + monthlyInterest);
}

async function saveTBRepayment() {
  const loanId = document.getElementById('tb-repay-loan').value;
  const amount = Number(document.getElementById('tb-repay-amount').value);
  const date = document.getElementById('tb-repay-date').value;
  const ref = document.getElementById('tb-repay-ref').value.trim();
  if (!loanId) { toast('Please select a loan'); return; }
  if (!amount || amount <= 0) { toast('Please enter repayment amount'); return; }

  // Get loan details to split principal/interest
  const { data: loan } = await sb.from('table_banking_loans').select('*').eq('id', loanId).maybeSingle();
  if (!loan) { toast('Loan not found'); return; }

  const outstanding = Number(loan.principal||0) - Number(loan.total_repaid||0);
  const monthlyInterest = outstanding * Number(loan.interest_rate||10) / 100;
  const interestPaid = Math.min(amount, monthlyInterest);
  const principalPaid = Math.max(0, amount - interestPaid);

  const { error } = await sb.from('table_banking_repayments').insert({
    loan_id: loanId, org_id: currentOrg.id, member_id: loan.member_id,
    amount, principal_paid: principalPaid, interest_paid: interestPaid,
    payment_date: date, mpesa_ref: ref || null, recorded_by: currentUser.id
  });
  if (error) { toast('Error: ' + error.message); return; }

  // Update loan total_repaid
  const newRepaid = Number(loan.total_repaid||0) + principalPaid;
  const isFullyRepaid = newRepaid >= Number(loan.principal||0);
  await sb.from('table_banking_loans').update({
    total_repaid: newRepaid,
    status: isFullyRepaid ? 'repaid' : 'active'
  }).eq('id', loanId);

  toast(`✓ Repayment recorded — Ksh ${amount.toLocaleString()} (principal: ${principalPaid.toLocaleString()}, interest: ${interestPaid.toLocaleString()})${isFullyRepaid?' · Loan fully repaid! ✓':''}`);
  document.getElementById('tb-repay-amount').value = '';
  document.getElementById('tb-repay-split').style.display = 'none';
  await loadTableBanking();
  await loadTBLoans();
}

async function markLoanRepaid(loanId) {
  if (!confirm('Mark this loan as fully repaid?')) return;
  await sb.from('table_banking_loans').update({ status: 'repaid' }).eq('id', loanId);
  toast('✓ Loan marked as repaid');
  await loadTBLoans();
  await loadTableBanking();
}

async function closeTBPool(poolId, poolName) {
  if (!confirm(`Close "${poolName}"?\n\nThis will mark the pool as closed. Make sure all loans are repaid before closing. The pool data is preserved for records.`)) return;

  // Check for active loans
  const { data: activeLoans } = await sb.from('table_banking_loans')
    .select('id,members(full_name)')
    .eq('pool_id', poolId)
    .eq('status', 'active');

  if (activeLoans?.length) {
    const names = activeLoans.map(l => l.members?.full_name || 'Unknown').join(', ');
    if (!confirm(`⚠ There are ${activeLoans.length} active loan(s) outstanding:\n${names}\n\nClose anyway?`)) return;
  }

  const { error } = await sb.from('table_banking_pools')
    .update({ status: 'closed' })
    .eq('id', poolId);

  if (error) { toast('Error: ' + error.message); return; }
  await logActivity('TB POOL CLOSED', `Table banking pool "${poolName}" closed`);
  toast(`✓ Pool "${poolName}" closed`);
  await loadTableBanking();
}

// ── WELFARE EVENT TYPES (Settings) ────────────────────────────────────────
async function loadWelfareTypes() {
  const listEl = document.getElementById('welfare-types-list');
  if (!listEl) return;
  const { data: types } = await sb.from('welfare_event_types')
    .select('*').eq('org_id', currentOrg.id).order('created_at');
  _welTypes = types || [];
  if (!types?.length) {
    listEl.innerHTML = `<div style="padding:1.5rem 1.25rem;text-align:center;color:var(--ink-faint);font-size:.82rem">
      No event types yet. Add the welfare events your group uses — e.g. Member Bereavement, Annual Party, Emergency Fund.
      <div style="margin-top:.75rem">
        <button class="btn btn-secondary btn-sm" onclick="showAddWelfareType()">+ Add First Type</button>
      </div>
    </div>`;
    return;
  }
  const catColors = { bereavement:'var(--maroon)', community:'var(--teal)', celebration:'#c49a30', emergency:'var(--danger)', other:'var(--ink-faint)' };
  listEl.innerHTML = types.map(t => `
    <div style="display:flex;align-items:center;padding:.75rem 1.25rem;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:.84rem;font-weight:600;color:var(--ink)">${t.name}</div>
        <div style="font-size:.7rem;color:var(--ink-faint);margin-top:.1rem">
          <span style="color:${catColors[t.category]||'var(--ink-faint)'}">● ${t.category||'other'}</span>
          · ${t.scope==='general'?'General / Community':'Member-specific'}
        </div>
      </div>
      <div style="font-size:.9rem;font-weight:700;color:var(--maroon);margin-right:1rem">Ksh ${Number(t.default_amount||0).toLocaleString()}</div>
      <div style="display:flex;gap:.35rem">
        <button class="btn btn-secondary btn-sm" style="font-size:.68rem" onclick="editWelfareType('${t.id}','${t.name.replace(/'/g,"\'")}',${t.default_amount||0},'${t.category||'bereavement'}','${t.scope||'member_specific'}')">Edit</button>
        <button class="btn btn-danger btn-sm" style="font-size:.68rem" onclick="deleteWelfareType('${t.id}','${t.name.replace(/'/g,"\'")}')">✕</button>
      </div>
    </div>`).join('');
}

function showAddWelfareType() {
  document.getElementById('wtf-title').textContent = 'Add Event Type';
  document.getElementById('wtf-id').value = '';
  document.getElementById('wtf-name').value = '';
  document.getElementById('wtf-amount').value = '';
  document.getElementById('wtf-category').value = 'bereavement';
  document.getElementById('wtf-scope').value = 'member_specific';
  document.getElementById('welfare-type-form').style.display = 'block';
  document.getElementById('wtf-name').focus();
}

function editWelfareType(id, name, amount, category, scope) {
  document.getElementById('wtf-title').textContent = 'Edit Event Type';
  document.getElementById('wtf-id').value = id;
  document.getElementById('wtf-name').value = name;
  document.getElementById('wtf-amount').value = amount;
  document.getElementById('wtf-category').value = category;
  document.getElementById('wtf-scope').value = scope;
  document.getElementById('welfare-type-form').style.display = 'block';
  document.getElementById('wtf-name').focus();
}

function hideWelfareTypeForm() {
  document.getElementById('welfare-type-form').style.display = 'none';
}

async function saveWelfareType() {
  const id = document.getElementById('wtf-id')?.value;
  const name = document.getElementById('wtf-name')?.value?.trim();
  const amount = parseFloat(document.getElementById('wtf-amount')?.value||0);
  const category = document.getElementById('wtf-category')?.value;
  const scope = document.getElementById('wtf-scope')?.value;
  if (!name) { toast('Enter an event type name'); return; }
  if (!amount) { toast('Enter a default contribution amount'); return; }
  const payload = { org_id: currentOrg.id, name, default_amount: amount, category, scope };
  if (id) {
    await sb.from('welfare_event_types').update(payload).eq('id', id);
    toast('✓ Event type updated');
  } else {
    await sb.from('welfare_event_types').insert(payload);
    toast('✓ Event type added');
  }
  hideWelfareTypeForm();
  loadWelfareTypes();
}

async function deleteWelfareType(id, name) {
  if (!confirm('Delete "'+name+'"? Existing events using this type are not affected.')) return;
  await sb.from('welfare_event_types').delete().eq('id', id);
  toast('Deleted: '+name);
  loadWelfareTypes();
}

// Populate welfare event type dropdown when modal opens
function populateWelfareTypeSelect() {
  const sel = document.getElementById('wel-type');
  if (!sel) return;
  sel.innerHTML = '<option value="">Select event type…</option>';
  _welTypes.forEach(t => {
    sel.innerHTML += `<option value="${t.id}">${t.name} — Ksh ${Number(t.default_amount||0).toLocaleString()}</option>`;
  });
  sel.innerHTML += '<option value="__custom__">Custom / Other</option>';
}

