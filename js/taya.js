// GroupYetu360 — js/taya.js
// Taya AI assistant: panel UI, quick actions, and the Save handlers that
// turn a draft into a real record. Taya itself never writes to the
// database - every save action here is an ordinary, explicit write
// triggered by the admin clicking a button, same as any other form in
// this app.

let _tayaMode = null;        // 'meeting_minutes' | 'financial_summary' | 'arrears_message' | 'chat'
let _tayaContext = {};       // e.g. { meeting_id }
let _tayaHistory = [];       // [{role,content}] - only used for freeform chat continuity
let _tayaLastDraft = '';     // most recent draft text, for the active draft card's Save action

function toggleTayaPanel(forceOpen) {
  const panel = document.getElementById('taya-panel');
  if (!panel) return;
  const opening = forceOpen !== undefined ? forceOpen : !panel.classList.contains('open');
  panel.classList.toggle('open', opening);
  if (opening) {
    const sub = document.getElementById('taya-panel-sub');
    if (sub) sub.textContent = currentOrg?.name || '—';
    document.getElementById('taya-input')?.focus();
  }
}

// Resets the panel back to the greeting + quick-action chips, clearing any
// prior conversation - called whenever a fresh, unrelated task starts.
function tayaResetPanel() {
  _tayaMode = null; _tayaContext = {}; _tayaHistory = []; _tayaLastDraft = '';
  const body = document.getElementById('taya-panel-body');
  if (body) body.innerHTML = `
    <div class="taya-greeting">Hi! What would you like help with?</div>
    <div class="taya-chip-row" id="taya-chip-row">
      <div class="taya-chip" onclick="tayaQuickAction('meeting_minutes')">📝 Meeting minutes</div>
      <div class="taya-chip" onclick="tayaQuickAction('financial_summary')">📊 Financial summary</div>
      <div class="taya-chip" onclick="tayaQuickAction('arrears_message')">💬 Arrears reminder</div>
    </div>`;
}

function tayaAppend(html) {
  const body = document.getElementById('taya-panel-body');
  if (!body) return;
  body.insertAdjacentHTML('beforeend', html);
  body.scrollTop = body.scrollHeight;
}

function tayaAppendUserBubble(text) {
  tayaAppend(`<div class="taya-bubble-user">${h(text)}</div>`);
}

function tayaShowTyping() {
  tayaAppend(`<div class="taya-typing" id="taya-typing-indicator"><span></span><span></span><span></span></div>`);
}
function tayaHideTyping() {
  document.getElementById('taya-typing-indicator')?.remove();
}

// ── Entry points ──

// Called from a generic chip in the panel (no pre-loaded context). Meeting
// minutes needs a specific meeting - if there's more than one recent past
// meeting without minutes, ask which one rather than guessing.
async function tayaQuickAction(mode) {
  if (mode === 'meeting_minutes') {
    const { data: candidates } = await sb.from('meetings').select('id, meeting_date, agenda')
      .eq('org_id', currentOrg.id).is('minutes', null)
      .order('meeting_date', { ascending: false }).limit(5);
    if (!candidates?.length) {
      tayaAppend(`<div class="taya-bubble-taya">All your recent meetings already have minutes filed. Nothing pending right now.</div>`);
      return;
    }
    if (candidates.length === 1) {
      openTaya('meeting_minutes', candidates[0].id);
      return;
    }
    const chipsHtml = candidates.map(m => `<div class="taya-chip" onclick="openTaya('meeting_minutes','${m.id}')">${h(m.meeting_date)}${m.agenda ? ' — ' + h(m.agenda.slice(0,24)) : ''}</div>`).join('');
    tayaAppend(`<div class="taya-bubble-taya">Which meeting?</div><div class="taya-chip-row">${chipsHtml}</div>`);
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
  _tayaMode = mode;
  _tayaContext = mode === 'meeting_minutes' ? { meeting_id: contextId } : {};
  _tayaHistory = [];

  if (mode === 'meeting_minutes') {
    tayaAppend(`<div class="taya-bubble-taya">Tell me what was discussed (or leave blank and I'll draft from the agenda alone), then send.</div>`);
    document.getElementById('taya-input').placeholder = 'e.g. Discussed AGM date, welfare fund status…';
    document.getElementById('taya-input').focus();
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

  // No mode selected yet - treat as a freeform question about the org.
  if (!_tayaMode) _tayaMode = 'chat';

  await tayaGenerateDraft(text);
}

async function tayaGenerateDraft(message) {
  const sendBtn = document.getElementById('taya-send-btn');
  if (sendBtn) sendBtn.disabled = true;
  tayaShowTyping();

  try {
    const session = await sb.auth.getSession();
    const jwt = session?.data?.session?.access_token;
    if (!jwt) throw new Error('No active session');

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
    const result = await res.json();
    tayaHideTyping();
    if (!res.ok || result.error) throw new Error(result.error || 'Something went wrong');

    if (_tayaMode === 'chat') {
      _tayaHistory.push({ role: 'user', content: message }, { role: 'assistant', content: result.reply });
      tayaAppend(`<div class="taya-bubble-taya">${h(result.reply)}</div>`);
    } else {
      _tayaLastDraft = result.reply;
      tayaRenderDraftCard(_tayaMode, result.reply);
    }
  } catch (e) {
    tayaHideTyping();
    tayaAppend(`<div class="taya-bubble-taya">Sorry, I couldn't do that: ${h(e.message)}<br><br>If this keeps happening, <a href="https://wa.me/254702903544?text=Hi%2C%20I%20need%20help%20with%20Taya%20on%20GroupYetu360" target="_blank" rel="noopener">contact support on WhatsApp</a>.</div>`);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
}

function tayaRenderDraftCard(mode, text) {
  const labels = {
    meeting_minutes: 'Draft — Meeting Minutes',
    financial_summary: 'Draft — Financial Summary',
    arrears_message: 'Draft — Arrears Reminder',
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
