import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findAuthUserByEmail, getGuardianAdminContext } from '@/lib/adminAccess'
import { getAppName, getAppSlug, getCanonicalAppUrl, getInviteConfirmUrl } from '@/lib/appAuth'

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
  const context = await getGuardianAdminContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!context.isSuperAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, companyId, companyName, role = 'member' } = await req.json()
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
  const requestedCompanyId = typeof companyId === 'string' ? companyId.trim() : ''
  const requestedCompanyName = typeof companyName === 'string' ? companyName.trim() : ''

  if (!normalizedEmail) return NextResponse.json({ error: 'email required' }, { status: 400 })
  if (!requestedCompanyId && !requestedCompanyName) {
    return NextResponse.json({ error: 'company required' }, { status: 400 })
  }
  if (role !== 'admin' && role !== 'member') {
    return NextResponse.json({ error: 'role must be admin or member' }, { status: 400 })
  }

  const admin = createAdminClient()
  const appName = getAppName()
  const appSlug = getAppSlug()
  const appUrl = getCanonicalAppUrl(new URL(req.url).origin)
  const inviteRedirectTo = getInviteConfirmUrl(new URL(req.url).origin)

  let company: { id: string; name: string } | null = null
  let companyError: { message?: string } | null = null

  if (requestedCompanyId) {
    const result = await admin
      .from('companies')
      .select('id, name')
      .eq('id', requestedCompanyId)
      .single()
    company = result.data
    companyError = result.error
  } else {
    const existing = await admin
      .from('companies')
      .select('id, name')
      .ilike('name', requestedCompanyName)
      .limit(1)
      .maybeSingle()

    if (existing.error) {
      companyError = existing.error
    } else if (existing.data) {
      company = existing.data
    } else {
      const created = await admin
        .from('companies')
        .insert({ name: requestedCompanyName })
        .select('id, name')
        .single()
      company = created.data
      companyError = created.error
    }
  }

  if (companyError || !company) {
    return NextResponse.json(
      { error: companyError?.message ?? 'Company not found' },
      { status: requestedCompanyId ? 404 : 500 }
    )
  }

  const existingUser = await findAuthUserByEmail(admin, normalizedEmail)
  let authUserId: string

  if (existingUser) {
    authUserId = existingUser.id
  } else {
    const { data: inviteResult, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        data: {
          app_name: appName,
          app_url: appUrl,
          signup_app: appSlug,
          company_id: company.id,
          company_name: company.name,
          invited_role: role,
        },
        redirectTo: inviteRedirectTo,
      }
    )

    if (inviteError || !inviteResult.user) {
      return NextResponse.json({ error: inviteError?.message ?? 'Failed to invite user' }, { status: 500 })
    }

    authUserId = inviteResult.user.id
  }

  const [{ error: accessError }, { error: userError }] = await Promise.all([
    admin
      .from('user_app_access')
      .upsert({ user_id: authUserId, app_name: appSlug, role }, { onConflict: 'user_id,app_name' }),
    admin
      .from('users')
      .upsert(
        { id: authUserId, company_id: company.id, email: normalizedEmail, role },
        { onConflict: 'id' }
      ),
  ])

  if (accessError || userError) {
    return NextResponse.json(
      { error: accessError?.message ?? userError?.message ?? 'Failed to save app access' },
      { status: 500 }
    )
  }

  if (existingUser) {
    await sendEmail(
      normalizedEmail,
      `Your ${appName} access is ready`,
      `<p>Your access to ${appName} is ready.</p>
       <p>You were added to <strong>${company.name}</strong>.</p>
       <p><a href="${appUrl}/login" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block;">Sign in to ${appName}</a></p>`
    )
  }

  return NextResponse.json({ ok: true, userId: authUserId, company })
}
