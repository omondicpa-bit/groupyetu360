// Supabase Edge Function: taya-assistant
//
// Single shared entry point for all of Taya's capabilities, routed by
// `mode` rather than one function per feature - see the note in
// js/taya.js for why (this codebase has already had the same fix need
// reapplying in more than one place before, from copy-pasted logic
// drifting apart; one function with clear mode branches avoids that for
// Taya's prompts specifically).
//
// Every mode:
//   1. Verifies the caller has a real session (not anonymous).
//   2. Verifies the caller actually belongs to the org_id they're asking
//      about, via user_orgs - never trusts org_id alone, since a
//      malicious caller could otherwise ask for another org's financial
//      data just by passing a different id.
//   3. Gathers only the data that specific mode needs, server-side -
//      never trusts client-supplied numbers for anything that ends up in
//      a draft (a client could otherwise ask Taya to "summarize" invented
//      figures).
//   4. Calls Claude, returns plain text. Nothing here writes to any
//      table - every mode returns a draft for the client to show the
//      admin, who explicitly saves it via a separate, ordinary write
//      (e.g. updating meetings.minutes) - Taya never commits anything
//      itself.
//
// Requires the ANTHROPIC_API_KEY secret to be set:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Deploy: supabase functions deploy taya-assistant

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL_SONNET = 'claude-sonnet-5';
const MODEL_HAIKU = 'claude-haiku-4-5-20251001';

async function callClaude(system: string, userMessage: string, history: {role:string,content:string}[] = [], model: string = MODEL_SONNET) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system,
      messages: [...history, { role: 'user', content: userMessage }],
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error (${res.status}): ${errText}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
  return text.trim();
}

