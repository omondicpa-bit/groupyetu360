// GroupYetu360 — js/taya.js
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

function toggleTayaPanel(forceOpen) {
  const panel = document.getElementById('taya-panel');
  if (!panel) return;
  const opening = forceOpen !== undefined ? forceOpen : !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) {
    const subText = document.getElementById('taya-panel-sub-text');
    if (subText) subText.textContent = currentOrg?.name || '—';
    document.getElementById('taya-input')?.focus();
  }
}

// Resets the panel back to the greeting + quick-action chips, clearing any
// prior conversation - called whenever a fresh, unrelated task starts.
function tayaResetPanel() {
  _tayaMode = null; _tayaContext = {}; _tayaHistory = [];
  const body = document.getElementById('taya-panel-body');
  if (body) body.innerHTML = `
    <div class="taya-greeting">Hi, I'm Taya 👋<br>What can I help with today?</div>
    <div class="taya-chip-row" id="taya-chip-row">
      <div class="taya-chip" onclick="tayaQuickAction('meeting_minutes')">📝 Meeting minutes</div>
      <div class="taya-chip" onclick="tayaQuickAction('financial_summary')">📊 Financial summary</div>
      <div class="taya-chip" onclick="tayaQuickAction('arrears_message')">💬 Arrears reminder</div>
      <div class="taya-chip" onclick="tayaQuickAction('member_lookup')">🔍 Member lookup</div>
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
      tayaAppendError('Could not load your members list' + (error ? ' — ' + error.message : ''));
      return;
    }
    const options = members.map(m => `<option value="${m.id}">${h(m.full_name)}</option>`).join('');
    tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">Which member?</div></div>
      <div style="padding:0 .1rem;align-self:stretch">
        <select class="form-select" style="width:100%;font-size:.78rem;padding:.5rem" onchange="tayaLookupMemberById(this.value)">
          <option value="">Select a member…</option>${options}
        </select>
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
      tayaAppendError('Could not load your meetings — ' + e.message);
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
    const chipsHtml = candidates.map(m => `<div class="taya-chip" onclick="openTaya('meeting_minutes','${m.id}')">${h(m.meeting_date)}${m.agenda ? ' — ' + h(m.agenda.slice(0,24)) : ''}</div>`).join('');
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
    tayaAppendTayaBubble("Tell me what was discussed — or just hit send and I'll draft from the agenda alone.");
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
    // Try a free, instant, direct-from-database answer first - only when
    // no drafting flow is already active, since minutes/summaries/reminders
    // genuinely need generation, not a lookup.
    const handled = await tayaTryDirectAnswer(text);
    if (handled) return;
    _tayaMode = 'chat';
  }

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
  tayaAppend(`<div class="taya-msg-row from-taya"><div class="taya-bubble-taya">${h(text)}</div><div class="taya-msg-time">${tayaTime()} · ⚡ instant, no AI used</div></div>`);
}

async function tayaTryDirectAnswer(text) {
  // Only even attempt this for questions that look like a data lookup -
  // avoids misfiring on "draft a message" or genuinely open-ended chat.
  if (!/balance|arrears|how much|how many|contributed|paid|savings?|shares?/i.test(text)) return false;

  const { data: members, error } = await sb.from('members')
    .select('full_name, status, shares_balance, savings_balance')
    .eq('org_id', currentOrg.id);
  if (error || !members) return false;

  if (/how many members/i.test(text)) {
    tayaAppendDirect(`${currentOrg.name} has ${members.length} member${members.length === 1 ? '' : 's'}.`);
    return true;
  }
  if (/arrears/i.test(text) && /how many/i.test(text)) {
    const count = members.filter(m => m.status === 'arrears').length;
    tayaAppendDirect(`${count} member${count === 1 ? '' : 's'} currently in arrears.`);
    return true;
  }
  if (/total\s+shares/i.test(text)) {
    const total = members.reduce((s, m) => s + Number(m.shares_balance || 0), 0);
    tayaAppendDirect(`Total shares balance across all members: Ksh ${total.toLocaleString()}.`);
    return true;
  }
  if (/total\s+savings/i.test(text)) {
    const total = members.reduce((s, m) => s + Number(m.savings_balance || 0), 0);
    tayaAppendDirect(`Total savings balance across all members: Ksh ${total.toLocaleString()}.`);
    return true;
  }

  const member = tayaFindMemberInText(text, members);
  if (member) {
    tayaAppendDirect(
      `${member.full_name}\nStatus: ${member.status || 'active'}\nShares balance: Ksh ${Number(member.shares_balance || 0).toLocaleString()}\nSavings balance: Ksh ${Number(member.savings_balance || 0).toLocaleString()}`
    );
    return true;
  }

  return false; // no confident match - let Claude handle it properly
}

async function tayaLookupMemberById(memberId) {
  if (!memberId) return;
  const { data: member, error } = await sb.from('members')
    .select('full_name, status, shares_balance, savings_balance')
    .eq('id', memberId).single();
  if (error || !member) { tayaAppendError('Could not load that member — ' + (error?.message || 'not found')); return; }
  tayaAppendDirect(
    `${member.full_name}\nStatus: ${member.status || 'active'}\nShares balance: Ksh ${Number(member.shares_balance || 0).toLocaleString()}\nSavings balance: Ksh ${Number(member.savings_balance || 0).toLocaleString()}`
  );
}

async function tayaGenerateDraft(message) {
  const sendBtn = document.getElementById('taya-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  tayaShowTyping();

  try {
    const session = await sb.auth.getSession();
    const jwt = session?.data?.session?.access_token;
    if (!jwt) throw new Error("your session has expired — refresh the page and try again");

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
    if (!result.reply || !result.reply.trim()) throw new Error("Taya came back with an empty response — try rephrasing, or send again");

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
    meeting_minutes: '📝 Draft — Meeting minutes',
    financial_summary: '📊 Draft — Financial summary',
    arrears_message: '💬 Draft — Arrears reminder',
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
