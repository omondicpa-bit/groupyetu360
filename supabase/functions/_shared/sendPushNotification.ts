// supabase/functions/_shared/sendPushNotification.ts
//
// Shared by every automatic push trigger (payment confirmation,
// officials-notified-of-payment) and the SA broadcast composer's
// send-broadcast function — same reasoning as creditMemberContribution.ts
// being centralized: one place for this logic, not near-duplicates that
// can silently drift apart.
//
// Uses Deno's npm: specifier support (available in Supabase Edge Functions)
// to import the standard `web-push` library rather than hand-rolling the
// Web Push protocol's encryption — that protocol is genuinely intricate
// (ECDH + HKDF + aes128gcm payload encryption) and not something to
// reimplement by hand for a financial platform.

import webpush from "npm:web-push@3.6.7";

interface PushResult { sent: number; failed: number; }

/**
 * Sends a push notification to every subscribed device for the given user
 * IDs, and always logs it to notification_log for each of them regardless
 * of whether live push succeeds — that log is what the workspace picker's
 * bell/history reads from. Live push silently no-ops (returns
 * {sent:0,failed:0}) if VAPID isn't configured yet, or if none of the
 * target users have any subscriptions — push is additive to SMS and to the
 * history log, never a hard dependency, so a missing config here should
 * never break the calling flow (payment crediting, etc.).
 */
export async function sendPushNotification(
  supabase: any,
  userIds: string[],
  title: string,
  body: string,
  url?: string
): Promise<PushResult> {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (!uniqueUserIds.length) return { sent: 0, failed: 0 };

  // History is recorded for every targeted user regardless of whether live
  // push actually goes out — this is what the workspace picker's bell
  // reads from, and it needs to work even for someone who's never enabled
  // push, or whose device missed the live notification.
  try {
    await supabase.from('notification_log').insert(
      uniqueUserIds.map(uid => ({ user_id: uid, title, body, url: url || '/' }))
    );
  } catch (e: any) {
    console.error('[Push] notification_log insert failed (non-fatal):', e.message);
  }

  const { data: ps } = await supabase.from('platform_settings')
    .select('vapid_public_key, vapid_private_key, vapid_subject').maybeSingle();

  if (!ps?.vapid_public_key || !ps?.vapid_private_key) {
    console.warn('[Push] VAPID keys not configured — history logged, live push skipped');
    return { sent: 0, failed: 0 };
  }

  webpush.setVapidDetails(
    ps.vapid_subject || 'mailto:info@groupyetu.org',
    ps.vapid_public_key,
    ps.vapid_private_key
  );

  const { data: subs } = await supabase.from('push_subscriptions')
    .select('*').in('user_id', uniqueUserIds);
  if (!subs?.length) return { sent: 0, failed: 0 };

  const payload = JSON.stringify({ title, body, url: url || '/' });
  let sent = 0, failed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
        payload
      );
      sent++;
    } catch (e: any) {
      failed++;
      // 404/410 means the browser has unsubscribed or the app was
      // uninstalled — the subscription is permanently dead, clean it up
      // rather than keep retrying it on every future notification.
      if (e.statusCode === 404 || e.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        console.log('[Push] Removed dead subscription:', sub.id);
      } else {
        console.error('[Push] Send failed for subscription', sub.id, ':', e.message);
      }
    }
  }

  console.log(`[Push] Sent to ${sent}/${subs.length} devices for ${uniqueUserIds.length} user(s)`);
  return { sent, failed };
}
