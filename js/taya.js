// GroupYetu360 - js/taya.js
// Taya AI assistant: panel UI, quick actions, and the Save handlers that
// turn a draft into a real record. Taya itself never writes to the
// database - every save action here is an ordinary, explicit write
// triggered by the admin clicking a button, same as any other form in
// this app.

let _tayaMode = null;        // 'meeting_minutes' | 'financial_summary' | 'arrears_message' | 'chat'
let _tayaContext = {};       // e.g. { meeting_id }
let _tayaHistory = [];       // [{role,content}] - only used for freeform chat continuity

function tayaTime() {
  return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function tayaFirstName() {
  const full = currentProfile?.full_name || '';
  const first = full.trim().split(/\s+/)[0];
  return first || null;
}

function toggleTayaPanel(forceOpen) {
  const panel = document.getElementById('taya-panel');
  if (!panel) return;
  const opening = forceOpen !== undefined ? forceOpen : !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) {
    document.getElementById('taya-input')?.focus();
  }
}

// Resets the panel back to the greeting + quick-action chips, clearing any
// prior conversation - called whenever a fresh, unrelated task starts.
function tayaResetPanel() {
  _tayaMode = null; _tayaContext = {}; _tayaHistory = [];
  const body = document.getElementById('taya-panel-body');
  const name = tayaFirstName();
  if (body) body.innerHTML = `
    <div class="taya-greeting">Hi${name ? ' ' + h(name) : ''}, I'm Taya 👋<br>What can I help with today?</div>
    <div class="taya-chip-row" id="taya-chip-row">
      <div class="taya-chip" onclick="tayaQuickAction('meeting_minutes')">📝 Meeting minutes</div>
      <div class="taya-chip" onclick="tayaQuickAction('financial_summary')">📊 Financial summary</div>
      <div class="taya-chip" onclick="tayaQuickAction('arrears_message')">💬 Arrears reminder</div>
      <div class="taya-chip" onclick="tayaQuickAction('member_lookup')">🔍 Member lookup</div>
      <div class="taya-chip" onclick="tayaQuickAction('last_contribution')">📅 Last contribution check</div>
    </div>`;
}

function tayaAppend(html) {
  const body = document.getElementById('taya-panel-body');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', html);
  body.scrollTop = body.scrollHeight;
}

function tayaAppendUserBubble(text) {
  tayaAppend(`<div class="taya-msg-row from-user"><div class="taya-bubble-user">${h(text)}</div><div class="taya-msg-time">${tayaTime()}</div></div>`);
}

function tayaAppendTayaBubble(text) {
  tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">${h(text)}</div><div class="taya-msg-time">${tayaTime()}</div></div>`);
}

function tayaAppendError(message) {
  tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-error-bubble">Sorry, that didn't work: ${h(message)}<br><br>If this keeps happening, <a href="https://wa.me/254702903544?text=Hi%2C%20I%20need%20help%20with%20Taya%20on%20GroupYetu360" target="_blank" rel="noopener">contact support on WhatsApp</a>.</div></div>`);
}

function tayaShowTyping() {
  tayaAppend(`<div class="taya-msg-row from-taya" id="taya-typing-row"><div class="taya-typing"><span></span><span></span><span></span></div></div>`);
}
function tayaHideTyping() {
  document.getElementById('taya-typing-row')?.remove();
}

// ── Entry points ──

