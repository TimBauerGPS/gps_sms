import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    console.warn('[signup-request] RESEND_API_KEY not set — skipping email')
    return
  }
  const from = process.env.RESEND_FROM_EMAIL ?? 'Allied SMS <onboarding@resend.dev>'
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
}

export async function POST(req: NextRequest) {
  const { name, email, company } = await req.json()

  if (!name?.trim() || !email?.trim() || !company?.trim()) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Check for duplicate pending request
  const { data: existing } = await admin
    .from('signup_requests')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .eq('status', 'pending')
    .limit(1)

  if (existing?.length) {
    return NextResponse.json(
      { error: 'A request from this email is already pending.' },
      { status: 409 }
    )
  }

  const { error } = await admin.from('signup_requests').insert({
    name: name.trim(),
    email: email.trim().toLowerCase(),
    requested_company_name: company.trim(),
    status: 'pending',
  })

  if (error) {
    console.error('[signup-request] insert error:', error)
    return NextResponse.json({ error: 'Failed to save request.' }, { status: 500 })
  }

  // Notify admin
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  await sendEmail(
    'tbauer@alliedrestoration.com',
    `New signup request from ${name}`,
    `
      <p><strong>${name}</strong> (${email}) has requested access to Allied SMS.</p>
      <p><strong>Company:</strong> ${company}</p>
      <p><a href="${appUrl}/admin/signups">Review and approve their request →</a></p>
    `
  )

  return NextResponse.json({ ok: true })
}
