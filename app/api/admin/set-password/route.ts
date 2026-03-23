import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function generatePassword(): string {
  const words = ['Restore', 'Allied', 'Summit', 'Bridge', 'Falcon', 'Ember', 'Crest', 'Harbor']
  const word = words[Math.floor(Math.random() * words.length)]
  const num = Math.floor(100 + Math.random() * 900)
  const symbols = ['!', '#', '$', '@']
  const sym = symbols[Math.floor(Math.random() * symbols.length)]
  return `${word}${num}${sym}`
}

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  const from = process.env.RESEND_FROM_EMAIL ?? 'Guardian SMS <onboarding@resend.dev>'
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (userRow?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const admin = createAdminClient()

  // Find the user in Supabase auth
  const { data: { users } } = await admin.auth.admin.listUsers()
  const targetUser = users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (!targetUser) return NextResponse.json({ error: 'User not found in auth' }, { status: 404 })

  // Generate and set password
  const password = generatePassword()
  const { error: updateErr } = await admin.auth.admin.updateUserById(targetUser.id, { password })
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  // Email the password to the user
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://albisms.netlify.app'
  await sendEmail(
    email,
    'Your Guardian SMS login details',
    `<p>Hi,</p>
     <p>Your Guardian SMS account is ready. Here are your login details:</p>
     <table style="margin:16px 0;border-collapse:collapse;">
       <tr><td style="padding:4px 12px 4px 0;color:#666;">Email</td><td style="font-weight:600;">${email}</td></tr>
       <tr><td style="padding:4px 12px 4px 0;color:#666;">Password</td><td style="font-weight:600;font-family:monospace;font-size:16px;letter-spacing:1px;">${password}</td></tr>
     </table>
     <p><a href="${appUrl}/login" style="background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;">Log in to Guardian SMS →</a></p>
     <p style="color:#888;font-size:12px;">You can change your password anytime in Settings → Change Password.</p>`
  )

  return NextResponse.json({ ok: true, password })
}