// Called from a generic chip in the panel (no pre-loaded context). Meeting
// minutes needs a specific meeting - if there's more than one recent past
// meeting without minutes, ask which one rather than guessing.
async function tayaQuickAction(mode) {
  if (mode === 'member_lookup') {
    const { data: members, error } = await sb.from('members').select('id, full_name').eq('org_id', currentOrg.id).order('full_name');
    if (error || !members?.length) {
      tayaAppendError('Could not load your members list' + (error ? ' - ' + error.message : ''));
      return;
    }
    const options = members.map(m => `<option value="${m.id}">${h(m.full_name)}</option>`).join('');
    tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">Which member?</div></div>
      <div class="taya-inline-group">
        <select class="taya-inline-field" onchange="tayaLookupMemberById(this.value)">
          <option value="">Select a member…</option>${options}
        </select>
      </div>`);
    return;
  }
  if (mode === 'last_contribution') {
    tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">Show members who have not contributed since which date?</div></div>
      <div class="taya-inline-group">
        <input type="date" id="taya-cutoff-date" class="taya-inline-field"/>
        <button class="taya-inline-btn" onclick="tayaRunLastContributionCheck()">Check</button>
      </div>`);
    return;
  }
  if (mode === 'meeting_minutes') {
    let candidates;
    try {
      const res = await sb.from('meetings').select('id, meeting_date, agenda')
        .eq('org_id', currentOrg.id).is('minutes', null)
        .order('meeting_date', { ascending: false }).limit(5);
      if (res.error) throw res.error;
      candidates = res.data;
    } catch (e) {
      tayaAppendError('Could not load your meetings - ' + e.message);
      return;
    }
    if (!candidates?.length) {
      tayaAppendTayaBubble("All your recent meetings already have minutes filed. Nothing pending right now.");
      return;
    }
    if (candidates.length === 1) {
      openTaya('meeting_minutes', candidates[0].id);
      return;
    }
    const chipsHtml = candidates.map(m => `<div class="taya-chip" onclick="openTaya('meeting_minutes','${m.id}')">${h(m.meeting_date)}${m.agenda ? ' - ' + h(m.agenda.slice(0,24)) : ''}</div>`).join('');
    tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">Which meeting would you like minutes for?</div></div><div class="taya-chip-row">${chipsHtml}</div>`);
    return;
  }
  if (mode === 'financial_summary') { openTaya('financial_summary'); return; }
  if (mode === 'arrears_message') { openTaya('arrears_message'); return; }
}

// Programmatic entry with context already known - e.g. the "Draft with
// Taya" button on a specific meeting's card already knows the meeting_id,
// so it skips straight to generating rather than asking which one.
async function openTaya(mode, contextId) {
  toggleTayaPanel(true);
  tayaResetPanel();
  _tayaMode = mode;
  _tayaContext = mode === 'meeting_minutes' ? { meeting_id: contextId } : {};
  _tayaHistory = [];

  if (mode === 'meeting_minutes') {
    tayaAppendTayaBubble("Tell me what was discussed, or just hit send and I'll draft from the agenda alone.");
    const input = document.getElementById('taya-input');
    if (input) { input.placeholder = 'e.g. Discussed AGM date, welfare fund status…'; input.focus(); }
    return;
  }
  if (mode === 'financial_summary') {
    tayaAppendUserBubble('Draft a financial summary');
    await tayaGenerateDraft('Draft a financial summary for the members.');
    return;
  }
  if (mode === 'arrears_message') {
    tayaAppendUserBubble('Draft an arrears reminder');
    await tayaGenerateDraft('Draft the reminder SMS.');
    return;
  }
}

// ── Sending ──

async function sendTayaMessage() {
  const input = document.getElementById('taya-input');
  const text = input?.value.trim();
  if (!text) return;
  input.value = '';

  tayaAppendUserBubble(text);

  if (!_tayaMode) {
    // Cheapest possible path first - greetings and "what can you do"
    // questions need zero network calls at all, not even a database read.
    const cannedReply = tayaCannedReply(text);
    if (cannedReply) { await tayaAppendDirect(cannedReply); tayaLogQuestion(text, 'canned'); return; }

    // Free, instant, direct-from-database answer next - only when no
    // drafting flow is already active, since minutes and summaries and
    // reminders genuinely need generation, not a lookup.
    const handled = await tayaTryTopicAnswer(text);
    if (handled) { tayaLogQuestion(text, 'direct'); return; }

    // Basic platform questions come from a maintained FAQ, not Claude. This
    // covers "what is GroupYetu360" style questions with an answer we wrote
    // ourselves, not one Claude guesses at each time.
    const handledByFaq = await tayaTryFaqAnswer(text);
    if (handledByFaq) { tayaLogQuestion(text, 'faq'); return; }

    _tayaMode = 'chat';
  }

  tayaLogQuestion(text, _tayaMode);

  await tayaGenerateDraft(text);
}

