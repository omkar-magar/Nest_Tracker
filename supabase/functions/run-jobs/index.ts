// Scheduler entry point. Call it every 15-30 minutes (Supabase Cron, or any cron service):
//   POST /functions/v1/run-jobs   with header  x-cron-secret: <CRON_SECRET>
// 1. runs public.run_scheduled_jobs(): invoices, late fees, reminders, escalations, alerts, tasks, owner report
// 2. delivers queued notifications. A channel works only when its keys are set; otherwise its rows are marked
//    'skipped' with the reason, so nothing disappears silently.
//      email     RESEND_API_KEY, MAIL_FROM
//      sms       MSG91_AUTH_KEY, MSG91_SENDER, MSG91_TEMPLATE_ID   (DLT-registered template with one variable)
//      whatsapp  WHATSAPP_TOKEN, WHATSAPP_PHONE_ID                   (Meta WhatsApp Cloud API)
//      push      VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const env = (k: string) => Deno.env.get(k) ?? ''
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Row = {
  id: number; user_id: string | null; to_phone: string | null; to_email: string | null; channel: string
  subject: string; body: string; link: string | null; attempts: number
}

const absolute = (link: string | null) =>
  link ? (link.startsWith('http') ? link : (env('SITE_URL') || 'https://yolonest.in') + link) : ''
const intl = (phone: string) => (phone.length === 10 ? `91${phone}` : phone)

async function sendEmail(r: Row) {
  if (!env('RESEND_API_KEY')) return 'skip:RESEND_API_KEY not set'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('MAIL_FROM') || 'YOLO Nest <no-reply@yolonest.in>', to: r.to_email, subject: r.subject || 'YOLO Nest',
      text: r.body + (r.link ? `\n\n${absolute(r.link)}` : ''),
    }),
  })
  if (!res.ok) throw new Error(`resend ${res.status} ${await res.text()}`)
}

async function sendSms(r: Row) {
  if (!env('MSG91_AUTH_KEY') || !env('MSG91_TEMPLATE_ID')) return 'skip:MSG91 keys not set'
  const res = await fetch('https://control.msg91.com/api/v5/flow/', {
    method: 'POST',
    headers: { authkey: env('MSG91_AUTH_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      template_id: env('MSG91_TEMPLATE_ID'), sender: env('MSG91_SENDER'), short_url: '1',
      recipients: [{ mobiles: intl(r.to_phone!), var: r.body.slice(0, 300) }],
    }),
  })
  if (!res.ok) throw new Error(`msg91 ${res.status} ${await res.text()}`)
}

async function sendWhatsapp(r: Row) {
  if (!env('WHATSAPP_TOKEN') || !env('WHATSAPP_PHONE_ID')) return 'skip:WhatsApp Cloud API keys not set'
  const res = await fetch(`https://graph.facebook.com/v20.0/${env('WHATSAPP_PHONE_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: intl(r.to_phone!), type: 'text',
      text: { body: r.body + (r.link ? `\n${absolute(r.link)}` : '') },
    }),
  })
  if (!res.ok) throw new Error(`whatsapp ${res.status} ${await res.text()}`)
}

// deno-lint-ignore no-explicit-any
async function sendPush(r: Row, admin: any) {
  if (!env('VAPID_PUBLIC_KEY') || !env('VAPID_PRIVATE_KEY')) return 'skip:VAPID keys not set'
  webpush.setVapidDetails(env('VAPID_SUBJECT') || 'mailto:owner@yolonest.in', env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
  const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', r.user_id)
  if (!subs?.length) return 'skip:no device subscribed'
  const payload = JSON.stringify({ title: r.subject || 'YOLO Nest', body: r.body, url: r.link || '/' })
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id) // device gone
      else throw e
    }
  }
}

Deno.serve(async (req) => {
  if (!env('CRON_SECRET') || req.headers.get('x-cron-secret') !== env('CRON_SECRET')) return json({ error: 'Forbidden' }, 403)
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

  const { data: jobs, error: jobErr } = await admin.rpc('run_scheduled_jobs', { p_force: true })
  if (jobErr) console.error('jobs failed', jobErr.message)

  const { data: rows } = await admin.from('notifications').select('*').eq('status', 'queued').neq('channel', 'in_app')
    .order('created_at').limit(200)
  const tally = { sent: 0, failed: 0, skipped: 0 }
  for (const r of (rows ?? []) as Row[]) {
    try {
      const outcome = r.channel === 'email' ? await sendEmail(r)
        : r.channel === 'sms' ? await sendSms(r)
        : r.channel === 'whatsapp' ? await sendWhatsapp(r)
        : r.channel === 'push' ? await sendPush(r, admin) : 'skip:unknown channel'
      if (typeof outcome === 'string') {
        await admin.from('notifications').update({ status: 'skipped', error: outcome.slice(5) }).eq('id', r.id)
        tally.skipped++
      } else {
        await admin.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', r.id)
        tally.sent++
      }
    } catch (e) {
      // three tries, then it stays 'failed' with the provider's message for the office to see
      const attempts = r.attempts + 1
      await admin.from('notifications')
        .update({ attempts, status: attempts >= 3 ? 'failed' : 'queued', error: String(e).slice(0, 500) }).eq('id', r.id)
      tally.failed++
    }
  }
  return json({ jobs: jobs ?? jobErr?.message, notifications: tally })
})
