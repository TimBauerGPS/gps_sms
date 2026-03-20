import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function sendEmail(to: string, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) return
  const from = process.env.RESEND_FROM_EMAIL ?? 'Allied SMS <onboarding@resend.dev>'
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html }),
  })
}

export async function POST(req: NextRequest) {
  // Auth — must be admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (userRow?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { requestId, companyId, companyName } = await req.json()
  if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch the request
  const { data: request, error: reqErr } = await admin
    .from('signup_requests')
    .select('*')
    .eq('id', requestId)
    .single()

  if (reqErr || !request) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 })
  }

  // Resolve or create company
  let resolvedCompanyId: string = companyId ?? ''

  if (!resolvedCompanyId) {
    const name = (companyName ?? request.requested_company_name).trim()
    const { data: newCompany, error: companyErr } = await admin
      .from('companies')
      .insert({ name })
      .select('id')
      .single()

    if (companyErr || !newCompany) {
      console.error('[approve-signup] company insert error:', companyErr)
      return NextResponse.json({ error: 'Failed to create company' }, { status: 500 })
    }

    resolvedCompanyId = newCompany.id
  } else if (companyName) {
    // Update existing company name if provided
    await admin
      .from('companies')
      .update({ name: companyName.trim() })
      .eq('id', resolvedCompanyId)
  }

  // Check if this email already exists in Supabase auth (e.g. from another app)
  let authUserId: string | null = null
  const { data: existingUsers } = await admin.auth.admin.listUsers()
  const existingUser = existingUsers?.users?.find(
    (u) => u.email?.toLowerCase() === request.email.toLowerCase()
  )

  if (existingUser) {
    // User already has a Supabase auth account — skip invite, send approval email
    authUserId = existingUser.id
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    await sendEmail(
      request.email,
      'Your Allied SMS access has been approved',
      `<p>Hi ${request.name},</p>
       <p>Your access to Allied SMS has been approved. Since you already have an account, you can log in immediately with your existing password:</p>
       <p><a href="${appUrl}/login">Log in to Allied SMS →</a></p>`
    )
  } else {
    // New user — send invite email so they can set a password
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      request.email,
      {
        data: { company_id: resolvedCompanyId },
        redirectTo: `${appUrl}/auth/callback?next=/auth/set-password`,
      }
    )
    if (inviteErr || !invited?.user) {
      console.error('[approve-signup] invite error:', inviteErr)
      return NextResponse.json({ error: inviteErr?.message ?? 'Failed to invite user' }, { status: 500 })
    }
    authUserId = invited.user.id
  }

  // Create public.users row
  const { error: usersErr } = await admin.from('users').insert({
    id: authUserId,
    company_id: resolvedCompanyId,
    email: request.email,
    role: 'member',
  })

  if (usersErr) {
    console.error('[approve-signup] users insert error:', usersErr)
    // Don't fail — auth user was created, admin can sort the DB row manually
  }

  // Mark request as approved
  await admin
    .from('signup_requests')
    .update({ status: 'approved', company_id: resolvedCompanyId })
    .eq('id', requestId)

  return NextResponse.json({ ok: true })
}