// ── Cost-saving direct answers - zero Claude API cost ──
//
// A lot of what people ask Taya is a plain database lookup with no real
// reasoning or generation involved ("what's Felix's balance", "how many
// members are in arrears") - routing that through Claude costs money and,
// worse, adds a chance of the model mis-summarizing a number that a direct
// query would never get wrong. This tries a narrow set of high-confidence
// patterns first; anything it's not confident about falls through to the
// normal Claude-powered chat path unchanged.
function tayaFindMemberInText(text, members) {
  const lower = text.toLowerCase();
  // Full-name match is the safest signal - if more than one member's full
  // name appears, it's ambiguous which one is meant, so don't guess.
  const fullMatches = members.filter(m => m.full_name && lower.includes(m.full_name.toLowerCase()));
  if (fullMatches.length === 1) return fullMatches[0];
  if (fullMatches.length > 1) return null;

  // Fall back to a bare first name, but only if it's unique among members -
  // two "Felix"es in the group means this can't be trusted either.
  const firstNameCounts = {};
  members.forEach(m => {
    const first = (m.full_name || '').trim().split(/\s+/)[0]?.toLowerCase();
    if (first) firstNameCounts[first] = (firstNameCounts[first] || 0) + 1;
  });
  const words = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (firstNameCounts[w] === 1) {
      return members.find(m => (m.full_name || '').trim().split(/\s+/)[0]?.toLowerCase() === w);
    }
  }
  return null;
}

function tayaAppendDirect(text) {
  return new Promise(resolve => {
    tayaShowTyping();
    // A brief, slightly randomised pause before showing the answer - purely
    // about how this feels to use. The lookup itself is already instant and
    // free either way; this just keeps the pacing consistent with a real
    // Claude response so it reads as one continuous experience rather than
    // exposing which path handled it.
    const delay = 450 + Math.random() * 450;
    setTimeout(() => {
      tayaHideTyping();
      tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">${h(text)}</div><div class="taya-msg-time">${tayaTime()} ⚡</div></div>`);
      resolve();
    }, delay);
  });
}

// Greetings and meta questions ("hi", "thanks", "what can you do") never
// need Claude, or even a database read - handled entirely client-side.
// Returns the reply text if matched, or null to fall through.
function tayaCannedReply(text) {
  const t = text.trim().toLowerCase().replace(/[!.?]+$/, '');
  if (/^(hi|hello|hey|hallo|habari|niaje|sasa|mambo)( taya)?$/.test(t)) {
    const name = tayaFirstName();
    return `Hi${name ? ' ' + name : ''}! I can help with meeting minutes, financial summaries, arrears reminders, or member lookups. Tap one of the options above, or just ask.`;
  }
  if (/^(thanks|thank you|asante|thnx|ty)\b/.test(t)) {
    return "You're welcome! Let me know if there's anything else.";
  }
  if (/what can you do|who are you|what is taya|what'?s taya|^help$/.test(t)) {
    return "I'm Taya. I can draft meeting minutes, summarise your group's finances, help remind members in arrears, and look up member balances. All of it comes straight from this group's own records.";
  }
  return null;
}

// Platform questions, matched against a maintained FAQ table instead of
// Claude. Fetched once per session and cached, since this content rarely
// changes. Picks the longest matching trigger phrase, so a more specific
// phrase wins over a shorter, more generic one.
let _tayaFaqCache = null;

async function tayaTryFaqAnswer(text) {
  if (!_tayaFaqCache) {
    const { data, error } = await sb.from('taya_faq').select('triggers, answer');
    if (error || !data) return false;
    _tayaFaqCache = data;
  }
  const lower = text.toLowerCase();
  let best = null;
  let bestLen = 0;
  for (const row of _tayaFaqCache) {
    for (const trig of row.triggers || []) {
      if (lower.includes(trig.toLowerCase()) && trig.length > bestLen) {
        best = row;
        bestLen = trig.length;
      }
    }
  }
  if (best) {
    await tayaAppendDirect(best.answer);
    return true;
  }
  return false;
}

// Logs every question so gaps can be reviewed later. Fire and forget, on
// purpose. Logging should never block the chat or surface an error to the
// user if it fails.
function tayaLogQuestion(question, handledBy) {
  sb.from('taya_question_log').insert({
    org_id: currentOrg?.id || null,
    user_id: currentUser?.id || null,
    question,
    handled_by: handledBy,
  }).then(() => {}, () => {});
}