const TAYA_PERSONA = `You are Taya, the AI assistant built into GroupYetu360, a platform Kenyan community groups (chamas, welfare groups, SACCOs, table banking pools) use to manage members, finances and meetings.

Write plainly and warmly, the way a capable, organised group secretary would. Use Kenyan Shillings as "Ksh". Keep drafts concise and genuinely usable as-is - the admin reading this will likely paste it directly into a form or send it as-is. Do not add meta-commentary like "Here is your draft" - just write the draft itself. Do not use markdown formatting like ** or # - this text goes directly into plain UI fields.`;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user: callerUser }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { org_id, mode, message, history, context } = await req.json();
    if (!org_id || !mode) {
      return new Response(JSON.stringify({ error: 'org_id and mode are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Verify caller has a Taya-eligible role in this org - admin, treasurer,
    // officer, or platform superadmin. Plain members don't get Taya access
    // at all (see useTaya in js/utils.js canDo()) - this is the server-side
    // enforcement of that, since hiding the FAB client-side alone wouldn't
    // stop a member calling this function directly. Checks both the
    // multi-org table and the legacy profiles.org_id path, matching the
    // same dual-path convention used everywhere else in this codebase.
    const TAYA_ROLES = ['admin', 'treasurer', 'officer'];
    const [{ data: uoRow }, { data: profRow }] = await Promise.all([
      supabase.from('user_orgs').select('role').eq('user_id', callerUser.id).eq('org_id', org_id).maybeSingle(),
      supabase.from('profiles').select('role, org_id').eq('id', callerUser.id).maybeSingle(),
    ]);
    const isSuperadmin = profRow?.role === 'superadmin';
    const hasEligibleRole = TAYA_ROLES.includes(uoRow?.role || '')
      || (profRow?.org_id === org_id && TAYA_ROLES.includes(profRow?.role || ''));
    if (!hasEligibleRole && !isSuperadmin) {
      return new Response(JSON.stringify({ error: 'Taya is available to organisation admins, treasurers and officers' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Daily cap per org - a backstop against any single org running away
    // with usage in one day. Deliberately checked before any data-gathering
    // or Claude call, so a capped request costs nothing at all, not even a
    // partial one. Not the main cost-control mechanism (that's admin-only
    // access, canned replies, free DB lookups, and Haiku for chat) - this
    // is the safety net underneath all of that.
    const DAILY_CAP = 20;
    const { data: usageCount } = await supabase.rpc('increment_taya_usage', { p_org_id: org_id });
    if (typeof usageCount === 'number' && usageCount > DAILY_CAP) {
      return new Response(
        JSON.stringify({ reply: "I've reached today's usage limit for this group - it resets tomorrow. For anything urgent in the meantime, use Contact Support." }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: org } = await supabase.from('organisations').select('name').eq('id', org_id).single();
    const orgName = org?.name || 'this group';

    let system = TAYA_PERSONA;
    let userMessage = message || '';

    if (mode === 'meeting_minutes') {
      const meetingId = context?.meeting_id;
      if (!meetingId) throw new Error('meeting_id is required for meeting_minutes mode');
      const { data: meeting } = await supabase.from('meetings').select('*').eq('id', meetingId).eq('org_id', org_id).single();
      if (!meeting) throw new Error('Meeting not found');
      const { data: attendance } = await supabase.from('attendance').select('status').eq('meeting_id', meetingId);
      const present = (attendance || []).filter(a => a.status === 'present').length;
      const total = (attendance || []).length;

      system += `\n\nYou are drafting formal meeting minutes. Structure them as: heading with the group name and date, attendance line, then numbered agenda points expanded into short minuted paragraphs, ending with "Meeting closed at [time if known]." If the admin's notes below don't cover a point on the agenda, write "No discussion recorded" for that point rather than inventing content.`;
      userMessage = `Group: ${orgName}\nMeeting date: ${meeting.meeting_date}\nTime: ${meeting.meeting_time || 'not recorded'}\nVenue: ${meeting.venue || 'not recorded'}\nAgenda: ${meeting.agenda || 'no agenda recorded'}\nAttendance: ${present} of ${total} recorded present\n\nAdmin's notes on what was discussed:\n${message || '(no additional notes provided - draft minutes from the agenda alone)'}`;

    } else if (mode === 'financial_summary') {
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const [{ data: txns }, { data: expenses }, { data: members }] = await Promise.all([
        supabase.from('transactions').select('amount').eq('org_id', org_id).gte('transaction_date', yearStart),
        supabase.from('expenses').select('amount, entry_type').eq('org_id', org_id).gte('expense_date', yearStart),
        supabase.from('members').select('status').eq('org_id', org_id),
      ]);
      const contributions = (txns || []).reduce((s, t) => s + Number(t.amount || 0), 0);
      const income = (expenses || []).filter(e => e.entry_type === 'income').reduce((s, e) => s + Number(e.amount || 0), 0);
      const spent = (expenses || []).filter(e => e.entry_type !== 'income').reduce((s, e) => s + Number(e.amount || 0), 0);
      const arrearsCount = (members || []).filter(m => m.status === 'arrears').length;

      system += `\n\nYou are drafting a short financial summary an admin can read aloud at a meeting or send to members. Plain prose, no headings needed, 4-6 sentences.`;
      userMessage = `Group: ${orgName}\nYear-to-date member contributions: Ksh ${contributions.toLocaleString()}\nOther income: Ksh ${income.toLocaleString()}\nTotal expenses: Ksh ${spent.toLocaleString()}\nMembers currently in arrears: ${arrearsCount} of ${(members||[]).length}\n\n${message || 'Draft a summary of the above for the members.'}`;

    } else if (mode === 'arrears_message') {
      const { data: arrearsMembers } = await supabase.from('members').select('full_name').eq('org_id', org_id).eq('status', 'arrears');
      const count = (arrearsMembers || []).length;
      if (!count) {
        return new Response(JSON.stringify({ reply: `Good news - no members are currently marked in arrears for ${orgName}.` }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      system += `\n\nYou are drafting a short, polite SMS reminder (under 300 characters) to send to members who are behind on their contributions. Firm but warm, no guilt-tripping, include the group name.`;
      userMessage = `Group: ${orgName}\n${count} members are currently behind on their contributions.\n\n${message || 'Draft the reminder SMS.'}`;

    } else if (mode === 'chat') {
      const [{ data: members }, { data: recentTxns }] = await Promise.all([
        supabase.from('members').select('full_name, status, shares_balance, savings_balance').eq('org_id', org_id),
        supabase.from('transactions').select('amount, transaction_date, members(full_name)').eq('org_id', org_id).order('transaction_date', { ascending: false }).limit(30),
      ]);
      const totalShares = (members || []).reduce((s, m) => s + Number(m.shares_balance || 0), 0);
      const totalSavings = (members || []).reduce((s, m) => s + Number(m.savings_balance || 0), 0);
      const arrears = (members || []).filter(m => m.status === 'arrears').map(m => m.full_name);
      // Previously only the group-wide totals were included here, even
      // though every member's own balance was already fetched above - a
      // question about one specific member's balance had nothing to draw
      // on, so Taya correctly said it didn't have the data, when the real
      // issue was that the data was fetched but never actually passed in.
      const memberTable = (members || [])
        .map((m:any) => `${m.full_name} - ${m.status} - Shares: Ksh ${Number(m.shares_balance||0).toLocaleString()} - Savings: Ksh ${Number(m.savings_balance||0).toLocaleString()}`)
        .join('\n');

      system += `\n\nAnswer questions about this group using only the data provided below. If something isn't in the data given, say you don't have that information rather than guessing.`;
      userMessage = `Group: ${orgName}\nTotal members: ${(members||[]).length}\nTotal shares balance: Ksh ${totalShares.toLocaleString()}\nTotal savings balance: Ksh ${totalSavings.toLocaleString()}\nMembers in arrears: ${arrears.length ? arrears.join(', ') : 'none'}\n\nPer-member balances:\n${memberTable}\n\nRecent transactions (last 30):\n${(recentTxns||[]).map((t:any) => `${t.transaction_date} - ${t.members?.full_name||'Unknown'} - Ksh ${t.amount}`).join('\n')}\n\nQuestion: ${message}`;

    } else {
      return new Response(JSON.stringify({ error: 'Unknown mode: ' + mode }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const modelForMode = mode === 'chat' ? MODEL_HAIKU : MODEL_SONNET;
    const reply = await callClaude(system, userMessage, history || [], modelForMode);
    return new Response(JSON.stringify({ reply }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
