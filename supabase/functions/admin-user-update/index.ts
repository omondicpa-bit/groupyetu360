import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // ── 1. Verify caller is authenticated ──
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Create a client with the caller's JWT to verify their role
    const callerClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    // Get caller's profile — must be superadmin
    const { data: callerProfile, error: profileErr } = await callerClient
      .from('profiles')
      .select('role')
      .single()

    if (profileErr || callerProfile?.role !== 'superadmin') {
      return new Response(JSON.stringify({ error: 'Forbidden — superadmin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 2. Parse request body ──
    const { user_id, email, password } = await req.json()

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!email && !password) {
      return new Response(JSON.stringify({ error: 'Provide at least email or password to update' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 3. Use service-role client to update auth user ──
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const updatePayload: { email?: string; password?: string } = {}
    if (email) updatePayload.email = email
    if (password) updatePayload.password = password

    const { data, error } = await adminClient.auth.admin.updateUserById(user_id, updatePayload)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ── 4. If email changed, also update the profiles table ──
    if (email) {
      await adminClient.from('profiles').update({ email }).eq('id', user_id)
    }

    return new Response(JSON.stringify({ success: true, user: { id: data.user.id, email: data.user.email } }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