// ── Direct-answer topics ──
// Each topic recognises a question shape and answers it straight from the
// database. No Claude call. No cost. New areas get added here as a new
// entry, not as more branches inside one growing function. Order goes
// roughly specific to general, since the first confident match wins.
const TAYA_TOPICS = [
  {
    name: 'last_contribution_redirect',
    test: t => /(who|which member).*(not|hasn'?t|haven'?t).*(contribut|paid)|last contribut|contributed before|paid before|not contributed since/i.test(t),
    handle: async () => { await tayaQuickAction('last_contribution'); return '__handled__'; },
  },
  {
    name: 'next_meeting',
    test: t => /next meeting|upcoming meeting|when is the meeting|when.*next meeting/i.test(t),
    handle: tayaTopicNextMeeting,
  },
  {
    name: 'meeting_count',
    test: t => /how many meetings/i.test(t),
    handle: tayaTopicMeetingCount,
  },
  {
    name: 'attendance',
    test: t => /attendance|attend(ed)?|missed the (last|previous) meeting|was .*(present|absent)/i.test(t),
    handle: tayaTopicAttendance,
  },
  {
    name: 'welfare_status',
    test: t => /welfare (fund|balance|status|pool)/i.test(t),
    handle: tayaTopicWelfareStatus,
  },
  {
    name: 'table_banking',
    test: t => /table banking (pool|balance)|tb pool/i.test(t),
    handle: tayaTopicTableBanking,
  },
  {
    name: 'mgr_status',
    test: t => /(whose|who'?s) turn|next.*(receive|payout)|rotating savings status|merry go round status|current round/i.test(t),
    handle: tayaTopicMGRStatus,
  },
  {
    name: 'fines',
    test: t => /\bfine\b|fines|penalt/i.test(t),
    handle: tayaTopicFines,
  },
  {
    name: 'member_or_aggregate',
    test: t => /balance|arrears|how much|how many|contributed|paid|savings?|shares?|report|info|details/i.test(t),
    handle: tayaTopicMemberOrAggregate,
  },
];

async function tayaTryTopicAnswer(text) {
  for (const topic of TAYA_TOPICS) {
    if (!topic.test(text)) continue;
    let result;
    try {
      result = await topic.handle(text);
    } catch (e) {
      continue; // this topic failed to answer confidently - try the next one, or fall through to Claude
    }
    if (result === '__handled__') return true; // handler already rendered its own reply
    if (result) { await tayaAppendDirect(result); return true; }
  }
  return false; // nothing confident matched - let Claude handle it properly
}

async function tayaTopicNextMeeting() {
  const today = new Date().toISOString().split('T')[0];
  const { data } = await sb.from('meetings').select('meeting_date, meeting_time, venue')
    .eq('org_id', currentOrg.id).gte('meeting_date', today)
    .order('meeting_date', { ascending: true }).limit(1);
  if (!data?.length) return 'No upcoming meeting is scheduled yet.';
  const m = data[0];
  return `Next meeting: ${m.meeting_date}${m.meeting_time ? ' at ' + m.meeting_time : ''}.\nVenue: ${m.venue || 'not set yet'}.`;
}

async function tayaTopicMeetingCount() {
  const { count } = await sb.from('meetings').select('id', { count: 'exact', head: true }).eq('org_id', currentOrg.id);
  return `Your group has held ${count || 0} meeting${count === 1 ? '' : 's'} in total.`;
}

async function tayaTopicAttendance(text) {
  const { data: members } = await sb.from('members').select('id, full_name').eq('org_id', currentOrg.id);
  if (!members) return null;
  const member = tayaFindMemberInText(text, members);

  if (member) {
    const { data: recs } = await sb.from('attendance')
      .select('status, meetings(meeting_date)')
      .eq('member_id', member.id)
      .limit(20);
    if (!recs?.length) return `No attendance has been recorded for ${member.full_name} yet.`;
    const sorted = recs.slice()
      .sort((a, b) => (b.meetings?.meeting_date || '').localeCompare(a.meetings?.meeting_date || ''))
      .slice(0, 5);
    const lines = sorted.map(r => `${r.meetings?.meeting_date || 'Unknown date'}: ${r.status}`).join('\n');
    return `${member.full_name}'s recent attendance.\n\n${lines}`;
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: lastMeeting } = await sb.from('meetings')
    .select('id, meeting_date').eq('org_id', currentOrg.id).lt('meeting_date', today)
    .order('meeting_date', { ascending: false }).limit(1);
  if (!lastMeeting?.length) return 'No past meetings recorded yet.';
  const meetingId = lastMeeting[0].id;
  const { data: att } = await sb.from('attendance').select('status').eq('meeting_id', meetingId);
  const present = (att || []).filter(a => a.status === 'present').length;
  const apology = (att || []).filter(a => a.status === 'apology').length;
  const absent = (att || []).filter(a => a.status === 'absent').length;
  return `Attendance for the last meeting on ${lastMeeting[0].meeting_date}.\n\nPresent: ${present}\nApology: ${apology}\nAbsent: ${absent}`;
}

async function tayaTopicWelfareStatus() {
  // is_active is never explicitly set on creation, so it can sit as NULL
  // rather than true. Filtering client side with !== false, matching the
  // same fix already applied to the Record Payment modal and the dashboard.
  const { data: events } = await sb.from('welfare_events')
    .select('id, event_type, is_active, contribution_per_member')
    .eq('org_id', currentOrg.id);
  const active = (events || []).filter(e => e.is_active !== false);
  if (!active.length) return 'There is no active welfare event right now.';

  const lines = [];
  for (const e of active) {
    const { data: txns } = await sb.from('transactions').select('amount').eq('welfare_event_id', e.id);
    const collected = (txns || []).reduce((s, t) => s + Number(t.amount || 0), 0);
    const perMember = e.contribution_per_member ? ` Ksh ${Number(e.contribution_per_member).toLocaleString()} per member.` : '';
    lines.push(`${e.event_type || 'Welfare event'}: Ksh ${collected.toLocaleString()} collected so far.${perMember}`);
  }
  return lines.join('\n');
}

async function tayaTopicTableBanking() {
  const { data: pools } = await sb.from('table_banking_pools')
    .select('id, name').eq('org_id', currentOrg.id).eq('status', 'active');
  if (!pools?.length) return 'There is no active table banking pool right now.';
  const poolIds = pools.map(p => p.id);
  const [{ data: contribs }, { data: loans }] = await Promise.all([
    sb.from('table_banking_contributions').select('pool_id, amount').in('pool_id', poolIds),
    sb.from('table_banking_loans').select('pool_id, amount').in('pool_id', poolIds).eq('status', 'active'),
  ]);
  const lines = pools.map(p => {
    const total = (contribs || []).filter(c => c.pool_id === p.id).reduce((s, c) => s + Number(c.amount || 0), 0);
    const activeLoans = (loans || []).filter(l => l.pool_id === p.id);
    const loanTotal = activeLoans.reduce((s, l) => s + Number(l.amount || 0), 0);
    return `${p.name}: Ksh ${total.toLocaleString()} contributed. ${activeLoans.length} active loan${activeLoans.length === 1 ? '' : 's'} totalling Ksh ${loanTotal.toLocaleString()}.`;
  });
  return lines.join('\n');
}

async function tayaTopicMGRStatus() {
  const { data: rounds } = await sb.from('savings_rounds')
    .select('id, name, amount_per_member').eq('org_id', currentOrg.id).eq('status', 'active');
  if (!rounds?.length) return 'There is no active rotating savings round right now.';
  const lines = [];
  for (const r of rounds) {
    const { data: slots } = await sb.from('round_slots')
      .select('slot_number, received, members(full_name)')
      .eq('round_id', r.id).order('slot_number');
    const next = (slots || []).find(s => !s.received);
    const turn = next ? `Next to receive is ${next.members?.full_name || 'unknown'}, round ${next.slot_number}.` : 'Everyone has received their turn.';
    lines.push(`${r.name}: ${turn} Ksh ${Number(r.amount_per_member || 0).toLocaleString()} per round.`);
  }
  return lines.join('\n');
}

async function tayaTopicFines(text) {
  const { data: members } = await sb.from('members').select('id, full_name').eq('org_id', currentOrg.id);
  const member = members ? tayaFindMemberInText(text, members) : null;

  if (member) {
    const { data: fines } = await sb.from('fines').select('reason, amount, issued_date')
      .eq('org_id', currentOrg.id).eq('member_id', member.id).eq('status', 'pending');
    if (!fines?.length) return `${member.full_name} has no pending fines.`;
    const total = fines.reduce((s, f) => s + Number(f.amount || 0), 0);
    const lines = fines.map(f => `${f.issued_date}: ${f.reason || 'Fine'}. Ksh ${Number(f.amount).toLocaleString()}`).join('\n');
    return `${member.full_name} has ${fines.length} pending fine${fines.length === 1 ? '' : 's'}. Total Ksh ${total.toLocaleString()}.\n\n${lines}`;
  }

  const { data: allFines } = await sb.from('fines').select('amount').eq('org_id', currentOrg.id).eq('status', 'pending');
  const total = (allFines || []).reduce((s, f) => s + Number(f.amount || 0), 0);
  return `${(allFines || []).length} pending fine${(allFines || []).length === 1 ? '' : 's'} across the group. Total Ksh ${total.toLocaleString()}.`;
}

async function tayaTopicMemberOrAggregate(text) {
  const { data: members, error } = await sb.from('members')
    .select('id, full_name, status, shares_balance, savings_balance')
    .eq('org_id', currentOrg.id);
  if (error || !members) return null;

  if (/how many members/i.test(text)) {
    return `${currentOrg.name} has ${members.length} member${members.length === 1 ? '' : 's'}.`;
  }
  if (/arrears/i.test(text) && /how many/i.test(text)) {
    const count = members.filter(m => m.status === 'arrears').length;
    return `${count} member${count === 1 ? '' : 's'} currently in arrears.`;
  }
  if (/total\s+shares/i.test(text)) {
    const total = members.reduce((s, m) => s + Number(m.shares_balance || 0), 0);
    return `Total shares balance across all members: Ksh ${total.toLocaleString()}.`;
  }
  if (/total\s+savings/i.test(text)) {
    const total = members.reduce((s, m) => s + Number(m.savings_balance || 0), 0);
    return `Total savings balance across all members: Ksh ${total.toLocaleString()}.`;
  }

  const member = tayaFindMemberInText(text, members);
  if (member) {
    await tayaAppendMemberReport(member);
    return '__handled__'; // tayaAppendMemberReport already rendered its own reply
  }

  return null;
}


// Every member's real last contribution date, computed from actual
// transactions, not a limited recent-history window. Members with no
// transactions at all show as never contributed.
async function tayaRunLastContributionCheck() {
  const cutoff = document.getElementById('taya-cutoff-date')?.value;
  if (!cutoff) { toast('Pick a date first'); return; }

  const [{ data: members }, { data: txns }] = await Promise.all([
    sb.from('members').select('id, full_name').eq('org_id', currentOrg.id),
    sb.from('transactions').select('member_id, transaction_date').eq('org_id', currentOrg.id),
  ]);
  if (!members) { tayaAppendError('Could not load members'); return; }

  const lastByMember = {};
  (txns || []).forEach(t => {
    if (!t.member_id) return;
    const cur = lastByMember[t.member_id];
    if (!cur || t.transaction_date > cur) lastByMember[t.member_id] = t.transaction_date;
  });

  const stale = members
    .map(m => ({ name: m.full_name, last: lastByMember[m.id] || null }))
    .filter(m => !m.last || m.last < cutoff)
    .sort((a, b) => (a.last || '').localeCompare(b.last || ''));

  if (!stale.length) {
    await tayaAppendDirect(`Every member has contributed since ${cutoff}.`);
    return;
  }
  const lines = stale.map(m => `${m.name}: ${m.last ? 'last paid ' + m.last : 'never contributed'}`).join('\n');
  await tayaAppendDirect(`Members with no contribution since ${cutoff}.\n\n${lines}`);
}

async function tayaLookupMemberById(memberId) {
  if (!memberId) return;
  const { data: member, error } = await sb.from('members')
    .select('id, full_name, status, shares_balance, savings_balance')
    .eq('id', memberId).single();
  if (error || !member) { tayaAppendError('Could not load that member - ' + (error?.message || 'not found')); return; }
  await tayaAppendMemberReport(member);
}

// Scoped to one specific member's own transaction history, not capped at
// a recent-window group-wide list the way Claude's version used to be.
async function tayaAppendMemberReport(member) {
  const { data: txns } = await sb.from('transactions')
    .select('amount, transaction_date, contribution_types(name)')
    .eq('member_id', member.id)
    .order('transaction_date', { ascending: false })
    .limit(10);
  const total = Number(member.shares_balance || 0) + Number(member.savings_balance || 0);
  const txnLines = (txns || []).length
    ? (txns || []).map(t => `${t.transaction_date} - ${t.contribution_types?.name || 'Payment'} - Ksh ${Number(t.amount).toLocaleString()}`).join('\n')
    : 'No transactions recorded yet.';
  await tayaAppendDirect(
    `${member.full_name}\nStatus: ${member.status || 'active'}\nShares balance: Ksh ${Number(member.shares_balance || 0).toLocaleString()}\nSavings balance: Ksh ${Number(member.savings_balance || 0).toLocaleString()}\nTotal balance: Ksh ${total.toLocaleString()}\n\nRecent transactions (most recent 10, this member only):\n${txnLines}`
  );
}

async function tayaGenerateDraft(message) {
  const sendBtn = document.getElementById('taya-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  tayaShowTyping();

  try {
    const session = await sb.auth.getSession();
    const jwt = session?.data?.session?.access_token;
    if (!jwt) throw new Error("your session has expired, refresh the page and try again");

    const res = await fetch('https://eengldzvvgplgzvbutal.supabase.co/functions/v1/taya-assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      body: JSON.stringify({
        org_id: currentOrg.id,
        mode: _tayaMode,
        message,
        history: _tayaMode === 'chat' ? _tayaHistory : [],
        context: _tayaContext,
      }),
    });

    let result;
    try {
      result = await res.json();
    } catch (parseErr) {
      throw new Error(`Taya's server didn't respond properly (status ${res.status}). This usually means the function isn't deployed yet, or the API key isn't set up correctly.`);
    }

    tayaHideTyping();
    if (!res.ok || result.error) throw new Error(result.error || `something went wrong (status ${res.status})`);
    if (!result.reply || !result.reply.trim()) throw new Error("Taya came back with an empty response, try rephrasing or send again");

    if (_tayaMode === 'chat') {
      _tayaHistory.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
      tayaAppendTayaBubble(result.reply);
    } else {
      tayaRenderDraftCard(_tayaMode, result.reply);
    }
  } catch (e) {
    tayaHideTyping();
    tayaAppendError(e.message || 'unknown error');
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function tayaRenderDraftCard(mode, text) {
  const labels = {
    meeting_minutes: '📝 Draft: Meeting minutes',
    financial_summary: '📊 Draft: Financial summary',
    arrears_message: '💬 Draft: Arrears reminder',
  };
  const saveLabels = {
    meeting_minutes: 'Save to Meetings →',
    financial_summary: 'Copy',
    arrears_message: 'Use in Messages →',
  };
  const cardId = 'taya-draft-' + Date.now();
  tayaAppend(`
    <div class="taya-draft-card" id="${cardId}">
      <div class="taya-draft-head">${labels[mode] || 'Draft'}</div>
      <div class="taya-draft-body" contenteditable="true" id="${cardId}-body">${h(text)}</div>
      <div class="taya-draft-actions">
        <button class="taya-btn-ghost" onclick="document.getElementById('${cardId}').remove()">Discard</button>
        <button class="taya-btn-primary" onclick="tayaSaveDraft('${mode}','${cardId}-body')">${saveLabels[mode] || 'Save'}</button>
      </div>
    </div>`);
}

// ── Save handlers - the only place any of this actually writes anything ──

async function tayaSaveDraft(mode, bodyElId) {
  const text = document.getElementById(bodyElId)?.innerText.trim();
  if (!text) return;

  if (mode === 'meeting_minutes') {
    const meetingId = _tayaContext.meeting_id;
    if (!meetingId) { toast('No meeting selected'); return; }
    const { error } = await sb.from('meetings').update({ minutes: text }).eq('id', meetingId);
    if (error) { toast('Error: ' + error.message); return; }
    toast('Minutes saved');
    if (typeof loadMeetings === 'function') loadMeetings();
    toggleTayaPanel(false);
    return;
  }

  if (mode === 'financial_summary') {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch (e) {
      toast('Could not copy - select and copy the text manually');
    }
    return;
  }

  if (mode === 'arrears_message') {
    toggleTayaPanel(false);
    showPage('messages');
    setTimeout(() => {
      const body = document.getElementById('sms-body');
      const recipients = document.getElementById('sms-recipients');
      if (body) { body.value = text; if (typeof updateSmsCount === 'function') updateSmsCount(text); }
      if (recipients) recipients.value = 'arrears';
      toast('Draft loaded into Messages - review and send');
    }, 150);
    return;
  }
}
